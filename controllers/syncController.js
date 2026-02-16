// Archivo: lfaftechapi/controllers/syncController.js
// --- VERSIÓN: TITÁN (TIMEOUT 5 MINUTOS + BLOQUEO ATÓMICO + MULTI-SERVER READY) ---

const axios = require('axios');
const Article = require('../models/article');
// Importamos el cliente Gemini (asegúrate de que la ruta sea correcta)
const { generateArticleContent } = require('../utils/geminiClient');

// ============================================================================
// ⚙️ 1. CONFIGURACIÓN DE LA FLOTA DE BOTS (VIDEO WORKERS)
// ============================================================================

// AQUÍ PONES TUS SERVIDORES. 
// Si en el futuro agregas otro, solo lo pones en la lista: ["http://ip1...", "http://ip2..."]
const VIDEO_BOT_URLS = [
    "http://3.15.176.240:3001" // SERVIDOR NUEVO (El que funciona bien)
];

// Clave de seguridad para que nadie más use tus bots
const VIDEO_BOT_KEY = process.env.ADMIN_API_KEY || "123456"; 

// Índice para rotar la carga entre servidores (Balanceo de Carga)
let currentBotIndex = 0;

// ============================================================================
// ⚙️ 2. CONFIGURACIÓN DE TIEMPOS Y LÍMITES (CRÍTICO)
// ============================================================================

// ¡AQUÍ ESTÁ LA SOLUCIÓN AL BUCLE!
// Tiempo máximo que esperamos a que el bot responda. 
// 1 MINUTOS.
// Esto evita que la API corte la llamada mientras FFmpeg está renderizando.
const BOT_TIMEOUT_MS = 60000; 

// Límites de lógica de negocio
const MAX_ARTICLES_PER_COUNTRY = 10;
const TIMEOUT_ZOMBIES_MINUTES = 45; // Si en 45 mins no termina, lo damos por muerto.
const BUFFER_SIZE_LIMIT = 15; // Máximo de noticias en cola para no saturar.

// Variables de estado del sistema (Memoria Volátil)
let isNewsWorkerRunning = false;
let isFetchWorkerRunning = false;
let isQuotaExhausted = false; // Freno de mano si YouTube nos bloquea
let globalArticleQueue = []; // Cola temporal en memoria RAM

// ============================================================================
// ⚙️ 3. CONFIGURACIÓN DE APIs DE NOTICIAS (GNEWS / NEWSDATA)
// ============================================================================

const paisNewsDataMap = {
    "argentina": "ar", "bolivia": "bo", "brazil": "br", "chile": "cl", 
    "colombia": "co", "costa rica": "cr", "cuba": "cu", "ecuador": "ec", 
    "el salvador": "sv", "guatemala": "gt", "honduras": "hn", "mexico": "mx", 
    "nicaragua": "ni", "panama": "pa", "paraguay": "py", "peru": "pe", 
    "dominican republic": "do", "uruguay": "uy", "venezuela": "ve"
};

const PAISES_NEWSDATA = ["ar", "bo", "br", "cl", "co", "cr", "cu", "ec", "sv", "gt", "hn", "mx", "ni", "pa", "py", "pe", "do", "uy", "ve"];
const PAISES_GNEWS = ["ar", "br", "cl", "co", "ec", "mx", "pe", "py", "uy", "ve"];

// Rotación de Claves (Para no quedarnos sin saldo en las APIs de noticias)
const gnewsKeys = [process.env.GNEWS_API_KEY, process.env.GNEWS_API_KEY_2, process.env.GNEWS_API_KEY_3, process.env.GNEWS_API_KEY_4].filter(Boolean);
const newsDataKeys = [process.env.NEWSDATA_API_KEY, process.env.NEWSDATA_API_KEY_2, process.env.NEWSDATA_API_KEY_3, process.env.NEWSDATA_API_KEY_4].filter(Boolean);

let currentGNewsKeyIndex = 0;
let currentNewsDataKeyIndex = 0;

// Utilidad para dormir el proceso (evitar spam)
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// ============================================================================
// 🛠️ 4. HERRAMIENTAS DE MANTENIMIENTO Y SEGURIDAD
// ============================================================================

// Función para reportar que YouTube nos bloqueó (Freno de Emergencia)
exports.reportQuotaLimitReached = () => {
    if (!isQuotaExhausted) {
        isQuotaExhausted = true;
        console.error("🚨 [SEGURIDAD] CUOTA DE YOUTUBE AGOTADA. Pausando generación de videos.");
    }
};

// Limpiador de Zombies: Si un servidor se apagó a mitad de un video, esta función libera la noticia después de 45 mins.
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
            console.log(`[ZOMBIE CLEANER] 🧟 Se reiniciaron ${result.modifiedCount} videos que quedaron colgados.`);
        }
    } catch (e) {
        console.error(`[ZOMBIE CLEANER] Error: ${e.message}`);
    }
}

// Ping rápido para ver si un servidor está vivo antes de enviarle trabajo
async function _wakeUpBot(url) {
    try {
        await axios.get(url, { timeout: 3000 });
        return true;
    } catch (e) {
        // 429 significa que está vivo pero ocupado (Rate Limit), cuenta como vivo.
        if (e.response && e.response.status === 429) return true;
        return false;
    }
}

// ============================================================================
// 📥 5. EL RECOLECTOR DE NOTICIAS (FETCH WORKER)
// ============================================================================

const runNewsAPIFetch = async () => {
    if (isFetchWorkerRunning) return;
    
    // Si YouTube nos bloqueó, no tiene sentido buscar más noticias.
    if (isQuotaExhausted) {
        console.log("(Recolector) ⏸️ Sistema pausado por Cuota YouTube.");
        return;
    }

    isFetchWorkerRunning = true;
    currentGNewsKeyIndex = 0;
    currentNewsDataKeyIndex = 0;

    try {
        console.log(`(Recolector) 📥 Iniciando búsqueda de noticias frescas...`);
        let articulosCrudos = []; 
        
        // --- A. NEWSDATA.IO ---
        const paisesNewsDataRandom = [...PAISES_NEWSDATA].sort(() => Math.random() - 0.5);
        
        for (const pais of paisesNewsDataRandom) {
            if (articulosCrudos.length >= 10) break; // Límite para ahorrar API

            let success = false;
            let attempts = 0;
            while (!success && attempts < newsDataKeys.length) {
                try {
                    const currentKey = newsDataKeys[currentNewsDataKeyIndex];
                    if (!currentKey) break;

                    const response = await axios.get(`https://newsdata.io/api/1/news?apikey=${currentKey}&country=${pais}&language=es,pt&size=5`);
                    
                    if (response.data.results) {
                        response.data.results.forEach(article => {
                            if (!article.title || !article.link || !article.image_url) return;
                            const paisCode = paisNewsDataMap[article.country ? article.country[0] : 'unknown'] || 'ar';
                            articulosCrudos.push({
                                title: article.title,
                                description: article.description || 'Sin descripción.',
                                image: article.image_url,
                                source: { name: article.source_id || 'Fuente Desconocida' },
                                url: article.link,
                                publishedAt: article.pubDate,
                                paisLocal: paisCode
                            });
                        });
                    }
                    success = true; 
                } catch (e) {
                    if ([429, 401, 403].includes(e.response?.status)) {
                        currentNewsDataKeyIndex = (currentNewsDataKeyIndex + 1) % newsDataKeys.length;
                        attempts++;
                        await sleep(1000); 
                    } else { break; }
                }
            } 
            await sleep(1000);
        }

        // --- B. GNEWS ---
        const paisesGNewsRandom = [...PAISES_GNEWS].sort(() => Math.random() - 0.5);

        for (const pais of paisesGNewsRandom) {
            if (articulosCrudos.length >= 15) break;

            let success = false;
            let attempts = 0;
            while (!success && attempts < gnewsKeys.length) {
                try {
                    const currentKey = gnewsKeys[currentGNewsKeyIndex];
                    if (!currentKey) break;

                    const response = await axios.get(`https://gnews.io/api/v4/top-headlines?country=${pais}&lang=es&max=5&apikey=${currentKey}`);
                    
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
                    if ([429, 401, 403].includes(e.response?.status)) {
                        currentGNewsKeyIndex = (currentGNewsKeyIndex + 1) % gnewsKeys.length; 
                        attempts++;
                        await sleep(1000); 
                    } else { break; }
                }
            }
            await sleep(1000); 
        }

        // --- C. FILTRADO ESTRICTO DE DUPLICADOS ---
        const urlsRecibidas = articulosCrudos.map(article => article.url);
        // Verificar en DB
        const articulosExistentesDB = await Article.find({ enlaceOriginal: { $in: urlsRecibidas } }).select('enlaceOriginal');
        const urlsExistentesDB = new Set(articulosExistentesDB.map(a => a.enlaceOriginal));
        // Verificar en Cola RAM
        const urlsEnFila = new Set(globalArticleQueue.map(a => a.url));

        const articulosNuevos = articulosCrudos.filter(article => {
            return !urlsExistentesDB.has(article.url) && !urlsEnFila.has(article.url);
        });
        
        if (articulosNuevos.length > 0) {
            globalArticleQueue.push(...articulosNuevos);
            console.log(`(Recolector) ✅ Se añadieron ${articulosNuevos.length} noticias NUEVAS a la cola.`);
        } else {
            console.log(`(Recolector) ⚠️ No hay noticias nuevas en esta ronda.`);
        }
        
    } catch (error) {
        console.error("(Recolector) Error General:", error.message);
    } finally {
        isFetchWorkerRunning = false;
    }
};

exports.runNewsAPIFetch = runNewsAPIFetch;


// ============================================================================
// 🤖 6. EL GESTOR DE BOTS (DISPATCHER - CORAZÓN DEL SISTEMA)
// ============================================================================

/**
 * Esta función es la que envía la tarea a los servidores de video.
 * Implementa bloqueo atómico para que NUNCA se envíe la misma noticia dos veces.
 */
async function _triggerVideoBotWithRotation(article) {
    if (VIDEO_BOT_URLS.length === 0) {
        console.warn(`[VideoBot] ❌ ERROR: No hay servidores de video configurados.`);
        return;
    }

    // 🔥 BLOQUEO ATÓMICO 🔥
    // Buscamos la noticia Y al mismo tiempo la marcamos como ocupada ('processing').
    // Si ya estaba ocupada o terminada, MongoDB devuelve null y la función se detiene.
    // Esto impide que dos servidores tomen la misma noticia.
    const articleReserved = await Article.findOneAndUpdate(
        { _id: article._id, videoProcessingStatus: 'pending' }, 
        { $set: { videoProcessingStatus: 'processing' } },      
        { new: true } 
    );

    // Si no pudimos reservarla, es que otro proceso ya la ganó. Salimos.
    if (!articleReserved) {
        return; 
    }

    let sent = false;
    let attempts = 0;

    // Intentamos enviar la tarea rotando entre los bots disponibles
    while (!sent && attempts < 3) { // Máximo 3 intentos de asignación
        
        // Selección Round Robin (Uno tuyo, uno mío...)
        const targetBotUrl = VIDEO_BOT_URLS[currentBotIndex];
        currentBotIndex = (currentBotIndex + 1) % VIDEO_BOT_URLS.length;

        try {
            // Verificamos que el servidor esté online
            await _wakeUpBot(targetBotUrl);

            const payload = {
                text: articleReserved.articuloGenerado, 
                title: articleReserved.titulo,            
                image_url: articleReserved.imagen, 
                article_id: articleReserved._id,
                category: articleReserved.categoria 
            };

            console.log(`[VideoBot] 📡 Enviando tarea a ${targetBotUrl} (Con Timeout de 5 MINUTOS)...`);
            
            // 🔥 AQUÍ ESTÁ EL FIX DEL TIMEOUT 🔥
            // Esperamos 5 minutos (300,000 ms) antes de cortar la conexión.
            // Si el video tarda 4:59, la API esperará felizmente.
            const response = await axios.post(`${targetBotUrl}/generate_video`, payload, { 
                headers: { 'x-api-key': VIDEO_BOT_KEY },
                timeout: BOT_TIMEOUT_MS 
            });

            if (response.status === 200) {
                console.log(`[VideoBot] ✅ Tarea aceptada y procesada por ${targetBotUrl}.`);
                // La noticia ya está en 'processing', el Callback del bot la pasará a 'complete'.
                sent = true;
            }

        } catch (error) {
            // Manejo de errores
            const msg = error.message;
            
            // Si el error es Timeout, NO reiniciamos la noticia inmediatamente.
            // Puede que el bot siga trabajando aunque axios haya cortado.
            // Dejamos que el "Zombie Cleaner" la limpie en 45 minutos si realmente falló.
            if (error.code === 'ECONNABORTED') {
                console.warn(`[VideoBot] ⏳ TIMEOUT (5 mins) en ${targetBotUrl}. El bot sigue trabajando o murió.`);
                // Marcamos como enviada para no reintentar inmediatamente con otro bot y duplicar.
                sent = true; 
            } else {
                console.warn(`[VideoBot] ⚠️ Fallo de conexión con ${targetBotUrl}: ${msg}`);
                attempts++;
                await sleep(2000);
            }
        }
    }

    // Si después de probar todos los bots nadie respondió (y no fue timeout)
    if (!sent) {
        console.error(`[VideoBot] ❌ ERROR: Ningún bot disponible. Devolviendo noticia a la cola.`);
        // Liberamos la noticia para intentarlo más tarde
        await Article.updateOne(
            { _id: articleReserved._id },
            { $set: { videoProcessingStatus: 'pending' } }
        );
    }
}


// ============================================================================
// 🏭 7. EL WORKER PRINCIPAL (ORQUESTADOR)
// ============================================================================

exports.startNewsWorker = async () => {
    if (isNewsWorkerRunning) return;
    
    console.log(`[News Worker] 🟢 INICIANDO WORKER MAESTRO (Versión Completa)...`);
    
    // Limpieza inicial
    await _resetStuckVideos(true); 

    isNewsWorkerRunning = true;
    _runNewsWorker(); 
};

async function _runNewsWorker() {
    while (isNewsWorkerRunning) {
        try {
            // 0. MANTENIMIENTO
            await _resetStuckVideos(false);

            // 1. CHEQUEO DE SEGURIDAD
            if (isQuotaExhausted) {
                console.log(`[News Worker] 🛑 PAUSA GLOBAL (Cuota YouTube Agotada). Reintentando en 5 min...`);
                await sleep(5 * 60 * 1000); 
                continue; 
            }

            // 2. CHEQUEO DE BUFFER
            // No queremos llenar la base de datos de textos si los videos no salen
            const pendingCount = await Article.countDocuments({
                $or: [
                    { videoProcessingStatus: 'pending', telegramPosted: false }, 
                    { videoProcessingStatus: 'processing' } 
                ]
            });

            console.log(`[News Worker] 📊 Buffer: ${pendingCount} / ${BUFFER_SIZE_LIMIT}`);

            if (pendingCount >= BUFFER_SIZE_LIMIT) {
                console.log(`[News Worker] ✋ Buffer lleno. Pausando recolección. Intentando despachar pendientes...`);
                
                // Intentamos empujar una noticia vieja que se haya quedado atascada
                const retryArticle = await Article.findOne({ 
                    videoProcessingStatus: 'pending',
                    telegramPosted: false 
                }).sort({ createdAt: 1 });

                if (retryArticle) {
                     await _triggerVideoBotWithRotation(retryArticle);
                }

                await sleep(15 * 1000); // Esperar 15 segundos antes de volver a chequear
                continue;
            }

            // 3. RECOLECCIÓN (Si hace falta)
            if (globalArticleQueue.length === 0) {
                await runNewsAPIFetch();
                
                if (globalArticleQueue.length === 0) {
                    console.log("[News Worker] 💤 Sin noticias en cola. Durmiendo 1 min...");
                    await sleep(60 * 1000); 
                    continue;
                }
            }

            // 4. PROCESAMIENTO (IA + VIDEO)
            const articleToProcess = globalArticleQueue.shift(); 
            console.log(`[News Worker] 🔨 Generando Guion IA para: ${articleToProcess.title.substring(0, 40)}...`);

            // Generamos el contenido con Gemini
            const resultadoIA = await generateArticleContent({
                url: articleToProcess.url,
                title: articleToProcess.title,
                description: articleToProcess.description
            });

            if (resultadoIA && resultadoIA.articuloGenerado) {
                // Guardamos en Base de Datos
                const newArticle = new Article({
                    titulo: resultadoIA.tituloViral || articleToProcess.title, 
                    descripcion: articleToProcess.description,
                    imagen: articleToProcess.image || 'https://via.placeholder.com/800x600', 
                    sitio: 'noticias.lat',
                    categoria: resultadoIA.categoria,
                    pais: articleToProcess.paisLocal,
                    fuente: articleToProcess.source.name,
                    enlaceOriginal: articleToProcess.url,
                    fecha: new Date(articleToProcess.publishedAt || Date.now()),
                    articuloGenerado: resultadoIA.articuloGenerado,
                    imageText: resultadoIA.textoImagen, 
                    telegramPosted: false,
                    videoProcessingStatus: 'pending' // Lista para video
                });
                
                await newArticle.save();
                console.log(`[News Worker] 💾 Noticia guardada. Enviando a Bot de Video...`);
                
                // Enviamos al bot INMEDIATAMENTE
                await _triggerVideoBotWithRotation(newArticle);
                
            } else {
                console.warn(`[News Worker] ⚠️ La IA no pudo generar el artículo. Saltando.`);
            }
            
            // Pequeña pausa para dar aire al sistema
            await sleep(3000); 

        } catch (error) {
            console.error(`[News Worker] Error en ciclo principal: ${error.message}`);
            await sleep(10 * 1000); 
        }
    }
}


// ============================================================================
// 🎮 8. PUNTOS DE CONTROL MANUAL (ADMIN)
// ============================================================================

exports.syncNewsAPIs = async (req, res) => {
    runNewsAPIFetch();
    res.json({ message: "Búsqueda manual iniciada." });
};

exports.retryVideos = async (req, res) => {
    console.log("[Manual] Reseteando videos zombies...");
    await _resetStuckVideos(true);
    res.json({ message: 'Videos liberados y puestos en cola.' });
};

exports.createManualArticle = async (req, res) => {
    if (isQuotaExhausted) {
        return res.status(503).json({ error: "🛑 SISTEMA EN PAUSA: Cuota agotada." });
    }

    try {
        const { titulo, enlaceOriginal, imagen } = req.body;
        console.log(`[Manual] Creando: ${titulo}`);

        const iaData = await generateArticleContent({ 
            url: enlaceOriginal, 
            title: titulo || "Noticia Manual",
            description: "Manual"
        });
        
        if (!iaData) return res.status(500).json({ error: "Error IA." });

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
        
        // Disparar video
        _triggerVideoBotWithRotation(newArticle);
        
        res.status(201).json(newArticle);
    } catch (error) { 
        console.error("Error manual:", error);
        res.status(500).json({ error: error.message });
    }
};