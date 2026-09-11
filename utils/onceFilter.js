// Detecta noticias de la ONCE (Organización Nacional de Ciegos Españoles)
// para no generar JSON ni enviarlas a los bots de YouTube (web sí se publica).

function collectText(item) {
    if (!item) return '';
    if (typeof item === 'string') return item;
    const source = item.source && (item.source.name || item.source);
    return [
        item.titulo,
        item.title,
        item.descripcion,
        item.description,
        item.articuloGenerado,
        item.enlaceOriginal,
        item.url,
        item.fuente,
        source,
        item.sitio
    ].filter(Boolean).join('\n');
}

function isOnceNews(item) {
    const raw = collectText(item);
    if (!raw) return false;

    // Siglas tal cual aparecen en titulares: "ONCE"
    if (/\bONCE\b/.test(raw)) return true;

    const text = raw
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');

    const patterns = [
        /\borganizacion nacional de ciegos\b/,
        /\bciegos espanoles\b/,
        /\bonce\.es\b/,
        /\bjuegosonce\b/,
        /\bla once\b/,
        /\bde la once\b/,
        /\btriplex\b/,
        /\bcuponazo\b/,
        /\bsueldazo\b/,
        /\bsuper\s*once\b/,
        /\bcupon(?:es)? diario\b/,
        /\bcupon de la once\b/,
        /\bsorteo(?:s)? (?:de |del )?(?:la )?once\b/,
        /\bsorteo(?:s)? del 11\b/,
        /\bsorteo(?:s)? de las 11\b/,
        /\bel 11 de la once\b/
    ];

    return patterns.some((re) => re.test(text));
}

module.exports = { isOnceNews };
