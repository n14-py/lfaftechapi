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
 * Convierte "Tecnología", "POLITICA", "[Deportes]" -> "tecnologia", "politica", "deportes"
 */
function cleanCategory(rawCategory) {
    if (!rawCategory) return "general";

    // 1. Quitar basura ([Categoría], "Texto", etc)
    let cleaned = rawCategory.toLowerCase()
        .replace('categoría:', '')
        .replace('categoria:', '')
        .replace(/\[|\]|"/g, '') // Quitar corchetes y comillas
        .trim();

    // 2. Quitar acentos (Á -> a, é -> e, ñ -> n)
    cleaned = cleaned.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

    // 3. Validar contra lista oficial
    const validCats = ["politica", "economia", "deportes", "tecnologia", "entretenimiento", "salud", "internacional", "general"];
    
    if (validCats.includes(cleaned)) {
        return cleaned;
    }
    
    // Fallback inteligente (si la IA inventó algo raro)
    return "general";
}

/**
 * Helper para descargar el contenido HTML de una URL
 */
async function fetchUrlContent(url) {
    try {
        // Intentamos descargar el HTML con un timeout de 5 segundos
        const { data } = await axios.get(url, { 
            timeout: 5000,
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36' }
        });
        
        const $ = cheerio.load(data);
        
        // Eliminamos scripts, estilos y basura
        $('script, style, nav, footer, header, iframe, .ads').remove();

        // Extraemos el texto de los párrafos
        let text = '';
        $('p').each((i, el) => {
            text += $(el).text() + '\n';
        });

        // Limpiamos y cortamos para no gastar tokens infinitos
        return text.trim().substring(0, 15000); 
    } catch (error) {
        console.warn(`[BedrockClient] No se pudo leer contenido de ${url}: ${error.message}`);
        return null; 
    }
}


// ============================================================================
// 📻 FUNCIÓN 1: GENERADOR DE RADIOS (ORIGINAL)
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
    // Usamos un fragmento del contenido para dar contexto
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
            // Limpieza extra por si acaso la IA contesta "Here is the prompt: ..."
            prompt = prompt.replace(/^(Here is the prompt:|Prompt:|SDXL Prompt:)/i, '').trim();
            // Quitamos comillas si las puso
            prompt = prompt.replace(/^"|"$/g, '');
            
            console.log(`[Bedrock Image] Prompt generado: "${prompt.substring(0, 50)}..."`);
            return prompt;
        }
        return null;

    } catch (error) {
        console.error(`Error Bedrock Image Prompt:`, error.message);
        // Fallback simple si falla la IA
        return `hyperrealistic news image about ${title}, cinematic lighting, 8k, dramatic`; 
    }
};


// ============================================================================
// 📰 FUNCIÓN 3: GENERADOR DE NOTICIAS (TEXTO + DATOS EXTRA)
// ============================================================================

exports.generateArticleContent = async (article) => {
    const { url, title, description, paisLocal } = article; 

    if (!url || !url.startsWith('http')) {
        console.error(`Error: URL inválida para "${title}".`);
        return null;
    }

    // 1. Intentamos leer el contenido real de la web
    console.log(`[BedrockClient] Leyendo URL: ${url}...`);
    const contenidoReal = await fetchUrlContent(url);

    let promptContexto = "";
    if (contenidoReal && contenidoReal.length > 300) {
        promptContexto = `FUENTE REAL (Úsala como verdad absoluta):\n--- INICIO ---\n${contenidoReal}\n--- FIN ---`;
    } else {
        promptContexto = `FUENTE LIMITADA (Completa con tu conocimiento general):\nTítulo: "${title}"\nDescripción: "${description || 'Sin descripción'}"\nPaís: "${paisLocal || 'Internacional'}"`;
    }

    // --- SYSTEM PROMPT MAESTRO (PROFESIONAL / NO-SENSACIONALISTA) ---
    const systemPrompt = `Eres el Editor Jefe de un medio internacional serio y profesional (estilo BBC, CNN o Reuters).
Tu misión es informar con VERACIDAD y OBJETIVIDAD. 

TU TAREA: Analiza la fuente y genera una respuesta con una ESTRUCTURA ESTRICTA de 4 partes.

--- ESTRUCTURA DE SALIDA OBLIGATORIA ---
LÍNEA 1: [CATEGORÍA] (Una sola palabra: politica, economia, deportes, tecnologia, entretenimiento, salud, internacional, general).
LÍNEA 2: TÍTULO VIRAL: [Un título atractivo para web, aprox 8-12 palabras, interesante pero sin mentir].
LÍNEA 3: TEXTO IMAGEN: [RESUMEN INFORMATIVO CORTO (3 a 5 palabras). 
    - OBJETIVO: Describir QUÉ pasa y DÓNDE/QUIÉN.
    - PROHIBIDO: Palabras genéricas como "CAOS TOTAL", "ALERTA", "ÚLTIMO MOMENTO", "MIRA ESTO".
    - FORMATO CORRECTO: "Sujeto + Verbo/Lugar".
    - EJEMPLOS BIEN: "Shakira en Paraguay", "Trump amenaza a Maduro", "Sismo en México", "Boca gana a River".
    - EJEMPLOS MAL: "Terrible Noticia", "No creerás esto", "Final Inesperado"].
LÍNEA 4 en adelante: [CUERPO DE LA NOTICIA] (Mínimo 500 palabras. Usa un tono periodístico formal, párrafos cortos, estructura clara).

--- REGLAS DE REDACCIÓN ---
1. Sé objetivo. Evita adjetivos exagerados (increíble, espantoso, milagroso).
2. NO inventes cifras ni fechas que no estén en la fuente.
3. El "TEXTO IMAGEN" es lo más importante: debe ser el titular resumido.
`;

    const userPrompt = `Procesa esta noticia: ${url}
    
${promptContexto}`;

    const payload = {
        modelId: MODEL_ID,
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify({
            anthropic_version: 'bedrock-2023-05-31',
            max_tokens: 4000, 
            temperature: 0.4, // Temperatura baja para ser más preciso y serio
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
            
            // Procesamos línea por línea
            const lines = fullText.split('\n').filter(line => line.trim() !== '');
            
            if (lines.length < 4) {
                console.warn("[Bedrock] La IA no respetó el formato estricto. Intentando recuperar...");
                // Fallback básico
                return { 
                    categoria: "general", 
                    tituloViral: title, 
                    textoImagen: title.substring(0, 20), // Usamos el título real cortado en vez de "URGENTE"
                    articuloGenerado: fullText 
                };
            }
            
            // 1. Extraer y LIMPIAR Categoría
            let rawCat = lines[0];
            let categoria = cleanCategory(rawCat);

            // 2. Extraer resto
            let tituloViral = lines[1].replace(/^TÍTULO VIRAL:/i, '').replace(/^"|"$/g, '').trim();
            let textoImagen = lines[2].replace(/^TEXTO IMAGEN:/i, '').replace(/^"|"$/g, '').trim();
            
            // Limpieza de seguridad por si la IA falla y pone algo muy largo
            if (textoImagen.length > 40) {
                 // Si es muy largo, tomamos las primeras 4 palabras del título viral
                 textoImagen = tituloViral.split(' ').slice(0, 4).join(' ');
            }
            
            const articuloGenerado = lines.slice(3).join('\n').trim();

            console.log(`[Bedrock] OK. Título: "${tituloViral.substring(0,30)}..." | Imagen: "${textoImagen}"`);
            
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