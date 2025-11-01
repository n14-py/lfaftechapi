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

// --- SOLO USAREMOS GNEWS ---
const API_KEY_GNEWS = process.env.GNEWS_API_KEY;

// --- ¡NUEVO! PEDIREMOS 100 ARTÍCULOS ---
const MAX_ARTICLES_GNEWS = 100;


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
 * --- ¡VERSIÓN 2.0 MEJORADA! ---
 * Función "inteligente" para detectar el país.
 * AHORA ACEPTA EL TEXTO DE LA IA PARA UNA SEGUNDA REVISIÓN.
 */
function detectarPais(sourceName, url, iaText = '') {
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

    // Países por nombre de fuente o texto de IA (menos preciso)
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
    
    // Fuentes conocidas
    if (textoCompleto.includes('abc color') || textoCompleto.includes('última hora')) return 'py';
    if (textoCompleto.includes('latercera') || textoCompleto.includes('biobiochile')) return 'cl';
    if (textoCompleto.includes('elcomercio.pe') || textoCompleto.includes('rpp') || textoCompleto.includes('larepublica.pe')) return 'pe';
    if (textoCompleto.includes('clarin') || textoCompleto.includes('la nacion')) return 'ar';
    if (textoCompleto.includes('eltiempo.com') || textoCompleto.includes('elespectador.com')) return 'co';
    if (textoCompleto.includes('eluniversal.com.mx') || textoCompleto.includes('reforma')) return 'mx';

    return null; // No se pudo detectar
}


/**
 * [PRIVADO] Sincronizar GNews con nuestra Base de Datos
 * * --- ¡VERSIÓN GNEWS-ONLY MEJORADA! ---
 */
exports.syncGNews = async (req, res) => {
    if (DEEPSEEK_API_KEYS.length === 0) {
        return res.status(500).json({ error: "No hay API keys de DeepSeek configuradas." });
    }
    if (!API_KEY_GNEWS) {
        return res.status(500).json({ error: "Falta GNEWS_API_KEY en el .env" });
    }
    console.log(`Iniciando sync GNEWS-ONLY con ${DEEPSEEK_API_KEYS.length} keys de IA.`);

    let erroresFetch = [];
    let articulosParaIA = [];
    let totalObtenidosGNews = 0;
    let detectadosPaso1 = 0;
    let detectadosPaso2 = 0;

    try {
        // --- PASO 1: Obtener artículos de GNews (Noticias Generales) ---
        console.log(`Paso 1: Obteniendo noticias de GNews (General) | Max: ${MAX_ARTICLES_GNEWS}...`);
        try {
            const urlGNews = `https://gnews.io/api/v4/top-headlines?category=general&lang=es&max=${MAX_ARTICLES_GNEWS}&apikey=${API_KEY_GNEWS}`;
            const response = await axios.get(urlGNews);
            
            response.data.articles.forEach(article => {
                articulosParaIA.push({ 
                    ...article, 
                    categoriaLocal: 'general',
                    paisLocal: null 
                });
            });
            totalObtenidosGNews = response.data.articles.length;
            console.log(`-> Obtenidos ${totalObtenidosGNews} artículos de GNews.`);
            
        } catch (gnewsError) {
            console.error(`Error al llamar a GNews: ${gnewsError.message}`);
            erroresFetch.push('GNews-general');
            return res.status(500).json({ error: "Error al llamar a GNews." });
        }

        // --- PASO 2: Lógica "Inteligente" de Detección de País (Paso 1) ---
        console.log("Paso 2: Detección de país (Por Fuente/URL)...");
        articulosParaIA.forEach(article => {
            const paisDetectado = detectarPais(article.source.name, article.url);
            if (paisDetectado) {
                article.paisLocal = paisDetectado;
                detectadosPaso1++;
            }
        });
        console.log(`-> ${detectadosPaso1} artículos clasificados por fuente/URL.`);

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


        // --- PASO 4: ¡NUEVO! Detección de País (Paso 2, con IA) ---
        console.log("Paso 4: Re-detección de país (Usando texto de IA)...");
        articulosValidosIA.forEach(article => {
            if (!article.paisLocal) { // Si sigue siendo null
                const paisDetectadoIA = detectarPais(article.source.name, article.url, article.articuloGenerado);
                if (paisDetectadoIA) {
                    article.paisLocal = paisDetectadoIA;
                    detectadosPaso2++;
                }
            }
        });
        console.log(`-> ${detectadosPaso2} artículos adicionales clasificados por IA.`);


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

        console.log("¡Sincronización GNEWS-ONLY completada!");
        
        const totalClasificados = detectadosPaso1 + detectadosPaso2;
        
        // --- PASO 7: Respuesta con Reporte Detallado ---
        res.json({ 
            message: "Sincronización GNEWS-ONLY completada.",
            reporte: {
                totalObtenidosGNews: totalObtenidosGNews,
                totalProcesadosIA: articulosValidosIA.length,
                totalFallidosIA: totalObtenidosGNews - articulosValidosIA.length,
                clasificadosPorFuente: detectadosPaso1,
                clasificadosPorIA: detectadosPaso2,
                totalClasificados: totalClasificados,
                totalSinClasificar: articulosValidosIA.length - totalClasificados,
                nuevosArticulosGuardados: totalArticulosNuevos,
                articulosActualizados: totalArticulosActualizados
            }
        });

    } catch (error) {
        console.error("Error catastrófico en syncGNews (GNews-Only):", error.message);
        res.status(500).json({ error: "Error al sincronizar (GNews-Only)." });
    }
};

/**
 * [PRIVADO] Añadir un nuevo artículo manualmente
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