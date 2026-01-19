const Article = require('../models/article'); //

// Configuración
const DOMAIN = 'https://www.noticias.lat'; 
const URLS_PER_SITEMAP = 5000;

// 1. ÍNDICE MAESTRO
exports.getSitemapIndex = async (req, res) => {
    try {
        const totalArticles = await Article.countDocuments({ sitio: 'noticias.lat' });
        const totalPages = Math.ceil(totalArticles / URLS_PER_SITEMAP) || 1;

        let xml = `<?xml version="1.0" encoding="UTF-8"?>
        <sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`;

        // CORRECCIÓN: Quitamos "/api" de aquí. La URL pública será limpia.
        xml += `
        <sitemap>
            <loc>${DOMAIN}/sitemap-static.xml</loc>
        </sitemap>`;

        for (let i = 1; i <= totalPages; i++) {
            // CORRECCIÓN: Quitamos "/api" de aquí también.
            xml += `
            <sitemap>
                <loc>${DOMAIN}/sitemap-noticias-${i}.xml</loc>
            </sitemap>`;
        }

        xml += `</sitemapindex>`;

        res.header('Content-Type', 'text/xml'); // Cambiado a text/xml para mejor compatibilidad
        res.status(200).send(xml);

    } catch (error) {
        console.error('Error Sitemap Index:', error);
        res.status(500).send('Error generando índice');
    }
};

// 2. SITEMAP ESTÁTICO
exports.getStaticSitemap = (req, res) => {
    const staticUrls = [
        '',
        '/radios',
        '/feed',
        '/sobre-nosotros',
        '/contacto',
        '/politica-privacidad',
        '/terminos'
    ];
    
    // Categorías
    const categories = ['politica', 'economia', 'deportes', 'tecnologia', 'entretenimiento', 'salud', 'internacional'];

    let xml = `<?xml version="1.0" encoding="UTF-8"?>
    <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`;

    staticUrls.forEach(url => {
        // Aquí ya estaba bien, usa DOMAIN + url (ej: noticias.lat/radios)
        xml += `
        <url>
            <loc>${DOMAIN}${url}</loc>
            <changefreq>daily</changefreq>
            <priority>1.0</priority>
        </url>`;
    });

    categories.forEach(cat => {
        xml += `
        <url>
            <loc>${DOMAIN}/?categoria=${cat}</loc>
            <changefreq>hourly</changefreq>
            <priority>0.9</priority>
        </url>`;
    });

    xml += `</urlset>`;

    res.header('Content-Type', 'text/xml');
    res.status(200).send(xml);
};

// 3. SITEMAP DE NOTICIAS
exports.getNewsSitemap = async (req, res) => {
    try {
        const page = parseInt(req.params.page) || 1;
        const skip = (page - 1) * URLS_PER_SITEMAP;

        const articles = await Article.find({ sitio: 'noticias.lat' })
            .select('_id fecha updatedAt') //
            .sort({ fecha: -1 })
            .skip(skip)
            .limit(URLS_PER_SITEMAP)
            .lean();

        let xml = `<?xml version="1.0" encoding="UTF-8"?>
        <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`;

        articles.forEach(article => {
            const date = article.updatedAt || article.fecha || new Date();
            // Aquí ya estaba bien, apunta a la noticia limpia
            xml += `
            <url>
                <loc>${DOMAIN}/articulo/${article._id}</loc>
                <lastmod>${new Date(date).toISOString()}</lastmod>
                <changefreq>never</changefreq>
                <priority>0.7</priority>
            </url>`;
        });

        xml += `</urlset>`;

        res.header('Content-Type', 'text/xml');
        res.status(200).send(xml);

    } catch (error) {
        console.error(`Error Sitemap Noticias Pag ${req.params.page}:`, error);
        res.status(500).send('Error generando sitemap');
    }
};