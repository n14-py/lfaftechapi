const express = require('express');
const router = express.Router();
const controller = require('../controllers/radioRelaxController');
const multer = require('multer');
const os = require('os'); // Para la carpeta temporal

// Usamos la carpeta temporal del sistema para las subidas (más seguro en Render)
const upload = multer({ dest: os.tmpdir() }); 

// Middleware de seguridad (usa tu ADMIN_API_KEY del .env)
const requireAdmin = (req, res, next) => {
    if (req.headers['x-api-key'] === process.env.ADMIN_API_KEY) next();
    else res.status(403).json({ error: "Sin permiso" });
};

// =============================================
// RUTAS PÚBLICAS (Para Servidor B)
// =============================================

// GET /api/relax/playlist.txt
// (Sin cambios)
router.get('/playlist.txt', controller.getLivePlaylistTxt);

// =============================================
// RUTAS PRIVADAS (Para tu Panel Admin)
// =============================================

// GET /api/relax/playlist?pagina=1&query=lofi
// (Esta ruta ahora soporta paginación y búsqueda gracias al controlador actualizado)
router.get('/playlist', requireAdmin, controller.getPlaylistJson);

// POST /api/relax/upload
// (Sin cambios)
router.post('/upload', requireAdmin, upload.single('audio'), controller.uploadTrack);

// POST /api/relax/reorder
// (Sin cambios)
router.post('/reorder', requireAdmin, controller.reorderPlaylist);

// POST /api/relax/publish
// (Sin cambios)
router.post('/publish', requireAdmin, controller.publishChanges);

// --- ¡RUTAS DE BORRADO ACTUALIZADAS! ---

// DELETE /api/relax/track/:uuid (Borrado único)
// (Actualizado para apuntar a la función renombrada 'deleteTrackByUuid')
router.delete('/track/:uuid', requireAdmin, controller.deleteTrackByUuid);

// DELETE /api/relax/tracks (Borrado múltiple)
// (¡NUEVA RUTA para la función de selección múltiple!)
router.delete('/tracks', requireAdmin, controller.deleteMultipleTracks);


module.exports = router;