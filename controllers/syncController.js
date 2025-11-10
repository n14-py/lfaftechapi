// Archivo: lfaftechapi/controllers/syncController.js

const axios = require('axios');
const Article = require('../models/article');
// ¡NUEVO! Importamos el "cerebro" del bot que creamos
const { publicarArticulosEnTelegram } = require('../utils/telegramBot');

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
 * (Esta función no cambia)
 */
async function getAIArticle(articleUrl, apiKey) {
    if (!articleUrl || !articleUrl.startsWith('http')) return null;
    if (!apiKey) {
        console.error("Error: No se proporcionó una API key de DeepSeek.");
        return null;
    }
    const API_URL = 'https://api.deepseek.com/v1/chat/completions';
    const headers = {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
    };
    
    // --- 1. PROMPT DE SISTEMA (NUEVO) ---
    const systemPrompt = `Eres un reportero senior para 'Noticias.lat'. Tu trabajo es analizar una URL y devolver un artículo completo.
Tu respuesta DEBE tener el siguiente formato estricto:
LÍNEA 1: La categoría (UNA SOLA PALABRA de esta lista: politica, economia, deportes, tecnologia, entretenimiento, salud, internacional, general).
LÍNEA 2 (Y SIGUIENTES): El artículo de noticias completo, extenso y profesional (idealmente +500 palabras).
NO USES JSON. NO USES MARKDOWN. NO AÑADAS TEXTO ADICIONAL.`;

    // --- 2. PROMPT DE USUARIO (NUEVO) ---
    const userPrompt = `Analiza el contenido de este enlace y redáctalo desde cero. Recuerda el formato:
Línea 1: solo la categoría.
Línea 2 en adelante: el artículo.
URL: ${articleUrl}`;
    
    const body = {
        model: "deepseek-chat",
        messages: [ { role: "system", content: systemPrompt }, { role: "user", content: userPrompt } ]
    };
    
    try {
        const response = await axios.post(API_URL, body, { headers });
        
        // --- 3. LÓGICA DE PARSEO (¡NUEVA!) ---
        if (response.data.choices && response.data.choices.length > 0) {
            
            let responseText = response.data.choices[0].message.content;

            try {
                // Dividimos la respuesta por el primer salto de línea
                const lines = responseText.split('\n');
                
                if (lines.length < 2) {
                    console.error(`Error: IA no siguió formato (Respuesta: ${responseText}) para ${articleUrl}`);
                    return null;
                }

                // LÍNEA 1: La categoría
                let categoriaSugerida = lines[0].trim().toLowerCase();
                
                // LÍNEA 2 Y SIGUIENTES: El artículo
                let articuloGenerado = lines.slice(1).join('\n').trim();

                const categoriasValidas = ["politica", "economia", "deportes", "tecnologia", "entretenimiento", "salud", "internacional", "general"];
                if (!categoriasValidas.includes(categoriaSugerida)) {
                     console.warn(`Categoría no válida: "${categoriaSugerida}" para ${articleUrl}. Forzando a 'general'.`);
                     categoriaSugerida = "general";
                     articuloGenerado = responseText; 
                }
                
                if (!articuloGenerado) {
                    console.error(`Error: IA devolvió categoría pero no artículo para ${articleUrl}`);
                    return null;
                }

                return {
                    categoriaSugerida: categoriaSugerida,
                    articuloGenerado: articuloGenerado,
                    originalArticle: articleUrl
                };

            } catch (e) {
                console.error(`Error al parsear respuesta de IA para ${articleUrl}:`, e.message);
                console.log("Respuesta recibida:", responseText);
                return null;
            }
        }
        return null;
    } catch (error) {
        console.error(`Error en axios.post para ${articleUrl} (API Key ${apiKey.substring(0, 5)}...):`, error.message);
        return null; 
    }
}


/**
 * [PRIVADO] Sincronizar Noticias
 */
exports.syncGNews = async (req, res) => {
    try {
        if (DEEPSEEK_API_KEYS.length === 0) {
            return res.status(500).json({ error: "No hay API keys de DeepSeek configuradas." });
        }
        if (!API_KEY_GNEWS || !API_KEY_NEWSDATA) {
            return res.status(500).json({ error: "Faltan GNEWS_API_KEY o NEWSDATA_API_KEY en el .env" });
        }
        console.log(`Iniciando sync OPTIMIZADO con ${DEEPSEEK_API_KEYS.length} keys de IA.`);

        let erroresFetch = [];
        let articulosParaIA = []; 
        let totalObtenidosNewsData = 0;
        let totalObtenidosGNews = 0;
        
        // --- PASO 1: NEWSDATA.IO ---
        console.log(`Paso 1: Obteniendo noticias de NewsData.io en ${PAISES_NEWSDATA.length} llamadas...`);
        
        for (const pais of PAISES_NEWSDATA) {
             try {
                const urlNewsData = `https://newsdata.io/api/1/news?apikey=${API_KEY_NEWSDATA}&country=${pais}&language=es,pt&size=${MAX_ARTICLES_PER_COUNTRY}`;
                const response = await axios.get(urlNewsData);
                
                if (response.data.results) {
                    response.data.results.forEach(article => {
                        if (!article.title || !article.link) return;
                        const paisNombreCompleto = article.country[0];
                        const paisCodigo = paisNewsDataMap[paisNombreCompleto.toLowerCase()] || paisNombreCompleto;
                        
                        articulosParaIA.push({
                            title: article.title,
                            description: article.description || 'Sin descripción.',
                            image: article.image_url,
                            source: { name: article.source_id || 'Fuente Desconocida' },
                            url: article.link,
                            publishedAt: article.pubDate,
                            categoriaLocal: 'general',
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
            await sleep(1000); 
        }
        console.log(`-> Total Obtenidos NewsData.io: ${totalObtenidosNewsData}.`);


        // --- PASO 2: GNEWS ---
        console.log(`Paso 2: Obteniendo noticias de GNews en ${PAISES_GNEWS.length} llamadas...`);
        
        for (const pais of PAISES_GNEWS) {
             try {
                const urlGNews = `https://gnews.io/api/v4/top-headlines?country=${pais}&lang=es&max=${MAX_ARTICLES_PER_COUNTRY}&apikey=${API_KEY_GNEWS}`;
                const response = await axios.get(urlGNews);
                
                response.data.articles.forEach(article => {
                    if (!article.title || !article.url) return;
                    articulosParaIA.push({ ...article, categoriaLocal: 'general', paisLocal: pais });
                });
                const count = response.data.articles.length;
                totalObtenidosGNews += count;
                console.log(`-> [GNews] ${pais.toUpperCase()}: Obtenidos ${count} artículos.`);
            } catch (gnewsError) {
                console.error(`Error al llamar a GNews para [${pais}]: ${gnewsError.message}`);
                erroresFetch.push(`GNews-${pais}`);
            }
            await sleep(1000);
        }
        console.log(`-> Total Obtenidos GNews: ${totalObtenidosGNews}.`);
        console.log(`--- TOTAL: ${articulosParaIA.length} artículos obtenidos de las APIs.`);

        // --- PASO 3: DE-DUPLICACIÓN ---
        console.log(`Paso 3: Verificando duplicados contra la base de datos...`);
        const urlsRecibidas = articulosParaIA.map(article => article.url);
        const articulosExistentes = await Article.find({ enlaceOriginal: { $in: urlsRecibidas } }).select('enlaceOriginal');
        const urlsExistentes = new Set(articulosExistentes.map(a => a.enlaceOriginal));
        const articulosNuevosParaIA = articulosParaIA.filter(article => !urlsExistentes.has(article.url));
        console.log(`-> ${urlsExistentes.size} artículos ya existen. ${articulosNuevosParaIA.length} artículos son NUEVOS y se enviarán a la IA.`);

        // --- PASO 4: IA (CLASIFICACIÓN Y GENERACIÓN) ---
        console.log(`Paso 4: Iniciando generación de IA para ${articulosNuevosParaIA.length} artículos...`);
        
        const promesasDeArticulos = articulosNuevosParaIA.map((article, index) => {
            const apiKeyParaUsar = DEEPSEEK_API_KEYS[index % DEEPSEEK_API_KEYS.length];
            return getAIArticle(article.url, apiKeyParaUsar)
                .then(resultadoIA => {
                    return { ...article, ...resultadoIA };
                });
        });

        const resultadosCompletos = await Promise.all(promesasDeArticulos);
        const articulosValidosIA = resultadosCompletos.filter(r => r && r.articuloGenerado && r.categoriaSugerida && r.url);
        console.log(`-> ${articulosValidosIA.length} artículos procesados y clasificados por IA.`);

        // --- PASO 5: Base de Datos ---
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

        // --- PASO 6: Guardar ---
        let totalArticulosNuevos = 0;
        let totalArticulosActualizados = 0;
        
        if (operations.length > 0) {
            console.log(`Paso 5: Guardando ${operations.length} artículos NUEVOS en la base de datos...`);
            const result = await Article.bulkWrite(operations);
            totalArticulosNuevos = result.upsertedCount;
            totalArticulosActualizados = result.modifiedCount;
            
            // --- ¡¡CÓDIGO NUEVO!! ---
            // ¡SI SE GUARDARON ARTÍCULOS NUEVOS, LOS PUBLICAMOS!
            if (totalArticulosNuevos > 0) {
                // 'articulosValidosIA' tiene la lista de artículos que se acaban de guardar
                // Lo ejecutamos SIN await para no detener la respuesta de la API
                
                // Necesitamos pasar los artículos guardados (con el _id) al bot de Telegram
                // Primero, busquemos los artículos que acabamos de insertar
                const urlsNuevas = articulosValidosIA.map(a => a.url);
                const articulosRecienGuardados = await Article.find({ enlaceOriginal: { $in: urlsNuevas } });
                
                console.log(`[Telegram] Detectados ${articulosRecienGuardados.length} artículos nuevos. Iniciando bot...`);
                
                publicarArticulosEnTelegram(articulosRecienGuardados)
                    .catch(e => console.error("Error en la publicación de Telegram en segundo plano:", e));
            }
            // --- FIN DEL CÓDIGO NUEVO ---
        }

        console.log("¡Sincronización con AHORRO DE IA completada!");
        
        // --- PASO 7: Respuesta (Reporte Detallado) ---
        res.json({ 
            message: "Sincronización con AHORRO DE IA completada.",
            reporte: {
                totalObtenidosNewsData: totalObtenidosNewsData,
                totalObtenidosGNews: totalObtenidosGNews,
                totalArticulosRecibidos: articulosParaIA.length,
                totalArticulosYaExistentes: urlsExistentes.size,
                totalArticulosNuevosParaIA: articulosNuevosParaIA.length,
                totalProcesadosIA_Exitosos: articulosValidosIA.length,
                totalFallidosIA: articulosNuevosParaIA.length - articulosValidosIA.length,
                nuevosArticulosGuardadosEnDB: totalArticulosNuevos,
                articulosActualizadosEnDB: totalArticulosActualizados,
                apisConError: erroresFetch
            }
        });

    } catch (error) {
        console.error("Error catastrófico en syncGNews (Clasificación IA Texto Plano):", error.message);
        res.status(500).json({ error: "Error al sincronizar (Clasificación IA Texto Plano)." });
    }
};

/**
 * [PRIVADO] Añadir un nuevo artículo manually
 * (Esta función no cambia)
 */
exports.createManualArticle = async (req, res) => {
    try {
        if (DEEPSEEK_API_KEYS.length === 0) {
            return res.status(500).json({ error: "No hay API keys de DeepSeek configuradas." });
        }
        
        const { titulo, descripcion, imagen, sitio, fuente, enlaceOriginal, fecha, pais } = req.body;
        
        if (!enlaceOriginal || !enlaceOriginal.startsWith('http')) {
             return res.status(400).json({ error: "El 'enlaceOriginal' (URL) es obligatorio para que la IA trabaje." });
        }
        
        const resultadoIA = await getAIArticle(enlaceOriginal, DEEPSEEK_API_KEYS[0]);

        if (!resultadoIA) {
            return res.status(500).json({ error: "La IA no pudo procesar la URL proporcionada." });
        }

        const newArticle = new Article({
            titulo: titulo || 'Título no proporcionado (IA)',
            descripcion: descripcion || 'Descripción no proporcionada (IA)',
            imagen: imagen || null,
            sitio: sitio || 'noticias.lat',
            fuente: fuente || 'Fuente desconocida',
            enlaceOriginal: enlaceOriginal,
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



/**
 * [PÚBLICO] Generar el Sitemap.xml
 * (Esta función no cambia)
 */
exports.getSitemap = async (req, res) => {
    const BASE_URL = 'https://noticias.lat'; 

    try {
        const articles = await Article.find()
            .sort({ fecha: -1 })
            .select('_id fecha');
        
        let xml = '<?xml version="1.0" encoding="UTF-8"?>';
        xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">';

        // 2. Añadir Páginas Estáticas (Homepage, Contacto, etc.)
        const staticPages = [
            { loc: '', priority: '1.00', changefreq: 'daily' }, 
            { loc: 'sobre-nosotros.html', priority: '0.80', changefreq: 'monthly' },
            { loc: 'contacto.html', priority: '0.80', changefreq: 'monthly' },
            { loc: 'politica-privacidad.html', priority: '0.50', changefreq: 'yearly' },
            { loc: 'terminos.html', priority: '0.50', changefreq: 'yearly' },
        ];

        staticPages.forEach(page => {
            xml += '<url>';
            xml += `<loc>${BASE_URL}/${page.loc}</loc>`;
            xml += `<priority>${page.priority}</priority>`;
            xml += `<changefreq>${page.changefreq}</changefreq>`;
            xml += '</url>';
        });

        // 3. Añadir todos los Artículos (Dinámicos)
        articles.forEach(article => {
            const articleDate = new Date(article.fecha).toISOString().split('T')[0];
            xml += '<url>';
            xml += `<loc>${BASE_URL}/articulo.html?id=${article._id}</loc>`; 
            xml += `<lastmod>${articleDate}</lastmod>`;
            xml += '<changefreq>weekly</changefreq>'; 
            xml += '<priority>0.90</priority>';
            xml += '</url>';
        });

        xml += '</urlset>';

        res.header('Content-Type', 'application/xml');
        res.send(xml);

    } catch (error) {
        console.error("Error en getSitemap:", error);
        res.status(500).json({ error: "Error interno del servidor." });
    }
};