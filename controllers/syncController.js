// Archivo: lfaftechapi/controllers/syncController.js
// --- VERSIÓN: ULTIMATE (APIs Originales + Buffer Inteligente + Gestión de Zombies + Multi-Bot) ---

const axios = require('axios');
const Article = require('../models/article');
// Importamos el cliente Gemini Rotativo (asegurate de haber actualizado geminiClient.js)
const { generateArticleContent } = require('../utils/geminiClient');

// ============================================================================
// ⚙️ 1. CONFIGURACIÓN DE LA FLOTA DE BOTS (VIDEO WORKERS)
// ============================================================================
const VIDEO_BOT_URLS = [
    "http://18.218.177.159:5000",
    "http://3.15.176.240:3001"
];

// Clave para comunicar con los bots (si la usan)
const VIDEO_BOT_KEY = process.env.ADMIN_API_KEY || "123456"; 

// Índice para rotar entre los bots
let currentBotIndex = 0;

// ============================================================================
// ⚙️ 2. CONFIGURACIÓN DE LÍMITES Y BUFFER (EL CEREBRO)
// ============================================================================

// Límite de noticias por país al buscar en las APIs
const MAX_ARTICLES_PER_COUNTRY = 10;

// TIEMPO ZOMBIE: Si un video lleva 30 mins "haciéndose", asumimos que murió.
const TIMEOUT_ZOMBIES_MINUTES = 30;

// BUFFER SIZE: La clave de todo. 
// Si hay más de 15 noticias esperando video, NO buscamos más noticias ni gastamos Gemini.
const BUFFER_SIZE_LIMIT = 15;

// Variables de estado del sistema
let isNewsWorkerRunning = false;
let isFetchWorkerRunning = false;
let isQuotaExhausted = false; // Interruptor de emergencia global
let globalArticleQueue = []; // Cola en memoria temporal

// ============================================================================
// ⚙️ 3. CLAVES Y PAÍSES (TU LÓGICA ORIGINAL RESTAURADA)
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
// 🛠️ 4. HERRAMIENTAS DE MANTENIMIENTO (ZOMBIES & PING)
// ============================================================================

// Función llamada externamente si YouTube da error de cuota
exports.reportQuotaLimitReached = () => {
    if (!isQuotaExhausted) {
        isQuotaExhausted = true;
        console.error("🚨 [SEGURIDAD] Se detectó CUOTA AGOTADA en YouTube.");
        console.error("🛑 [SEGURIDAD] Sistema PAUSADO para proteger recursos.");
    }
};

// Limpiador de Zombies: Libera noticias atrapadas por bots caídos
async function _resetStuckVideos(forceAll = false) {
    try {
        let filtro = { videoProcessingStatus: 'processing' };
        
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
            console.log(`[ZOMBIE CLEANER] 🧟 Se liberaron ${result.modifiedCount} videos que estaban colgados.`);
        }
    } catch (e) {
        console.error(`[ZOMBIE CLEANER] Error: ${e.message}`);
    }
}

// Despertador de Bots (Ping rápido)
async function _wakeUpBot(url) {
    // console.log(`[Ping] Comprobando bot: ${url} ...`);
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
// 📥 5. EL RECOLECTOR (FETCH WORKER - TUS APIS ORIGINALES)
// ============================================================================

const runNewsAPIFetch = async () => {
    if (isFetchWorkerRunning) return;
    if (isQuotaExhausted) {
        console.log("(Recolector) ⏸️ Sistema en pausa global.");
        return;
    }

    isFetchWorkerRunning = true;
    currentGNewsKeyIndex = 0;
    currentNewsDataKeyIndex = 0;

    try {
        console.log(`(Recolector) 📥 Buscando noticias frescas en APIs externas...`);
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

                    const urlNewsData = `https://newsdata.io/api/1/news?apikey=${currentKey}&country=${pais}&language=es,pt&size=5`; // Bajé size a 5 para ahorrar
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
                        console.warn(`[NewsData] Key agotada. Rotando...`);
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
                        console.warn(`[GNews] Key agotada. Rotando...`);
                        currentGNewsKeyIndex = (currentGNewsKeyIndex + 1) % gnewsKeys.length; 
                        attempts++;
                        await sleep(1000); 
                    } else { break; }
                }
            }
            await sleep(1000); 
        }

        // --- C. FILTRADO DE DUPLICADOS ---
        const urlsRecibidas = articulosCrudos.map(article => article.url);
        // Buscamos si ya existen en la BD
        const articulosExistentesDB = await Article.find({ enlaceOriginal: { $in: urlsRecibidas } }).select('enlaceOriginal');
        const urlsExistentesDB = new Set(articulosExistentesDB.map(a => a.enlaceOriginal));
        
        // Buscamos si ya existen en la cola en memoria
        const urlsEnFila = new Set(globalArticleQueue.map(a => a.url));

        const articulosNuevos = articulosCrudos.filter(article => {
            return !urlsExistentesDB.has(article.url) && !urlsEnFila.has(article.url);
        });
        
        if (articulosNuevos.length > 0) {
            globalArticleQueue.push(...articulosNuevos);
            console.log(`(Recolector) ✅ Se añadieron ${articulosNuevos.length} noticias NUEVAS a la cola.`);
        } else {
            console.log(`(Recolector) ⚠️ No se encontraron noticias nuevas en esta ronda.`);
        }
        
    } catch (error) {
        console.error("(Recolector) Error General:", error.message);
    } finally {
        isFetchWorkerRunning = false;
    }
};

// Exportamos la función de fetch para poder llamarla manualmente si se necesita
exports.runNewsAPIFetch = runNewsAPIFetch;


// ============================================================================
// 🤖 6. EL GESTOR DE BOTS (DISPATCHER)
// ============================================================================

async function _triggerVideoBotWithRotation(article) {
    if (VIDEO_BOT_URLS.length === 0) {
        console.warn(`[VideoBot] ❌ ERROR: No hay URLs de bots configuradas.`);
        return;
    }

    // Buscamos el artículo actualizado
    const articleCheck = await Article.findById(article._id);
    if (!articleCheck) return;

    // Intentamos con hasta 3 bots diferentes si el primero falla
    let attempts = 0;
    let sent = false;

    while (!sent && attempts < 3) {
        // Seleccionar Bot (Round Robin)
        const targetBotUrl = VIDEO_BOT_URLS[currentBotIndex];
        currentBotIndex = (currentBotIndex + 1) % VIDEO_BOT_URLS.length;

        try {
            // Verificar si el bot está vivo (Ping)
            await _wakeUpBot(targetBotUrl);

            // Preparar Payload
            const payload = {
                text: articleCheck.articuloGenerado, 
                title: articleCheck.titulo,            
                image_url: articleCheck.imagen, 
                article_id: articleCheck._id,
                category: articleCheck.categoria // Dato extra útil
            };

            console.log(`[VideoBot] 📡 Enviando tarea a ${targetBotUrl} (Intento ${attempts+1})...`);
            
            // Enviar trabajo (Timeout 10s)
            const response = await axios.post(`${targetBotUrl}/generate_video`, payload, { 
                headers: { 'x-api-key': VIDEO_BOT_KEY },
                timeout: 10000 
            });

            if (response.status === 200) {
                console.log(`[VideoBot] ✅ Tarea aceptada por ${targetBotUrl}.`);
                
                // Actualizar estado en DB
                articleCheck.videoProcessingStatus = 'processing';
                await articleCheck.save();
                sent = true;
            }

        } catch (error) {
            const status = error.response ? error.response.status : 'RED';
            console.warn(`[VideoBot] ⚠️ Fallo en ${targetBotUrl} (Status: ${status}). Probando siguiente...`);
            attempts++;
            await sleep(1000);
        }
    }

    if (!sent) {
        console.error(`[VideoBot] ❌ Ningún bot aceptó la tarea. Se queda en 'pending' para luego.`);
        // No cambiamos el estado, se queda en pending para que el worker lo retome
    }
}


// ============================================================================
// 🏭 7. EL WORKER PRINCIPAL (CONTROL DE FLUJO)
// ============================================================================

exports.startNewsWorker = async () => {
    if (isNewsWorkerRunning) return;
    
    console.log(`[News Worker] 🟢 INICIANDO WORKER MAESTRO...`);
    
    // Limpieza inicial al arrancar (por si hubo reinicio forzado)
    await _resetStuckVideos(true); 

    isNewsWorkerRunning = true;
    _runNewsWorker(); 
};

async function _runNewsWorker() {
    while (isNewsWorkerRunning) {
        try {
            // 0. LIMPIEZA PERIÓDICA DE ZOMBIES
            await _resetStuckVideos(false);

            // 1. CHEQUEO DE SEGURIDAD (CUOTA AGOTADA)
            if (isQuotaExhausted) {
                console.log(`[News Worker] 🛑 SISTEMA EN PAUSA (Cuota Agotada). Reintentando en 5 min...`);
                await sleep(5 * 60 * 1000); 
                continue; 
            }

            // 2. CHEQUEO DE BUFFER (LA LÓGICA NUEVA)
            // Contamos cuántas noticias están esperando o haciéndose
            const pendingCount = await Article.countDocuments({
                $or: [
                    { videoProcessingStatus: 'pending', telegramPosted: false }, // Pendientes de video
                    { videoProcessingStatus: 'processing' } // Haciéndose
                ]
            });

            console.log(`[News Worker] 📊 Estado del Buffer: ${pendingCount} / ${BUFFER_SIZE_LIMIT}`);

            // SI EL BUFFER ESTÁ LLENO, NO GENERAMOS MÁS (Ahorro de Gemini y APIs)
            if (pendingCount >= BUFFER_SIZE_LIMIT) {
                console.log(`[News Worker] ✋ Buffer lleno. Pausa de generación de texto. Solo despachando...`);
                
                // Aún así, intentamos despachar lo que haya pendiente a los bots
                // (Buscamos una vieja que no se haya enviado)
                const retryArticle = await Article.findOne({ 
                    videoProcessingStatus: 'pending',
                    telegramPosted: false // Usamos este flag como "video completado" en tu lógica original?
                    // Ajusta según tu lógica, asumo que pending es que le falta video.
                }).sort({ createdAt: 1 });

                if (retryArticle) {
                     await _triggerVideoBotWithRotation(retryArticle);
                }

                await sleep(10 * 1000);
                continue;
            }

            // 3. SI EL BUFFER ESTÁ VACÍO, NECESITAMOS MATERIA PRIMA
            if (globalArticleQueue.length === 0) {
                await runNewsAPIFetch();
                
                // Si tras buscar sigue vacío, dormimos un rato largo
                if (globalArticleQueue.length === 0) {
                    console.log("[News Worker] 💤 No hay noticias en las APIs. Durmiendo 2 min...");
                    await sleep(2 * 60 * 1000); 
                    continue;
                }
            }

            // 4. PROCESAR SIGUIENTE NOTICIA DE LA COLA
            const articleToProcess = globalArticleQueue.shift(); 
            console.log(`[News Worker] 🔨 Procesando con IA: ${articleToProcess.title.substring(0, 30)}...`);

            // --- LLAMADA A GEMINI (Cerebro) ---
            const resultadoIA = await generateArticleContent({
                url: articleToProcess.url,
                title: articleToProcess.title,
                description: articleToProcess.description
            });

            if (resultadoIA && resultadoIA.articuloGenerado) {
                const { categoria, tituloViral, articuloGenerado, textoImagen } = resultadoIA;
                
                // Guardamos en Base de Datos
                const newArticle = new Article({
                    titulo: tituloViral || articleToProcess.title, 
                    descripcion: articleToProcess.description,
                    imagen: articleToProcess.image || 'https://via.placeholder.com/800x600', 
                    sitio: 'noticias.lat',
                    categoria: categoria,
                    pais: articleToProcess.paisLocal,
                    fuente: articleToProcess.source.name,
                    enlaceOriginal: articleToProcess.url,
                    fecha: new Date(articleToProcess.publishedAt || Date.now()),
                    articuloGenerado: articuloGenerado,
                    imageText: textoImagen, // Guardamos el texto para la miniatura
                    telegramPosted: false,
                    videoProcessingStatus: 'pending' // <--- IMPORTANTE: Queda lista para ser tomada por un bot
                });
                
                await newArticle.save();
                console.log(`[News Worker] 💾 Guardada en DB: ${newArticle.titulo}`);
                
                // 5. INTENTO INMEDIATO DE VIDEO
                // Intentamos enviarla a un bot ya mismo
                await _triggerVideoBotWithRotation(newArticle);
                
            } else {
                console.warn(`[News Worker] ⚠️ Fallo IA Texto. Saltando.`);
            }
            
            // Pausa entre generaciones para no saturar Gemini (aunque tenemos rotación)
            await sleep(2000); 

        } catch (error) {
            console.error(`[News Worker] Error Ciclo Principal: ${error.message}`);
            await sleep(10 * 1000); // Pausa de error
        }
    }
}


// ============================================================================
// 🎮 8. CONTROL MANUAL Y ENDPOINTS
// ============================================================================

exports.syncNewsAPIs = async (req, res) => {
    // Endpoint para forzar la búsqueda manual desde el panel admin
    runNewsAPIFetch();
    res.json({ message: "Búsqueda de noticias APIs disparada en segundo plano." });
};

// Endpoint para reintentar videos trabados manualmente
exports.retryVideos = async (req, res) => {
    console.log("Manual: Reseteando videos zombies...");
    await _resetStuckVideos(true);
    res.json({ message: 'Videos reseteados y puestos en cola.' });
};

exports.createManualArticle = async (req, res) => {
    // También bloqueamos la creación manual si no hay cuota
    if (isQuotaExhausted) {
        return res.status(503).json({ error: "🛑 SISTEMA EN PAUSA: La cuota de YouTube se ha agotado." });
    }

    try {
        const { titulo, enlaceOriginal, imagen } = req.body;
        console.log(`[Manual] Creando noticia: ${titulo}`);

        // Usamos Gemini para expandir la noticia manual
        const iaData = await generateArticleContent({ 
            url: enlaceOriginal, 
            title: titulo || "Noticia Manual",
            description: "Noticia generada manualmente por el administrador."
        });
        
        if (!iaData) return res.status(500).json({ error: "Error IA Texto: No se pudo generar." });

        const newArticle = new Article({
            titulo: iaData.tituloViral, 
            descripcion: 'Noticia Manual',
            imagen: imagen || 'https://via.placeholder.com/800x600',
            sitio: 'noticias.lat',
            enlaceOriginal: enlaceOriginal || `manual-${Date.now()}`,
            articuloGenerado: iaData.articuloGenerado,
            categoria: iaData.categoria,
            pais: 'general',
            telegramPosted: false,
            videoProcessingStatus: 'pending'
        });

        await newArticle.save();
        
        // Enviamos al bot
        _triggerVideoBotWithRotation(newArticle);
        
        res.status(201).json(newArticle);
    } catch (error) { 
        console.error("Error manual:", error);
        res.status(500).json({ error: error.message });
    }
};