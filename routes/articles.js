const express = require('express');
const router = express.Router();
const articleController = require('../controllers/articleController');
const syncController = require('../controllers/syncController');
const mongoose = require('mongoose'); // Necesario para el middleware

// =============================================
// 1. LÓGICA DE CACHÉ EN MEMORIA (In-Memory Cache)
// =============================================
const cache = {};
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutos en milisegundos

const cacheMiddleware = (req, res, next) => {
    // Generamos una clave única basada en la URL completa (incluyendo query params)
    const key = req.originalUrl;

    if (cache[key] && (Date.now() - cache[key].timestamp < CACHE_DURATION)) {
        // [CACHE HIT] La data está fresca, la servimos inmediatamente.
        // console.log(`[CACHE HIT] Sirviendo ${key} desde caché.`); // ¡LOG ELIMINADO!
        return res.json(cache[key].data);
    }
    
    // [CACHE MISS] Si falla la caché, sobrescribimos res.json para almacenar la respuesta.
    res.sendResponse = res.json;
    res.json = (body) => {
        cache[key] = {
            timestamp: Date.now(),
            data: body
        };
        // console.log(`[CACHE MISS] Almacenando ${key} en caché.`); // ¡LOG ELIMINADO!
        // Llamamos al método original para enviar la respuesta al cliente
        res.sendResponse(body);
    };

    next();
};


// =============================================
// 2. MIDDLEWARE DE AUTENTICACIÓN (Rutas privadas)
// =============================================
// Esta función revisará que solo tú puedas AÑADIR contenido
const requireAdminKey = (req, res, next) => {
    const apiKey = req.headers['x-api-key'];
    if (apiKey && apiKey === process.env.ADMIN_API_KEY) {
        next(); // Clave correcta, puede continuar
    } else {
        res.status(403).json({ error: "Acceso no autorizado." });
    }
};

// =============================================
// 3. RUTAS PÚBLICAS
// =============================================

// (Esta ruta ya la tenías correcta)
router.get('/sitemap.xml', articleController.getSitemap);

// GET /api/articles/recommended
// ¡¡SOLUCIÓN!! Quitamos el 'cacheMiddleware' de esta ruta.
router.get('/articles/recommended', articleController.getRecommendedArticles);

// --- ¡NUEVA RUTA PÚBLICA PARA EL FEED! ---
// Esta es la ruta que llamará la página /feed.js
const cacheMiddlewareFeed = (req, res, next) => {
    const key = req.originalUrl;
    const CACHE_FEED = 60 * 1000; // 1 minuto
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
router.get('/articles/feed', cacheMiddlewareFeed, articleController.getFeedArticles);
// --- FIN DE LA NUEVA RUTA ---


// GET /api/articles?sitio=...&categoria=...
// APLICAMOS EL MIDDLEWARE DE CACHÉ (aquí SÍ es útil)
router.get('/articles', cacheMiddleware, articleController.getArticles);

// GET /api/article/:id
router.get('/article/:id', articleController.getArticleById);

// =============================================
// 4. RUTAS PRIVADAS
// =============================================

// Esta es la ruta que llamará tu Cron Interno
// POST /api/sync-news
router.post('/sync-news', requireAdminKey, syncController.syncNewsAPIs);

// POST /api/articles (para crear manual)
router.post('/articles', requireAdminKey, syncController.createManualArticle);


// --- ¡NUEVAS RUTAS DE CALLBACK PARA EL BOT DE VIDEO! ---
// El Bot (TTS-FMPEG) llama a esta ruta cuando el video está LISTO
router.post('/articles/video_complete', requireAdminKey, articleController.videoCompleteCallback);

// El Bot (TTS-FMPEG) llama a esta ruta si el video FALLA
router.post('/articles/video_failed', requireAdminKey, articleController.videoFailedCallback);
// --- FIN DE NUEVAS RUTAS ---


// Exportamos el router para que server.js pueda usarlo
module.exports = router;