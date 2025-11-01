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
const API_KEY_NEWSDATA = process.env.NEWSDATA_API_KEY; // ¡Esta es la clave pub_... de tu imagen!

// --- LÍMITES DE API ---
const MAX_ARTICLES_GNEWS = 50; // 50 noticias regionales
const NEWSDATA_PAGE_SIZE = 10; // 10 noticias por país (límite plan gratuito NewsData)

// --- ¡NUEVO! Lista de 19 países de LATAM separada en "lotes" de 5 ---
// (Límite del plan gratuito de NewsData.io es 5 países por llamada)
const PAISES_LATAM_LOTES = [
    "ar,bo,br,cl,co", // Lote 1
    "cr,cu,ec,sv,gt", // Lote 2
    "hn,mx,ni,pa,py", // Lote 3 (¡Incluye Paraguay!)
    "pe,do,uy,ve"     // Lote 4 (Haití 'ht' no está soportado por la API)
];


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
 * Función "inteligente" para detectar el país (SOLO PARA GNEWS).
 * (Sin cambios)
 */
function detectarPaisGNews(sourceName, url, iaText = '') {
    const textoCompleto = `${sourceName} ${url} ${iaText}`.toLowerCase();
    
    const paisesMap = {
        'py': ['.py', 'paraguay', 'abc color', 'última hora'],
        'cl': ['.cl', 'chile', 'latercera', 'biobiochile'],
        'pe': ['.pe', 'perú', 'peru', 'elcomercio.pe', 'rpp', 'larepublica.pe'],
        'uy': ['.uy', 'uruguay'],
        'bo': ['.bo', 'bolivia'],
        'cr': ['.cr', 'costa rica'],
        'ec': ['.ec', 'ecuador'],
        'ar': ['.ar', 'argentina', 'clarin', 'la nacion'],
        'co': ['.co', 'colombia', 'eltiempo.com', 'elespectador.com'],
        'mx': ['.mx', 'méxico', 'mexico', 'eluniversal.com.mx', 'reforma'],
        've': ['.ve', 'venezuela'],
        'cu': ['.cu', 'cuba'],
        'br': ['.br', 'brasil']
    };

    for (const [codigo, terminos] of Object.entries(paisesMap)) {
        for (const termino of terminos) {
            if (textoCompleto.includes(termino)) {
                return codigo;
            }
        }
    }
    return null; // No se pudo detectar
}


/**
 * [PRIVADO] Sincronizar Noticias
 * * --- ¡VERSIÓN DE ALTO VOLUMEN! (NewsData.io Bucle + GNews Regional) ---
 */
exports.syncGNews = async (req, res) => {
    if (DEEPSEEK_API_KEYS.length === 0) {
        return res.status(500).json({ error: "No hay API keys de DeepSeek configuradas." });
    }
    if (!API_KEY_GNEWS || !API_KEY_NEWSDATA) {
        return res.status(500).json({ error: "Faltan GNEWS_API_KEY o NEWSDATA_API_KEY en el .env" });
    }
    console.log(`Iniciando sync de ALTO VOLUMEN con ${DEEPSEEK_API_KEYS.length} keys de IA.`);

    let erroresFetch = [];
    let articulosParaIA = [];
    let totalObtenidosNewsData = 0;
    let totalObtenidosGNews = 0;
    let detectadosGNews = 0;

    try {
        // --- PASO 1: NEWSDATA.IO (Bucle de 4 llamadas para 19 países) ---
        console.log(`Paso 1: Obteniendo noticias de NewsData.io en ${PAISES_LATAM_LOTES.length} lotes...`);
        
        for (const lote of PAISES_LATAM_LOTES) {
            try {
                // Pedimos 10 noticias (size=10) por cada país en el lote
                const urlNewsData = `https://newsdata.io/api/1/news?apikey=${API_KEY_NEWSDATA}&country=${lote}&language=es,pt&size=${NEWSDATA_PAGE_SIZE}`;
                const response = await axios.get(urlNewsData);
                
                if (response.data.results) {
                    response.data.results.forEach(article => {
                        articulosParaIA.push({
                            title: article.title,
                            description: article.description || 'Sin descripción.',
                            // 'content' ya no se usa
                            image: article.image_url,
                            source: { name: article.source_id || 'Fuente Desconocida' },
                            url: article.link,
                            publishedAt: article.pubDate,
                            categoriaLocal: 'general',
                            paisLocal: article.country[0] // ¡El país ya viene! (ej: 'py')
                        });
                    });
                    const count = response.data.results.length;
                    totalObtenidosNewsData += count;
                    console.log(`-> Lote [${lote}] exitoso. Obtenidos ${count} artículos.`);
                }
            } catch (newsDataError) {
                console.error(`Error al llamar a NewsData.io para [${lote}]: ${newsDataError.message}`);
                erroresFetch.push(`NewsData.io-${lote} (${newsDataError.response?.status})`);
            }
        }
        console.log(`-> Total Obtenidos NewsData.io: ${totalObtenidosNewsData} (clasificados).`);


        // --- PASO 2: GNEWS (1 llamada para noticias regionales) ---
        console.log(`Paso 2: Obteniendo noticias de GNews (Temas LATAM) | Max: ${MAX_ARTICLES_GNEWS}...`);
        try {
            const queryLatam = encodeURIComponent('"Mercosur" OR "Copa Libertadores" OR "LATAM" OR "Comunidad Andina" OR "OEA"');
            const urlGNews = `https://gnews.io/api/v4/search?q=${queryLatam}&lang=es&max=${MAX_ARTICLES_GNEWS}&apikey=${API_KEY_GNEWS}`;
            const response = await axios.get(urlGNews);
            
            response.data.articles.forEach(article => {
                articulosParaIA.push({ 
                    ...article, // GNews nos da: title, description, url, image, source, publishedAt
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


        // --- PASO 3: IA (Procesa CIENTOS de artículos) ---
        console.log(`Paso 3: Iniciando generación de IA para ${articulosParaIA.length} artículos...`);
        const promesasDeArticulos = articulosParaIA.map((article, index) => {
            const apiKeyParaUsar = DEEPSEEK_API_KEYS[index % DEEPSEEK_API_KEYS.length];
            
            return getAIArticle(article.url, apiKeyParaUsar)
                .then(resultadoIA => {
                    return { ...article, ...resultadoIA }; // Combina GNews/NewsData + IA
                });
        });

        const resultadosCompletos = await Promise.all(promesasDeArticulos);
        const articulosValidosIA = resultadosCompletos.filter(r => r && r.articuloGenerado && r.url);
        console.log(`-> ${articulosValidosIA.length} artículos procesados por IA.`);


        // --- PASO 4: CLASIFICACIÓN (Solo para los de GNews) ---
        console.log("Paso 4: Clasificando país para artículos de GNews (Usando IA)...");
        articulosValidosIA.forEach(article => {
            if (!article.paisLocal && !article.url.includes('.br')) { // Si es null (vino de GNews)
                const paisDetectadoIA = detectarPaisGNews(article.source.name, article.url, article.articuloGenerado);
                if (paisDetectadoIA) {
                    article.paisLocal = paisDetectadoIA;
                    detectadosGNews++;
                }
            }
        });
        console.log(`-> ${detectadosGNews} artículos de GNews fueron clasificados por IA.`);


        // --- PASO 5: Base de Datos (Con optimización) ---
        const operations = articulosValidosIA.map(article => ({
            updateOne: {
                filter: { enlaceOriginal: article.url }, 
                update: {
                    $set: {
                        titulo: article.title,
                        descripcion: article.description,
                        // ¡OPTIMIZADO! El campo 'contenido' ya no se guarda.
                        imagen: article.image,
                        sitio: 'noticias.lat',
                        categoria: article.categoriaLocal, 
                        pais: article.paisLocal, 
                        fuente: article.source.name,
                        enlaceOriginal: article.url,
                        fecha: new Date(article.publishedAt),
                        articuloGenerado: article.articuloGenerado // Solo guardamos este
                    }
                },
                upsert: true 
            }
        }));

        // --- PASO 6: Guardar ---
        let totalArticulosNuevos = 0;
        let totalArticulosActualizados = 0;
        
        if (operations.length > 0) {
            console.log(`Paso 5: Guardando ${operations.length} artículos en la base de datos...`);
            const result = await Article.bulkWrite(operations);
            totalArticulosNuevos = result.upsertedCount;
            totalArticulosActualizados = result.modifiedCount;
        }

        console.log("¡Sincronización de ALTO VOLUMEN completada!");
        
        // --- PASO 7: Respuesta (Reporte Detallado) ---
        const totalClasificados = totalObtenidosNewsData + detectadosGNews;
        res.json({ 
            message: "Sincronización de ALTO VOLUMEN completada.",
            reporte: {
                totalObtenidosNewsData: totalObtenidosNewsData,
                totalObtenidosGNews: totalObtenidosGNews,
                totalArticulos: articulosParaIA.length,
                totalProcesadosIA: articulosValidosIA.length,
                totalFallidosIA: articulosParaIA.length - articulosValidosIA.length,
                clasificadosPorNewsData: totalObtenidosNewsData,
                clasificadosPorGNewsIA: detectadosGNews,
                totalClasificados: totalClasificados,
                totalSinClasificar: articulosValidosIA.length - totalClasificados,
                nuevosArticulosGuardados: totalArticulosNuevos,
                articulosActualizados: totalArticulosActualizados,
                apisConError: erroresFetch
            }
        });

    } catch (error) {
        console.error("Error catastrófico en syncGNews (Alto Volumen):", error.message);
        res.status(500).json({ error: "Error al sincronizar (Alto Volumen)." });
    }
};

/**
 * [PRIVADO] Añadir un nuevo artículo manualmente
 * (Actualizado con la optimización de BD)
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
            // ¡OPTIMIZADO! 'contenido' ya no se guarda
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