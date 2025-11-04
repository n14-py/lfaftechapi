const axios = require('axios');
const cheerio = require('cheerio');
const Game = require('../models/game');
const { BedrockRuntimeClient, InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');

// --- 1. CONFIGURACIÓN DEL ROBOT ---
const { AWS_BEDROCK_ACCESS_KEY_ID, AWS_BEDROCK_SECRET_ACCESS_KEY, AWS_BEDROCK_REGION } = process.env;
const bedrockClient = new BedrockRuntimeClient({
    region: AWS_BEDROCK_REGION,
    credentials: {
        accessKeyId: AWS_BEDROCK_ACCESS_KEY_ID,
        secretAccessKey: AWS_BEDROCK_SECRET_ACCESS_KEY,
    },
});
const MODEL_ID = 'anthropic.claude-3-haiku-20240307-v1:0';
const BASE_URL = 'https://gamedistribution.com';
const LIST_PAGE_URL = `${BASE_URL}/games`;


/**
 * Función de IA: Escribe la reseña SEO para un juego.
 * --- ¡¡FUNCIÓN DESACTIVADA TEMPORALMENTE PARA PRUEBAS!! ---
 */
async function generateGameDescription(gameTitle, baseDescription, gameCategory) {
    // Esta función ya no se llama, pero la dejamos por si la reactivamos
    return "Descripción de IA omitida para prueba de scraping.";
}


// --- ¡¡NUEVA ARQUITECTURA!! ---

/**
 * [PRIVADO] Esta es la función que llama el usuario.
 * Solo "activa" el robot y responde inmediatamente.
 */
exports.syncGames = async (req, res) => {
    // 1. Responde al usuario INMEDIATAMENTE para evitar el timeout 502
    res.json({
        message: "¡Robot iniciado! El trabajo de scraping ha comenzado en segundo plano (MODO DE PRUEBA: SIN IA)."
    });

    // 2. Llama a la función real SIN 'await'
    _runSyncJob(); 
};


/**
 * [INTERNO] Esta es la función de trabajo pesado.
 * No se exporta y se ejecuta en segundo plano.
 */
async function _runSyncJob() {
    console.log(`--- INICIANDO SYNC DE JUEGOS (Objetivo: GameDistribution) ---`);
    const scraperApiKey = process.env.SCRAPER_API_KEY;

    if (!scraperApiKey) {
        console.error("No se encontró la clave de SCRAPER_API_KEY en .env");
        return; 
    }

    // --- FASE 1: SCRAPING (Obtener la lista de juegos) ---
    let htmlContent;
    try {
        const scraperUrl = `http://api.scraperapi.com?api_key=${scraperApiKey}&url=${encodeURIComponent(LIST_PAGE_URL)}&render=true&wait=3000`;
        console.log(`Llamando a ScraperAPI (Modo Renderizado + Espera 3s) para la lista: ${LIST_PAGE_URL}`);
        
        // Timeout de 60 segundos
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

    // --- FASE 4: SCRAPING (Detalles) ---
    
    let operations = [];
    console.log(`Iniciando scrapeo de detalles para ${newGameLinks.length} juegos... (IA OMITIDA)`);
    
    for (const link of newGameLinks) {
        const gameSlug = link.split('/')[2];
        const detailUrl = `${BASE_URL}${link}`;
        
        try {
            // FASE 4A: Scrapear la página de detalle
            const scraperDetailUrl = `http://api.scraperapi.com?api_key=${scraperApiKey}&url=${encodeURIComponent(detailUrl)}`;
            
            // Timeout de 30 segundos
            const detailResponse = await axios.get(scraperDetailUrl, { timeout: 30000 }); 
            
            const detailHtml = detailResponse.data;
            const $$ = cheerio.load(detailHtml);
            
            // --- ¡¡FASE 4B: EXTRAER LOS DATOS (CORREGIDO)!! ---
            
            // 1. Encontrar el TÍTULO
            // Buscamos cualquier elemento que contenga "Game Title:" y agarramos el texto
            const titleElement = $$("*:contains('Game Title:')").last();
            const title = titleElement.text().replace('Game Title:', '').trim();

            // 2. Encontrar el IFRAME
            // Basado en tu HTML, el iframe está dentro de un <textarea> o <code>.
            // Primero intentamos buscar el iframe directamente.
            let iframeSrc = $$('iframe[src*="html5.gamedistribution.com"]').attr('src');
            
            // Si no lo encuentra (porque está como texto), buscamos el texto del embed
            if (!iframeSrc) {
                 // Buscamos un <code> o <textarea> que contenga el texto del iframe
                const embedText = $$("*:contains('<iframe src=\"https://html5.gamedistribution.com')").text();
                if (embedText) {
                    // Sacamos la URL de adentro del texto
                    const match = embedText.match(/src="([^"]+)"/);
                    if (match && match[1]) {
                        iframeSrc = match[1];
                    }
                }
            }
            
            // --- Lógica de Depuración Actualizada ---
            if (!title) {
                console.error(`[DEPURACIÓN] Falla al extraer TÍTULO para ${detailUrl}. El selector ":contains('Game Title:')" falló.`);
                continue; 
            }
            if (!iframeSrc) {
                console.error(`[DEPURACIÓN] Falla al extraer IFRAME para ${detailUrl}. (Título encontrado: ${title})`);
                continue; 
            }
            // --- Fin Lógica de Depuración ---

            // Usamos la descripción <meta> como fallback
            const description = $$('meta[name="description"]').attr('content') || `Juega ${title} ahora.`;
            const thumbnail = $$('meta[property="og:image"]').attr('content') || '';
            
            // Lógica para CATEGORÍA: Buscamos "Gender" o "Age Group" o <meta>
            let category = $$("*:contains('Gender')").next().text().trim() || $$("*:contains('Age Group')").next().text().trim();
            category = category.split('\n')[0].trim() || 'general'; // Limpiamos

            console.log(`Datos extraídos para: ${title}. (Guardando sin IA)`);

            // FASE 4C: IA (OMITIDA)

            // Guardamos directamente si tenemos título e iframe
            operations.push({
                updateOne: {
                    filter: { slug: gameSlug },
                    update: {
                        $set: {
                            title: title,
                            slug: gameSlug,
                            description: description, // Usamos la descripción <meta>
                            category: category,
                            thumbnailUrl: thumbnail,
                            embedUrl: iframeSrc.split('?')[0], // Guardamos la URL limpia
                            source: 'GameDistribution'
                        }
                    },
                    upsert: true
                }
            });

        } catch (err) {
            console.error(`Error procesando ${detailUrl}: ${err.message}`);
        }
    }

    // --- FASE 5: GUARDAR EN LA BASE DE DATOS ---
    if (operations.length > 0) {
        console.log(`Guardando ${operations.length} juegos nuevos en la DB...`);
        const result = await Game.bulkWrite(operations);
        
        console.log({
            message: "¡Sincronización de juegos (SIN IA) completada!",
            totalEncontrados: gameLinks.length,
            totalNuevos: newGameLinks.length,
            totalGuardadosEnDB: result.upsertedCount
        });
    } else {
        console.log("Se encontraron juegos nuevos, pero hubo un error al extraer detalles.");
        console.log("[INSTRUCCIÓN] Revisa los logs de [DEPURACIÓN] de arriba para ver por qué fallaron los juegos.");
    }
};