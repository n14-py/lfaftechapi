const express = require('express');
const router = express.Router();
const liveController = require('../controllers/liveController');

const requireAdminKey = (req, res, next) => {
    const apiKey = req.headers['x-api-key'] || req.query.key;
    if (apiKey && apiKey === process.env.ADMIN_API_KEY) {
        next();
    } else {
        res.status(403).json({ error: 'Acceso denegado: Falta API Key de Admin.' });
    }
};

router.get('/admin/panel', requireAdminKey, liveController.getPanel);
router.put('/admin/config', requireAdminKey, liveController.saveConfig);
router.post('/admin/tanda', requireAdminKey, liveController.buildTanda);
router.post('/admin/dispatch', requireAdminKey, liveController.dispatchNext);
router.post('/admin/preview', requireAdminKey, liveController.preview);
router.post('/admin/stop', requireAdminKey, liveController.stopCurrent);
router.get('/admin/jobs/:id', requireAdminKey, liveController.getJob);
router.post('/admin/jobs/:id/cancel', requireAdminKey, liveController.cancelJob);
router.post('/admin/jobs/:id/retry', requireAdminKey, liveController.retryJob);

// Avisos que manda noticiaslatenvivo cuando el directo sale, termina o falla.
router.post('/live_started', requireAdminKey, liveController.onLiveStarted);
router.post('/live_complete', requireAdminKey, liveController.onLiveComplete);
router.post('/live_failed', requireAdminKey, liveController.onLiveFailed);

module.exports = router;
