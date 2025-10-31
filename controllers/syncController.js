const axios = require('axios');
const Article = require('../models/article'); // Importamos el "molde"

/**
 * [NUEVA FUNCIÓN]
 * Llama a la API de DeepSeek para generar un ARTÍCULO COMPLETO
 * actuando como un reportero y usando la URL.
 */
async function getAIArticle(articleUrl) {
    // Si no hay URL, no podemos hacer nada
    if (!articleUrl || !articleUrl.startsWith('http')) {
        return null;
    }

    const API_URL = 'https://api.deepseek.com/v1/chat/completions';
    const headers = {
        'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`,
        'Content-Type': 'application/json'
    };

    // --- ¡EL NUEVO PROMPT! ---
    const systemPrompt = "Eres un reportero senior para el portal 'Noticias.lat'. Tu trabajo es escribir artículos de noticias completos, detallados y profesionales. No eres un asistente, eres un periodista. Escribe en un tono formal, objetivo pero atractivo. Debes generar un artículo muy extenso, con múltiples párrafos, desarrollando la información a profundidad. No digas 'según la fuente' o 'el artículo original dice'. Escribe la noticia como si fuera tuya. Responde únicamente con el artículo completo.";
    
    const userPrompt = `Por favor, actúa como reportero de Noticias.lat y escribe un artículo de noticias completo, extenso y detallado (idealmente más de 700 palabras) basado en la siguiente URL. Analiza el contenido de este enlace y redáctalo desde cero: ${articleUrl}`;
    // --- FIN DEL PROMPT ---

    const body = {
        model: "deepseek-chat", // O el modelo que estés usando
        messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt }
        ]
    };

    try {
        const response = await axios.post(API_URL, body, { headers });
        if (response.data.choices && response.data.choices.length > 0) {
            // Retorna el artículo completo
            return response.data.choices[0].message.content;
        }
        return null;
    } catch (error) {
        console.error(`Error llamando a DeepSeek para la URL ${articleUrl}:`, error.message);
        return null; // Si DeepSeek falla, continuamos sin el artículo
    }
}


/**
 * [PRIVADO] Sincronizar GNews con nuestra Base de Datos
 * (Lógica de la ruta POST /api/sync-gnews)
 */
exports.syncGNews = async (req, res) => {
    const API_KEY = process.env.GNEWS_API_KEY;
    
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
            
            const urlGNews = `https://gnews.io/api/v4/top-headlines?category=${cat.gnews}&lang=es&max=10&apikey=${API_KEY}`;
            
            let gnewsArticles = [];
            try {
                const response = await axios.get(urlGNews);
                gnewsArticles = response.data.articles;
            } catch (gnewsError) {
                console.error(`Error al llamar a GNews para ${cat.gnews}: ${gnewsError.message}`);
                errores.push(cat.gnews);
                continue; 
            }

            let operations = [];
            for (const article of gnewsArticles) {
                
                // --- ¡AQUÍ ESTÁ EL CAMBIO! ---
                // Le pasamos la URL original a nuestra nueva función de IA
                const articuloGenerado = await getAIArticle(article.url); 
                
                operations.push({
                    updateOne: {
                        filter: { enlaceOriginal: article.url }, 
                        update: {
                            $set: {
                                titulo: article.title,
                                descripcion: article.description,
                                contenido: article.content, // Guardamos el original por si acaso
                                imagen: article.image,
                                sitio: 'noticias.lat', 
                                categoria: cat.local,  
                                fuente: article.source.name,
                                enlaceOriginal: article.url,
                                fecha: new Date(article.publishedAt),
                                // --- ¡GUARDAMOS EL NUEVO ARTÍCULO! ---
                                articuloGenerado: articuloGenerado 
                            }
                        },
                        upsert: true 
                    }
                });
            }

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
        
        // Usamos la misma lógica: le pasamos el enlace original
        const articuloGenerado = await getAIArticle(enlaceOriginal);

        const newArticle = new Article({
            titulo, descripcion, imagen, categoria, sitio,
            contenido: contenido || descripcion,
            fuente: fuente || 'Fuente desconocida',
            enlaceOriginal: enlaceOriginal || '#',
            fecha: fecha ? new Date(fecha) : new Date(),
            articuloGenerado: articuloGenerado // Guardamos el artículo de la IA
        });

        await newArticle.save();
        res.status(201).json(newArticle);
    } catch (error) { 
        if (error.code === 11000) { 
             return res.status(409).json({ error: "Error: Ya existe un artículo con ese enlace original." });
        }
        console.error("Error en createManualArticle:", error);
        res.status(500).json({ error: "Error al guardar el artículo." });
    }
};