// =============================================
//         LFAF TECH - API MADRE (v2.4.0)
// =============================================
require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// =============================================
// MIDDLEWARES Y CONEXIÓN A DB
// =============================================
app.use(cors());
app.use(express.json());

mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ Conectado a MongoDB Atlas (LFAFTechRed)'))
  .catch(err => console.error('❌ Error de conexión a MongoDB:', err));

// =============================================
// MODELO DE DATOS (SCHEMA)
// =============================================
const ArticleSchema = new mongoose.Schema({
    titulo: { type: String, required: true },
    descripcion: { type: String, required: true },
    imagen: { type: String, required: true },
    contenido: { type: String },
    categoria: { type: String, required: true, index: true }, 
    sitio: { type: String, required: true, index: true },
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

app.get('/', (req, res) => res.json({ message: "API Central v2.4" }));

// GET Artículo Individual (Sin cambios)
app.get('/api/article/:id', async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ error: "ID no válido." });
        }
        const article = await Article.findById(req.params.id);
        if (!article) return res.status(404).json({ error: "Artículo no encontrado." });
        res.json(article);
    } catch (error) {
        res.status(500).json({ error: "Error interno del servidor." });
    }
});

// GET Lista de Artículos (Sin cambios)
app.get('/api/articles', async (req, res) => {
    try {
        const { sitio, categoria, limite, pagina } = req.query;
        if (!sitio) return res.status(400).json({ error: "El parámetro 'sitio' es obligatorio." });
        
        const limiteNum = parseInt(limite) || 12;
        const paginaNum = parseInt(pagina) || 1;
        const skip = (paginaNum - 1) * limiteNum;
        let filtro = { sitio: sitio };
        if (categoria && categoria !== 'todos') {
            filtro.categoria = categoria;
        }

        const articles = await Article.find(filtro).sort({ fecha: -1 }).skip(skip).limit(limiteNum);
        const total = await Article.countDocuments(filtro);

        res.json({
            totalArticulos: total,
            totalPaginas: Math.ceil(total / limiteNum),
            paginaActual: paginaNum,
            articulos: articles
        });
    } catch (error) {
        res.status(500).json({ error: "Error interno del servidor." });
    }
});

// =============================================
// ¡NUEVA RUTA!
// [PÚBLICO] Obtener artículos RECOMENDADOS
// =============================================
app.get('/api/articles/recommended', async (req, res) => {
    try {
        const { sitio, categoria, excludeId } = req.query;

        if (!sitio || !categoria) {
            return res.status(400).json({ error: "Parámetros 'sitio' y 'categoria' son obligatorios." });
        }

        let filtro = { 
            sitio: sitio, 
            categoria: categoria,
            _id: { $ne: excludeId } // Excluir el artículo que ya se está viendo
        };

        // .aggregate([ { $match: filtro }, { $sample: { size: 4 } } ])
        // $sample es rápido pero puede ser costoso. Usamos skip/limit por ahora.
        const randomSkip = Math.floor(Math.random() * 20); // Salta un nro aleatorio de 0-20
        
        const recommended = await Article.find(filtro)
            .sort({ fecha: -1 })
            .skip(randomSkip)
            .limit(4); // Trae 4 recomendados

        res.json(recommended);

    } catch (error) {
        console.error("Error en GET /api/articles/recommended:", error);
        res.status(500).json({ error: "Error interno del servidor." });
    }
});


// =============================================
// RUTAS DE LA API PRIVADA (Sincronización)
// =============================================

/**
 * [PRIVADO] Sincronizar GNews con nuestra Base de Datos
 * ¡ACTUALIZADO! Más categorías y todo LATAM.
 */
app.post('/api/sync-gnews', requireAdminKey, async (req, res) => {
    const API_KEY = process.env.GNEWS_API_KEY;
    
    // 1. ¡MÁS CATEGORÍAS!
    const categorias = [
        { gnews: 'general', local: 'general' },
        { gnews: 'sports', local: 'deportes' },
        { gnews: 'technology', local: 'tecnologia' },
        { gnews: 'entertainment', local: 'entretenimiento' },
        { gnews: 'science', local: 'ciencia' }, // <-- NUEVA
        { gnews: 'health', local: 'salud' }    // <-- NUEVA
    ];

    let totalNuevos = 0;
    let totalActualizados = 0;
    let errores = [];

    try {
        for (const cat of categorias) {
            console.log(`Sincronizando categoría: ${cat.local}...`);
            
            // 2. ¡TODO LATINOAMÉRICA! (Quitamos &country=py)
            const urlGNews = `https://gnews.io/api/v4/top-headlines?category=${cat.gnews}&lang=es&max=10&apikey=${API_KEY}`;
            
            let gnewsArticles = [];
            try {
                const response = await axios.get(urlGNews);
                gnewsArticles = response.data.articles;
            } catch (gnewsError) {
                console.error(`Error al llamar a GNews para ${cat.gnews}: ${gnewsError.message}`);
                errores.push(cat.gnews);
                continue; // Salta a la siguiente categoría si esta falla
            }

            const operations = gnewsArticles.map(article => ({
                updateOne: {
                    filter: { enlaceOriginal: article.url },
                    update: {
                        $set: {
                            titulo: article.title,
                            descripcion: article.description,
                            contenido: article.content,
                            imagen: article.image,
                            sitio: 'noticias.lat',
                            categoria: cat.local,
                            fuente: article.source.name,
                            enlaceOriginal: article.url,
                            fecha: new Date(article.publishedAt)
                        }
                    },
                    upsert: true
                }
            }));

            if (operations.length > 0) {
                const result = await Article.bulkWrite(operations);
                totalNuevos += result.upsertedCount;
                totalActualizados += result.modifiedCount;
            }
        } // Fin del bucle

        res.json({ 
            message: "Sincronización completada.", 
            nuevosArticulosGuardados: totalNuevos,
            articulosActualizados: totalActualizados,
            categoriasConError: errores
        });

    } catch (error) {
        console.error("Error en /api/sync-gnews:", error.message);
        res.status(500).json({ error: "Error al sincronizar con GNews." });
    }
});

// ... (POST /api/articles se queda igual) ...
app.post('/api/articles', requireAdminKey, async (req, res) => { /*...*/ });

// =============================================
// INICIAR SERVIDOR
// =============================================
app.listen(PORT, () => {
    console.log(`🚀 API Central LFAF Tech (v2.4) corriendo en http://localhost:${PORT}`);
});