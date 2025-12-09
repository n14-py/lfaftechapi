// Archivo: lfaftechapi/controllers/articleController.js
// --- VERSIÓN: CALLBACK QUE DETONA TELEGRAM ---

const mongoose = require('mongoose');
const Article = require('../models/article');
const { publicarUnArticulo } = require('../utils/telegramBot'); // <--- IMPORTANTE: Importamos esto aquí

// Mapeo inteligente de países para búsqueda
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
 * [PÚBLICO] Obtener LISTA de artículos (Búsqueda inteligente)
 */
exports.getArticles = async (req, res) => {
    try {
        const { sitio, categoria, limite, pagina } = req.query;
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

        // LÓGICA DE BÚSQUEDA INTELIGENTE
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
        
        if (paisFiltro) filtro.pais = paisFiltro;

        if (queryTexto && queryTexto.trim() !== '') {
            filtro.$text = { $search: queryTexto };
            sort = { score: { $meta: "textScore" } }; 
            projection = { score: { $meta: "textScore" } }; 
        } else if (categoria && categoria !== 'todos') {
            filtro.categoria = categoria;
        }

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
 * [PÚBLICO] Obtener UN solo artículo
 */
exports.getArticleById = async (req, res) => {
    try {
        const articleId = req.params.id;
        if (!mongoose.Types.ObjectId.isValid(articleId)) return res.status(400).json({ error: "ID inválido." });
        
        const article = await Article.findById(articleId);
        if (!article) return res.status(404).json({ error: "Artículo no encontrado." });
        
        res.json(article);
    } catch (error) {
        console.error("Error en getArticleById:", error);
        res.status(500).json({ error: "Error interno." });
    }
};

/**
 * [PÚBLICO] Recomendados
 */
exports.getRecommendedArticles = async (req, res) => {
    try {
        const { sitio, categoria, excludeId } = req.query;
        if (!sitio || !categoria) return res.status(400).json({ error: "Faltan parámetros." });

        let filtro = { 
            sitio: sitio, 
            categoria: categoria,
            _id: { $ne: excludeId } 
        };

        const randomSkip = Math.floor(Math.random() * 20);
        const recommended = await Article.find(filtro).sort({ fecha: -1 }).skip(randomSkip).limit(12); 

        res.json(recommended);
    } catch (error) {
        console.error("Error en getRecommendedArticles:", error);
        res.status(500).json({ error: "Error interno." });
    }
};

/**
 * [PÚBLICO] Sitemap
 */
exports.getSitemap = async (req, res) => {
    const BASE_URL = 'https://noticias.lat'; 
    try {
        const articles = await Article.find({ sitio: 'noticias.lat' }).sort({ fecha: -1 }).select('_id fecha');
        
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
            xml += `<url><loc>${BASE_URL}/${page.loc}</loc><priority>${page.priority}</priority><changefreq>${page.changefreq}</changefreq></url>`;
        });

        articles.forEach(article => {
            const articleDate = new Date(article.fecha).toISOString().split('T')[0];
            xml += `<url><loc>${BASE_URL}/articulo/${article._id}</loc><lastmod>${articleDate}</lastmod><changefreq>weekly</changefreq><priority>0.90</priority></url>`;
        });

        xml += '</urlset>';
        res.header('Content-Type', 'application/xml');
        res.send(xml);
    } catch (error) {
        console.error("Error en getSitemap:", error);
        res.status(500).json({ error: "Error interno." });
    }
};

/**
 * [PÚBLICO] Feed de Videos (Solo completos)
 */
exports.getFeedArticles = async (req, res) => {
    try {
        const { sitio, limite } = req.query;
        if (!sitio) return res.status(400).json({ error: "Falta sitio." });
        
        const limiteNum = parseInt(limite) || 50;

        const articles = await Article.find({ 
            sitio: sitio,
            videoProcessingStatus: 'complete', 
            youtubeId: { $ne: null }           
        })
        .sort({ fecha: -1 })
        .limit(limiteNum)
        .select('titulo categoria youtubeId');

        res.json(articles);
    } catch (error) {
        console.error("Error en getFeedArticles:", error);
        res.status(500).json({ error: "Error interno." });
    }
};


// ============================================================================
// 🔥 CALLBACKS DEL BOT DE VIDEO (AQUÍ ESTÁ LA MAGIA)
// ============================================================================

/**
 * [PRIVADO] ÉXITO: El Bot terminó el video.
 * ACCIÓN: Guardar ID y PUBLICAR EN TELEGRAM.
 */
exports.videoCompleteCallback = async (req, res) => {
    try {
        const { articleId, youtubeId } = req.body;
        
        if (!articleId || !youtubeId) return res.status(400).json({ error: "Datos incompletos" });

        const article = await Article.findById(articleId);
        if (!article) return res.status(404).json({ error: "Artículo no encontrado" });

        // 1. Guardamos el ID de YouTube y estado
        article.videoProcessingStatus = 'complete';
        article.youtubeId = youtubeId;
        
        // 2. ¡IMPORTANTE! Guardamos antes de publicar
        await article.save();
        console.log(`[Callback] ✅ Video listo para: ${article.titulo} (ID: ${youtubeId})`);
        
        // 3. --- DISPARAR PUBLICACIÓN A TELEGRAM AHORA ---
        if (!article.telegramPosted) {
            console.log(`[Callback] Publicando en Telegram...`);
            try {
                await publicarUnArticulo(article);
                // La función publicarUnArticulo ya se encarga de marcar 'telegramPosted = true'
            } catch (tgError) {
                console.error(`[Callback] Error al publicar en Telegram (no crítico): ${tgError.message}`);
            }
        }

        res.json({ success: true, message: `Video procesado y noticia publicada.` });

    } catch (error) {
        console.error("Error en videoCompleteCallback:", error);
        res.status(500).json({ error: "Error interno." });
    }
};

/**
 * [PRIVADO] FALLO: El Bot no pudo hacer el video.
 * ACCIÓN: Marcar como fallido (y NO publicar en Telegram).
 */
exports.videoFailedCallback = async (req, res) => {
    try {
        const { articleId, error } = req.body;
        if (!articleId) return res.status(400).json({ error: "Falta articleId" });

        const article = await Article.findById(articleId);
        if (!article) return res.status(404).json({ error: "Artículo no encontrado" });

        // Marcar como fallido.
        // NOTA: Al quedar en 'failed', el semáforo del worker sabrá que este slot se liberó
        // y podrá procesar otra noticia.
        article.videoProcessingStatus = 'failed';
        await article.save();
        
        console.error(`[Callback] ❌ Video fallido para ${article.titulo}: ${error}`);
        res.json({ success: true, message: `Marcado como fallido.` });

    } catch (error) {
        console.error("Error en videoFailedCallback:", error);
        res.status(500).json({ error: "Error interno." });
    }
};