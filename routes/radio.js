const express = require('express');
const router = express.Router();

// 1. Importamos los *dos* controladores
const radioController = require('../controllers/radioController'); // El que busca en la DB
const radioSyncController = require('../controllers/radioSyncController'); // El que llena la DB

// --- ¡PASO 1: AÑADIR LA LÓGICA DE CACHÉ! ---
// (Copiado desde 'articles.js' para optimizar esta ruta)
const cache = {};
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutos en milisegundos

const cacheMiddleware = (req, res, next) => {
    // Generamos una clave única basada en la URL completa (incluyendo query params)
    const key = req.originalUrl;

    if (cache[key] && (Date.now() - cache[key].timestamp < CACHE_DURATION)) {
        // [CACHE HIT] La data está fresca, la servimos inmediatamente.
        // console.log(`[CACHE HIT] Sirviendo ${key} desde caché (Radio).`); // ¡LOG ELIMINADO!
        return res.json(cache[key].data);
    }
    
    // [CACHE MISS] Si falla la caché, sobrescribimos res.json para almacenar la respuesta.
    res.sendResponse = res.json;
    res.json = (body) => {
        cache[key] = {
            timestamp: Date.now(),
            data: body
        };
        // console.log(`[CACHE MISS] Almacenando ${key} en caché (Radio).`); // ¡LOG ELIMINADO!
        // Llamamos al método original para enviar la respuesta al cliente
        res.sendResponse(body);
    };

    next();
};
// --- FIN DEL PASO 1 ---


// 2. --- Copiamos el middleware de seguridad --- (Esto ya existía)
const requireAdminKey = (req, res, next) => {
    const apiKey = req.headers['x-api-key'];
    if (apiKey && apiKey === process.env.ADMIN_API_KEY) {
        next(); // Clave correcta, puede continuar
    } else {
        res.status(403).json({ error: "Acceso no autorizado." });
    }
};

// =============================================
// 3. RUTAS PÚBLICAS (¡AHORA CON CACHÉ!)
// =============================================

// RUTA DE SITEMAP (Cacheada)
router.get('/radio/sitemap.xml', cacheMiddleware, radioController.getRadioSitemap);

// Ruta para buscar estaciones (Cacheada)
// ¡Esta es la llamada más importante que hace app.js!
router.get('/radio/buscar', cacheMiddleware, radioController.searchRadios);

// Ruta para obtener la lista de géneros (Cacheada)
router.get('/radio/generos', cacheMiddleware, radioController.getTags);

// Ruta para obtener la lista de países (Cacheada)
// ¡Esta es la otra llamada más importante!
router.get('/radio/paises', cacheMiddleware, radioController.getCountries);

// Ruta para obtener la info de UNA SOLA radio por su ID (Cacheada)
router.get('/radio/:uuid', cacheMiddleware, radioController.getRadioByUuid);


// =============================================
// 4. RUTAS PRIVADAS (SIN CACHÉ)
// =============================================

// Ruta para *iniciar* la sincronización y llenar nuestra base de datos.
router.post('/radio/sync', requireAdminKey, radioSyncController.syncRadios);

// --- ¡¡NUEVA RUTA AÑADIDA!! ---
// Ruta para sincronizar las descripciones de IA (en lotes de 20)
router.post('/radio/sync-ai', requireAdminKey, radioSyncController.syncRadioAIDescriptions);
// --------------------------------

module.exports = router;