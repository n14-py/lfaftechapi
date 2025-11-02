const express = require('express');
const router = express.Router();

// Importamos el archivo de rutas de artículos
const articleRoutes = require('./articles');

// (Quitamos el 'require' de articleController de aquí)

// Le decimos a Express que use el archivo 'articles.js'
// para cualquier URL que llegue a este punto (ej: /api/articles)
router.use(articleRoutes);

// (Quitamos la ruta del sitemap de aquí)

// --- ASÍ AÑADIRÁS 'pelis.lat' EN EL FUTURO ---
// 1. Crearías 'routes/movies.js'
// 2. Lo importarías aquí:
// const movieRoutes = require('./movies');
// 3. Y lo "usarías" aquí:
// router.use(movieRoutes);
// ... ¡Y listo! Sin tocar nada más.

// Exportamos el router principal
module.exports = router;