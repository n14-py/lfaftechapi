// Archivo: lfaftechapi/controllers/syncController.js
// --- ¡VERSIÓN WORKER (Lento y Seguro) con AWS BEDROCK! ---

const axios = require('axios');
const Article = require('../models/article');
const { publicarUnArticulo } = require('../utils/telegramBot');
const { generateArticleContent } = require('../utils/bedrockClient'); // ¡Usamos AWS!

// --- Constantes (Tus APIs de noticias) ---
const API_KEY_GNEWS = process.env.GNEWS_API_KEY;
const API_KEY_NEWSDATA = process.env.NEWSDATA_API_KEY;
const MAX_ARTICLES_PER_COUNTRY = 10;
const paisNewsDataMap = {
    "argentina": "ar", "bolivia": "bo", "brazil": "br", "chile": "cl", 
    "colombia": "co", "costa rica": "cr", "cuba": "cu", "ecuador": "ec", 
    "el salvador": "sv", "guatemala": "gt", "honduras": "hn", "mexico": "mx", 
    "nicaragua": "ni", "panama": "pa", "paraguay": "py", "peru": "pe", 
    "dominican republic": "do", "uruguay": "uy", "venezuela": "ve"
};
const PAISES_NEWSDATA = [
    "ar", "bo", "br", "cl", "co", "cr", "cu", "ec", "sv", 
    "gt", "hn", "mx", "ni", "pa", "py", "pe", "do", "uy", "ve"
];
const PAISES_GNEWS = [
    "ar", "br", "cl", "co", "ec", "mx", "pe", "py", "uy", "ve"
];
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// --- Banderas de estado para los Workers ---
let isAIWorkerRunning = false;
let isTelegramWorkerRunning = false;
let isFetchWorkerRunning = false;


// =============================================
// PARTE 1: EL RECOLECTOR (Llamado 8 veces al día)
// =============================================

/**
 * [PRIVADO] Esta es la función que llama el Cron Job (8 veces/día).
 * Responde INMEDIATAMENTE y llama al trabajo pesado de RECOLECCIÓN.
 */
exports.syncNewsAPIs = async (req, res) => {
    // 1. Responder al usuario/cron job INMEDIATAMENTE
    res.json({ 
        message: "¡Trabajo de RECOLECCIÓN iniciado! Buscando en GNews y NewsData en segundo plano."
    });

    // 2. Llamar a la función real SIN 'await'
    // (Asegurarnos de que no se ejecuten dos a la vez)
    if (isFetchWorkerRunning) {
        console.warn("[RECOLECTOR] Intento de iniciar, pero ya estaba corriendo. Saltando.");
        return;
    }
    
    isFetchWorkerRunning = true;
    try {
        await _runNewsAPIFetch();
    } catch (err) {
        console.error("Error catastrófico en el trabajo de fondo de _runNewsAPIFetch:", err.message);
    } finally {
        isFetchWorkerRunning = false;
    }
};

/**
 * [INTERNO] Esta es la función de trabajo pesado de RECOLECCIÓN.
 * Solo busca noticias y las guarda "crudas" (sin IA).
 */
async function _runNewsAPIFetch() {
    try {
        if (!API_KEY_GNEWS || !API_KEY_NEWSDATA) {
            console.error("(Recolector) Error: Faltan GNEWS_API_KEY o NEWSDATA_API_KEY.");
            return;
        }
        console.log(`(Recolector) Iniciando recolección de GNews y NewsData...`);

        let erroresFetch = [];
        let articulosCrudos = []; 
        let totalObtenidosNewsData = 0;
        let totalObtenidosGNews = 0;
        
        // --- PASO 1: NEWSDATA.IO ---
        for (const pais of PAISES_NEWSDATA) {
             try {
                const urlNewsData = `https://newsdata.io/api/1/news?apikey=${API_KEY_NEWSDATA}&country=${pais}&language=es,pt&size=${MAX_ARTICLES_PER_COUNTRY}`;
                const response = await axios.get(urlNewsData);
                if (response.data.results) {
                    response.data.results.forEach(article => {
                        if (!article.title || !article.link) return;
                        const paisNombreCompleto = article.country[0];
                        const paisCodigo = paisNewsDataMap[paisNombreCompleto.toLowerCase()] || paisNombreCompleto;
                        articulosCrudos.push({
                            title: article.title,
                            description: article.description || 'Sin descripción.',
                            image: article.image_url,
                            source: { name: article.source_id || 'Fuente Desconocida' },
                            url: article.link,
                            publishedAt: article.pubDate,
                            paisLocal: paisCodigo
                        });
                    });
                    totalObtenidosNewsData += response.data.results.length;
                }
            } catch (e) {
                console.error(`(Recolector) Error NewsData [${pais}]: ${e.message}`);
                erroresFetch.push(`NewsData-${pais}`);
            }
            await sleep(1000); 
        }
        console.log(`(Recolector) -> Total Obtenidos NewsData.io: ${totalObtenidosNewsData}.`);

        // --- PASO 2: GNEWS ---
        for (const pais of PAISES_GNEWS) {
             try {
                const urlGNews = `https://gnews.io/api/v4/top-headlines?country=${pais}&lang=es&max=${MAX_ARTICLES_PER_COUNTRY}&apikey=${API_KEY_GNEWS}`;
                const response = await axios.get(urlGNews);
                response.data.articles.forEach(article => {
                    if (!article.title || !article.url) return;
                    articulosCrudos.push({ ...article, paisLocal: pais });
                });
                totalObtenidosGNews += response.data.articles.length;
            } catch (e) {
                console.error(`(Recolector) Error GNews [${pais}]: ${e.message}`);
                erroresFetch.push(`GNews-${pais}`);
            }
            await sleep(1000);
        }
        console.log(`(Recolector) -> Total Obtenidos GNews: ${totalObtenidosGNews}.`);
        console.log(`(Recolector) --- TOTAL: ${articulosCrudos.length} artículos obtenidos.`);

        // --- PASO 3: DE-DUPLICACIÓN ---
        const urlsRecibidas = articulosCrudos.map(article => article.url);
        const articulosExistentes = await Article.find({ enlaceOriginal: { $in: urlsRecibidas } }).select('enlaceOriginal');
        const urlsExistentes = new Set(articulosExistentes.map(a => a.enlaceOriginal));
        
        const articulosNuevos = articulosCrudos.filter(article => !urlsExistentes.has(article.url));
        console.log(`(Recolector) -> ${urlsExistentes.size} artículos ya existen. ${articulosNuevos.length} artículos son NUEVOS.`);

        // --- PASO 4: GUARDAR EN DB (SIN IA) ---
        const operations = articulosNuevos.map(article => ({
            updateOne: {
                filter: { enlaceOriginal: article.url }, 
                update: {
                    $set: {
                        titulo: article.title,
                        descripcion: article.description || 'Sin descripción.',
                        imagen: article.image,
                        sitio: 'noticias.lat',
                        // ¡Campos de IA y Telegram se quedan en NULL/false por defecto!
                        categoria: 'general', // Se asignará por IA después
                        pais: article.paisLocal,
                        fuente: article.source.name,
                        enlaceOriginal: article.url,
                        fecha: new Date(article.publishedAt)
                    }
                },
                upsert: true 
            }
        }));

        if (operations.length > 0) {
            console.log(`(Recolector) Guardando ${operations.length} artículos NUEVOS (crudos) en la DB...`);
            const result = await Article.bulkWrite(operations);
            console.log(`(Recolector) -> ${result.upsertedCount} nuevos artículos guardados.`);
        }

        console.log("(Recolector) ¡Recolección finalizada!");
        
    } catch (error) {
        console.error("(Recolector) Error catastrófico en _runNewsAPIFetch:", error.message);
    }
}


// =============================================
// PARTE 2: EL WORKER DE IA (Se ejecuta 1 vez y corre para siempre)
// =============================================

/**
 * [PRIVADO] Inicia el worker de IA (Llamar 1 sola vez al iniciar el server)
 */
exports.startAIWorker = () => {
    if (isAIWorkerRunning) {
        console.log("[IA Worker] Ya está corriendo.");
        return;
    }
    console.log("[IA Worker] Iniciando worker de IA...");
    isAIWorkerRunning = true;
    _runAIWorker(); // Inicia el bucle sin 'await'
};

/**
 * [INTERNO] El bucle infinito que procesa artículos con IA, uno por uno.
 * (Similar al de las radios)
 */
async function _runAIWorker() {
    while (isAIWorkerRunning) { // Bucle infinito
        let articleToProcess = null;
        try {
            // 1. Buscar un artículo que no tenga IA
            articleToProcess = await Article.findOne({
                articuloGenerado: null, // El campo de IA está vacío
                sitio: 'noticias.lat'
            });

            if (!articleToProcess) {
                // No hay trabajo, esperamos 5 minutos
                await sleep(5 * 60 * 1000); 
                continue; // Vuelve al inicio del 'while'
            }

            // 2. ¡Encontramos trabajo! Llamar a AWS Bedrock
            console.log(`[IA Worker] Procesando: ${articleToProcess.titulo}`);
            const resultadoIA = await generateArticleContent(articleToProcess);

            // 3. Guardar el resultado
            if (resultadoIA) {
                articleToProcess.articuloGenerado = resultadoIA.articuloGenerado;
                articleToProcess.categoria = resultadoIA.categoriaSugerida;
            } else {
                // Si la IA falla, lo marcamos para no reintentar
                articleToProcess.articuloGenerado = "FAILED_IA"; 
            }
            await articleToProcess.save();
            
            // 4. Pausa de 60 segundos (1 minuto por artículo)
            // Esto nos da 1440 artículos/día. ¡Seguro para tus créditos de AWS!
            await sleep(60 * 1000); 

        } catch (error) {
            console.error(`[IA Worker] Error fatal procesando ${articleToProcess?.titulo}: ${error.message}`);
            // Si la DB falla, esperamos 5 mins antes de reintentar
            await sleep(5 * 60 * 1000);
        }
    }
}


// =============================================
// PARTE 3: EL WORKER DE TELEGRAM (Se ejecuta 1 vez y corre para siempre)
// =============================================

/**
 * [PRIVADO] Inicia el worker de Telegram (Llamar 1 sola vez al iniciar el server)
 */
exports.startTelegramWorker = () => {
    if (isTelegramWorkerRunning) {
        console.log("[Telegram Worker] Ya está corriendo.");
        return;
    }
    console.log("[Telegram Worker] Iniciando worker de Telegram...");
    isTelegramWorkerRunning = true;
    _runTelegramWorker(); // Inicia el bucle sin 'await'
};

/**
 * [INTERNO] El bucle infinito que publica en Telegram, uno por uno.
 */
async function _runTelegramWorker() {
    while (isTelegramWorkerRunning) {
        let articleToPost = null;
        try {
            // 1. Buscar un artículo LISTO para postear
            articleToPost = await Article.findOne({
                articuloGenerado: { $ne: null, $ne: "FAILED_IA" }, // IA ya terminó
                telegramPosted: false, // Aún no se posteó
                sitio: 'noticias.lat'
            }).sort({ fecha: 1 }); // Postear el más antiguo primero

            if (!articleToPost) {
                // No hay trabajo, esperamos 1 minuto
                await sleep(60 * 1000);
                continue;
            }

            // 2. ¡Encontramos trabajo! Llamar al bot
            console.log(`[Telegram Worker] Publicando: ${articleToPost.titulo}`);
            
            // Esta función (que creamos en telegramBot.js)
            // se encarga de enviar Y marcar 'telegramPosted: true'
            await publicarUnArticulo(articleToPost); 
            
            // 3. Pausa de 90 segundos entre posts (tu pedido de ~100 al día)
            await sleep(90 * 1000); 

        } catch (error) {
            console.error(`[Telegram Worker] Error fatal: ${error.message}`);
            // Si hay un error, esperamos 1 min
            await sleep(60 * 1000);
        }
    }
}


// =============================================
// PARTE 4: RUTAS MANUALES Y SITEMAP (Actualizadas)
// =============================================

/**
 * [PRIVADO] Añadir un nuevo artículo manualmente
 * (Actualizado para usar Bedrock)
 */
exports.createManualArticle = async (req, res) => {
    try {
        const { titulo, descripcion, imagen, sitio, fuente, enlaceOriginal, fecha, pais } = req.body;
        
        if (!enlaceOriginal || !enlaceOriginal.startsWith('http')) {
             return res.status(400).json({ error: "El 'enlaceOriginal' (URL) es obligatorio para que la IA trabaje." });
        }
        
        // 1. Llamar a la IA (Bedrock)
        const resultadoIA = await generateArticleContent({ enlaceOriginal, titulo });

        if (!resultadoIA) {
            return res.status(500).json({ error: "La IA (Bedrock) no pudo procesar la URL proporcionada." });
        }

        // 2. Guardar en la DB (marcado como NO POSTEADO en Telegram)
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
            categoria: resultadoIA.categoriaSugerida,
            telegramPosted: false // El worker de Telegram lo encontrará
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
 * (Esta función no cambia, está perfecta)
 */
exports.getSitemap = async (req, res) => {
    const BASE_URL = 'https://noticias.lat'; 

    try {
        const articles = await Article.find({sitio: 'noticias.lat'})
            .sort({ fecha: -1 })
            .select('_id fecha');
        
        let xml = '<?xml version="1.0" encoding="UTF-8"?>';
        xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">';

        const staticPages = [
            { loc: '', priority: '1.00', changefreq: 'daily' }, 
            { loc: 'sobre-nosotros', priority: '0.80', changefreq: 'monthly' },
            { loc: 'contacto', priority: '0.80', changefreq: 'monthly' },
            { loc: 'politica-privacidad', priority: '0.50', changefreq: 'yearly' },
            { loc: 'terminos', priority: '0.50', changefreq: 'yearly' },
        ];

        staticPages.forEach(page => {
            xml += '<url>';
            xml += `<loc>${BASE_URL}/${page.loc}</loc>`;
            xml += `<priority>${page.priority}</priority>`;
            xml += `<changefreq>${page.changefreq}</changefreq>`;
            xml += '</url>';
        });

        articles.forEach(article => {
            const articleDate = new Date(article.fecha).toISOString().split('T')[0];
            xml += '<url>';
            xml += `<loc>${BASE_URL}/articulo/${article._id}</loc>`; 
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