const express = require('express');
const router = express.Router();

// Importamos el archivo de rutas de artículos (EXISTENTE)
const articleRoutes = require('./articles');

// Importamos el archivo de rutas de radio (EXISTENTE)
const radioRoutes = require('./radio');

// Importamos el nuevo archivo de rutas de juegos (EXISTENTE)
const gameRoutes = require('./game');

// --- ¡NUEVO! Importamos las rutas de Radio Relax ---
const radioRelaxRoutes = require('./radioRelax');


// Le decimos a Express que use el archivo 'articles.js' (EXISTENTE)
router.use(articleRoutes);

// Le decimos a Express que use también el archivo 'radio.js' (EXISTENTE)
router.use(radioRoutes);

// Le decimos a Express que use también el archivo 'game.js' (EXISTENTE)
router.use(gameRoutes);

// --- ¡NUEVO! Le decimos a Express que use las rutas de Relax ---
// Esto hará que todas las rutas en radioRelax.js empiecen por /api/relax
router.use('/relax', radioRelaxRoutes);


// Exportamos el router principal
module.exports = router;