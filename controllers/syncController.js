// Archivo: lfaftechapi/controllers/syncController.js
// --- ¡VERSIÓN WORKER (CON ROTACIÓN DE CLAVES, FILA DE MEMORIA Y PING A SITEMAP)! ---

const axios = require('axios');
const Article = require('../models/article');
const { publicarUnArticulo } = require('../utils/telegramBot');
const { generateArticleContent } = require('../utils/bedrockClient');

// --- ¡NUEVO! Configuración del Bot de Video ---
const VIDEO_BOT_URL = process.env.VIDEO_BOT_URL;
// Reusamos la misma ADMIN_API_KEY que ya tienes
const VIDEO_BOT_KEY = process.env.ADMIN_API_KEY; 

// Tu lista de reporteros (basado en tus archivos de imagen)
const REPORTER_IMAGES = [
    "reportera_maria.png",
    "reportero_juan.png"
    // TODO: Añade aquí los nombres de archivo de tus otros 8+ reporteros
];
// --- Fin Configuración Bot ---


// --- Constantes (Listas de países) ---
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

// --- Banderas de estado y FILA DE MEMORIA ---
let isNewsWorkerRunning = false;
let isFetchWorkerRunning = false;
let globalArticleQueue = [];
let articlesProcessedSinceLastTelegram = 0;

// --- Sistema de Rotación de Claves ---
const gnewsKeys = [
    process.env.GNEWS_API_KEY,
    process.env.GNEWS_API_KEY_2,
    process.env.GNEWS_API_KEY_3,
    process.env.GNEWS_API_KEY_4
].filter(Boolean); // Filtra las claves vacías

const newsDataKeys = [
    process.env.NEWSDATA_API_KEY,
    process.env.NEWSDATA_API_KEY_2,
    process.env.NEWSDATA_API_KEY_3,
    process.env.NEWSDATA_API_KEY_4
].filter(Boolean); // Filtra las claves vacías

let currentGNewsKeyIndex = 0;
let currentNewsDataKeyIndex = 0;

// =============================================
// PARTE 1: EL RECOLECTOR (Llamado por Cron Job o API)
// =============================================

/**
 * [INTERNO / EXPORTADO] Esta es la función de trabajo pesado de RECOLECCIÓN.
 */
const runNewsAPIFetch = async () => {
    if (isFetchWorkerRunning) {
        console.warn("[RECOLECTOR] Intento de iniciar, pero ya estaba corriendo. Saltando.");
        return;
    }
    isFetchWorkerRunning = true;

    currentGNewsKeyIndex = 0;
    currentNewsDataKeyIndex = 0;

    try {
        if (gnewsKeys.length === 0 || newsDataKeys.length === 0) {
            console.error("(Recolector) Error: No se encontraron claves de API para GNews o NewsData en el .env.");
            return;
        }
        console.log(`(Recolector) Iniciando recolección... (GNews Keys: ${gnewsKeys.length}, NewsData Keys: ${newsDataKeys.length})`);

        let erroresFetch = [];
        let articulosCrudos = []; 
        
        // --- PASO 1: NEWSDATA.IO (Con rotación de claves) ---
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
                    }
                    success = true; 

                } catch (e) {
                    const status = e.response?.status;
                    if (status === 429 || status === 401 || status === 403) {
                        console.warn(`(Recolector) NewsData Key #${currentNewsDataKeyIndex + 1} falló (Error ${status}) para [${pais}]. Rotando clave...`);
                        currentNewsDataKeyIndex = (currentNewsDataKeyIndex + 1) % newsDataKeys.length;
                        attempts++;
                        await sleep(2000); 
                    } else {
                        console.error(`(Recolector) Error NewsData [${pais}]: ${e.message}`);
                        erroresFetch.push(`NewsData-${pais}`);
                        break; 
                    }
                }
            } 
            
            await sleep(5000); 
        }
        console.log(`(Recolector) -> Total Obtenidos NewsData.io: ${articulosCrudos.length}.`);

        // --- PASO 2: GNEWS (Con rotación de claves) ---
        for (const pais of PAISES_GNEWS) {
            let success = false;
            let attempts = 0;
            
            while (!success && attempts < gnewsKeys.length) {
                try {
                    const currentKey = gnewsKeys[currentGNewsKeyIndex];
                    const urlGNews = `https://gnews.io/api/v4/top-headlines?country=${pais}&lang=es&max=${MAX_ARTICLES_PER_COUNTRY}&apikey=${currentKey}`;
                    
                    const response = await axios.get(urlGNews);
                    
                    response.data.articles.forEach(article => {
                        if (!article.title || !article.url) return;
                        articulosCrudos.push({ ...article, paisLocal: pais });
                    });
                    success = true; 

                } catch (e) {
                    const status = e.response?.status;
                    if (status === 429 || status === 403 || status === 401) {
                        console.warn(`(Recolector) GNews Key #${currentGNewsKeyIndex + 1} falló (Error ${status}) para [${pais}]. Rotando clave...`);
                        currentGNewsKeyIndex = (currentGNewsKeyIndex + 1) % gnewsKeys.length; 
                        attempts++;
                        await sleep(2000); 
                    } else {
                        console.error(`(Recolector) Error GNews [${pais}]: ${e.message}`);
                        erroresFetch.push(`GNews-${pais}`);
                        break; 
                    }
                }
            }
            
            await sleep(1000); 
        }
        console.log(`(Recolector) -> Total Obtenidos (GNews + NewsData): ${articulosCrudos.length}.`);

        // --- PASO 3: DE-DUPLICACIÓN ---
        const urlsRecibidas = articulosCrudos.map(article => article.url);
        
        const articulosExistentesDB = await Article.find({ enlaceOriginal: { $in: urlsRecibidas } }).select('enlaceOriginal');
        const urlsExistentesDB = new Set(articulosExistentesDB.map(a => a.enlaceOriginal));
        
        const urlsEnFila = new Set(globalArticleQueue.map(a => a.url));

        const articulosNuevos = articulosCrudos.filter(article => {
            return !urlsExistentesDB.has(article.url) && !urlsEnFila.has(article.url);
        });
        
        console.log(`(Recolector) -> ${articulosCrudos.length} artículos recibidos.`);
        console.log(`(Recolector) -> ${urlsExistentesDB.size} ya existen en la DB.`);
        console.log(`(Recolector) -> ${urlsEnFila.size} ya estaban en la fila de espera.`);
        console.log(`(Recolector) -> ${articulosNuevos.length} artículos son NUEVOS.`);

        // --- PASO 4: AÑADIR A LA FILA DE MEMORIA ---
        if (articulosNuevos.length > 0) {
            globalArticleQueue.push(...articulosNuevos);
            console.log(`(Recolector) ¡${articulosNuevos.length} artículos nuevos añadidos a la fila! Total en fila: ${globalArticleQueue.length}`);
        }

        console.log("(Recolector) ¡Recolección finalizada!");
        
    } catch (error) {
        console.error("(Recolector) Error catastrófico en runNewsAPIFetch:", error.message);
    } finally {
        isFetchWorkerRunning = false;
    }
};
exports.runNewsAPIFetch = runNewsAPIFetch;


/**
 * [PRIVADO] Esta es la ruta API que puedes llamar manualmente
 */
exports.syncNewsAPIs = async (req, res) => {
    res.json({ 
        message: "¡Trabajo de RECOLECCIÓN (con rotación de claves) iniciado! Añadiendo noticias a la fila en segundo plano."
    });
    runNewsAPIFetch();
};


// --- ¡NUEVA FUNCIÓN! ---
/**
 * [INTERNO] Llama al bot de Python (TTS-FMPEG) para generar un video.
 * Se ejecuta "fire-and-forget" (sin 'await' en el worker) para no bloquear el bucle.
 */
async function _triggerVideoBot(article) {
    if (!VIDEO_BOT_URL) {
        console.warn(`[VideoBot] No se configuró VIDEO_BOT_URL. Saltando generación de video para ${article.titulo}`);
        return;
    }
    // Verificamos si el artículo AÚN existe antes de procesar
    const articleCheck = await Article.findById(article._id);
    if (!articleCheck) {
         console.warn(`[VideoBot] El artículo ${article.titulo} fue eliminado. Cancelando video.`);
         return;
    }

    console.log(`[VideoBot] Iniciando trabajo para: ${article.titulo}`);

    try {
        // 1. Marcar el artículo como "processing" (como describiste)
        articleCheck.videoProcessingStatus = 'processing';
        await articleCheck.save();

        // 2. Elegir reportero al azar
        const randomReporter = REPORTER_IMAGES[Math.floor(Math.random() * REPORTER_IMAGES.length)];
        console.log(`[VideoBot] Reportero seleccionado: ${randomReporter}`);

        // 3. Preparar datos para el bot (basado en tu TTS-FMPEG/app.py)
        // --- CAMBIO: Enviamos la URL de la imagen real ---
        const payload = {
            text: articleCheck.articuloGenerado, 
            title: articleCheck.titulo,            
            // EN LUGAR DE 'image_name', AHORA ENVIAMOS 'image_url'
            image_url: articleCheck.imagen, // <--- ¡La foto de la noticia!
            article_id: articleCheck._id 
        };

        // 4. Llamar al bot (Esta llamada puede tardar MINUTOS)
        console.log(`[VideoBot] Llamando a ${VIDEO_BOT_URL}/generate_video...`);
        const botResponse = await axios.post(
            `${VIDEO_BOT_URL}/generate_video`,
            payload,
            { 
                // Usamos la misma clave ADMIN_API_KEY para autenticar API -> BOT
                headers: { 'x-api-key': VIDEO_BOT_KEY }, 
                // Timeout largo (10 minutos) porque gTTS, FFmpeg y YouTube tardan
                timeout: 10 * 60 * 1000 
            }
        );

        const youtubeId = botResponse.data.youtubeId;

        if (!youtubeId) {
            throw new Error("El bot de video no devolvió un youtubeId.");
        }

        // 5. ¡Éxito! Actualizar la DB (como describiste)
        console.log(`[VideoBot] ¡Éxito! ID de YouTube: ${youtubeId}. Guardando en DB.`);
        
        // Volvemos a buscar por si acaso fue borrado durante el largo proceso
        const articleFinal = await Article.findById(article._id);
        if (articleFinal) {
            articleFinal.videoProcessingStatus = 'complete';
            articleFinal.youtubeId = youtubeId;
            await articleFinal.save();
        } else {
             console.warn(`[VideoBot] Video generado (${youtubeId}), pero el artículo ${article.titulo} ya no existe.`);
        }


    } catch (error) {
        const errorMsg = error.response ? (error.response.data.error || error.message) : error.message;
        console.error(`[VideoBot] Error fatal procesando ${article.titulo}: ${errorMsg}`);
        
        // Marcar como 'failed' para no reintentar
        try {
            // Re-buscamos el artículo por si la referencia 'article' es antigua
            const articleInDB = await Article.findById(article._id);
            if (articleInDB) {
                articleInDB.videoProcessingStatus = 'failed';
                await articleInDB.save();
            }
        } catch (dbError) {
            console.error(`[VideoBot] Error marcando como fallido: ${dbError.message}`);
        }
    }
}


// =============================================
// PARTE 2: EL WORKER DE NOTICIAS UNIFICADO
// =============================================

/**
 * [INTERNO] Envía un "ping" a Google para notificar que el sitemap se ha actualizado.
 * ¡ESTA ES LA NUEVA FUNCIÓN!
 */
async function _pingGoogleSitemap() {
    // Esta es la URL de tu sitemap en el frontend de Vercel
    const sitemapUrl = 'https://www.noticias.lat/sitemap.xml';
    const pingUrl = `https://www.google.com/ping?sitemap=${encodeURIComponent(sitemapUrl)}`;
    try {
        await axios.get(pingUrl);
        console.log(`[News Worker] ¡Sitemap "ping" enviado a Google con éxito!`);
    } catch (error) {
        // No detenemos el worker si esto falla, solo avisamos.
        console.warn(`[News Worker] Falló el "ping" del sitemap a Google: ${error.message}`);
    }
}

/**
 * [PRIVADO] Inicia el worker de Noticias
 */
exports.startNewsWorker = () => {
    if (isNewsWorkerRunning) {
        console.log("[News Worker] Ya está corriendo.");
        return;
    }
    console.log("[News Worker] Iniciando worker (IA -> DB -> VideoBot -> Telegram c/11 -> Ping Google)...");
    isNewsWorkerRunning = true;
    _runNewsWorker(); 
};

/**
 * [INTERNO] El bucle infinito que procesa artículos de la FILA DE MEMORIA
 */
async function _runNewsWorker() {
    while (isNewsWorkerRunning) {
        let articleToProcess = null;
        try {
            // 1. Buscar un artículo en la FILA DE MEMORIA
            if (globalArticleQueue.length === 0) {
                await sleep(1 * 60 * 1000); 
                continue; 
            }

            // 2. ¡Encontramos trabajo! Tomar el próximo artículo
            articleToProcess = globalArticleQueue.shift(); 
            
            console.log(`[News Worker] Fila restante: ${globalArticleQueue.length}. Procesando IA para: ${articleToProcess.title}`);

            // 3. Llamar a AWS Bedrock (IA)
            const resultadoIA = await generateArticleContent(articleToProcess);

            // 4. Guardar el resultado (o marcar como fallido)
            if (resultadoIA && resultadoIA.articuloGenerado && resultadoIA.categoriaSugerida) {
                
                // 5. ¡ÉXITO! GUARDAR EN LA BASE DE DATOS
                const newArticle = new Article({
                    titulo: articleToProcess.title,
                    descripcion: articleToProcess.description,
                    imagen: articleToProcess.image,
                    sitio: 'noticias.lat',
                    categoria: resultadoIA.categoriaSugerida,
                    pais: articleToProcess.paisLocal,
                    fuente: articleToProcess.source.name,
                    enlaceOriginal: articleToProcess.url,
                    fecha: new Date(articleToProcess.publishedAt),
                    articuloGenerado: resultadoIA.articuloGenerado,
                    telegramPosted: false,
                    videoProcessingStatus: 'pending' // Estado inicial
                });
                
                await newArticle.save();
                console.log(`[News Worker] ¡Artículo guardado en DB! (${newArticle.titulo})`);

                // --- ¡¡AQUÍ ES!! LLAMAR AL BOT DE VIDEO (SIN AWAIT) ---
                // Esto lo ejecuta en segundo plano y el bucle continúa
                _triggerVideoBot(newArticle);
                // --------------------------------------------------

                // 6. LÓGICA DE TELEGRAM Y SITEMAP (CADA 11)
                articlesProcessedSinceLastTelegram++;
                
                if (articlesProcessedSinceLastTelegram >= 11) {
                    console.log(`[News Worker] ¡Artículo #${articlesProcessedSinceLastTelegram}! Enviando a Telegram y Google...`);
                    
                    // 1. Enviar a Telegram
                    await publicarUnArticulo(newArticle); 
                    
                    // 2. ¡NUEVO! Enviar ping a Google
                    await _pingGoogleSitemap(); // <-- ¡AQUÍ ESTÁ LA LLAMADA!

                    articlesProcessedSinceLastTelegram = 0; // Reiniciar contador
                } else {
                    console.log(`[News Worker] Artículo #${articlesProcessedSinceLastTelegram}/11. (No se envía a Telegram ni Google).`);
                }
                
            } else {
                console.warn(`[News Worker] Fallo de IA para ${articleToProcess.title}. Artículo descartado, no se guardará en DB.`);
            }
            
            // 7. Pausa de 30 segundos
            console.log("[News Worker] Pausa de 30 segundos...");
            await sleep(30 * 1000); 

        } catch (error) {
            if (error.code === 11000) {
                 console.warn(`[News Worker] Error de duplicado al guardar ${articleToProcess?.title}. Saltando.`);
            } else {
                console.error(`[News Worker] Error fatal procesando ${articleToProcess?.title}: ${error.message}`);
            }
            await sleep(1 * 60 * 1000);
        }
    }
}


// =============================================
// PARTE 3: RUTAS MANUALES Y SITEMAP
// =============================================

/**
 * [PRIVADO] Añadir un nuevo artículo manualmente
 */
exports.createManualArticle = async (req, res) => {
    try {
        const { titulo, descripcion, imagen, sitio, fuente, enlaceOriginal, fecha, pais } = req.body;
        
        if (!enlaceOriginal || !enlaceOriginal.startsWith('http')) {
             return res.status(400).json({ error: "El 'enlaceOriginal' (URL) es obligatorio para que la IA trabaje." });
        }
        
        const resultadoIA = await generateArticleContent({ url: enlaceOriginal, title: titulo });

        if (!resultadoIA) {
            return res.status(500).json({ error: "La IA (Bedrock) no pudo procesar la URL proporcionada." });
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
            categoria: resultadoIA.categoriaSugerida,
            telegramPosted: false,
            videoProcessingStatus: 'pending' // Estado inicial
        });

        await newArticle.save();
        
        // --- ¡ACTUALIZADO! ---
        // Los artículos manuales también avisan a Telegram Y a Google.
        try {
            console.log("Artículo manual guardado. Enviando a Telegram, Google y Bot de Video...");
            
            // 1. Llama al Bot de Video (sin await)
             _triggerVideoBot(newArticle);

            // 2. Llama a Telegram
            await publicarUnArticulo(newArticle);

            // 3. Llama a Google
            await _pingGoogleSitemap(); // <-- ¡AQUÍ TAMBIÉN!

        } catch (telegramError) {
            console.error("Artículo manual guardado, pero falló al enviar notificaciones:", telegramError.message);
        }
        
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