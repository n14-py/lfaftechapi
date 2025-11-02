const express = require('express');
const router = express.Router();

// Importamos el archivo de rutas de artículos (EXISTENTE)
const articleRoutes = require('./articles');

// --- ¡LÍNEA 1 AÑADIDA! ---
// Importamos el nuevo archivo de rutas de radio
const radioRoutes = require('./radio');


// Le decimos a Express que use el archivo 'articles.js' (EXISTENTE)
router.use(articleRoutes);

// --- ¡LÍNEA 2 AÑADIDA! ---
// Le decimos a Express que use también el archivo 'radio.js'
router.use(radioRoutes);


// --- ASÍ AÑADIRÁS 'pelis.lat' EN EL FUTURO ---
// ...

// Exportamos el router principal
module.exports = router;