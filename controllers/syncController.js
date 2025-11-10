// Archivo: lfaftechapi/controllers/syncController.js
// --- ¡VERSIÓN WORKER (CON ROTACIÓN DE CLAVES Y FILA DE MEMORIA)! ---

const axios = require('axios');
const Article = require('../models/article');
const { publicarUnArticulo } = require('../utils/telegramBot');
const { generateArticleContent } = require('../utils/bedrockClient');

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

// --- ¡NUEVO! SISTEMA DE ROTACIÓN DE CLAVES ---
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
 * Solo busca noticias y las GUARDA EN LA FILA DE MEMORIA (globalArticleQueue).
 */
const runNewsAPIFetch = async () => {
    if (isFetchWorkerRunning) {
        console.warn("[RECOLECTOR] Intento de iniciar, pero ya estaba corriendo. Saltando.");
        return;
    }
    isFetchWorkerRunning = true;

    // Reiniciamos los índices de las claves al inicio de cada recolección
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
                    success = true; // Si llegamos aquí, la petición fue exitosa

                } catch (e) {
                    const status = e.response?.status;
                    if (status === 429 || status === 401 || status === 403) {
                        // Error de clave (agotada, inválida, prohibida)
                        console.warn(`(Recolector) NewsData Key #${currentNewsDataKeyIndex + 1} falló (Error ${status}) para [${pais}]. Rotando clave...`);
                        currentNewsDataKeyIndex = (currentNewsDataKeyIndex + 1) % newsDataKeys.length; // Rota la clave
                        attempts++;
                        await sleep(2000); // Pequeña pausa antes de reintentar con la nueva clave
                    } else {
                        // Otro error (timeout, 500, etc.)
                        console.error(`(Recolector) Error NewsData [${pais}]: ${e.message}`);
                        erroresFetch.push(`NewsData-${pais}`);
                        break; // Salir del 'while' y pasar al siguiente país
                    }
                }
            } // Fin del while
            
            // Pausa de 5 segundos entre países para no saturar la API
            await sleep(2000); 
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
                    success = true; // Petición exitosa

                } catch (e) {
                    const status = e.response?.status;
                    if (status === 429 || status === 403 || status === 401) {
                        // Error de clave (agotada, prohibida, inválida)
                        console.warn(`(Recolector) GNews Key #${currentGNewsKeyIndex + 1} falló (Error ${status}) para [${pais}]. Rotando clave...`);
                        currentGNewsKeyIndex = (currentGNewsKeyIndex + 1) % gnewsKeys.length; // Rota la clave
                        attempts++;
                        await sleep(2000); // Pausa antes de reintentar
                    } else {
                        // Otro error
                        console.error(`(Recolector) Error GNews [${pais}]: ${e.message}`);
                        erroresFetch.push(`GNews-${pais}`);
                        break; // Salir del 'while' y pasar al siguiente país
                    }
                }
            } // Fin del while
            
            await sleep(1000); // Pausa de 1 segundo entre países (GNews es más permisivo)
        }
        console.log(`(Recolector) -> Total Obtenidos (GNews + NewsData): ${articulosCrudos.length}.`);

        // --- PASO 3: DE-DUPLICACIÓN (Contra DB y contra la FILA actual) ---
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
        isFetchWorkerRunning = false; // Libera el bloqueo
    }
};
// ¡LA EXPORTAMOS!
exports.runNewsAPIFetch = runNewsAPIFetch;


/**
 * [PRIVADO] Esta es la ruta API que puedes llamar manually
 */
exports.syncNewsAPIs = async (req, res) => {
    res.json({ 
        message: "¡Trabajo de RECOLECCIÓN (con rotación de claves) iniciado! Añadiendo noticias a la fila en segundo plano."
    });
    runNewsAPIFetch();
};


// =============================================
// PARTE 2: EL WORKER DE NOTICIAS UNIFICADO (IA + TELEGRAM)
// (Esta parte no necesita cambios)
// =============================================

/**
 * [PRIVADO] Inicia el worker de Noticias
 */
exports.startNewsWorker = () => {
    if (isNewsWorkerRunning) {
        console.log("[News Worker] Ya está corriendo.");
        return;
    }
    console.log("[News Worker] Iniciando worker (IA -> DB -> Telegram c/11)...");
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
                // Fila vacía, esperamos 1 minuto
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
                    telegramPosted: false
                });
                
                await newArticle.save();
                console.log(`[News Worker] ¡Artículo guardado en DB! (${newArticle.titulo})`);

                // 6. LÓGICA DE TELEGRAM (CADA 11)
                articlesProcessedSinceLastTelegram++;
                
                if (articlesProcessedSinceLastTelegram >= 11) {
                    console.log(`[News Worker] ¡Artículo #${articlesProcessedSinceLastTelegram}! Enviando a Telegram...`);
                    await publicarUnArticulo(newArticle); 
                    articlesProcessedSinceLastTelegram = 0; // Reiniciar contador
                } else {
                    console.log(`[News Worker] Artículo #${articlesProcessedSinceLastTelegram}/11. (No se envía a Telegram).`);
                }
                
            } else {
                // Si la IA falla, lo descartamos
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
            // Esperamos 1 min antes de reintentar con el siguiente
            await sleep(1 * 60 * 1000);
        }
    }
}


// =============================================
// PARTE 3: RUTAS MANUALES Y SITEMAP
// (Sin cambios)
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
        
        const resultadoIA = await generateArticleContent({ enlaceOriginal, titulo });

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
            telegramPosted: false 
        });

        await newArticle.save();
        
        try {
            await publicarUnArticulo(newArticle);
            console.log("Artículo manual publicado en Telegram.");
        } catch (telegramError) {
            console.error("Artículo manual guardado, pero falló al enviar a Telegram:", telegramError.message);
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