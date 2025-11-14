const mongoose = require('mongoose');
const Article = require('../models/article');

// --- ¡NUEVO MAPA INTELIGENTE! ---
// Mapea términos de búsqueda a códigos de país
const paisTermMap = {
    "argentina": "ar", "bolivia": "bo", "brasil": "br", "chile": "cl", 
    "colombia": "co", "costa rica": "cr", "cuba": "cu", "ecuador": "ec", 
    "el salvador": "sv", "guatemala": "gt", "honduras": "hn", "mexico": "mx", 
    "nicaragua": "ni", "panama": "pa", "paraguay": "py", "peru": "pe", 
    "dominicana": "do", "uruguay": "uy", "venezuela": "ve",
    // También puedes añadir los códigos por si los escriben
    "ar": "ar", "bo": "bo", "br": "br", "cl": "cl", "co": "co", "cr": "cr", 
    "cu": "cu", "ec": "ec", "sv": "sv", "gt": "gt", "hn": "hn", "mx": "mx", 
    "ni": "ni", "pa": "pa", "py": "py", "pe": "pe", "do": "do", "uy": "uy", "ve": "ve"
};

/**
 * [PÚBLICO] Obtener LISTA de artículos
 * --- ¡VERSIÓN SÚPER INTELIGENTE (v2)! ---
 */
exports.getArticles = async (req, res) => {
    try {
        const { sitio, categoria, limite, pagina, videoStatus } = req.query; // ¡'videoStatus' AÑADIDO!
        
        // Obtenemos los filtros de búsqueda
        let queryTexto = req.query.query || null;
        let paisFiltro = req.query.pais || null; // ej: "py"

        if (!sitio) {
            return res.status(400).json({ error: "El parámetro 'sitio' es obligatorio." });
        }
        
        const limiteNum = parseInt(limite) || 12;
        const paginaNum = parseInt(pagina) || 1;
        const skip = (paginaNum - 1) * limiteNum;
        
        let filtro = { sitio: sitio };
        let sort = { fecha: -1 }; 
        let projection = {};      

        // --- ¡¡LÓGICA DE BÚSQUEDA!! ---
        
        // 1. ANÁLISIS DE PAÍS:
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
        
        // 2. CONSTRUCCIÓN DEL FILTRO DE MONGO:
        
        // A. Añadir filtro de PAÍS
        if (paisFiltro) {
            filtro.pais = paisFiltro;
        }

        // B. Añadir filtro de TEXTO
        if (queryTexto && queryTexto.trim() !== '') {
            filtro.$text = { $search: queryTexto };
            sort = { score: { $meta: "textScore" } }; 
            projection = { score: { $meta: "textScore" } }; 
        }
        
        // C. Añadir filtro de CATEGORÍA
        if (!queryTexto && !paisFiltro && categoria && categoria !== 'todos') {
            filtro.categoria = categoria;
        }

        // --- ¡¡NUEVA LÓGICA DE VIDEO!! ---
        // D. Añadir filtro de ESTADO DE VIDEO (para staging)
        if (videoStatus === 'complete_or_pending') {
            // Devuelve artículos que SÍ tienen video O artículos de solo texto (pending)
            filtro.$or = [
                { videoProcessingStatus: 'complete' },
                { videoProcessingStatus: 'pending' }
            ];
        } else if (videoStatus === 'complete') {
            // Devuelve SÓLO artículos con video (para el feed)
            filtro.videoProcessingStatus = 'complete';
        }
        // Si 'videoStatus' no se envía, no se filtra por estado (comportamiento normal)
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
 * (Sin cambios)
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
        // Para que solo recomiende artículos con video o de texto
        filtro.$or = [
            { videoProcessingStatus: 'complete' },
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


// --- ¡NUEVA FUNCIÓN AÑADIDA AL FINAL! ---

/**
 * [PRIVADO] Lo llama el Worker de Medios (tts-fmpeg) cuando un video está listo.
 */
exports.handleVideoComplete = async (req, res) => {
    const { articleId, videoUrl, error } = req.body;

    if (!articleId) {
        return res.status(400).json({ error: "Falta articleId" });
    }

    try {
        let updateData = {};
        if (error) {
            // Si el worker reporta un error
            console.error(`[API] El Worker reportó un fallo para ${articleId}: ${error}`);
            updateData = { videoProcessingStatus: 'failed' };
        } else if (videoUrl) {
            // Si el worker reporta éxito
            console.log(`[API] Video completado para ${articleId}. URL: ${videoUrl}`);
            updateData = { 
                videoProcessingStatus: 'complete',
                videoUrl: videoUrl
            };
        } else {
            return res.status(400).json({ error: "Falta videoUrl o error en la petición" });
        }

        // Actualiza el artículo en la Base de Datos
        const updatedArticle = await Article.findByIdAndUpdate(
            articleId,
            { $set: updateData },
            { new: true } // Devuelve el documento actualizado
        );

        if (!updatedArticle) {
            return res.status(404).json({ error: "Artículo no encontrado para actualizar." });
        }

        // Responde al worker que todo salió bien
        res.json({ success: true, articleId: updatedArticle._id, status: updatedArticle.videoProcessingStatus });

    } catch (dbError) {
        console.error("Error en handleVideoComplete (DB):", dbError);
        res.status(500).json({ error: "Error interno del servidor al actualizar." });
    }
};