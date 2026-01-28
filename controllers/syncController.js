// Archivo: lfaftechapi/controllers/syncController.js
// --- VERSIÓN: GESTIÓN DE ZOMBIES + PING DESPERTADOR + PROTECCIÓN DE CRÉDITO IA ---

const axios = require('axios');
const Article = require('../models/article');

// 1. IMPORTAMOS SOLO LA IA DE TEXTO
const { generateArticleContent } = require('../utils/geminiClient');

// --- CONFIGURACIÓN DE MULTI-BOTS ---
const VIDEO_BOT_URLS = [
    process.env.VIDEO_BOT_URL_1,
    process.env.VIDEO_BOT_URL_2,
    process.env.VIDEO_BOT_URL_3,
    process.env.VIDEO_BOT_URL_4,
    process.env.VIDEO_BOT_URL_5,
    process.env.VIDEO_BOT_URL_6
].filter(Boolean);

const VIDEO_BOT_KEY = process.env.ADMIN_API_KEY; 

let currentBotIndex = 0;

// --- Configuración de Recolección ---
const MAX_ARTICLES_PER_COUNTRY = 10;
const TIMEOUT_ZOMBIES_MINUTES = 30; // Si tarda más de 30 min, lo consideramos muerto y liberamos el slot

// --- NUEVO: INTERRUPTOR DE SEGURIDAD (CUOTA AGOTADA) ---
// Si esto es true, el sistema DEJA DE GASTAR dinero en la IA.
let isQuotaExhausted = false;

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
// NUEVO: FUNCIÓN PARA REPORTAR CUOTA AGOTADA
// (Esta función será llamada desde articleController.js cuando YouTube diga "Basta")
// =========================================================================
exports.reportQuotaLimitReached = () => {
    if (!isQuotaExhausted) {
        isQuotaExhausted = true;
        console.error("🚨 [SEGURIDAD] Se detectó CUOTA AGOTADA en YouTube.");
        console.error("🛑 [SEGURIDAD] Se ha PAUSADO la generación de textos para no gastar crédito.");
    }
};

// =========================================================================
// HELPER: RESETEAR ZOMBIES
// =========================================================================
async function _resetStuckVideos(forceAll = false) {
    try {
        let filtro = { videoProcessingStatus: 'processing' };
        
        if (!forceAll) {
            const timeLimit = new Date(Date.now() - TIMEOUT_ZOMBIES_MINUTES * 60 * 1000);
            filtro.updatedAt = { $lt: timeLimit };
        }

        const result = await Article.updateMany(
            filtro,
            { $set: { videoProcessingStatus: 'pending' } } 
        );

        if (result.modifiedCount > 0) {
            console.log(`[ZOMBIE CLEANER] 🧟 Se liberaron ${result.modifiedCount} bots que estaban pegados.`);
        }
    } catch (e) {
        console.error(`[ZOMBIE CLEANER] Error limpiando: ${e.message}`);
    }
}

// =========================================================================
// HELPER: PING DESPERTADOR
// =========================================================================
async function _wakeUpBot(url) {
    console.log(`[Ping] Despertando bot: ${url} ...`);
    try {
        await axios.get(url, { timeout: 5000 });
        return true;
    } catch (e) {
        console.log(`[Ping] Bot ${url} contactado (Status: ${e.response?.status || 'No response'}).`);
        return true;
    }
}


// =========================================================================
// PARTE 1: EL RECOLECTOR
// =========================================================================
const runNewsAPIFetch = async () => {
    if (isFetchWorkerRunning) return;
    
    // SI LA CUOTA ESTÁ AGOTADA, NO TRAEMOS NADA NUEVO PARA NO ACUMULAR
    if (isQuotaExhausted) {
        console.log("(Recolector) ⏸️ Sistema en pausa por Cuota. Saltando búsqueda.");
        return;
    }

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
            timeout: 10000 
        });

        console.log(`[VideoBot] 🚀 Tarea aceptada por el bot.`);

    } catch (error) {
        console.error(`[VideoBot] ❌ Error conectando con Bot: ${error.message}`);
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
    await _resetStuckVideos(true); 

    isNewsWorkerRunning = true;
    _runNewsWorker(); 
};

async function _runNewsWorker() {
    while (isNewsWorkerRunning) {
        try {
            // 0. LIMPIEZA PERIÓDICA
            await _resetStuckVideos(false);

            // ==============================================================
            // 🔴 PROTECCIÓN ABSOLUTA DE CRÉDITO
            // Si la cuota está agotada, simplemente esperamos 1 minuto y volvemos a preguntar.
            // NO dormimos el servidor, pero NO ejecutamos el código que gasta dinero.
            // ==============================================================
            if (isQuotaExhausted) {
                console.log(`[News Worker] 🛑 PAUSA DE SEGURIDAD: Cuota agotada. Esperando 1 min...`);
                await sleep(60 * 1000); // 1 minuto de espera
                continue; // Volvemos al inicio del while, SIN pasar por Bedrock
            }

            // 1. ¿Hay noticias en la fila?
            if (globalArticleQueue.length === 0) {
                await runNewsAPIFetch();
                
                if (globalArticleQueue.length === 0) {
                    console.log("[News Worker] 💤 Sin noticias. Durmiendo 5 min...");
                    await sleep(5 * 60 * 1000); 
                    continue;
                }
            }

            // 2. --- SEMÁFORO DE BOTS ---
            const activeVideos = await Article.countDocuments({ videoProcessingStatus: 'processing' });
            
            if (activeVideos >= VIDEO_BOT_URLS.length) {
                await sleep(15 * 1000); 
                continue; 
            }

            // 3. ¡Hay hueco! Procesamos
            const articleToProcess = globalArticleQueue.shift(); 
            console.log(`[News Worker] 🔨 Procesando: ${articleToProcess.title}`);

            // ==============================================================
            // 💰 ZONA DE GASTO (BEDROCK)
            // Solo llegamos aquí si isQuotaExhausted es FALSE
            // ==============================================================
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
    // También bloqueamos la creación manual si no hay cuota, para proteger tu dinero
    if (isQuotaExhausted) {
        return res.status(503).json({ error: "🛑 SISTEMA EN PAUSA: La cuota de YouTube se ha agotado." });
    }

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

