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
        model: "gemini-2.5-flash", 
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

Línea 4: [Cuerpo de la noticia completo, mínimo 600 palabras...]
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
// 📱 NUEVA IA EXCLUSIVA PARA SHORTS (RESPETANDO CATEGORÍAS ORIGINALES)
// ============================================================================
exports.generateShortArticleContent = async (article) => {
    const { url, title, description } = article; 

    let contenidoReal = null;
    if (url && url.startsWith('http')) {
        contenidoReal = await fetchUrlContent(url);
    }

    let promptContexto = "";
    if (contenidoReal && contenidoReal.length > 500) {
        promptContexto = `CONTENIDO FUENTE COMPLETO:\n${contenidoReal}`;
    } else {
        promptContexto = `FUENTE LIMITADA: Título: "${title}". Descripción: "${description}".`;
    }

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

Línea 1: [Categoría real de la noticia. Ej: Política, Economía, Tecnología, Deportes, etc.]

Línea 2: TÍTULO PROFESIONAL: [Título serio, informativo y conciso para la noticia]

Línea 3: TEXTO IMAGEN: [Frase visual de 3 a 5 palabras, SIN preposiciones al final]

Línea 4: [Cuerpo del guion completo. Redacción periodística. Largo sugerido: entre 250 a 350 palabras. Empieza con un gancho y termina con "Suscríbete a Noticias lat para más noticias."]
`;

    try {
        const fullText = await generateContentWithRetry(prompt);
        const lines = fullText.split('\n').filter(line => line.trim() !== '');

        if (lines.length < 4) return null;

        // ¡AQUÍ ESTÁ LA CORRECCIÓN! Dejamos que la IA decida la categoría
        let categoria = lines[0].replace(/^(Categoría|Categoria):\s*/i, '').trim();
        let tituloProfesional = lines[1].replace(/^TÍTULO PROFESIONAL:/i, '').replace(/^"|"$/g, '').trim();
        let textoImagen = lines[2].replace(/^TEXTO IMAGEN:/i, '').replace(/^"|"$/g, '').trim();
        const articuloGenerado = lines.slice(3).join('\n').trim();
        
        return {
            categoria: categoria, // La IA manda aquí
            tituloViral: tituloProfesional,
            textoImagen: textoImagen,
            articuloGenerado: articuloGenerado
        };

    } catch (error) {
        console.error(`[Gemini Shorts] Error Final:`, error.message);
        return null;
    }
};
// ============================================================================
// CREADOR DE ESCENAS PARA VIDEOS HORIZONTALES LARGOS (DIRECTOR DE TV ESTRICTO)
// ============================================================================
exports.generateVideoScenesJSON = async (titulo, textoLargo, imagenPrincipal, articleId) => {
        const contexto = textoLargo.substring(0, 8000);

    const prompt = `Eres el Director TÉCNICO de un noticiero de TV automatizado. Tu trabajo es transformar el texto de una noticia en un guion JSON estricto para un motor de renderizado FFmpeg.

    NOTICIA A CONVERTIR:
    Título: "${titulo}"
    Texto: "${contexto}"
    Imagen Principal: "${imagenPrincipal}"

    REGLAS ABSOLUTAS Y CRÍTICAS (SI FALLAS, EL SISTEMA EXPLOTARÁ):
    1. El campo "text" en TODAS las escenas es ÚNICA Y EXCLUSIVAMENTE lo que el locutor va a decir en voz alta (TTS). ¡NUNCA pongas descripciones de cámara o direcciones escénicas!
    2. Si la escena es "type": "pexels", es OBLIGATORIO incluir el campo "termino_busqueda" con 2 o 3 palabras clave EN INGLÉS (ejemplo: "happy tourists", "ecuador beach", "economy graph").
    3. Si la escena es "type": "body", NO incluyas "termino_busqueda", pero SÍ debes incluir "image_url" con la Imagen Principal.
    4. MAPAS: Si la noticia menciona una ciudad, país o región clave, incluye MÁXIMO UNA escena con "type": "mapa" y agrega la variable "ubicacion" (ej: "Santa Elena, Ecuador").
    5. LONGITUD DEL TEXTO: El campo "text" de cada escena debe tener entre 19 y 24 palabras. Redacta de forma analítica y profunda para estirar la información real en varias escenas sin mentir. La ÚNICA excepción es la "intro", que debe ser una frase corta de impacto (máximo 15 palabras).
    6. CANTIDAD DE ESCENAS (¡CRÍTICO!): Debes generar OBLIGATORIAMENTE entre 15 y 21 escenas en total. Si el texto original es corto, expande la noticia explicando el contexto, las causas o las consecuencias para alcanzar el mínimo de escenas. ¡TIENES ESTRICTAMENTE PROHIBIDO inventar nombres, cifras, fechas o datos falsos! Usa solo los hechos reales.
    7. DEVUELVE ÚNICAMENTE UN JSON VÁLIDO. SIN MARKDOWN, SIN TEXTO EXTRA.

    DICCIONARIO DE VARIABLES PERMITIDAS (PROHIBIDO USAR "outro" O INVENTAR VARIABLES):
    - "type": "intro", "body", "pexels", "mapa".
    - "layout_category": "hombre", "mujer", "sin_presentador".
    - "voice": "hombre_1", "mujer_1".
    - "bgm_mood": "urgencia", "analisis", "tension".
    - "sfx_type": "impactos", "transiciones", "alertas", "tecnologia".

    FORMATO JSON EXACTO QUE DEBES REPLICAR (Imita esta estructura y la longitud de los textos largos):
    {
      "youtube_title": "Título llamativo para YouTube",
      "youtube_description": "Descripción optimizada...",
      "youtube_tags": ["tag1", "tag2"],
      "scenes": [
        {
          "type": "intro",
          "text": "¡El turismo rompe todos los récords históricos durante este último feriado nacional!",
          "voice": "hombre_1",
          "bgm_mood": "urgencia",
          "sfx_type": "impactos"
        },
        {
          "type": "body",
          "image_url": "${imagenPrincipal}",
          "layout_category": "hombre",
          "text": "Las cifras oficiales emitidas por las autoridades confirman un aumento masivo de viajeros en todo el país durante este fin de semana largo. La reactivación económica se ha sentido con fuerza en múltiples sectores, demostrando la enorme capacidad de recuperación que tiene la industria turística local frente a los recientes desafíos.",
          "voice": "hombre_1",
          "bgm_mood": "analisis",
          "sfx_type": "transiciones"
        },
        {
          "type": "pexels",
          "termino_busqueda": "tourists beach sunny",
          "layout_category": "sin_presentador",
          "text": "Destinos costeros y de montaña alcanzaron una impresionante ocupación hotelera del cien por ciento, superando todas las expectativas económicas trazadas por los gremios. Restaurantes, comercios locales y empresas de transporte reportaron ingresos que no se veían desde hace varios años, inyectando vitalidad a las comunidades receptoras.",
          "voice": "mujer_1",
          "bgm_mood": "tension",
          "sfx_type": "alertas"
        }
      ]
    }`;

    try {
        console.log(`  [Gemini Director] Convirtiendo texto largo a JSON de escenas estricto...`);
        let jsonText = await generateContentWithRetry(prompt);
        
        jsonText = jsonText.replace(/\`\`\`json/gi, '').replace(/\`\`\`/g, '').trim();
        
        const inicioJson = jsonText.indexOf('{');
        const finJson = jsonText.lastIndexOf('}');
        
        if (inicioJson === -1 || finJson === -1) {
            throw new Error("La IA no devolvió llaves de JSON válidas.");
        }
        
        const jsonLimpio = jsonText.substring(inicioJson, finJson + 1);
        const payloadParseado = JSON.parse(jsonLimpio);
        
        // --- INYECCIÓN DE DESCRIPCIÓN PARA YOUTUBE ---
        // Cortamos el texto original a 4500 caracteres para no pasarnos del límite de 5000 de YouTube
        const noticiaRecortada = textoLargo.substring(0, 4500);
        
        // Armamos la URL específica de la noticia
        const urlArticulo = articleId ? `https://www.noticias.lat/articulo/${articleId}` : "https://noticias.lat";
        
        payloadParseado.youtube_description = `👉 ¡Suscríbete al canal para no perderte ninguna noticia!\n🌐 Lee la noticia completa aquí: ${urlArticulo}\n\n` + noticiaRecortada;

        
        // --- PARCHE ANTI "n" PARA FFMPEG ---
        // Buscamos cualquier salto de línea oculto (\n) y lo cambiamos por un espacio normal
        if (payloadParseado.scenes) {
            payloadParseado.scenes.forEach(escena => {
                if (escena.text) {
                    escena.text = escena.text.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
                }
            });
        }
        // -----------------------------------

        return payloadParseado;

    } catch (error) {
        console.error(`  [Gemini Director] Error al crear/parsear escenas JSON: ${error.message}`);
        return null;
    }
};