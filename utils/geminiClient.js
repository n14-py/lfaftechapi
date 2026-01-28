// Archivo: lfaftechapi/utils/geminiClient.js
require('dotenv').config();
const { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } = require("@google/generative-ai");
const axios = require('axios');
const cheerio = require('cheerio');

// --- 1. Configuración de Gemini ---
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// USAREMOS 'gemini-pro'. ES EL MODELO ESTÁNDAR Y ESTABLE DEL PLAN GRATUITO.
const model = genAI.getGenerativeModel({ 
    model: "gemini-2.5-flash", // <--- CAMBIO CLAVE AQUÍ
    safetySettings: [
        { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
        { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
        { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
        { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
    ]
});

// ============================================================================
// 🛠️ HELPERS (Limpieza y Scraping)
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
        // Timeout de 15 segundos para asegurar lectura
        const { data } = await axios.get(url, { 
            timeout: 15000,
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

    // 2. Prompt Optimizado para Gemini Pro
    const prompt = `
    Actúa como un Periodista de renombre. Redacta una noticia completa en español basada en:
    
    ${promptContexto}

    --- INSTRUCCIONES ESTRICTAS ---
    1. EXTENSIÓN: Mínimo 800 palabras.
    2. ESTILO: Formal, objetivo y periodístico.
    3. IMPORTANTE: Genera la respuesta EXACTAMENTE con este formato de 4 líneas (sin markdown, sin negritas en los encabezados):

    [Categoría (una de: politica, economia, deportes, tecnologia, entretenimiento, salud, internacional, general)]
    TÍTULO VIRAL: [Título atractivo aquí]
    TEXTO IMAGEN: [Frase corta de 3 a 6 palabras, NO termines en preposición como 'de', 'a', 'en']
    [Aquí comienza el cuerpo del artículo completo...]
    `;

    try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const fullText = response.text().trim();
        
        const lines = fullText.split('\n').filter(line => line.trim() !== '');

        // Validación de formato
        if (lines.length < 4) {
             console.warn("[Gemini] Respuesta con formato inesperado. Usando modo seguro.");
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
        
        // Limpieza de seguridad del texto imagen
        if (textoImagen.length > 60 || textoImagen.length < 5 || textoImagen.includes(":")) {
             // Si falló la generación de la frase corta, usamos parte del título
             textoImagen = tituloViral.split(' ').slice(0, 4).join(' ');
        }

        const articuloGenerado = lines.slice(3).join('\n').trim();

        console.log(`[Gemini] ✅ Éxito: "${tituloViral.substring(0,30)}..."`);
        
        return {
            categoriaSugerida: categoria, 
            categoria: categoria,       
            tituloViral: tituloViral,
            textoImagen: textoImagen,
            articuloGenerado: articuloGenerado
        };

    } catch (error) {
        // Manejo de errores detallado
        console.error(`[ERROR FATAL GEMINI]`);
        console.error(`Mensaje: ${error.message}`);
        // Si el error es por filtros de seguridad, lo indicamos
        if (error.response && error.response.promptFeedback) {
            console.error("Bloqueo de seguridad:", error.response.promptFeedback);
        }
        return null;
    }
};

// ============================================================================
// 📻 GENERADOR DE RADIOS
// ============================================================================
exports.generateRadioDescription = async (radio) => {
    const prompt = `Escribe una descripción SEO creativa (600 palabras) para la radio "${radio.nombre}" de ${radio.pais}. Géneros: ${radio.generos}.`;
    try {
        const result = await model.generateContent(prompt);
        return result.response.text().trim();
    } catch (e) { return null; }
};

// ============================================================================
// 🎨 GENERADOR DE PROMPT IMAGEN (SDXL)
// ============================================================================
exports.generateImagePrompt = async (title, content) => {
    const prompt = `Create a single SDXL prompt in English for news: "${title}". Style: Photorealistic, 8k, cinematic lighting. Output ONLY the prompt string.`;
    try {
        const result = await model.generateContent(prompt);
        return result.response.text().replace(/^Prompt:/i, '').trim();
    } catch (e) { 
        return `hyperrealistic news image about ${title}, cinematic lighting, 8k`; 
    }
};