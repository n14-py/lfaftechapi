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
        console.log(`[CACHE HIT] Sirviendo ${key} desde caché.`);
        return res.json(cache[key].data);
    }
    
    // [CACHE MISS] Si falla la caché, sobrescribimos res.json para almacenar la respuesta.
    res.sendResponse = res.json;
    res.json = (body) => {
        cache[key] = {
            timestamp: Date.now(),
            data: body
        };
        console.log(`[CACHE MISS] Almacenando ${key} en caché.`);
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

// --- ¡¡AQUÍ ESTÁ LA RUTA DEL SITEMAP CORREGIDA!! ---
// Como 'index.js' usa este router en la raíz '/api',
// la ruta final seguirá siendo '/api/sitemap.xml'
router.get('/sitemap.xml', articleController.getSitemap);
// --------------------------------------------------

// GET /api/articles/recommended
// Se aplica el caché aquí también
router.get('/articles/recommended', cacheMiddleware, articleController.getRecommendedArticles);

// GET /api/articles?sitio=...&categoria=...
// APLICAMOS EL MIDDLEWARE DE CACHÉ
router.get('/articles', cacheMiddleware, articleController.getArticles);

// GET /api/article/:id
router.get('/article/:id', articleController.getArticleById);

// =============================================
// 4. RUTAS PRIVADAS
// =============================================

// POST /api/sync-gnews
router.post('/sync-gnews', requireAdminKey, syncController.syncGNews);

// POST /api/articles
router.post('/articles', requireAdminKey, syncController.createManualArticle);

// Exportamos el router para que server.js pueda usarlo
module.exports = router;