const axios = require('axios');
const cheerio = require('cheerio');
const Game = require('../models/game');

// --- 1. CONFIGURACIÓN DEL ROBOT ---
const BASE_URL = 'https://gamedistribution.com';
const START_PAGE = `${BASE_URL}/games`; // Página inicial para "sembrar" la araña

// Función helper para añadir pausas (¡LA CLAVE ANTI-BLOQUEO!)
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * [INTERNO] Función de trabajo pesado para UN solo juego.
 * Esta es la parte "inteligente":
 * 1. Procesa y guarda el juego.
 * 2. Devuelve los links "recomendados" que encuentra.
 */
async function _processGameDetailAndFindMore(link, gameSlug, initialImageUrl) {
    const detailUrl = `${BASE_URL}${link}`;
    const scraperApiKey = process.env.SCRAPER_API_KEY;

    try {
        // FASE 4A: Scrapear la página de detalle (¡Con renderizado!)
        // ¡¡AUMENTAMOS EL TIEMPO DE ESPERA A 10 SEGUNDOS para cargar el JSON!!
        const scraperDetailUrl = `http://api.scraperapi.com?api_key=${scraperApiKey}&url=${encodeURIComponent(detailUrl)}&render=true&wait=10000`;
        
        // Timeout de 90 segundos (para darle margen a la espera de 10s)
        const detailResponse = await axios.get(scraperDetailUrl, { timeout: 90000 }); 
        const $$ = cheerio.load(detailResponse.data);

        // Variables para guardar los datos
        let title, embedUrl, thumbnailUrl, category, description;
        let languages = [], genders = [], ageGroups = [];
        
        thumbnailUrl = initialImageUrl; 
        const sourceUrl = detailUrl;    

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
        
        if (!embedUrl) {
            const embedText = $$("*:contains('<iframe src=\"https://html5.gamedistribution.com')").text();
            const match = embedText ? embedText.match(/src="([^"]+)"/) : null;
            if (match && match[1]) {
                embedUrl = match[1];
                console.log(`[FALLBACK] embedUrl encontrado en HTML.`);
            } else {
                 throw new Error(`[FALLO FATAL] No se pudo encontrar embedUrl (ni JSON ni HTML).`);
            }
        }

        if (!title) {
            title = gameSlug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
        }
        
        if (!category) {
            category = 'general';
        }

        if (!description) {
            let descNode = $$("h2:contains('DESCRIPTION')").next();
            if (!descNode.length) descNode = $$("h2:contains('DESCRIPCIÓN')").next();
            
            if (descNode.is('p')) {
                description = descNode.text();
                console.log(`[FALLBACK] Descripción real (HTML) encontrada.`);
            } else {
                description = null; // ¡NO MÁS "19,000 games"!
            }
        }
        
        // ¡Devolvemos el objeto de datos completo!
        const gameDataToSave = {
            title, slug: gameSlug, description, category, thumbnailUrl, 
            embedUrl: embedUrl.split('?')[0], source: 'GameDistribution',
            sourceUrl, languages, genders, ageGroups
        };
        
        // --- ¡¡GUARDADO 1 POR 1!! ---
        await Game.updateOne({ slug: gameSlug }, { $set: gameDataToSave }, { upsert: true });
        console.log(`[ÉXITO] Juego guardado: ${title}`);
        
        // Devolvemos el HTML de esta página para que la araña busque links
        return $$; 

    } catch (err) {
        throw new Error(`Error procesando ${detailUrl}: ${err.message}`);
    }
}


/**
 * [PRIVADO] Esta es la función que llama el usuario.
 * Solo "activa" el robot y responde inmediatamente.
 */
exports.syncGames = async (req, res) => {
    res.json({
        message: "¡Robot ARAÑA iniciado! El trabajo de scraping (Modo Sin Parar 1-por-1) ha comenzado. Esto puede tardar horas."
    });
    // ¡Llama al robot real SIN await para que se ejecute en segundo plano!
    _runSyncJob(); 
};


/**
 * [INTERNO] Esta es la función de trabajo pesado.
 * ¡¡ESTE ES EL NUEVO BOT "ARAÑA"!!
 */
async function _runSyncJob() {
    console.log(`--- INICIANDO SYNC DE JUEGOS (MODO ARAÑA 1-por-1) ---`);
    const scraperApiKey = process.env.SCRAPER_API_KEY;

    if (!scraperApiKey) {
        console.error("No se encontró la clave de SCRAPER_API_KEY en .env");
        return; 
    }

    // --- FASE 1: INICIALIZAR LA "COLA" Y "VISITADOS" ---
    // gameQueue: La lista "infinita" de juegos por procesar
    let gameQueue = []; 
    // visitedSlugs: Set para no procesar el mismo juego dos veces
    let visitedSlugs = new Set(); 

    let totalJuegosGuardados = 0;
    let totalJuegosFallidos = 0;

    try {
        // --- FASE 2: "SEMBRAR" LA COLA (LLAMADA INICIAL) ---
        // (1 crédito usado)
        const scraperUrl = `http://api.scraperapi.com?api_key=${scraperApiKey}&url=${encodeURIComponent(START_PAGE)}&render=true&wait=5000`;
        console.log(`Llamando a ScraperAPI para sembrar la cola desde: ${START_PAGE}`);
        
        const response = await axios.get(scraperUrl, { timeout: 90000 }); 
        const $ = cheerio.load(response.data);

        // Buscamos los juegos en la página inicial
        $('a[href^="/games/"]').each((i, el) => {
            const link = $(el).attr('href');
            const slug = link ? link.split('/')[2] : null;

            if (!slug || link.includes('?collectionID=') || link === '/games') {
                return;
            }
            
            const imageUrl = $(el).find('img').attr('src');
            
            // ¡COMO PEDISTE! Guardamos link e imagen
            if (imageUrl && !visitedSlugs.has(slug)) {
                gameQueue.push({ link, imageUrl, slug });
                visitedSlugs.add(slug);
            }
        });

        console.log(`Cola inicial sembrada con ${gameQueue.length} juegos.`);
        if (gameQueue.length === 0) {
            throw new Error("No se encontraron juegos en la página inicial. Los selectores pueden estar rotos.");
        }
        
        // --- REVISAMOS LA BASE DE DATOS UNA SOLA VEZ AL INICIO ---
        const allInitialSlugs = gameQueue.map(g => g.slug);
        const existingGames = await Game.find({ slug: { $in: allInitialSlugs } }).select('slug');
        const existingSlugs = new Set(existingGames.map(g => g.slug));
        
        // Filtramos la cola inicial para no procesar juegos que ya tenemos
        gameQueue = gameQueue.filter(g => !existingSlugs.has(g.slug));
        
        // Añadimos los que ya existen a "visitados" para no volver a procesarlos
        existingSlugs.forEach(slug => visitedSlugs.add(slug));
        
        console.log(`De la siembra inicial, ${gameQueue.length} juegos son NUEVOS y se van a procesar.`);

    } catch (error) {
        console.error(`Error fatal al sembrar la cola: ${error.message}`);
        return;
    }

    // --- FASE 3: EL BUCLE "SIN PARAR" (MIENTRAS HAYA JUEGOS EN LA COLA) ---
    while (gameQueue.length > 0) {
        
        // 1. Sacamos el próximo juego de la cola
        const currentGame = gameQueue.shift(); // Saca el *primero* de la lista
        const gameSlug = currentGame.slug;

        console.log(`\nProcesando juego: ${gameSlug}... (Juegos restantes en cola: ${gameQueue.length})`);

        try {
            // ¡LA PAUSA ANTI-BLOQUEO!
            console.log(`(Pausando 7 segundos para evitar bloqueo y esperar JS...)`);
            await sleep(7000); 

            // 2. PROCESAR, GUARDAR, Y OBTENER EL HTML DE VUELTA
            // _processGameDetail ahora guarda en la DB y devuelve el HTML ($$)
            const $$_detailPage = await _processGameDetail(currentGame.link, gameSlug, currentGame.imageUrl);
            
            totalJuegosGuardados++;

            // --- 3. ¡LA MAGIA! BUSCAR RECOMENDADOS Y AÑADIR A LA COLA ---
            $$_detailPage('a[href^="/games/"]').each((i, el) => {
                const newLink = $(el).attr('href');
                const newSlug = newLink ? newLink.split('/')[2] : null;

                // Si es un link de juego, no es el juego actual, y NO lo hemos visitado...
                if (newSlug && newSlug !== gameSlug && !visitedSlugs.has(newSlug)) {
                    const newImageUrl = $(el).find('img').attr('src');
                    if (newImageUrl) {
                        gameQueue.push({ link: newLink, imageUrl: newImageUrl, slug: newSlug }); // Añade al final de la cola
                        visitedSlugs.add(newSlug); // Marca como "ya en la cola"
                        console.log(`[+] Araña encontró: ${newSlug} (Cola ahora: ${gameQueue.length})`);
                    }
                }
            });

        } catch (error) {
            console.error(`[FALLO] No se pudo procesar ${gameSlug}: ${error.message}`);
            totalJuegosFallidos++;
            if (error.message.includes('401') || error.message.includes('403') || error.message.includes('429')) {
                console.error("¡¡CRÉDITOS AGOTADOS O BLOQUEADO!! Deteniendo el bot.");
                break; // Sale del bucle 'while'
            }
        }
    } // Fin del bucle 'while(gameQueue.length > 0)'

    // --- FASE 4: REPORTE FINAL ---
    console.log(`--- ¡SINCRONIZACIÓN "ARAÑA" COMPLETADA! ---`);
    console.log({
        message: "El bot ha terminado de ejecutarse (Cola vacía o error fatal).",
        totalJuegosGuardadosEnDB: totalJuegosGuardados,
        totalJuegosFallidos: totalJuegosFallidos,
        totalJuegosDescubiertos: visitedSlugs.size
    });
};