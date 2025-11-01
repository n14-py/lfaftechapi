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

// --- ¡NUEVAS CLAVES DE API! ---
const API_KEY_GNEWS = process.env.GNEWS_API_KEY;
const API_KEY_NEWSDATA = process.env.NEWSDATA_API_KEY; // ¡Usamos la clave correcta!

// --- Lista de países de LATAM que soporta NewsData.io ---
const PAISES_LATAM = "ar,bo,br,cl,co,cr,cu,ec,sv,gt,hn,mx,ni,pa,py,pe,do,uy,ve";
// (Faltan Haití (ht) y otros, pero esta es la cobertura principal en español/portugués)

/**
 * Llama a la API de DeepSeek.
 * (Sin cambios)
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
 * --- ¡NUEVO! ---
 * Función "inteligente" para detectar el país (SOLO PARA GNEWS).
 * NewsData.io ya nos da el país.
 */
function detectarPaisGNews(sourceName, url, iaText = '') {
    const textoCompleto = `${sourceName} ${url} ${iaText}`.toLowerCase();

    // Países por URL (más preciso)
    if (textoCompleto.includes('.py')) return 'py';
    if (textoCompleto.includes('.cl')) return 'cl';
    if (textoCompleto.includes('.pe')) return 'pe';
    if (textoCompleto.includes('.uy')) return 'uy';
    if (textoCompleto.includes('.bo')) return 'bo';
    if (textoCompleto.includes('.cr')) return 'cr';
    if (textoCompleto.includes('.ec')) return 'ec';
    if (textoCompleto.includes('.ar')) return 'ar';
    if (textoCompleto.includes('.co')) return 'co';
    if (textoCompleto.includes('.mx')) return 'mx';
    if (textoCompleto.includes('.ve')) return 've';
    if (textoCompleto.includes('.cu')) return 'cu';
    if (textoCompleto.includes('.br')) return 'br';

    // Países por nombre de fuente o texto de IA
    if (textoCompleto.includes('paraguay')) return 'py';
    if (textoCompleto.includes('chile')) return 'cl';
    if (textoCompleto.includes('perú') || textoCompleto.includes('peru')) return 'pe';
    if (textoCompleto.includes('uruguay')) return 'uy';
    if (textoCompleto.includes('bolivia')) return 'bo';
    if (textoCompleto.includes('costa rica')) return 'cr';
    if (textoCompleto.includes('ecuador')) return 'ec';
    if (textoCompleto.includes('argentina')) return 'ar';
    if (textoCompleto.includes('colombia')) return 'co';
    if (textoCompleto.includes('méxico') || textoCompleto.includes('mexico')) return 'mx';
    if (textoCompleto.includes('venezuela')) return 've';
    if (textoCompleto.includes('cuba')) return 'cu';
    if (textoCompleto.includes('brasil')) return 'br';

    return null; // No se pudo detectar
}


/**
 * [PRIVADO] Sincronizar Noticias
 * * --- ¡VERSIÓN NEWSDATA.IO + GNEWS INTELIGENTE! ---
 */
exports.syncGNews = async (req, res) => {
    if (DEEPSEEK_API_KEYS.length === 0) {
        return res.status(500).json({ error: "No hay API keys de DeepSeek configuradas." });
    }
    if (!API_KEY_GNEWS || !API_KEY_NEWSDATA) {
        return res.status(500).json({ error: "Faltan GNEWS_API_KEY o NEWSDATA_API_KEY en el .env" });
    }
    console.log(`Iniciando sync HÍBRIDO (NewsData.io + GNews) con ${DEEPSEEK_API_KEYS.length} keys de IA.`);

    let erroresFetch = [];
    let articulosParaIA = [];
    let totalObtenidosNewsData = 0;
    let totalObtenidosGNews = 0;
    let detectadosGNews = 0;

    try {
        // --- PASO 1: Obtener artículos de NewsData.io (Noticias Locales de LATAM) ---
        console.log(`Paso 1: Obteniendo noticias de NewsData.io para ${PAISES_LATAM}...`);
        try {
            // ¡Hacemos 1 sola llamada para todos los países de Latam!
            const urlNewsData = `https://newsdata.io/api/1/news?apikey=${API_KEY_NEWSDATA}&country=${PAISES_LATAM}&language=es,pt`;
            const response = await axios.get(urlNewsData);
            
            // Normalizamos la respuesta de NewsData.io
            response.data.results.forEach(article => {
                articulosParaIA.push({
                    title: article.title,
                    description: article.description || 'Sin descripción.',
                    content: article.content || article.description,
                    image: article.image_url,
                    source: { name: article.source_id || 'Fuente Desconocida' },
                    url: article.link,
                    publishedAt: article.pubDate,
                    categoriaLocal: 'general',
                    paisLocal: article.country[0] // ¡El país ya viene! (ej: 'py')
                });
            });
            totalObtenidosNewsData = response.data.results.length;
            console.log(`-> Obtenidos ${totalObtenidosNewsData} artículos de NewsData.io (clasificados).`);

        } catch (newsDataError) {
            console.error(`Error al llamar a NewsData.io: ${newsDataError.message}`);
            erroresFetch.push(`NewsData.io (${newsDataError.response?.status})`);
        }

        // --- PASO 2: Obtener artículos de GNews (Noticias Generales de LATAM) ---
        console.log("Paso 2: Obteniendo noticias de GNews (Temas LATAM)...");
        try {
            const queryLatam = encodeURIComponent('"Mercosur" OR "Copa Libertadores" OR "LATAM" OR "Comunidad Andina" OR "OEA"');
            const urlGNews = `https://gnews.io/api/v4/search?q=${queryLatam}&lang=es&max=50&apikey=${API_KEY_GNEWS}`;
            const response = await axios.get(urlGNews);
            
            response.data.articles.forEach(article => {
                articulosParaIA.push({ 
                    ...article, 
                    categoriaLocal: 'general',
                    paisLocal: null // Aún no sabemos el país
                });
            });
            totalObtenidosGNews = response.data.articles.length;
            console.log(`-> Obtenidos ${totalObtenidosGNews} artículos de GNews (para clasificar).`);
            
        } catch (gnewsError) {
            console.error(`Error al llamar a GNews: ${gnewsError.message}`);
            erroresFetch.push('GNews-general');
        }

        console.log(`--- TOTAL: ${articulosParaIA.length} artículos obtenidos para procesar.`);


        // --- PASO 3: Generación de IA (Paralelo) ---
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


        // --- PASO 4: Detección de País (Solo para los de GNews) ---
        console.log("Paso 4: Clasificando país para artículos de GNews (Usando IA)...");
        articulosValidosIA.forEach(article => {
            // Si el país es 'null' (vino de GNews) Y no es de Brasil (GNews no trae 'pt')
            if (!article.paisLocal && !article.url.includes('.br')) {
                const paisDetectadoIA = detectarPaisGNews(article.source.name, article.url, article.articuloGenerado);
                if (paisDetectadoIA) {
                    article.paisLocal = paisDetectadoIA;
                    detectadosGNews++;
                }
            }
        });
        console.log(`-> ${detectadosGNews} artículos de GNews fueron clasificados por IA.`);


        // --- PASO 5: Preparar la escritura en la Base de Datos ---
        const operations = articulosValidosIA.map(article => ({
            updateOne: {
                filter: { enlaceOriginal: article.url }, 
                update: {
                    $set: {
                        titulo: article.title,
                        descripcion: article.description,
                        contenido: article.content,
                        imagen: article.image,
                        sitio: 'noticias.lat',
                        categoria: article.categoriaLocal, 
                        pais: article.paisLocal, // ¡Clasificado!
                        fuente: article.source.name,
                        enlaceOriginal: article.url,
                        fecha: new Date(article.publishedAt),
                        articuloGenerado: article.articuloGenerado
                    }
                },
                upsert: true 
            }
        }));

        // --- PASO 6: Guardar todo en la Base de Datos ---
        let totalArticulosNuevos = 0;
        let totalArticulosActualizados = 0;
        
        if (operations.length > 0) {
            console.log(`Paso 5: Guardando ${operations.length} artículos en la base de datos...`);
            const result = await Article.bulkWrite(operations);
            totalArticulosNuevos = result.upsertedCount;
            totalArticulosActualizados = result.modifiedCount;
        }

        console.log("¡Sincronización HÍBRIDA (NewsData+GNews) completada!");
        
        // --- PASO 7: Respuesta con Reporte Detallado ---
        res.json({ 
            message: "Sincronización HÍBRIDA completada.",
            reporte: {
                totalObtenidosNewsData: totalObtenidosNewsData,
                totalObtenidosGNews: totalObtenidosGNews,
                totalArticulos: articulosParaIA.length,
                totalProcesadosIA: articulosValidosIA.length,
                totalFallidosIA: articulosParaIA.length - articulosValidosIA.length,
                clasificadosPorNewsData: totalObtenidosNewsData,
                clasificadosPorGNewsIA: detectadosGNews,
                totalClasificados: totalObtenidosNewsData + detectadosGNews,
                totalSinClasificar: articulosValidosIA.length - (totalObtenidosNewsData + detectadosGNews),
                nuevosArticulosGuardados: totalArticulosNuevos,
                articulosActualizados: totalArticulosActualizados,
                apisConError: erroresFetch
            }
        });

    } catch (error) {
        console.error("Error catastrófico en syncGNews (Híbrido):", error.message);
        res.status(500).json({ error: "Error al sincronizar (Híbrido)." });
    }
};

/**
 * [PRIVADO] Añadir un nuevo artículo manually
 * (Sin cambios)
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
            contenido: contenido || descripcion,
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