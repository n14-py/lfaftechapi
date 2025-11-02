const express = require('express');
const router = express.Router();
const radioController = require('../controllers/radioController');
// (No necesitamos caché aquí porque queremos datos en vivo)

// --- RUTAS PÚBLICAS PARA TURADIO.LAT ---

// Ruta para buscar estaciones
// Ej: /api/radio/buscar?pais=PY
// Ej: /api/radio/buscar?genero=rock
// Ej: /api/radio/buscar?pais=AR&genero=pop
router.get('/radio/buscar', radioController.searchRadios);

// Ruta para obtener la lista de géneros para los filtros
// Ej: /api/radio/generos
router.get('/radio/generos', radioController.getTags);

// Ruta para obtener la lista de países para los filtros
// Ej: /api/radio/paises
router.get('/radio/paises', radioController.getCountries);


module.exports = router;