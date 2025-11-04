const axios = require('axios');
const cheerio = require('cheerio');
const Game = require('../models/game');

// --- 1. CONFIGURACIÓN DEL ROBOT ---
const BASE_URL = 'https://gamedistribution.com';
const LIST_PAGE_URL = `${BASE_URL}/games`; // URL solo para encontrar el Build ID

// Función helper para añadir pausas (¡LA CLAVE ANTI-BLOQUEO!)
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));


/**
 * [INTERNO] Paso 1: Llama a la página principal UNA VEZ para encontrar el "Build ID"
 * necesario para llamar a la API interna.
 */
async function _findBuildId(scraperApiKey) {
    try {
        console.log("Buscando Build ID para la API interna...");
        // NO necesitamos render=true, el ID está en el HTML inicial
        const scraperUrl = `http://api.scraperapi.com?api_key=${scraperApiKey}&url=${encodeURIComponent(LIST_PAGE_URL)}&render=false`;
        
        const response = await axios.get(scraperUrl, { timeout: 60000 });
        const $ = cheerio.load(response.data);

        const jsonData = $('script[id="__NEXT_DATA__"]').html();
        const data = JSON.parse(jsonData);
        
        if (!data.buildId) {
            throw new Error("No se pudo encontrar el 'buildId' en __NEXT_DATA__.");
        }
        
        console.log(`Build ID encontrado: ${data.buildId}`);
        return data.buildId;

    } catch (error) {
        console.error(`Error fatal encontrando el Build ID: ${error.message}`);
        return null;
    }
}


/**
 * [PRIVADO] Esta es la función que llama el usuario.
 * Solo "activa" el robot y responde inmediatamente.
 */
exports.syncGames = async (req, res) => {
    res.json({
        message: "¡Robot PODEROSO iniciado! El trabajo de scraping (Modo API Secreta 1-por-1) ha comenzado. Esto puede tardar horas."
    });
    // ¡Llama al robot real SIN await para que se ejecute en segundo plano!
    _runSyncJob(); 
};


/**
 * [INTERNO] Esta es la función de trabajo pesado.
 * ¡¡AHORA CONTIENE EL BUCLE DE PAGINACIÓN DE LA API!!
 */
async function _runSyncJob() {
    console.log(`--- INICIANDO SYNC DE JUEGOS (MODO API SECRETA) ---`);
    const scraperApiKey = process.env.SCRAPER_API_KEY;

    if (!scraperApiKey) {
        console.error("No se encontró la clave de SCRAPER_API_KEY en .env");
        return; 
    }

    // --- FASE 1: OBTENER EL BUILD ID (1 sola vez) ---
    // (1 crédito de API usado)
    const buildId = await _findBuildId(scraperApiKey);
    if (!buildId) {
        console.error("No se puede continuar sin un Build ID. Deteniendo el bot.");
        return;
    }

    let page = 1;
    let keepRunning = true;
    let totalJuegosGuardados = 0;
    let totalJuegosFallidos = 0;

    // --- ¡¡EL BUCLE "SIN PARAR"!! ---
    while (keepRunning) {
        console.log(`\n--- PROCESANDO PÁGINA DE API: ${page} ---`);
        let gamesOnThisPage = []; // Lista de juegos del JSON
        
        try {
            // --- FASE 2: LLAMAR A LA API DE DATOS INTERNA ---
            // ¡Esta es la URL real que usa la página!
            const apiUrl = `${BASE_URL}/_next/data/${buildId}/games.json?page=${page}`;
            
            // Usamos ScraperAPI para llamar a esta API, ya que puede estar protegida
            // NO necesitamos render=true, es un JSON.
            const scraperUrl = `http://api.scraperapi.com?api_key=${scraperApiKey}&url=${encodeURIComponent(apiUrl)}&render=false`;
            
            console.log(`Llamando a la API de datos para la página ${page}...`);
            // (1 crédito de API usado por página)
            const response = await axios.get(scraperUrl, { timeout: 60000 }); 
            
            const jsonData = response.data;
            
            // La lista de juegos está en esta ruta
            gamesOnThisPage = jsonData.pageProps.games.items;

            // --- CONDICIÓN DE PARADA 1 ---
            if (!gamesOnThisPage || gamesOnThisPage.length === 0) {
                console.log(`Página de API ${page} está vacía. ¡TODOS LOS JUEGOS HAN SIDO REVISADOS! Deteniendo el bot.`);
                keepRunning = false;
                break;
            }

            console.log(`Página ${page}: Encontrados ${gamesOnThisPage.length} juegos en la API.`);

            // --- FASE 3: DE-DUPLICACIÓN (Ahorro de créditos) ---
            const allSlugs = gamesOnThisPage.map(g => g.slug).filter(Boolean); 
            const existingGames = await Game.find({ slug: { $in: allSlugs } }).select('slug');
            const existingSlugs = new Set(existingGames.map(g => g.slug));
            
            const newGamesToProcess = gamesOnThisPage.filter(g => g.slug && !existingSlugs.has(g.slug));

            console.log(`De ${gamesOnThisPage.length} juegos, ${newGamesToProcess.length} son NUEVOS.`);

            if (newGamesToProcess.length === 0) {
                console.log("No se encontraron juegos nuevos en esta página. Probando siguiente página...");
                page++;
                await sleep(3000); // Pausa entre páginas
                continue; // Salta al siguiente ciclo del 'while'
            }

            // --- FASE 4: GUARDAR (¡¡UNO POR UNO!!) ---
            console.log(`Iniciando guardado de ${newGamesToProcess.length} juegos nuevos...`);
            
            for (const gameData of newGamesToProcess) {
                try {
                    // ¡No necesitamos "procesar" nada, ya tenemos todos los datos!
                    const gameToSave = {
                        title: gameData.title,
                        slug: gameData.slug,
                        description: gameData.description, // ¡DESCRIPCIÓN REAL!
                        category: gameData.categories[0] || 'general', // ¡CATEGORÍA REAL!
                        thumbnailUrl: gameData.assets.cover, // ¡IMAGEN REAL!
                        embedUrl: gameData.url.split('?')[0], // ¡EMBED REAL!
                        source: 'GameDistribution',
                        sourceUrl: `${BASE_URL}/games/${gameData.slug}/`, // URL Privada
                        languages: gameData.languages || [],
                        genders: gameData.genders || [],
                        ageGroups: gameData.ageGroups || []
                    };
                    
                    // 2. ¡GUARDAMOS ESTE JUEGO INMEDIATAMENTE!
                    await Game.updateOne(
                        { slug: gameData.slug }, // El filtro
                        { $set: gameToSave },   // Los datos a guardar
                        { upsert: true }        // Si no existe, lo crea
                    );

                    console.log(`[ÉXITO] Juego guardado: ${gameToSave.title}`);
                    totalJuegosGuardados++;
                    await sleep(500); // Pequeña pausa entre guardados

                } catch (error) {
                    console.error(`[FALLO AL GUARDAR] No se pudo guardar ${gameData.slug}: ${error.message}`);
                    totalJuegosFallidos++;
                }
            } // Fin del bucle de juegos

            page++; // Preparamos la siguiente página
            console.log("Pausa de 5 segundos entre páginas...");
            await sleep(5000); // Pausa larga entre páginas

        } catch (error) {
            // --- CONDICIÓN DE PARADA 2 (Error fatal) ---
            console.error(`Error fatal al procesar la API de la PÁGINA ${page}: ${error.message}`);
            if (error.message.includes('404')) {
                console.log("Error 404: No hay más páginas de API. Deteniendo el bot.");
            }
            if (error.message.includes('401') || error.message.includes('403') || error.message.includes('429')) {
                console.error("¡¡CRÉDITOS AGOTADOS O BLOQUEADO!! Deteniendo el bot.");
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