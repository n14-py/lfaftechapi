// Archivo: lfaftechapi/utils/geminiClient.js
require('dotenv').config();
const { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } = require("@google/generative-ai");
const axios = require('axios');
const cheerio = require('cheerio');

// ============================================================================
// 🔐 GESTIÓN DE CLAVES ROTATIVAS (MULTI-CUENTA INDIVIDUAL)
// ============================================================================

// 1. Cargamos las keys UNA POR UNA (Más seguro que split por comas)
const RAW_KEYS = [
    process.env.GEMINI_API_KEY,
    process.env.GEMINI_API_KEY_2,
    process.env.GEMINI_API_KEY_3,
    process.env.GEMINI_API_KEY_4,
    process.env.GEMINI_API_KEY_5
];

// Filtramos para quitar las que estén vacías o undefined
const apiKeys = RAW_KEYS.filter(key => key && key.trim().length > 10);

if (apiKeys.length === 0) {
    console.error("❌ [Gemini Manager] FATAL: No hay claves en .env (GEMINI_API_KEY, _2, _3...)");
} else {
    console.log(`✅ [Gemini Manager] Cargadas ${apiKeys.length} cuentas de API para rotación.`);
}

let currentKeyIndex = 0;

// Función para obtener el modelo con la clave actual
function getModel() {
    // Protección por si no hay keys
    if (apiKeys.length === 0) throw new Error("No API Keys available");

    const currentKey = apiKeys[currentKeyIndex];
    const genAI = new GoogleGenerativeAI(currentKey);
    
    // Usamos el modelo 2.5 Flash (o 1.5-flash si prefieres)
    return genAI.getGenerativeModel({ 
        model: "gemma-3-27b-it", // Recomiendo 1.5-flash por estabilidad en free tier
        safetySettings: [
            { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
            { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
            { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
            { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
        ]
    });
}

// Función para rotar la clave si se agota la cuota
function rotateKey() {
    if (apiKeys.length <= 1) return; // No rotar si solo hay una
    currentKeyIndex = (currentKeyIndex + 1) % apiKeys.length;
    console.log(`🔄 [Gemini Manager] Cambiando a API Key #${currentKeyIndex + 1} por límite de cuota.`);
}

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
        console.warn(`⚠️ [GeminiClient] No se pudo leer URL (${url}): ${error.message}`);
        return null; 
    }
}

// ============================================================================
// 📰 FUNCIÓN PRINCIPAL: GENERADOR DE NOTICIAS (CON REINTENTOS)
// ============================================================================

async function generateContentWithRetry(prompt, retries = 0) {
    try {
        const model = getModel();
        const result = await model.generateContent(prompt);
        return result.response.text();
    } catch (error) {
        // Detectar error 429 (Too Many Requests), 400 (Bad Request/Key) o errores de cuota
        const isQuotaError = error.message.includes("429") || 
                             error.message.includes("Quota exceeded") || 
                             error.message.includes("Resource has been exhausted") ||
                             error.message.includes("API key not valid") || 
                             error.message.includes("400"); // Agregué 400 por si acaso

        if (isQuotaError) {
            console.warn(`⛔ [Gemini] Fallo en Key #${currentKeyIndex + 1} (Status: ${error.status || 'Quota/Auth'}).`);
            
            // Si tenemos más claves y no hemos dado la vuelta completa a todas las claves
            if (retries < apiKeys.length) {
                rotateKey();
                console.log(`🔄 [Gemini] Reintentando generación con nueva clave... (Intento ${retries + 1})`);
                // Llamada recursiva con la nueva clave
                return await generateContentWithRetry(prompt, retries + 1);
            } else {
                console.error("❌ [Gemini] ¡TODAS LAS CLAVES AGOTADAS! Esperando 60 segundos antes de fallar...");
                // Espera de emergencia si todas las claves murieron
                await new Promise(resolve => setTimeout(resolve, 60000));
                throw new Error("Todas las cuotas de API agotadas.");
            }
        }
        throw error; // Si es otro error (ej. red), lo lanzamos
    }
}

exports.generateArticleContent = async (article) => {
    const { url, title, description } = article; 

    // 1. Obtener contexto (Scraping)
    let contenidoReal = null;
    if (url && url.startsWith('http')) {
        // console.log(`[GeminiClient] Leyendo: ${title.substring(0, 20)}...`);
        contenidoReal = await fetchUrlContent(url);
    }

    let promptContexto = "";
    if (contenidoReal && contenidoReal.length > 500) {
        promptContexto = `CONTENIDO FUENTE:\n${contenidoReal}`;
    } else {
        promptContexto = `FUENTE LIMITADA: Título: "${title}". Descripción: "${description}".`;
    }

    // 2. Prompt (Optimizado para que no falle el formato)
const prompt = `
Actúa como un Periodista Senior. Escribe una noticia basada en:
${promptContexto}

--- REGLAS ESTRICTAS DE CONTENIDO ---
- NO inventar información
- NO agregar datos que no estén en el texto original
- NO crear citas falsas
- Mantener el mismo significado y hechos del contenido original
- Evitar exageraciones innecesarias (no usar "histórico", "sin precedentes", "hito" salvo que esté en la fuente)
- Redacción clara, informativa y coherente

--- REGLAS ESTRICTAS DE SALIDA ---
Debes responder EXACTAMENTE con este formato de 4 líneas. NO pongas introducciones, NO uses Markdown (negritas/cursivas) en los encabezados.

Línea 1: [Una categoría: politica, economia, deportes, tecnologia, entretenimiento, salud, internacional, general]

Línea 2: TÍTULO VIRAL: [Título llamativo pero basado en hechos reales, sin inventar]

Línea 3: TEXTO IMAGEN: [Frase de 3 a 5 palabras, visual, SIN preposiciones al final]

Línea 4: [Cuerpo de la noticia completo, mínimo 500 palabras...]
`;

    try {
        // LLAMADA CON SISTEMA DE ROTACIÓN
        const fullText = await generateContentWithRetry(prompt);
        
        const lines = fullText.split('\n').filter(line => line.trim() !== '');

        if (lines.length < 4) {
             console.warn("[Gemini] Formato incorrecto, usando fallback simple.");
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
        if (textoImagen.length > 60 || textoImagen.length < 4) {
             textoImagen = tituloViral.split(' ').slice(0, 4).join(' ');
        }

        const articuloGenerado = lines.slice(3).join('\n').trim();

        console.log(`📝 [Gemini] Noticia generada OK: "${tituloViral.substring(0,30)}..."`);
        
        return {
            categoriaSugerida: categoria, 
            categoria: categoria,       
            tituloViral: tituloViral,
            textoImagen: textoImagen,
            articuloGenerado: articuloGenerado
        };

    } catch (error) {
        console.error(`[Gemini] Error Final:`, error.message);
        return null;
    }
};

// ============================================================================
// 📻 GENERADOR DE RADIOS (También con rotación)
// ============================================================================
exports.generateRadioDescription = async (radio) => {
    const prompt = `Escribe una descripción SEO creativa (600 palabras) para la radio "${radio.nombre}" de ${radio.pais}. Géneros: ${radio.generos}.`;
    try {
        return await generateContentWithRetry(prompt);
    } catch (e) { return null; }
};

// ============================================================================
// 🎨 GENERADOR DE PROMPT IMAGEN
// ============================================================================
exports.generateImagePrompt = async (title, content) => {
    const prompt = `Create a single SDXL prompt in English for news: "${title}". Style: Photorealistic, 8k, cinematic lighting. Output ONLY the prompt string.`;
    try {
        const text = await generateContentWithRetry(prompt);
        return text.replace(/^Prompt:/i, '').trim();
    } catch (e) { 
        return `hyperrealistic news image about ${title}, cinematic lighting, 8k`; 
    }
};













// ============================================================================
// 📱 NUEVA IA EXCLUSIVA PARA SHORTS (AISLADA PERO IDÉNTICA EN FORMATO)
// ============================================================================
exports.generateShortArticleContent = async (article) => {
    const { url, title, description } = article; 

    // 1. Obtener contexto (Scraping) - IDÉNTICO AL ORIGINAL
    let contenidoReal = null;
    if (url && url.startsWith('http')) {
        contenidoReal = await fetchUrlContent(url);
    }

    let promptContexto = "";
    if (contenidoReal && contenidoReal.length > 500) {
        promptContexto = `CONTENIDO FUENTE:\n${contenidoReal}`;
    } else {
        promptContexto = `FUENTE LIMITADA: Título: "${title}". Descripción: "${description}".`;
    }

    // 2. Prompt (Reglas exactas del original, pero adaptado a Shorts)
    const prompt = `
Actúa como un Periodista Senior experto en YouTube Shorts y TikTok. Escribe el guion de una noticia corta basada en:
${promptContexto}

--- REGLAS ESTRICTAS DE CONTENIDO ---
- NO inventar información
- NO agregar datos que no estén en el texto original
- NO crear citas falsas
- Mantener el mismo significado y hechos del contenido original
- Evitar exageraciones innecesarias (no usar "histórico", "sin precedentes", "hito" salvo que esté en la fuente)
- Redacción clara, pero ULTRA DINÁMICA y directa al grano.

--- REGLAS ESTRICTAS DE SALIDA ---
Debes responder EXACTAMENTE con este formato de 4 líneas. NO pongas introducciones, NO uses Markdown (negritas/cursivas) en los encabezados.

Línea 1: Shorts

Línea 2: TÍTULO VIRAL: [Título llamativo y muy corto para el Short, basado en hechos reales]

Línea 3: TEXTO IMAGEN: [Frase de 3 a 5 palabras, visual, SIN preposiciones al final]

Línea 4: [Cuerpo del guion completo. MÁXIMO 250 palabras. Empieza con un gancho fuerte y termina OBLIGATORIAMENTE con la frase "Suscríbete a Noticias.lat para más noticias."]
`;

    try {
        // LLAMADA CON SISTEMA DE ROTACIÓN (Idéntico al original)
        const fullText = await generateContentWithRetry(prompt);
        
        const lines = fullText.split('\n').filter(line => line.trim() !== '');

        if (lines.length < 4) {
             console.warn("[Gemini Shorts] Formato incorrecto, usando fallback simple.");
             return { 
                 categoria: "Shorts", 
                 tituloViral: title, 
                 textoImagen: title.split(' ').slice(0, 4).join(' '),
                 articuloGenerado: fullText 
             };
        }

        let categoria = "Shorts"; // Forzamos la categoría
        let tituloViral = lines[1].replace(/^TÍTULO VIRAL:/i, '').replace(/^"|"$/g, '').trim();
        let textoImagen = lines[2].replace(/^TEXTO IMAGEN:/i, '').replace(/^"|"$/g, '').trim();
        
        // Limpieza de seguridad del texto imagen (Idéntico al original)
        if (textoImagen.length > 60 || textoImagen.length < 4) {
             textoImagen = tituloViral.split(' ').slice(0, 4).join(' ');
        }

        const articuloGenerado = lines.slice(3).join('\n').trim();

        console.log(`📱 [Gemini Shorts] Guion generado OK: "${tituloViral.substring(0,30)}..."`);
        
        return {
            categoriaSugerida: categoria, 
            categoria: categoria,       
            tituloViral: tituloViral,
            textoImagen: textoImagen,
            articuloGenerado: articuloGenerado
        };

    } catch (error) {
        console.error(`[Gemini Shorts] Error Final:`, error.message);
        return null;
    }
};