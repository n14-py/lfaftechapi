const express = require('express');
const router = express.Router();
const sitemapController = require('../controllers/sitemapController');

// Índice Principal (El que envías a Google)
router.get('/sitemap.xml', sitemapController.getSitemapIndex);

// Estático
router.get('/sitemap-static.xml', sitemapController.getStaticSitemap);

// Dinámico por página (sitemap-noticias-1.xml, etc.)
router.get('/sitemap-noticias-:page.xml', sitemapController.getNewsSitemap);

module.exports = router;