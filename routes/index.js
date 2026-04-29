const express = require('express');
const router = express.Router();

const articleRoutes = require('./articles');
const radioRoutes = require('./radio');
const gameRoutes = require('./game');
const radioRelaxRoutes = require('./radioRelax');

const memberRoutes = require('./member');
const alexaController = require('../controllers/alexaController');

// --- 1. Importar Rutas de Sitemap ---
const sitemapRoutes = require('./sitemap');

router.use(articleRoutes);
router.use(radioRoutes);
router.use(gameRoutes);
router.use('/relax', radioRelaxRoutes);
router.use('/member', memberRoutes);
// Ruta para Alexa
router.get('/alexa-stats', alexaController.getStatsForAlexa);


// --- 2. Usar Rutas de Sitemap ---
// Esto las pone disponibles en /api/sitemap.xml
router.use(sitemapRoutes);

module.exports = router;