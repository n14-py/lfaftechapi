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
        const { sitio, categoria, limite, pagina } = req.query;
        
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

        // --- ¡¡AQUÍ COMIENZA LA NUEVA LÓGICA DE BÚSQUEDA!! ---
        
        // 1. ANÁLISIS DE PAÍS:
        // Si el usuario *no* filtró por un país (ej: no está en la página de Honduras)...
        // ...vamos a "robar" la palabra del país de su búsqueda.
        if (queryTexto && !paisFiltro) {
            const queryPalabras = queryTexto.toLowerCase().split(' ');
            let paisEncontrado = null;
            
            // Revisa cada palabra de la búsqueda
            for (const palabra of queryPalabras) {
                if (paisTermMap[palabra]) {
                    paisEncontrado = paisTermMap[palabra]; // ej: "py"
                    break;
                }
            }
            
            // Si encontramos un país en la búsqueda (ej: "accidentes paraguay")
            if (paisEncontrado) {
                paisFiltro = paisEncontrado; // Aplicamos el filtro de país
                
                // Limpiamos la query (quitamos "paraguay" de la búsqueda)
                queryTexto = queryPalabras.filter(p => !paisTermMap[p]).join(' ');
            }
        }
        
        // 2. CONSTRUCCIÓN DEL FILTRO DE MONGO:
        
        // A. Añadir filtro de PAÍS si existe (sea explícito o "robado")
        if (paisFiltro) {
            filtro.pais = paisFiltro;
        }

        // B. Añadir filtro de TEXTO si existe
        if (queryTexto && queryTexto.trim() !== '') {
            filtro.$text = { $search: queryTexto };
            sort = { score: { $meta: "textScore" } }; 
            projection = { score: { $meta: "textScore" } }; 
        }
        
        // C. Añadir filtro de CATEGORÍA (solo si no hay búsqueda de texto Y no hay filtro de país)
        if (!queryTexto && !paisFiltro && categoria && categoria !== 'todos') {
            filtro.categoria = categoria;
        }
        // --- FIN DE LA LÓGICA DE BÚSQUEDA ---

        // ¡IMPORTANTE! Dejamos que .find() devuelva todos los campos
        // (incluyendo 'youtubeId' y 'videoProcessingStatus')
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

        const randomSkip = Math.floor(Math.random() * 20);
        
        const recommended = await Article.find(filtro)
            .sort({ fecha: -1 })
            .skip(randomSkip)
            .limit(12); 

        res.json(recommended);

    } catch (error) {
        console.error("Error en getRecommendedArticles:", error);
        res.status(500).json({ error: "Error interno del servidor." });
    }
};


/**
 * [PÚBLICO] Generar el Sitemap.xml
 * (Añadido al final de articleController.js)
 */
exports.getSitemap = async (req, res) => {
    // ¡IMPORTANTE! Cambia esto por la URL real de tu sitio web
    const BASE_URL = 'https://noticias.lat'; // URL del Frontend

    try {
        // 1. Obtenemos todos los artículos de la DB
        const articles = await Article.find({ sitio: 'noticias.lat' }) // Filtra por sitio
            .sort({ fecha: -1 })
            .select('_id fecha');
        
        let xml = '<?xml version="1.0" encoding="UTF-8"?>';
        xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">';

        // 2. Añadir Páginas Estáticas (Homepage, Contacto, etc.)
        const staticPages = [
    { loc: '', priority: '1.00', changefreq: 'daily' }, // Homepage
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

        // 3. Añadir todos los Artículos (Dinámicos)
        articles.forEach(article => {
            const articleDate = new Date(article.fecha).toISOString().split('T')[0];
            xml += '<url>';
            // URL del artículo en el frontend
            xml += `<loc>${BASE_URL}/articulo/${article._id}</loc>`;
            xml += `<lastmod>${articleDate}</lastmod>`;
            xml += '<changefreq>weekly</changefreq>';
            xml += '<priority>0.90</priority>';
            xml += '</url>';
        });

        xml += '</urlset>';

        // 4. Enviar el XML
        res.header('Content-Type', 'application/xml');
        res.send(xml);

    } catch (error) {
        console.error("Error en getSitemap:", error);
        res.status(500).json({ error: "Error interno del servidor." });
    }
};


/**
 * [PÚBLICO] Obtener LISTA de artículos para el FEED
 * Devuelve solo artículos que tienen un video completo.
 */
exports.getFeedArticles = async (req, res) => {
    try {
        const { sitio, limite } = req.query;
        if (!sitio) {
            return res.status(400).json({ error: "El parámetro 'sitio' es obligatorio." });
        }
        
        const limiteNum = parseInt(limite) || 50; // Traer 50 videos para el feed

        let filtro = { 
            sitio: sitio,
            videoProcessingStatus: 'complete', // ¡Solo los que están completos!
            youtubeId: { $ne: null }           // ¡Y que tienen un ID!
        };
        
        const articles = await Article.find(filtro)
            .sort({ fecha: -1 }) // Los videos más nuevos primero
            .limit(limiteNum)
            .select('titulo categoria youtubeId'); // Solo traemos los datos necesarios

        res.json(articles);

    } catch (error) {
        console.error("Error en getFeedArticles:", error);
        res.status(500).json({ error: "Error interno del servidor." });
    }
};


// --- ¡NUEVA FUNCIÓN DE CALLBACK (ÉXITO)! ---
/**
 * [PRIVADO] El Bot de Python llama a esta ruta cuando el video está LISTO.
 */
exports.videoCompleteCallback = async (req, res) => {
    try {
        const { articleId, youtubeId } = req.body;
        
        if (!articleId || !youtubeId) {
            return res.status(400).json({ error: "Faltan articleId o youtubeId" });
        }

        const article = await Article.findById(articleId);
        if (!article) {
            console.warn(`[Callback] Se completó el video para ${articleId}, pero el artículo ya no existe.`);
            return res.status(404).json({ error: "Artículo no encontrado" });
        }

        // ¡Guardamos el ID de YouTube!
        article.videoProcessingStatus = 'complete';
        article.youtubeId = youtubeId;
        await article.save();
        
        console.log(`[Callback] ¡Éxito! Video guardado para ${article.titulo} (ID: ${youtubeId})`);
        res.json({ success: true, message: `Artículo ${articleId} actualizado.` });

    } catch (error) {
        console.error("Error en videoCompleteCallback:", error);
        res.status(500).json({ error: "Error interno del servidor." });
    }
};

// --- ¡NUEVA FUNCIÓN DE CALLBACK (FALLO)! ---
/**
 * [PRIVADO] El Bot de Python llama a esta ruta si el video FALLA.
 */
exports.videoFailedCallback = async (req, res) => {
    try {
        const { articleId, error } = req.body;
        
        if (!articleId) {
            return res.status(400).json({ error: "Falta articleId" });
        }

        const article = await Article.findById(articleId);
        if (!article) {
             console.warn(`[Callback] Falló el video para ${articleId}, pero el artículo ya no existe.`);
            return res.status(404).json({ error: "Artículo no encontrado" });
        }

        // Marcamos como fallido para no reintentar
        article.videoProcessingStatus = 'failed';
        await article.save();
        
        console.error(`[Callback] ¡FALLO! Bot reportó error para ${article.titulo}: ${error || 'Error desconocido'}`);
        res.json({ success: true, message: `Artículo ${articleId} marcado como fallido.` });

    } catch (error) {
        console.error("Error en videoFailedCallback:", error);
        res.status(500).json({ error: "Error interno del servidor." });
    }
};