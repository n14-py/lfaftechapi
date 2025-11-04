const axios = require('axios');
const cheerio = require('cheerio');
const Game = require('../models/game');
// No se necesita Bedrock

// --- 1. CONFIGURACIÓN DEL ROBOT ---
const BASE_URL = 'https://gamedistribution.com';
const LIST_PAGE_URL = `${BASE_URL}/games`;
// Función helper para añadir pausas
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * [INTERNO] Función de trabajo pesado para UN solo juego.
 * (Esta función ya no se exporta, se usa internamente)
 */
async function _processGame(link, gameSlug) {
    const detailUrl = `${BASE_URL}${link}`;
    const scraperApiKey = process.env.SCRAPER_API_KEY;

    try {
        // FASE 4A: Scrapear la página de detalle (¡Con renderizado!)
        const scraperDetailUrl = `http://api.scraperapi.com?api_key=${scraperApiKey}&url=${encodeURIComponent(detailUrl)}&render=true&wait=3000`;
        
        // Timeout de 30 segundos
        const detailResponse = await axios.get(scraperDetailUrl, { timeout: 30000 }); 
        const $$ = cheerio.load(detailResponse.data);

        // Variables para guardar los datos
        let title, embedUrl, thumbnailUrl, category, shortDescription;

        // --- FASE 4B: LÓGICA HÍBRIDA (INTELIGENTE) ---

        // --- INTENTO 1: Método JSON (El mejor) ---
        const jsonData = $$('script[id="__NEXT_DATA__"]').html();
        if (jsonData) {
            try {
                const data = JSON.parse(jsonData);
                const gameData = data.props.pageProps.game;

                if (gameData && gameData.url && gameData.title) {
                    title = gameData.title;
                    embedUrl = gameData.url;
                    thumbnailUrl = gameData.assets.cover;
                    category = gameData.categories[0] || 'general';
                    shortDescription = gameData.description;
                    console.log(`[ÉXITO JSON] Datos extraídos para: ${title}`);
                }
            } catch (e) {
                console.warn(`[AVISO] JSON corrupto en ${detailUrl}. Usando fallback.`);
            }
        }

        // --- INTENTO 2: Método HTML (Fallback) ---
        // Si el JSON falló, usamos tu idea de rellenar con lo que podamos
        
        if (!embedUrl) {
            // Si el JSON falló, buscamos el iframe en el HTML
            const embedText = $$("*:contains('<iframe src=\"https://html5.gamedistribution.com')").text();
            if (embedText) {
                const match = embedText.match(/src="([^"]+)"/);
                if (match && match[1]) {
                    embedUrl = match[1];
                }
            }
        }

        // Verificación final: Si NO hay URL de embed, el juego no sirve.
        if (!embedUrl) {
            console.error(`[FALLO FATAL] No se pudo encontrar embedUrl (ni JSON ni HTML) para ${detailUrl}.`);
            return null;
        }

        // Si no tenemos título (del JSON), usamos el slug
        if (!title) {
            title = gameSlug.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
        }
        
        // Si no tenemos el resto (del JSON), lo buscamos en meta tags
        if (!thumbnailUrl) {
            thumbnailUrl = $$('meta[property="og:image"]').attr('content') || '';
        }
        if (!category) {
            category = 'general';
        }
        if (!shortDescription) {
            shortDescription = $$('meta[name="description"]').attr('content') || `Juega ${title} ahora.`;
        }
        
        // Devolvemos el objeto listo para 'bulkWrite'
        return {
            updateOne: {
                filter: { slug: gameSlug },
                update: {
                    $set: {
                        title: title,
                        slug: gameSlug,
                        description: shortDescription,
                        category: category,
                        thumbnailUrl: thumbnailUrl,
                        embedUrl: embedUrl.split('?')[0],
                        source: 'GameDistribution'
                    }
                },
                upsert: true
            }
        };

    } catch (err) {
        console.error(`Error fatal procesando ${detailUrl}: ${err.message}`);
        return null;
    }
}


/**
 * [PRIVADO] Esta es la función que llama el usuario.
 * Solo "activa" el robot y responde inmediatamente.
 */
exports.syncGames = async (req, res) => {
    res.json({
        message: "¡Robot iniciado! El trabajo de scraping (Modo Lento y Seguro) ha comenzado."
    });
    _runSyncJob(); 
};


/**
 * [INTERNO] Esta es la función de trabajo pesado.
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

    // --- FASE 4: SCRAPING (¡¡EN SERIE: LENTO Y SEGURO!!) ---
    console.log(`Iniciando scrapeo de detalles para ${newGameLinks.length} juegos... (Modo Lento y Seguro)`);
    
    let operations = [];

    // Usamos un bucle 'for...of' para ir UNO POR UNO
    for (const link of newGameLinks) {
        
        const gameSlug = link.split('/')[2];
        
        // Filtramos URLs inválidas (como las de 'collectionID')
        if (!gameSlug || link.includes('?collectionID=')) {
            console.warn(`[OMITIENDO] URL inválida o de colección: ${link}`);
            continue;
        }

        console.log(`Procesando juego: ${gameSlug}...`);
        const result = await _processGame(link, gameSlug);

        if (result) {
            operations.push(result);
        }

        // --- ¡¡LA CLAVE PARA EVITAR EL 429!! ---
        // Pausamos 3 segundos ANTES de pedir el siguiente juego.
        await sleep(3000); 
    }

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
            totalFallidos: newGameLinks.length - operations.length - (gameLinks.length - newGameLinks.length) // Ajustamos el conteo de fallidos
        });
    } else {
        console.log("Se encontraron juegos nuevos, pero hubo un error al extraer detalles para TODOS ellos.");
        console.log("[INSTRUCCIÓN] Revisa los logs de [FALLO] de arriba.");
    }
};