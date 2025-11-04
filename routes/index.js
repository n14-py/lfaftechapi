const express = require('express');
const router = express.Router();

// Importamos el archivo de rutas de artículos (EXISTENTE)
const articleRoutes = require('./articles');

// Importamos el archivo de rutas de radio (EXISTENTE)
const radioRoutes = require('./radio');

// --- ¡LÍNEA AÑADIDA! ---
// Importamos el nuevo archivo de rutas de juegos
const gameRoutes = require('./game');


// Le decimos a Express que use el archivo 'articles.js' (EXISTENTE)
router.use(articleRoutes);

// Le decimos a Express que use también el archivo 'radio.js' (EXISTENTE)
router.use(radioRoutes);

// --- ¡LÍNEA AÑADIDA! ---
// Le decimos a Express que use también el archivo 'game.js'
router.use(gameRoutes);


// Exportamos el router principal
module.exports = router;