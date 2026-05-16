// Archivo: lfaftechapi/controllers/articleController.js
// --- VERSIÓN: CALLBACK QUE DETONA TELEGRAM + REPORTE DE CUOTA ---

const mongoose = require('mongoose');
const Article = require('../models/article');
const { publicarUnArticulo } = require('../utils/telegramBot'); 
const { generateSummaryWithGemini } = require('../utils/geminiClient');
// --- IMPORTANTE: TRAEMOS LA FUNCIÓN DE ALERTA DEL SYNCCONTROLLER ---
const { reportQuotaLimitReached } = require('./syncController');

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




/**
 * [PÚBLICO] Obtener Resumen con IA (Lógica de una sola ejecución)
 * Si ya existe en la DB, lo devuelve. Si no, lo genera, lo guarda y lo entrega.
 */
exports.getAISummary = async (req, res) => {
    try {
        const articleId = req.params.id;
        if (!mongoose.Types.ObjectId.isValid(articleId)) {
            return res.status(400).json({ error: "ID inválido." });
        }

        const article = await Article.findById(articleId);
        if (!article) {
            return res.status(404).json({ error: "Artículo no encontrado." });
        }

        // 🟢 PASO 1: Verificar si ya lo tenemos guardado
        if (article.aiSummary && article.aiSummary.trim() !== "") {
            console.log(`[IA] Entregando resumen guardado para: ${articleId}`);
            return res.json({ summary: article.aiSummary });
        }

        // 🔴 PASO 2: Si no existe, llamar a Gemini por única vez
        console.log(`[IA] Generando nuevo resumen para: ${article.titulo}`);
        
        // Usamos el 'articuloGenerado' (que es el texto largo) para resumir
        const nuevoResumen = await generateSummaryWithGemini(article.articuloGenerado);

        if (nuevoResumen) {
            // Guardamos permanentemente en la base de datos
            article.aiSummary = nuevoResumen;
            await article.save();
            
            return res.json({ summary: nuevoResumen });
        } else {
            return res.status(500).json({ error: "La IA no devolvió un resumen válido." });
        }

    } catch (error) {
        console.error("Error en getAISummary:", error);
        res.status(500).json({ error: "Error interno al procesar el resumen con IA." });
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
        // AHORA TAMBIÉN RECIBIMOS LA URL DE CLOUDFLARE
        const { articleId, youtubeId, videoUrl } = req.body;
        
        if (!articleId) return res.status(400).json({ error: "Datos incompletos" });

        const article = await Article.findById(articleId);
        if (!article) return res.status(404).json({ error: "Artículo no encontrado" });

        // 1. Guardamos el ID de YouTube, la URL de Cloudflare y el estado
        article.videoProcessingStatus = 'complete';
        if (youtubeId) article.youtubeId = youtubeId;
        if (videoUrl) article.videoUrl = videoUrl; // ¡Guardado para Shorts!
        
        // 2. ¡IMPORTANTE! Guardamos antes de publicar
        await article.save();
        console.log(`[Callback] ✅ Video listo para: ${article.titulo}`);
        
        // 3. --- DISPARAR PUBLICACIÓN A TELEGRAM AHORA ---
        if (!article.telegramPosted) {
            console.log(`[Callback] Publicando en Telegram...`);
            try {
                await publicarUnArticulo(article);
            } catch (tgError) {
                console.error(`[Callback] Error al publicar en Telegram: ${tgError.message}`);
            }
        }

        res.json({ success: true, message: `Video procesado y noticia publicada.` });

    } catch (error) {
        console.error("Error en videoCompleteCallback:", error);
        res.status(500).json({ error: "Error interno." });
    }
};

/**
 * [PRIVADO] ÉXITO AUDIO: El Bot terminó de narrar el MP3
 */
exports.audioCompleteCallback = async (req, res) => {
    try {
        const { articleId, audioUrl, error } = req.body;
        if (!articleId) return res.status(400).json({ error: "Falta articleId" });

        const article = await Article.findById(articleId);
        if (!article) return res.status(404).json({ error: "Artículo no encontrado" });

        if (error) {
            console.error(`[Callback Audio] ❌ Falló el audio para ${article.titulo}: ${error}`);
            return res.json({ success: false, message: `Error reportado` });
        }

        if (audioUrl) {
            article.audioUrl = audioUrl; // ¡Guardado para escuchar la noticia!
            await article.save();
            console.log(`[Callback Audio] 🎧 MP3 Listo y guardado para: ${article.titulo}`);
        }

        res.json({ success: true });
    } catch (error) {
        console.error("Error en audioCompleteCallback:", error);
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

        // ==================================================================
        // 🚨 NUEVO: DETECCIÓN DE CUOTA AGOTADA
        // Si el mensaje de error de YouTube contiene "quota" o "limit",
        // avisamos al syncController para que deje de generar textos.
        // ==================================================================
        if (error && (error.toLowerCase().includes('quota') || error.toLowerCase().includes('limit'))) {
             console.error("⛔ [CALLBACK] DETECTADA CUOTA AGOTADA. ACTIVANDO FRENO DE MANO.");
             reportQuotaLimitReached(); // <--- ESTO ACTIVA EL FRENO
        }

        // Marcar como fallido.
        // NOTA: Al quedar en 'failed', el semáforo del worker sabrá que este slot se liberó
        article.videoProcessingStatus = 'failed';
        await article.save();
        
        console.error(`[Callback] ❌ Video fallido para ${article.titulo}: ${error}`);
        res.json({ success: true, message: `Marcado como fallido.` });

    } catch (error) {
        console.error("Error en videoFailedCallback:", error);
        res.status(500).json({ error: "Error interno." });
    }
};