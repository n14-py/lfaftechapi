// Archivo: lfaftechapi/controllers/syncController.js
// --- ¡VERSIÓN FINAL: MULTI-BOTS (RENDER FREE) + IMAGEN ORIGINAL! ---

const axios = require('axios');
const Article = require('../models/article');

// 1. IMPORTAMOS SOLO LA IA DE TEXTO (Ya no usamos la de imagen)
const { generateArticleContent } = require('../utils/bedrockClient');

// --- CONFIGURACIÓN DE MULTI-BOTS DE VIDEO (RENDER FREE) ---
// Cargamos las URLs de tus 3 instancias desde el .env
const VIDEO_BOT_URLS = [
    process.env.VIDEO_BOT_URL_1,
    process.env.VIDEO_BOT_URL_2,
    process.env.VIDEO_BOT_URL_3
].filter(Boolean); // Esto elimina las que estén vacías si alguna no está configurada

// Reusamos la misma clave de admin para todos
const VIDEO_BOT_KEY = process.env.ADMIN_API_KEY; 

// Variable para rotar entre los bots (Round Robin)
let currentBotIndex = 0;

// --- Constantes de Recolección ---
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

// --- Banderas de estado ---
let isNewsWorkerRunning = false;
let isFetchWorkerRunning = false;
let globalArticleQueue = []; 

// --- Claves de APIs de Noticias (Con Rotación) ---
const gnewsKeys = [
    process.env.GNEWS_API_KEY,
    process.env.GNEWS_API_KEY_2,
    process.env.GNEWS_API_KEY_3,
    process.env.GNEWS_API_KEY_4
].filter(Boolean);

const newsDataKeys = [
    process.env.NEWSDATA_API_KEY,
    process.env.NEWSDATA_API_KEY_2,
    process.env.NEWSDATA_API_KEY_3,
    process.env.NEWSDATA_API_KEY_4
].filter(Boolean);

let currentGNewsKeyIndex = 0;
let currentNewsDataKeyIndex = 0;


// =========================================================================
// PARTE 1: EL RECOLECTOR (Busca noticias y guarda la imagen original)
// =========================================================================

const runNewsAPIFetch = async () => {
    if (isFetchWorkerRunning) {
        console.warn("[RECOLECTOR] Ya estaba corriendo. Saltando.");
        return;
    }
    isFetchWorkerRunning = true;
    currentGNewsKeyIndex = 0;
    currentNewsDataKeyIndex = 0;

    try {
        console.log(`(Recolector) Iniciando... (GNews Keys: ${gnewsKeys.length}, NewsData Keys: ${newsDataKeys.length})`);

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
                            // IMPORTANTE: Solo aceptamos si tiene título, link E IMAGEN
                            if (!article.title || !article.link || !article.image_url) return; 
                            
                            const paisNombreCompleto = article.country ? article.country[0] : 'unknown';
                            const paisCodigo = paisNewsDataMap[paisNombreCompleto.toLowerCase()] || paisNombreCompleto;
                            
                            articulosCrudos.push({
                                title: article.title,
                                description: article.description || 'Sin descripción.',
                                image: article.image_url, // USAMOS LA ORIGINAL
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
                    } else {
                        break; 
                    }
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
                        // IMPORTANTE: Solo aceptamos si tiene título, url E IMAGEN
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
                    } else {
                        break; 
                    }
                }
            }
            await sleep(1000); 
        }

        // --- C. FILTRADO (Solo nuevos) ---
        const urlsRecibidas = articulosCrudos.map(article => article.url);
        
        // Chequear DB
        const articulosExistentesDB = await Article.find({ enlaceOriginal: { $in: urlsRecibidas } }).select('enlaceOriginal');
        const urlsExistentesDB = new Set(articulosExistentesDB.map(a => a.enlaceOriginal));
        
        // Chequear Fila en Memoria
        const urlsEnFila = new Set(globalArticleQueue.map(a => a.url));

        const articulosNuevos = articulosCrudos.filter(article => {
            return !urlsExistentesDB.has(article.url) && !urlsEnFila.has(article.url);
        });
        
        if (articulosNuevos.length > 0) {
            globalArticleQueue.push(...articulosNuevos);
            console.log(`(Recolector) ¡${articulosNuevos.length} noticias nuevas en fila! Total: ${globalArticleQueue.length}`);
        }
        
    } catch (error) {
        console.error("(Recolector) Error:", error.message);
    } finally {
        isFetchWorkerRunning = false;
    }
};
exports.runNewsAPIFetch = runNewsAPIFetch;


// =========================================================================
// PARTE 2: EL GESTOR DE BOTS DE VIDEO (BALANCEO DE CARGA)
// =========================================================================

/**
 * [INTERNO] Envía el trabajo a uno de los bots disponibles.
 * Rota entre URL_1, URL_2 y URL_3.
 */
async function _triggerVideoBotWithRotation(article) {
    if (VIDEO_BOT_URLS.length === 0) {
        console.warn(`[VideoBot] ❌ NO HAY BOTS CONFIGURADOS en .env (VIDEO_BOT_URL_1, etc).`);
        return;
    }

    // 1. Verificar si el artículo existe
    const articleCheck = await Article.findById(article._id);
    if (!articleCheck) return;

    // 2. Seleccionar el Bot que toca (Round Robin)
    const targetBotUrl = VIDEO_BOT_URLS[currentBotIndex];
    console.log(`[VideoBot] Asignando tarea al Bot #${currentBotIndex + 1}: ${targetBotUrl}`);
    
    // Avanzar el índice para la próxima vez (0 -> 1 -> 2 -> 0)
    currentBotIndex = (currentBotIndex + 1) % VIDEO_BOT_URLS.length;

    try {
        // 3. Marcar como 'processing'
        articleCheck.videoProcessingStatus = 'processing';
        await articleCheck.save();

        // 4. Payload (Usando la imagen ORIGINAL)
        const payload = {
            text: articleCheck.articuloGenerado, 
            title: articleCheck.titulo,            
            image_url: articleCheck.imagen, // <--- URL ORIGINAL DE LA NOTICIA
            article_id: articleCheck._id 
        };

        // 5. Llamar al bot (Fire and forget, el bot llamará al callback)
        // Usamos un timeout corto de conexión, pero el proceso allá tarda minutos.
        await axios.post(`${targetBotUrl}/generate_video`, payload, { 
            headers: { 'x-api-key': VIDEO_BOT_KEY }
        });

        console.log(`[VideoBot] Tarea enviada correctamente a Bot.`);

    } catch (error) {
        console.error(`[VideoBot] Error enviando a Bot: ${error.message}`);
        // Si falló el envío, volvemos a 'pending' o 'failed'
        articleCheck.videoProcessingStatus = 'failed';
        await articleCheck.save();
    }
}


// =========================================================================
// PARTE 3: EL WORKER CONTROLADOR (SEMÁFORO)
// =========================================================================

/**
 * [PRIVADO] API para activar recolección
 */
exports.syncNewsAPIs = async (req, res) => {
    res.json({ message: "Recolector iniciado." });
    runNewsAPIFetch();
};

/**
 * [PRIVADO] Inicia el worker
 */
exports.startNewsWorker = () => {
    if (isNewsWorkerRunning) return;
    console.log(`[News Worker] Iniciando con ${VIDEO_BOT_URLS.length} Bots de Video disponibles.`);
    isNewsWorkerRunning = true;
    _runNewsWorker(); 
};

/**
 * [INTERNO] Bucle principal
 */
async function _runNewsWorker() {
    while (isNewsWorkerRunning) {
        try {
            // 1. ¿Hay noticias en la fila?
            if (globalArticleQueue.length === 0) {
                await sleep(60 * 1000); 
                continue; 
            }

            // 2. --- EL FRENO DE MANO (SEMÁFORO) ---
            // Contamos cuántos videos se están haciendo AHORA MISMO
            const activeVideos = await Article.countDocuments({ videoProcessingStatus: 'processing' });
            
            // Si tenemos tantos videos activos como bots, ESPERAMOS.
            // (Así no generamos noticias si no hay quien haga el video)
            if (activeVideos >= VIDEO_BOT_URLS.length) {
                console.log(`[News Worker] ✋ Todos los bots (${activeVideos}/${VIDEO_BOT_URLS.length}) están ocupados. Esperando hueco...`);
                await sleep(30 * 1000); // Esperar 30 segs y volver a chequear
                continue; // Vuelve al inicio del while
            }

            // 3. ¡Hay hueco! Procesamos la siguiente noticia
            const articleToProcess = globalArticleQueue.shift(); 
            console.log(`[News Worker] Procesando: ${articleToProcess.title}`);

            // 4. Generar solo Texto (Bedrock)
            const resultadoIA = await generateArticleContent(articleToProcess);

            if (resultadoIA && resultadoIA.articuloGenerado) {
                const { categoria, tituloViral, articuloGenerado } = resultadoIA;
                
                // 5. Guardar en DB con IMAGEN ORIGINAL
                const newArticle = new Article({
                    titulo: tituloViral || articleToProcess.title, 
                    descripcion: articleToProcess.description,
                    imagen: articleToProcess.image, // <--- IMAGEN ORIGINAL DIRECTA
                    sitio: 'noticias.lat',
                    categoria: categoria,
                    pais: articleToProcess.paisLocal,
                    fuente: articleToProcess.source.name,
                    enlaceOriginal: articleToProcess.url,
                    fecha: new Date(articleToProcess.publishedAt),
                    articuloGenerado: articuloGenerado,
                    telegramPosted: false,
                    videoProcessingStatus: 'pending' // Pendiente de envío
                });
                
                await newArticle.save();
                console.log(`[News Worker] Noticia guardada. Enviando a video...`);

                // 6. Enviar a un Bot libre
                await _triggerVideoBotWithRotation(newArticle);
                
                // NOTA: No publicamos en Telegram aquí. 
                // Esperamos al Callback del video para publicar.
                
            } else {
                console.warn(`[News Worker] Fallo IA Texto. Saltando.`);
            }
            
            // Pequeña pausa de seguridad
            await sleep(5000); 

        } catch (error) {
            console.error(`[News Worker] Error: ${error.message}`);
            await sleep(60 * 1000);
        }
    }
}


// =========================================================================
// PARTE 4: MANUAL Y SITEMAP
// =========================================================================

/**
 * [PRIVADO] Añadir artículo manual
 */
exports.createManualArticle = async (req, res) => {
    try {
        const { titulo, enlaceOriginal, imagen } = req.body;
        
        // Texto IA
        const iaData = await generateArticleContent({ url: enlaceOriginal, title: titulo || "Manual" });
        if (!iaData) return res.status(500).json({ error: "Error IA Texto" });

        const newArticle = new Article({
            titulo: iaData.tituloViral, 
            descripcion: 'Manual',
            imagen: imagen || 'https://via.placeholder.com/800x600', // Debe proveer imagen
            sitio: 'noticias.lat',
            enlaceOriginal: enlaceOriginal,
            articuloGenerado: iaData.articuloGenerado,
            categoria: iaData.categoria,
            telegramPosted: false,
            videoProcessingStatus: 'pending'
        });

        await newArticle.save();
        
        // Enviar a video
        _triggerVideoBotWithRotation(newArticle);
        
        res.status(201).json(newArticle);
    } catch (error) { 
        res.status(500).json({ error: error.message });
    }
};

/**
 * [PÚBLICO] Generar Sitemap
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