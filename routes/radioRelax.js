const express = require('express');
const router = express.Router();
const controller = require('../controllers/radioRelaxController');
const multer = require('multer');
const os = require('os'); // <--- Importamos 'os'

// Usamos la carpeta temporal del sistema para las subidas
const upload = multer({ dest: os.tmpdir() }); 

// Middleware de seguridad (usa tu ADMIN_API_KEY del .env)
const requireAdmin = (req, res, next) => {
    if (req.headers['x-api-key'] === process.env.ADMIN_API_KEY) next();
    else res.status(403).json({ error: "Sin permiso" });
};

// -- Rutas Públicas (para que el Servidor B las lea) --
router.get('/playlist.txt', controller.getLivePlaylistTxt); // ¡La URL mágica!

// -- Rutas Privadas (para tu Panel Admin) --
router.get('/playlist', requireAdmin, controller.getPlaylistJson);
router.post('/upload', requireAdmin, upload.single('audio'), controller.uploadTrack);
router.post('/reorder', requireAdmin, controller.reorderPlaylist);
router.delete('/track/:uuid', requireAdmin, controller.deleteTrack);

// --- ¡¡NUEVA RUTA DE PUBLICACIÓN!! ---
// El botón del frontend llamará a esta ruta
router.post('/publish', requireAdmin, controller.publishChanges);

module.exports = router;