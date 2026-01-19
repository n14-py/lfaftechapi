const Article = require('../models/article');

// Configuración
const DOMAIN = 'https://www.noticias.lat'; 
const URLS_PER_SITEMAP = 5000; // Grupos de 5000 para cargar rápido

// 1. ÍNDICE MAESTRO (El que le das a Google)
exports.getSitemapIndex = async (req, res) => {
    try {
        // Contamos cuántos artículos de noticias.lat hay en total
        const totalArticles = await Article.countDocuments({ sitio: 'noticias.lat' });
        
        // Calculamos cuántos archivos hijos necesitamos
        const totalPages = Math.ceil(totalArticles / URLS_PER_SITEMAP) || 1;

        let xml = `<?xml version="1.0" encoding="UTF-8"?>
        <sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`;

        // Agregamos el sitemap estático
        xml += `
        <sitemap>
            <loc>${DOMAIN}/api/sitemap-static.xml</loc>
        </sitemap>`;

        // Agregamos los sitemaps de noticias dinámicos (1, 2, 3...)
        for (let i = 1; i <= totalPages; i++) {
            xml += `
            <sitemap>
                <loc>${DOMAIN}/api/sitemap-noticias-${i}.xml</loc>
            </sitemap>`;
        }

        xml += `</sitemapindex>`;

        res.header('Content-Type', 'application/xml');
        res.status(200).send(xml);

    } catch (error) {
        console.error('Error Sitemap Index:', error);
        res.status(500).send('Error generando índice');
    }
};

// 2. SITEMAP ESTÁTICO (Páginas Fijas)
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
    
    // Categorías (hardcoded o dinámicas si prefieres)
    const categories = ['politica', 'economia', 'deportes', 'tecnologia', 'entretenimiento', 'salud', 'internacional'];

    let xml = `<?xml version="1.0" encoding="UTF-8"?>
    <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`;

    staticUrls.forEach(url => {
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

    res.header('Content-Type', 'application/xml');
    res.status(200).send(xml);
};

// 3. SITEMAP DE NOTICIAS (Hijos Paginados)
exports.getNewsSitemap = async (req, res) => {
    try {
        const page = parseInt(req.params.page) || 1;
        const skip = (page - 1) * URLS_PER_SITEMAP;

        // Búsqueda optimizada (solo id y fecha) + lean()
        const articles = await Article.find({ sitio: 'noticias.lat' })
            .select('_id fecha updatedAt')
            .sort({ fecha: -1 })
            .skip(skip)
            .limit(URLS_PER_SITEMAP)
            .lean();

        let xml = `<?xml version="1.0" encoding="UTF-8"?>
        <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`;

        articles.forEach(article => {
            const date = article.updatedAt || article.fecha || new Date();
            xml += `
            <url>
                <loc>${DOMAIN}/articulo/${article._id}</loc>
                <lastmod>${new Date(date).toISOString()}</lastmod>
                <changefreq>never</changefreq>
                <priority>0.7</priority>
            </url>`;
        });

        xml += `</urlset>`;

        res.header('Content-Type', 'application/xml');
        res.status(200).send(xml);

    } catch (error) {
        console.error(`Error Sitemap Noticias Pag ${req.params.page}:`, error);
        res.status(500).send('Error generando sitemap');
    }
};