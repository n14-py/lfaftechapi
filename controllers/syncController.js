const axios = require('axios');
const Article = require('../models/article');

// --- CARGAMOS LAS 5 API KEYS DE DEEPSEEK ---
const DEEPSEEK_API_KEYS = [
    process.env.DEEPSEEK_API_KEY_1,
    process.env.DEEPSEEK_API_KEY_2,
    process.env.DEEPSEEK_API_KEY_3,
    process.env.DEEPSEEK_API_KEY_4,
    process.env.DEEPSEEK_API_KEY_5,
].filter(Boolean);

// --- CLAVES DE API ---
const API_KEY_GNEWS = process.env.GNEWS_API_KEY;
const API_KEY_NEWSDATA = process.env.NEWSDATA_API_KEY;

// --- LÍMITES DE API (10 por país) ---
const MAX_ARTICLES_PER_COUNTRY = 10; 

// --- Lista de 19 países de LATAM para NEWSDATA.IO ---
const PAISES_NEWSDATA = [
    "ar", "bo", "br", "cl", "co", "cr", "cu", "ec", "sv", 
    "gt", "hn", "mx", "ni", "pa", "py", "pe", "do", "uy", "ve"
];

// --- Lista de 10 países de LATAM para GNEWS (los que mejor cobertura tienen) ---
const PAISES_GNEWS = [
    "ar", "br", "cl", "co", "ec", "mx", "pe", "py", "uy", "ve"
];

// --- ¡NUEVO! Función para esperar (evita el error 429) ---
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));


/**
 * Llama a la API de DeepSeek.
 */
async function getAIArticle(articleUrl, apiKey) {
    if (!articleUrl || !articleUrl.startsWith('http')) {
        return null;
    }
    if (!apiKey) {
        console.error("Error: No se proporcionó una API key de DeepSeek.");
        return null;
    }
    const API_URL = 'https://api.deepseek.com/v1/chat/completions';
    const headers = {
        'Authorization': `Bearer ${apiKey}`,
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
            return {
                articuloGenerado: response.data.choices[0].message.content,
                originalArticle: articleUrl
            };
        }
        return null;
    } catch (error) {
        console.error(`Error con API Key ${apiKey.substring(0, 5)}... para URL ${articleUrl}:`, error.message);
        return null; 
    }
}


/**
 * [PRIVADO] Sincronizar Noticias
 * * --- ¡VERSIÓN DOBLE BUCLE (CON DELAY)! ---
 */
exports.syncGNews = async (req, res) => {
    // ---- AQUÍ EMPIEZA EL TRY PRINCIPAL ----
    try {
        if (DEEPSEEK_API_KEYS.length === 0) {
            return res.status(500).json({ error: "No hay API keys de DeepSeek configuradas." });
        }
        if (!API_KEY_GNEWS || !API_KEY_NEWSDATA) {
            return res.status(500).json({ error: "Faltan GNEWS_API_KEY o NEWSDATA_API_KEY en el .env" });
        }
        console.log(`Iniciando sync DOBLE BUCLE con ${DEEPSEEK_API_KEYS.length} keys de IA.`);

        let erroresFetch = [];
        let articulosParaIA = [];
        let totalObtenidosNewsData = 0;
        let totalObtenidosGNews = 0;
        
        // --- PASO 1: NEWSDATA.IO (Bucle de 19 llamadas) ---
        console.log(`Paso 1: Obteniendo noticias de NewsData.io en ${PAISES_NEWSDATA.length} llamadas...`);
        
        for (const pais of PAISES_NEWSDATA) {
             try {
                const urlNewsData = `https://newsdata.io/api/1/news?apikey=${API_KEY_NEWSDATA}&country=${pais}&language=es,pt&size=${MAX_ARTICLES_PER_COUNTRY}`;
                const response = await axios.get(urlNewsData);
                
                if (response.data.results) {
                    response.data.results.forEach(article => {
                        articulosParaIA.push({
                            title: article.title,
                            description: article.description || 'Sin descripción.',
                            image: article.image_url,
                            source: { name: article.source_id || 'Fuente Desconocida' },
                            url: article.link,
                            publishedAt: article.pubDate,
                            categoriaLocal: 'general',
                            paisLocal: article.country[0] 
                        });
                    });
                    const count = response.data.results.length;
                    totalObtenidosNewsData += count;
                    console.log(`-> [NewsData] ${pais.toUpperCase()}: Obtenidos ${count} artículos.`);
                }
            } catch (newsDataError) {
                console.error(`Error al llamar a NewsData.io para [${pais}]: ${newsDataError.message}`);
                erroresFetch.push(`NewsData.io-${pais} (${newsDataError.response?.status})`);
            }
            
            // --- ¡ARREGLO PARA ERROR 429! ---
            await sleep(1000); // Esperamos 1 segundo antes de la siguiente llamada
        }
        console.log(`-> Total Obtenidos NewsData.io: ${totalObtenidosNewsData} (clasificados).`);


        // --- PASO 2: GNEWS (Bucle de 10 llamadas) ---
        console.log(`Paso 2: Obteniendo noticias de GNews en ${PAISES_GNEWS.length} llamadas...`);
        
        for (const pais of PAISES_GNEWS) {
             try {
                const urlGNews = `https://gnews.io/api/v4/top-headlines?country=${pais}&lang=es&max=${MAX_ARTICLES_PER_COUNTRY}&apikey=${API_KEY_GNEWS}`;
                const response = await axios.get(urlGNews);
                
                response.data.articles.forEach(article => {
                    articulosParaIA.push({ 
                        ...article,
                        categoriaLocal: 'general',
                        paisLocal: pais 
                    });
                });
                const count = response.data.articles.length;
                totalObtenidosGNews += count;
                console.log(`-> [GNews] ${pais.toUpperCase()}: Obtenidos ${count} artículos.`);
                
            } catch (gnewsError) {
                console.error(`Error al llamar a GNews para [${pais}]: ${gnewsError.message}`);
                erroresFetch.push(`GNews-${pais}`);
            }
            
            // --- ¡ARREGLO PARA ERROR 429! ---
            await sleep(1000); // Esperamos 1 segundo
        }
        console.log(`-> Total Obtenidos GNews: ${totalObtenidosGNews} (clasificados).`);

        console.log(`--- TOTAL: ${articulosParaIA.length} artículos obtenidos para procesar.`);


        // --- PASO 3: IA (Procesa CIENTOS de artículos) ---
        console.log(`Paso 3: Iniciando generación de IA para ${articulosParaIA.length} artículos...`);
        const promesasDeArticulos = articulosParaIA.map((article, index) => {
            const apiKeyParaUsar = DEEPSEEK_API_KEYS[index % DEEPSEEK_API_KEYS.length];
            
            return getAIArticle(article.url, apiKeyParaUsar)
                .then(resultadoIA => {
                    return { ...article, ...resultadoIA };
                });
        });

        const resultadosCompletos = await Promise.all(promesasDeArticulos);
        const articulosValidosIA = resultadosCompletos.filter(r => r && r.articuloGenerado && r.url);
        console.log(`-> ${articulosValidosIA.length} artículos procesados por IA.`);


        // --- PASO 4: Base de Datos ---
        const operations = articulosValidosIA.map(article => ({
            updateOne: {
                filter: { enlaceOriginal: article.url }, 
                update: {
                    $set: {
                        titulo: article.title,
                        descripcion: article.description,
                        imagen: article.image,
                        sitio: 'noticias.lat',
                        categoria: article.categoriaLocal, 
                        pais: article.paisLocal, 
                        fuente: article.source.name,
                        enlaceOriginal: article.url,
                        fecha: new Date(article.publishedAt),
                        articuloGenerado: article.articuloGenerado
                    }
                },
                upsert: true 
            }
        }));

        // --- PASO 5: Guardar ---
        let totalArticulosNuevos = 0;
        let totalArticulosActualizados = 0;
        
        if (operations.length > 0) {
            console.log(`Paso 4: Guardando ${operations.length} artículos en la base de datos...`);
            const result = await Article.bulkWrite(operations);
            totalArticulosNuevos = result.upsertedCount;
            totalArticulosActualizados = result.modifiedCount;
        }

        console.log("¡Sincronización DOBLE BUCLE completada!");
        
        // --- PASO 6: Respuesta (Reporte Detallado) ---
        res.json({ 
            message: "Sincronización DOBLE BUCLE completada.",
            reporte: {
                totalObtenidosNewsData: totalObtenidosNewsData,
                totalObtenidosGNews: totalObtenidosGNews,
                totalArticulos: articulosParaIA.length,
                totalProcesadosIA: articulosValidosIA.length,
                totalFallidosIA: articulosParaIA.length - articulosValidosIA.length,
                totalClasificados: articulosValidosIA.length, 
                totalSinClasificar: 0,
                nuevosArticulosGuardados: totalArticulosNuevos,
                articulosActualizados: totalArticulosActualizados,
                apisConError: erroresFetch
            }
        });

    // ---- AQUÍ CIERRA EL TRY PRINCIPAL ----
    } catch (error) {
        console.error("Error catastrófico en syncGNews (Doble Bucle):", error.message);
        res.status(500).json({ error: "Error al sincronizar (Doble Bucle)." });
    }
}; // <-- ¡ESTA ES LA LLAVE DE CIERRE QUE FALTABA!

/**
 * [PRIVADO] Añadir un nuevo artículo manualmente
 */
exports.createManualArticle = async (req, res) => {
    try {
        if (DEEPSEEK_API_KEYS.length === 0) {
            return res.status(500).json({ error: "No hay API keys de DeepSeek configuradas." });
        }
        const { titulo, descripcion, imagen, categoria, sitio, fuente, enlaceOriginal, fecha, contenido, pais } = req.body;
        const resultadoIA = await getAIArticle(enlaceOriginal, DEEPSEEK_API_KEYS[0]);

        const newArticle = new Article({
            titulo, descripcion, imagen, categoria, sitio,
            fuente: fuente || 'Fuente desconocida',
            enlaceOriginal: enlaceOriginal || '#',
            fecha: fecha ? new Date(fecha) : new Date(),
            pais: pais || null,
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