// =============================================
//         LFAF TECH - API MADRE (v2.2.0)
// =============================================
require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const axios = require('axios');

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
// ¡AQUÍ ESTÁ EL PRIMER CAMBIO!
const ArticleSchema = new mongoose.Schema({
    titulo: { type: String, required: true },
    descripcion: { type: String, required: true },
    imagen: { type: String, required: true },
    
    // ¡NUEVO CAMPO AÑADIDO!
    contenido: { type: String }, // Aquí guardaremos el resumen largo

    categoria: { type: String, required: true, index: true }, 
    fuente: String,
    enlaceOriginal: { type: String, unique: true },
    fecha: { type: Date, default: Date.now }
}, { timestamps: true });

const Article = mongoose.model('Article', ArticleSchema);

// =============================================
// MIDDLEWARE DE AUTENTICACIÓN
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
// RUTAS DE LA API PÚBLICA
// =============================================

app.get('/', (req, res) => {
    res.json({
        message: "Bienvenido a la API Central de LFAF Tech",
        status: "ok"
    });
});

// Ruta de Lista (sin cambios)
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

// Ruta de Detalle (sin cambios)
app.get('/api/article/:id', async (req, res) => {
    try {
        const articleId = req.params.id;
        if (!mongoose.Types.ObjectId.isValid(articleId)) {
            return res.status(400).json({ error: "ID de artículo no válido." });
        }
        const article = await Article.findById(articleId);
        if (!article) {
            return res.status(404).json({ error: "Artículo no encontrado." });
        }
        res.json(article);
    } catch (error) {
        console.error("Error en GET /api/article/:id:", error);
        res.status(500).json({ error: "Error interno del servidor." });
    }
});


// =============================================
// RUTAS DE LA API PRIVADA (Para ti y GNews)
// =============================================

/**
 * [PRIVADO] Sincronizar GNews con nuestra Base de Datos
 */
app.post('/api/sync-gnews', requireAdminKey, async (req, res) => {
    try {
        const API_KEY = process.env.GNEWS_API_KEY;
        const urlGNews = `https://gnews.io/api/v4/top-headlines?category=general&lang=es&country=py&max=10&apikey=${API_KEY}`;
        
        const response = await axios.get(urlGNews);
        const gnewsArticles = response.data.articles;
        let nuevosArticulosGuardados = 0;

        // ¡AQUÍ ESTÁ EL SEGUNDO CAMBIO!
        const operations = gnewsArticles.map(article => {
            return Article.updateOne(
                { enlaceOriginal: article.url },
                {
                    $set: {
                        titulo: article.title,
                        descripcion: article.description,
                        imagen: article.image,
                        
                        // ¡NUEVA LÍNEA! Guardamos el contenido largo
                        contenido: article.content, 

                        categoria: 'noticias.lat',
                        fuente: article.source.name,
                        enlaceOriginal: article.url,
                        fecha: new Date(article.publishedAt)
                    }
                },
                { upsert: true }
            );
        });
        // --- FIN DEL CAMBIO ---

        const results = await Promise.all(operations);
        results.forEach(r => {
            if (r.upsertedCount > 0) {
                nuevosArticulosGuardados++;
            }
        });

        res.json({ 
            message: "Sincronización con GNews completada", 
            articulosRecibidos: gnewsArticles.length,
            nuevosArticulosGuardados: nuevosArticulosGuardados,
            articulosActualizados: results.length - nuevosArticulosGuardados
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
        // ¡AQUÍ ESTÁ EL TERCER CAMBIO!
        const { titulo, descripcion, imagen, categoria, fuente, enlaceOriginal, fecha, contenido } = req.body;
        
        const newArticle = new Article({
            titulo, descripcion, imagen, categoria,
            // Si no nos mandan 'contenido', usamos 'descripcion' como relleno.
            contenido: contenido || descripcion, 
            fuente: fuente || 'Fuente desconocida',
            enlaceOriginal: enlaceOriginal || '#',
            fecha: fecha ? new Date(fecha) : new Date()
        });
        // --- FIN DEL CAMBIO ---

        await newArticle.save();
        res.status(201).json(newArticle);
    } catch (error) {
        if (error.code === 11000) {
             return res.status(409).json({ error: "Error: Ya existe un artículo con ese enlace original." });
        }
        res.status(500).json({ error: "Error al guardar el artículo." });
    }
});

// =============================================
// INICIAR SERVIDOR
// =============================================
app.listen(PORT, () => {
    console.log(`🚀 API Central LFAF Tech (v2.2) corriendo en http://localhost:${PORT}`);
});