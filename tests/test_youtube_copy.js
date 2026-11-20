const assert = require('assert');
const mongoose = require('mongoose');
const marca = require('../config/noticiasLat');
const copy = require('../utils/youtubeCopy');
const Article = require('../models/article');

const ID = '64b7f3a2c19e4d0a8f123456';
const TITULO = 'Alejandra Escobar es nombrada viceministra de Inversión y Competencia en Guatemala';
const PREGUNTA = '¿Crees que el nombramiento de Alejandra Escobar como viceministra de Inversión y Competencia puede mejorar el clima para invertir en Guatemala?';
const INVITACION = '👇 Te leemos con atención. Cuéntanos qué pesa más para ti en este nombramiento.';
const FRASE = 'El Ministerio confirmó el nombramiento de Alejandra Escobar en Guatemala. ';

function desarrolloCercano(objetivo) {
    let texto = '';
    while (texto.length + FRASE.length <= objetivo) texto += FRASE;
    return texto.trim();
}

function enlacesDePrueba() {
    const enlaces = copy.enlacesPara(ID);
    enlaces.pais = 'gt';
    enlaces.categoria = 'economia';
    return enlaces;
}

function cuerpoRico() {
    return [
        'TOKEN_FUENTE_UNIC. El presidente de Guatemala nombró a Alejandra Escobar como viceministra de Inversión y Competencia.',
        'El Ministerio de Economía informó que la funcionaria se encargará de la atracción de inversiones y de la competencia en los mercados.',
        'Escobar asumirá el cargo en la ciudad de Guatemala durante este mes, según el comunicado oficial.',
        'La cartera indicó que el objetivo es coordinar con cámaras empresariales y con las autoridades de competencia ya existentes.',
        'No hay en el comunicado una cifra de empleos ni una promesa de resultados inmediatos.'
    ].join('\n\n');
}

function paqueteCon(desarrollo, extra = {}) {
    return copy.armarPaquete({
        desarrollo,
        hashtags: extra.hashtags || '#AlejandraEscobar #Inversion #Competencia #Gobierno',
        pregunta: extra.pregunta === undefined ? PREGUNTA : extra.pregunta,
        invitacion: extra.invitacion || INVITACION,
        enlaces: extra.enlaces || enlacesDePrueba(),
        titulo: extra.titulo || TITULO,
        articulo: extra.articulo || cuerpoRico()
    });
}

function urlsDe(texto) {
    return texto.match(/https:\/\/\S+/g) || [];
}

async function main() {
const enlaces = enlacesDePrueba();
const hashtags = copy.normalizarHashtags('#AlejandraEscobar #Inversion #Competencia #Gobierno', {
    pais: 'gt',
    categoria: 'economia'
});
const presupuesto = copy.calcularPresupuesto(enlaces, hashtags.join(' '));
assert.ok(presupuesto.objetivo > 800, `la parte fija deja poco espacio: ${presupuesto.objetivo}`);

const rico = paqueteCon(desarrolloCercano(presupuesto.objetivo));
assert.ok(rico.descripcionyt, 'la noticia con material suficiente debe tener descripción');
assert.ok(
    Math.abs(rico.descripcionyt.length - copy.DESCRIPCION_OBJETIVO) <= 120,
    `longitud ${rico.descripcionyt.length}, se esperaba cerca de 4500`
);
assert.ok(rico.descripcionyt.length <= copy.DESCRIPCION_MAX);
assert.ok(rico.descripcionyt.length <= copy.DESCRIPCION_SUAVE);
assert.ok(rico.descripcionyt.startsWith('📱 NOTICIA COMPLETA Y CON MÁS DETALLES AQUÍ:\n' + enlaces.noticia));
assert.ok(rico.descripcionyt.indexOf(enlaces.noticia) < rico.descripcionyt.indexOf(enlaces.app));
assert.ok(rico.descripcionyt.includes('No somos una empresa millonaria'));
assert.ok(rico.descripcionyt.includes('Puedes apoyar a Noticias.lat desde US$0.69 al mes'));
assert.ok(rico.descripcionyt.includes('LOS QUE AYUDAN'));
assert.ok(rico.descripcionyt.includes('configure su nombre o perfil'));
assert.ok(rico.descripcionyt.includes('Socio Fundador'));
assert.ok(rico.descripcionyt.includes('WhatsApp de socios fundadores'));
assert.ok(rico.descripcionyt.includes('Colaborador'));
assert.ok(rico.descripcionyt.includes('#NoticiasLAT'));
assert.ok(!/US\$\s*0[,.]99|0[,.]99\s*\$/.test(rico.descripcionyt));
assert.ok(!/millones de usuarios|empleados/i.test(rico.descripcionyt));
assert.deepStrictEqual(
    urlsDe(rico.descripcionyt).sort(),
    [enlaces.noticia, enlaces.app, enlaces.membresia].sort()
);
const orden = [
    rico.descripcionyt.indexOf('📱 NOTICIA COMPLETA'),
    rico.descripcionyt.indexOf('El Ministerio confirmó'),
    rico.descripcionyt.indexOf('¿QUÉ ES NOTICIAS.LAT?'),
    rico.descripcionyt.indexOf('AYÚDANOS A HACER CRECER'),
    rico.descripcionyt.indexOf('#NoticiasLAT')
];
assert.deepStrictEqual(orden, orden.slice().sort((a, b) => a - b));
assert.ok(orden.every((n) => n >= 0));

assert.ok(rico.comentarioyt.startsWith('💬 ¡Queremos conocer tu opinión!'));
assert.ok(rico.comentarioyt.includes(PREGUNTA));
assert.ok(rico.comentarioyt.indexOf(PREGUNTA) < rico.comentarioyt.indexOf(enlaces.app));
assert.ok(rico.comentarioyt.includes(enlaces.membresia));
assert.ok(rico.comentarioyt.includes('desde US$0.69 al mes'));
assert.ok(rico.comentarioyt.includes('LOS QUE AYUDAN'));
assert.ok(!/0[,.]99/.test(rico.comentarioyt));

const parrafos = [];
for (let i = 0; i < 6; i += 1) {
    parrafos.push(`Párrafo ${i}. El Ministerio confirmó el nombramiento de Alejandra Escobar en Guatemala y explicó el alcance de la función. `.repeat(4));
}
parrafos.push('Como lectura, y no como un hecho confirmado: este cierre secundario no debe sobrevivir. TOKEN_SECUNDARIO.');
const largo = paqueteCon(parrafos.join('\n\n'));
const crudo = [
    copy.bloqueNoticia(enlaces),
    parrafos.join('\n\n'),
    copy.bloqueIdentidad(),
    copy.bloqueApoyo(enlaces),
    hashtags.join(' ')
].join('\n\n');
assert.ok(crudo.length > copy.DESCRIPCION_MAX);
assert.ok(largo.descripcionyt);
assert.ok(largo.descripcionyt.length <= copy.DESCRIPCION_MAX);
assert.notStrictEqual(largo.descripcionyt, crudo.slice(0, copy.DESCRIPCION_MAX));
assert.ok(!largo.descripcionyt.includes('TOKEN_SECUNDARIO'));
assert.ok(largo.descripcionyt.startsWith('📱 NOTICIA COMPLETA Y CON MÁS DETALLES AQUÍ:'));
assert.ok(/[.!?]$/.test(largo.descripcionyt.split('\n\n')[1].trim()) || largo.descripcionyt.includes('¿QUÉ ES NOTICIAS.LAT?'));

const gigante = paqueteCon('Sin punto final ' + 'palabra '.repeat(1400));
assert.strictEqual(gigante.descripcionyt, null);
assert.ok(gigante.comentarioyt, 'la pregunta sigue siendo válida aunque la descripción no quepa');

const corto = paqueteCon('El Ministerio confirmó el nombramiento de Alejandra Escobar en Guatemala y publicó un comunicado breve. El texto solo precisa el cargo, la ciudad de Guatemala y que la cartera no anunció una meta numérica.');
assert.ok(corto.descripcionyt);
assert.ok(corto.descripcionyt.length < 4200);
assert.strictEqual(corto.descripcionyt.split('publicó un comunicado breve').length - 1, 1);

const sinNoticia = copy.enlacesPara(null);
sinNoticia.pais = 'gt';
const respaldo = paqueteCon(desarrolloCercano(700), { enlaces: sinNoticia });
assert.ok(respaldo.descripcionyt.startsWith('📱 NOTICIA COMPLETA Y CON MÁS DETALLES AQUÍ:\n' + marca.playStoreUrl));
assert.ok(!respaldo.descripcionyt.includes('/articulo/'));

const precioMal = [
    desarrolloCercano(500),
    'Puedes apoyar a Noticias.lat desde US$0.99 al mes y hacerte miembro de todos los niveles.',
    'Noticias.lat ya tiene 500 mil usuarios y decenas de empleados.'
].join('\n\n');
const limpio = paqueteCon(precioMal);
assert.ok(!/0[,.]99/.test(limpio.descripcionyt));
assert.ok(!/500 mil usuarios|empleados/i.test(limpio.descripcionyt));

const sinDebate = paqueteCon(desarrolloCercano(500), {
    pregunta: '¿Qué opinas de esta noticia de último momento?'
});
assert.strictEqual(sinDebate.comentarioyt, null);
assert.ok(sinDebate.descripcionyt);

const etiquetas = copy.normalizarHashtags(
    '#shorts #noticiaslat #AlejandraEscobar #Guatemala #Economia #Inversion #Competencia #Gobierno #Uno #Dos #Tres #Cuatro #Cinco',
    { pais: 'gt', categoria: 'economia', esShort: false }
);
assert.strictEqual(etiquetas[0], '#NoticiasLAT');
assert.strictEqual(etiquetas.filter((tag) => tag === '#NoticiasLAT').length, 1);
assert.ok(etiquetas.length <= 10);
assert.ok(!etiquetas.some((tag) => tag.toLowerCase() === '#shorts'));
assert.ok(etiquetas.includes('#Guatemala'));

const ultimo = copy.interpretarRespuesta(`
[===INICIO_DATOS===]
<desarrollo>DATO_VIEJO que no debe usarse porque hay un bloque posterior.</desarrollo>
<pregunta>¿Este bloque viejo pregunta por Alejandra Escobar?</pregunta>
[===FIN_DATOS===]
pensamiento intermedio
[===INICIO_DATOS===]
<desarrollo>${desarrolloCercano(400)}</desarrollo>
<hashtags>#AlejandraEscobar #Guatemala</hashtags>
<pregunta>${PREGUNTA}</pregunta>
<invitacion>${INVITACION}</invitacion>
[===FIN_DATOS===]`);
assert.ok(!ultimo.desarrollo.includes('DATO_VIEJO'));
assert.strictEqual(ultimo.pregunta, PREGUNTA);

const contexto = {
    articleId: ID,
    titulo: TITULO,
    articuloGenerado: cuerpoRico(),
    resumen: 'Alejandra Escobar fue nombrada viceministra en Guatemala.',
    descripcionFuente: 'El gobierno confirmó el nombramiento.',
    fuente: 'Comunicado oficial',
    pais: 'gt',
    categoria: 'economia',
    fecha: new Date('2026-03-04T15:00:00Z'),
    esShort: false
};
const prompt = copy.construirPrompt(contexto, presupuesto);
assert.ok(prompt.includes('TOKEN_FUENTE_UNIC'));
assert.ok(prompt.includes(TITULO));
assert.ok(prompt.includes(contexto.resumen));
assert.ok(prompt.includes('NO inventes'));
assert.ok(prompt.includes('marzo de 2026'));
assert.ok(prompt.includes('LONGITUD_DESARROLLO'));

let llamadas = 0;
const generado = await copy.generateYoutubeCopy(contexto, {
    generate: async (texto) => {
        llamadas += 1;
        assert.ok(texto.includes('TOKEN_FUENTE_UNIC'));
        const objetivo = Number(texto.match(/LONGITUD_DESARROLLO objetivo=(\d+)/)[1]);
        return `[===INICIO_DATOS===]
<desarrollo>${desarrolloCercano(objetivo)}</desarrollo>
<hashtags>#AlejandraEscobar #Inversion #Competencia #Gobierno</hashtags>
<pregunta>${PREGUNTA}</pregunta>
<invitacion>${INVITACION}</invitacion>
[===FIN_DATOS===]`;
    }
});
assert.strictEqual(llamadas, 1);
assert.ok(generado.descripcionyt.length <= copy.DESCRIPCION_MAX);
assert.ok(generado.descripcionyt.length >= 4200);
assert.ok(generado.comentarioyt.includes('Alejandra Escobar'));
assert.ok(generado.descripcionyt.includes(enlaces.noticia));

const fallido = await copy.generateYoutubeCopy(contexto, {
    generate: async () => { throw new Error('cuota agotada'); }
});
assert.strictEqual(fallido, null);

const borrador = {
    _id: ID,
    titulo: TITULO,
    descripcion: 'Bajada corta de la fuente',
    articuloGenerado: cuerpoRico(),
    aiSummary: contexto.resumen,
    fuente: 'Comunicado oficial',
    pais: 'gt',
    categoria: 'economia',
    fecha: contexto.fecha
};
const guardado = await copy.attachYoutubeCopy(borrador, {
    generate: async () => { throw new Error('fallo de red'); }
});
assert.strictEqual(guardado, false);
assert.strictEqual(borrador.descripcion, 'Bajada corta de la fuente');
assert.ok(!borrador.descripcionyt);
assert.ok(!borrador.comentarioyt);

const guardadoOk = await copy.attachYoutubeCopy(borrador, {
    generate: async (texto) => {
        const objetivo = Number(texto.match(/LONGITUD_DESARROLLO objetivo=(\d+)/)[1]);
        return `[===INICIO_DATOS===]
<desarrollo>${desarrolloCercano(objetivo)}</desarrollo>
<hashtags>#AlejandraEscobar #Guatemala</hashtags>
<pregunta>${PREGUNTA}</pregunta>
<invitacion>${INVITACION}</invitacion>
[===FIN_DATOS===]`;
    }
});
assert.strictEqual(guardadoOk, true);
assert.strictEqual(borrador.descripcion, 'Bajada corta de la fuente');
assert.notStrictEqual(borrador.descripcionyt, borrador.descripcion);
assert.ok(borrador.comentarioyt);

const vieja = new Article({
    titulo: 'Noticia anterior',
    descripcion: 'Bajada corta',
    imagen: 'https://ejemplo.test/img.jpg',
    categoria: 'politica',
    sitio: 'noticias.lat',
    articuloGenerado: 'Cuerpo que ya estaba guardado antes de esta actualización.'
});
await vieja.validate();
assert.strictEqual(vieja.descripcion, 'Bajada corta');
assert.strictEqual(vieja.comentarioyt, null);
assert.strictEqual(vieja.descripcionyt, null);
assert.ok(mongoose.Types.ObjectId.isValid(vieja._id));

const payload = {
    youtube_description: 'descripción vieja recortada',
    youtube_title: 'Titular',
    scenes: [{ type: 'body', text: 'Locución que no debe cambiar.' }]
};
copy.applyStoredYoutubeDescription(payload, { descripcionyt: borrador.descripcionyt });
assert.strictEqual(payload.youtube_description, borrador.descripcionyt);
assert.strictEqual(payload.scenes[0].text, 'Locución que no debe cambiar.');
assert.strictEqual(payload.youtube_title, 'Titular');

const intacto = { youtube_description: 'se conserva', scenes: [{ text: 'hola' }] };
copy.applyStoredYoutubeDescription(intacto, { descripcionyt: null });
copy.applyStoredYoutubeDescription(intacto, { descripcionyt: 'x'.repeat(5001) });
copy.applyStoredYoutubeDescription(intacto, { descripcionyt: 'Texto sin el bloque inicial, aunque sea largo. '.repeat(30) });
assert.strictEqual(intacto.youtube_description, 'se conserva');
assert.strictEqual(intacto.scenes[0].text, 'hola');

assert.deepStrictEqual(
    marca.niveles.map((nivel) => [nivel.nombre, nivel.precioUsd]),
    [
        ['Colaborador', 0.69],
        ['Aliado', 2.79],
        ['Impulsor', 5.49],
        ['Socio Fundador', 9.99]
    ]
);
assert.strictEqual(marca.precioDesde, 'US$0.69');
assert.strictEqual(marca.playStoreUrl, 'https://play.google.com/store/apps/details?id=com.noticiaslat.app');
assert.strictEqual(marca.membershipUrl, 'https://www.youtube.com/@noticias-lat/join');
assert.strictEqual(marca.losQueAyudanUrl, '');
assert.strictEqual(marca.canalesYoutube.length, 4);
assert.ok(marca.canalesYoutube.every((canal) => canal.membresia.endsWith('/join')));
assert.strictEqual(copy.enlaceNoticia('no-es-un-id'), null);
assert.strictEqual(copy.enlaceNoticia(ID), `https://www.noticias.lat/articulo/${ID}`);

const fases = [];
const cuerpoLargo = `${cuerpoRico()}\n\n${'El Ministerio de Economía detalló funciones de Alejandra Escobar en Guatemala. '.repeat(40)}`;
const recuperado = await copy.generateYoutubeCopy({
    ...contexto,
    articuloGenerado: cuerpoLargo
}, {
    generate: async (texto) => {
        if (texto.includes('Amplía el desarrollo')) {
            fases.push('expansion');
            const objetivo = Number(texto.match(/LONGITUD_DESARROLLO objetivo=(\d+)/)[1]);
            return `[===INICIO_DATOS===]
<desarrollo>${desarrolloCercano(objetivo)}</desarrollo>
<hashtags></hashtags>
<pregunta></pregunta>
<invitacion></invitacion>
[===FIN_DATOS===]`;
        }
        if (texto.includes('PREGUNTA_ANCLADA')) {
            fases.push('pregunta');
            return `[===INICIO_DATOS===]
<desarrollo></desarrollo>
<hashtags></hashtags>
<pregunta>${PREGUNTA}</pregunta>
<invitacion></invitacion>
[===FIN_DATOS===]`;
        }
        fases.push('base');
        return `[===INICIO_DATOS===]
<desarrollo>El Ministerio confirmó el nombramiento de Alejandra Escobar en Guatemala y publicó un comunicado breve con el cargo y la ciudad.</desarrollo>
<hashtags>#AlejandraEscobar #Guatemala</hashtags>
<pregunta>¿Qué opinas?</pregunta>
<invitacion></invitacion>
[===FIN_DATOS===]`;
    }
});
assert.deepStrictEqual(fases, ['base', 'expansion', 'pregunta']);
assert.ok(recuperado.descripcionyt.length <= copy.DESCRIPCION_MAX);
assert.ok(recuperado.descripcionyt.length >= 4200);
assert.ok(recuperado.comentarioyt.includes(PREGUNTA));

console.log(`YouTube copy OK. Descripción de prueba: ${rico.descripcionyt.length} caracteres. Comentario: ${rico.comentarioyt.length} caracteres.`);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
