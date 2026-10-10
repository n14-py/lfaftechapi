// Catálogo y armado de la tanda de directos.
// El JSON que sale de acá es el que entiende noticiaslatenvivo (POST /live/start).

const PAISES = [
    { code: 'ar', nombre: 'Argentina' },
    { code: 'bo', nombre: 'Bolivia' },
    { code: 'br', nombre: 'Brasil' },
    { code: 'cl', nombre: 'Chile' },
    { code: 'co', nombre: 'Colombia' },
    { code: 'cr', nombre: 'Costa Rica' },
    { code: 'cu', nombre: 'Cuba' },
    { code: 'ec', nombre: 'Ecuador' },
    { code: 'sv', nombre: 'El Salvador' },
    { code: 'gt', nombre: 'Guatemala' },
    { code: 'hn', nombre: 'Honduras' },
    { code: 'mx', nombre: 'México' },
    { code: 'ni', nombre: 'Nicaragua' },
    { code: 'pa', nombre: 'Panamá' },
    { code: 'py', nombre: 'Paraguay' },
    { code: 'pe', nombre: 'Perú' },
    { code: 'do', nombre: 'República Dominicana' },
    { code: 'uy', nombre: 'Uruguay' },
    { code: 've', nombre: 'Venezuela' }
];

// Las mismas 4 cuentas de YouTube que ya usa el resto de la red (token_0 … token_3).
const CANALES = [
    { id: 0, nombre: 'Noticias Lat' },
    { id: 1, nombre: 'Noticias Lat Última Hora' },
    { id: 2, nombre: 'Noticias Lat Ahora' },
    { id: 3, nombre: 'Noticias Lat Hoy' }
];

const MIN_DIRECTOS = 1;
const MAX_DIRECTOS = 8;
const DEFAULT_MIN_VIDEOS = 8;
const DEFAULT_MAX_VIDEOS = 15;

const PAIS_POR_CODIGO = Object.fromEntries(PAISES.map((p) => [p.code, p]));

function nombrePais(code) {
    return (PAIS_POR_CODIGO[code] && PAIS_POR_CODIGO[code].nombre) || String(code || '').toUpperCase();
}

function clampInt(value, min, max, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, Math.round(n)));
}

function normalizeServiceUrl(raw) {
    const value = String(raw || '').trim().replace(/\/+$/, '');
    if (!value) return '';
    if (!/^https?:\/\//i.test(value)) return null;
    return value;
}

function defaultCanales() {
    return CANALES.map((canal) => ({
        id: canal.id,
        nombre: canal.nombre,
        activo: true,
        directosPorTanda: 1
    }));
}

function totalDirectos(canales) {
    return (canales || [])
        .filter((canal) => canal.activo)
        .reduce((sum, canal) => sum + (Number(canal.directosPorTanda) || 0), 0);
}

/**
 * Normaliza lo que manda el admin.
 * strict=true exige al menos un país y un canal activo (al guardar el programa).
 */
function normalizeConfig(input = {}, { strict = false } = {}) {
    const errors = [];
    const source = input && typeof input === 'object' ? input : {};
    const catalogo = new Set(PAISES.map((p) => p.code));

    const paises = [];
    const vistos = new Set();
    const lista = Array.isArray(source.paises) ? source.paises : [];
    for (const raw of lista) {
        const code = String(raw || '').trim().toLowerCase();
        if (!catalogo.has(code) || vistos.has(code)) continue;
        vistos.add(code);
        paises.push(code);
    }
    if (strict && paises.length === 0) {
        errors.push('Marcá al menos un país para los directos.');
    }

    const incoming = Array.isArray(source.canales) ? source.canales : [];
    const canales = CANALES.map((base) => {
        const found = incoming.find((canal) => Number(canal && canal.id) === base.id);
        const activo = found ? found.activo !== false && found.activo !== 'false' : true;
        const pedido = found ? (found.directosPorTanda ?? found.directos) : 1;
        const directosPorTanda = clampInt(pedido, activo ? MIN_DIRECTOS : 0, MAX_DIRECTOS, 1);
        if (activo && (Number(pedido) < MIN_DIRECTOS || Number(pedido) > MAX_DIRECTOS || !Number.isFinite(Number(pedido)))) {
            if (found && (pedido === 0 || pedido === '0')) {
                errors.push(`${base.nombre}: cada canal activo necesita al menos 1 directo.`);
            }
        }
        return {
            id: base.id,
            nombre: base.nombre,
            activo: Boolean(activo),
            directosPorTanda: activo ? Math.max(MIN_DIRECTOS, directosPorTanda) : directosPorTanda
        };
    });

    if (strict && !canales.some((canal) => canal.activo)) {
        errors.push('Activá al menos un canal.');
    }

    const minVideos = clampInt(source.minVideos, 4, 15, DEFAULT_MIN_VIDEOS);
    let maxVideos = clampInt(source.maxVideos, 8, 20, DEFAULT_MAX_VIDEOS);
    if (maxVideos < minVideos) maxVideos = minVideos;

    const lookbackDays = clampInt(source.lookbackDays, 1, 21, 5);
    const liveServiceUrl = normalizeServiceUrl(source.liveServiceUrl);
    if (liveServiceUrl === null) {
        errors.push('La URL del motor de directos tiene que empezar con http:// o https://.');
    }

    const config = {
        enabled: Boolean(source.enabled),
        autoDispatch: source.autoDispatch !== false && source.autoDispatch !== 'false',
        liveServiceUrl: liveServiceUrl || '',
        lookbackDays,
        minVideos,
        maxVideos,
        paises,
        canales,
        totalDirectos: totalDirectos(canales)
    };

    return { ok: errors.length === 0, errors, config };
}

function makeLiveId(pais, canalId, now = new Date()) {
    const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z').slice(0, 13);
    const rand = Math.random().toString(36).slice(2, 6);
    return `${pais}-c${canalId}-${stamp}-${rand}`;
}

function buildPayload({ liveId, pais, canalNombre, cuenta, videos }) {
    return {
        live_id: liveId,
        pais,
        canal: canalNombre,
        cuenta: Number(cuenta),
        canal_id: Number(cuenta),
        videos: (videos || []).map((video) => ({
            article_id: String(video._id || video.article_id || video.id),
            titulo: String(video.titulo || video.title || 'Noticia').trim(),
            categoria: String(video.categoria || video.category || 'general').trim().toLowerCase() || 'general',
            video_url: String(video.videoUrl || video.video_url || video.url || '').trim(),
            descripcion: String(video.descripcion || video.description || '').trim().slice(0, 280)
        }))
    };
}

function _idOf(video) {
    return String(video._id || video.article_id || video.id || '');
}

/**
 * Arma la cola de una tanda.
 * Reparte los países marcados entre los canales, en orden, hasta cubrir
 * los directos pedidos en cada canal. Si se acaban los países, vuelve a empezar.
 * Un canal no repite país mientras alcance la lista. Las notas ya usadas
 * en esta tanda se reservan; si no alcanzan, se reutilizan y queda avisado.
 */
function planTanda({ paises, canales, inventario, minVideos, maxVideos, reservados }) {
    const avisos = [];
    const jobs = [];
    const min = minVideos || DEFAULT_MIN_VIDEOS;
    const max = maxVideos || DEFAULT_MAX_VIDEOS;
    const used = new Set((reservados || []).map(String));

    const elegibles = [];
    for (const code of paises || []) {
        const listos = (inventario && inventario[code]) || [];
        if (listos.length < min) {
            avisos.push({
                pais: code,
                paisNombre: nombrePais(code),
                motivo: `${nombrePais(code)} tiene ${listos.length} videos listos y el mínimo es ${min}.`
            });
            continue;
        }
        elegibles.push(code);
    }

    if (!elegibles.length) {
        return { jobs, avisos, total: 0 };
    }

    let cursor = 0;
    for (const canal of (canales || []).filter((item) => item.activo)) {
        const cupo = Math.max(0, Number(canal.directosPorTanda) || 0);
        let placed = 0;
        let guard = 0;
        const tope = Math.max(elegibles.length * (cupo + 1), cupo);
        while (placed < cupo && guard < tope) {
            const code = elegibles[cursor % elegibles.length];
            cursor += 1;
            guard += 1;

            const yaEnEsteCanal = jobs.some((job) => job.pais === code && job.canalId === canal.id);
            if (yaEnEsteCanal && elegibles.length >= cupo) continue;

            const todos = (inventario[code] || []).filter((video) => _idOf(video) && (video.videoUrl || video.video_url));
            const frescos = todos.filter((video) => !used.has(_idOf(video)));
            const reused = frescos.length < min;
            const source = reused ? todos : frescos;
            if (source.length < min) continue;

            const chosen = source.slice(0, max);
            chosen.forEach((video) => used.add(_idOf(video)));
            const liveId = makeLiveId(code, canal.id);
            jobs.push({
                liveId,
                pais: code,
                paisNombre: nombrePais(code),
                canalId: canal.id,
                canalNombre: canal.nombre,
                reused,
                videoCount: chosen.length,
                articleIds: chosen.map(_idOf),
                payload: buildPayload({
                    liveId,
                    pais: code,
                    canalNombre: canal.nombre,
                    cuenta: canal.id,
                    videos: chosen
                })
            });
            if (reused) {
                avisos.push({
                    pais: code,
                    paisNombre: nombrePais(code),
                    canalId: canal.id,
                    motivo: `${nombrePais(code)} se repite en ${canal.nombre} con notas que ya entraron en otro directo de esta tanda.`
                });
            }
            placed += 1;
        }
        if (placed < cupo) {
            avisos.push({
                canalId: canal.id,
                motivo: `${canal.nombre}: se armaron ${placed} de ${cupo} directos. Faltan países con videos suficientes.`
            });
        }
    }

    return { jobs, avisos, total: jobs.length };
}

module.exports = {
    PAISES,
    CANALES,
    MIN_DIRECTOS,
    MAX_DIRECTOS,
    DEFAULT_MIN_VIDEOS,
    DEFAULT_MAX_VIDEOS,
    nombrePais,
    normalizeServiceUrl,
    defaultCanales,
    totalDirectos,
    normalizeConfig,
    makeLiveId,
    buildPayload,
    planTanda
};
