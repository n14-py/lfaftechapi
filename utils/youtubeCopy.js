// Descripción de YouTube y comentario (comentarioyt) a partir de la noticia completa.
// Los bloques institucionales los arma este módulo para que el precio, los enlaces
// y la identidad no varíen. La IA redacta el desarrollo, los hashtags y la pregunta.
const marca = require('../config/noticiasLat');

const DESCRIPCION_OBJETIVO = 4500;
const DESCRIPCION_SUAVE = 4800;
const DESCRIPCION_MAX = 5000;
const DESARROLLO_MINIMO = 180;
const PREGUNTA_MIN = 40;
const PREGUNTA_MAX = 420;
const HASHTAG_ESTIMADO = '#NoticiasLAT #Pais #Tema #Protagonista #Institucion #Actualidad';

const PALABRAS_VACIAS = new Set([
    'desde', 'sobre', 'entre', 'para', 'como', 'donde', 'cuando', 'esta', 'este', 'esto',
    'noticia', 'noticias', 'lat', 'tras', 'hacia', 'porque', 'tambien', 'puede', 'pueden',
    'segun', 'luego', 'despues', 'durante', 'hasta', 'contra', 'mediante', 'tiene', 'hacer',
    'quien', 'quienes', 'cual', 'cuales', 'donde', 'haber', 'seria', 'estan', 'estas'
]);

const INVITACIONES = [
    '👇 Te leemos. Nos interesa conocer distintos puntos de vista.',
    '👇 Cuéntanos cómo lo ves. Leemos cada comentario con atención.',
    '👇 Déjanos tu lectura del hecho. La conversación ayuda a entenderlo mejor.',
    '👇 Queremos escuchar argumentos distintos. ¿Qué es lo que más te llama la atención?'
];

function enlaceNoticia(articleId) {
    const id = String(articleId || '').trim();
    if (!/^[a-f0-9]{24}$/i.test(id)) return null;
    return `${marca.webOrigin}/articulo/${id}`;
}

function enlacesPara(articleId) {
    const noticia = enlaceNoticia(articleId);
    return {
        noticia,
        principal: noticia || marca.playStoreUrl,
        app: marca.playStoreUrl,
        membresia: marca.membershipUrl,
        losQueAyudan: marca.losQueAyudanUrl || ''
    };
}

function bloqueNoticia(enlaces) {
    const lineas = [
        '📱 NOTICIA COMPLETA Y CON MÁS DETALLES AQUÍ:',
        enlaces.principal
    ];
    if (enlaces.noticia && enlaces.app && enlaces.app !== enlaces.principal) {
        lineas.push(
            '',
            'Descarga la aplicación de Noticias.lat y sigue la cobertura con más detalle:',
            enlaces.app
        );
    }
    return lineas.join('\n');
}

function bloqueIdentidad() {
    return [
        '¿QUÉ ES NOTICIAS.LAT?',
        '',
        'Noticias.lat es una plataforma informativa digital que nace con una misión: acercar las noticias y la actualidad a las personas mediante la tecnología.',
        '',
        'No somos una empresa millonaria. Somos un proyecto que crece día a día gracias a nuestra comunidad, a quienes nos leen, nos ven, descargan nuestra aplicación y creen en lo que estamos construyendo.',
        '',
        'Trabajamos constantemente para mejorar, desarrollar nuevas herramientas, mejorar los videos y las voces, y acercarte información de diferentes países y temas de interés.',
        '',
        'Nuestro compromiso es seguir trabajando para ofrecerte noticias, mantenerte informado y mejorar cada día.',
        '',
        'Para continuar creciendo necesitamos personas que crean en este proyecto y quieran acompañarnos. Cada descarga, cada visita, cada comentario y cada aporte nos ayuda a seguir adelante.',
        '',
        'Noticias.lat no crece solamente gracias a quienes lo construyen, sino también gracias a quienes deciden formar parte de él.'
    ].join('\n');
}

function bloqueApoyo(enlaces) {
    const espacio = enlaces.losQueAyudan
        ? ` Quienes quieran conocer el espacio pueden entrar aquí: ${enlaces.losQueAyudan}`
        : '';
    return [
        '💙 AYÚDANOS A HACER CRECER NOTICIAS.LAT',
        '',
        'No somos una empresa millonaria. Somos un proyecto que crece gracias a personas como tú.',
        '',
        'Puedes apoyar a Noticias.lat desde US$0.69 al mes, que corresponde al nivel Colaborador. Tu aporte nos ayuda a mantener nuestros servidores, mejorar nuestra tecnología y la calidad de los videos, desarrollar nuevas herramientas y seguir ofreciendo mejores noticias de distintos lugares del mundo.',
        '',
        'No importa cuánto puedas aportar: cada persona que decide apoyarnos es importante.',
        '',
        'Quienes nos apoyan pueden formar parte de LOS QUE AYUDAN, el espacio de nuestra web y aplicación donde reconocemos a las personas que hacen posible que este proyecto siga creciendo. Ese reconocimiento depende del nivel de membresía y de que cada persona configure su nombre o perfil. Aliado puede aparecer en Los que ayudan. Impulsor recibe el reconocimiento de su nivel. Socio Fundador tiene un reconocimiento especial como fundador, además de las menciones correspondientes y el acceso al grupo de WhatsApp de socios fundadores. Colaborador también forma parte de la comunidad y recibe los beneficios de lealtad de su nivel.' + espacio,
        '',
        'Cada aporte cuenta. Cada persona importa.',
        '',
        'Si crees en lo que estamos construyendo, nos encantaría que formaras parte.',
        '',
        '👉 Únete a Noticias.lat: suscríbete y únete como miembro desde US$0.69 al mes.',
        enlaces.membresia
    ].join('\n');
}

function calcularPresupuesto(enlaces, hashtagsLine) {
    const fija = bloqueNoticia(enlaces).length
        + bloqueIdentidad().length
        + bloqueApoyo(enlaces).length
        + String(hashtagsLine || '').trim().length
        + 8;
    return {
        objetivo: Math.max(DESARROLLO_MINIMO, DESCRIPCION_OBJETIVO - fija),
        minimo: Math.max(DESARROLLO_MINIMO, DESCRIPCION_OBJETIVO - 350 - fija),
        maxSuave: Math.max(DESARROLLO_MINIMO, DESCRIPCION_SUAVE - fija),
        maxDuro: Math.max(DESARROLLO_MINIMO, DESCRIPCION_MAX - fija)
    };
}

function fechaLegible(fecha) {
    if (!fecha) return '';
    const dia = fecha instanceof Date ? fecha : new Date(fecha);
    if (Number.isNaN(dia.getTime())) return '';
    return new Intl.DateTimeFormat('es-ES', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC'
    }).format(dia);
}

function extraerUltimoBloque(fullText) {
    const masterRegex = /\[===INICIO_DATOS===\]([\s\S]*?)\[===FIN_DATOS===\]/gi;
    const matches = [...String(fullText || '').matchAll(masterRegex)];
    if (matches.length > 0) return matches[matches.length - 1][1];
    return String(fullText || '');
}

function extraerEtiqueta(texto, tag) {
    const regex = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i');
    const match = String(texto || '').match(regex);
    return match && match[1] ? match[1].trim() : '';
}

function interpretarRespuesta(fullText) {
    const bloque = extraerUltimoBloque(fullText);
    const desarrollo = extraerEtiqueta(bloque, 'desarrollo');
    const hashtags = extraerEtiqueta(bloque, 'hashtags');
    const pregunta = extraerEtiqueta(bloque, 'pregunta');
    const invitacion = extraerEtiqueta(bloque, 'invitacion');
    if (!desarrollo && !pregunta) return null;
    return { desarrollo, hashtags, pregunta, invitacion };
}

function lineaDescartable(texto) {
    if (/^https?:\/\//i.test(texto)) return true;
    if (/^#[\p{L}\p{N}_]+(\s+#[\p{L}\p{N}_]+)*$/u.test(texto)) return true;
    if (/^📱|^💙|^👉/.test(texto)) return true;
    if (/^¿QUÉ ES NOTICIAS\.LAT\?/i.test(texto)) return true;
    if (/^AYÚDANOS A HACER CRECER/i.test(texto)) return true;
    return false;
}

function limpiarDesarrollo(desarrollo) {
    const lineas = String(desarrollo || '').replace(/\r/g, '').replace(/\*\*/g, '').split('\n');
    const parrafos = [];
    let actual = [];
    const cerrar = () => {
        const texto = actual.join(' ').replace(/\s+/g, ' ').trim();
        if (texto && !lineaDescartable(texto) && !oracionDePrecioIncorrecto(texto) && !afirmaCifrasDelProyecto(texto)) {
            parrafos.push(texto);
        }
        actual = [];
    };
    lineas.forEach((linea) => {
        const limpia = linea.trim();
        if (!limpia) cerrar();
        else actual.push(limpia);
    });
    cerrar();
    return parrafos.join('\n\n').trim();
}

function oracionDePrecioIncorrecto(texto) {
    return /0[,.]99/.test(texto) && /(mes|miembro|membres|nivel|apoyar|suscrip)/i.test(texto);
}

function afirmaCifrasDelProyecto(texto) {
    return /noticias\.lat/i.test(texto)
        && /(millones|empleados|\d[\d.]*\s+mil\b)/i.test(texto);
}

function partirOraciones(texto) {
    const plano = String(texto || '').replace(/\s+/g, ' ').trim();
    if (!plano) return [];
    const partes = plano.split(/(?<=[.!?])\s+(?=[¿¡A-ZÁÉÍÓÚÑ0-9"“])/);
    return partes.map((parte) => parte.trim()).filter(Boolean);
}

function ajustarDesarrollo(desarrollo, presupuesto) {
    let texto = limpiarDesarrollo(desarrollo);
    if (!texto || texto.length < DESARROLLO_MINIMO) return null;
    if (texto.length <= presupuesto.objetivo + 120 && texto.length <= presupuesto.maxDuro) {
        return texto;
    }

    let parrafos = texto.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
    const medir = () => parrafos.join('\n\n').trim();

    while (parrafos.length > 1 && medir().length > presupuesto.objetivo + 120) {
        const sinUltimo = parrafos.slice(0, -1).join('\n\n').trim().length;
        if (medir().length <= presupuesto.maxSuave && sinUltimo < presupuesto.objetivo - 250) break;
        if (sinUltimo < DESARROLLO_MINIMO && medir().length <= presupuesto.maxDuro) break;
        parrafos.pop();
    }

    if (medir().length > presupuesto.maxSuave) {
        let oraciones = partirOraciones(parrafos[parrafos.length - 1]);
        while (oraciones.length > 1) {
            const prueba = parrafos.slice(0, -1).concat(oraciones.slice(0, -1).join(' ')).join('\n\n').trim();
            if (prueba.length <= presupuesto.maxSuave) {
                parrafos[parrafos.length - 1] = oraciones.slice(0, -1).join(' ');
                break;
            }
            oraciones = oraciones.slice(0, -1);
            parrafos[parrafos.length - 1] = oraciones.join(' ');
            if (medir().length <= presupuesto.maxDuro && oraciones.length === 1) break;
        }
    }

    let final = medir();
    if (final.length > presupuesto.maxDuro) {
        let oraciones = partirOraciones(final.replace(/\n+/g, ' '));
        while (oraciones.length > 1 && oraciones.join(' ').length > presupuesto.maxDuro) {
            oraciones.pop();
        }
        final = oraciones.join(' ').trim();
    }

    if (!final || final.length < DESARROLLO_MINIMO || final.length > presupuesto.maxDuro) return null;
    return final;
}

function normalizarHashtags(raw, context = {}) {
    const vistos = new Set();
    const tags = [];
    const esShort = Boolean(context.esShort);

    const agregar = (tag) => {
        let limpio = String(tag || '').trim();
        if (!limpio) return;
        if (!limpio.startsWith('#')) limpio = `#${limpio}`;
        limpio = limpio.replace(/[^\p{L}\p{N}_#]/gu, '');
        if (!/^#[\p{L}\p{N}_]{2,40}$/u.test(limpio)) return;
        const clave = limpio.toLowerCase();
        if (!esShort && (clave === '#short' || clave === '#shorts')) return;
        if (vistos.has(clave)) return;
        vistos.add(clave);
        tags.push(clave === '#noticiaslat' ? '#NoticiasLAT' : limpio);
    };

    String(raw || '').split(/[\s,]+/).forEach(agregar);
    const pais = marca.hashtagPais(context.pais);
    const categoria = marca.hashtagCategoria(context.categoria);
    if (pais) agregar(pais);
    if (categoria) agregar(categoria);
    agregar('#NoticiasLAT');

    const especificos = tags.filter((tag) => tag.toLowerCase() !== '#noticiaslat');
    return ['#NoticiasLAT', ...especificos.slice(0, 9)];
}

function palabrasClave(texto) {
    return String(texto || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .split(/[^a-z0-9]+/)
        .filter((palabra) => palabra.length >= 5 && !PALABRAS_VACIAS.has(palabra));
}

function preguntaValida(pregunta, context = {}) {
    const texto = String(pregunta || '').replace(/\s+/g, ' ').trim();
    if (texto.length < PREGUNTA_MIN || texto.length > PREGUNTA_MAX) return false;
    if (!texto.includes('?')) return false;
    const universo = new Set([
        ...palabrasClave(context.titulo),
        ...palabrasClave(String(context.articuloGenerado || context.articulo || '').slice(0, 900))
    ]);
    return palabrasClave(texto).some((palabra) => universo.has(palabra));
}

function limpiarInvitacion(invitacion) {
    const texto = String(invitacion || '').replace(/\s+/g, ' ').trim();
    if (texto.length < 20 || texto.length > 280) return '';
    if (/https?:\/\//i.test(texto) || /0[,.]99/.test(texto)) return '';
    return texto;
}

function invitacionEstable(titulo, propuesta) {
    const limpia = limpiarInvitacion(propuesta);
    if (limpia) return limpia;
    const suma = [...String(titulo || 'noticias')].reduce((total, letra) => total + letra.charCodeAt(0), 0);
    return INVITACIONES[suma % INVITACIONES.length];
}

function armarComentario({ pregunta, invitacion, enlaces, titulo, articulo }) {
    if (!preguntaValida(pregunta, { titulo, articuloGenerado: articulo })) return null;
    const cierre = invitacionEstable(titulo, invitacion);
    const texto = [
        '💬 ¡Queremos conocer tu opinión!',
        '',
        String(pregunta).replace(/\s+/g, ' ').trim(),
        '',
        cierre,
        '',
        '📱 ¿Acabas de descubrir Noticias.lat?',
        'Somos una plataforma informativa digital que crece gracias a su comunidad. No somos una empresa millonaria: trabajamos cada día para acercarte noticias y mejorar la experiencia.',
        '',
        `👉 Descarga la aplicación: ${enlaces.app}`,
        '',
        '💙 ¿Quieres ayudarnos a crecer?',
        'Puedes apoyar a Noticias.lat desde US$0.69 al mes, que corresponde al nivel Colaborador. Tu aporte ayuda a mantener los servidores, mejorar la tecnología, desarrollar nuevas herramientas y ofrecer mejores noticias.',
        '',
        'En LOS QUE AYUDAN, dentro de la web y la aplicación, reconocemos a quienes hacen posible que el proyecto siga creciendo. El reconocimiento depende del nivel de membresía y de que cada persona configure su nombre o perfil. Aliado puede aparecer en ese espacio. Impulsor recibe el reconocimiento de su nivel. Socio Fundador tiene un reconocimiento especial como fundador, además de las menciones correspondientes y el acceso al grupo de WhatsApp de socios fundadores. Colaborador también forma parte de la comunidad y recibe los beneficios de lealtad de su nivel.',
        '',
        `👉 Conviértete en miembro: ${enlaces.membresia}`,
        '',
        'Gracias por acompañarnos. ¡Bienvenido a Noticias.lat!'
    ].join('\n');

    if (texto.length > 3500) return null;
    if (/US\$\s*0[,.]99|0[,.]99\s*\$/.test(texto)) return null;
    return texto;
}

function armarPaquete({ desarrollo, hashtags, pregunta, invitacion, enlaces, titulo, articulo }) {
    const lista = normalizarHashtags(Array.isArray(hashtags) ? hashtags.join(' ') : hashtags, {
        pais: enlaces.pais,
        categoria: enlaces.categoria,
        esShort: enlaces.esShort
    });
    const lineaHashtags = lista.join(' ');
    const presupuesto = calcularPresupuesto(enlaces, lineaHashtags);
    const desarrolloAjustado = ajustarDesarrollo(desarrollo, presupuesto);
    let descripcionyt = null;

    if (desarrolloAjustado) {
        const texto = [
            bloqueNoticia(enlaces),
            desarrolloAjustado,
            bloqueIdentidad(),
            bloqueApoyo(enlaces),
            lineaHashtags
        ].join('\n\n').trim();
        if (
            texto.length <= DESCRIPCION_MAX
            && texto.startsWith('📱 NOTICIA COMPLETA Y CON MÁS DETALLES AQUÍ:')
        ) {
            descripcionyt = texto;
        }
    }

    const comentarioyt = armarComentario({ pregunta, invitacion, enlaces, titulo, articulo });
    return { descripcionyt, comentarioyt };
}

function construirPrompt(context, presupuesto) {
    const cuerpo = String(context.articuloGenerado || '').slice(0, 18000);
    const fecha = fechaLegible(context.fecha);
    const pais = marca.nombrePais(context.pais) || 'No indicado';
    return `Eres editor de Noticias.lat. Redactas a partir de la noticia completa, no solo del título.

TÍTULO: ${context.titulo}
PAÍS: ${pais}
CATEGORÍA: ${context.categoria || 'No indicada'}
FECHA CONOCIDA: ${fecha || 'No indicada. No inventes la fecha.'}
FUENTE: ${context.fuente || 'No indicada'}
RESUMEN: ${context.resumen || 'No hay resumen previo.'}
BAJADA ORIGINAL: ${context.descripcionFuente || 'No indicada.'}

NOTICIA COMPLETA:
${cuerpo}

REGLAS:
- NO inventes datos, citas, cifras, fechas, consecuencias ni declaraciones que no estén en la noticia.
- NO atribuyas a Noticias.lat cantidad de usuarios, empleados, seguidores ni una historia de origen que no esté escrita arriba.
- NO incluyas precios, enlaces, hashtags ni la presentación institucional. Eso se agrega después.
- Separa los hechos de la lectura. Si hay una implicación que no está confirmada, ponla en un párrafo final que empiece exactamente con: "Como lectura, y no como un hecho confirmado:". Si no hay base para eso, omite ese párrafo.
- No repitas frases para alargar el texto.
- Escribe en español, con nombres propios, instituciones y lugares tal como aparecen en la noticia.

LONGITUD_DESARROLLO objetivo=${presupuesto.objetivo} minimo=${presupuesto.minimo} maximo=${presupuesto.maxSuave}
El desarrollo debe quedar cerca del objetivo y nunca pasar el máximo. Cuenta espacios.

Hashtags: entre 6 y 10, específicos del hecho, el país, los protagonistas o las instituciones. No uses hashtags genéricos de moda. No incluyas #NoticiasLAT: se agrega después.

La pregunta debe hablar de este hecho concreto, invitar a opiniones distintas y terminar con signo de pregunta. La invitación es una sola frase breve para pedir comentarios.

Responde únicamente este bloque, sin borradores previos:
[===INICIO_DATOS===]
<desarrollo>
Desarrollo periodístico.
</desarrollo>
<hashtags>#EtiquetaUno #EtiquetaDos</hashtags>
<pregunta>¿Pregunta concreta sobre el hecho?</pregunta>
<invitacion>Frase breve invitando a comentar.</invitacion>
[===FIN_DATOS===]`;
}

function construirExpansion(context, desarrollo, presupuesto) {
    return `Amplía el desarrollo periodístico usando únicamente la noticia completa. NO inventes datos.
LONGITUD_DESARROLLO objetivo=${presupuesto.objetivo} minimo=${presupuesto.minimo} maximo=${presupuesto.maxSuave}

NOTICIA COMPLETA:
${String(context.articuloGenerado || '').slice(0, 18000)}

DESARROLLO ACTUAL:
${desarrollo}

Devuelve solo:
[===INICIO_DATOS===]
<desarrollo>
Desarrollo ampliado, sin repetir frases ni agregar hechos nuevos.
</desarrollo>
<hashtags></hashtags>
<pregunta></pregunta>
<invitacion></invitacion>
[===FIN_DATOS===]`;
}

function construirPregunta(context) {
    return `PREGUNTA_ANCLADA
Escribe una sola pregunta sobre este hecho, usando nombres y lugares de la noticia. No escribas otra cosa.
TÍTULO: ${context.titulo}
NOTICIA: ${String(context.articuloGenerado || '').slice(0, 4000)}
[===INICIO_DATOS===]
<desarrollo></desarrollo>
<hashtags></hashtags>
<pregunta>¿Pregunta concreta?</pregunta>
<invitacion></invitacion>
[===FIN_DATOS===]`;
}

async function generateYoutubeCopy(context = {}, deps = {}) {
    try {
        const titulo = String(context.titulo || '').trim();
        const cuerpo = String(context.articuloGenerado || '').trim();
        if (titulo.length < 8 || cuerpo.length < 80) return null;

        const generate = deps.generate || ((prompt) => require('./geminiClient').generateContentWithRetry(prompt));
        const enlaces = enlacesPara(context.articleId);
        enlaces.pais = context.pais;
        enlaces.categoria = context.categoria;
        enlaces.esShort = context.esShort;
        const presupuesto = calcularPresupuesto(enlaces, HASHTAG_ESTIMADO);

        let respuesta = await generate(construirPrompt(context, presupuesto));
        let partes = interpretarRespuesta(respuesta);
        if (!partes || !partes.desarrollo) {
            respuesta = await generate(construirPrompt(context, presupuesto));
            partes = interpretarRespuesta(respuesta);
        }
        if (!partes || !limpiarDesarrollo(partes.desarrollo)) return null;

        if (cuerpo.length >= 2200 && limpiarDesarrollo(partes.desarrollo).length < presupuesto.minimo) {
            const extra = await generate(construirExpansion(context, partes.desarrollo, presupuesto));
            const ampliado = interpretarRespuesta(extra);
            if (ampliado && limpiarDesarrollo(ampliado.desarrollo).length > limpiarDesarrollo(partes.desarrollo).length) {
                partes.desarrollo = ampliado.desarrollo;
            }
        }

        if (!preguntaValida(partes.pregunta, context)) {
            const solo = await generate(construirPregunta(context));
            const otra = interpretarRespuesta(solo);
            if (otra && preguntaValida(otra.pregunta, context)) partes.pregunta = otra.pregunta;
        }

        const paquete = armarPaquete({
            desarrollo: partes.desarrollo,
            hashtags: partes.hashtags,
            pregunta: partes.pregunta,
            invitacion: partes.invitacion,
            enlaces,
            titulo,
            articulo: cuerpo
        });
        if (!paquete.descripcionyt && !paquete.comentarioyt) return null;
        return paquete;
    } catch (error) {
        console.error(`[YouTube Copy] ${error.message}`);
        return null;
    }
}

async function attachYoutubeCopy(article, opciones = {}) {
    try {
        const copy = await generateYoutubeCopy({
            articleId: article && article._id,
            titulo: article && article.titulo,
            articuloGenerado: article && article.articuloGenerado,
            resumen: (article && article.aiSummary) || '',
            descripcionFuente: (article && article.descripcion) || '',
            fuente: (article && article.fuente) || '',
            pais: (article && article.pais) || '',
            categoria: (article && article.categoria) || '',
            fecha: article && article.fecha,
            enlaceOriginal: (article && article.enlaceOriginal) || '',
            esShort: Boolean(opciones.esShort)
        }, opciones);

        if (!copy) {
            console.warn('[YouTube Copy] No se generaron los textos nuevos. La noticia continúa sin ellos.');
            return false;
        }
        if (copy.descripcionyt && copy.descripcionyt.length <= DESCRIPCION_MAX) {
            article.descripcionyt = copy.descripcionyt;
        }
        if (copy.comentarioyt) article.comentarioyt = copy.comentarioyt;
        console.log(`[YouTube Copy] descripcionyt=${(article.descripcionyt || '').length} comentarioyt=${(article.comentarioyt || '').length}`);
        return Boolean(article.descripcionyt || article.comentarioyt);
    } catch (error) {
        console.error(`[YouTube Copy] Error no bloqueante: ${error.message}`);
        return false;
    }
}

function applyStoredYoutubeDescription(payload, article) {
    if (!payload || !article) return payload;
    const texto = typeof article.descripcionyt === 'string' ? article.descripcionyt.trim() : '';
    if (!texto || texto.length > DESCRIPCION_MAX) return payload;
    if (!texto.startsWith('📱 NOTICIA COMPLETA Y CON MÁS DETALLES AQUÍ:')) return payload;
    payload.youtube_description = texto;
    return payload;
}

module.exports = {
    DESCRIPCION_MAX,
    DESCRIPCION_OBJETIVO,
    DESCRIPCION_SUAVE,
    enlaceNoticia,
    enlacesPara,
    calcularPresupuesto,
    interpretarRespuesta,
    ajustarDesarrollo,
    normalizarHashtags,
    armarPaquete,
    construirPrompt,
    generateYoutubeCopy,
    attachYoutubeCopy,
    applyStoredYoutubeDescription,
    bloqueNoticia,
    bloqueIdentidad,
    bloqueApoyo
};
