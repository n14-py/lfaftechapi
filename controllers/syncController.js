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

// --- ¡NUEVO! CARGAMOS LAS API KEYS DE NOTICIAS ---
const API_KEY_GNEWS = process.env.GNEWS_API_KEY;
const API_KEY_NEWSAPI = process.env.NEWSAPI_API_KEY; // ¡Nueva!


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
    const systemPrompt = "Eres un reportero senior para el portal 'Noticias.lat'. Tu trabajo es escribir artículos de noticias completos, detallados y profesionales. No eres un asistente, eres un periodista. Escribe en un tono formal, objetivo pero atractivo. Debes generar un artículo muy extenso, con múltiples páragros. No digas 'según la fuente'. Escribe la noticia como si fuera tuya. IMPORTANTE: No uses ningún formato Markdown, como `##` para títulos o `**` para negritas. Escribe solo texto plano.";
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
 * Función "inteligente" para detectar el país basado en la fuente.
 * Esto nos permite clasificar noticias de GNews que vienen sin país.
 */
function detectarPais(sourceName, url) {
    if (!sourceName && !url) return null;
    
    const textoCompleto = `${sourceName} ${url}`.toLowerCase();

    // Países que GNews no nos da
    if (textoCompleto.includes('abc.com.py') || textoCompleto.includes('abc color') || textoCompleto.includes('última hora') || textoCompleto.includes('.com.py')) return 'py';
    if (textoCompleto.includes('latercera.com') || textoCompleto.includes('biobiochile.cl') || textoCompleto.includes('cooperativa.cl') || textoCompleto.includes('.cl')) return 'cl';
    if (textoCompleto.includes('elcomercio.pe') || textoCompleto.includes('rpp.pe') || textoCompleto.includes('larepublica.pe') || textoCompleto.includes('.pe')) return 'pe';
    if (textoCompleto.includes('elobservador.com.uy') || textoCompleto.includes('elpais.com.uy') || textoCompleto.includes('.uy')) return 'uy';
    if (textoCompleto.includes('eldeber.com.bo') || textoCompleto.includes('paginasiete.bo') || textoCompleto.includes('.bo')) return 'bo';
    if (textoCompleto.includes('crhoy.com') || textoCompleto.includes('nacion.com') || textoCompleto.includes('.cr')) return 'cr';
    if (textoCompleto.includes('eluniverso.com') || textoCompleto.includes('elcomercio.com') || textoCompleto.includes('.ec')) return 'ec';

    // Países que NewsAPI ya nos da, pero GNews podría incluir
    if (textoCompleto.includes('clarin.com') || textoCompleto.includes('lanacion.com.ar') || textoCompleto.includes('.com.ar')) return 'ar';
    if (textoCompleto.includes('eltiempo.com') || textoCompleto.includes('elespectador.com') || textoCompleto.includes('.com.co')) return 'co';
    if (textoCompleto.includes('eluniversal.com.mx') || textoCompleto.includes('reforma.com') || textoCompleto.includes('.com.mx')) return 'mx';
    if (textoCompleto.includes('el-nacional.com') || textoCompleto.includes('globovision.com') || textoCompleto.includes('.com.ve')) return 've';
    if (textoCompleto.includes('granma.cu') || textoCompleto.includes('.cu')) return 'cu';
    if (textoCompleto.includes('globo.com') || textoCompleto.includes('folha.uol.com.br') || textoCompleto.includes('.br')) return 'br';

    return null; // No se pudo detectar
}


/**
 * [PRIVADO] Sincronizar GNews y NewsAPI con nuestra Base de Datos
 * (Lógica de la ruta POST /api/sync-gnews)
 * * --- ¡VERSIÓN HÍBRIDA DE ALTO RENDIMIENTO! ---
 */
exports.syncGNews = async (req, res) => {
    if (DEEPSEEK_API_KEYS.length === 0) {
        return res.status(500).json({ error: "No hay API keys de DeepSeek configuradas." });
    }
    if (!API_KEY_GNEWS || !API_KEY_NEWSAPI) {
        return res.status(500).json({ error: "Faltan GNEWS_API_KEY o NEWSAPI_API_KEY en el .env" });
    }
    console.log(`Iniciando sync HÍBRIDO con ${DEEPSEEK_API_KEYS.length} keys de IA.`);

    const MAX_ARTICLES_PER_RUN = 25; 
    let erroresFetch = [];
    let articulosParaIA = [];

    try {
        // --- PASO 1: Obtener artículos de GNews (Noticias Generales) ---
        // (1 sola petición a GNews)
        console.log("Obteniendo noticias de GNews (General)...");
        try {
            const urlGNews = `https://gnews.io/api/v4/top-headlines?category=general&lang=es&max=${MAX_ARTICLES_PER_RUN}&apikey=${API_KEY_GNEWS}`;
            const response = await axios.get(urlGNews);
            
            response.data.articles.forEach(article => {
                articulosParaIA.push({ 
                    ...article, 
                    categoriaLocal: 'general', // Todas son 'general'
                    paisLocal: null // La IA intentará detectarlo
                });
            });
        } catch (gnewsError) {
            console.error(`Error al llamar a GNews: ${gnewsError.message}`);
            erroresFetch.push('GNews-general');
        }

        // --- PASO 2: Obtener artículos de NewsAPI (Noticias por País) ---
        // (Múltiples peticiones a NewsAPI, una por país)
        
        // ¡Importante! NewsAPI plan gratuito SOLO soporta estos países:
        // ar, br, co, cu, mx, ve
        // No soporta cl, pe, py, uy, bo, etc.
        const paisesNewsAPI = ['ar', 'mx', 'co', 'br', 've', 'cu'];
        
        console.log(`Obteniendo noticias de NewsAPI para: ${paisesNewsAPI.join(', ')}...`);

        for (const pais of paisesNewsAPI) {
            try {
                const urlNewsAPI = `https://newsapi.org/v2/top-headlines?country=${pais}&pageSize=${MAX_ARTICLES_PER_RUN}&apiKey=${API_KEY_NEWSAPI}`;
                const response = await axios.get(urlNewsAPI);

                // ¡Normalizamos la respuesta de NewsAPI!
                response.data.articles.forEach(article => {
                    articulosParaIA.push({
                        title: article.title,
                        description: article.description || 'Sin descripción.',
                        content: article.content || article.description,
                        image: article.urlToImage,
                        source: { name: article.source.name }, // Normalizado
                        url: article.url,
                        publishedAt: article.publishedAt,
                        
                        categoriaLocal: 'general', // Todas son 'general'
                        paisLocal: pais // ¡Ya sabemos el país!
                    });
                });

            } catch (newsApiError) {
                console.error(`Error al llamar a NewsAPI para ${pais}: ${newsApiError.message}`);
                erroresFetch.push(`NewsAPI-${pais}`);
            }
        }
        
        console.log(`Se obtuvieron ${articulosParaIA.length} artículos en total.`);

        // --- PASO 3: Lógica "Inteligente" de Detección de País ---
        // Recorremos los artículos y asignamos país si no lo tienen (los de GNews)
        articulosParaIA.forEach(article => {
            if (!article.paisLocal) { // Si es null (vino de GNews)
                article.paisLocal = detectarPais(article.source.name, article.url);
            }
        });
        console.log("Detección de país completada.");

        // --- PASO 4: Crear el array de "Promesas" para la IA (Paralelo) ---
        const promesasDeArticulos = articulosParaIA.map((article, index) => {
            const apiKeyParaUsar = DEEPSEEK_API_KEYS[index % DEEPSEEK_API_KEYS.length];
            
            return getAIArticle(article.url, apiKeyParaUsar)
                .then(resultadoIA => {
                    return { ...article, ...resultadoIA };
                });
        });

        // --- PASO 5: Ejecutar TODAS las promesas al mismo tiempo ---
        const resultadosCompletos = await Promise.all(promesasDeArticulos);
        console.log(`Generación con IA completada. ${resultadosCompletos.length} artículos procesados.`);

        // --- PASO 6: Preparar la escritura en la Base de Datos ---
        const operations = resultadosCompletos
            .filter(r => r && r.articuloGenerado && r.url) // Filtramos los que fallaron
            .map(article => ({
                updateOne: {
                    filter: { enlaceOriginal: article.url }, 
                    update: {
                        $set: {
                            titulo: article.title,
                            descripcion: article.description,
                            contenido: article.content,
                            imagen: article.image,
                            sitio: 'noticias.lat',
                            categoria: article.categoriaLocal, // 'general'
                            pais: article.paisLocal, // 'ar', 'mx', 'co', 'py', 'cl', o null
                            fuente: article.source.name,
                            enlaceOriginal: article.url,
                            fecha: new Date(article.publishedAt),
                            articuloGenerado: article.articuloGenerado
                        }
                    },
                    upsert: true 
                }
            }));

        // --- PASO 7: Guardar todo en la Base de Datos ---
        let totalArticulosNuevos = 0;
        let totalArticulosActualizados = 0;
        
        if (operations.length > 0) {
            console.log(`Guardando ${operations.length} artículos en la base de datos...`);
            const result = await Article.bulkWrite(operations);
            totalArticulosNuevos = result.upsertedCount;
            totalArticulosActualizados = result.modifiedCount;
        }

        console.log("¡Sincronización HÍBRIDA completada!");
        res.json({ 
            message: "Sincronización HÍBRIDA completada.", 
            nuevosArticulosGuardados: totalArticulosNuevos,
            articulosActualizados: totalArticulosActualizados,
            articulosFallidosIA: articulosParaIA.length - operations.length,
            apisConError: erroresFetch
        });

    } catch (error) {
        console.error("Error catastrófico en syncGNews (híbrido):", error.message);
        res.status(500).json({ error: "Error al sincronizar (híbrido)." });
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