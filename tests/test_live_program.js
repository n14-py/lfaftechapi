const assert = require('assert');
const catalog = require('../utils/liveCatalog');

function videosDe(pais, cantidad) {
    return Array.from({ length: cantidad }, (_, i) => ({
        _id: `${pais}-${i}`,
        titulo: `Nota ${i} de ${pais}`,
        categoria: i < 3 ? 'politica' : (i < 6 ? 'economia' : 'deportes'),
        videoUrl: `https://cdn.ejemplo/${pais}-${i}.mp4`,
        descripcion: 'Resumen'
    }));
}

function configBase(extra = {}) {
    return catalog.normalizeConfig({
        enabled: true,
        paises: ['py', 'ar', 'cl', 'mx', 'co', 'pe', 'uy', 'ec', 'bo', 've'],
        canales: catalog.CANALES.map((canal) => ({ id: canal.id, activo: true, directosPorTanda: 3 })),
        minVideos: 8,
        maxVideos: 15,
        liveServiceUrl: 'http://localhost:3002',
        ...extra
    }, { strict: true });
}

const diezPaises = configBase();
assert.strictEqual(diezPaises.ok, true, diezPaises.errors.join(' '));
assert.strictEqual(diezPaises.config.paises.length, 10);
assert.strictEqual(diezPaises.config.totalDirectos, 12, '4 canales × 3 directos = 12');

const cero = catalog.normalizeConfig({
    paises: ['py'],
    canales: [{ id: 0, activo: true, directosPorTanda: 0 }],
    liveServiceUrl: 'https://motor.ejemplo'
}, { strict: true });
assert.strictEqual(cero.ok, false);
assert.ok(cero.errors.some((error) => error.includes('al menos 1')));

const urlMala = catalog.normalizeConfig({
    paises: ['py'],
    canales: catalog.defaultCanales(),
    liveServiceUrl: 'motor-sin-protocolo'
}, { strict: true });
assert.strictEqual(urlMala.ok, false);

const inventario = {};
for (const code of diezPaises.config.paises) inventario[code] = videosDe(code, 12);

const plan = catalog.planTanda({
    paises: diezPaises.config.paises,
    canales: diezPaises.config.canales,
    inventario,
    minVideos: 8,
    maxVideos: 15
});

assert.strictEqual(plan.total, 12);
for (const canal of catalog.CANALES) {
    const delCanal = plan.jobs.filter((job) => job.canalId === canal.id);
    assert.strictEqual(delCanal.length, 3, canal.nombre);
    const paises = new Set(delCanal.map((job) => job.pais));
    assert.strictEqual(paises.size, 3, `un canal no repite país si alcanza: ${canal.nombre}`);
}

const primero = plan.jobs[0];
assert.strictEqual(primero.canalId, 0);
assert.strictEqual(primero.pais, 'py');
assert.strictEqual(primero.payload.cuenta, 0);
assert.strictEqual(primero.payload.canal, 'Noticias Lat');
assert.strictEqual(primero.payload.videos.length, 12);
assert.ok(primero.payload.videos[0].video_url.startsWith('https://'));
assert.ok(primero.payload.live_id.startsWith('py-c0-'));

const ch3 = plan.jobs.filter((job) => job.canalId === 3).map((job) => job.pais);
assert.deepStrictEqual(ch3, ['ve', 'py', 'ar']);
assert.ok(plan.jobs.some((job) => job.pais === 'py' && job.canalId === 3 && job.reused));

const flaco = { py: videosDe('py', 3), ar: videosDe('ar', 10) };
const planFlaco = catalog.planTanda({
    paises: ['py', 'ar'],
    canales: [{ id: 0, nombre: 'Noticias Lat', activo: true, directosPorTanda: 1 }],
    inventario: flaco,
    minVideos: 8,
    maxVideos: 15
});
assert.strictEqual(planFlaco.total, 1);
assert.strictEqual(planFlaco.jobs[0].pais, 'ar');
assert.ok(planFlaco.avisos.some((aviso) => aviso.pais === 'py'));

const apagado = catalog.planTanda({
    paises: ['ar'],
    canales: [
        { id: 0, nombre: 'Noticias Lat', activo: false, directosPorTanda: 4 },
        { id: 1, nombre: 'Noticias Lat Última Hora', activo: true, directosPorTanda: 1 }
    ],
    inventario: { ar: videosDe('ar', 9) },
    minVideos: 8,
    maxVideos: 15
});
assert.strictEqual(apagado.total, 1);
assert.strictEqual(apagado.jobs[0].canalId, 1);
assert.strictEqual(apagado.jobs[0].payload.videos.length, 9);

console.log('test_live_program: ok');
