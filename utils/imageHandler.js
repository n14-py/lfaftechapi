const axios = require('axios');
const sharp = require('sharp');
const { v4: uuidv4 } = require('uuid');

// --- CARGAR VARIABLES DE ENTORNO ---
const DEEPINFRA_API_KEY = process.env.DEEPINFRA_API_KEY; 
const BUNNY_STORAGE_KEY = process.env.BUNNY_STORAGE_API_KEY; 
const BUNNY_STORAGE_ZONE = process.env.BUNNY_STORAGE_ZONE; 
const BUNNY_CDN_URL = process.env.BUNNY_CDN_URL; 

// Configuración de la imagen (YouTube Horizontal)
const IMG_WIDTH = 1280;
const IMG_HEIGHT = 720;

// =============================================================================
// 🌎 DICCIONARIO DE CÓDIGOS ISO (Para respaldo si no viene código)
// =============================================================================
const FLAG_CODES = {
    "paraguay": "py", "py": "py", "asunción": "py",
    "argentina": "ar", "ar": "ar", "buenos aires": "ar",
    "brasil": "br", "br": "br", "rio de janeiro": "br", "sao paulo": "br",
    "estados unidos": "us", "usa": "us", "eeuu": "us", "trump": "us", "biden": "us",
    "venezuela": "ve", "ve": "ve", "maduro": "ve", "caracas": "ve",
    "mexico": "mx", "mx": "mx", "amlo": "mx",
    "españa": "es", "es": "es", "madrid": "es",
    "colombia": "co", "co": "co", "bogota": "co", "petro": "co",
    "chile": "cl", "cl": "cl", "santiago": "cl", "boric": "cl",
    "peru": "pe", "pe": "pe", "lima": "pe",
    "bolivia": "bo", "bo": "bo", "la paz": "bo",
    "uruguay": "uy", "uy": "uy", "montevideo": "uy",
    "ecuador": "ec", "ec": "ec", "quito": "ec",
    "el salvador": "sv", "sv": "sv", "bukele": "sv",
    "honduras": "hn", "hn": "hn",
    "guatemala": "gt", "gt": "gt",
    "nicaragua": "ni", "ni": "ni",
    "costa rica": "cr", "cr": "cr",
    "panama": "pa", "pa": "pa",
    "cuba": "cu", "cu": "cu",
    "rusia": "ru", "putin": "ru",
    "ucrania": "ua", "zelensky": "ua",
    "china": "cn", "xi jinping": "cn",
    "israel": "il", "gaza": "ps", "palestina": "ps",
    "mundo": "un", "internacional": "un"
};

/**
 * Busca el código ISO basado en texto (SOLO SE USA COMO RESPALDO)
 */
function getFlagCodeFromText(text) {
    if (!text) return "un"; 
    const lowerText = text.toLowerCase();
    for (const [key, code] of Object.entries(FLAG_CODES)) {
        if (lowerText.includes(key)) return code;
    }
    return null; 
}

// =============================================================================
// 🚀 FUNCIÓN PRINCIPAL
// =============================================================================

// AHORA RECIBE 'forcedCountryCode' (El país real de la base de datos)
exports.generateNewsThumbnail = async (prompt, textOverlay, forcedCountryCode) => {
    try {
        if (!DEEPINFRA_API_KEY || !BUNNY_STORAGE_KEY) {
            console.error("❌ ERROR: Faltan claves en .env");
            return null;
        }

        // 1. Limpieza y Preparación del Texto
        const cleanTitle = (textOverlay || "").replace(/["']/g, "").toUpperCase().trim();
        
        // LÓGICA DE BANDERA DEFINITIVA:
        // Si nos mandan el código (ej: 'py'), usamos ese. Si no, adivinamos por texto.
        let flagCode = forcedCountryCode ? forcedCountryCode.toLowerCase() : getFlagCodeFromText(cleanTitle);
        
        // Corrección: 'do' (Dominicana) a veces da problemas si se confunde, aseguramos que sea string
        if (flagCode === 'unknown') flagCode = null;

        console.log(`[ImageHandler] Generando para: "${cleanTitle}" | País forzado: ${forcedCountryCode} -> Flag: ${flagCode}`);

        // 2. GENERAR IMAGEN BASE (DeepInfra - SDXL Turbo)
        const deepInfraRes = await axios.post(
            'https://api.deepinfra.com/v1/inference/stabilityai/sdxl-turbo',
            {
                prompt: prompt + ", photorealistic, journalism style, 8k, news footage, bokeh background",
                width: IMG_WIDTH,
                height: IMG_HEIGHT,
                num_inference_steps: 4 
            },
            { headers: { 'Authorization': `Bearer ${DEEPINFRA_API_KEY}` } }
        );

        if (!deepInfraRes.data?.images?.[0]) throw new Error("Fallo DeepInfra");
        const imageBuffer = Buffer.from(deepInfraRes.data.images[0].split(',')[1], 'base64');


       // 3. PREPARAR DISEÑO SVG (Estilo CNN/BBC Mejorado)
        const words = cleanTitle.split(' ');
        let line1 = cleanTitle;
        let line2 = "";
        let fontSize = 90; // Tamaño base gigante (para textos cortos)

        // A) LÓGICA INTELIGENTE DE DIVISIÓN DE LÍNEAS
        // Si el texto total tiene más de 15 caracteres y varias palabras, lo dividimos en dos.
        if (cleanTitle.length > 15 && words.length > 1) {
            // Buscamos el punto medio aproximado en caracteres para que las líneas queden parejas
            const targetLength = cleanTitle.length / 2;
            let currentLength = 0;
            let splitIndex = 0;

            for (let i = 0; i < words.length; i++) {
                currentLength += words[i].length + 1; // +1 por el espacio
                if (currentLength >= targetLength) {
                    // Si esta palabra se pasa del medio, decidimos si cortar antes o después
                    // para que quede más equilibrado.
                    const diffBefore = Math.abs((currentLength - words[i].length - 1) - targetLength);
                    const diffAfter = Math.abs(currentLength - targetLength);
                    splitIndex = (diffAfter < diffBefore) ? i : i - 1;
                    break;
                }
                splitIndex = i;
            }
            // Asegurar que no quede la primera línea vacía si la primera palabra es muy larga
            if (splitIndex < 0) splitIndex = 0;

            line1 = words.slice(0, splitIndex + 1).join(' ');
            line2 = words.slice(splitIndex + 1).join(' ');
        }

        // B) LÓGICA DE TAMAÑO DINÁMICO (Para que no se corte)
        // Medimos la línea más larga resultante.
        const maxCharsInALine = Math.max(line1.length, line2.length);

        // Arial Black es muy ancha. Si supera ciertos caracteres, reducimos la fuente.
        if (maxCharsInALine > 19) {
            fontSize = 65; // Reducción fuerte para textos muy anchos (ej: la de Milei que pasaste)
        } else if (maxCharsInALine > 14) {
            fontSize = 78; // Reducción media
        }
        // Si tiene 14 chars o menos, se queda en 90px (impacto total)

        // Ajustes de posición basados en si hay 2 líneas y el tamaño
        const textY = line2 ? (fontSize < 90 ? "47%" : "45%") : "50%"; // Centrado vertical fino
        const lineHeightSpacing = fontSize * 1.15; // Espaciado entre líneas dinámico

        const svgOverlay = `
        <svg width="${IMG_WIDTH}" height="${IMG_HEIGHT}">
            <defs>
                <filter id="dropShadow" x="-20%" y="-20%" width="140%" height="140%">
                    <feGaussianBlur in="SourceAlpha" stdDeviation="4" />
                    <feOffset dx="3" dy="3" result="offsetblur" />
                    <feComponentTransfer><feFuncA type="linear" slope="0.8"/></feComponentTransfer>
                    <feMerge><feMergeNode /><feMergeNode in="SourceGraphic" /></feMerge>
                </filter>
                <radialGradient id="vignette">
                    <stop offset="60%" stop-color="black" stop-opacity="0" />
                    <stop offset="100%" stop-color="black" stop-opacity="0.9" />
                </radialGradient>
            </defs>
            
            <rect width="100%" height="100%" fill="url(#vignette)" />

            <style>
                .title { 
                    fill: white; 
                    font-family: "Arial Black", "Arial", sans-serif; 
                    font-weight: 900; 
                    /* AQUÍ USAMOS EL TAMAÑO DINÁMICO */
                    font-size: ${fontSize}px; 
                    text-anchor: middle;
                    letter-spacing: -2px;
                }
                .source-text {
                    fill: white;
                    font-family: "Arial", sans-serif;
                    font-weight: bold;
                    font-size: 22px;
                    text-anchor: middle;
                    opacity: 0.9;
                }
                /* AQUÍ CAMBIAMOS EL COLOR DE LA BARRA AL AZUL */
                .footer-line { fill: #007bff; } 
            </style>
            
            <text x="50%" y="${textY}" class="title" filter="url(#dropShadow)">
                <tspan x="50%" dy="0">${line1}</tspan>
                ${line2 ? `<tspan x="50%" dy="${lineHeightSpacing}">${line2}</tspan>` : ''}
            </text>

            <rect x="0" y="${IMG_HEIGHT - 12}" width="${IMG_WIDTH}" height="12" class="footer-line" />
            
            <text x="50%" y="${IMG_HEIGHT - 40}" class="source-text" filter="url(#dropShadow)">
                www.noticias.lat
            </text>
        </svg>
        `;
        // 4. COMPOSICIÓN FINAL (Capas)
        const compositeLayers = [
            // Fondo oscuro suave
            { input: Buffer.from(`<svg><rect width="${IMG_WIDTH}" height="${IMG_HEIGHT}" fill="black" opacity="0.3"/></svg>`), blend: 'over' },
            // Texto
            { input: Buffer.from(svgOverlay), blend: 'over' }
        ];

        // 5. AGREGAR BANDERA (Si hay código válido)
        if (flagCode && flagCode.length === 2) {
            try {
                // Descargar bandera de FlagCDN
                const flagUrl = `https://flagcdn.com/w160/${flagCode}.png`; 
                const flagBuffer = await axios.get(flagUrl, { responseType: 'arraybuffer' }).then(r => r.data);
                
                compositeLayers.push({
                    input: flagBuffer,
                    // Posición: Esquina superior derecha (Estilo TV)
                    top: 40,
                    left: IMG_WIDTH - 190, 
                });
            } catch (err) {
                console.warn(`[ImageHandler] No se pudo cargar bandera para ${flagCode}`);
            }
        }

        // 6. RENDERIZAR
        const finalImageBuffer = await sharp(imageBuffer)
            .resize(IMG_WIDTH, IMG_HEIGHT)
            .blur(5) // Blur suave
            .composite(compositeLayers)
            .toFormat('jpg')
            .toBuffer();

        // 7. SUBIR
        const filename = `news-final-${uuidv4()}.jpg`;
        const uploadUrl = `https://ny.storage.bunnycdn.com/${BUNNY_STORAGE_ZONE}/${filename}`;

        await axios.put(uploadUrl, finalImageBuffer, {
            headers: { 'AccessKey': BUNNY_STORAGE_KEY, 'Content-Type': 'image/jpeg' }
        });

        const publicUrl = `${BUNNY_CDN_URL}/${filename}`;
        console.log(`[ImageHandler] ✅ Imagen creada: ${publicUrl}`);

        return publicUrl;

    } catch (error) {
        console.error(`[ImageHandler] Error: ${error.message}`);
        return null;
    }
};