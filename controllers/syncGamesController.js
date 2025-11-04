const axios = require('axios');
const cheerio = require('cheerio');
const Game = require('../models/game'); // El "molde" que creamos
const { BedrockRuntimeClient, InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');

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
const MODEL_ID = 'anthropic.claude-3-haiku-20240307-v1:0';

// --- ¡NUEVO OBJETIVO! ---
const BASE_URL = 'https://gamedistribution.com';
const LIST_PAGE_URL = `${BASE_URL}/games`; // La página del catálogo de juegos


/**
 * Función de IA: Escribe la reseña SEO para un juego.
 * (La misma función que antes, pero le pasamos la descripción base)
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

/**
 * [PRIVADO] Función principal del Robot
 * Se activa llamando a /api/sync-games
 */
exports.syncGames = async (req, res) => {
    
    console.log(`--- INICIANDO SYNC DE JUEGOS (Objetivo: GameDistribution) ---`);
    const scraperApiKey = process.env.SCRAPER_API_KEY;

    if (!scraperApiKey) {
        return res.status(500).json({ error: "No se encontró la clave de SCRAPER_API_KEY en .env" });
    }

    // --- FASE 1: SCRAPING (Obtener la lista de juegos) ---
    let htmlContent;
    try {
        // Usamos la llamada simple (1 crédito)
        const scraperUrl = `http://api.scraperapi.com?api_key=${scraperApiKey}&url=${encodeURIComponent(LIST_PAGE_URL)}`;
        
        console.log(`Llamando a ScraperAPI (Modo Básico) para la lista: ${LIST_PAGE_URL}`);
        
        const response = await axios.get(scraperUrl);
        htmlContent = response.data;
        console.log(`ScraperAPI trajo el HTML de la LISTA exitosamente.`);
    } catch (error) {
        console.error("Error al llamar a ScraperAPI (Fase 1: Lista):", error.message);
        return res.status(500).json({ error: "Fallo al scrapear la lista de juegos." });
    }

    // --- FASE 2: PARSEO (Leer la lista de juegos) ---
    let gameLinks = [];
    try {
        const $ = cheerio.load(htmlContent);
        
        // Buscamos los links que van a las páginas de juegos (ej. /games/elytra-flight)
        // Este es un selector *estimado*
        $('a[href^="/games/"]').each((i, el) => {
            const href = $(el).attr('href');
            if (href && !gameLinks.includes(href) && href !== '/games') {
                gameLinks.push(href);
            }
        });
        
        // Tomamos solo los primeros 20 para no gastar tantos créditos
        gameLinks = gameLinks.slice(0, 20);
        
        console.log(`Scraping encontró ${gameLinks.length} links de juegos en la página.`);
    } catch (e) {
         console.error("Error al parsear la lista con Cheerio:", e.message);
         return res.status(500).json({ error: "Fallo al leer el HTML de la lista." });
    }
    
    if (gameLinks.length === 0) {
        return res.json({ message: "Scraping no encontró links de juegos. El selector de Cheerio puede estar desactualizado.", totalNuevos: 0 });
    }

    // --- FASE 3: DE-DUPLICACIÓN (Ahorro de créditos) ---
    const allSlugs = gameLinks.map(link => link.split('/')[2]);
    const existingGames = await Game.find({ slug: { $in: allSlugs } }).select('slug');
    const existingSlugs = new Set(existingGames.map(g => g.slug));

    const newGameLinks = gameLinks.filter(link => !existingSlugs.has(link.split('/')[2]));

    console.log(`De ${gameLinks.length} juegos, ${newGameLinks.length} son NUEVOS.`);

    if (newGameLinks.length === 0) {
        return res.json({ message: "¡Éxito! No se encontraron juegos nuevos.", totalNuevos: 0 });
    }

    // --- FASE 4: SCRAPING (Detalles) + IA (Reseñas) ---
    
    let operations = [];
    console.log(`Iniciando scrapeo de detalles e IA para ${newGameLinks.length} juegos...`);
    
    for (const link of newGameLinks) {
        const gameSlug = link.split('/')[2];
        const detailUrl = `${BASE_URL}${link}`;
        
        try {
            // --- FASE 4A: Scrapear la página de detalle ---
            const scraperDetailUrl = `http://api.scraperapi.com?api_key=${scraperApiKey}&url=${encodeURIComponent(detailUrl)}`;
            const detailResponse = await axios.get(scraperDetailUrl);
            const detailHtml = detailResponse.data;
            const $$ = cheerio.load(detailHtml);
            
            // --- FASE 4B: Extraer los datos (¡Usando la info que encontraste!) ---
            
            // 1. El Título (estimación)
            const title = $$('h1').first().text().trim();
            if (!title) continue; // Si no hay título, saltar

            // 2. La URL del Iframe (La clave)
            const iframeSrc = $$('iframe[src*="html5.gamedistribution.com"]').attr('src');
            if (!iframeSrc) continue; // Si no hay iframe, saltar

            // 3. La Descripción Base (estimación)
            const description = $$('meta[name="description"]').attr('content') || `Juega ${title} ahora.`;
            
            // 4. La Miniatura (estimación)
            const thumbnail = $$('meta[property="og:image"]').attr('content') || '';
            
            // 5. La Categoría (estimación)
            const category = $$('a[href*="/c/"]').first().text().trim() || 'general';

            console.log(`Datos extraídos para: ${title}`);

            // --- FASE 4C: Llamar a la IA (AWS Bedrock) ---
            const seoDescription = await generateGameDescription(title, description, category);

            if (seoDescription) {
                operations.push({
                    updateOne: {
                        filter: { slug: gameSlug },
                        update: {
                            $set: {
                                title: title,
                                slug: gameSlug,
                                description: seoDescription, // ¡La descripción de la IA!
                                category: category,
                                thumbnailUrl: thumbnail,
                                embedUrl: iframeSrc, // ¡El iframe que extrajimos!
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
        
        res.json({
            message: "¡Sincronización de juegos completada!",
            totalEncontrados: gameLinks.length,
            totalNuevos: newGameLinks.length,
            totalGuardadosEnDB: result.upsertedCount
        });
    } else {
        res.json({ message: "Se encontraron juegos nuevos, pero hubo un error al extraer detalles o generar descripciones.", totalNuevos: newGameLinks.length });
    }
};