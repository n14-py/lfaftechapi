const axios = require('axios');
const Article = require('../models/article');

// --- ¡NUEVO! CARGAMOS LAS 5 API KEYS ---
const DEEPSEEK_API_KEYS = [
    process.env.DEEPSEEK_API_KEY_1,
    process.env.DEEPSEEK_API_KEY_2,
    process.env.DEEPSEEK_API_KEY_3,
    process.env.DEEPSEEK_API_KEY_4,
    process.env.DEEPSEEK_API_KEY_5,
].filter(Boolean); // .filter(Boolean) quita las que estén vacías

/**
 * Llama a la API de DeepSeek.
 * AHORA ACEPTA LA API KEY QUE DEBE USAR.
 */
async function getAIArticle(articleUrl, apiKey) {
    if (!articleUrl || !articleUrl.startsWith('http')) {
        return null;
    }
    
    // Si no hay API keys configuradas, salimos.
    if (!apiKey) {
        console.error("Error: No se proporcionó una API key de DeepSeek.");
        return null;
    }

    const API_URL = 'https://api.deepseek.com/v1/chat/completions';
    const headers = {
        'Authorization': `Bearer ${apiKey}`, // Usa la key específica
        'Content-Type': 'application/json'
    };

    const systemPrompt = "Eres un reportero senior para el portal 'Noticias.lat'. Tu trabajo es escribir artículos de noticias completos, detallados y profesionales. No eres un asistente, eres un periodista. Escribe en un tono formal, objetivo pero atractivo. Debes generar un artículo muy extenso, con múltiples párrafos. No digas 'según la fuente'. Escribe la noticia como si fuera tuya. IMPORTANTE: No uses ningún formato Markdown, como `##` para títulos o `**` para negritas. Escribe solo texto plano.";
    const userPrompt = `Por favor, actúa como reportero de Noticias.lat y escribe un artículo de noticias completo y extenso (idealmente más de 700 palabras) basado en la siguiente URL. Analiza el contenido de este enlace y redáctalo desde cero: ${articleUrl}`;

    const body = {
        model: "deepseek-chat",
        messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt }
        ]
    };

    try {
        const response = await axios.post(API_URL, body, { headers });
        if (response.data.choices && response.data.choices.length > 0) {
            // Retorna el artículo completo Y el artículo original para guardarlo
            return {
                articuloGenerado: response.data.choices[0].message.content,
                originalArticle: articleUrl // Devolvemos la URL para el 'filter'
            };
        }
        return null;
    } catch (error) {
        // Si una API falla (ej: límite de peticiones), no paramos, solo lo reportamos.
        console.error(`Error con API Key ${apiKey.substring(0, 5)}... para URL ${articleUrl}:`, error.message);
        return null; 
    }
}


/**
 * [PRIVADO] Sincronizar GNews con nuestra Base de Datos
 * (Lógica de la ruta POST /api/sync-gnews)
 * * --- ¡VERSIÓN PARALELA DE ALTO RENDIMIENTO! ---
 */
exports.syncGNews = async (req, res) => {
    if (DEEPSEEK_API_KEYS.length === 0) {
        return res.status(500).json({ error: "No hay API keys de DeepSeek configuradas en el .env" });
    }
    console.log(`Iniciando sync paralelo con ${DEEPSEEK_API_KEYS.length} API keys.`);

    const API_KEY_GNEWS = process.env.GNEWS_API_KEY;
    const categorias = [
        { gnews: 'general', local: 'general' },
        { gnews: 'sports', local: 'deportes' },
        { gnews: 'technology', local: 'tecnologia' },
        { gnews: 'entertainment', local: 'entretenimiento' }
    ];

    let totalArticulosNuevos = 0;
    let totalArticulosActualizados = 0;
    let erroresGNews = [];
    let articulosParaIA = [];

    try {
        // --- PASO 1: Obtener TODOS los artículos de GNews primero ---
        for (const cat of categorias) {
            console.log(`Obteniendo noticias de GNews para: ${cat.local}...`);
            
            // --- ¡NUEVO LÍMITE DE 20! --- (Puedes subirlo a 30 si tu plan de $7 lo soporta)
            const urlGNews = `https://gnews.io/api/v4/top-headlines?category=${cat.gnews}&lang=es&max=20&apikey=${API_KEY_GNEWS}`;
            
            try {
                const response = await axios.get(urlGNews);
                // Añadimos los artículos a la lista, guardando su categoría
                response.data.articles.forEach(article => {
                    articulosParaIA.push({ ...article, categoriaLocal: cat.local });
                });
            } catch (gnewsError) {
                console.error(`Error al llamar a GNews para ${cat.gnews}: ${gnewsError.message}`);
                erroresGNews.push(cat.gnews);
            }
        }
        
        console.log(`Se obtuvieron ${articulosParaIA.length} artículos de GNews. Iniciando generación paralela con IA...`);

        // --- PASO 2: Crear el array de "Promesas" para la IA (El trabajo en paralelo) ---
        const promesasDeArticulos = articulosParaIA.map((article, index) => {
            // --- ¡Rotamos las 5 API Keys! ---
            // Ej: Artículo 0 usa Key 0, Artículo 1 usa Key 1, ..., Artículo 5 usa Key 0
            const apiKeyParaUsar = DEEPSEEK_API_KEYS[index % DEEPSEEK_API_KEYS.length];
            
            // Retornamos la promesa de la llamada a la IA
            return getAIArticle(article.url, apiKeyParaUsar)
                .then(resultadoIA => {
                    // Combinamos el resultado de GNews con el de la IA
                    return { ...article, ...resultadoIA };
                });
        });

        // --- PASO 3: Ejecutar TODAS las promesas al mismo tiempo ---
        // El servidor esperará aquí hasta que las 80 peticiones terminen (o fallen)
        const resultadosCompletos = await Promise.all(promesasDeArticulos);

        console.log(`Generación con IA completada. ${resultadosCompletos.length} artículos procesados.`);

        // --- PASO 4: Preparar la escritura en la Base de Datos ---
        const operations = resultadosCompletos
            .filter(r => r && r.articuloGenerado) // Filtramos los que fallaron
            .map(article => ({
                updateOne: {
                    filter: { enlaceOriginal: article.url }, // Usamos la URL (article.url)
                    update: {
                        $set: {
                            titulo: article.title,
                            descripcion: article.description,
                            contenido: article.content,
                            imagen: article.image,
                            sitio: 'noticias.lat',
                            categoria: article.categoriaLocal, // Usamos la categoría que guardamos
                            fuente: article.source.name,
                            enlaceOriginal: article.url,
                            fecha: new Date(article.publishedAt),
                            articuloGenerado: article.articuloGenerado // ¡El artículo de la IA!
                        }
                    },
                    upsert: true 
                }
            }));

        // --- PASO 5: Guardar todo en la Base de Datos ---
        if (operations.length > 0) {
            console.log(`Guardando ${operations.length} artículos en la base de datos...`);
            const result = await Article.bulkWrite(operations);
            totalArticulosNuevos = result.upsertedCount;
            totalArticulosActualizados = result.modifiedCount;
        }

        console.log("¡Sincronización paralela completada!");
        res.json({ 
            message: "Sincronización paralela completada.", 
            nuevosArticulosGuardados: totalArticulosNuevos,
            articulosActualizados: totalArticulosActualizados,
            articulosFallidosIA: articulosParaIA.length - operations.length,
            categoriasGNewsConError: erroresGNews
        });

    } catch (error) {
        console.error("Error catastrófico en syncGNews (paralelo):", error.message);
        res.status(500).json({ error: "Error al sincronizar con GNews (paralelo)." });
    }
};

/**
 * [PRIVADO] Añadir un nuevo artículo manualmente
 * (Esta función sigue siendo secuencial/lenta, pero se usa menos)
 */
exports.createManualArticle = async (req, res) => {
    try {
        if (DEEPSEEK_API_KEYS.length === 0) {
            return res.status(500).json({ error: "No hay API keys de DeepSeek configuradas." });
        }
        
        const { titulo, descripcion, imagen, categoria, sitio, fuente, enlaceOriginal, fecha, contenido } = req.body;
        
        // Usa la primera API key para la creación manual
        const resultadoIA = await getAIArticle(enlaceOriginal, DEEPSEEK_API_KEYS[0]);

        const newArticle = new Article({
            titulo, descripcion, imagen, categoria, sitio,
            contenido: contenido || descripcion,
            fuente: fuente || 'Fuente desconocida',
            enlaceOriginal: enlaceOriginal || '#',
            fecha: fecha ? new Date(fecha) : new Date(),
            articuloGenerado: resultadoIA ? resultadoIA.articuloGenerado : null
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