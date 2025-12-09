// Archivo: lfaftechapi/controllers/syncController.js
// --- VERSIÓN: GESTIÓN DE ZOMBIES + PING DESPERTADOR + FETCH BAJO DEMANDA ---

const axios = require('axios');
const Article = require('../models/article');

// 1. IMPORTAMOS SOLO LA IA DE TEXTO
const { generateArticleContent } = require('../utils/bedrockClient');

// --- CONFIGURACIÓN DE MULTI-BOTS ---
const VIDEO_BOT_URLS = [
    process.env.VIDEO_BOT_URL_1,
    process.env.VIDEO_BOT_URL_2,
    process.env.VIDEO_BOT_URL_3
].filter(Boolean);

const VIDEO_BOT_KEY = process.env.ADMIN_API_KEY; 

let currentBotIndex = 0;

// --- Configuración de Recolección ---
const MAX_ARTICLES_PER_COUNTRY = 10;
const TIMEOUT_ZOMBIES_MINUTES = 30; // Si tarda más de 30 min, lo consideramos muerto y liberamos el slot

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

// --- Banderas de estado ---
let isNewsWorkerRunning = false;
let isFetchWorkerRunning = false;
let globalArticleQueue = []; 

// --- Claves (Rotación) ---
const gnewsKeys = [
    process.env.GNEWS_API_KEY, process.env.GNEWS_API_KEY_2, process.env.GNEWS_API_KEY_3, process.env.GNEWS_API_KEY_4
].filter(Boolean);

const newsDataKeys = [
    process.env.NEWSDATA_API_KEY, process.env.NEWSDATA_API_KEY_2, process.env.NEWSDATA_API_KEY_3, process.env.NEWSDATA_API_KEY_4
].filter(Boolean);

let currentGNewsKeyIndex = 0;
let currentNewsDataKeyIndex = 0;

// =========================================================================
// HELPER: RESETEAR ZOMBIES (IMPORTANTE PARA TU PROBLEMA)
// =========================================================================
/**
 * Busca videos que quedaron en 'processing' por error (reinicio del server, crash)
 * y los devuelve a 'pending' para que no ocupen espacio fantasma.
 */
async function _resetStuckVideos(forceAll = false) {
    try {
        let filtro = { videoProcessingStatus: 'processing' };
        
        // Si no forzamos todos, solo buscamos los que llevan mucho tiempo bloqueados (timeout)
        if (!forceAll) {
            const timeLimit = new Date(Date.now() - TIMEOUT_ZOMBIES_MINUTES * 60 * 1000);
            filtro.updatedAt = { $lt: timeLimit };
        }

        const result = await Article.updateMany(
            filtro,
            { $set: { videoProcessingStatus: 'pending' } } // Los devolvemos a la fila
        );

        if (result.modifiedCount > 0) {
            console.log(`[ZOMBIE CLEANER] 🧟 Se liberaron ${result.modifiedCount} bots que estaban pegados.`);
        }
    } catch (e) {
        console.error(`[ZOMBIE CLEANER] Error limpiando: ${e.message}`);
    }
}

// =========================================================================
// HELPER: PING DESPERTADOR (Wake up Render)
// =========================================================================
async function _wakeUpBot(url) {
    console.log(`[Ping] Despertando bot: ${url} ...`);
    try {
        // Timeout corto de 5s, solo queremos ver si responde o forzar que Render lo arranque
        await axios.get(url, { timeout: 5000 });
        return true;
    } catch (e) {
        // Incluso si da error 404 (porque quizás no hay ruta GET /), significa que el server respondió
        // Si es timeout, es que se está despertando.
        console.log(`[Ping] Bot ${url} contactado (Status: ${e.response?.status || 'No response'}).`);
        return true;
    }
}


// =========================================================================
// PARTE 1: EL RECOLECTOR
// =========================================================================
const runNewsAPIFetch = async () => {
    if (isFetchWorkerRunning) return;
    isFetchWorkerRunning = true;
    currentGNewsKeyIndex = 0;
    currentNewsDataKeyIndex = 0;

    try {
        console.log(`(Recolector) 📥 ¡Fila vacía! Buscando noticias nuevas...`);

        let articulosCrudos = []; 
        
        // --- A. NEWSDATA.IO ---
        for (const pais of PAISES_NEWSDATA) {
            let success = false;
            let attempts = 0;
            while (!success && attempts < newsDataKeys.length) {
                try {
                    const currentKey = newsDataKeys[currentNewsDataKeyIndex];
                    const urlNewsData = `https://newsdata.io/api/1/news?apikey=${currentKey}&country=${pais}&language=es,pt&size=${MAX_ARTICLES_PER_COUNTRY}`;
                    const response = await axios.get(urlNewsData);
                    
                    if (response.data.results) {
                        response.data.results.forEach(article => {
                            if (!article.title || !article.link || !article.image_url) return;
                            const paisNombreCompleto = article.country ? article.country[0] : 'unknown';
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
                    }
                    success = true; 
                } catch (e) {
                    const status = e.response?.status;
                    if (status === 429 || status === 401 || status === 403) {
                        currentNewsDataKeyIndex = (currentNewsDataKeyIndex + 1) % newsDataKeys.length;
                        attempts++;
                        await sleep(1000); 
                    } else { break; }
                }
            } 
            await sleep(2000); 
        }

        // --- B. GNEWS ---
        for (const pais of PAISES_GNEWS) {
            let success = false;
            let attempts = 0;
            while (!success && attempts < gnewsKeys.length) {
                try {
                    const currentKey = gnewsKeys[currentGNewsKeyIndex];
                    const urlGNews = `https://gnews.io/api/v4/top-headlines?country=${pais}&lang=es&max=${MAX_ARTICLES_PER_COUNTRY}&apikey=${currentKey}`;
                    const response = await axios.get(urlGNews);
                    response.data.articles.forEach(article => {
                        if (!article.title || !article.url || !article.image) return; 
                        articulosCrudos.push({ ...article, paisLocal: pais });
                    });
                    success = true; 
                } catch (e) {
                    const status = e.response?.status;
                    if (status === 429 || status === 403 || status === 401) {
                        currentGNewsKeyIndex = (currentGNewsKeyIndex + 1) % gnewsKeys.length; 
                        attempts++;
                        await sleep(1000); 
                    } else { break; }
                }
            }
            await sleep(1000); 
        }

        // --- C. FILTRADO ---
        const urlsRecibidas = articulosCrudos.map(article => article.url);
        const articulosExistentesDB = await Article.find({ enlaceOriginal: { $in: urlsRecibidas } }).select('enlaceOriginal');
        const urlsExistentesDB = new Set(articulosExistentesDB.map(a => a.enlaceOriginal));
        const urlsEnFila = new Set(globalArticleQueue.map(a => a.url));

        const articulosNuevos = articulosCrudos.filter(article => {
            return !urlsExistentesDB.has(article.url) && !urlsEnFila.has(article.url);
        });
        
        if (articulosNuevos.length > 0) {
            globalArticleQueue.push(...articulosNuevos);
            console.log(`(Recolector) ✅ Se añadieron ${articulosNuevos.length} noticias a la cola de trabajo.`);
        } else {
            console.log(`(Recolector) ⚠️ No se encontraron noticias nuevas en esta ronda.`);
        }
        
    } catch (error) {
        console.error("(Recolector) Error:", error.message);
    } finally {
        isFetchWorkerRunning = false;
    }
};
exports.runNewsAPIFetch = runNewsAPIFetch;


// =========================================================================
// PARTE 2: EL GESTOR DE BOTS (Con Ping)
// =========================================================================

async function _triggerVideoBotWithRotation(article) {
    if (VIDEO_BOT_URLS.length === 0) {
        console.warn(`[VideoBot] ❌ NO HAY BOTS CONFIGURADOS.`);
        return;
    }

    const articleCheck = await Article.findById(article._id);
    if (!articleCheck) return;

    // Seleccionar Bot
    const targetBotUrl = VIDEO_BOT_URLS[currentBotIndex];
    currentBotIndex = (currentBotIndex + 1) % VIDEO_BOT_URLS.length;

    try {
        // 1. Marcar como 'processing' ANTES de enviar
        articleCheck.videoProcessingStatus = 'processing';
        await articleCheck.save();

        // 2. ¡DESPERTAR AL BOT! (Ping)
        // Esto evita errores de timeout si Render lo durmió
        await _wakeUpBot(targetBotUrl);

        // 3. Payload
        const payload = {
            text: articleCheck.articuloGenerado, 
            title: articleCheck.titulo,            
            image_url: articleCheck.imagen, 
            article_id: articleCheck._id 
        };

        // 4. Enviar trabajo
        console.log(`[VideoBot] Enviando tarea a ${targetBotUrl}...`);
        await axios.post(`${targetBotUrl}/generate_video`, payload, { 
            headers: { 'x-api-key': VIDEO_BOT_KEY },
            timeout: 10000 // Timeout corto para el handshake
        });

        console.log(`[VideoBot] 🚀 Tarea aceptada por el bot.`);

    } catch (error) {
        console.error(`[VideoBot] ❌ Error conectando con Bot: ${error.message}`);
        // Si falló la conexión, devolvemos a 'pending' para que otro bot (o el mismo más tarde) lo intente
        articleCheck.videoProcessingStatus = 'pending';
        await articleCheck.save();
    }
}


// =========================================================================
// PARTE 3: EL WORKER CONTROLADOR (CICLO BAJO DEMANDA)
// =========================================================================

exports.syncNewsAPIs = async (req, res) => {
    res.json({ message: "Disparador manual activado." });
    runNewsAPIFetch();
};

exports.startNewsWorker = async () => {
    if (isNewsWorkerRunning) return;
    
    console.log(`[News Worker] 🟢 INICIANDO SISTEMA...`);
    
    // --- LIMPIEZA INICIAL ---
    // Reseteamos TODO lo que quedó "processing" al reiniciar el server
    // Esto arregla el bug de "3/3 ocupados" al instante.
    await _resetStuckVideos(true); 

    isNewsWorkerRunning = true;
    _runNewsWorker(); 
};

async function _runNewsWorker() {
    while (isNewsWorkerRunning) {
        try {
            // 0. LIMPIEZA PERIÓDICA DE ZOMBIES (Timeout)
            // Si un bot murió a mitad de camino hace 30 mins, liberamos el slot.
            await _resetStuckVideos(false);

            // 1. ¿Hay noticias en la fila?
            if (globalArticleQueue.length === 0) {
                // AQUÍ ESTÁ EL CAMBIO: SI NO HAY, BUSCAMOS.
                // Ya no usamos CronJob. El worker pide comida cuando tiene hambre.
                await runNewsAPIFetch();
                
                // Si después de buscar sigue vacía, dormimos un rato largo
                if (globalArticleQueue.length === 0) {
                    console.log("[News Worker] 💤 No hay noticias y el recolector no trajo nada. Durmiendo 5 min...");
                    await sleep(5 * 60 * 1000); 
                    continue;
                }
            }

            // 2. --- EL FRENO DE MANO (SEMÁFORO) ---
            const activeVideos = await Article.countDocuments({ videoProcessingStatus: 'processing' });
            
            if (activeVideos >= VIDEO_BOT_URLS.length) {
                // LOG MENOS MOLESTO (Solo avisamos si cambia estado o cada cierto tiempo)
                // console.log(`[News Worker] ✋ Bots a tope (${activeVideos}/${VIDEO_BOT_URLS.length}). Esperando hueco...`);
                await sleep(15 * 1000); // Chequear cada 15s es suficiente
                continue; 
            }

            // 3. ¡Hay hueco! Procesamos
            const articleToProcess = globalArticleQueue.shift(); 
            console.log(`[News Worker] 🔨 Procesando: ${articleToProcess.title}`);

            // 4. Generar Texto (Bedrock)
            const resultadoIA = await generateArticleContent(articleToProcess);

            if (resultadoIA && resultadoIA.articuloGenerado) {
                const { categoria, tituloViral, articuloGenerado } = resultadoIA;
                
                const newArticle = new Article({
                    titulo: tituloViral || articleToProcess.title, 
                    descripcion: articleToProcess.description,
                    imagen: articleToProcess.image, 
                    sitio: 'noticias.lat',
                    categoria: categoria,
                    pais: articleToProcess.paisLocal,
                    fuente: articleToProcess.source.name,
                    enlaceOriginal: articleToProcess.url,
                    fecha: new Date(articleToProcess.publishedAt),
                    articuloGenerado: articuloGenerado,
                    telegramPosted: false,
                    videoProcessingStatus: 'pending'
                });
                
                await newArticle.save();
                
                // 5. Enviar al Bot
                await _triggerVideoBotWithRotation(newArticle);
                
            } else {
                console.warn(`[News Worker] Fallo IA Texto. Saltando.`);
            }
            
            await sleep(2000); 

        } catch (error) {
            console.error(`[News Worker] Error Ciclo: ${error.message}`);
            await sleep(30 * 1000);
        }
    }
}


// =========================================================================
// PARTE 4: MANUAL Y SITEMAP
// =========================================================================

exports.createManualArticle = async (req, res) => {
    try {
        const { titulo, enlaceOriginal, imagen } = req.body;
        const iaData = await generateArticleContent({ url: enlaceOriginal, title: titulo || "Manual" });
        if (!iaData) return res.status(500).json({ error: "Error IA Texto" });

        const newArticle = new Article({
            titulo: iaData.tituloViral, 
            descripcion: 'Manual',
            imagen: imagen || 'https://via.placeholder.com/800x600',
            sitio: 'noticias.lat',
            enlaceOriginal: enlaceOriginal,
            articuloGenerado: iaData.articuloGenerado,
            categoria: iaData.categoria,
            telegramPosted: false,
            videoProcessingStatus: 'pending'
        });

        await newArticle.save();
        _triggerVideoBotWithRotation(newArticle);
        res.status(201).json(newArticle);
    } catch (error) { 
        res.status(500).json({ error: error.message });
    }
};

exports.getSitemap = async (req, res) => {
    const BASE_URL = 'https://noticias.lat';
    try {
        const articles = await Article.find({sitio: 'noticias.lat'}).sort({ fecha: -1 }).select('_id fecha');
        let xml = '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">';
        
        ['', 'sobre-nosotros', 'contacto', 'politica-privacidad', 'terminos'].forEach(p => {
            xml += `<url><loc>${BASE_URL}/${p}</loc><priority>0.8</priority></url>`;
        });

        articles.forEach(article => {
            const d = new Date(article.fecha).toISOString().split('T')[0];
            xml += `<url><loc>${BASE_URL}/articulo/${article._id}</loc><lastmod>${d}</lastmod><priority>0.9</priority></url>`;
        });
        xml += '</urlset>';
        res.header('Content-Type', 'application/xml');
        res.send(xml);
    } catch (error) {
        res.status(500).json({ error: "Error interno" });
    }
};