const mongoose = require('mongoose');
const Article = require('../models/article');

// --- ¡NUEVO MAPA INTELIGENTE! ---
// (Esta parte no cambia)
const paisTermMap = {
    "argentina": "ar", "bolivia": "bo", "brasil": "br", "chile": "cl", 
    "colombia": "co", "costa rica": "cr", "cuba": "cu", "ecuador": "ec", 
    "el salvador": "sv", "guatemala": "gt", "honduras": "hn", "mexico": "mx", 
    "nicaragua": "ni", "panama": "pa", "paraguay": "py", "peru": "pe", 
    "dominicana": "do", "uruguay": "uy", "venezuela": "ve",
    "ar": "ar", "bo": "bo", "br": "br", "cl": "cl", "co": "co", "cr": "cr", 
    "cu": "cu", "ec": "ec", "sv": "sv", "gt": "gt", "hn": "hn", "mx": "mx", 
    "ni": "ni", "pa": "pa", "py": "py", "pe": "pe", "do": "do", "uy": "uy", "ve": "ve"
};

/**
 * [PÚBLICO] Obtener LISTA de artículos
 * (Esta parte no cambia)
 */
exports.getArticles = async (req, res) => {
    try {
        const { sitio, categoria, limite, pagina, videoStatus } = req.query;
        
        let queryTexto = req.query.query || null;
        let paisFiltro = req.query.pais || null;

        if (!sitio) {
            return res.status(400).json({ error: "El parámetro 'sitio' es obligatorio." });
        }
        
        const limiteNum = parseInt(limite) || 12;
        const paginaNum = parseInt(pagina) || 1;
        const skip = (paginaNum - 1) * limiteNum;
        
        let filtro = { sitio: sitio };
        let sort = { fecha: -1 }; 
        let projection = {};      

        // --- LÓGICA DE BÚSQUEDA (Sin cambios) ---
        if (queryTexto && !paisFiltro) {
            const queryPalabras = queryTexto.toLowerCase().split(' ');
            let paisEncontrado = null;
            for (const palabra of queryPalabras) {
                if (paisTermMap[palabra]) {
                    paisEncontrado = paisTermMap[palabra];
                    break;
                }
            }
            if (paisEncontrado) {
                paisFiltro = paisEncontrado; 
                queryTexto = queryPalabras.filter(p => !paisTermMap[p]).join(' ');
            }
        }
        
        // --- CONSTRUCCIÓN DEL FILTRO DE MONGO (Sin cambios) ---
        if (paisFiltro) filtro.pais = paisFiltro;
        if (queryTexto && queryTexto.trim() !== '') {
            filtro.$text = { $search: queryTexto };
            sort = { score: { $meta: "textScore" } }; 
            projection = { score: { $meta: "textScore" } }; 
        }
        if (!queryTexto && !paisFiltro && categoria && categoria !== 'todos') {
            filtro.categoria = categoria;
        }

        // --- ¡LÓGICA DE VIDEO MODIFICADA! ---
        // Ahora 'complete_or_pending' busca videos listos en Ezoic O videos en cualquier
        // estado previo (pending, processing, pending_ezoic_import)
        if (videoStatus === 'complete_or_pending') {
            filtro.$or = [
                { videoProcessingStatus: 'complete' }, // ¡Video listo en Ezoic!
                { videoProcessingStatus: 'pending' },  // Artículo de solo texto
                { videoProcessingStatus: 'processing' }, // Video generándose
                { videoProcessingStatus: 'pending_ezoic_import' } // Video en Cloudinary, esperando a Ezoic
            ];
        } else if (videoStatus === 'complete') {
            // Devuelve SÓLO artículos con video de Ezoic (para el feed)
            filtro.videoProcessingStatus = 'complete';
        }
        // --- FIN DE LÓGICA DE VIDEO ---

        const articles = await Article.find(filtro, projection).sort(sort).skip(skip).limit(limiteNum);
        const total = await Article.countDocuments(filtro);

        res.json({
            totalArticulos: total,
            totalPaginas: Math.ceil(total / limiteNum),
            paginaActual: paginaNum,
            articulos: articles
        });
    } catch (error) {
        console.error("Error en getArticles:", error);
        res.status(500).json({ error: "Error interno del servidor." });
    }
};

/**
 * [PÚBLICO] Obtener UN solo artículo por su ID
 * (Sin cambios)
 */
exports.getArticleById = async (req, res) => {
    try {
        const articleId = req.params.id;
        if (!mongoose.Types.ObjectId.isValid(articleId)) {
            return res.status(400).json({ error: "ID de artículo no válido." });
        }
        
        const article = await Article.findById(articleId);
        if (!article) {
            return res.status(404).json({ error: "Artículo no encontrado." });
        }
        res.json(article);
    } catch (error) {
        console.error("Error en getArticleById:", error);
        res.status(500).json({ error: "Error interno del servidor." });
    }
};

/**
 * [PÚBLICO] Obtener artículos RECOMENDADOS
 * (Lógica de video actualizada para incluir todos los estados)
 */
exports.getRecommendedArticles = async (req, res) => {
    try {
        const { sitio, categoria, excludeId } = req.query;
        if (!sitio || !categoria) {
            return res.status(400).json({ error: "Parámetros 'sitio' y 'categoria' son obligatorios." });
        }

        let filtro = { 
            sitio: sitio, 
            categoria: categoria,
            _id: { $ne: excludeId } 
        };
        
        // ¡CAMBIO! AÑADIMOS FILTRO DE VIDEO AQUÍ TAMBIÉN
        // Para que solo recomiende artículos que ya tengan video o estén en proceso
        filtro.$or = [
            { videoProcessingStatus: 'complete' },
            { videoProcessingStatus: 'pending_ezoic_import' },
            { videoProcessingStatus: 'pending' }
        ];

        const randomSkip = Math.floor(Math.random() * 20);
        
        const recommended = await Article.find(filtro)
            .sort({ fecha: -1 })
            .skip(randomSkip)
            .limit(4); 

        res.json(recommended);

    } catch (error) {
        console.error("Error en getRecommendedArticles:", error);
        res.status(500).json({ error: "Error interno del servidor." });
    }
};


/**
 * [PÚBLICO] Generar el Sitemap.xml
 * (Sin cambios)
 */
exports.getSitemap = async (req, res) => {
    const BASE_URL = 'https://noticias.lat'; 
    try {
        const articles = await Article.find({ sitio: 'noticias.lat' }) 
            .sort({ fecha: -1 })
            .select('_id fecha');
        
        let xml = '<?xml version="1.0" encoding="UTF-8"?>';
        xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">';
        const staticPages = [
            { loc: '', priority: '1.00', changefreq: 'daily' }, 
            { loc: 'sobre-nosotros', priority: '0.80', changefreq: 'monthly' },
            { loc: 'contacto', priority: '0.80', changefreq: 'monthly' },
            { loc: 'politica-privacidad', priority: '0.50', changefreq: 'yearly' },
            { loc: 'terminos', priority: '0.50', changefreq: 'yearly' },
        ];
        staticPages.forEach(page => {
            xml += '<url>';
            xml += `<loc>${BASE_URL}/${page.loc}</loc>`;
            xml += `<priority>${page.priority}</priority>`;
            xml += `<changefreq>${page.changefreq}</changefreq>`;
            xml += '</url>';
        });
        articles.forEach(article => {
            const articleDate = new Date(article.fecha).toISOString().split('T')[0];
            xml += '<url>';
            xml += `<loc>${BASE_URL}/articulo/${article._id}</loc>`;
            xml += `<lastmod>${articleDate}</lastmod>`;
            xml += '<changefreq>weekly</changefreq>';
            xml += '<priority>0.90</priority>';
            xml += '</url>';
        });
        xml += '</urlset>';
        res.header('Content-Type', 'application/xml');
        res.send(xml);
    } catch (error) {
        console.error("Error en getSitemap:", error);
        res.status(500).json({ error: "Error interno del servidor." });
    }
};


/**
 * [PRIVADO] Lo llama el Worker de Medios (tts-fmpeg)
 * (Esta es la versión que modificamos en el paso anterior)
 */
exports.handleVideoComplete = async (req, res) => {
    const { articleId, cloudinary_url, miniatura_url, error } = req.body;

    if (!articleId) {
        return res.status(400).json({ error: "Falta articleId" });
    }

    try {
        let updateData = {};
        if (error) {
            console.error(`[API] El Worker reportó un fallo para ${articleId}: ${error}`);
            updateData = { videoProcessingStatus: 'failed' };
        } else if (cloudinary_url) {
            console.log(`[API] Video subido a Cloudinary para ${articleId}.`);
            console.log(`[API] URL Cloudinary: ${cloudinary_url}`);
            
            updateData = { 
                videoProcessingStatus: 'pending_ezoic_import', 
                cloudinary_url: cloudinary_url,              
                imagen: miniatura_url || undefined         
            };
        } else {
            return res.status(400).json({ error: "Falta cloudinary_url o error en la petición" });
        }

        const updatedArticle = await Article.findByIdAndUpdate(
            articleId,
            { $set: updateData },
            { new: true }
        );

        if (!updatedArticle) {
            return res.status(404).json({ error: "Artículo no encontrado para actualizar." });
        }
        res.json({ success: true, articleId: updatedArticle._id, status: updatedArticle.videoProcessingStatus });

    } catch (dbError) {
        console.error("Error en handleVideoComplete (DB):", dbError);
        res.status(500).json({ error: "Error interno del servidor al actualizar." });
    }
};


/**
 * ==========================================================
 * --- ¡NUEVA FUNCIÓN AÑADIDA AL FINAL! ---
 * ==========================================================
 * * [PÚBLICO] Generar el feed MRSS.xml para Ezoic
 * Ezoic leerá esta URL para importar videos.
 */
exports.getMRSSFeed = async (req, res) => {
    // ¡IMPORTANTE! Esta URL debe ser la de tu sitio de PRODUCCIÓN.
    const BASE_URL = 'https://www.noticias.lat'; 

    try {
        // Buscamos artículos que:
        // 1. Estén en Cloudinary (pending_ezoic_import)
        // 2. O ya estén completos en Ezoic (complete)
        const articles = await Article.find({
            sitio: 'noticias.lat',
            videoProcessingStatus: { $in: ['pending_ezoic_import', 'complete'] },
            cloudinary_url: { $exists: true, $ne: null, $ne: "" } // Asegura que tengamos una URL de video
        })
        .sort({ fecha: -1 })
        .limit(100); // Limita a los 100 más recientes por eficiencia

        let xml = '<?xml version="1.0" encoding="UTF-8"?>';
        xml += '<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/">';
        xml += '<channel>';
        xml += '<title>Noticias.lat Videos</title>';
        xml += `<link>${BASE_URL}</link>`;
        xml += '<description>Videos de noticias generados por IA para Noticias.lat</description>';

        articles.forEach(article => {
            // Usamos un ID único para el GUID
            const guid = `${BASE_URL}/articulo/${article._id}`;
            // Formateamos la fecha a RFC 822 (requerido por MRSS)
            const pubDate = new Date(article.fecha).toUTCString();
            
            // Limpiamos el título y la descripción para XML
            const cleanTitle = article.titulo.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            const cleanDescription = (article.descripcion.substring(0, 250) + '...').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

            xml += '<item>';
            xml += `<title>${cleanTitle}</title>`;
            xml += `<link>${guid}</link>`;
            xml += `<guid isPermaLink="true">${guid}</guid>`;
            xml += `<pubDate>${pubDate}</pubDate>`;
            xml += `<description>${cleanDescription}</description>`;
            
            // --- El bloque de Media ---
            // Esta es la URL que Ezoic usará para descargar tu video
            xml += `<media:content 
                        url="${article.cloudinary_url}" 
                        type="video/mp4" 
                        medium="video" 
                     />`;
            
            // Esta es la miniatura que Ezoic usará
            xml += `<media:thumbnail url="${article.imagen}" />`;
            xml += `<media:keywords>${article.categoria}</media:keywords>`;
            xml += '</item>';
        });

        xml += '</channel>';
        xml += '</rss>';

        res.header('Content-Type', 'application/xml');
        res.send(xml);

    } catch (error) {
        console.error("Error en getMRSSFeed:", error);
        res.status(500).json({ error: "Error interno del servidor al generar feed MRSS." });
    }
};