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
            timeout: 8000, // Aumentamos un poco el tiempo de espera por si la web es lenta
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36' }
        });
        
        const $ = cheerio.load(data);
        $('script, style, nav, footer, header, iframe, .ads').remove();

        let text = '';
        $('p').each((i, el) => {
            text += $(el).text() + '\n\n'; // Doble salto de línea para separar párrafos claramente
        });

        // Aumentamos el límite de lectura a 25000 caracteres para no cortar noticias largas
        return text.trim().substring(0, 25000); 
    } catch (error) {
        console.warn(`[BedrockClient] No se pudo leer contenido de ${url}: ${error.message}`);
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

    if (!url || !url.startsWith('http')) {
        console.error(`Error: URL inválida para "${title}".`);
        return null;
    }

    console.log(`[BedrockClient] Leyendo URL: ${url}...`);
    const contenidoReal = await fetchUrlContent(url);

    let promptContexto = "";
    if (contenidoReal && contenidoReal.length > 300) {
        promptContexto = `FUENTE REAL (Texto completo del artículo original):\n--- INICIO ---\n${contenidoReal}\n--- FIN ---`;
    } else {
        promptContexto = `FUENTE LIMITADA (Completa con contexto inteligente):\nTítulo: "${title}"\nDescripción: "${description || 'Sin descripción'}"\nPaís: "${paisLocal || 'Internacional'}"`;
    }

    // --- SYSTEM PROMPT MAESTRO (VERSIÓN LARGA Y DETALLADA) ---
    // --- SYSTEM PROMPT MAESTRO (AQUÍ ESTÁ LA MAGIA) ---
    const systemPrompt = `Eres el Editor Jefe de un diario internacional de alto nivel.
TU OBJETIVO PRINCIPAL: Leer TODO el contenido fuente y generar titulares PRECISOS y artículos COMPLETOS.

--- INSTRUCCIONES PARA "TEXTO IMAGEN" (CRUCIAL) ---
Este texto va en la portada. Si fallas aquí, la noticia no sirve.
1. **LEE LA NOTICIA ENTERA** para entender de qué se trata realmente.
2. **PROHIBIDO:** - NO uses frases incompletas que terminen en "de", "el", "sobre", "que".
   - NO escribas "Experto habla sobre...", "Lo que se sabe de...", "Increíble suceso".
   - NO uses clickbait barato.
3. **OBLIGATORIO - LA FÓRMULA DE 3 A 6 PALABRAS:**
   - Debe ser [SUJETO] + [ACCIÓN/LUGAR].
   - Debe tener sentido por sí mismo.
   - EJEMPLOS CORRECTOS: "Shakira Llega a Paraguay", "Trump Amenaza a Maduro", "Caída del Dólar en Argentina", "Putin Advierte a la OTAN".
   - EJEMPLO INCORRECTO: "El presidente dijo que", "Situación en la frontera de".

--- INSTRUCCIONES DE REDACCIÓN (IMPORTANTE) ---
1. **ADAPTABILIDAD:** Si la fuente original es EXTENSA y detallada, tu artículo DEBE SER LARGO. No resumas; mantén todos los detalles y profundidad.
2. Si la fuente es CORTA, escribe algo conciso pero agrega contexto (antecedentes reales) para que se entienda mejor. NO inventes hechos.
3. Escribe con tus propias palabras (parafraseo profesional).

--- ESTRUCTURA DE SALIDA (NO ROMPER) ---
LÍNEA 1: [CATEGORÍA] (Una sola palabra: politica, economia, deportes, tecnologia, entretenimiento, salud, internacional, general).
LÍNEA 2: TÍTULO VIRAL: [Título web completo, 8-13 palabras, basado en el contenido real].
LÍNEA 3: TEXTO IMAGEN: [Tu mejor titular corto de 3-6 palabras. REVISA QUE NO TERMINE EN PREPOSICIÓN].
LÍNEA 4 en adelante: [CUERPO DEL ARTÍCULO]
`;

    const userPrompt = `Procesa esta noticia para su publicación: ${url}
    
${promptContexto}`;

    const payload = {
        modelId: MODEL_ID,
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify({
            anthropic_version: 'bedrock-2023-05-31',
            max_tokens: 4000, 
            temperature: 0.5, // Subimos un poco la temperatura para que parafrasee mejor y escriba más fluido
            system: systemPrompt,
            messages: [{ role: 'user', content: [{ type: 'text', text: userPrompt }] }]
        })
    };

    try {
        const command = new InvokeModelCommand(payload);
        const response = await client.send(command);
        const responseBody = JSON.parse(new TextDecoder().decode(response.body));

        if (responseBody.content && responseBody.content.length > 0) {
            let fullText = responseBody.content[0].text.trim();
            const lines = fullText.split('\n').filter(line => line.trim() !== '');
            
            if (lines.length < 4) {
                console.warn("[Bedrock] Fallo de formato. Recuperando...");
                return { 
                    categoria: "general", 
                    tituloViral: title, 
                    textoImagen: title.substring(0, 20),
                    articuloGenerado: fullText 
                };
            }
            
            let rawCat = lines[0];
            let categoria = cleanCategory(rawCat);
            let tituloViral = lines[1].replace(/^TÍTULO VIRAL:/i, '').replace(/^"|"$/g, '').trim();
            let textoImagen = lines[2].replace(/^TEXTO IMAGEN:/i, '').replace(/^"|"$/g, '').trim();
            
            if (textoImagen.length > 40) {
                 textoImagen = tituloViral.split(' ').slice(0, 4).join(' ');
            }
            
            const articuloGenerado = lines.slice(3).join('\n').trim();

            console.log(`[Bedrock] OK. Título: "${tituloViral.substring(0,30)}..." | Longitud: ${articuloGenerado.length} chars`);
            
            return {
                categoriaSugerida: categoria, 
                categoria: categoria,       
                tituloViral: tituloViral,
                textoImagen: textoImagen,
                articuloGenerado: articuloGenerado
            };
        }
        return null;

    } catch (error) {
        console.error(`Error Bedrock News:`, error.message);
        return null; 
    }
};