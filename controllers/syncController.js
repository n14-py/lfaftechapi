const axios = require('axios');
const Article = require('../models/article'); // Importamos el "molde"

/**
 * [PRIVADO] Sincronizar GNews con nuestra Base de Datos
 * (Lógica de la ruta POST /api/sync-gnews)
 */
exports.syncGNews = async (req, res) => {
    const API_KEY = process.env.GNEWS_API_KEY;
    
    // Categorías que SÍ funcionan en el plan gratuito
    const categorias = [
        { gnews: 'general', local: 'general' },
        { gnews: 'sports', local: 'deportes' },
        { gnews: 'technology', local: 'tecnologia' },
        { gnews: 'entertainment', local: 'entretenimiento' }
    ];

    let totalNuevos = 0;
    let totalActualizados = 0;
    let errores = [];

    try {
        for (const cat of categorias) {
            console.log(`Sincronizando categoría: ${cat.local}...`);
            
            // Trae noticias en español, sin filtro de país (todo LATAM)
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

            // Prepara las operaciones "Upsert" (Update + Insert)
            const operations = gnewsArticles.map(article => ({
                updateOne: {
                    filter: { enlaceOriginal: article.url }, // Evita duplicados
                    update: {
                        $set: {
                            titulo: article.title,
                            descripcion: article.description,
                            contenido: article.content,
                            imagen: article.image,
                            sitio: 'noticias.lat', // Todas pertenecen a este sitio
                            categoria: cat.local,  // Guardamos la categoría local
                            fuente: article.source.name,
                            enlaceOriginal: article.url,
                            fecha: new Date(article.publishedAt)
                        }
                    },
                    upsert: true // Si no existe, lo crea
                }
            }));

            // Ejecuta todas las operaciones de esta categoría juntas
            if (operations.length > 0) {
                const result = await Article.bulkWrite(operations);
                totalNuevos += result.upsertedCount;
                totalActualizados += result.modifiedCount;
            }
        } // Fin del bucle de categorías

        res.json({ 
            message: "Sincronización completada.", 
            nuevosArticulosGuardados: totalNuevos,
            articulosActualizados: totalActualizados,
            categoriasConError: errores
        });

    } catch (error) {
        console.error("Error en syncGNews:", error.message);
        res.status(500).json({ error: "Error al sincronizar con GNews." });
    }
};

/**
 * [PRIVADO] Añadir un nuevo artículo manualmente
 * (Lógica de la ruta POST /api/articles)
 */
exports.createManualArticle = async (req, res) => {
    try {
        const { titulo, descripcion, imagen, categoria, sitio, fuente, enlaceOriginal, fecha, contenido } = req.body;
        
        const newArticle = new Article({
            titulo, descripcion, imagen, categoria, sitio,
            contenido: contenido || descripcion, // Relleno por si acaso
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
        console.error("Error en createManualArticle:", error);
        res.status(500).json({ error: "Error al guardar el artículo." });
    }
};