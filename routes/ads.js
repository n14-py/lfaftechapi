const express = require('express');
const router = express.Router();
const adController = require('../controllers/adController');
const multer = require('multer');
const os = require('os');

// Usamos la carpeta temporal del sistema para recibir el archivo antes de mandarlo a R2
const upload = multer({ dest: os.tmpdir() });

// Middleware de seguridad para el panel maestro (Tú)
const requireAdminKey = (req, res, next) => {
    const apiKey = req.headers['x-api-key'] || req.query.key;
    if (apiKey && apiKey === process.env.ADMIN_API_KEY) {
        next();
    } else {
        res.status(403).json({ error: "Acceso denegado: API Key incorrecta." });
    }
};

// ==========================================
// RUTA DE SUBIDA DE ARCHIVOS (R2)
// ==========================================
// El cliente envía el archivo físico, el backend lo sube a R2 y devuelve el enlace
router.post('/upload', upload.single('media'), adController.uploadAdMedia);

// ==========================================
// RUTAS DEL PANEL MAESTRO (TÚ)
// ==========================================
router.post('/advertiser', requireAdminKey, adController.createAdvertiser);
router.post('/ad', requireAdminKey, adController.createAd);

// ==========================================
// RUTAS DEL PANEL CLIENTE (ANUNCIANTE)
// ==========================================
router.post('/advertiser/login', adController.loginAdvertiser);
router.get('/advertiser/:advertiserId/dashboard', adController.getAdvertiserDashboard);
router.post('/client/ad', adController.createAdClient);

// ==========================================
// APROBACIÓN (SOLO ADMIN)
// ==========================================
router.put('/admin/ad/:adId/approve', requireAdminKey, adController.approveAd);

// ==========================================
// RUTAS PÚBLICAS (APP Y WEB)
// ==========================================
// Entregar anuncios activos en rotación
router.get('/active', adController.getActiveAds);

// Tracking de clics y vistas
router.get('/click', adController.trackClick);
router.post('/view', adController.trackView);

module.exports = router; // <-- ESTA LÍNEA SIEMPRE DEBE IR AL FINAL DE TODO