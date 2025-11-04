const axios = require('axios');
const cheerio = require('cheerio');
const Game = require('../models/game');
// IA Desactivada = No más importaciones de Bedrock

// --- 1. CONFIGURACIÓN DEL ROBOT ---
const BASE_URL = 'https://gamedistribution.com';
const LIST_PAGE_URL = `${BASE_URL}/games`;

// Función helper para añadir pausas (¡LA CLAVE ANTI-BLOQUEO!)
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * [INTERNO] Función de trabajo pesado para UN solo juego.
 * Esta es la parte "inteligente" que se recupera de fallos.
 */
async function _processGameDetail(link, gameSlug, initialImageUrl) {
    const detailUrl = `${BASE_URL}${link}`;
    const scraperApiKey = process.env.SCRAPER_API_KEY;

    try {
        // FASE 4A: Scrapear la página de detalle (¡Con renderizado!)
        const scraperDetailUrl = `http://api.scraperapi.com?api_key=${scraperApiKey}&url=${encodeURIComponent(detailUrl)}&render=true&wait=4000`;
        
        // Timeout de 60 segundos
        const detailResponse = await axios.get(scraperDetailUrl, { timeout: 60000 }); 
        const $$ = cheerio.load(detailResponse.data);

        // Variables para guardar los datos
        let title, embedUrl, thumbnailUrl, category, description;
        let languages = [], genders = [], ageGroups = [];
        
        // Asignamos los datos que ya tenemos
        thumbnailUrl = initialImageUrl; // La imagen que sacamos de la lista
        const sourceUrl = detailUrl;    // La URL privada que pediste

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
                    // Si el JSON tiene una imagen mejor (cover), la usamos
                    if (gameData.assets && gameData.assets.cover) {
                        thumbnailUrl = gameData.assets.cover;
                    }
                    category = gameData.categories[0] || 'general';
                    // ¡LA DESCRIPCIÓN REAL!
                    description = gameData.description; 
                    
                    // ¡LOS DATOS EXTRA QUE PEDISTE!
                    languages = gameData.languages || [];
                    genders = gameData.genders || [];
                    ageGroups = gameData.ageGroups || [];
                    
                    console.log(`[ÉXITO JSON] Datos extraídos para: ${title}`);
                }
            } catch (e) {
                console.warn(`[AVISO] JSON corrupto en ${detailUrl}. Usando fallback HTML.`);
            }
        }

        // --- INTENTO 2: Método HTML (Fallback o "Recuperación") ---
        // Si el JSON falló, usamos scraping de texto
        
        // 1. Buscar Embed (Crítico)
        if (!embedUrl) {
            const embedText = $$("*:contains('<iframe src=\"https://html5.gamedistribution.com')").text();
            if (embedText) {
                const match = embedText.match(/src="([^"]+)"/);
                if (match && match[1]) {
                    embedUrl = match[1];
                    console.log(`[FALLBACK] embedUrl encontrado en HTML.`);
                }
            }
        }

        // Verificación final: Si NO hay URL de embed, el juego no sirve.
        if (!embedUrl) {
            throw new Error(`[FALLO FATAL] No se pudo encontrar embedUrl (ni JSON ni HTML) para ${detailUrl}.`);
        }

        // 2. Buscar Título (Si falta)
        if (!title) {
            title = gameSlug.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
        }
        
        // 3. Buscar Categoría (Si falta)
        if (!category) {
            category = 'general';
        }

        // 4. Buscar Descripción Real (Si falta)
        if (!description) {
            let descNode = $$("h2:contains('DESCRIPTION')").next();
            if (!descNode.length) {
                descNode = $$("h2:contains('DESCRIPCIÓN')").next();
            }
            
            if (descNode.is('p')) {
                description = descNode.text();
                console.log(`[FALLBACK] Descripción real encontrada en HTML.`);
            } else {
                // Último recurso (la descripción que no te gusta, pero es mejor que nada)
                description = $$('meta[name="description"]').attr('content') || `Juega ${title} ahora.`;
            }
        }
        
        // Devolvemos el objeto listo para 'bulkWrite'
        return {
            updateOne: {
                filter: { slug: gameSlug },
                update: {
                    $set: {
                        title: title,
                        slug: gameSlug,
                        description: description,
                        category: category,
                        thumbnailUrl: thumbnailUrl,
                        embedUrl: embedUrl.split('?')[0],
                        source: 'GameDistribution',
                        sourceUrl: sourceUrl, // Guardamos la URL privada
                        languages: languages,
                        genders: genders,
                        ageGroups: ageGroups
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
        message: "¡Robot PODEROSO iniciado! El trabajo de scraping (Modo Súper Lento y Seguro) ha comenzado."
    });
    // ¡Llama al robot real SIN await para que se ejecute en segundo plano!
    _runSyncJob(); 
};


/**
 * [INTERNO] Esta es la función de trabajo pesado.
 */
async function _runSyncJob() {
    console.log(`--- INICIANDO SYNC DE JUEGOS (MODO PODEROSO) ---`);
    const scraperApiKey = process.env.SCRAPER_API_KEY;

    if (!scraperApiKey) {
        console.error("No se encontró la clave de SCRAPER_API_KEY en .env");
        return; 
    }

    // --- FASE 1: SCRAPING (Obtener la lista de juegos + IMÁGENES) ---
    let gamesToProcess = []; // Lista de objetos { link, imageUrl }
    try {
        const scraperUrl = `http://api.scraperapi.com?api_key=${scraperApiKey}&url=${encodeURIComponent(LIST_PAGE_URL)}&render=true&wait=5000`;
        console.log(`Llamando a ScraperAPI (Modo Renderizado + 5s) para la lista: ${LIST_PAGE_URL}`);
        
        // Damos 90 segundos a esta primera llamada, es la más pesada
        const response = await axios.get(scraperUrl, { timeout: 90000 }); 
        const $ = cheerio.load(response.data);

        // Buscamos los links (como antes)
        $('a[href^="/games/"]').each((i, el) => {
            const link = $(el).attr('href');
            if (!link || link.includes('?collectionID=') || link === '/games') {
                return; // Omitimos colecciones o links inválidos
            }

            // ¡TU SOLICITUD! Buscamos la imagen DENTRO del link
            const imageUrl = $(el).find('img').attr('src');
            
            // Solo añadimos si tiene link e imagen
            if (link && imageUrl) {
                // Evitamos duplicados
                if (!gamesToProcess.find(g => g.link === link)) {
                    gamesToProcess.push({
                        link: link,
                        imageUrl: imageUrl
                    });
                }
            }
        });
        
        gamesToProcess = gamesToProcess.slice(0, 20); // Tomamos solo 20
        console.log(`Scraping encontró ${gamesToProcess.length} juegos (con imagen) en la página de lista.`);

    } catch (error) {
        console.error("Error al llamar a ScraperAPI (Fase 1: Lista):", error.message);
        return; 
    }

    if (gamesToProcess.length === 0) {
        console.log("Scraping no encontró juegos. El selector de Cheerio puede estar desactualizado.");
        return; 
    }

    // --- FASE 3: DE-DUPLICACIÓN (Ahorro de créditos) ---
    const allSlugs = gamesToProcess.map(g => g.link.split('/')[2]).filter(Boolean); 
    const existingGames = await Game.find({ slug: { $in: allSlugs } }).select('slug');
    const existingSlugs = new Set(existingGames.map(g => g.slug));
    
    const newGamesToProcess = gamesToProcess.filter(g => {
        const slug = g.link.split('/')[2];
        return slug && !existingSlugs.has(slug);
    });

    console.log(`De ${gamesToProcess.length} juegos, ${newGamesToProcess.length} son NUEVOS.`);

    if (newGamesToProcess.length === 0) {
        console.log("¡Éxito! No se encontraron juegos nuevos.");
        return; 
    }

    // --- FASE 4: SCRAPING (¡¡EN SERIE: LENTO Y SEGURO!!) ---
    console.log(`Iniciando scrapeo de detalles para ${newGamesToProcess.length} juegos... (Modo Lento y Seguro)`);
    
    let operations = [];
    let failedCount = 0;

    // Usamos un bucle 'for...of' para ir UNO POR UNO
    for (const game of newGamesToProcess) {
        
        const gameSlug = game.link.split('/')[2];
        
        // ¡LA PAUSA ANTI-BLOQUEO!
        console.log(`Pausando 5 segundos para evitar bloqueo...`);
        await sleep(5000); 

        console.log(`Procesando juego: ${gameSlug}...`);
        
        // Le pasamos el link, el slug, y la URL de la imagen que ya encontramos
        const result = await _processGameDetail(game.link, gameSlug, game.imageUrl);

        if (result) {
            operations.push(result);
        } else {
            failedCount++; // Si _processGame devuelve null, es un fallo
        }
    }

    // --- FASE 5: GUARDAR EN LA BASE DE DATOS ---
    if (operations.length > 0) {
        console.log(`Guardando ${operations.length} juegos nuevos en la DB...`);
        const result = await Game.bulkWrite(operations);
        
        console.log("--- ¡SINCRONIZACIÓN COMPLETADA! ---");
        console.log({
            message: "¡Sincronización de juegos (Modo Poderoso) completada!",
            totalEncontrados: gamesToProcess.length,
            totalNuevos: newGamesToProcess.length,
            totalGuardadosEnDB: result.upsertedCount,
            totalFallidos: failedCount
        });
    } else {
        console.log("Se encontraron juegos nuevos, pero hubo un error al extraer detalles para TODOS ellos.");
        console.log("[INSTRUCCIÓN] Revisa los logs de [FALLO FATAL] de arriba.");
    }
};