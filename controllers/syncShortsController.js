// Archivo: lfaftechapi/controllers/syncShortsController.js
// --- VERSIÓN: ULTIMATE SHORTS (Clon 1:1 del Original + Buffer Inteligente + Gestión de Zombies + Bot Vertical) ---

const axios = require('axios');
const Article = require('../models/article');
// Importamos el cliente Gemini Rotativo adaptado para Shorts
const { generateShortArticleContent } = require('../utils/geminiClient');

// ============================================================================
// ⚙️ 1. CONFIGURACIÓN DE LA FLOTA DE BOTS (VIDEO WORKERS PARA SHORTS)
// ============================================================================
const SHORT_BOT_URLS = [
    "http://3.21.126.1:3001" // IP DE TU SERVIDOR EXCLUSIVO DE SHORTS
];

// Clave para comunicar con los bots (si la usan)
const VIDEO_BOT_KEY = process.env.ADMIN_API_KEY || "123456"; 

// Índice para rotar entre los bots de Shorts (por si luego agregas más)
let currentShortBotIndex = 0;

// ============================================================================
// ⚙️ 2. CONFIGURACIÓN DE LÍMITES Y BUFFER (EL CEREBRO SHORTS)
// ============================================================================

// Límite de noticias por país al buscar en las APIs
const MAX_ARTICLES_PER_COUNTRY = 10;

// TIEMPO ZOMBIE: Si un video lleva 30 mins "haciéndose", asumimos que murió.
const TIMEOUT_ZOMBIES_MINUTES = 30;

// BUFFER SIZE: La clave de todo. 
// Si hay más de 15 noticias esperando video, NO buscamos más noticias ni gastamos Gemini.
const BUFFER_SIZE_LIMIT = 15;

// Variables de estado del sistema (EXCLUSIVAS PARA SHORTS)
let isShortsWorkerRunning = false;
let isShortsFetchRunning = false;
let isShortsQuotaExhausted = false; // Interruptor de emergencia global de Shorts
let globalShortsQueue = []; // Cola en memoria temporal para Shorts

// ============================================================================
// ⚙️ 3. CLAVES Y PAÍSES (LÓGICA ORIGINAL RESTAURADA Y COMPARTIDA)
// ============================================================================

// Mapeo de nombres de países a códigos ISO
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

// Rotación de Claves para las APIs de Noticias (GNews / NewsData)
const gnewsKeys = [
    process.env.GNEWS_API_KEY, process.env.GNEWS_API_KEY_2, process.env.GNEWS_API_KEY_3, process.env.GNEWS_API_KEY_4
].filter(Boolean);

const newsDataKeys = [
    process.env.NEWSDATA_API_KEY, process.env.NEWSDATA_API_KEY_2, process.env.NEWSDATA_API_KEY_3, process.env.NEWSDATA_API_KEY_4
].filter(Boolean);

let currentGNewsKeyIndex = 0;
let currentNewsDataKeyIndex = 0;

// Utilidad para esperar
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// ============================================================================
// 🛠️ 4. HERRAMIENTAS DE MANTENIMIENTO (ZOMBIES & PING AISLADO)
// ============================================================================

// Función llamada externamente si YouTube Shorts da error de cuota
exports.reportShortsQuotaLimitReached = () => {
    if (!isShortsQuotaExhausted) {
        isShortsQuotaExhausted = true;
        console.error("🚨 [SHORTS SEGURIDAD] Se detectó CUOTA AGOTADA en YouTube Shorts.");
        console.error("🛑 [SHORTS SEGURIDAD] Sistema PAUSADO para proteger recursos.");
    }
};

// Limpiador de Zombies: Libera noticias de Shorts atrapadas por bots caídos
async function _resetStuckShortsVideos(forceAll = false) {
    try {
        // MUY IMPORTANTE: Solo afecta a los que sean categoría Shorts
        let filtro = { videoProcessingStatus: 'processing', categoria: 'Shorts' };
        
        if (!forceAll) {
            // Solo liberar las que llevan más de X minutos
            const timeLimit = new Date(Date.now() - TIMEOUT_ZOMBIES_MINUTES * 60 * 1000);
            filtro.updatedAt = { $lt: timeLimit };
        }

        const result = await Article.updateMany(
            filtro,
            { $set: { videoProcessingStatus: 'pending' } } 
        );

        if (result.modifiedCount > 0) {
            console.log(`[SHORTS ZOMBIE CLEANER] 🧟 Se liberaron ${result.modifiedCount} Shorts que estaban colgados.`);
        }
    } catch (e) {
        console.error(`[SHORTS ZOMBIE CLEANER] Error: ${e.message}`);
    }
}

// Despertador de Bots de Shorts (Ping rápido)
async function _wakeUpShortBot(url) {
    // console.log(`[Ping Shorts] Comprobando bot: ${url} ...`);
    try {
        await axios.get(url, { timeout: 3000 });
        return true;
    } catch (e) {
        // Si responde 429 es que está vivo pero ocupado, eso cuenta como "despierto"
        if (e.response && e.response.status === 429) return true;
        return false;
    }
}

// ============================================================================
// 📥 5. EL RECOLECTOR DE SHORTS (FETCH WORKER)
// ============================================================================

const runShortsAPIFetch = async () => {
    if (isShortsFetchRunning) return;
    if (isShortsQuotaExhausted) {
        console.log("(Shorts Recolector) ⏸️ Sistema Shorts en pausa global.");
        return;
    }

    isShortsFetchRunning = true;
    currentGNewsKeyIndex = 0;
    currentNewsDataKeyIndex = 0;

    try {
        console.log(`(Shorts Recolector) 📥 Buscando noticias frescas para Shorts...`);
        let articulosCrudos = []; 
        
        // --- A. NEWSDATA.IO (Con Rotación) ---
        // Mezclamos países para no siempre empezar por Argentina
        const paisesNewsDataRandom = [...PAISES_NEWSDATA].sort(() => Math.random() - 0.5);
        
        for (const pais of paisesNewsDataRandom) {
            // Si ya tenemos suficientes en cola, paramos de buscar para ahorrar API
            if (articulosCrudos.length >= 10) break;

            let success = false;
            let attempts = 0;
            while (!success && attempts < newsDataKeys.length) {
                try {
                    const currentKey = newsDataKeys[currentNewsDataKeyIndex];
                    if (!currentKey) break;

                    const urlNewsData = `https://newsdata.io/api/1/news?apikey=${currentKey}&country=${pais}&language=es,pt&size=5`; 
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
                        console.warn(`[Shorts NewsData] Key agotada. Rotando...`);
                        currentNewsDataKeyIndex = (currentNewsDataKeyIndex + 1) % newsDataKeys.length;
                        attempts++;
                        await sleep(1000); 
                    } else { break; }
                }
            } 
            await sleep(1000); // Pausa para no saturar
        }

        // --- B. GNEWS (Con Rotación) ---
        const paisesGNewsRandom = [...PAISES_GNEWS].sort(() => Math.random() - 0.5);

        for (const pais of paisesGNewsRandom) {
            if (articulosCrudos.length >= 15) break; // Límite de recolección por ciclo

            let success = false;
            let attempts = 0;
            while (!success && attempts < gnewsKeys.length) {
                try {
                    const currentKey = gnewsKeys[currentGNewsKeyIndex];
                    if (!currentKey) break;

                    const urlGNews = `https://gnews.io/api/v4/top-headlines?country=${pais}&lang=es&max=5&apikey=${currentKey}`;
                    const response = await axios.get(urlGNews);
                    
                    if (response.data.articles) {
                        response.data.articles.forEach(article => {
                            if (!article.title || !article.url || !article.image) return; 
                            articulosCrudos.push({ 
                                title: article.title,
                                description: article.description || '',
                                image: article.image,
                                source: { name: article.source.name || 'GNews' },
                                url: article.url,
                                publishedAt: article.publishedAt,
                                paisLocal: pais 
                            });
                        });
                    }
                    success = true; 
                } catch (e) {
                    const status = e.response?.status;
                    if (status === 429 || status === 403 || status === 401) {
                        console.warn(`[Shorts GNews] Key agotada. Rotando...`);
                        currentGNewsKeyIndex = (currentGNewsKeyIndex + 1) % gnewsKeys.length; 
                        attempts++;
                        await sleep(1000); 
                    } else { break; }
                }
            }
            await sleep(1000); 
        }

        // --- C. FILTRADO DE DUPLICADOS PARA SHORTS (LA MAGIA DE #short) ---
        // Buscamos si ya existen en la BD agregando el sufijo #short
        const urlsRecibidas = articulosCrudos.map(article => article.url + "#short");
        const articulosExistentesDB = await Article.find({ enlaceOriginal: { $in: urlsRecibidas } }).select('enlaceOriginal');
        const urlsExistentesDB = new Set(articulosExistentesDB.map(a => a.enlaceOriginal));
        
        // Buscamos si ya existen en la cola en memoria
        const urlsEnFila = new Set(globalShortsQueue.map(a => a.url));

        const articulosNuevos = articulosCrudos.filter(article => {
            // Verificamos si en la DB ya está la versión #short, o si ya está en la cola actual
            return !urlsExistentesDB.has(article.url + "#short") && !urlsEnFila.has(article.url);
        });
        
        if (articulosNuevos.length > 0) {
            globalShortsQueue.push(...articulosNuevos);
            console.log(`(Shorts Recolector) ✅ Se añadieron ${articulosNuevos.length} noticias NUEVAS a la cola de Shorts.`);
        } else {
            console.log(`(Shorts Recolector) ⚠️ No se encontraron noticias nuevas en esta ronda de Shorts.`);
        }
        
    } catch (error) {
        console.error("(Shorts Recolector) Error General:", error.message);
    } finally {
        isShortsFetchRunning = false;
    }
};

exports.runShortsAPIFetch = runShortsAPIFetch;

// ============================================================================
// 🤖 6. EL GESTOR DE BOTS DE SHORTS (DISPATCHER)
// ============================================================================

async function _triggerShortBotWithRotation(article) {
    if (SHORT_BOT_URLS.length === 0) {
        console.warn(`[ShortBot] ❌ ERROR: No hay URLs de bots configuradas para Shorts.`);
        return;
    }

    // --- LA MAGIA: BLOQUEO ATÓMICO ---
    const articleCheck = await Article.findOneAndUpdate(
        { _id: article._id, videoProcessingStatus: 'pending' },
        { $set: { videoProcessingStatus: 'processing' } },
        { new: true }
    );

    if (!articleCheck) {
        console.log(`[ShortBot] ⏭️ El Short ya fue tomado por otro bot. Ignorando duplicado.`);
        return;
    }

    // Intentamos con hasta 3 bots diferentes si el primero falla (igual que el original)
    let attempts = 0;
    let sent = false;

    while (!sent && attempts < 3) {
        // Seleccionar Bot (Round Robin)
        const targetBotUrl = SHORT_BOT_URLS[currentShortBotIndex];
        currentShortBotIndex = (currentShortBotIndex + 1) % SHORT_BOT_URLS.length;

        try {
            await _wakeUpShortBot(targetBotUrl);

            const payload = {
                text: articleCheck.articuloGenerado, 
                title: articleCheck.titulo,            
                image_url: articleCheck.imagen, 
                article_id: articleCheck._id,
                category: articleCheck.categoria // Será "Shorts"
            };

            console.log(`[ShortBot] 📡 Enviando Short a ${targetBotUrl} (Intento ${attempts+1})...`);
            
            const response = await axios.post(`${targetBotUrl}/generate_video`, payload, { 
                headers: { 'x-api-key': VIDEO_BOT_KEY },
                timeout: 10000 
            });

            if (response.status === 200) {
                console.log(`[ShortBot] ✅ Short aceptado por ${targetBotUrl}.`);
                sent = true;
            }

        } catch (error) {
            const status = error.response ? error.response.status : 'RED';
            console.warn(`[ShortBot] ⚠️ Fallo en ${targetBotUrl} (Status: ${status}). Probando siguiente...`);
            attempts++;
            await sleep(1000);
        }
    }

    if (!sent) {
        console.error(`[ShortBot] ❌ Ningún bot aceptó el Short. Volviendo a 'pending' para luego.`);
        articleCheck.videoProcessingStatus = 'pending';
        await articleCheck.save();
    }
}

// ============================================================================
// 🏭 7. EL WORKER PRINCIPAL DE SHORTS (CONTROL DE FLUJO)
// ============================================================================

exports.startShortsWorker = async () => {
    if (isShortsWorkerRunning) return;
    
    console.log(`[Shorts Worker] 📱🟢 INICIANDO WORKER MAESTRO EXCLUSIVO DE SHORTS...`);
    
    // Limpieza inicial al arrancar (por si hubo reinicio forzado)
    await _resetStuckShortsVideos(true); 

    isShortsWorkerRunning = true;
    _runShortsWorker(); 
};

async function _runShortsWorker() {
    while (isShortsWorkerRunning) {
        try {
            // 0. LIMPIEZA PERIÓDICA DE ZOMBIES DE SHORTS
            await _resetStuckShortsVideos(false);

            // 1. CHEQUEO DE SEGURIDAD (CUOTA AGOTADA)
            if (isShortsQuotaExhausted) {
                console.log(`[Shorts Worker] 🛑 SISTEMA SHORTS EN PAUSA (Cuota Agotada). Reintentando en 5 min...`);
                await sleep(5 * 60 * 1000); 
                continue; 
            }

            // 2. CHEQUEO DE BUFFER (LA LÓGICA EXCLUSIVA)
            // Contamos cuántas noticias de Shorts están esperando o haciéndose
            const pendingCount = await Article.countDocuments({
                categoria: 'Shorts', // Solo cuenta los Shorts
                $or: [
                    { videoProcessingStatus: 'pending', telegramPosted: false },
                    { videoProcessingStatus: 'processing' } 
                ]
            });

            console.log(`[Shorts Worker] 📊 Estado del Buffer Shorts: ${pendingCount} / ${BUFFER_SIZE_LIMIT}`);

            // SI EL BUFFER ESTÁ LLENO, NO GENERAMOS MÁS
            if (pendingCount >= BUFFER_SIZE_LIMIT) {
                console.log(`[Shorts Worker] ✋ Buffer Shorts lleno. Pausa de IA. Solo despachando...`);
                
                const retryArticle = await Article.findOne({ 
                    categoria: 'Shorts',
                    videoProcessingStatus: 'pending',
                    telegramPosted: false 
                }).sort({ createdAt: 1 });

                if (retryArticle) {
                     await _triggerShortBotWithRotation(retryArticle);
                }

                await sleep(10 * 1000);
                continue;
            }

            // 3. SI EL BUFFER ESTÁ VACÍO, NECESITAMOS MATERIA PRIMA
            if (globalShortsQueue.length === 0) {
                await runShortsAPIFetch();
                
                if (globalShortsQueue.length === 0) {
                    console.log("[Shorts Worker] 💤 No hay noticias de Shorts en las APIs. Durmiendo 2 min...");
                    await sleep(2 * 60 * 1000); 
                    continue;
                }
            }

            // 4. PROCESAR SIGUIENTE NOTICIA DE LA COLA
            const articleToProcess = globalShortsQueue.shift(); 
            console.log(`[Shorts Worker] 🔨 Procesando guion con IA: ${articleToProcess.title.substring(0, 30)}...`);

            // --- LLAMADA A GEMINI (Cerebro Shorts) ---
            const resultadoIA = await generateShortArticleContent({
                url: articleToProcess.url,
                title: articleToProcess.title,
                description: articleToProcess.description
            });

            if (resultadoIA && resultadoIA.articuloGenerado) {
                const { tituloViral, articuloGenerado, textoImagen } = resultadoIA;
                
                // Guardamos en Base de Datos
                const newArticle = new Article({
                    // Le agregamos un pequeño tag visual al título para saber que es un short
                    titulo: "[Short] " + (tituloViral || articleToProcess.title), 
                    descripcion: articleToProcess.description,
                    imagen: articleToProcess.image || 'https://via.placeholder.com/800x600', 
                    sitio: 'noticias.lat',
                    categoria: 'Shorts', // FORZAMOS CATEGORÍA
                    pais: articleToProcess.paisLocal,
                    fuente: articleToProcess.source.name,
                    // IMPORTANTE: Agregamos #short para que MongoDB no dé error de duplicado si la misma noticia entró por el worker normal
                    enlaceOriginal: articleToProcess.url + "#short",
                    fecha: new Date(articleToProcess.publishedAt || Date.now()),
                    articuloGenerado: articuloGenerado, // El guion corto
                    imageText: textoImagen, 
                    telegramPosted: false,
                    videoProcessingStatus: 'pending' 
                });
                
                await newArticle.save();
                console.log(`[Shorts Worker] 💾 Short Guardado en DB: ${newArticle.titulo}`);
                
                // 5. INTENTO INMEDIATO DE VIDEO
                await _triggerShortBotWithRotation(newArticle);
                
            } else {
                console.warn(`[Shorts Worker] ⚠️ Fallo IA Shorts. Saltando.`);
            }
            
            await sleep(2000); 

        } catch (error) {
            console.error(`[Shorts Worker] Error Ciclo Principal: ${error.message}`);
            await sleep(10 * 1000); 
        }
    }
}

// ============================================================================
// 🎮 8. CONTROL MANUAL Y ENDPOINTS DE SHORTS
// ============================================================================

exports.syncShortsAPIs = async (req, res) => {
    runShortsAPIFetch();
    res.json({ message: "Búsqueda de noticias para Shorts disparada en segundo plano." });
};

exports.retryShortsVideos = async (req, res) => {
    console.log("Manual: Reseteando Shorts zombies...");
    await _resetStuckShortsVideos(true);
    res.json({ message: 'Shorts reseteados y puestos en cola.' });
};

exports.createManualShortArticle = async (req, res) => {
    if (isShortsQuotaExhausted) {
        return res.status(503).json({ error: "🛑 SISTEMA EN PAUSA: La cuota de YouTube Shorts se ha agotado." });
    }

    try {
        const { titulo, enlaceOriginal, imagen } = req.body;
        console.log(`[Manual Shorts] Creando guion: ${titulo}`);

        const iaData = await generateShortArticleContent({ 
            url: enlaceOriginal, 
            title: titulo || "Noticia Manual Short",
            description: "Noticia generada manualmente por el administrador para Shorts."
        });
        
        if (!iaData) return res.status(500).json({ error: "Error IA Texto Shorts: No se pudo generar." });

        const newArticle = new Article({
            titulo: "[Short] " + iaData.tituloViral, 
            descripcion: 'Noticia Manual',
            imagen: imagen || 'https://via.placeholder.com/800x600',
            sitio: 'noticias.lat',
            // Aseguramos que el enlace manual no choque
            enlaceOriginal: (enlaceOriginal || `manual-${Date.now()}`) + "#short",
            articuloGenerado: iaData.articuloGenerado,
            categoria: 'Shorts',
            pais: 'general',
            telegramPosted: false,
            videoProcessingStatus: 'pending'
        });

        await newArticle.save();
        _triggerShortBotWithRotation(newArticle);
        
        res.status(201).json(newArticle);
    } catch (error) { 
        console.error("Error manual Shorts:", error);
        res.status(500).json({ error: error.message });
    }
};