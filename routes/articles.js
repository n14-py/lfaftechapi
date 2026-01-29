// Archivo: lfaftechapi/routes/articles.js
const express = require('express');
const router = express.Router();

// Importamos los controladores
const articleController = require('../controllers/articleController');
const syncController = require('../controllers/syncController');

// =============================================
// 1. CONFIGURACIÓN DE CACHÉ (Memoria RAM)
// =============================================
const cache = {};
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutos para listas normales

// Middleware de Caché Estándar (Para /articles)
const cacheMiddleware = (req, res, next) => {
    // Si es una petición con filtros de búsqueda, evitamos caché agresiva
    if (req.query.query) return next();

    const key = req.originalUrl; 
    if (cache[key] && (Date.now() - cache[key].timestamp < CACHE_DURATION)) {
        return res.json(cache[key].data);
    }
    
    res.sendResponse = res.json;
    res.json = (body) => {
        cache[key] = { timestamp: Date.now(), data: body };
        res.sendResponse(body);
    };
    next();
};

// Middleware de Caché Corta (Para el Feed de videos de los bots)
const cacheMiddlewareFeed = (req, res, next) => {
    const key = req.originalUrl;
    const CACHE_FEED = 30 * 1000; // 30 segundos (Refresco rápido para los bots)
    
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
    // Verifica que la clave coincida con la del archivo .env
    // (O permite paso si no hay clave configurada en dev, cuidado con esto en prod)
    if (apiKey && apiKey === process.env.ADMIN_API_KEY) {
        next(); 
    } else {
        // Si no envía clave, rechazamos
        res.status(403).json({ error: "Acceso denegado: Falta API Key de Admin." });
    }
};

// =============================================
// 3. RUTAS PÚBLICAS (Lectura para tus Webs)
// =============================================

// GET /api/articles
// Lista principal: soporta ?sitio=noticias.lat&categoria=deportes&query=messi
router.get('/articles', cacheMiddleware, articleController.getArticles);

// GET /api/article/:id
// Leer una noticia específica
router.get('/article/:id', articleController.getArticleById);

// GET /api/articles/recommended
// Noticias relacionadas (sin caché para variar)
router.get('/articles/recommended', articleController.getRecommendedArticles);

// GET /api/articles/feed
// Ruta especial para que los bots sepan qué videos ya existen (solo 'complete')
router.get('/articles/feed', cacheMiddlewareFeed, articleController.getFeedArticles);


// =============================================
// 4. RUTAS DE ADMINISTRACIÓN Y SYNC (Privadas)
// =============================================

// POST /api/sync-news
// Botón "Forzar Sincronización" del panel admin
router.post('/sync-news', requireAdminKey, syncController.syncNewsAPIs);

// POST /api/retry-videos   <--- ¡ESTA FALTABA!
// Botón "Resucitar Videos" (Libera los zombies)
router.post('/retry-videos', requireAdminKey, syncController.retryVideos);

// POST /api/articles
// Crear noticia MANUALMENTE desde el panel
router.post('/articles', requireAdminKey, syncController.createManualArticle);


// =============================================
// 5. WEBHOOKS / CALLBACKS (Comunicación Bot -> API)
// =============================================

// POST /api/articles/video_complete
// El bot llama aquí cuando TERMINA un video y te manda el ID de YouTube
router.post('/articles/video_complete', requireAdminKey, articleController.videoCompleteCallback);

// POST /api/articles/video_failed
// El bot llama aquí si FALLA (cuota, error, etc.)
router.post('/articles/video_failed', requireAdminKey, articleController.videoFailedCallback);

// =============================================
// 6. RUTAS OPCIONALES (Borrar/Editar si las necesitas)
// =============================================
// router.delete('/articles/:id', requireAdminKey, articleController.deleteArticle);
// router.put('/articles/:id', requireAdminKey, articleController.updateArticle);

module.exports = router;