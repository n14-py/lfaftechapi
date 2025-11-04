const axios = require('axios');
const Article = require('../models/article');

// --- CARGAMOS LAS 5 API KEYS DE DEEPSEEK ---
const DEEPSEEK_API_KEYS = [
    process.env.DEEPSEEK_API_KEY_1,
    process.env.DEEPSEEK_API_KEY_2,
    process.env.DEEPSEEK_API_KEY_3,
    process.env.DEEPSEEK_API_KEY_4,
    process.env.DEEPSEEK_API_KEY_5,
].filter(Boolean);

// --- CLAVES DE API ---
const API_KEY_GNEWS = process.env.GNEWS_API_KEY;
const API_KEY_NEWSDATA = process.env.NEWSDATA_API_KEY;

// --- LÍMITES DE API (10 por país) ---
const MAX_ARTICLES_PER_COUNTRY = 10; 

// --- MAPA DE TRADUCCIÓN DE NEWSDATA.IO ---
const paisNewsDataMap = {
    "argentina": "ar", "bolivia": "bo", "brazil": "br", "chile": "cl", 
    "colombia": "co", "costa rica": "cr", "cuba": "cu", "ecuador": "ec", 
    "el salvador": "sv", "guatemala": "gt", "honduras": "hn", "mexico": "mx", 
    "nicaragua": "ni", "panama": "pa", "paraguay": "py", "peru": "pe", 
    "dominican republic": "do", "uruguay": "uy", "venezuela": "ve"
};

// --- Lista de 19 países de LATAM para NEWSDATA.IO ---
const PAISES_NEWSDATA = [
    "ar", "bo", "br", "cl", "co", "cr", "cu", "ec", "sv", 
    "gt", "hn", "mx", "ni", "pa", "py", "pe", "do", "uy", "ve"
];

// --- Lista de 10 países de LATAM para GNEWS ---
const PAISES_GNEWS = [
    "ar", "br", "cl", "co", "ec", "mx", "pe", "py", "uy", "ve"
];

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Llama a la API de DeepSeek.
 * --- ¡VERSIÓN ACTUALIZADA (PLAN D)! ---
 * --- ¡USA URL PERO PIDE TEXTO PLANO CON FORMATO ESTRICTO! ---
 * (Esta función no cambia)
 */
async function getAIArticle(articleUrl, apiKey) {
    if (!articleUrl || !articleUrl.startsWith('http')) return null;
    if (!apiKey) {
        console.error("Error: No se proporcionó una API key de DeepSeek.");
        return null;
    }
    const API_URL = 'https://api.deepseek.com/v1/chat/completions';
    const headers = {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
    };
    
    // --- 1. PROMPT DE SISTEMA (NUEVO) ---
    // Volvemos al prompt original, pero con una regla de formato
    const systemPrompt = `Eres un reportero senior para 'Noticias.lat'. Tu trabajo es analizar una URL y devolver un artículo completo.
Tu respuesta DEBE tener el siguiente formato estricto:
LÍNEA 1: La categoría (UNA SOLA PALABRA de esta lista: politica, economia, deportes, tecnologia, entretenimiento, salud, internacional, general).
LÍNEA 2 (Y SIGUIENTES): El artículo de noticias completo, extenso y profesional (idealmente +500 palabras).
NO USES JSON. NO USES MARKDOWN. NO AÑADAS TEXTO ADICIONAL.`;

    // --- 2. PROMPT DE USUARIO (NUEVO) ---
    const userPrompt = `Analiza el contenido de este enlace y redáctalo desde cero. Recuerda el formato:
Línea 1: solo la categoría.
Línea 2 en adelante: el artículo.
URL: ${articleUrl}`;
    
    const body = {
        model: "deepseek-chat",
        messages: [ { role: "system", content: systemPrompt }, { role: "user", content: userPrompt } ]
    };
    
    try {
        const response = await axios.post(API_URL, body, { headers });
        
        // --- 3. LÓGICA DE PARSEO (¡NUEVA!) ---
        if (response.data.choices && response.data.choices.length > 0) {
            
            let responseText = response.data.choices[0].message.content;

            try {
                // Dividimos la respuesta por el primer salto de línea
                const lines = responseText.split('\n');
                
                if (lines.length < 2) {
                    // Si la IA no siguió el formato (ej: "Lo siento, no puedo acceder...")
                    console.error(`Error: IA no siguió formato (Respuesta: ${responseText}) para ${articleUrl}`);
                    return null;
                }

                // LÍNEA 1: La categoría
                let categoriaSugerida = lines[0].trim().toLowerCase();
                
                // LÍNEA 2 Y SIGUIENTES: El artículo
                let articuloGenerado = lines.slice(1).join('\n').trim();

                // Verificamos si la categoría es válida
                const categoriasValidas = ["politica", "economia", "deportes", "tecnologia", "entretenimiento", "salud", "internacional", "general"];
                if (!categoriasValidas.includes(categoriaSugerida)) {
                     // Si la IA puso texto inválido, forzamos "general" y asumimos que la respuesta entera es el artículo
                     console.warn(`Categoría no válida: "${categoriaSugerida}" para ${articleUrl}. Forzando a 'general'.`);
                     categoriaSugerida = "general";
                     articuloGenerado = responseText; // Usamos la respuesta completa como artículo
                }
                
                // Si el artículo está vacío (quizás solo devolvió la categoría)
                if (!articuloGenerado) {
                    console.error(`Error: IA devolvió categoría pero no artículo para ${articleUrl}`);
                    return null;
                }

                // ¡ÉXITO! Devolvemos ambas cosas.
                return {
                    categoriaSugerida: categoriaSugerida,
                    articuloGenerado: articuloGenerado,
                    originalArticle: articleUrl
                };

            } catch (e) {
                console.error(`Error al parsear respuesta de IA para ${articleUrl}:`, e.message);
                console.log("Respuesta recibida:", responseText);
                return null;
            }
        }
        return null;
    } catch (error) {
        // Este es el error que estabas viendo: "Invalid URL"
        // Lo más probable es que sea un error de red o un bloqueo de DeepSeek
        console.error(`Error en axios.post para ${articleUrl} (API Key ${apiKey.substring(0, 5)}...):`, error.message);
        return null; 
    }
}


/**
 * [PRIVADO] Sincronizar Noticias
 * --- ¡VERSIÓN OPTIMIZADA CON AHORRO DE CRÉDITOS! ---
 */
exports.syncGNews = async (req, res) => {
    try {
        if (DEEPSEEK_API_KEYS.length === 0) {
            return res.status(500).json({ error: "No hay API keys de DeepSeek configuradas." });
        }
        if (!API_KEY_GNEWS || !API_KEY_NEWSDATA) {
            return res.status(500).json({ error: "Faltan GNEWS_API_KEY o NEWSDATA_API_KEY en el .env" });
        }
        console.log(`Iniciando sync OPTIMIZADO con ${DEEPSEEK_API_KEYS.length} keys de IA.`);

        let erroresFetch = [];
        let articulosParaIA = []; // Esta es la lista total de APIs
        let totalObtenidosNewsData = 0;
        let totalObtenidosGNews = 0;
        
        // --- PASO 1: NEWSDATA.IO (Bucle de 19 llamadas) ---
        console.log(`Paso 1: Obteniendo noticias de NewsData.io en ${PAISES_NEWSDATA.length} llamadas...`);
        
        for (const pais of PAISES_NEWSDATA) {
             try {
                const urlNewsData = `https://newsdata.io/api/1/news?apikey=${API_KEY_NEWSDATA}&country=${pais}&language=es,pt&size=${MAX_ARTICLES_PER_COUNTRY}`;
                const response = await axios.get(urlNewsData);
                
                if (response.data.results) {
                    response.data.results.forEach(article => {
                        // Evitar artículos sin título o URL
                        if (!article.title || !article.link) return;
                        
                        const paisNombreCompleto = article.country[0];
                        const paisCodigo = paisNewsDataMap[paisNombreCompleto.toLowerCase()] || paisNombreCompleto;
                        
                        articulosParaIA.push({
                            title: article.title,
                            description: article.description || 'Sin descripción.',
                            image: article.image_url,
                            source: { name: article.source_id || 'Fuente Desconocida' },
                            url: article.link,
                            publishedAt: article.pubDate,
                            categoriaLocal: 'general',
                            paisLocal: paisCodigo
                        });
                    });
                    const count = response.data.results.length;
                    totalObtenidosNewsData += count;
                    console.log(`-> [NewsData] ${pais.toUpperCase()}: Obtenidos ${count} artículos.`);
                }
            } catch (newsDataError) {
                console.error(`Error al llamar a NewsData.io para [${pais}]: ${newsDataError.message}`);
                erroresFetch.push(`NewsData.io-${pais} (${newsDataError.response?.status})`);
            }
            await sleep(1000); 
        }
        console.log(`-> Total Obtenidos NewsData.io: ${totalObtenidosNewsData}.`);


        // --- PASO 2: GNEWS (Bucle de 10 llamadas) ---
        console.log(`Paso 2: Obteniendo noticias de GNews en ${PAISES_GNEWS.length} llamadas...`);
        
        for (const pais of PAISES_GNEWS) {
             try {
                const urlGNews = `https://gnews.io/api/v4/top-headlines?country=${pais}&lang=es&max=${MAX_ARTICLES_PER_COUNTRY}&apikey=${API_KEY_GNEWS}`;
                const response = await axios.get(urlGNews);
                
                response.data.articles.forEach(article => {
                    // GNews a veces trae artículos sin título o URL
                    if (!article.title || !article.url) return;
                    
                    articulosParaIA.push({ 
                        ...article,
                        categoriaLocal: 'general',
                        paisLocal: pais
                    });
                });
                const count = response.data.articles.length;
                totalObtenidosGNews += count;
                console.log(`-> [GNews] ${pais.toUpperCase()}: Obtenidos ${count} artículos.`);
                
            } catch (gnewsError) {
                console.error(`Error al llamar a GNews para [${pais}]: ${gnewsError.message}`);
                erroresFetch.push(`GNews-${pais}`);
            }
            await sleep(1000);
        }
        console.log(`-> Total Obtenidos GNews: ${totalObtenidosGNews}.`);
        console.log(`--- TOTAL: ${articulosParaIA.length} artículos obtenidos de las APIs.`);

        // --- ¡¡NUEVO PASO 3: DE-DUPLICACIÓN!! ---
        // Antes de gastar en IA, vemos cuáles ya tenemos
        console.log(`Paso 3: Verificando duplicados contra la base de datos...`);
        
        // 3a. Sacamos todas las URLs que recibimos
        const urlsRecibidas = articulosParaIA.map(article => article.url);
        
        // 3b. Buscamos en la DB solo las URLs que coincidan (y solo traemos el enlace)
        const articulosExistentes = await Article.find({ 
            enlaceOriginal: { $in: urlsRecibidas } 
        }).select('enlaceOriginal'); // .select() lo hace súper rápido

        // 3c. Creamos un Set (un objeto de búsqueda rápida) con las URLs que YA TENEMOS
        const urlsExistentes = new Set(articulosExistentes.map(a => a.enlaceOriginal));

        // 3d. Filtramos la lista, quedándonos SÓLO con los artículos que NO ESTÁN en el Set
        const articulosNuevosParaIA = articulosParaIA.filter(article => !urlsExistentes.has(article.url));
        
        console.log(`-> ${urlsExistentes.size} artículos ya existen. ${articulosNuevosParaIA.length} artículos son NUEVOS y se enviarán a la IA.`);

        // --- PASO 4: IA (CLASIFICACIÓN Y GENERACIÓN) ---
        console.log(`Paso 4: Iniciando generación de IA para ${articulosNuevosParaIA.length} artículos...`);
        
        // ¡¡IMPORTANTE: Ahora mapeamos la lista FILTRADA!!
        const promesasDeArticulos = articulosNuevosParaIA.map((article, index) => {
            const apiKeyParaUsar = DEEPSEEK_API_KEYS[index % DEEPSEEK_API_KEYS.length];
            
            // ¡Llamamos a la nueva función de parseo de texto!
            return getAIArticle(article.url, apiKeyParaUsar)
                .then(resultadoIA => {
                    // resultadoIA es { categoriaSugerida, articuloGenerado, ... }
                    return { ...article, ...resultadoIA };
                });
        });

        const resultadosCompletos = await Promise.all(promesasDeArticulos);
        
        const articulosValidosIA = resultadosCompletos.filter(r => r && r.articuloGenerado && r.categoriaSugerida && r.url);
        
        console.log(`-> ${articulosValidosIA.length} artículos procesados y clasificados por IA.`);


        // --- PASO 5: Base de Datos ---
        const operations = articulosValidosIA.map(article => ({
            updateOne: {
                filter: { enlaceOriginal: article.url }, 
                update: {
                    $set: {
                        titulo: article.title,
                        descripcion: article.description || 'Sin descripción.',
                        imagen: article.image,
                        sitio: 'noticias.lat',
                        categoria: article.categoriaSugerida, // Categoría de la IA
                        pais: article.paisLocal,
                        fuente: article.source.name,
                        enlaceOriginal: article.url,
                        fecha: new Date(article.publishedAt),
                        articuloGenerado: article.articuloGenerado // Artículo de la IA
                    }
                },
                upsert: true 
            }
        }));

        // --- PASO 6: Guardar ---
        let totalArticulosNuevos = 0;
        let totalArticulosActualizados = 0;
        
        if (operations.length > 0) {
            console.log(`Paso 5: Guardando ${operations.length} artículos NUEVOS en la base de datos...`);
            const result = await Article.bulkWrite(operations);
            totalArticulosNuevos = result.upsertedCount;
            totalArticulosActualizados = result.modifiedCount; // Este número ahora debería ser 0
        }

        console.log("¡Sincronización con AHORRO DE IA completada!");
        
        // --- PASO 7: Respuesta (Reporte Detallado) ---
        res.json({ 
            message: "Sincronización con AHORRO DE IA completada.",
            reporte: {
                totalObtenidosNewsData: totalObtenidosNewsData,
                totalObtenidosGNews: totalObtenidosGNews,
                totalArticulosRecibidos: articulosParaIA.length,
                totalArticulosYaExistentes: urlsExistentes.size,
                totalArticulosNuevosParaIA: articulosNuevosParaIA.length,
                totalProcesadosIA_Exitosos: articulosValidosIA.length,
                totalFallidosIA: articulosNuevosParaIA.length - articulosValidosIA.length,
                nuevosArticulosGuardadosEnDB: totalArticulosNuevos,
                articulosActualizadosEnDB: totalArticulosActualizados, // ¡Esto ya no debería pasar!
                apisConError: erroresFetch
            }
        });

    } catch (error) {
        console.error("Error catastrófico en syncGNews (Clasificación IA Texto Plano):", error.message);
        // --- ¡AQUÍ ESTÁ LA LÍNEA CORREGIDA! ---
        res.status(500).json({ error: "Error al sincronizar (Clasificación IA Texto Plano)." });
    }
};

/**
 * [PRIVADO] Añadir un nuevo artículo manualmente
 * (Actualizado para usar la clasificación IA de Texto Plano)
 * (Esta función no cambia)
 */
exports.createManualArticle = async (req, res) => {
    try {
        if (DEEPSEEK_API_KEYS.length === 0) {
            return res.status(500).json({ error: "No hay API keys de DeepSeek configuradas." });
        }
        
        const { titulo, descripcion, imagen, sitio, fuente, enlaceOriginal, fecha, pais } = req.body;
        
        // El enlace original es OBLIGATORIO para esta función
        if (!enlaceOriginal || !enlaceOriginal.startsWith('http')) {
             return res.status(400).json({ error: "El 'enlaceOriginal' (URL) es obligatorio para que la IA trabaje." });
        }
        
        // Llamamos a la IA para que genere y CLASIFIQUE usando la URL
        const resultadoIA = await getAIArticle(enlaceOriginal, DEEPSEEK_API_KEYS[0]);

        if (!resultadoIA) {
            return res.status(500).json({ error: "La IA no pudo procesar la URL proporcionada." });
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
            categoria: resultadoIA.categoriaSugerida
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
 * (Se añade al final de articleController.js)
 * (Esta función no cambia)
 */
exports.getSitemap = async (req, res) => {
    // ¡IMPORTANTE! Cambia esto por la URL real de tu sitio web
    const BASE_URL = 'https://noticias.lat'; 

    try {
        // 1. Obtenemos todos los artículos de la DB
        // Solo necesitamos el ID y la fecha para el sitemap
        const articles = await Article.find()
            .sort({ fecha: -1 })
            .select('_id fecha');
        
        let xml = '<?xml version="1.0" encoding="UTF-8"?>';
        xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">';

        // 2. Añadir Páginas Estáticas (Homepage, Contacto, etc.)
        const staticPages = [
            { loc: '', priority: '1.00', changefreq: 'daily' }, // Homepage
            { loc: 'sobre-nosotros.html', priority: '0.80', changefreq: 'monthly' },
            { loc: 'contacto.html', priority: '0.80', changefreq: 'monthly' },
            { loc: 'politica-privacidad.html', priority: '0.50', changefreq: 'yearly' },
            { loc: 'terminos.html', priority: '0.50', changefreq: 'yearly' },
        ];

        staticPages.forEach(page => {
            xml += '<url>';
            xml += `<loc>${BASE_URL}/${page.loc}</loc>`;
            xml += `<priority>${page.priority}</priority>`;
            xml += `<changefreq>${page.changefreq}</changefreq>`;
            xml += '</url>';
        });

        // 3. Añadir todos los Artículos (Dinámicos)
        articles.forEach(article => {
            const articleDate = new Date(article.fecha).toISOString().split('T')[0];
            xml += '<url>';
            // URL del artículo en el frontend
            xml += `<loc>${BASE_URL}/articulo.html?id=${article._id}</loc>`; 
            xml += `<lastmod>${articleDate}</lastmod>`;
            xml += '<changefreq>weekly</changefreq>'; // Puedes cambiar a 'daily' si actualizas artículos
            xml += '<priority>0.90</priority>';
            xml += '</url>';
        });

        xml += '</urlset>';

        // 4. Enviar el XML
        res.header('Content-Type', 'application/xml');
        res.send(xml);

    } catch (error) {
        console.error("Error en getSitemap:", error);
        res.status(500).json({ error: "Error interno del servidor." });
    }
};