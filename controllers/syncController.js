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

// --- MAPA DE TRADUCCIÓN DE NEWSDATA.IO ---
const paisNewsDataMap = {
    "argentina": "ar", "bolivia": "bo", "brazil": "br", "chile": "cl", 
    "colombia": "co", "costa rica": "cr", "cuba": "cu", "ecuador": "ec", 
    "el salvador": "sv", "guatemala": "gt", "honduras": "hn", "mexico": "mx", 
    "nicaragua": "ni", "panama": "pa", "paraguay": "py", "peru": "pe", 
    "dominican republic": "do", "uruguay": "uy", "venezuela": "ve"
};

// --- Lista de 19 países de LATAM para NEWSDATA.IO ---
const PAISES_NEWSDATA = [
    "ar", "bo", "br", "cl", "co", "cr", "cu", "ec", "sv", 
    "gt", "hn", "mx", "ni", "pa", "py", "pe", "do", "uy", "ve"
];

// --- Lista de 10 países de LATAM para GNEWS ---
const PAISES_GNEWS = [
    "ar", "br", "cl", "co", "ec", "mx", "pe", "py", "uy", "ve"
];

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Llama a la API de DeepSeek.
 * --- ¡VERSIÓN ACTUALIZADA CON LIMPIADOR DE JSON! ---
 */
async function getAIArticle(articleUrl, apiKey) {
    if (!articleUrl || !articleUrl.startsWith('http')) return null;
    if (!apiKey) {
        console.error("Error: No se proporcionó una API key de DeepSeek.");
        return null;
    }
    const API_URL = '[https://api.deepseek.com/v1/chat/completions](https://api.deepseek.com/v1/chat/completions)';
    const headers = {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
    };
    
    // --- 1. PROMPT DE SISTEMA (Sin cambios) ---
    const systemPrompt = `Eres un asistente de curación de noticias para 'Noticias.lat'. Tu trabajo es analizar una URL y devolver dos cosas:
1. La categoría principal del artículo.
2. Un artículo de noticias completo y detallado.
Debes responder SIEMPRE en formato JSON.

Las categorías válidas son: "politica", "economia", "deportes", "tecnologia", "entretenimiento", "salud", "internacional", "general".
Escoge la mejor categoría de esa lista. Si es una noticia local o un suceso, usa "general".

Ejemplo de formato:
{
  "categoriaSugerida": "politica",
  "articuloGenerado": "Texto del artículo aquí..."
}`;

    // --- 2. PROMPT DE USUARIO (Sin cambios) ---
    const userPrompt = `Analiza la siguiente URL y devuélveme el JSON con la 'categoriaSugerida' (debe ser una de la lista: politica, economia, deportes, tecnologia, entretenimiento, salud, internacional, general) y el 'articuloGenerado'. URL: ${articleUrl}`;
    
    const body = {
        model: "deepseek-chat",
        messages: [ { role: "system", content: systemPrompt }, { role: "user", content: userPrompt } ]
    };
    
    try {
        const response = await axios.post(API_URL, body, { headers });
        
        // --- 3. LÓGICA DE PARSEO (¡AQUÍ ESTÁ LA CORRECCIÓN!) ---
        if (response.data.choices && response.data.choices.length > 0) {
            
            let responseText = response.data.choices[0].message.content;

            try {
                // --- ¡LA SOLUCIÓN! ---
                // Buscamos el JSON que está entre { y }
                // Esto elimina los "```json" y los mensajes de error.
                const match = responseText.match(/\{[\s\S]*\}/);

                if (match && match[0]) {
                    const jsonString = match[0];
                    const jsonResponse = JSON.parse(jsonString);

                    // Verificamos que el JSON tenga lo que esperamos
                    if (jsonResponse.categoriaSugerida && jsonResponse.articuloGenerado) {
                        
                        // Verificamos si la categoría es válida
                        const categoriasValidas = ["politica", "economia", "deportes", "tecnologia", "entretenimiento", "salud", "internacional", "general"];
                        if (!categoriasValidas.includes(jsonResponse.categoriaSugerida)) {
                             jsonResponse.categoriaSugerida = "general";
                        }

                        // ¡ÉXITO! Devolvemos ambas cosas.
                        return {
                            categoriaSugerida: jsonResponse.categoriaSugerida,
                            articuloGenerado: jsonResponse.articuloGenerado,
                            originalArticle: articleUrl
                        };
                    } else {
                        console.error(`Error: DeepSeek devolvió un JSON incompleto para ${articleUrl}`);
                        return null;
                    }
                } else {
                    // Si no encuentra un JSON (ej: "Lo siento, no puedo acceder...")
                    console.error(`Error: DeepSeek no devolvió un JSON (Respuesta: ${responseText}) para ${articleUrl}`);
                    return null;
                }
            } catch (e) {
                // Error si el JSON extraído sigue estando malformado
                console.error(`Error al parsear el JSON extraído para ${articleUrl}:`, e.message);
                console.log("Respuesta recibida:", responseText);
                return null;
            }
        }
        return null;
    } catch (error) {
        console.error(`Error con API Key ${apiKey.substring(0, 5)}... para URL ${articleUrl}:`, error.message);
        return null; 
    }
}


/**
 * [PRIVADO] Sincronizar Noticias
 * (Sin cambios en esta función, solo en getAIArticle)
 */
exports.syncGNews = async (req, res) => {
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
                // Traemos solo 'top' (general) para ahorrar llamadas
                const urlNewsData = `https://newsdata.io/api/1/news?apikey=${API_KEY_NEWSDATA}&country=${pais}&language=es,pt&size=${MAX_ARTICLES_PER_COUNTRY}`;
                const response = await axios.get(urlNewsData);
                
                if (response.data.results) {
                    response.data.results.forEach(article => {
                        const paisNombreCompleto = article.country[0];
                        const paisCodigo = paisNewsDataMap[paisNombreCompleto.toLowerCase()] || paisNombreCompleto;
                        
                        articulosParaIA.push({
                            title: article.title,
                            description: article.description || 'Sin descripción.',
                            image: article.image_url,
                            source: { name: article.source_id || 'Fuente Desconocida' },
                            url: article.link,
                            publishedAt: article.pubDate,
                            categoriaLocal: 'general', // La IA lo reclasificará
                            paisLocal: paisCodigo
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
            await sleep(1000); // Esperamos 1 segundo
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
            await sleep(1000); // Esperamos 1 segundo
        }
        console.log(`-> Total Obtenidos GNews: ${totalObtenidosGNews} (clasificados).`);

        console.log(`--- TOTAL: ${articulosParaIA.length} artículos obtenidos para procesar.`);


        // --- PASO 3: IA (CLASIFICACIÓN Y GENERACIÓN) ---
        console.log(`Paso 3: Iniciando generación y CLASIFICACIÓN de IA para ${articulosParaIA.length} artículos...`);
        
        const promesasDeArticulos = articulosParaIA.map((article, index) => {
            const apiKeyParaUsar = DEEPSEEK_API_KEYS[index % DEEPSEEK_API_KEYS.length];
            
            return getAIArticle(article.url, apiKeyParaUsar)
                .then(resultadoIA => {
                    return { ...article, ...resultadoIA };
                });
        });

        const resultadosCompletos = await Promise.all(promesasDeArticulos);
        
        // Filtramos solo los que tengan AMBAS cosas: el artículo y la categoría.
        const articulosValidosIA = resultadosCompletos.filter(r => r && r.articuloGenerado && r.categoriaSugerida && r.url);
        
        console.log(`-> ${articulosValidosIA.length} artículos procesados y clasificados por IA.`);


        // --- PASO 4: Base de Datos ---
        const operations = articulosValidosIA.map(article => ({
            updateOne: {
                filter: { enlaceOriginal: article.url }, 
                update: {
                    $set: {
                        titulo: article.title,
                        descripcion: article.description || 'Sin descripción.',
                        imagen: article.image,
                        sitio: 'noticias.lat',
                        categoria: article.categoriaSugerida, 
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

        console.log("¡Sincronización DOBLE BUCLE (con Clasificación IA) completada!");
        
        // --- PASO 6: Respuesta (Reporte Detallado) ---
        res.json({ 
            message: "Sincronización DOBLE BUCLE con CLASIFICACIÓN IA completada.",
            reporte: {
                totalObtenidosNewsData: totalObtenidosNewsData,
                totalObtenidosGNews: totalObtenidosGNews,
                totalArticulos: articulosParaIA.length,
                totalProcesadosIA: articulosValidosIA.length,
                totalFallidosIA: articulosParaIA.length - articulosValidosIA.length,
                totalClasificadosIA: articulosValidosIA.length,
                nuevosArticulosGuardados: totalArticulosNuevos,
                articulosActualizados: totalArticulosActualizados,
                apisConError: erroresFetch
            }
        });

    } catch (error) {
        console.error("Error catastrófico en syncGNews (Clasificación IA):", error.message);
        res.status(500).json({ error: "Error al sincronizar (Clasificación IA)." });
    }
};

/**
 * [PRIVADO] Añadir un nuevo artículo manualmente
 * (Actualizado para usar la clasificación IA)
 */
exports.createManualArticle = async (req, res) => {
    try {
        if (DEEPSEEK_API_KEYS.length === 0) {
            return res.status(500).json({ error: "No hay API keys de DeepSeek configuradas." });
        }
        
        const { titulo, descripcion, imagen, sitio, fuente, enlaceOriginal, fecha, pais } = req.body;
        
        const resultadoIA = await getAIArticle(enlaceOriginal, DEEPSEEK_API_KEYS[0]);

        if (!resultadoIA) {
            return res.status(500).json({ error: "La IA no pudo procesar la URL proporcionada." });
        }

        const newArticle = new Article({
            titulo: titulo || 'Título no proporcionado',
            descripcion: descripcion || 'Descripción no proporcionada',
            imagen: imagen || null,
            sitio: sitio || 'noticias.lat',
            fuente: fuente || 'Fuente desconocida',
            enlaceOriginal: enlaceOriginal || '#',
            fecha: fecha ? new Date(fecha) : new Date(),
            pais: pais || null,
            
            articuloGenerado: resultadoIA.articuloGenerado,
            categoria: resultadoIA.categoriaSugerida
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