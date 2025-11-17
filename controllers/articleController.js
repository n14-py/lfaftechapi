/*
  Archivo: lfaftechapi/controllers/articleController.js
  ¡MODIFICADO PARA ENVIAR UN REPORTERO AL AZAR!
*/
const mongoose = require('mongoose');
const Article = require('../models/article');
const axios = require('axios'); // Para llamar al bot

// URL de nuestro bot de Python (sigue en el puerto 5001)
const BOT_API_URL = 'https://tts-fmpeg-lfaf.onrender.com/generate_video';

// --- ¡NUEVO! LISTA DE REPORTEROS ---
// Aquí pones los nombres EXACTOS de los archivos de imagen
// que están en la carpeta TTS-FMPEG/reporter_images/
const REPORTEROS_IMAGENES = [
    'Ancla de Noticias.lat en estudio.jpg', // Tu imagen original
    'reportero_juan.jpg',
    'reportera_maria.png',
    'reportero_carlos.jpg',
    'reportera_lucia.jpg',
    'reportero_miguel.png',
    'reportera_ana.jpg',
    'reportero_javier.jpg',
    'reportera_sofia.png',
    'reportero_diego.jpg'
    // ...¡Añade hasta 10 o más si quieres!
];
// --- FIN DE LA LISTA ---


// El mapa de países no cambia
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
 * [PRIVADO] Función de Crear Artículo
 * (Llama al bot en segundo plano)
 */
exports.createArticle = async (req, res) => {
    const { 
        titulo, 
        descripcion, 
        imagen, 
        categoria, 
        sitio, 
        pais, 
        articuloGenerado, 
        fuente, 
        enlaceOriginal 
    } = req.body;
    
    let savedArticle;
    try {
        // --- PASO 1: Guardar el artículo en MongoDB ---
        const newArticle = new Article({
            titulo,
            descripcion,
            imagen,
            categoria,
            sitio,
            pais: paisTermMap[pais] || pais || null,
            articuloGenerado,
            fuente,
            enlaceOriginal,
            videoProcessingStatus: 'processing' // Estado inicial
        });

        savedArticle = await newArticle.save();
        
        // Respondemos INMEDIATAMENTE al cliente
        res.status(201).json(savedArticle);

    } catch (dbError) {
        console.error("[API] Error al guardar en MongoDB:", dbError.message);
        if (dbError.code === 11000) {
            return res.status(409).json({ error: "Artículo duplicado (enlaceOriginal ya existe)." });
        }
        return res.status(500).json({ error: "Error interno del servidor al guardar en DB." });
    }

    // --- PASO 2: Llamar al Bot de Python (en segundo plano) ---
    try {
        // --- ¡NUEVA LÓGICA DE SELECCIÓN! ---
        // Elegimos un nombre de imagen al azar de nuestra lista
        const imagenReporteroElegida = REPORTEROS_IMAGENES[
            Math.floor(Math.random() * REPORTEROS_IMAGENES.length)
        ];
        
        console.log(`[API] Llamando al bot para: "${savedArticle.titulo}" (ID: ${savedArticle._id})`);
        console.log(`[API] Usando reportero: ${imagenReporteroElegida}`);
        
        // ¡Enviamos los 3 campos que el bot espera!
        const videoResponse = await axios.post(BOT_API_URL, {
            text: articuloGenerado,       // El texto completo para el TTS
            title: titulo,             // El título para YouTube
            image_name: imagenReporteroElegida // La imagen elegida
        });

        if (videoResponse.data && videoResponse.data.youtubeId) {
            console.log(`[API] Bot completado. YouTube ID: ${videoResponse.data.youtubeId}`);
            // Actualizamos el artículo con el ID de YouTube
            await Article.findByIdAndUpdate(savedArticle._id, {
                $set: {
                    youtubeId: videoResponse.data.youtubeId,
                    videoProcessingStatus: 'complete',
                    // ¡Extra! Guardamos qué reportero se usó (opcional)
                    // reporterImage: imagenReporteroElegida 
                }
            });
        } else {
            throw new Error("El bot de video no devolvió un youtubeId.");
        }

    } catch (botError) {
        console.error(`[API] ¡FALLO EL BOT DE PYTHON para ${savedArticle._id}! ${botError.message}`);
        await Article.findByIdAndUpdate(savedArticle._id, {
            $set: { videoProcessingStatus: 'failed' }
        });
    }
};

/**
 * [PÚBLICO] Obtener LISTA de artículos
 * (Sin cambios en esta función)
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
        }
        if (!queryTexto && !paisFiltro && categoria && categoria !== 'todos') {
            filtro.categoria = categoria;
        }

        if (videoStatus === 'complete_or_pending') {
            filtro.$or = [
                { videoProcessingStatus: 'complete' },
                { videoProcessingStatus: 'pending' },
                { videoProcessingStatus: 'processing' }
            ];
        } else if (videoStatus === 'complete') {
            filtro.videoProcessingStatus = 'complete';
            filtro.youtubeId = { $exists: true, $ne: null };
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
 * [PÚBLICO] Obtener UN solo artículo por su ID
 * (Sin cambios en esta función)
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
 * (Sin cambios en esta función)
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
            _id: { $ne: excludeId },
            videoProcessingStatus: 'complete', // Solo recomienda videos listos
            youtubeId: { $exists: true, $ne: null }
        };
        
        const recommended = await Article.aggregate([
            { $match: filtro },
            { $sample: { size: 4 } } // 4 aleatorios
        ]);

        res.json(recommended);

    } catch (error) {
        console.error("Error en getRecommendedArticles:", error);
        res.status(500).json({ error: "Error interno del servidor." });
    }
};


/**
 * [PÚBLICO] Generar el Sitemap.xml
 * (Sin cambios en esta función)
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
            { loc: 'feed', priority: '0.90', changefreq: 'daily' },
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