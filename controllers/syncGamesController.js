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
 * (Sin cambios)
 */
async function generateGameDescription(gameTitle, baseDescription, gameCategory) {
    const systemPrompt = `Eres un redactor SEO carismático para 'tusinitusineli.com'. Tu trabajo es reescribir y expandir una descripción de un juego para hacerla única, de 300-400 palabras, y optimizada para SEO.

Directrices:
1.  **Formato:** Responde ÚNICAMENTE con el artículo. Sin saludos ni "¡Claro!".
2.  **SEO:** Incluye natural y repetidamente: "jugar ${gameTitle} gratis", "cómo jugar ${gameTitle}", "jugar online ${gameTitle}", "mejores juegos de ${gameCategory}".
3.  **Contenido:** Usa la descripción base como inspiración, pero NO la copies. Expándela, habla de los controles (invéntalos si es necesario), la emoción del juego y por qué es divertido.`;
    
    const userPrompt = `Reescribe y expande (300-400 palabras) esta descripción para SEO:
-   Nombre: ${gameTitle}
-   Categoría: ${gameCategory}
-   Descripción Base: "${baseDescription}"`;

    const payload = {
        modelId: MODEL_ID,
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify({
            anthropic_version: 'bedrock-2023-05-31',
            max_tokens: 1024,
            temperature: 0.7,
            system: systemPrompt,
            messages: [{ role: 'user', content: [{ type: 'text', text: userPrompt }] }]
        })
    };

    try {
        const command = new InvokeModelCommand(payload);
        const response = await bedrockClient.send(command);
        const responseBody = JSON.parse(new TextDecoder().decode(response.body));
        
        if (responseBody.content && responseBody.content.length > 0) {
            const generatedText = responseBody.content[0].text.trim();
            console.log(`-> IA (Bedrock) generó descripción para ${gameTitle}`);
            return generatedText;
        }
        return null;
    } catch (error) {
        console.error(`Error al invocar Bedrock para ${gameTitle}:`, error.message);
        return null;
    }
}


// --- ¡¡NUEVA ARQUITECTURA!! ---

/**
 * [PRIVADO] Esta es la función que llama el usuario.
 * Solo "activa" el robot y responde inmediatamente.
 */
exports.syncGames = async (req, res) => {
    // 1. Responde al usuario INMEDIATAMENTE para evitar el timeout 502
    res.json({
        message: "¡Robot iniciado! El trabajo de scraping e IA ha comenzado en segundo plano." +
                 " Revisa los logs de Render para ver el progreso (puede tardar varios minutos)."
    });

    // 2. Llama a la función real SIN 'await'
    // Esto libera la solicitud y deja que el robot trabaje en el fondo.
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
        return; // Termina la función silenciosamente
    }

    // --- FASE 1: SCRAPING (Obtener la lista de juegos) ---
    let htmlContent;
    try {
        // Usamos &render=true para ejecutar JavaScript y &wait=3000 para esperar 3 segundos
        const scraperUrl = `http://api.scraperapi.com?api_key=${scraperApiKey}&url=${encodeURIComponent(LIST_PAGE_URL)}&render=true&wait=3000`;
        
        console.log(`Llamando a ScraperAPI (Modo Renderizado + Espera 3s) para la lista: ${LIST_PAGE_URL}`);
        
        const response = await axios.get(scraperUrl);
        htmlContent = response.data;
        console.log(`ScraperAPI trajo el HTML (Renderizado) de la LISTA exitosamente.`);
    } catch (error) {
        console.error("Error al llamar a ScraperAPI (Fase 1: Lista):", error.message);
        return; // Termina la función
    }

    // --- FASE 2: PARSEO (Leer la lista de juegos) ---
    let gameLinks = [];
    try {
        const $ = cheerio.load(htmlContent);
        
        // Buscamos los links que van a las páginas de juegos (ej. /games/elytra-flight)
        $('a[href^="/games/"]').each((i, el) => {
            const href = $(el).attr('href');
            if (href && !gameLinks.includes(href) && href !== '/games') {
                gameLinks.push(href);
            }
        });
        
        gameLinks = gameLinks.slice(0, 20); // Tomamos solo 20
        
        console.log(`Scraping encontró ${gameLinks.length} links de juegos en la página.`);
    } catch (e) {
         console.error("Error al parsear la lista con Cheerio:", e.message);
         return; // Termina la función
    }
    
    if (gameLinks.length === 0) {
        console.log("Scraping no encontró links de juegos. El selector de Cheerio puede estar desactualizado.");
        return; // Termina la función
    }

    // --- FASE 3: DE-DUPLICACIÓN (Ahorro de créditos) ---
    const allSlugs = gameLinks.map(link => link.split('/')[2]).filter(Boolean); // .filter(Boolean) elimina slugs vacíos
    const existingGames = await Game.find({ slug: { $in: allSlugs } }).select('slug');
    const existingSlugs = new Set(existingGames.map(g => g.slug));

    const newGameLinks = gameLinks.filter(link => {
        const slug = link.split('/')[2];
        return slug && !existingSlugs.has(slug);
    });

    console.log(`De ${gameLinks.length} juegos, ${newGameLinks.length} son NUEVOS.`);

    if (newGameLinks.length === 0) {
        console.log("¡Éxito! No se encontraron juegos nuevos.");
        return; // Termina la función
    }

    // --- FASE 4: SCRAPING (Detalles) + IA (Reseñas) ---
    
    let operations = [];
    console.log(`Iniciando scrapeo de detalles e IA para ${newGameLinks.length} juegos...`);
    
    for (const link of newGameLinks) {
        const gameSlug = link.split('/')[2];
        const detailUrl = `${BASE_URL}${link}`;
        
        try {
            // FASE 4A: Scrapear la página de detalle (Modo Básico, 1 crédito)
            const scraperDetailUrl = `http://api.scraperapi.com?api_key=${scraperApiKey}&url=${encodeURIComponent(detailUrl)}`;
            const detailResponse = await axios.get(scraperDetailUrl);
            const detailHtml = detailResponse.data;
            const $$ = cheerio.load(detailHtml);
            
            // FASE 4B: Extraer los datos
            const title = $$('h1').first().text().trim();
            if (!title) continue; 

            const iframeSrc = $$('iframe[src*="html5.gamedistribution.com"]').attr('src');
            if (!iframeSrc) continue; 

            const description = $$('meta[name="description"]').attr('content') || `Juega ${title} ahora.`;
            const thumbnail = $$('meta[property="og:image"]').attr('content') || '';
            const category = $$('a[href*="/c/"]').first().text().trim() || 'general';

            console.log(`Datos extraídos para: ${title}`);

            // FASE 4C: Llamar a la IA (AWS Bedrock)
            const seoDescription = await generateGameDescription(title, description, category);

            if (seoDescription) {
                operations.push({
                    updateOne: {
                        filter: { slug: gameSlug },
                        update: {
                            $set: {
                                title: title,
                                slug: gameSlug,
                                description: seoDescription, 
                                category: category,
                                thumbnailUrl: thumbnail,
                                embedUrl: iframeSrc, 
                                source: 'GameDistribution'
                            }
                        },
                        upsert: true
                    }
                });
            }
        } catch (err) {
            console.error(`Error procesando ${detailUrl}: ${err.message}`);
        }
    }

    // --- FASE 5: GUARDAR EN LA BASE DE DATOS ---
    if (operations.length > 0) {
        console.log(`Guardando ${operations.length} juegos nuevos en la DB...`);
        const result = await Game.bulkWrite(operations);
        
        console.log({
            message: "¡Sincronización de juegos completada!",
            totalEncontrados: gameLinks.length,
            totalNuevos: newGameLinks.length,
            totalGuardadosEnDB: result.upsertedCount
        });
    } else {
        console.log("Se encontraron juegos nuevos, pero hubo un error al extraer detalles o generar descripciones.");
    }
};