// Archivo: lfaftechapi/controllers/syncController.js
// --- ¡VERSIÓN MAESTRA FINAL: RECOLECCIÓN + TÍTULOS VIRALES + IMÁGENES ÉPICAS! ---

const axios = require('axios');
const Article = require('../models/article');
const { publicarUnArticulo } = require('../utils/telegramBot');

// 1. IMPORTAMOS LAS FUNCIONES DE BEDROCK (TEXTO VIRAL Y PROMPT VISUAL)
const { generateArticleContent, generateImagePrompt } = require('../utils/bedrockClient');

// 2. IMPORTAMOS EL GENERADOR DE MINIATURAS (DEEPINFRA + SHARP + BUNNY)
const { generateNewsThumbnail } = require('../utils/imageHandler');

// --- Configuración del Bot de Video ---
const VIDEO_BOT_URL = process.env.VIDEO_BOT_URL;
// Reusamos la misma ADMIN_API_KEY para autenticar
const VIDEO_BOT_KEY = process.env.ADMIN_API_KEY; 

// --- Constantes (Listas de países y mapeo) ---
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
let globalArticleQueue = []; // Aquí se guardan las noticias crudas esperando IA
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


// =========================================================================
// PARTE 1: EL RECOLECTOR (Lógica Completa de Búsqueda)
// =========================================================================

/**
 * [INTERNO / EXPORTADO] Función que busca noticias en las APIs externas
 * y llena la fila 'globalArticleQueue'.
 */
const runNewsAPIFetch = async () => {
    if (isFetchWorkerRunning) {
        console.warn("[RECOLECTOR] Intento de iniciar, pero ya estaba corriendo. Saltando.");
        return;
    }
    isFetchWorkerRunning = true;

    // Reiniciamos índices al arrancar cada ciclo para probar siempre las primeras claves
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
        
        // --- A. NEWSDATA.IO (Con rotación de claves) ---
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
                            
                            // Normalización de datos NewsData
                            const paisNombreCompleto = article.country ? article.country[0] : 'unknown';
                            const paisCodigo = paisNewsDataMap[paisNombreCompleto.toLowerCase()] || paisNombreCompleto;
                            
                            articulosCrudos.push({
                                title: article.title,
                                description: article.description || 'Sin descripción.',
                                image: article.image_url, // Imagen original (se usará si falla la IA)
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
                    // Si es error de límites o permisos, rotamos clave
                    if (status === 429 || status === 401 || status === 403) {
                        console.warn(`(Recolector) NewsData Key #${currentNewsDataKeyIndex + 1} falló (Error ${status}) para [${pais}]. Rotando clave...`);
                        currentNewsDataKeyIndex = (currentNewsDataKeyIndex + 1) % newsDataKeys.length;
                        attempts++;
                        await sleep(2000); 
                    } else {
                        // Otros errores (500, timeout), pasamos al siguiente país
                        console.error(`(Recolector) Error NewsData [${pais}]: ${e.message}`);
                        erroresFetch.push(`NewsData-${pais}`);
                        break; 
                    }
                }
            } 
            // Pequeña pausa entre países para no saturar
            await sleep(5000); 
        }
        console.log(`(Recolector) -> Total Obtenidos NewsData.io: ${articulosCrudos.length}.`);

        // --- B. GNEWS (Con rotación de claves) ---
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
                        // Normalización GNews
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

        // --- C. DE-DUPLICACIÓN ---
        const urlsRecibidas = articulosCrudos.map(article => article.url);
        
        // 1. Chequear contra la Base de Datos
        const articulosExistentesDB = await Article.find({ enlaceOriginal: { $in: urlsRecibidas } }).select('enlaceOriginal');
        const urlsExistentesDB = new Set(articulosExistentesDB.map(a => a.enlaceOriginal));
        
        // 2. Chequear contra la Fila actual en memoria
        const urlsEnFila = new Set(globalArticleQueue.map(a => a.url));

        // 3. Filtrar
        const articulosNuevos = articulosCrudos.filter(article => {
            return !urlsExistentesDB.has(article.url) && !urlsEnFila.has(article.url);
        });
        
        console.log(`(Recolector) -> ${articulosCrudos.length} recibidos. ${urlsExistentesDB.size} ya en DB. ${urlsEnFila.size} ya en fila.`);
        console.log(`(Recolector) -> ${articulosNuevos.length} artículos son NUEVOS.`);

        // --- D. AÑADIR A LA FILA DE MEMORIA ---
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
 * [PRIVADO] Ruta API para activar la recolección manualmente
 */
exports.syncNewsAPIs = async (req, res) => {
    res.json({ 
        message: "¡Trabajo de RECOLECCIÓN (con rotación de claves) iniciado! Añadiendo noticias a la fila en segundo plano."
    });
    // Fire and forget (ejecutar sin esperar)
    runNewsAPIFetch();
};


// =========================================================================
// PARTE 2: EL BOT DE VIDEO (Helper)
// =========================================================================

/**
 * [INTERNO] Llama al bot de Python (TTS-FMPEG) para generar un video.
 */
async function _triggerVideoBot(article) {
    if (!VIDEO_BOT_URL) {
        console.warn(`[VideoBot] No se configuró VIDEO_BOT_URL. Saltando video.`);
        return;
    }
    // Verificamos si el artículo AÚN existe
    const articleCheck = await Article.findById(article._id);
    if (!articleCheck) {
         console.warn(`[VideoBot] El artículo ${article.titulo} fue eliminado. Cancelando video.`);
         return;
    }

    console.log(`[VideoBot] Iniciando trabajo para: ${article.titulo}`);

    try {
        // 1. Marcar el artículo como "processing"
        articleCheck.videoProcessingStatus = 'processing';
        await articleCheck.save();

        // 2. Preparar payload. Enviamos la URL de la imagen (Bunny o Original)
        const payload = {
            text: articleCheck.articuloGenerado, 
            title: articleCheck.titulo,            
            image_url: articleCheck.imagen, // <--- Aquí va la URL de la imagen épica
            article_id: articleCheck._id 
        };

        // 3. Llamar al bot (Timeout largo de 10 mins)
        console.log(`[VideoBot] Llamando a ${VIDEO_BOT_URL}/generate_video...`);
        const botResponse = await axios.post(
            `${VIDEO_BOT_URL}/generate_video`,
            payload,
            { 
                headers: { 'x-api-key': VIDEO_BOT_KEY }, 
                timeout: 10 * 60 * 1000 
            }
        );

        const youtubeId = botResponse.data.youtubeId;

        if (!youtubeId) {
            throw new Error("El bot de video no devolvió un youtubeId.");
        }

        // 4. ¡Éxito! Actualizar la DB
        console.log(`[VideoBot] ¡Éxito! ID de YouTube: ${youtubeId}. Guardando en DB.`);
        
        const articleFinal = await Article.findById(article._id);
        if (articleFinal) {
            articleFinal.videoProcessingStatus = 'complete';
            articleFinal.youtubeId = youtubeId;
            await articleFinal.save();
        } 

    } catch (error) {
        const errorMsg = error.response ? (error.response.data.error || error.message) : error.message;
        console.error(`[VideoBot] Error fatal procesando ${article.titulo}: ${errorMsg}`);
        
        // Marcar como 'failed'
        try {
            const articleInDB = await Article.findById(article._id);
            if (articleInDB) {
                articleInDB.videoProcessingStatus = 'failed';
                await articleInDB.save();
            }
        } catch (dbError) { /* Ignorar error de DB secundario */ }
    }
}


// =========================================================================
// PARTE 3: PING GOOGLE SITEMAP (SEO)
// =========================================================================

async function _pingGoogleSitemap() {
    const sitemapUrl = 'https://www.noticias.lat/sitemap.xml';
    const pingUrl = `https://www.google.com/ping?sitemap=${encodeURIComponent(sitemapUrl)}`;
    try {
        await axios.get(pingUrl);
        console.log(`[News Worker] ¡Sitemap "ping" enviado a Google con éxito!`);
    } catch (error) {
        console.warn(`[News Worker] Falló el "ping" a Google (No es crítico): ${error.message}`);
    }
}


// =========================================================================
// PARTE 4: EL WORKER UNIFICADO (IA + IMAGEN ÉPICA + VIDEO + TELEGRAM)
// =========================================================================

/**
 * [PRIVADO] Inicia el worker
 */
exports.startNewsWorker = () => {
    if (isNewsWorkerRunning) {
        console.log("[News Worker] Ya está corriendo.");
        return;
    }
    console.log("[News Worker] Iniciando worker (IA Texto -> IA Imagen Épica -> DB -> VideoBot -> Telegram)...");
    isNewsWorkerRunning = true;
    _runNewsWorker(); 
};

/**
 * [INTERNO] El bucle infinito que procesa la fila
 */
async function _runNewsWorker() {
    while (isNewsWorkerRunning) {
        let articleToProcess = null;
        try {
            // 1. ¿Hay trabajo?
            if (globalArticleQueue.length === 0) {
                await sleep(1 * 60 * 1000); // Esperar 1 minuto si está vacío
                continue; 
            }

            // 2. Tomar noticia de la fila
            articleToProcess = globalArticleQueue.shift(); 
            
            console.log(`[News Worker] Fila restante: ${globalArticleQueue.length}. Procesando: ${articleToProcess.title}`);

            // -------------------------------------------------------------
            // PASO A: GENERAR CONTENIDO TEXTUAL (BEDROCK)
            // -------------------------------------------------------------
            // Ahora 'generateArticleContent' devuelve un objeto con { categoria, tituloViral, textoImagen, articuloGenerado }
            const resultadoIA = await generateArticleContent(articleToProcess);

            // Solo procedemos si hay texto generado y el objeto es válido
            if (resultadoIA && resultadoIA.articuloGenerado && resultadoIA.categoria) {
                
                // Extraemos los datos especiales de la IA
                const { categoria, tituloViral, textoImagen, articuloGenerado } = resultadoIA;
                
                // -------------------------------------------------------------
                // PASO B: GENERAR IMAGEN ÉPICA (DEEPINFRA + BUNNY)
                // -------------------------------------------------------------
                let finalImageUrl = articleToProcess.image; // Por defecto: la imagen original
                
                try {
                    console.log("[News Worker] 🎨 Paso de Imagen: Generando Prompt Visual...");
                    
                    // B1. Pedimos Prompt a Bedrock (Usando el Título Viral para mejor contexto)
                    const imagePrompt = await generateImagePrompt(tituloViral, articuloGenerado);
                    
                    if (imagePrompt) {
                        console.log(`[News Worker] 🖼️ Prompt listo. Creando Miniatura Épica con texto: "${textoImagen}"...`);
                        
                        // B2. Generar, Editar (Texto 2-3 palabras) y Subir a Bunny
                        // ¡AQUÍ USAMOS 'textoImagen' (Ej: "CAOS TOTAL") EN LUGAR DEL TÍTULO LARGO!
                        const bunnyUrl = await generateNewsThumbnail(imagePrompt, textoImagen);
                        
                        if (bunnyUrl) {
                            console.log(`[News Worker] ✅ ¡Imagen Pro Creada!: ${bunnyUrl}`);
                            finalImageUrl = bunnyUrl; // ¡Reemplazamos la imagen original!
                        } else {
                            console.warn("[News Worker] Falló DeepInfra/Bunny. Usando imagen original como fallback.");
                        }
                    }
                } catch (imgError) {
                    console.error(`[News Worker] Error en flujo de imagen (no crítico): ${imgError.message}`);
                }
                
                // -------------------------------------------------------------
                // PASO C: GUARDAR EN BASE DE DATOS
                // -------------------------------------------------------------
                // ¡IMPORTANTE! Guardamos con el 'tituloViral' generado por la IA, no el de GNews.
                const newArticle = new Article({
                    titulo: tituloViral || articleToProcess.title, // Título Clickbait para la web
                    descripcion: articleToProcess.description,
                    imagen: finalImageUrl, // La de Bunny (Épica) o la original
                    sitio: 'noticias.lat',
                    categoria: categoria,
                    pais: articleToProcess.paisLocal,
                    fuente: articleToProcess.source.name,
                    enlaceOriginal: articleToProcess.url,
                    fecha: new Date(articleToProcess.publishedAt),
                    articuloGenerado: articuloGenerado,
                    telegramPosted: false,
                    videoProcessingStatus: 'pending' // Estado inicial para el bot de video
                });
                
                await newArticle.save();
                console.log(`[News Worker] ¡Artículo guardado en DB! (${newArticle.titulo})`);

                // -------------------------------------------------------------
                // PASO D: DISPARAR BOT DE VIDEO
                // -------------------------------------------------------------
                // Sin await, para que el worker siga con la siguiente noticia
                _triggerVideoBot(newArticle);

                // -------------------------------------------------------------
                // PASO E: TELEGRAM Y GOOGLE (Cada 11 noticias)
                // -------------------------------------------------------------
                articlesProcessedSinceLastTelegram++;
                
                if (articlesProcessedSinceLastTelegram >= 11) {
                    console.log(`[News Worker] ¡Lote de 11! Enviando notificación a Telegram y Google...`);
                    
                    // Telegram
                    await publicarUnArticulo(newArticle); 
                    // Google
                    await _pingGoogleSitemap();

                    articlesProcessedSinceLastTelegram = 0; 
                } else {
                    console.log(`[News Worker] Contador Telegram: ${articlesProcessedSinceLastTelegram}/11.`);
                }
                
            } else {
                console.warn(`[News Worker] Fallo de IA Texto para ${articleToProcess.title}. Descartado.`);
            }
            
            // Pausa de seguridad (30 seg)
            console.log("[News Worker] Pausa de 30 segundos...");
            await sleep(30 * 1000); 

        } catch (error) {
            if (error.code === 11000) {
                 console.warn(`[News Worker] Duplicado detectado al guardar. Saltando.`);
            } else {
                console.error(`[News Worker] Error fatal procesando ${articleToProcess?.title}: ${error.message}`);
            }
            // En caso de error grave, pausa de 1 min
            await sleep(1 * 60 * 1000);
        }
    }
}


// =========================================================================
// PARTE 5: CREACIÓN MANUAL (API)
// =========================================================================

/**
 * [PRIVADO] Añadir un nuevo artículo manualmente.
 * TAMBIÉN intenta generar la imagen y títulos virales si no se proveen.
 */
exports.createManualArticle = async (req, res) => {
    try {
        const { titulo, descripcion, imagen, sitio, fuente, enlaceOriginal, fecha, pais } = req.body;
        
        if (!enlaceOriginal || !enlaceOriginal.startsWith('http')) {
             return res.status(400).json({ error: "El 'enlaceOriginal' (URL) es obligatorio." });
        }
        
        // 1. Generar Texto IA (y Títulos Virales)
        const iaData = await generateArticleContent({ url: enlaceOriginal, title: titulo || "Noticia Manual" });

        if (!iaData) {
            return res.status(500).json({ error: "Bedrock no pudo procesar la URL." });
        }

        const { categoria, tituloViral, textoImagen, articuloGenerado } = iaData;

        // 2. Generar Imagen IA (Si el usuario no subió una propia)
        let finalImageUrl = imagen; 
        
        if (!finalImageUrl) {
            console.log("[Manual] Usuario no proveyó imagen. Generando con IA...");
            try {
                // Generar Prompt Visual
                const prompt = await generateImagePrompt(tituloViral, articuloGenerado);
                // Generar Imagen Épica (con texto corto)
                const bunnyUrl = await generateNewsThumbnail(prompt, textoImagen);
                
                if (bunnyUrl) {
                    finalImageUrl = bunnyUrl;
                }
            } catch (e) {
                console.error("Error generando imagen manual:", e.message);
            }
        }

        const newArticle = new Article({
            titulo: titulo || tituloViral, // Preferimos el título manual si existe, sino el viral
            descripcion: descripcion || 'Descripción Generada',
            imagen: finalImageUrl,
            sitio: sitio || 'noticias.lat',
            fuente: fuente || 'Fuente Manual',
            enlaceOriginal: enlaceOriginal,
            fecha: fecha ? new Date(fecha) : new Date(),
            pais: pais || null,
            articuloGenerado: articuloGenerado,
            categoria: categoria,
            telegramPosted: false,
            videoProcessingStatus: 'pending'
        });

        await newArticle.save();
        
        // Disparar todo
        try {
            console.log("Artículo manual guardado. Activando Bots...");
            _triggerVideoBot(newArticle);
            await publicarUnArticulo(newArticle);
            await _pingGoogleSitemap();
        } catch (botError) {
            console.error("Error en notificaciones manuales:", botError.message);
        }
        
        res.status(201).json(newArticle);
        
    } catch (error) { 
        if (error.code === 11000) { 
             return res.status(409).json({ error: "Ya existe un artículo con esa URL." });
        }
        console.error("Error en createManualArticle:", error);
        res.status(500).json({ error: "Error interno al guardar." });
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