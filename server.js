// =============================================
//         LFAF TECH - API MADRE (v2.0.0)
// =============================================

// IMPORTACIONES Y CONFIGURACIÓN INICIAL
// =============================================
require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const axios = require('axios'); // <-- NUEVA IMPORTACIÓN

const app = express();
const PORT = process.env.PORT || 3000;

// =============================================
// MIDDLEWARES
// =============================================
app.use(cors());
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
const ArticleSchema = new mongoose.Schema({
    titulo: { type: String, required: true },
    descripcion: { type: String, required: true },
    imagen: { type: String, required: true },
    categoria: { type: String, required: true, index: true }, 
    fuente: String,
    enlaceOriginal: { type: String, unique: true }, // <-- Hacemos el enlace único
    fecha: { type: Date, default: Date.now }
}, { timestamps: true });

const Article = mongoose.model('Article', ArticleSchema);

// =============================================
// MIDDLEWARE DE AUTENTICACIÓN (PARA PROTEGER TU API)
// =============================================
const requireAdminKey = (req, res, next) => {
    const apiKey = req.headers['x-api-key'];
    if (apiKey && apiKey === process.env.ADMIN_API_KEY) {
        next();
    } else {
        res.status(403).json({ error: "Acceso no autorizado." });
    }
};

// =============================================
// RUTAS DE LA API PÚBLICA (Para tus 70 sitios)
// =============================================

app.get('/', (req, res) => {
    res.json({
        message: "Bienvenido a la API Central de LFAF Tech",
        status: "ok"
    });
});

app.get('/api/articles', async (req, res) => {
    try {
        const { categoria, limite, pagina } = req.query;
        if (!categoria) {
            return res.status(400).json({ error: "El parámetro 'categoria' es obligatorio." });
        }
        const limiteNum = parseInt(limite) || 20;
        const paginaNum = parseInt(pagina) || 1;
        const skip = (paginaNum - 1) * limiteNum;

        const articles = await Article.find({ categoria: categoria })
            .sort({ fecha: -1 })
            .skip(skip)
            .limit(limiteNum);
            
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
 * [PRIVADO] Sincronizar GNews con nuestra Base de Datos
 * Esta es la nueva ruta que llenará tu base de datos.
 */
app.post('/api/sync-gnews', requireAdminKey, async (req, res) => {
    try {
        const API_KEY = process.env.GNEWS_API_KEY;
        const urlGNews = `https://gnews.io/api/v4/top-headlines?category=general&lang=es&country=py&max=10&apikey=${API_KEY}`;
        
        // 1. Llama a GNews
        const response = await axios.get(urlGNews);
        const gnewsArticles = response.data.articles;

        let nuevosArticulosGuardados = 0;

        // 2. Prepara las operaciones para guardar en MongoDB
        // Usamos "updateOne" con "upsert" para evitar duplicados
        const operations = gnewsArticles.map(article => {
            return Article.updateOne(
                { enlaceOriginal: article.url }, // El filtro: busca si ya existe un artículo con esta URL
                {
                    $set: { // Los datos: qué guardar o actualizar
                        titulo: article.title,
                        descripcion: article.description,
                        imagen: article.image,
                        categoria: 'noticias.lat', // ¡La categoría que queremos!
                        fuente: article.source.name,
                        enlaceOriginal: article.url,
                        fecha: new Date(article.publishedAt)
                    }
                },
                { upsert: true } // ¡La magia! Si no existe, lo crea (inserta). Si existe, lo actualiza.
            );
        });

        // 3. Ejecuta todas las operaciones en paralelo
        const results = await Promise.all(operations);

        // Contamos cuántos artículos fueron realmente *nuevos*
        results.forEach(r => {
            if (r.upsertedCount > 0) {
                nuevosArticulosGuardados++;
            }
        });

        res.json({ 
            message: "Sincronización con GNews completada", 
            articulosRecibidos: gnewsArticles.length,
            nuevosArticulosGuardados: nuevosArticulosGuardados
        });

    } catch (error) {
        console.error("Error en /api/sync-gnews:", error.message);
        res.status(500).json({ error: "Error al sincronizar con GNews." });
    }
});


/**
 * [PRIVADO] Añadir un nuevo artículo manualmente
 */
app.post('/api/articles', requireAdminKey, async (req, res) => {
    try {
        const { titulo, descripcion, imagen, categoria, fuente, enlaceOriginal, fecha } = req.body;
        const newArticle = new Article({
            titulo, descripcion, imagen, categoria,
            fuente: fuente || 'Fuente desconocida',
            enlaceOriginal: enlaceOriginal || '#',
            fecha: fecha ? new Date(fecha) : new Date()
        });
        await newArticle.save();
        res.status(201).json(newArticle);
    } catch (error) {
        if (error.code === 11000) { // Error de duplicado
             return res.status(409).json({ error: "Error: Ya existe un artículo con ese enlace original." });
        }
        res.status(500).json({ error: "Error al guardar el artículo." });
    }
});

// =============================================
// INICIAR SERVIDOR
// =============================================
app.listen(PORT, () => {
    console.log(`🚀 API Central LFAF Tech (v2.0) corriendo en http://localhost:${PORT}`);
});