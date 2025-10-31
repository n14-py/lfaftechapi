const axios = require('axios');
const Article = require('../models/article'); // Importamos el "molde"

// --- NUEVA FUNCIÓN DE AYUDA ---
/**
 * Llama a la API de DeepSeek para generar un resumen.
 * (Usamos el formato compatible con OpenAI)
 */
async function getDeepSeekSummary(textoOriginal) {
    // Si no hay contenido, no gastamos API
    if (!textoOriginal || textoOriginal.trim().length < 100) {
        return null; // Devuelve null si el texto es muy corto
    }

    // Nota: GNews gratis a veces solo da un fragmento.
    // Le pasamos ese fragmento a DeepSeek. Es más rápido y fiable
    // que intentar que la IA "visite" la URL (que puede fallar).
    const textoLimpio = textoOriginal.split(' [')[0]; // Limpia el "read more"

    const API_URL = 'https://api.deepseek.com/v1/chat/completions';
    const headers = {
        'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`,
        'Content-Type': 'application/json'
    };

    const body = {
        model: "deepseek-chat", // O el modelo que estés usando
        messages: [
            {
                role: "system",
                content: "Eres un asistente de noticias. Tu trabajo es leer un artículo y escribir un resumen conciso, profesional y atractivo en español. El resumen debe capturar la idea principal en 2 o 3 frases. No incluyas tu opinión. Responde solo con el resumen."
            },
            {
                role: "user",
                content: `Genera un resumen para el siguiente artículo:\n\n${textoLimpio}`
            }
        ]
    };

    try {
        const response = await axios.post(API_URL, body, { headers });
        if (response.data.choices && response.data.choices.length > 0) {
            return response.data.choices[0].message.content;
        }
        return null;
    } catch (error) {
        console.error("Error llamando a DeepSeek API:", error.message);
        return null; // Si DeepSeek falla, continuamos sin el resumen
    }
}
// --- FIN DE LA NUEVA FUNCIÓN ---


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

            // --- ¡CAMBIO IMPORTANTE AQUÍ! ---
            // Reemplazamos el .map() por un bucle for...of
            // para poder usar 'await' y esperar por el resumen de DeepSeek.

            let operations = [];
            for (const article of gnewsArticles) {
                
                // ¡AQUÍ LLAMAMOS A LA IA!
                // Usamos el 'content' que nos da GNews.
                const resumenIA = await getDeepSeekSummary(article.content); 
                
                // Preparamos la operación de "Upsert"
                operations.push({
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
                                fecha: new Date(article.publishedAt),
                                resumenIA: resumenIA // <-- ¡GUARDAMOS EL RESUMEN!
                            }
                        },
                        upsert: true // Si no existe, lo crea
                    }
                });
            }
            // --- FIN DEL CAMBIO ---

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
        
        // ¡Podríamos llamar a la IA aquí también!
        const resumenIA = await getDeepSeekSummary(contenido || descripcion);

        const newArticle = new Article({
            titulo, descripcion, imagen, categoria, sitio,
            contenido: contenido || descripcion, // Relleno por si acaso
            fuente: fuente || 'Fuente desconocida',
            enlaceOriginal: enlaceOriginal || '#',
            fecha: fecha ? new Date(fecha) : new Date(),
            resumenIA: resumenIA // <-- Añadido aquí también
        });

        await newArticle.save();
        res.status(201).json(newArticle);
    } catch (error) { // <-- ¡ESTA ES LA LLAVE QUE FALTABA!
        if (error.code === 11000) { // Error de duplicado
             return res.status(409).json({ error: "Error: Ya existe un artículo con ese enlace original." });
        }
        console.error("Error en createManualArticle:", error);
        res.status(500).json({ error: "Error al guardar el artículo." });
    }
};