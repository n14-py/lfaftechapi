// Archivo: lfaftechapi/utils/geminiClient.js
require('dotenv').config();
const { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } = require("@google/generative-ai");
const axios = require('axios');
const cheerio = require('cheerio');

// --- 1. Configuración de Gemini ---
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Usamos el modelo Flash, que es rápido y eficiente para noticias
const model = genAI.getGenerativeModel({ 
    model: "gemini-1.5-flash",
    // Configuración de seguridad laxa para permitir noticias de crímenes/política sin censura excesiva
    safetySettings: [
        { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
        { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
        { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
        { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
    ]
});

// ============================================================================
// 🛠️ HELPERS (Mismos que tenías en Bedrock)
// ============================================================================

function cleanCategory(rawCategory) {
    if (!rawCategory) return "general";
    let cleaned = rawCategory.toLowerCase()
        .replace('categoría:', '').replace('categoria:', '')
        .replace(/\[|\]|"/g, '').trim()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const validCats = ["politica", "economia", "deportes", "tecnologia", "entretenimiento", "salud", "internacional", "general"];
    return validCats.includes(cleaned) ? cleaned : "general";
}

async function fetchUrlContent(url) {
    try {
        const { data } = await axios.get(url, { 
            timeout: 10000,
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36' }
        });
        const $ = cheerio.load(data);
        $('script, style, nav, footer, header, iframe, .ads, .menu, .sidebar').remove();
        let content = '';
        $('p').each((i, el) => { content += $(el).text().trim() + '\n\n'; });
        return content.trim().substring(0, 30000); 
    } catch (error) {
        console.warn(`[GeminiClient] Error leyendo URL: ${error.message}`);
        return null; 
    }
}

// ============================================================================
// 📰 FUNCIÓN PRINCIPAL: GENERADOR DE NOTICIAS
// ============================================================================

exports.generateArticleContent = async (article) => {
    const { url, title, description } = article; 

    // 1. Obtener contexto
    let contenidoReal = null;
    if (url && url.startsWith('http')) {
        console.log(`[GeminiClient] Leyendo URL: ${url}...`);
        contenidoReal = await fetchUrlContent(url);
    }

    let promptContexto = "";
    if (contenidoReal && contenidoReal.length > 500) {
        promptContexto = `CONTENIDO FUENTE:\n${contenidoReal}`;
    } else {
        promptContexto = `FUENTE LIMITADA: Título: "${title}". Descripción: "${description}".`;
    }

    // 2. Prompt (Adaptado de tu versión Bedrock)
    const prompt = `
    Eres un Periodista Senior. Redacta la noticia completa basada en la siguiente información.
    
    ${promptContexto}

    --- REQUISITOS ---
    1. EXTENSIÓN: Mínimo 800 palabras. Usa párrafos cortos.
    2. ESTILO: Periodístico, objetivo, formal pero ágil.
    3. FORMATO DE SALIDA EXACTO (Respeta los saltos de línea):
    LÍNEA 1: [Categoría (politica, economia, deportes, tecnologia, entretenimiento, salud, internacional, general)]
    LÍNEA 2: TÍTULO VIRAL: [Título atractivo]
    LÍNEA 3: TEXTO IMAGEN: [Frase de 3 a 6 palabras para la miniatura, SIN terminar en preposición]
    LÍNEA 4: [Cuerpo del artículo completo...]
    `;

    try {
        const result = await model.generateContent(prompt);
        const fullText = result.response.text().trim();
        
        const lines = fullText.split('\n').filter(line => line.trim() !== '');

        if (lines.length < 4) {
             console.warn("[Gemini] Respuesta corta o formato inválido. Usando fallback.");
             return { 
                 categoria: "general", 
                 tituloViral: title, 
                 textoImagen: title.split(' ').slice(0, 4).join(' '),
                 articuloGenerado: fullText 
             };
        }

        let categoria = cleanCategory(lines[0]);
        let tituloViral = lines[1].replace(/^TÍTULO VIRAL:/i, '').replace(/^"|"$/g, '').trim();
        let textoImagen = lines[2].replace(/^TEXTO IMAGEN:/i, '').replace(/^"|"$/g, '').trim();
        
        // Limpieza de seguridad del texto imagen (igual que en tu bedrockClient)
        if (textoImagen.length > 50 || textoImagen.length < 5) {
             textoImagen = tituloViral.split(' ').slice(0, 4).join(' ');
        }

        const articuloGenerado = lines.slice(3).join('\n').trim();

        console.log(`[Gemini] ✅ Noticia generada: "${tituloViral.substring(0,30)}..."`);
        
        return {
            categoriaSugerida: categoria, 
            categoria: categoria,       
            tituloViral: tituloViral,
            textoImagen: textoImagen,
            articuloGenerado: articuloGenerado
        };

    } catch (error) {
        console.error(`Error Gemini News:`, error.message);
        return null;
    }
};

// ============================================================================
// 📻 GENERADOR DE RADIOS (Opcional, si usas la función de syncRadios)
// ============================================================================
exports.generateRadioDescription = async (radio) => {
    const prompt = `Escribe una descripción SEO creativa y extensa (600 palabras) para la radio "${radio.nombre}" de ${radio.pais}. Géneros: ${radio.generos}. Inventa una historia sobre su impacto cultural si no tienes datos.`;
    try {
        const result = await model.generateContent(prompt);
        return result.response.text().trim();
    } catch (e) { return null; }
};

// ============================================================================
// 🎨 GENERADOR DE PROMPT IMAGEN (Para SDXL)
// ============================================================================
exports.generateImagePrompt = async (title, content) => {
    const prompt = `You are an AI Art Director. Create a single SDXL prompt in English for this news: "${title}". 
    Style: Photorealistic, 8k, cinematic lighting, press photography. 
    Context: ${content.substring(0, 200)}. 
    Output: ONLY the prompt string.`;
    
    try {
        const result = await model.generateContent(prompt);
        return result.response.text().replace(/^Prompt:/i, '').trim();
    } catch (e) { 
        return `hyperrealistic news image about ${title}, cinematic lighting, 8k`; 
    }
};