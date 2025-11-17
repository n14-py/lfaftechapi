const express = require('express');
const router = express.Router();
const articleController = require('../controllers/articleController');

/*
 * ==========================================================
 * --- RUTAS DE ARTÍCULOS (Corregidas para el bot de YouTube) ---
 * ==========================================================
 */

// --- RUTA PRINCIPAL ---
// GET /api/articles -> Obtiene la lista de artículos (con filtros)
router.get('/', articleController.getArticles);

// POST /api/articles -> Crea un nuevo artículo Y llama al bot
router.post('/', articleController.createArticle);


// --- RUTAS DE ARTÍCULO INDIVIDUAL ---
// GET /api/articles/:id -> Obtiene un artículo por su ID
router.get('/:id', articleController.getArticleById);


// --- RUTAS ESPECIALES ---
// GET /api/articles/sitemap.xml -> Genera el sitemap
router.get('/sitemap.xml', articleController.getSitemap);

// GET /api/articles/recommended -> Obtiene 4 artículos recomendados
// ¡Importante! Esta debe ir ANTES de /:id para que funcione
router.get('/recommended', articleController.getRecommendedArticles);


/*
 * --- RUTAS ELIMINADAS ---
 *
 * La ruta para /mrss.xml (getMRSSFeed) se eliminó.
 * La ruta para /video_complete (handleVideoComplete) se eliminó.
 *
 * Si alguna de estas rutas estaba en la línea 62, ese era el error.
 */

module.exports = router;