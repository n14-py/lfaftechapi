const express = require('express');
const router = express.Router();

// Importamos el archivo de rutas de artículos
const articleRoutes = require('./articles');

// --- ¡LÍNEA 1 AÑADIDA! ---
// Importamos el controlador que acabamos de modificar
const articleController = require('../controllers/articleController');


// Le decimos a Express que use el archivo 'articles.js'
// para cualquier URL que llegue a este punto (ej: /api/articles)
router.use(articleRoutes);


// --- ¡LÍNEA 2 AÑADIDA! ---
// Creamos la ruta directa /api/sitemap.xml
router.get('/sitemap.xml', articleController.getSitemap);


// --- ASÍ AÑADIRÁS 'pelis.lat' EN EL FUTURO ---
// ...

// Exportamos el router principal
module.exports = router;