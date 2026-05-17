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

    // 1. Obtener contexto (Scraping)
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

    // 2. Prompt Blindado (Muro anti-borradores)
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
¡PROHIBIDO PENSAR EN VOZ ALTA! NO generes borradores, "scratchpads", procesos iterativos ("Drafting..."), ni repitas las restricciones ("Constraints:"). TU RESPUESTA DEBE SER ÚNICA Y EXCLUSIVAMENTE EL RESULTADO FINAL.
Debes responder EXACTAMENTE con este formato de 4 líneas. NO pongas introducciones ni saludos, NO uses Markdown (negritas/cursivas) en los encabezados.

Línea 1: [Una categoría: politica, economia, deportes, tecnologia, entretenimiento, salud, internacional, general]
Línea 2: PAÍS: [Código ISO de 2 letras del país de la noticia. Ej: py, mx, bo, ar. Si es global pon general]
Línea 3: TÍTULO VIRAL: [Título llamativo pero basado en hechos reales, sin inventar]
Línea 4: TEXTO IMAGEN: [Frase de 3 a 5 palabras, visual, SIN preposiciones al final]
Línea 5: [Cuerpo de la noticia completo, mínimo 600 palabras...]`;

    try {
        // LLAMADA CON SISTEMA DE ROTACIÓN
        const fullText = await generateContentWithRetry(prompt);
        
        // Separamos por líneas usando 'let' UNA SOLA VEZ para evitar errores de sintaxis
 // Separamos por líneas usando 'let' UNA SOLA VEZ para evitar errores de sintaxis
        let lines = fullText.split('\n').filter(line => line.trim() !== '');

        // --- ESCUDO DEFINITIVO ANTI-PENSAMIENTOS (VERSIÓN BLINDADA) ---
        // 1. Buscamos el inicio REAL de la estructura, buscando variables comunes que la IA usa
        let inicioIndex = lines.findIndex(l => /^(L[íi]nea 1|Line 1|\- Line 1|Categor[íi]a):?/i.test(l.trim()));
        
        // Si no encuentra la Línea 1 explícita, probamos con la 2 o la 3
        if (inicioIndex === -1) {
            const paisIndex = lines.findIndex(l => /^(L[íi]nea 2|Line 2|\- Line 2|PAÍS|Country):?/i.test(l.trim()));
            if (paisIndex > 0) inicioIndex = paisIndex - 1;
        }
        if (inicioIndex === -1) {
            const titIndex = lines.findIndex(l => /^(L[íi]nea 3|Line 3|\- Line 3|TÍTULO VIRAL|Title):?/i.test(l.trim()));
            if (titIndex >= 2) inicioIndex = titIndex - 2;
        }

        // Recortamos la basura de arriba
        if (inicioIndex >= 0) {
            lines = lines.slice(inicioIndex); 
        }

        // Si después de limpiar quedó vacío o incompleto, aplicamos el salvavidas
        if (lines.length < 4) {
             console.warn("⚠️ [Gemini] Formato incorrecto o texto destruido, usando fallback simple.");
             return { 
                 categoria: "general", 
                 pais: "general",
                 tituloViral: title, 
                 textoImagen: title ? title.split(' ').slice(0, 4).join(' ') : "Noticia",
                 articuloGenerado: fullText.replace(/.*(Drafting|Strategy|Refining|Line \d:).*\n/gi, '').trim() 
             };
        }

        // 3. Limpieza de Extrema Precisión (Regex para extraer valores exactos)
        let categoria = cleanCategory(lines[0].replace(/^(\-\s*)?(L[íi]nea 1|Line 1|Categor[íi]a):\s*/i, '').replace(/[\*"]/g, ''));
        
        let paisIA = lines[1]
            .replace(/^(\-\s*)?(L[íi]nea 2|Line 2|PAÍS|Country):\s*/i, '')
            .replace(/[\*"]/g, '')
            .trim().toLowerCase().substring(0, 2);
        
        if (!paisIA) paisIA = 'general';
        
        let tituloViral = lines[2]
            .replace(/^(\-\s*)?(L[íi]nea 3|Line 3|TÍTULO VIRAL|Title):\s*/i, '')
            .replace(/[\*"]/g, '')
            .trim();
        
        let textoImagen = lines[3]
            .replace(/^(\-\s*)?(L[íi]nea 4|Line 4|TEXTO IMAGEN|Image):\s*/i, '')
            .replace(/[\*"]/g, '')
            .trim();
        
        if (textoImagen.length > 60 || textoImagen.length < 4) {
             textoImagen = tituloViral.split(' ').slice(0, 4).join(' ');
        }

        // 4. LIMPIEZA DEL CUERPO DE LA NOTICIA (Destruye los pensamientos residuales)
        let articuloLimpio = lines.slice(4).join('\n').trim();
        
        // Filtros agresivos para borrar los monólogos en inglés de la IA
        articuloGenerado = articuloLimpio
            .replace(/^(\-\s*)?(L[íi]nea 5|Line 5):\s*(Body|Cuerpo).*\n?/i, '') // Quita el "Line 5: Body"
            .replace(/\*Strategy to reach.*?\*/gi, '') // Quita las estrategias
            .replace(/\*Drafting the body:\*/gi, '') // Quita el drafting
            .replace(/\*Refining the text:\*/gi, '') // Quita el refining
            .replace(/\*Wait,.*?\*/gi, '') // Quita las dudas de la IA
            .replace(/\(Intro\)/gi, '') // Quita etiquetas de (Intro)
            .replace(/\(The crisis\)/gi, '') // Quita etiquetas de contexto
            .trim();

        console.log(`✅ [Gemini] Noticia generada OK: [${paisIA.toUpperCase()}] "${tituloViral.substring(0,30)}..."`);
        
        return {
            categoriaSugerida: categoria, 
            categoria: categoria, // Se guarda en tu campo 'categoria'
            pais: paisIA,         // REEMPLAZO: Usamos 'pais' para que caiga directo en tu BD
            tituloViral: tituloViral,
            textoImagen: tituloViral.split(' ').slice(0, 4).join(' '), // Salvavidas para el texto de imagen
            articuloGenerado: articuloGenerado
        };

    } catch (error) {
        console.error(`❌ [Gemini] Error Crítico Final:`, error.message);
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

--- REGLAS ESTRICTAS DE SALIDA (¡CRÍTICO!) ---
¡PROHIBIDO PENSAR EN VOZ ALTA! NO generes borradores, "scratchpads", ni resúmenes en inglés ("Source Content:"). TU RESPUESTA DEBE SER ÚNICA Y EXCLUSIVAMENTE EN ESPAÑOL CON EL RESULTADO FINAL.
Debes responder EXACTAMENTE con este formato de 4 líneas. NO pongas introducciones, NO uses Markdown (negritas/cursivas) en los encabezados.

Línea 1: [Categoría real de la noticia. Ej: Política, Economía, Tecnología, Deportes, etc.]

Línea 2: TÍTULO PROFESIONAL: [Título serio, informativo y conciso para la noticia]

Línea 3: TEXTO IMAGEN: [Frase visual de 3 a 5 palabras, SIN preposiciones al final]

Línea 4: [Cuerpo del guion completo. Redacción periodística. Largo sugerido: entre 250 a 350 palabras. Empieza con un gancho y termina con "Suscríbete a Noticias lat para más noticias."]
`;

    try {
        const fullText = await generateContentWithRetry(prompt);
 let lines = fullText.split('\n').filter(line => line.trim() !== '');

        // --- ESCUDO ANTI-PENSAMIENTOS PARA SHORTS (VERSIÓN BLINDADA) ---
        // 1. Buscamos el inicio REAL de la estructura
        let inicioIndex = lines.findIndex(l => /^(L[íi]nea 1|Line 1|\- Line 1|Categor[íi]a):?/i.test(l.trim()));
        
        if (inicioIndex === -1) {
            const titIndex = lines.findIndex(l => /^(L[íi]nea 2|Line 2|\- Line 2|TÍTULO PROFESIONAL|Title):?/i.test(l.trim()));
            if (titIndex > 0) inicioIndex = titIndex - 1;
        }

        // Recortamos la basura de arriba
        if (inicioIndex >= 0) {
            lines = lines.slice(inicioIndex); 
        }

        if (lines.length < 4) {
             console.warn("⚠️ [Gemini Shorts] Formato incorrecto o texto destruido, ignorando generación.");
             return null;
        }

        // 3. Limpieza de Extrema Precisión (Regex)
        let categoria = lines[0].replace(/^(\-\s*)?(L[íi]nea 1|Line 1|Categor[íi]a):\s*/i, '').replace(/[\*"]/g, '').trim();
        
        let tituloProfesional = lines[1]
            .replace(/^(\-\s*)?(L[íi]nea 2|Line 2|TÍTULO PROFESIONAL|Title):\s*/i, '')
            .replace(/[\*"]/g, '')
            .trim();
            
        let textoImagen = lines[2]
            .replace(/^(\-\s*)?(L[íi]nea 3|Line 3|TEXTO IMAGEN|Image):\s*/i, '')
            .replace(/[\*"]/g, '')
            .trim();

        // 4. LIMPIEZA DEL CUERPO DEL GUION
        let articuloLimpio = lines.slice(3).join('\n').trim();
        
        let articuloGenerado = articuloLimpio
            .replace(/^(\-\s*)?(L[íi]nea 4|Line 4):\s*(Body|Cuerpo|Guion).*\n?/i, '')
            .replace(/\*Strategy to reach.*?\*/gi, '')
            .replace(/\*Drafting the body:\*/gi, '')
            .replace(/\*Refining the text:\*/gi, '')
            .replace(/\*Wait,.*?\*/gi, '')
            .replace(/\(Intro\)/gi, '')
            .replace(/\(The crisis\)/gi, '')
            .trim();
        
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