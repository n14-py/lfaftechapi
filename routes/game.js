const express = require('express');
const router = express.Router();

// 1. Importamos los controladores que creamos
const gameController = require('../controllers/gameController');
const syncGamesController = require('../controllers/syncGamesController');

// --- 2. LÓGICA DE CACHÉ EN MEMORIA ---
// (Para optimizar la API pública)
const cache = {};
const CACHE_DURATION = 15 * 60 * 1000; // 15 minutos en milisegundos

const cacheMiddleware = (req, res, next) => {
    const key = req.originalUrl; // ej: /api/games?category=puzzle

    if (cache[key] && (Date.now() - cache[key].timestamp < CACHE_DURATION)) {
        // [CACHE HIT]
        console.log(`[CACHE HIT] Sirviendo ${key} desde caché (Juegos).`);
        return res.json(cache[key].data);
    }
    
    // [CACHE MISS]
    res.sendResponse = res.json;
    res.json = (body) => {
        cache[key] = {
            timestamp: Date.now(),
            data: body
        };
        console.log(`[CACHE MISS] Almacenando ${key} en caché (Juegos).`);
        res.sendResponse(body);
    };

    next();
};

// --- 3. MIDDLEWARE DE AUTENTICACIÓN (Rutas privadas) ---
// (Copiado de tus otros archivos de rutas)
const requireAdminKey = (req, res, next) => {
    const apiKey = req.headers['x-api-key'];
    if (apiKey && apiKey === process.env.ADMIN_API_KEY) {
        next(); // Clave correcta
    } else {
        res.status(403).json({ error: "Acceso no autorizado." });
    }
};

// =============================================
// 4. RUTAS PÚBLICAS (Para tu index.html)
// =============================================

// --- ¡NUEVO! RUTA DEL SITEMAP ---
// GET /api/juegos/sitemap.xml
router.get('/juegos/sitemap.xml', cacheMiddleware, gameController.getSitemap);

// --- ¡NUEVO! RUTA PARA LISTAR CATEGORÍAS ---
// GET /api/juegos/categories
router.get('/juegos/categories', cacheMiddleware, gameController.getCategories);

// --- ¡NUEVO! RUTA PARA BUSCAR/FILTRAR JUEGOS ---
// GET /api/juegos?category=puzzle&pagina=1
// GET /api/juegos?query=shooter
router.get('/juegos', cacheMiddleware, gameController.getGames);

// --- ¡NUEVO! RUTA PARA UN JUEGO ESPECÍFICO ---
// GET /api/juego/bullet-force
router.get('/juego/:slug', cacheMiddleware, gameController.getGameBySlug);


// =============================================
// 5. RUTA PRIVADA (Para activar el Robot)
// =============================================

// --- ¡NUEVO! RUTA PARA INICIAR EL ROBOT DE SCRAPING ---
// POST /api/sync-games
router.post('/sync-games', requireAdminKey, syncGamesController.syncGames);

module.exports = router;