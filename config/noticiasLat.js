// Enlaces y datos institucionales de Noticias.lat.
// Las URLs por defecto están verificadas en la web, Google Play y YouTube.
// Se pueden reemplazar con variables de entorno si más adelante hay una página oficial nueva.

function leerUrl(nombre) {
    const valor = process.env[nombre];
    if (typeof valor !== 'string') return '';
    const limpio = valor.trim();
    return /^https:\/\/\S+$/i.test(limpio) ? limpio : '';
}

const PAISES = {
    ar: 'Argentina',
    bo: 'Bolivia',
    br: 'Brasil',
    cl: 'Chile',
    co: 'Colombia',
    cr: 'Costa Rica',
    cu: 'Cuba',
    ec: 'Ecuador',
    sv: 'El Salvador',
    gt: 'Guatemala',
    hn: 'Honduras',
    mx: 'México',
    ni: 'Nicaragua',
    pa: 'Panamá',
    py: 'Paraguay',
    pe: 'Perú',
    do: 'República Dominicana',
    uy: 'Uruguay',
    ve: 'Venezuela'
};

const CATEGORIAS = {
    politica: 'Politica',
    economia: 'Economia',
    deportes: 'Deportes',
    tecnologia: 'Tecnologia',
    entretenimiento: 'Entretenimiento',
    salud: 'Salud',
    internacional: 'Internacional'
};

// El piso real es Colaborador (US$0.69 al mes). No existe un nivel de US$0.99.
const NIVELES = [
    {
        nombre: 'Colaborador',
        precioUsd: 0.69,
        reconocimiento: 'Forma parte de la comunidad y recibe los beneficios de lealtad de su nivel.'
    },
    {
        nombre: 'Aliado',
        precioUsd: 2.79,
        reconocimiento: 'Su nombre podrá aparecer en Los que ayudan si configura su nombre o perfil.'
    },
    {
        nombre: 'Impulsor',
        precioUsd: 5.49,
        reconocimiento: 'Recibe un reconocimiento correspondiente a su nivel.'
    },
    {
        nombre: 'Socio Fundador',
        precioUsd: 9.99,
        reconocimiento: 'Reconocimiento especial como fundador, menciones correspondientes y acceso al grupo de WhatsApp de socios fundadores.'
    }
];

function hashtagDesdeNombre(nombre) {
    if (!nombre) return null;
    const compacto = nombre
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^A-Za-z0-9]/g, '');
    return compacto ? `#${compacto}` : null;
}

function hashtagPais(codigo) {
    return hashtagDesdeNombre(PAISES[String(codigo || '').toLowerCase()]);
}

function hashtagCategoria(categoria) {
    return hashtagDesdeNombre(CATEGORIAS[String(categoria || '').toLowerCase()]);
}

function nombrePais(codigo) {
    return PAISES[String(codigo || '').toLowerCase()] || '';
}

const webOrigin = (leerUrl('NOTICIAS_LAT_WEB_ORIGIN') || 'https://www.noticias.lat').replace(/\/+$/, '');

module.exports = {
    webOrigin,
    playStoreUrl: leerUrl('NOTICIAS_LAT_PLAY_STORE_URL') || 'https://play.google.com/store/apps/details?id=com.noticiaslat.app',
    // Canal principal. Los otros tres también tienen página /join; el bot elige el canal al publicar.
    membershipUrl: leerUrl('NOTICIAS_LAT_MEMBERSHIP_URL') || 'https://www.youtube.com/@noticias-lat/join',
    // No hay una URL pública verificada de "Los que ayudan". Vacío hasta que exista.
    losQueAyudanUrl: leerUrl('NOTICIAS_LAT_LOS_QUE_AYUDAN_URL') || '',
    canalesYoutube: [
        { id: 0, nombre: 'Noticias LAT', membresia: 'https://www.youtube.com/@noticias-lat/join' },
        { id: 1, nombre: 'Noticias LAT | Última Hora', membresia: 'https://www.youtube.com/@NoticiasLat1/join' },
        { id: 2, nombre: 'Noticias LAT | AHORA', membresia: 'https://www.youtube.com/@NoticiasLat-2/join' },
        { id: 3, nombre: 'Noticias LAT | HOY', membresia: 'https://www.youtube.com/@Noticiaslat-3/join' }
    ],
    niveles: NIVELES,
    precioDesde: 'US$0.69',
    hashtagPais,
    hashtagCategoria,
    nombrePais
};
