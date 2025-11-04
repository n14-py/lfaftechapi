const axios = require('axios');
const cheerio = require('cheerio');
const Game = require('../models/game');

// --- 1. CONFIGURACIÓN DEL ROBOT ---
const BASE_URL = 'https://gamedistribution.com';
const LIST_PAGE_URL = `${BASE_URL}/games`; // URL base para la paginación

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
        // ¡¡AUMENTAMOS EL TIEMPO DE ESPERA A 7 SEGUNDOS para cargar el JSON!!
        const scraperDetailUrl = `http://api.scraperapi.com?api_key=${scraperApiKey}&url=${encodeURIComponent(detailUrl)}&render=true&wait=7000`;
        
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
                    if (gameData.assets && gameData.assets.cover) {
                        thumbnailUrl = gameData.assets.cover;
                    }
                    category = gameData.categories[0] || 'general'; // ¡CATEGORÍA REAL!
                    description = gameData.description; // ¡DESCRIPCIÓN REAL!
                    languages = gameData.languages || [];
                    genders = gameData.genders || [];
                    ageGroups = gameData.ageGroups || [];
                    
                    console.log(`[ÉXITO JSON] Datos extraídos para: ${title} (Cat: ${category})`);
                }
            } catch (e) {
                console.warn(`[AVISO] JSON corrupto en ${detailUrl}. Usando fallback HTML.`);
            }
        }

        // --- INTENTO 2: Método HTML (Fallback o "Recuperación") ---
        
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
            category = 'general'; // Si el JSON falló, no podemos adivinarla
        }

        // 4. Buscar Descripción Real (Si falta)
        if (!description) {
            let descNode = $$("h2:contains('DESCRIPTION')").next();
            if (!descNode.length) {
                descNode = $$("h2:contains('DESCRIPCIÓN')").next();
            }
            
            if (descNode.is('p')) {
                description = descNode.text();
                console.log(`[FALLBACK] Descripción real (HTML) encontrada para ${title}.`);
            } else {
                // ¡¡ARREGLO!! Ya no usamos la meta-descripción "19,000 games"
                description = null;
                console.warn(`[AVISO] No se encontró descripción real (ni JSON ni HTML) para ${title}. Se guardará sin descripción.`);
            }
        }
        
        // ¡Devolvemos el objeto de datos completo!
        return {
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
        };

    } catch (err) {
        // Si algo falla (como un timeout), lanzamos un error
        throw new Error(`Error procesando ${detailUrl}: ${err.message}`);
    }
}


/**
 * [PRIVADO] Esta es la función que llama el usuario.
 * Solo "activa" el robot y responde inmediatamente.
 */
exports.syncGames = async (req, res) => {
    res.json({
        message: "¡Robot PODEROSO iniciado! El trabajo de scraping (Modo SIN PARAR 1-por-1) ha comenzado. Esto puede tardar horas."
    });
    // ¡Llama al robot real SIN await para que se ejecute en segundo plano!
    _runSyncJob(); 
};


/**
 * [INTERNO] Esta es la función de trabajo pesado.
 * ¡¡AHORA CONTIENE EL BUCLE DE PAGINACIÓN!!
 */
async function _runSyncJob() {
    console.log(`--- INICIANDO SYNC DE JUEGOS (MODO SIN PARAR 1-por-1) ---`);
    const scraperApiKey = process.env.SCRAPER_API_KEY;

    if (!scraperApiKey) {
        console.error("No se encontró la clave de SCRAPER_API_KEY en .env");
        return; 
    }

    let page = 1;
    let keepRunning = true;
    let totalJuegosGuardados = 0;
    let totalJuegosFallidos = 0;

    // --- ¡¡EL BUCLE "SIN PARAR"!! ---
    while (keepRunning) {
        console.log(`\n--- PROCESANDO PÁGINA DE LISTA: ${page} ---`);
        let gamesOnThisPage = []; // Lista de objetos { link, imageUrl }
        
        try {
            // --- FASE 1: SCRAPING (Obtener la lista de juegos + IMÁGENES) ---
            const urlToScrape = `${LIST_PAGE_URL}?page=${page}`;
            const scraperUrl = `http://api.scraperapi.com?api_key=${scraperApiKey}&url=${encodeURIComponent(urlToScrape)}&render=true&wait=5000`;
            
            console.log(`Llamando a ScraperAPI para la lista: ${urlToScrape}`);
            const response = await axios.get(scraperUrl, { timeout: 90000 }); 
            const $ = cheerio.load(response.data);

            // Buscamos los juegos en la página
            $('a[href^="/games/"]').each((i, el) => {
                const link = $(el).attr('href');
                if (!link || link.includes('?collectionID=') || link === '/games') {
                    return;
                }
                const imageUrl = $(el).find('img').attr('src');
                if (link && imageUrl) {
                    if (!gamesOnThisPage.find(g => g.link === link)) {
                        gamesOnThisPage.push({
                            link: link,
                            imageUrl: imageUrl
                        });
                    }
                }
            });

            // --- CONDICIÓN DE PARADA 1 ---
            if (gamesOnThisPage.length === 0) {
                console.log(`Página ${page} está vacía o no encontró juegos. Deteniendo el bot.`);
                keepRunning = false;
                break;
            }

            console.log(`Página ${page}: Encontrados ${gamesOnThisPage.length} juegos (con imagen).`);

            // --- FASE 3: DE-DUPLICACIÓN (Ahorro de créditos) ---
            const allSlugs = gamesOnThisPage.map(g => g.link.split('/')[2]).filter(Boolean); 
            const existingGames = await Game.find({ slug: { $in: allSlugs } }).select('slug');
            const existingSlugs = new Set(existingGames.map(g => g.slug));
            
            const newGamesToProcess = gamesOnThisPage.filter(g => {
                const slug = g.link.split('/')[2];
                return slug && !existingSlugs.has(slug);
            });

            console.log(`De ${gamesOnThisPage.length} juegos, ${newGamesToProcess.length} son NUEVOS.`);

            if (newGamesToProcess.length === 0 && page > 1) { // Si la página 1 no tiene nuevos, igual probamos la 2
                console.log("No se encontraron juegos nuevos en esta página. Probando siguiente página...");
                page++;
                continue; // Salta al siguiente ciclo del 'while'
            }

            // --- FASE 4: PROCESAR Y GUARDAR (¡¡UNO POR UNO!!) ---
            console.log(`Iniciando scrapeo de detalles para ${newGamesToProcess.length} juegos nuevos...`);
            
            for (const game of newGamesToProcess) {
                const gameSlug = game.link.split('/')[2];
                
                try {
                    // ¡LA PAUSA ANTI-BLOQUEO!
                    console.log(`(Pausando 5 segundos para evitar bloqueo...)`);
                    await sleep(5000); 

                    console.log(`Procesando juego: ${gameSlug}...`);
                    
                    // 1. Obtenemos todos los datos del juego
                    const gameData = await _processGameDetail(game.link, gameSlug, game.imageUrl);

                    // 2. ¡GUARDAMOS ESTE JUEGO INMEDIATAMENTE!
                    await Game.updateOne(
                        { slug: gameSlug }, // El filtro
                        { $set: gameData },  // Los datos a guardar
                        { upsert: true }     // Si no existe, lo crea
                    );

                    console.log(`[ÉXITO] Juego guardado: ${gameData.title}`);
                    totalJuegosGuardados++;

                } catch (error) {
                    // Si _processGameDetail lanza un error (ej. timeout, no embed)
                    console.error(`[FALLO] No se pudo procesar ${game.link}: ${error.message}`);
                    totalJuegosFallidos++;
                    // Si el error es por créditos, el bot fallará en la próxima llamada
                    if (error.message.includes('401') || error.message.includes('403')) {
                        console.error("¡¡CRÉDITOS AGOTADOS O API KEY INVÁLIDA!! Deteniendo el bot.");
                        keepRunning = false;
                        break; // Sale del bucle 'for'
                    }
                }
            } // Fin del bucle de juegos

            page++; // Preparamos la siguiente página

        } catch (error) {
            // --- CONDICIÓN DE PARADA 2 (Error fatal) ---
            console.error(`Error fatal al procesar la PÁGINA DE LISTA ${page}: ${error.message}`);
            if (error.message.includes('404')) {
                console.log("Error 404: No hay más páginas. Deteniendo el bot.");
            }
            if (error.message.includes('401') || error.message.includes('403')) {
                console.error("¡¡CRÉDITOS AGOTADOS O API KEY INVÁLIDA!! Deteniendo el bot.");
            }
            keepRunning = false;
        }

    } // Fin del bucle 'while(keepRunning)'

    // --- FASE 5: REPORTE FINAL ---
    console.log(`--- ¡SINCRONIZACIÓN "SIN PARAR" COMPLETADA! ---`);
    console.log({
        message: "El bot ha terminado de ejecutarse.",
        totalPaginasProcesadas: page - 1,
        totalJuegosGuardadosEnDB: totalJuegosGuardados,
        totalJuegosFallidos: totalJuegosFallidos
    });
};