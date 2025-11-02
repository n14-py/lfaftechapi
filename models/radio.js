const express = require('express');
const router = express.Router();

// 1. Importamos los *dos* controladores
const radioController = require('../controllers/radioController'); // El que busca en la DB
const radioSyncController = require('../controllers/radioSyncController'); // El que llena la DB

// 2. --- Copiamos el middleware de seguridad ---
// (Esto es para proteger la ruta de sincronización, igual que en /api/sync-gnews)
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
// (Estas rutas ahora leen de NUESTRA base de datos rápida)

// Ruta para buscar estaciones (¡Ahora es un buscador!)
// Ej: /api/radio/buscar?query=rock (Buscador)
// Ej: /api/radio/buscar?pais=PY (Filtro de País)
// Ej: /api/radio/buscar?genero=rock (Filtro de Género)
// Ej: /api/radio/buscar (Trae las más populares por defecto)
router.get('/radio/buscar', radioController.searchRadios);

// Ruta para obtener la lista de géneros (desde nuestra DB)
router.get('/radio/generos', radioController.getTags);

// Ruta para obtener la lista de países (desde nuestra DB)
router.get('/radio/paises', radioController.getCountries);

// =============================================
// 4. RUTA PRIVADA (para el admin)
// =============================================

// Ruta para *iniciar* la sincronización y llenar nuestra base de datos.
// Esta ruta debe estar protegida con la llave de admin.
router.post('/radio/sync', requireAdminKey, radioSyncController.syncRadios);

module.exports = router;