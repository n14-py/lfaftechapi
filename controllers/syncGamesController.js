const axios = require('axios');
const cheerio = require('cheerio');
const Game = require('../models/game');

// --- 1. CONFIGURACIÓN DEL ROBOT ---
const BASE_URL = 'https://gamedistribution.com';
const START_PAGE = `${BASE_URL}/games`; 

// --- ¡NUEVO! CARGA DE MÚLTIPLES CLAVES API (hasta 5 o más si las añades al .env) ---
const SCRAPER_API_KEYS = [
    process.env.SCRAPER_API_KEY,
    process.env.SCRAPER_API_KEY_1,
    process.env.SCRAPER_API_KEY_2,
    process.env.SCRAPER_API_KEY_3,
    process.env.SCRAPER_API_KEY_4,
    process.env.SCRAPER_API_KEY_5,
].filter(Boolean); // Filtra cualquier clave que esté vacía en el .env

// Función helper para añadir pausas
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Variable global para gestionar el estado de la API Key
let currentApiKeyIndex = 0;

function getCurrentApiKey() {
    return SCRAPER_API_KEYS[currentApiKeyIndex];
}

function rotateApiKey() {
    if (currentApiKeyIndex < SCRAPER_API_KEYS.length - 1) {
        currentApiKeyIndex++;
        console.warn(`\n--- 🔑 CLAVE API ROTADA ---`);
        console.warn(`Usando la clave #${currentApiKeyIndex + 1} de ${SCRAPER_API_KEYS.length}.`);
        return true;
    }
    return false; // Todas las claves agotadas
}


/**
 * [INTERNO] Función de trabajo pesado para UN solo juego.
 * Implementa el reintento con rotación de clave.
 */
async function _processGameAndFindRecommended(gameSlug, initialImageUrl) {
    const detailUrl = `${BASE_URL}/games/${gameSlug}`;
    
    // --- BUCLE DE REINTENTO CON ROTACIÓN DE CLAVE ---
    // Intentará con la clave actual y con todas las siguientes si falla por crédito.
    for (let attempts = 0; attempts < SCRAPER_API_KEYS.length; attempts++) {
        const currentApiKey = getCurrentApiKey();
        
        try {
            // FASE A: Scrapear la página de detalle (¡Con renderizado y 10 segundos de espera!)
            const scraperDetailUrl = `http://api.scraperapi.com?api_key=${currentApiKey}&url=${encodeURIComponent(detailUrl)}&render=true&wait=10000`;
            
            // Timeout de 60 segundos
            const detailResponse = await axios.get(scraperDetailUrl, { timeout: 60000 }); 
            const $$ = cheerio.load(detailResponse.data);

            // --- FASE B: Extraer Datos del Juego (Lógica Híbrida robusta) ---
            let title, embedUrl, thumbnailUrl, category, description;
            let languages = [], genders = [], ageGroups = [];
            
            thumbnailUrl = initialImageUrl; 
            const sourceUrl = detailUrl;    

            // Método JSON (El mejor)
            const jsonData = $$('script[id="__NEXT_DATA__"]').html();
            if (jsonData) {
                try {
                    const data = JSON.parse(jsonData);
                    const gameData = data.props.pageProps.game;

                    if (gameData && gameData.url && gameData.title) {
                        title = gameData.title;
                        embedUrl = gameData.url;
                        if (gameData.assets && gameData.assets.cover) {
                            thumbnailUrl = gameData.assets.cover;
                        }
                        category = gameData.categories[0] || 'general';
                        description = gameData.description;
                        languages = gameData.languages || [];
                        genders = gameData.genders || [];
                        ageGroups = gameData.ageGroups || [];
                        console.log(`[ÉXITO JSON] Datos extraídos para: ${title} (Cat: ${category})`);
                    }
                } catch (e) {
                    // JSON corrupto
                }
            }

            // Método HTML (Fallback)
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

            if (!embedUrl) {
                throw new Error(`[FALLO FATAL] No se pudo encontrar embedUrl (ni JSON ni HTML) para ${detailUrl}.`);
            }

            if (!title) {
                title = gameSlug.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
            }
            
            if (!category) {
                category = 'general';
            }

            if (!description) {
                let descNode = $$("h2:contains('DESCRIPTION')").next();
                if (!descNode.length) {
                    descNode = $$("h2:contains('DESCRIPCIÓN')").next();

                }
                
                if (descNode.is('p')) {
                    description = descNode.text();
                    console.log(`[FALLBACK] Descripción real (HTML) encontrada para ${title}.`);
                } else {
                    description = null;
                    console.warn(`[AVISO] No se encontró descripción real (ni JSON ni HTML) para ${title}. Se guardará sin descripción.`);
                }
            }
            
            const gameData = {
                title: title,
                slug: gameSlug,
                description: description,
                category: category,
                thumbnailUrl: thumbnailUrl, 
                embedUrl: embedUrl.split('?')[0],
                source: 'GameDistribution',
                sourceUrl: sourceUrl,
                languages: languages,
                genders: genders,
                ageGroups: ageGroups
            };
            
            // --- FASE C: Encontrar Juegos Recomendados (LÓGICA AGRESIVA) ---
            const recommendedItems = []; 
            
            let section = $$("h2:contains('Recommended')").parent();
            if (!section.length) {
                section = $$("h2:contains('Similar')").parent();
            }

            if (section.length) {
                section.find('a[href^="/games/"]').each((i, el) => {
                    const link = $$(el).attr('href');
                    const imageUrl = $$(el).find('img').attr('src'); 

                    if (link && !link.includes('?') && imageUrl) { 
                        const slug = link.split('/')[2];
                        if (slug && slug !== gameSlug) {
                            recommendedItems.push({ slug: slug, imageUrl: imageUrl });
                        }
                    }
                });
            } else {
                // FALLBACK AGRESIVO: Buscar todos los enlaces válidos en la página si no se encuentra la sección
                 $$('a[href^="/games/"]').each((i, el) => {
                    const link = $$(el).attr('href');
                    const imageUrl = $$(el).find('img').attr('src');

                    if (link && !link.includes('?') && imageUrl) { 
                        const slug = link.split('/')[2];
                        if (slug && slug !== gameSlug) {
                            recommendedItems.push({ slug: slug, imageUrl: imageUrl });
                        }
                    }
                });
            }
            
            const uniqueRecommended = Array.from(new Map(recommendedItems.map(item => [item.slug, item])).values());
            
            if (uniqueRecommended.length === 0) {
                console.log(`-> No se encontraron juegos recomendados/similares válidos para ${gameSlug}.`);
            }
            
            // ¡Éxito! Devolvemos los datos y salimos del bucle de reintento.
            return {
                gameData: gameData,
                newRecommendedItems: uniqueRecommended
            };

        } catch (error) {
            // Manejo de errores de ScraperAPI (Créditos agotados o clave inválida)
            if (error.response && (error.response.status === 401 || error.response.status === 403)) {
                console.error(`[ERROR FATAL API] Clave actual (#${currentApiKeyIndex + 1}) agotada/inválida.`);
                if (!rotateApiKey()) {
                    throw new Error("¡TODAS LAS CLAVES DE SCRAPERAPI ESTÁN AGOTADAS! Deteniendo el bot.");
                }
                // Si rotó la clave, el bucle 'for' reintenta con la nueva clave.
                console.log(`Reintentando el juego '${gameSlug}' con la nueva clave...`);
                // Pausa para estabilizar la conexión antes del reintento
                await sleep(3000); 
            } else {
                // Otro error (timeout, 499, fallo de parseo, etc.).
                throw new Error(`Error procesando ${detailUrl}: ${error.message}`);
            }
        }
    }
    // Si llegamos aquí, significa que todas las claves fallaron por alguna razón no detectada arriba.
    throw new Error(`Fallo desconocido al procesar ${gameSlug} después de múltiples intentos.`);
}


/**
 * [PRIVADO] Esta es la función que llama el usuario.
 */
exports.syncGames = async (req, res) => {
    // Reiniciar el índice de la API Key al inicio de cada trabajo
    currentApiKeyIndex = 0; 
    
    if (SCRAPER_API_KEYS.length === 0) {
        return res.status(500).json({ error: "No se encontró ninguna clave de SCRAPERAPI configurada en el .env. ¡Asegúrate de agregar SCRAPER_API_KEY_1, SCRAPER_API_KEY_2, etc.!" });
    }

    res.json({
        message: `¡Robot ARAÑA (Crawler) iniciado con ${SCRAPER_API_KEYS.length} claves! El trabajo de scraping (Modo Perpetuo) ha comenzado. Revisar logs.`
    });
    // ¡Llama al robot real SIN await para que se ejecute en segundo plano!
    _runSyncJob(); 
};


/**
 * [INTERNO] Esta es la función de trabajo pesado (El Crawler Perpetuo).
 */
async function _runSyncJob() {
    console.log(`--- INICIANDO SYNC DE JUEGOS (MODO CRAWLER PERPETUO) ---`);
    console.log(`Claves disponibles: ${SCRAPER_API_KEYS.length}.`);

    let totalJuegosGuardados = 0;
    let totalJuegosFallidos = 0;
    
    let queue = []; 
    let processedSlugs = new Set(); 
    let allExistingSlugs = []; 
    let iterationCount = 0;

    try {
        // --- FASE 1: PRE-CARGAR JUEGOS EXISTENTES (Para no repetir) ---
        console.log("Cargando juegos existentes desde la DB para evitar duplicados...");
        const existingGames = await Game.find().select('slug');
        existingGames.forEach(g => processedSlugs.add(g.slug));
        allExistingSlugs = existingGames.map(g => g.slug);
        console.log(`Se encontraron ${allExistingSlugs.length} juegos existentes.`);
        
        // --- BUCLE DE TRABAJO PESADO: Nunca se detiene si hay juegos que rastrear ---
        let keepRunning = true;
        while (keepRunning) {
            iterationCount++;

            // --- FASE 2: "SEMILLA" (Seed) O RE-SEMBRAR ---
            if (iterationCount === 1) {
                // Intentamos obtener la semilla de la página principal.
                console.log(`\n--- [ITERACIÓN #${iterationCount}] Obteniendo la página principal (Semilla) ---`);
                const currentApiKey = getCurrentApiKey();
                
                try {
                    const scraperUrl = `http://api.scraperapi.com?api_key=${currentApiKey}&url=${encodeURIComponent(START_PAGE)}&render=true&wait=10000`;
                    const response = await axios.get(scraperUrl, { timeout: 90000 }); 
                    const $ = cheerio.load(response.data);

                    $('a[href^="/games/"]').each((i, el) => {
                        const link = $(el).attr('href');
                        const imageUrl = $(el).find('img').attr('src');
                        
                        if (!link || link.includes('?') || link === '/games' || !imageUrl) return;
                        
                        const slug = link.split('/')[2];
                        if (slug && !processedSlugs.has(slug)) {
                            queue.push({ slug: slug, imageUrl: imageUrl });
                            processedSlugs.add(slug);
                        }
                    });
                } catch (error) {
                    // Si falla la semilla por error de clave, lo manejamos (sin rotar aquí, se reintentará en el bucle principal)
                    if (error.response && (error.response.status === 401 || error.response.status === 403)) {
                        console.error(`[ERROR FATAL API] La clave inicial falló al obtener la semilla. El bot intentará rotar y re-sembrar en el siguiente paso.`);
                    } else {
                         console.error(`Error al obtener la página semilla: ${error.message}.`);
                    }
                }
            }


            // --- LÓGICA DE RE-SIEMBRA PERPETUA ---
            if (queue.length === 0) {
                
                // Si la DB está vacía, no hay nada que hacer.
                if (allExistingSlugs.length === 0) {
                    console.log("\n--- ¡DETENIDO! La cola y la DB están vacías. ---");
                    keepRunning = false;
                    break;
                }

                // 1. **Actualizar la lista de juegos existentes**
                // Si procesamos más juegos de los que existían al inicio, significa que encontramos nuevos.
                if (processedSlugs.size > allExistingSlugs.length) {
                    allExistingSlugs = Array.from(processedSlugs); 
                }

                // 2. **Escoger un juego aleatorio de TODA la lista descubierta (el trampolín).**
                const randomIndex = Math.floor(Math.random() * allExistingSlugs.length);
                const randomSlug = allExistingSlugs[randomIndex];

                // 3. Poner el juego en la cola. Como no tiene un 'initialImageUrl', se usará null (ya está manejado)
                queue.push({ slug: randomSlug, imageUrl: null }); 
                console.log(`\n--- [ITERACIÓN #${iterationCount}] Cola vacía. Re-sembrando con juego aleatorio: ${randomSlug} ---`);
            }


            // --- FASE 3: EL BUCLE CRAWLER (Procesar la cola actual) ---
            while (queue.length > 0) {
                
                const { slug: slugToProcess, imageUrl: initialImageUrl } = queue.shift(); 
                
                try {
                    // Pausa de 7 segundos
                    console.log(`\nJuegos restantes en cola: ${queue.length}. (Pausando 7 segundos...)`);
                    await sleep(7000); 

                    console.log(`Procesando juego: ${slugToProcess} (Clave #${currentApiKeyIndex + 1})...`);
                    
                    // 1. Obtenemos datos del juego Y sus recomendaciones (con rotación de clave integrada)
                    const { gameData, newRecommendedItems } = await _processGameAndFindRecommended(slugToProcess, initialImageUrl);

                    // 2. Guardamos este juego en la DB (si el juego ya existe, solo se actualizan los campos)
                    await Game.updateOne(
                        { slug: gameData.slug },
                        { $set: gameData },
                        { upsert: true }
                    );
                    
                    console.log(`[ÉXITO] Juego guardado: ${gameData.title}`);
                    totalJuegosGuardados++;
                    
                    // 3. Añadimos los *nuevos* slugs recomendados al FINAL de la cola
                    let addedToQueue = 0;
                    for (const newItem of newRecommendedItems) {
                        if (!processedSlugs.has(newItem.slug)) {
                            queue.push(newItem);
                            processedSlugs.add(newItem.slug);
                            addedToQueue++;
                        }
                    }
                    if (addedToQueue > 0) {
                        console.log(`-> Se encontraron ${newRecommendedItems.length} recomendados. ${addedToQueue} fueron añadidos a la cola.`);
                    }

                } catch (error) {
                    // Si _processGameAndFindRecommended lanzó un error fatal (TODAS las claves agotadas)
                    if (error.message.includes("¡TODAS LAS CLAVES DE SCRAPERAPI ESTÁN AGOTADAS!")) {
                        console.error(error.message);
                        keepRunning = false;
                        break; // Sale del bucle 'while' interno y el externo
                    }
                    
                    // Si falló por otra razón (no embed, timeout), solo registra el fallo
                    console.error(`[FALLO] No se pudo procesar ${slugToProcess}: ${error.message}`);
                    totalJuegosFallidos++;
                }
            } // Fin del bucle interno

            if (!keepRunning) break; // Salir si hubo un error fatal (ej. todas las claves agotadas)

        } // Fin del bucle while(keepRunning)

    } catch (error) {
        console.error(`Error catastrófico en el bot: ${error.message}`);
    }
    
    // --- FASE 4: REPORTE FINAL ---
    console.log(`--- ¡SINCRONIZACIÓN "CRAWLER" COMPLETADA! ---`);
    console.log({
        message: "El bot ha terminado (todas las claves agotadas o error catastrófico).",
        totalJuegosGuardadosEnDB_EstaSesion: totalJuegosGuardados,
        totalJuegosFallidos_EstaSesion: totalJuegosFallidos,
        totalJuegosEnLaColaAlFinalizar: queue.length,
        totalJuegosDescubiertosHistoricamente: processedSlugs.size
    });
};