const axios = require('axios');
const cheerio = require('cheerio');
const Game = require('../models/game'); // El "molde" que creamos en el Paso 1
const { BedrockRuntimeClient, InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime'); // La IA de AWS

// --- 1. CONFIGURACIÓN DEL ROBOT ---

// El "cerebro" de la IA (tomado de tu bedrockClient.js)
const { AWS_BEDROCK_ACCESS_KEY_ID, AWS_BEDROCK_SECRET_ACCESS_KEY, AWS_BEDROCK_REGION } = process.env;
const bedrockClient = new BedrockRuntimeClient({
    region: AWS_BEDROCK_REGION,
    credentials: {
        accessKeyId: AWS_BEDROCK_ACCESS_KEY_ID,
        secretAccessKey: AWS_BEDROCK_SECRET_ACCESS_KEY,
    },
});
const MODEL_ID = 'anthropic.claude-3-haiku-20240307-v1:0'; // Usamos Haiku, el más rápido y barato

// El sitio que vamos a scrapear (como vimos en tu index.html)
const TARGET_URL = 'https://www.crazygames.com/c/new'; // Página de "Nuevos Juegos"


/**
 * Función de IA: Escribe la reseña SEO para un juego.
 * (Esta es tu lógica de AWS Bedrock, adaptada para juegos)
 */
async function generateGameDescription(gameTitle, gameCategory) {
    const systemPrompt = `Eres un redactor SEO carismático para 'tusinitusineli.com'. Tu trabajo es escribir una reseña/descripción de 300-400 palabras para un juego, optimizada para SEO.

Directrices:
1.  **Formato:** Responde ÚNICAMENTE con el artículo. Sin saludos ni "¡Claro!".
2.  **SEO:** Incluye natural y repetidamente: "jugar ${gameTitle} gratis", "cómo jugar ${gameTitle}", "jugar online ${gameTitle}", "mejores juegos de ${gameCategory}".
3.  **Contenido:** Describe cómo *podría* ser el juego, sus controles (puedes inventarlos, ej: "Usa WASD y el ratón"), y por qué es divertido. Hazlo sonar emocionante.`;
    
    const userPrompt = `Escribe la reseña SEO (300-400 palabras) para este juego:
-   Nombre: ${gameTitle}
-   Categoría: ${gameCategory}`;

    const payload = {
        modelId: MODEL_ID,
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify({
            anthropic_version: 'bedrock-2023-05-31',
            max_tokens: 1024,
            temperature: 0.7, // Creativo pero no demasiado loco
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


/**
 * [PRIVADO] Función principal del Robot
 * Se activa llamando a /api/sync-games
 */
exports.syncGames = async (req, res) => {
    
    console.log('--- INICIANDO SYNC DE JUEGOS AUTOMÁTICO ---');
    const scraperApiKey = process.env.SCRAPER_API_KEY;

    if (!scraperApiKey) {
        return res.status(500).json({ error: "No se encontró la clave de SCRAPER_API_KEY en .env" });
    }

    // --- FASE 1: SCRAPING (El Robot visita la web) ---
    let htmlContent;
    try {
const scraperUrl = `http://api.scraperapi.com?api_key=${scraperApiKey}&url=${encodeURIComponent(TARGET_URL)}&render=true&premium=true`;        const response = await axios.get(scraperUrl);
        htmlContent = response.data;
        console.log(`ScraperAPI trajo el HTML de ${TARGET_URL} exitosamente.`);
    } catch (error) {
        console.error("Error al llamar a ScraperAPI:", error.message);
        return res.status(500).json({ error: "Fallo al scrapear la lista de juegos." });
    }

    // --- FASE 2: PARSEO (El Robot lee el HTML) ---
    const $ = cheerio.load(htmlContent);
    let scrapedGames = [];
    
    // Este "selector" es la clave. Le dice a Cheerio dónde buscar los juegos.
    // (Buscamos el `div` que se ve como una tarjeta de juego y luego el link `a` dentro de él)
    $('div[class*="game-card_card"] a').each((i, el) => {
        const gameUrl = $(el).attr('href');
        const img = $(el).find('img');
        const title = img.attr('alt');
        const thumbnailUrl = img.attr('src');

        if (gameUrl && title && thumbnailUrl && gameUrl.startsWith('/game/')) {
            const slug = gameUrl.split('/')[2]; // Saca "bullet-force" de "/game/bullet-force"
            
            scrapedGames.push({
                title: title.trim(),
                slug: slug,
                thumbnailUrl: thumbnailUrl,
                // Construimos la URL para embeber (como la de tu index.html)
                embedUrl: `https://www.crazygames.com/embed/${slug}`,
                source: 'CrazyGames.com'
            });
        }
    });

    console.log(`Scraping encontró ${scrapedGames.length} juegos en la página.`);

    if (scrapedGames.length === 0) {
        return res.json({ message: "Scraping no encontró juegos. El selector de Cheerio puede estar desactualizado.", totalNuevos: 0 });
    }

    // --- FASE 3: DE-DUPLICACIÓN (Ahorro de créditos) ---
    // (Idéntico a la lógica que hicimos para noticias)
    
    const allSlugs = scrapedGames.map(g => g.slug);
    const existingGames = await Game.find({ slug: { $in: allSlugs } }).select('slug');
    const existingSlugs = new Set(existingGames.map(g => g.slug));

    const newGames = scrapedGames.filter(g => !existingSlugs.has(g.slug));

    console.log(`De ${scrapedGames.length} juegos, ${newGames.length} son NUEVOS.`);

    if (newGames.length === 0) {
        return res.json({ message: "¡Éxito! No se encontraron juegos nuevos.", totalNuevos: 0 });
    }

    // --- FASE 4: IA (El Robot escribe las reseñas) ---
    
    let operations = [];
    for (const game of newGames) {
        // Obtenemos la categoría (del HTML) o usamos 'general'
        // Esto es un selector de ejemplo, puede fallar si CrazyGames cambia su HTML
        const categoryString = $(`a[href="/game/${game.slug}"]`).closest('div[class*="game-card_card"]').find('div[class*="game-card_category"]').text();
        const category = categoryString || 'general'; // Fallback

        // ¡Llamamos a AWS Bedrock!
        const description = await generateGameDescription(game.title, category);

        if (description) {
            operations.push({
                updateOne: {
                    filter: { slug: game.slug },
                    update: {
                        $set: {
                            title: game.title,
                            slug: game.slug,
                            description: description, // ¡La descripción de la IA!
                            category: category,
                            thumbnailUrl: game.thumbnailUrl,
                            embedUrl: game.embedUrl,
                            source: game.source
                        }
                    },
                    upsert: true
                }
            });
        }
    }

    // --- FASE 5: GUARDAR EN LA BASE DE DATOS ---
    if (operations.length > 0) {
        console.log(`Guardando ${operations.length} juegos nuevos en la DB...`);
        const result = await Game.bulkWrite(operations);
        
        res.json({
            message: "¡Sincronización de juegos completada!",
            totalEncontrados: scrapedGames.length,
            totalNuevos: newGames.length,
            totalGuardadosEnDB: result.upsertedCount
        });
    } else {
        res.json({ message: "Se encontraron juegos nuevos, pero la IA falló en generar descripciones.", totalNuevos: newGames.length });
    }
};