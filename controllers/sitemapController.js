const Article = require('../models/article');

// Configuración (Forzamos sin 'www' para asegurar la URL canónica y evitar desindexación por duplicidad)
const DOMAIN = 'https://noticias.lat'; 
const URLS_PER_SITEMAP = 5000;

// 1. ÍNDICE MAESTRO
exports.getSitemapIndex = async (req, res) => {
    try {
        // Cache de 24 horas exigido
        res.header('Cache-Control', 'public, max-age=86400, s-maxage=86400, stale-while-revalidate=86400');
        res.header('Content-Type', 'application/xml');

        const totalArticles = await Article.countDocuments({ sitio: 'noticias.lat' });
        const totalPages = Math.ceil(totalArticles / URLS_PER_SITEMAP) || 1;

        let xml = `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`;
        
        xml += `\n  <sitemap>\n    <loc>${DOMAIN}/sitemap-static.xml</loc>\n  </sitemap>`;
        xml += `\n  <sitemap>\n    <loc>${DOMAIN}/sitemap-video.xml</loc>\n  </sitemap>`;

        for (let i = 1; i <= totalPages; i++) {
            xml += `\n  <sitemap>\n    <loc>${DOMAIN}/sitemap-noticias-${i}.xml</loc>\n  </sitemap>`;
        }

        xml += `\n</sitemapindex>`;
        res.status(200).send(xml);
    } catch (error) {
        console.error('Error Sitemap Index:', error);
        res.status(500).send('Error generando índice');
    }
};

// 2. SITEMAP ESTÁTICO
exports.getStaticSitemap = (req, res) => {
    // Cache de 24 horas
    res.header('Cache-Control', 'public, max-age=86400, s-maxage=86400, stale-while-revalidate=86400');
    res.header('Content-Type', 'application/xml');

    const staticUrls = [
        '',
        '/radios',
        '/radios?tab=podcasts',
        '/juegos',
        '/feed',
        '/sobre-nosotros',
        '/contacto',
        '/politica-privacidad',
        '/terminos'
    ];
    
    const categories = ['politica', 'economia', 'deportes', 'tecnologia', 'entretenimiento', 'salud', 'internacional'];
    const today = new Date().toISOString();

    let xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`;

    staticUrls.forEach(url => {
        xml += `\n  <url>\n    <loc>${DOMAIN}${url}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>daily</changefreq>\n    <priority>1.0</priority>\n  </url>`;
    });

    categories.forEach(cat => {
        xml += `\n  <url>\n    <loc>${DOMAIN}/?categoria=${cat}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>hourly</changefreq>\n    <priority>0.9</priority>\n  </url>`;
    });

    xml += `\n</urlset>`;
    res.status(200).send(xml);
};

// 3. SITEMAP DE NOTICIAS
exports.getNewsSitemap = async (req, res) => {
    try {
        // Cache de 24 horas
        res.header('Cache-Control', 'public, max-age=86400, s-maxage=86400, stale-while-revalidate=86400');
        res.header('Content-Type', 'application/xml');

        const page = parseInt(req.params.page) || 1;
        const skip = (page - 1) * URLS_PER_SITEMAP;

        const articles = await Article.find({ sitio: 'noticias.lat' })
            .select('_id fecha updatedAt') 
            .sort({ fecha: -1 })
            .skip(skip)
            .limit(URLS_PER_SITEMAP)
            .lean();

        let xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`;

        articles.forEach(article => {
            const date = article.updatedAt || article.fecha || new Date();
            let validDate;
            try {
                validDate = new Date(date).toISOString();
            } catch (e) {
                validDate = new Date().toISOString();
            }

            xml += `\n  <url>\n    <loc>${DOMAIN}/articulo/${article._id}</loc>\n    <lastmod>${validDate}</lastmod>\n    <changefreq>monthly</changefreq>\n    <priority>0.7</priority>\n  </url>`;
        });

        xml += `\n</urlset>`;
        res.status(200).send(xml);
    } catch (error) {
        console.error(`Error Sitemap Noticias Pag ${req.params.page}:`, error);
        res.status(500).send('Error generando sitemap');
    }
};

// 4. SITEMAP DE VIDEOS (NUEVO)
exports.getVideoSitemap = async (req, res) => {
    try {
        // Cache de 24 horas
        res.header('Cache-Control', 'public, max-age=86400, s-maxage=86400, stale-while-revalidate=86400');
        res.header('Content-Type', 'application/xml');
        
        // Extraemos artículos que obligatoriamente tengan video de YouTube completado
        const articles = await Article.find({ 
            sitio: 'noticias.lat', 
            videoProcessingStatus: 'complete',
            youtubeId: { $ne: null }
        })
        .select('_id titulo descripcion fecha youtubeId')
        .sort({ fecha: -1 })
        .limit(1000)
        .lean();
        
        let xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">`;
        
        articles.forEach(article => {
            const validDate = new Date(article.fecha || new Date()).toISOString();
            
            // Limpieza de caracteres especiales para evitar romper el XML
            const desc = article.descripcion ? article.descripcion.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') : 'Noticia en video';
            const title = article.titulo ? article.titulo.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') : 'Video';

            xml += `\n  <url>
    <loc>${DOMAIN}/articulo/${article._id}</loc>
    <video:video>
      <video:thumbnail_loc>https://i.ytimg.com/vi/${article.youtubeId}/hqdefault.jpg</video:thumbnail_loc>
      <video:title>${title}</video:title>
      <video:description>${desc}</video:description>
      <video:player_loc>https://www.youtube.com/embed/${article.youtubeId}</video:player_loc>
      <video:publication_date>${validDate}</video:publication_date>
      <video:family_friendly>yes</video:family_friendly>
    </video:video>
  </url>`;
        });
        
        xml += `\n</urlset>`;
        res.status(200).send(xml);
    } catch (error) {
        console.error('Error Sitemap Videos:', error);
        res.status(500).send('Error generando sitemap de videos');
    }
};