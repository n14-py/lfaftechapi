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
// Función para obtener el modelo con la clave actual
function getModel() {
    // Protección por si no hay keys
    if (apiKeys.length === 0) throw new Error("No API Keys available");

    const currentKey = apiKeys[currentKeyIndex];
    const genAI = new GoogleGenerativeAI(currentKey);
    
    // Usamos el modelo con los filtros apagados al máximo (BLOCK_NONE)
    return genAI.getGenerativeModel({ 
        model: "gemma-4-31b-it", 
        safetySettings: [
            { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
            { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
            { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
            { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
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
// 📰 FUNCIÓN PRINCIPAL: GENERADOR DE NOTICIAS (CON REINTENTOS BLINDADOS)
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
                             error.message.includes("400"); 

        if (isQuotaError) {
            console.warn(`⛔ [Gemini] Fallo en Key #${currentKeyIndex + 1} (Status: ${error.status || 'Quota/Auth'}). Detalle: ${error.message.substring(0, 40)}...`);
            
            // Si tenemos más claves y no hemos dado la vuelta completa
            if (retries < apiKeys.length) {
                rotateKey();
                console.log(`🔄 [Gemini] Reintentando generación con nueva clave... (Intento ${retries + 1})`);
                // Llamada recursiva con la nueva clave
                return await generateContentWithRetry(prompt, retries + 1);
            } else {
                console.error("❌ [Gemini] ¡TODAS LAS CLAVES AGOTADAS! Esperando 60 segundos antes de fallar...");
                // Espera de emergencia si todas las claves murieron para no colapsar el servidor
                await new Promise(resolve => setTimeout(resolve, 60000));
                throw new Error("Todas las cuotas de API agotadas.");
            }
        }
        throw error; // Si es otro error (ej. caída de internet), lo lanzamos
    }
}

// ============================================================================
// 📝 GENERADOR DE ARTÍCULOS LARGOS (PROTEGIDO CONTRA IA REBELDE)
// ============================================================================

exports.generateArticleContent = async (article) => {
    const { url, title, description } = article; 

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

    // PROMPT MEJORADO: Estilo intacto, reglas de formato reforzadas
    const prompt = `Actúa como un Periodista Senior. Escribe una noticia basada en:
${promptContexto}

--- REGLAS ESTRICTAS DE CONTENIDO ---
- NO inventar información
- NO agregar datos que no estén en el texto original
- NO crear citas falsas
- Mantener el mismo significado y hechos del contenido original
- Evitar exageraciones innecesarias (no usar "histórico", "sin precedentes", "hito" salvo que esté en la fuente)
- Redacción clara, informativa y coherente

--- REGLAS ESTRICTAS DE SALIDA (¡CRÍTICO!) ---
1. ¡PROHIBIDO PENSAR EN VOZ ALTA! NO generes borradores ("Drafting..."), ni repitas las reglas.
2. TU RESPUESTA DEBE SER ÚNICA Y EXCLUSIVAMENTE EL RESULTADO FINAL.
3. NO uses Markdown (negritas/cursivas) en tu respuesta.
4. ¡MUY IMPORTANTE! ESTÁ ESTRICTAMENTE PROHIBIDO usar prefijos como "Línea 1:", "Line 2:", "(L3)", "TÍTULO VIRAL:" o "TEXTO IMAGEN:". Escribe ÚNICAMENTE el valor directo en cada salto de línea.

Debes responder EXACTAMENTE con estas 5 líneas puras:

[Una categoría: politica, economia, deportes, tecnologia, entretenimiento, salud, internacional, general]
[Código ISO de 2 letras del país de la noticia. Ej: py, mx, bo, ar. Si es global pon general]
[Título llamativo pero basado en hechos reales, sin inventar]
[Frase de 3 a 5 palabras, visual, SIN preposiciones al final]
[Cuerpo de la noticia completo, mínimo 600 palabras...]`;

    try {
        const fullText = await generateContentWithRetry(prompt);
        let lines = fullText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
        
        let category = null, country = null, finalTitle = null, imageText = null;
        let bodyLines = [];
        const validCats = ["politica", "economia", "deportes", "tecnologia", "entretenimiento", "salud", "internacional", "general"];
        
        // --- PARSEO ORGÁNICO ---
        for (let i = 0; i < lines.length; i++) {
            let line = lines[i];
            let cleanLine = line.replace(/\(no bold\)/gi, '').replace(/\(no italics\)/gi, '').replace(/[\*\[\]]/g, '').trim();
            let cleanLower = cleanLine.toLowerCase();

            // 1. Detectar Categoría
            if (/^(line 1|l1|línea 1|categor[íi]a)/i.test(cleanLower)) {
                let catMatch = cleanLower.match(/(politica|economia|deportes|tecnologia|entretenimiento|salud|internacional|general)/);
                if (catMatch) category = catMatch[1];
                continue;
            }
            if (validCats.includes(cleanLower)) { category = cleanLower; continue; }

            // 2. Detectar País
            if (/^(line 2|l2|línea 2|pa[íi]s)/i.test(cleanLower)) {
                let pMatch = cleanLower.replace(/^(line 2|l2|línea 2|pa[íi]s)[:\s-]+/i, '').match(/\b([a-z]{2}|general)\b/);
                if (pMatch) country = pMatch[1];
                continue;
            }
            if (cleanLower.length === 2 && /^[a-z]{2}$/.test(cleanLower)) { country = cleanLower; continue; }

            // 3. Detectar Título
            if (/^(line \d|l\d|línea \d|t[íi]tulo)/i.test(cleanLower) && /t[íi]tulo/i.test(cleanLower)) {
                let t = cleanLine.replace(/^[\-\*\s]*(line \d|l\d|línea \d|t[íi]tulo[^:]*):?\s*/i, '').trim();
                if (t.length > 5 && !t.includes('...')) { finalTitle = t; continue; }
            }

            // 4. Detectar Imagen
            if (/^(line \d|l\d|línea \d|texto imagen|image text)/i.test(cleanLower) && /(imagen|image)/i.test(cleanLower)) {
                let img = cleanLine.replace(/^[\-\*\s]*(line \d|l\d|línea \d|texto imagen|image text[^:]*):?\s*/i, '').trim();
                if (img.length > 2 && !img.includes('...')) { imageText = img; continue; }
            }

            // 5. ASPIRADORA DE BASURA EN INGLÉS O BORRADORES
            if (/^(drafting|strategy|challenge|wait|intro|total|source|conflict|note|the prompt|check constraints):/i.test(cleanLower)) continue;
            if (/^\(start\)/i.test(cleanLower)) continue;
            if (/^\(the body\)/i.test(cleanLower)) continue;
            if (cleanLower.includes("no markdown") || cleanLower.includes("word count") || cleanLower.includes("exact 5-line") || cleanLower.includes("exact 4-line") || cleanLower.includes("no fake quotes") || cleanLower.includes("no inventing")) continue;
            if (/\b(is a noun|is a preposition|the rule says|i must keep|everything aligns|check constraints|minimum of \d+ words)\b/i.test(cleanLower)) continue;
            if (/^(line|línea|l)\s*\d:\s*(body|news body|\.\.\.)$/i.test(cleanLower)) continue;
            if (cleanLine.length < 50 && /\b(the|and|this|that|with|from)\b/i.test(cleanLower)) continue;

            bodyLines.push(cleanLine);
        }

        // SALVAVIDAS
        if (!finalTitle && bodyLines.length >= 2) {
            if (bodyLines[0].length < 150 && bodyLines[1].length < 60) {
                finalTitle = bodyLines.shift(); 
                imageText = bodyLines.shift();  
            }
        }
        
        if (!finalTitle) finalTitle = "Noticia de Última Hora";
        if (!imageText || imageText.length > 60) imageText = finalTitle.split(' ').slice(0, 4).join(' ');
        if (!country) country = "general";
        if (!category) category = "general";

        console.log(`✅ [Gemini] Noticia generada OK: [${country.toUpperCase()}] "${finalTitle.substring(0,30)}..."`);
        
        return {
            categoriaSugerida: category,
            categoria: category,
            pais: country,
            tituloViral: finalTitle,
            textoImagen: imageText,
            articuloGenerado: bodyLines.join('\n\n').trim()
        };
    } catch (error) {
        console.error(`❌ [Gemini] Error Crítico Final:`, error.message);
        return null;
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

    // PROMPT MEJORADO SHORTS
    const prompt = `Actúa como un Periodista Senior. Escribe una noticia basada en:
${promptContexto}

--- REGLAS ESTRICTAS DE CONTENIDO ---
- NO inventar información
- NO agregar datos que no estén en el texto original
- NO crear citas falsas
- Mantener el mismo significado y hechos del contenido original
- Evitar exageraciones innecesarias (no usar "histórico", "sin precedentes", "hito" salvo que esté en la fuente)
- Redacción clara, informativa y coherente

--- REGLAS ESTRICTAS DE SALIDA (¡CRÍTICO!) ---
1. ¡PROHIBIDO PENSAR EN VOZ ALTA! NO generes borradores, ni resúmenes en inglés.
2. TU RESPUESTA DEBE SER ÚNICA Y EXCLUSIVAMENTE EN ESPAÑOL CON EL RESULTADO FINAL.
3. NO uses Markdown (negritas/cursivas).
4. ¡MUY IMPORTANTE! ESTÁ ESTRICTAMENTE PROHIBIDO usar prefijos como "Línea 1:", "Line 2:", "(L3)", "TÍTULO PROFESIONAL:" o "TEXTO IMAGEN:". Escribe ÚNICAMENTE el valor directo en cada salto de línea.

Debes responder EXACTAMENTE con estas 4 líneas puras:

[Categoría real de la noticia. Ej: politica, economia, tecnologia, deportes, etc.]
[Título serio, informativo y conciso para la noticia]
[Frase visual de 3 a 5 palabras, SIN preposiciones al final]
[Cuerpo del guion completo. Redacción periodística. Largo sugerido: entre 250 a 350 palabras. Empieza con un gancho y termina con "Suscríbete a Noticias lat para más noticias."]`;

    try {
        const fullText = await generateContentWithRetry(prompt);
        let lines = fullText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
        
        let category = null, finalTitle = null, imageText = null;
        let bodyLines = [];
        const validCats = ["politica", "economia", "deportes", "tecnologia", "entretenimiento", "salud", "internacional", "general"];
        
        for (let i = 0; i < lines.length; i++) {
            let line = lines[i];
            let cleanLine = line.replace(/\(no bold\)/gi, '').replace(/\(no italics\)/gi, '').replace(/[\*\[\]]/g, '').trim();
            let cleanLower = cleanLine.toLowerCase();

            if (/^(line 1|l1|línea 1|categor[íi]a)/i.test(cleanLower)) {
                let catMatch = cleanLower.match(/(politica|economia|deportes|tecnologia|entretenimiento|salud|internacional|general)/);
                if (catMatch) category = catMatch[1];
                continue;
            }
            if (validCats.includes(cleanLower)) { category = cleanLower; continue; }

            if (/^(line \d|l\d|línea \d|t[íi]tulo)/i.test(cleanLower) && /t[íi]tulo/i.test(cleanLower)) {
                let t = cleanLine.replace(/^[\-\*\s]*(line \d|l\d|línea \d|t[íi]tulo[^:]*):?\s*/i, '').trim();
                if (t.length > 5 && !t.includes('...')) { finalTitle = t; continue; }
            }

            if (/^(line \d|l\d|línea \d|texto imagen|image text)/i.test(cleanLower) && /(imagen|image)/i.test(cleanLower)) {
                let img = cleanLine.replace(/^[\-\*\s]*(line \d|l\d|línea \d|texto imagen|image text[^:]*):?\s*/i, '').trim();
                if (img.length > 2 && !img.includes('...')) { imageText = img; continue; }
            }

            // ASPIRADORA
            if (/^(drafting|strategy|challenge|wait|intro|total|source|conflict|note|the prompt|check constraints):/i.test(cleanLower)) continue;
            if (/^\(start\)/i.test(cleanLower)) continue;
            if (/^\(the body\)/i.test(cleanLower)) continue;
            if (cleanLower.includes("no markdown") || cleanLower.includes("word count") || cleanLower.includes("exact 5-line") || cleanLower.includes("exact 4-line") || cleanLower.includes("no fake quotes") || cleanLower.includes("no inventing")) continue;
            if (/\b(is a noun|is a preposition|the rule says|i must keep|everything aligns|check constraints|minimum of \d+ words)\b/i.test(cleanLower)) continue;
            if (/^(line|línea|l)\s*\d:\s*(body|news body|guion|\.\.\.)$/i.test(cleanLower)) continue;
            if (cleanLine.length < 50 && /\b(the|and|this|that|with|from)\b/i.test(cleanLower)) continue;

            bodyLines.push(cleanLine);
        }

        if (!finalTitle && bodyLines.length >= 2) {
            if (bodyLines[0].length < 150 && bodyLines[1].length < 60) {
                finalTitle = bodyLines.shift();
                imageText = bodyLines.shift();
            }
        }
        
        if (!finalTitle) finalTitle = "Noticia de Última Hora";
        if (!imageText || imageText.length > 60) imageText = finalTitle.split(' ').slice(0, 4).join(' ');
        if (!category) category = "general";

        console.log(`✅ [Gemini Shorts] Guion generado OK: "${finalTitle.substring(0,30)}..."`);
        
        return {
            categoria: category,
            tituloViral: finalTitle,
            textoImagen: imageText,
            articuloGenerado: bodyLines.join('\n\n').trim()
        };
    } catch (error) {
        console.error(`❌ [Gemini Shorts] Error Final:`, error.message);
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
        const noticiaRecortada = textoLargo.substring(0, 4000);
        
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
        
        // PARCHE ANTI-BUCLE: Si la IA bloquea el contenido, enviamos una señal clara de muerte
        if (error.message && error.message.includes('PROHIBITED_CONTENT')) {
            console.error("  [Gemini Director] ⛔ CONTENIDO CENSURADO POR GOOGLE. Abortando noticia definitivamente.");
            return { error_fatal: "PROHIBITED_CONTENT" }; 
        }

        return null; // Error normal (ej. mal JSON), se puede reintentar
    }
};





// ============================================================================
// ⏱️ CREADOR DE ESCENAS PARA SHORTS (DIRECTOR VERTICAL ESTRICTO 85 SEGUNDOS)
// ============================================================================
exports.generateShortVideoScenesJSON = async (titulo, textoLargo, imagenPrincipal, articleId) => {
    // Tomamos menos contexto porque un Short es más resumido
    const contexto = textoLargo.substring(0, 3000);

    const prompt = `Eres el Director TÉCNICO de un canal de YouTube Shorts automatizado. Tu trabajo es transformar el texto de una noticia en un guion JSON estricto para un motor de renderizado FFmpeg vertical.

    NOTICIA A CONVERTIR:
    Título: "${titulo}"
    Texto: "${contexto}"
    Imagen Principal: "${imagenPrincipal}"

    REGLAS ABSOLUTAS Y CRÍTICAS (SI FALLAS, EL SISTEMA EXPLOTARÁ):
    1. El campo "text" en TODAS las escenas es ÚNICA Y EXCLUSIVAMENTE lo que el locutor va a decir en voz alta (TTS). ¡NUNCA pongas descripciones de cámara!
    2. Si la escena es "type": "pexels", es OBLIGATORIO incluir "termino_busqueda" con 2 o 3 palabras clave EN INGLÉS.
    3. Si la escena es "type": "body", NO incluyas "termino_busqueda", pero SÍ debes incluir "image_url" con la Imagen Principal.
    4. MAPAS: Si la noticia menciona un lugar clave, incluye MÁXIMO UNA escena con "type": "mapa" y la variable "ubicacion".
    5. CANTIDAD DE ESCENAS (¡CRÍTICO!): Debes generar EXACTAMENTE entre 9 y 10 escenas en total (1 intro y 8 o 9 de desarrollo). Esto es VITAL para que el Short dure exactamente 85 segundos.
    6. LONGITUD DEL TEXTO: La "intro" debe tener máximo 15 palabras. Las demás escenas deben tener EXACTAMENTE entre 20 y 25 palabras cada una. El total de palabras de todos los "text" sumados DEBE estar entre 210 y 220 palabras.
    7. DEVUELVE ÚNICAMENTE UN JSON VÁLIDO. SIN MARKDOWN, SIN TEXTO EXTRA.

    DICCIONARIO DE VARIABLES PERMITIDAS:
    - "type": "intro", "body", "pexels", "mapa".
    - "layout_category": "hombre", "mujer", "sin_presentador".
    - "voice": "hombre_1", "mujer_1".
    - "bgm_mood": "urgencia", "analisis", "tension".
    - "sfx_type": "impactos", "transiciones", "alertas", "tecnologia".

    FORMATO JSON EXACTO QUE DEBES REPLICAR:
    {
      "youtube_title": "Título llamativo para Shorts #shorts",
      "youtube_description": "Descripción optimizada...",
      "youtube_tags": ["tag1", "tag2", "shorts"],
      "scenes": [
         // ... AQUÍ TUS 9 a 10 ESCENAS ...
      ]
    }`;

    try {
        console.log(`  [Gemini Shorts Director] Calculando métricas... Creando JSON para Short de 85s...`);
        let jsonText = await generateContentWithRetry(prompt);
        
        jsonText = jsonText.replace(/\`\`\`json/gi, '').replace(/\`\`\`/g, '').trim();
        
        const inicioJson = jsonText.indexOf('{');
        const finJson = jsonText.lastIndexOf('}');
        
        if (inicioJson === -1 || finJson === -1) {
            throw new Error("La IA no devolvió llaves de JSON válidas.");
        }
        
        const jsonLimpio = jsonText.substring(inicioJson, finJson + 1);
        const payloadParseado = JSON.parse(jsonLimpio);
        
        const noticiaRecortada = textoLargo.substring(0, 800); // Descripción más corta para Shorts
        const urlArticulo = articleId ? `https://www.noticias.lat/articulo/${articleId}` : "https://noticias.lat";
        
        payloadParseado.youtube_description = `👉 ¡Suscríbete para más noticias!\n🌐 Lee la nota completa: ${urlArticulo}\n\n#shorts #noticias\n\n` + noticiaRecortada;

        // Parche anti "n" para FFmpeg
        if (payloadParseado.scenes) {
            payloadParseado.scenes.forEach(escena => {
                if (escena.text) {
                    escena.text = escena.text.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
                }
            });
        }

        return payloadParseado;

    } catch (error) {
        console.error(`  [Gemini Shorts Director] Error al crear JSON: ${error.message}`);
        if (error.message && error.message.includes('PROHIBITED_CONTENT')) {
            console.error("  [Gemini Shorts Director] ⛔ CONTENIDO CENSURADO. Abortando.");
            return { error_fatal: "PROHIBITED_CONTENT" }; 
        }
        return null;
    }
};




// ============================================================================
// 🧠 GENERADOR DE RESUMEN CORTO (CON ESCUDO ANTI-PENSAMIENTOS)
// ============================================================================
exports.generateSummaryWithGemini = async (textoLargo) => {
    // Limitamos el texto a 8000 caracteres para no gastar demasiados tokens innecesarios
    const contexto = textoLargo.substring(0, 8000);

    const prompt = `Actúa como un editor jefe de un periódico digital. Tu tarea es hacer un resumen conciso, directo y muy atractivo de la siguiente noticia.

NOTICIA:
"${contexto}"

--- REGLAS ESTRICTAS DE SALIDA (¡CRÍTICO!) ---
¡PROHIBIDO PENSAR EN VOZ ALTA! NO generes borradores, "scratchpads", procesos iterativos ("Drafting..."), ni repitas las restricciones ("Constraints:"). TU RESPUESTA DEBE SER ÚNICA Y EXCLUSIVAMENTE EL RESULTADO FINAL.
Tu respuesta debe ser un resumen de máximo 2 o 3 párrafos cortos.
Debes iniciar tu respuesta EXACTAMENTE con esta frase ancla (en mayúsculas):
RESUMEN FINAL:
[Escribe el resumen a continuación, sin asteriscos, sin negritas, sin viñetas y sin textos extra]`;

    try {
        console.log(`  [Gemini Resumen] Generando resumen inteligente (Evadiendo pensamientos)...`);
        
        // Llamada blindada con el sistema de rotación de Keys
        const fullText = await generateContentWithRetry(prompt);

        // Separamos por líneas limpias
        let lines = fullText.split('\n').filter(line => line.trim() !== '');

        // --- ESCUDO DEFINITIVO ANTI-PENSAMIENTOS ---
        // Buscamos de ABAJO hacia ARRIBA la palabra ancla
        const resumenIndex = lines.findLastIndex(l => l.toUpperCase().includes('RESUMEN FINAL:'));

        let resumenLimpio = "";
        if (resumenIndex !== -1) {
            // Nos quedamos solo con lo que está DEBAJO de "RESUMEN FINAL:" o en esa misma línea
            let tempLines = lines.slice(resumenIndex);
            
            // Borramos la palabra ancla para que solo quede el texto limpio
            tempLines[0] = tempLines[0].replace(/.*RESUMEN FINAL:\s*/i, '').replace(/[\*"]/g, '').trim();
            
            resumenLimpio = tempLines.join('\n\n').trim();
        } else {
            // Salvavidas: Si la IA rebelde ignoró el ancla, agarramos los últimos 3 párrafos (que suele ser el resultado final)
            console.warn("⚠️ [Gemini Resumen] No se encontró el ancla, usando fallback de últimos párrafos.");
            resumenLimpio = lines.slice(-3).join('\n\n').trim();
            resumenLimpio = resumenLimpio.replace(/[\*"]/g, ''); // Limpiar asteriscos
        }

        console.log(`✅ [Gemini Resumen] Resumen generado exitosamente.`);
        return resumenLimpio || null;

    } catch (error) {
        console.error(`❌ [Gemini Resumen] Error al generar resumen:`, error.message);
        return null; // Retornamos null para que el controlador no guarde errores en la Base de Datos
    }
};