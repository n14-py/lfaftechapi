// Archivo: lfaftechapi/routes/articles.js
const express = require('express');
const router = express.Router();
const articleController = require('../controllers/articleController');
const syncController = require('../controllers/syncController');

// =============================================
// 1. LÓGICA DE CACHÉ EN MEMORIA (In-Memory Cache)
// =============================================
const cache = {};
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutos

// Middleware de Caché Estándar
const cacheMiddleware = (req, res, next) => {
    const key = req.originalUrl; // Clave basada en la URL completa (ej: /api/articles?categoria=tech)

    if (cache[key] && (Date.now() - cache[key].timestamp < CACHE_DURATION)) {
        return res.json(cache[key].data); // [CACHE HIT] Devolvemos memoria
    }
    
    // [CACHE MISS] Interceptamos la respuesta para guardarla
    res.sendResponse = res.json;
    res.json = (body) => {
        cache[key] = { timestamp: Date.now(), data: body };
        res.sendResponse(body);
    };
    next();
};

// Middleware de Caché Corta (Para el Feed de videos)
const cacheMiddlewareFeed = (req, res, next) => {
    const key = req.originalUrl;
    const CACHE_FEED = 60 * 1000; // 1 minuto (refresco rápido)
    
    if (cache[key] && (Date.now() - cache[key].timestamp < CACHE_FEED)) {
        return res.json(cache[key].data);
    }
    res.sendResponse = res.json;
    res.json = (body) => {
        cache[key] = { timestamp: Date.now(), data: body };
        res.sendResponse(body);
    };
    next();
};


// =============================================
// 2. MIDDLEWARE DE SEGURIDAD (Admin Key)
// =============================================
const requireAdminKey = (req, res, next) => {
    const apiKey = req.headers['x-api-key'];
    // Verifica contra la clave en .env
    if (apiKey && apiKey === process.env.ADMIN_API_KEY) {
        next(); 
    } else {
        res.status(403).json({ error: "Acceso no autorizado." });
    }
};


// =============================================
// 3. RUTAS PÚBLICAS (Lectura)
// =============================================

// GET /api/sitemap.xml (SEO)
router.get('/sitemap.xml', articleController.getSitemap);

// GET /api/articles/recommended (Recomendaciones)
// (Sin caché para que varíen más)
router.get('/articles/recommended', articleController.getRecommendedArticles);

// GET /api/articles/feed (Para el Bot de Video)
// Devuelve solo artículos con video 'complete'
router.get('/articles/feed', cacheMiddlewareFeed, articleController.getFeedArticles);

// GET /api/articles (Lista principal con filtros y búsqueda)
// ¡Usa cacheMiddleware!
router.get('/articles', cacheMiddleware, articleController.getArticles);

// GET /api/article/:id (Detalle de una noticia)
router.get('/article/:id', articleController.getArticleById);


// =============================================
// 4. RUTAS PRIVADAS (Escritura / Admin)
// =============================================

// POST /api/sync-news
// Dispara el recolector automático (Worker)
router.post('/sync-news', requireAdminKey, syncController.syncNewsAPIs);

// POST /api/articles
// Crear artículo MANUALMENTE (Genera IA + Imagen automáticamente)
router.post('/articles', requireAdminKey, syncController.createManualArticle);

// --- CALLBACKS DEL BOT DE VIDEO ---

// POST /api/articles/video_complete
// El bot llama aquí cuando termina un video
router.post('/articles/video_complete', requireAdminKey, articleController.videoCompleteCallback);

// POST /api/articles/video_failed
// El bot llama aquí si falla
router.post('/articles/video_failed', requireAdminKey, articleController.videoFailedCallback);


module.exports = router;