// =============================================
//         LFAF TECH - API MADRE (v1.0.0)
// =============================================
// Fiel a la estructura de tentacionpy/server.js

// IMPORTACIONES Y CONFIGURACIÓN INICIAL
// =============================================
require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors'); // Para permitir que tus 70 sitios se conecten

const app = express();
const PORT = process.env.PORT || 3000;

// =============================================
// MIDDLEWARES
// =============================================
// Habilita CORS para todos los dominios (tus 70+ sitios)
app.use(cors());
// Permite al servidor entender peticiones con JSON
app.use(express.json());

// =============================================
// CONEXIÓN A MONGODB
// =============================================
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ Conectado a MongoDB Atlas (LFAFTechRed)'))
  .catch(err => console.error('❌ Error de conexión a MongoDB:', err));

// =============================================
// MODELOS DE DATOS (SCHEMAS)
// =============================================
// Definimos el "molde" universal para todos los artículos
// de tu red de sitios (noticias, pelis, futbol, etc.)

const ArticleSchema = new mongoose.Schema({
    titulo: { type: String, required: true },
    descripcion: { type: String, required: true },
    imagen: { type: String, required: true }, // Solo la URL
    
    // CAMPO CLAVE:
    // Aquí guardaremos "noticias.lat", "futboleros.lat", etc.
    // Usaremos esto para filtrar qué contenido va a cada sitio.
    categoria: { 
        type: String, 
        required: true, 
        index: true // Un índice hace que las búsquedas por categoría sean ultra-rápidas
    }, 
    
    fuente: String,
    enlaceOriginal: String,
    fecha: { type: Date, default: Date.now }
}, { timestamps: true });

const Article = mongoose.model('Article', ArticleSchema);

// =============================================
// MIDDLEWARE DE AUTENTICACIÓN (PARA PROTEGER TU API)
// =============================================
// Esta función revisará que solo tú puedas AÑADIR contenido
const requireAdminKey = (req, res, next) => {
    const apiKey = req.headers['x-api-key'];
    if (apiKey && apiKey === process.env.ADMIN_API_KEY) {
        next(); // Clave correcta, puede continuar
    } else {
        res.status(403).json({ error: "Acceso no autorizado. API Key inválida o no proporcionada." });
    }
};

// =============================================
// RUTAS DE LA API PÚBLICA (Para tus 70 sitios)
// =============================================

// Ruta de bienvenida
app.get('/', (req, res) => {
    res.json({
        message: "Bienvenido a la API Central de LFAF Tech",
        status: "ok"
    });
});

/**
 * [PÚBLICO] Obtener artículos por categoría
 * Esta es la ruta que consumirán tus sitios estáticos.
 * * Ejemplo: GET https://lfaftechapi.onrender.com/api/articles?categoria=noticias.lat&limite=10
 */
app.get('/api/articles', async (req, res) => {
    try {
        const { categoria, limite, pagina } = req.query;

        if (!categoria) {
            return res.status(400).json({ error: "El parámetro 'categoria' es obligatorio." });
        }

        const limiteNum = parseInt(limite) || 20; // 20 artículos por defecto
        const paginaNum = parseInt(pagina) || 1;  // Página 1 por defecto
        const skip = (paginaNum - 1) * limiteNum;

        // Busca en la BD
        const articles = await Article.find({ categoria: categoria })
            .sort({ fecha: -1 }) // Más nuevos primero
            .skip(skip)
            .limit(limiteNum);
            
        // Contar total de documentos (para paginación)
        const total = await Article.countDocuments({ categoria: categoria });

        res.json({
            totalArticulos: total,
            totalPaginas: Math.ceil(total / limiteNum),
            paginaActual: paginaNum,
            articulos: articles
        });

    } catch (error) {
        console.error("Error en GET /api/articles:", error);
        res.status(500).json({ error: "Error interno del servidor." });
    }
});

// =============================================
// RUTAS DE LA API PRIVADA (Para ti y GNews)
// =============================================

/**
 * [PRIVADO] Añadir un nuevo artículo
 * Esta ruta la usarás tú (o un script) para poblar la base de datos.
 * Está protegida por la API Key.
 */
app.post('/api/articles', requireAdminKey, async (req, res) => {
    try {
        const { titulo, descripcion, imagen, categoria, fuente, enlaceOriginal, fecha } = req.body;

        if (!titulo || !descripcion || !imagen || !categoria) {
            return res.status(400).json({ error: "Campos obligatorios: titulo, descripcion, imagen, categoria." });
        }

        const newArticle = new Article({
            titulo,
            descripcion,
            imagen,
            categoria,
            fuente: fuente || 'Fuente desconocida',
            enlaceOriginal: enlaceOriginal || '#',
            fecha: fecha ? new Date(fecha) : new Date() // GNews te dará una fecha
        });

        await newArticle.save();
        res.status(201).json(newArticle);

    } catch (error) {
        console.error("Error en POST /api/articles:", error);
        res.status(500).json({ error: "Error al guardar el artículo." });
    }
});

// =============================================
// INICIAR SERVIDOR
// =============================================
app.listen(PORT, () => {
    console.log(`🚀 API Central LFAF Tech corriendo en http://localhost:${PORT}`);
});