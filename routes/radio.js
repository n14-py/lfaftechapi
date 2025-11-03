const express = require('express');
const router = express.Router();

// 1. Importamos los *dos* controladores
const radioController = require('../controllers/radioController'); // El que busca en la DB
const radioSyncController = require('../controllers/radioSyncController'); // El que llena la DB

// 2. --- Copiamos el middleware de seguridad ---
const requireAdminKey = (req, res, next) => {
    const apiKey = req.headers['x-api-key'];
    if (apiKey && apiKey === process.env.ADMIN_API_KEY) {
        next(); // Clave correcta, puede continuar
    } else {
        res.status(403).json({ error: "Acceso no autorizado." });
    }
};

// =============================================
// 3. RUTAS PÚBLICAS (para el frontend)
// =============================================

// RUTA DE SITEMAP
router.get('/radio/sitemap.xml', radioController.getRadioSitemap);

// Ruta para buscar estaciones (Buscador, País, Género)
router.get('/radio/buscar', radioController.searchRadios);

// Ruta para obtener la lista de géneros
router.get('/radio/generos', radioController.getTags);

// Ruta para obtener la lista de países
router.get('/radio/paises', radioController.getCountries);

// Ruta para obtener la info de UNA SOLA radio por su ID (UUID)
router.get('/radio/:uuid', radioController.getRadioByUuid);


// =============================================
// 4. RUTA PRIVADA (para el admin)
// =============================================

// Ruta para *iniciar* la sincronización y llenar nuestra base de datos.
router.post('/radio/sync', requireAdminKey, radioSyncController.syncRadios);

module.exports = router;