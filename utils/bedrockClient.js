// Archivo: lfaftechapi/utils/bedrockClient.js
require('dotenv').config();
const { BedrockRuntimeClient, InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');
const axios = require('axios');
const cheerio = require('cheerio');

// --- 1. Cargar Claves de AWS (Bedrock) ---
const { AWS_BEDROCK_ACCESS_KEY_ID, AWS_BEDROCK_SECRET_ACCESS_KEY, AWS_BEDROCK_REGION } = process.env;

if (!AWS_BEDROCK_ACCESS_KEY_ID || !AWS_BEDROCK_SECRET_ACCESS_KEY || !AWS_BEDROCK_REGION) {
    console.error("Error: Faltan variables de entorno de AWS Bedrock.");
}

// --- 2. Cliente de Bedrock ---
const client = new BedrockRuntimeClient({
    region: AWS_BEDROCK_REGION,
    credentials: {
        accessKeyId: AWS_BEDROCK_ACCESS_KEY_ID,
        secretAccessKey: AWS_BEDROCK_SECRET_ACCESS_KEY,
    },
});
exports.client = client; 
exports.InvokeModelCommand = InvokeModelCommand;

const MODEL_ID = 'anthropic.claude-3-haiku-20240307-v1:0';


// ============================================================================
// 🛠️ HELPERS (HERRAMIENTAS DE LIMPIEZA Y SCRAPING)
// ============================================================================

/**
 * Limpiador de Categorías (SOLUCIÓN DEFINITIVA)
 */
function cleanCategory(rawCategory) {
    if (!rawCategory) return "general";

    let cleaned = rawCategory.toLowerCase()
        .replace('categoría:', '')
        .replace('categoria:', '')
        .replace(/\[|\]|"/g, '') 
        .trim();

    cleaned = cleaned.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

    const validCats = ["politica", "economia", "deportes", "tecnologia", "entretenimiento", "salud", "internacional", "general"];
    
    if (validCats.includes(cleaned)) {
        return cleaned;
    }
    
    return "general";
}

/**
 * Helper para descargar el contenido HTML de una URL
 */
async function fetchUrlContent(url) {
    try {
        const { data } = await axios.get(url, { 
            timeout: 10000, // 10 segundos timeout
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36' }
        });
        
        const $ = cheerio.load(data);
        $('script, style, nav, footer, header, iframe, .ads, .menu, .sidebar').remove();

        // Intentar buscar contenedores de artículos comunes para no leer basura del footer
        let content = '';
        const selectors = ['article', '.entry-content', '.post-content', '.article-body', 'main', 'body'];
        
        for (const sel of selectors) {
            if ($(sel).length > 0) {
                // Extraer párrafos de ese contenedor
                $(sel).find('p').each((i, el) => {
                    const text = $(el).text().trim();
                    if (text.length > 20) content += text + '\n\n';
                });
                if (content.length > 500) break; // Si encontramos buen contenido, paramos
            }
        }
        
        // Si fallaron los selectores, leer todos los P
        if (content.length < 200) {
             $('p').each((i, el) => { content += $(el).text().trim() + '\n\n'; });
        }

        return content.trim().substring(0, 30000); // Leemos hasta 30k caracteres
    } catch (error) {
        console.warn(`[BedrockClient] Error leyendo URL: ${error.message}`);
        return null; 
    }
}


// ============================================================================
// 📻 FUNCIÓN 1: GENERADOR DE RADIOS
// ============================================================================

exports.generateRadioDescription = async (radio) => {
    const { nombre, pais, generos } = radio;
    const systemPrompt = `Eres un experto en SEO y redactor de contenido para 'TuRadio.lat'. Tu tarea es escribir una descripción extensa (mínimo 600-700 palabras), atractiva y optimizada para motores de búsqueda (SEO) sobre una estación de radio específica.
Directrices estrictas:
1.  **SÉ CREATIVO:** DEBES INVENTAR una historia creíble para la radio, su tipo de programación, sus locutores más famosos, y su importancia cultural.
2.  **Extensión:** Entre 600 y 700 palabras.
3.  **Formato:** Solo el artículo.`;
    
    const userPrompt = `Escribe la descripción SEO creativa para: ${nombre}, País: ${pais}, Géneros: ${generos || 'música variada'}`;

    const payload = {
        modelId: MODEL_ID,
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify({
            anthropic_version: 'bedrock-2023-05-31',
            max_tokens: 2048,
            temperature: 0.75,
            system: systemPrompt,
            messages: [{ role: 'user', content: [{ type: 'text', text: userPrompt }] }]
        })
    };

    try {
        const command = new InvokeModelCommand(payload);
        const response = await client.send(command);
        const responseBody = JSON.parse(new TextDecoder().decode(response.body));
        if (responseBody.content && responseBody.content.length > 0) {
            return responseBody.content[0].text.trim();
        }
        return null;
    } catch (error) {
        console.error(`Error Bedrock Radio:`, error.message);
        return null;
    }
};


// ============================================================================
// 🎨 FUNCIÓN 2: GENERADOR DE PROMPT VISUAL (SDXL)
// ============================================================================

exports.generateImagePrompt = async (title, content) => {
    const textContext = content.length > 500 ? content.substring(0, 1500) : title;

    const systemPrompt = `You are an expert AI Art Director for a serious News Channel (like BBC or CNN). 
Your task is to write a single, highly descriptive prompt in English for an image generator (SDXL).

--- SAFETY & CENSORSHIP RULES ---
1. **ACCIDENTS/TRAGEDIES:** If the news is about a crash, murder, or death, DO NOT describe blood, gore, or bodies. Instead, describe: "Police tape, flashing ambulance lights, shattered glass on the floor, dramatic night lighting, tense atmosphere".
2. **REAL PEOPLE:** If the news mentions a famous person (e.g., Trump, Messi, Shakira), **USE THEIR FULL NAME** in the prompt so the AI generates their likeness.

--- STYLE GUIDELINES ---
- The image must be **PHOTOREALISTIC**, **OBJECTIVE** and **DRAMATIC**.
- NO TEXT in the image description (we will add text later).
- Focus on the **Subject** and the **Lighting**.
- Keywords to always include: "8k, masterpiece, press photography, cinematic lighting, hyperrealistic, shallow depth of field, bokeh background".

--- OUTPUT FORMAT ---
Just the prompt string in English. Nothing else.`;

    const userPrompt = `Generate an SDXL prompt for this news story:
Title: "${title}"
Context: "${textContext}..."`;

    const payload = {
        modelId: MODEL_ID,
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify({
            anthropic_version: 'bedrock-2023-05-31',
            max_tokens: 500, 
            temperature: 0.7, 
            system: systemPrompt,
            messages: [{ role: 'user', content: [{ type: 'text', text: userPrompt }] }]
        })
    };

    try {
        const command = new InvokeModelCommand(payload);
        const response = await client.send(command);
        const responseBody = JSON.parse(new TextDecoder().decode(response.body));
        
        if (responseBody.content && responseBody.content.length > 0) {
            let prompt = responseBody.content[0].text.trim();
            prompt = prompt.replace(/^(Here is the prompt:|Prompt:|SDXL Prompt:)/i, '').trim();
            prompt = prompt.replace(/^"|"$/g, '');
            console.log(`[Bedrock Image] Prompt generado: "${prompt.substring(0, 50)}..."`);
            return prompt;
        }
        return null;

    } catch (error) {
        console.error(`Error Bedrock Image Prompt:`, error.message);
        return `hyperrealistic news image about ${title}, cinematic lighting, 8k, dramatic`; 
    }
};


// ============================================================================
// 📰 FUNCIÓN 3: GENERADOR DE NOTICIAS (AJUSTADO PARA EXTENSIÓN)
// ============================================================================

exports.generateArticleContent = async (article) => {
    const { url, title, description, paisLocal } = article; 

    if (!url || !url.startsWith('http')) return null;

    console.log(`[BedrockClient] Leyendo URL a fondo: ${url}...`);
    const contenidoReal = await fetchUrlContent(url);

    let promptContexto = "";
    if (contenidoReal && contenidoReal.length > 600) {
        promptContexto = `CONTENIDO FUENTE COMPLETO:\n--- INICIO ---\n${contenidoReal}\n--- FIN ---`;
    } else {
        // Si la fuente es muy corta, avisamos a la IA para que investigue/contextualice
        promptContexto = `FUENTE LIMITADA (El scraper no pudo leer todo): Título: "${title}". Descripción: "${description}".`;
    }

    // --- PROMPT AGRESIVO PARA LONGITUD ---
    const systemPrompt = `Eres un Periodista Senior de Investigación. Tu trabajo NO es resumir, sino EXPANDIR y PROFUNDIZAR.

OBJETIVO: Redactar un artículo DETALLADO y LARGO (Mínimo 800 - 1200 palabras si la fuente lo permite).

--- REGLAS DE ORO ---
1. **LONGITUD:** Prohibido hacer artículos cortos. Si la fuente es breve, agrega contexto histórico, antecedentes políticos o económicos, y explica las implicaciones. ¡Escribe mucho!
2. **ESTILO:** Usa un tono formal, periodístico y atrapante. Estructura con Introducción fuerte, Desarrollo profundo y Conclusión.
3. **TITULARES:** - Título Viral: Atractivo pero serio (aprox 10 palabras).
   - Texto Imagen: SOLO 3 a 6 palabras clave. Ej: "Sube el Dólar en Argentina". NUNCA uses "Experto opina sobre".
4. **VERACIDAD:** No inventes datos falsos, pero sí puedes usar tu conocimiento general para explicar conceptos complejos mencionados en la noticia.

--- ESTRUCTURA DE SALIDA ---
LÍNEA 1: [CATEGORÍA] (politica, economia, deportes, tecnologia, entretenimiento, salud, internacional, general).
LÍNEA 2: TÍTULO VIRAL: [Título largo aquí]
LÍNEA 3: TEXTO IMAGEN: [Título corto aquí]
LÍNEA 4 en adelante: [CUERPO DEL ARTÍCULO EXTENSO]
`;

    const userPrompt = `Analiza esta fuente y escribe el artículo COMPLETO:
${promptContexto}`;

    const payload = {
        modelId: MODEL_ID,
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify({
            anthropic_version: 'bedrock-2023-05-31',
            max_tokens: 6000, // AUMENTADO DE 4000 A 6000
            temperature: 0.6, // UN POCO MÁS CREATIVO PARA QUE ESCRIBA MÁS
            system: systemPrompt,
            messages: [{ role: 'user', content: [{ type: 'text', text: userPrompt }] }]
        })
    };

    // ... (El resto del código de try/catch es igual, solo cambia el prompt y max_tokens)
    try {
        const command = new InvokeModelCommand(payload);
        const response = await client.send(command);
        const responseBody = JSON.parse(new TextDecoder().decode(response.body));

        if (responseBody.content && responseBody.content.length > 0) {
            let fullText = responseBody.content[0].text.trim();
            const lines = fullText.split('\n').filter(line => line.trim() !== '');
            
            if (lines.length < 4) return { categoria: "general", tituloViral: title, textoImagen: "NOTICIA DEL DÍA", articuloGenerado: fullText };
            
            let rawCat = lines[0];
            let categoria = cleanCategory(rawCat);
            let tituloViral = lines[1].replace(/^TÍTULO VIRAL:/i, '').replace(/^"|"$/g, '').trim();
            let textoImagen = lines[2].replace(/^TEXTO IMAGEN:/i, '').replace(/^"|"$/g, '').trim();
            
            if (textoImagen.length > 45) textoImagen = tituloViral.split(' ').slice(0, 4).join(' ');
            
            const articuloGenerado = lines.slice(3).join('\n').trim();
            
            return { categoria, tituloViral, textoImagen, articuloGenerado };
        }
        return null;
    } catch (error) {
        console.error(`Error Bedrock:`, error.message);
        return null; 
    }
};