const axios = require('axios');
const cheerio = require('cheerio');
const Game = require('../models/game');

// --- 1. CONFIGURACIÓN DEL ROBOT ---
const BASE_URL = 'https://gamedistribution.com';
const START_PAGE = `${BASE_URL}/games`; // Página para la "semilla"

// Función helper para añadir pausas (¡LA CLAVE ANTI-BLOQUEO!)
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * [INTERNO] Función de trabajo pesado para UN solo juego.
 * Esta es la parte "inteligente" que se recupera de fallos.
 * Ahora también devuelve los recomendados que encuentra.
 */
async function _processGameAndFindRecommended(gameSlug, initialImageUrl) {
    const detailUrl = `${BASE_URL}/games/${gameSlug}`;
    const scraperApiKey = process.env.SCRAPER_API_KEY;

    try {
        // FASE A: Scrapear la página de detalle (¡Con renderizado!)
        const scraperDetailUrl = `http://api.scraperapi.com?api_key=${scraperApiKey}&url=${encodeURIComponent(detailUrl)}&render=true&wait=7000`;
        
        // Timeout de 60 segundos
        const detailResponse = await axios.get(scraperDetailUrl, { timeout: 60000 }); 
        const $$ = cheerio.load(detailResponse.data);

        // --- FASE B: Extraer Datos del Juego (Lógica Híbrida) ---
        let title, embedUrl, thumbnailUrl, category, description;
        let languages = [], genders = [], ageGroups = [];
        
        // Usamos la imagen de la lista como primera opción (es la que ve el usuario)
        thumbnailUrl = initialImageUrl; 
        const sourceUrl = detailUrl;    

        // --- INTENTO 1: Método JSON (El mejor) ---
        const jsonData = $$('script[id="__NEXT_DATA__"]').html();
        if (jsonData) {
            try {
                const data = JSON.parse(jsonData);
                const gameData = data.props.pageProps.game;

                if (gameData && gameData.url && gameData.title) {
                    title = gameData.title;
                    embedUrl = gameData.url;
                    // Sobrescribir la imagen SOLO si encontramos una de mejor calidad
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
                console.log(`[FALLBACK] Descripción real (HTML) encontrada para ${title}.`);
            } else {
                description = null; // Guardar sin descripción
                console.warn(`[AVISO] No se encontró descripción real (ni JSON ni HTML) para ${title}. Se guardará sin descripción.`);
            }
        }
        
        // Objeto de datos del juego listo
        const gameData = {
            title: title,
            slug: gameSlug,
            description: description,
            category: category,
            thumbnailUrl: thumbnailUrl, // La imagen que teníamos
            embedUrl: embedUrl.split('?')[0],
            source: 'GameDistribution',
            sourceUrl: sourceUrl,
            languages: languages,
            genders: genders,
            ageGroups: ageGroups
        };
        
        // --- FASE C: Encontrar Juegos Recomendados (Tu nueva lógica) ---
        const recommendedItems = []; // Array de { slug, imageUrl }
        
        const recommendedSection = $$("h2:contains('Recommended')").parent();
        
        if (recommendedSection.length) {
            recommendedSection.find('a[href^="/games/"]').each((i, el) => {
                const link = $$(el).attr('href');
                const imageUrl = $$(el).find('img').attr('src'); // Capturar imagen del recomendado

                // --- ¡¡EL FIX IMPORTANTE!! ---
                // Ignorar enlaces inválidos (que contengan "?") y asegurar que tengan imagen
                if (link && !link.includes('?') && imageUrl) { 
                    const slug = link.split('/')[2];
                    if (slug && slug !== gameSlug) {
                        recommendedItems.push({ slug: slug, imageUrl: imageUrl });
                    }
                }
            });
        } else {
             console.warn(`[AVISO] No se encontró la sección "Recommended" en ${detailUrl}.`);
        }
        
        // De-duplicar los items de *esta* página antes de devolverlos
        const uniqueRecommended = Array.from(new Map(recommendedItems.map(item => [item.slug, item])).values());

        // Devolvemos el objeto de datos y la lista de nuevos slugs
        return {
            gameData: gameData,
            newRecommendedItems: uniqueRecommended
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
        message: "¡Robot ARAÑA (Crawler) iniciado! El trabajo de scraping (Modo Recomendados Infinito) ha comenzado. Esto puede tardar días."
    });
    // ¡Llama al robot real SIN await para que se ejecute en segundo plano!
    _runSyncJob(); 
};


/**
 * [INTERNO] Esta es la función de trabajo pesado (El Crawler).
 */
async function _runSyncJob() {
    console.log(`--- INICIANDO SYNC DE JUEGOS (MODO CRAWLER INFINITO) ---`);
    const scraperApiKey = process.env.SCRAPER_API_KEY;

    if (!scraperApiKey) {
        console.error("No se encontró la clave de SCRAPER_API_KEY en .env");
        return; 
    }

    let totalJuegosGuardados = 0;
    let totalJuegosFallidos = 0;
    
    // La cola ahora guarda objetos: { slug, imageUrl }
    let queue = []; 
    
    // Set de slugs (en cola O en DB) para no repetir
    let processedSlugs = new Set(); 

    try {
        // --- FASE 1: PRE-CARGAR JUEGOS EXISTENTES (Para no repetir) ---
        console.log("Cargando juegos existentes desde la DB para evitar duplicados...");
        const existingGames = await Game.find().select('slug');
        existingGames.forEach(g => processedSlugs.add(g.slug));
        console.log(`Se encontraron ${processedSlugs.size} juegos existentes.`);

        // --- FASE 2: "SEMILLA" (Seed) - Obtener la primera página para empezar ---
        console.log("Obteniendo la página principal para la 'semilla' inicial...");
        const scraperUrl = `http://api.scraperapi.com?api_key=${scraperApiKey}&url=${encodeURIComponent(START_PAGE)}&render=true&wait=5000`;
        
        const response = await axios.get(scraperUrl, { timeout: 90000 }); 
        const $ = cheerio.load(response.data);

        // Buscamos los juegos en la página principal para añadirlos a la cola
        $('a[href^="/games/"]').each((i, el) => {
            const link = $(el).attr('href');
            const imageUrl = $(el).find('img').attr('src');
            
            // --- ¡¡EL FIX IMPORTANTE!! ---
            // Ignorar enlaces inválidos (con "?", sin link, o sin imagen)
            if (!link || link.includes('?') || link === '/games' || !imageUrl) {
                return;
            }
            
            const slug = link.split('/')[2];

            // Si es un slug válido y NO lo hemos procesado (ni está en la DB)
            if (slug && !processedSlugs.has(slug)) {
                queue.push({ slug: slug, imageUrl: imageUrl });
                processedSlugs.add(slug); // Añadir a 'processed' para no meterlo en la cola de nuevo
            }
        });
        
        if (queue.length === 0 && existingGames.length === 0) {
             console.log("La página de semilla no encontró ningún juego. Revisa el scraping de la página principal.");
             return;
        } else if (queue.length === 0) {
            console.log("La página de semilla no tenía juegos nuevos (ya están todos en la DB). El bot se detendrá.");
            return;
        }

        console.log(`Semilla obtenida. ${queue.length} juegos nuevos encontrados en la página 1 para iniciar la cola.`);


        // --- FASE 3: EL BUCLE CRAWLER (Mientras haya juegos en la cola) ---
        while (queue.length > 0) {
            
            // Saca el PRIMER juego de la cola (First-In, First-Out)
            const { slug: slugToProcess, imageUrl: initialImageUrl } = queue.shift(); 
            
            try {
                // ¡LA PAUSA ANTI-BLOQUEO! (Aumentada a 7 segundos)
                console.log(`\nJuegos restantes en cola: ${queue.length}. (Pausando 7 segundos...)`);
                await sleep(7000); 

                console.log(`Procesando juego: ${slugToProcess}...`);
                
                // 1. Obtenemos datos del juego Y sus recomendaciones
                const { gameData, newRecommendedItems } = await _processGameAndFindRecommended(slugToProcess, initialImageUrl);

                // 2. Guardamos este juego en la DB
                await Game.updateOne(
                    { slug: gameData.slug }, // El filtro
                    { $set: gameData },      // Los datos a guardar
                    { upsert: true }         // Si no existe, lo crea
                );
                
                console.log(`[ÉXITO] Juego guardado: ${gameData.title}`);
                totalJuegosGuardados++;
                
                // 3. Añadimos los *nuevos* slugs recomendados al FINAL de la cola
                let addedToQueue = 0;
                for (const newItem of newRecommendedItems) {
                    // Si NUNCA lo hemos visto (ni en DB, ni en cola)
                    if (!processedSlugs.has(newItem.slug)) {
                        queue.push(newItem); // Añadir objeto { slug, imageUrl } al final de la cola
                        processedSlugs.add(newItem.slug); // Marcar como "visto"
                        addedToQueue++;
                    }
                }
                if (addedToQueue > 0) {
                     console.log(`-> Se encontraron ${newRecommendedItems.length} recomendados. ${addedToQueue} fueron añadidos a la cola.`);
                }

            } catch (error) {
                // Si _processGameAndFindRecommended falla
                console.error(`[FALLO] No se pudo procesar ${slugToProcess}: ${error.message}`);
                totalJuegosFallidos++;
                // Si el error es por créditos, detenemos el bot
                if (error.message.includes('401') || error.message.includes('403')) {
                    console.error("¡¡CRÉDITOS AGOTADOS O API KEY INVÁLIDA!! Deteniendo el bot.");
                    break; // Sale del bucle 'while'
                }
            }
        } // Fin del bucle 'while(queue.length > 0)'

    } catch (error) {
        // Error en la Fase 1 (DB) o Fase 2 (Semilla)
        console.error(`Error fatal en el setup del Crawler (DB o Semilla): ${error.message}`);
    }
    
    // --- FASE 4: REPORTE FINAL ---
    console.log(`--- ¡SINCRONIZACIÓN "CRAWLER" COMPLETADA! ---`);
    console.log({
        message: "El bot ha terminado (cola vacía o error fatal).",
        totalJuegosGuardadosEnDB_EstaSesion: totalJuegosGuardados,
        totalJuegosFallidos_EstaSesion: totalJuegosFallidos,
        totalJuegosEnLaColaAlFinalizar: queue.length,
        totalJuegosDescubiertosHistoricamente: processedSlugs.size
    });
};