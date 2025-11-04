const axios = require('axios');
const cheerio = require('cheerio');
const Game = require('../models/game');
// Eliminamos las importaciones de Bedrock, ya no se usan.

// --- 1. CONFIGURACIÓN DEL ROBOT ---
const BASE_URL = 'https://gamedistribution.com';
const LIST_PAGE_URL = `${BASE_URL}/games`;


/**
 * [INTERNO] Función de trabajo pesado para UN solo juego.
 * Esta función será llamada en paralelo.
 */
async function _processGame(link) {
    const gameSlug = link.split('/')[2];
    const detailUrl = `${BASE_URL}${link}`;
    const scraperApiKey = process.env.SCRAPER_API_KEY;

    // Filtramos URLs inválidas (como las de 'collectionID')
    if (!gameSlug || link.includes('?collectionID=')) {
        console.warn(`[OMITIENDO] URL inválida o de colección: ${link}`);
        return null; // Devolvemos null para que sea filtrado
    }

    try {
        // FASE 4A: Scrapear la página de detalle (¡Con renderizado!)
        const scraperDetailUrl = `http://api.scraperapi.com?api_key=${scraperApiKey}&url=${encodeURIComponent(detailUrl)}&render=true&wait=3000`;
        
        // Timeout de 30 segundos
        const detailResponse = await axios.get(scraperDetailUrl, { timeout: 30000 }); 
        const $$ = cheerio.load(detailResponse.data);

        // --- ¡¡FASE 4B: LA NUEVA LÓGICA (EXTRAER JSON)!! ---
        const jsonData = $$('script[id="__NEXT_DATA__"]').html();
        if (!jsonData) {
            console.error(`[FALLO JSON] No se encontró <script id="__NEXT_DATA__"> en ${detailUrl}`);
            return null;
        }
        
        const data = JSON.parse(jsonData);
        const gameData = data.props.pageProps.game;

        if (!gameData || !gameData.url || !gameData.title) {
             console.error(`[FALLO JSON] JSON incompleto o estructura cambiada en ${detailUrl}`);
             return null;
        }
        
        // --- Extraemos los datos de forma 100% fiable ---
        const title = gameData.title;
        const embedUrl = gameData.url; // Esta es la URL del iframe
        const thumbnailUrl = gameData.assets.cover; // ¡AQUÍ ESTÁ LA IMAGEN!
        const category = gameData.categories[0] || 'general'; // ¡AQUÍ ESTÁ LA CATEGORÍA!
        const shortDescription = gameData.description; // La descripción corta
        
        // --- FASE 4C: IA (DESACTIVADA) ---
        // (No hay llamada a la IA)

        console.log(`[ÉXITO] Datos extraídos para: ${title}. (Cat: ${category})`);

        // Devolvemos el objeto listo para 'bulkWrite'
        return {
            updateOne: {
                filter: { slug: gameSlug },
                update: {
                    $set: {
                        title: title,
                        slug: gameSlug,
                        description: shortDescription, // <-- Usamos la descripción corta
                        category: category,
                        thumbnailUrl: thumbnailUrl,
                        embedUrl: embedUrl.split('?')[0], // Limpiamos la URL del iframe
                        source: 'GameDistribution'
                    }
                },
                upsert: true
            }
        };

    } catch (err) {
        console.error(`Error fatal procesando ${detailUrl}: ${err.message}`);
        return null; // Devolvemos null si hay un error
    }
}


/**
 * [PRIVADO] Esta es la función que llama el usuario.
 * Solo "activa" el robot y responde inmediatamente.
 */
exports.syncGames = async (req, res) => {
    res.json({
        message: "¡Robot iniciado! El trabajo de scraping (Modo Rápido y SIN IA) ha comenzado."
    });
    _runSyncJob(); 
};


/**
 * [INTERNO] Esta es la función de trabajo pesado.
 * (Ahora es mucho más rápida)
 */
async function _runSyncJob() {
    console.log(`--- INICIANDO SYNC DE JUEGOS (IA DESACTIVADA) ---`);
    const scraperApiKey = process.env.SCRAPER_API_KEY;

    if (!scraperApiKey) {
        console.error("No se encontró la clave de SCRAPER_API_KEY en .env");
        return; 
    }

    // --- FASE 1: SCRAPING (Obtener la lista de juegos) ---
    let htmlContent;
    try {
        const scraperUrl = `http://api.scraperapi.com?api_key=${scraperApiKey}&url=${encodeURIComponent(LIST_PAGE_URL)}&render=true&wait=3000`;
        console.log(`Llamando a ScraperAPI (Modo Renderizado) para la lista: ${LIST_PAGE_URL}`);
        const response = await axios.get(scraperUrl, { timeout: 60000 }); 
        htmlContent = response.data;
        console.log(`ScraperAPI trajo el HTML (Renderizado) de la LISTA exitosamente.`);
    } catch (error) {
        console.error("Error al llamar a ScraperAPI (Fase 1: Lista):", error.message);
        return; 
    }

    // --- FASE 2: PARSEO (Leer la lista de juegos) ---
    let gameLinks = [];
    try {
        const $ = cheerio.load(htmlContent);
        $('a[href^="/games/"]').each((i, el) => {
            const href = $(el).attr('href');
            if (href && !gameLinks.includes(href) && href !== '/games') {
                gameLinks.push(href);
            }
        });
        gameLinks = gameLinks.slice(0, 20); 
        console.log(`Scraping encontró ${gameLinks.length} links de juegos en la página.`);
    } catch (e) {
         console.error("Error al parsear la lista con Cheerio:", e.message);
         return; 
    }
    
    if (gameLinks.length === 0) {
        console.log("Scraping no encontró links de juegos. El selector de Cheerio puede estar desactualizado.");
        return; 
    }

    // --- FASE 3: DE-DUPLICACIÓN (Ahorro de créditos) ---
    const allSlugs = gameLinks.map(link => link.split('/')[2]).filter(Boolean); 
    const existingGames = await Game.find({ slug: { $in: allSlugs } }).select('slug');
    const existingSlugs = new Set(existingGames.map(g => g.slug));
    const newGameLinks = gameLinks.filter(link => {
        const slug = link.split('/')[2];
        return slug && !existingSlugs.has(slug);
    });

    console.log(`De ${gameLinks.length} juegos, ${newGameLinks.length} son NUEVOS.`);

    if (newGameLinks.length === 0) {
        console.log("¡Éxito! No se encontraron juegos nuevos.");
        return; 
    }

    // --- FASE 4: SCRAPING (¡¡EN PARALELO!!) ---
    console.log(`Iniciando scrapeo de detalles para ${newGameLinks.length} juegos... (Modo Paralelo y SIN IA)`);
    
    // Creamos un array de promesas, una por cada juego
    const gamePromises = newGameLinks.map(_processGame);
    
    // Esperamos a que TODAS las promesas terminen
    const results = await Promise.all(gamePromises);

    // Filtramos los resultados que fallaron (los que devolvieron 'null')
    const operations = results.filter(Boolean); // 'Boolean' filtra 'null' y 'undefined'

    // --- FASE 5: GUARDAR EN LA BASE DE DATOS ---
    if (operations.length > 0) {
        console.log(`Guardando ${operations.length} juegos nuevos en la DB...`);
        const result = await Game.bulkWrite(operations);
        
        console.log("--- ¡SINCRONIZACIÓN COMPLETADA! ---");
        console.log({
            message: "¡Sincronización de juegos (SIN IA) completada!",
            totalEncontrados: gameLinks.length,
            totalNuevos: newGameLinks.length,
            totalGuardadosEnDB: result.upsertedCount,
            totalFallidos: newGameLinks.length - operations.length
        });
    } else {
        console.log("Se encontraron juegos nuevos, pero hubo un error al extraer detalles para TODOS ellos.");
        console.log("[INSTRUCCIÓN] Revisa los logs de [FALLO] de arriba.");
    }
};