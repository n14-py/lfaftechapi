const express = require('express');
const router = express.Router();
const articleController = require('../controllers/articleController');
const syncController = require('../controllers/syncController');
const mongoose = require('mongoose'); // Necesario para el middleware

// =============================================
// MIDDLEWARE DE AUTENTICACIÓN (traído de server.js)
// =============================================
// Esta función revisará que solo tú puedas AÑADIR contenido
const requireAdminKey = (req, res, next) => {
    const apiKey = req.headers['x-api-key'];
    if (apiKey && apiKey === process.env.ADMIN_API_KEY) {
        next(); // Clave correcta, puede continuar
    } else {
        res.status(403).json({ error: "Acceso no autorizado." });
    }
};

// =============================================
// RUTAS PÚBLICAS (para tus 70 sitios)
// =============================================

// GET /api/articles/recommended
// (Debe ir ANTES de /:id para que no confunda "recommended" con un ID)
router.get('/articles/recommended', articleController.getRecommendedArticles);

// GET /api/articles?sitio=...&categoria=...
router.get('/articles', articleController.getArticles);

// GET /api/article/:id
router.get('/article/:id', articleController.getArticleById);

// =============================================
// RUTAS PRIVADAS (para ti y el Cron Job)
// =============================================

// POST /api/sync-gnews
router.post('/sync-gnews', requireAdminKey, syncController.syncGNews);

// POST /api/articles
router.post('/articles', requireAdminKey, syncController.createManualArticle);

// Exportamos el router para que server.js pueda usarlo
module.exports = router;