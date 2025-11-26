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
// 🌎 DICCIONARIO DE CÓDIGOS ISO (Para descargar la bandera real)
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
    "mundo": "un", "internacional": "un" // 'un' es la bandera de la ONU
};

/**
 * Busca el código ISO (ej: 'py', 'ar') basado en el título
 */
function getFlagCode(text) {
    if (!text) return "un"; // Por defecto mundo/ONU
    const lowerText = text.toLowerCase();
    
    // Buscar coincidencia en el mapa
    for (const [key, code] of Object.entries(FLAG_CODES)) {
        if (lowerText.includes(key)) return code;
    }
    return null; 
}

// =============================================================================
// 🚀 FUNCIÓN PRINCIPAL
// =============================================================================

exports.generateNewsThumbnail = async (prompt, textOverlay) => {
    try {
        if (!DEEPINFRA_API_KEY || !BUNNY_STORAGE_KEY) {
            console.error("❌ ERROR: Faltan claves en .env");
            return null;
        }

        // 1. Limpieza y Preparación del Texto
        const cleanTitle = (textOverlay || "").replace(/["']/g, "").toUpperCase().trim();
        const flagCode = getFlagCode(cleanTitle);

        console.log(`[ImageHandler] Generando estilo PRO: "${cleanTitle}" (Bandera: ${flagCode || 'Ninguna'})`);

        // 2. GENERAR IMAGEN BASE (DeepInfra - SDXL Turbo)
        // Pedimos "photorealistic" y "bokeh" para asegurar ese fondo borroso profesional
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


        // 3. PREPARAR TEXTO (SVG)
        const words = cleanTitle.split(' ');
        let line1 = cleanTitle;
        let line2 = "";

        // Dividir en 2 líneas si es largo
        if (words.length > 4 || cleanTitle.length > 25) {
            const mid = Math.ceil(words.length / 2);
            line1 = words.slice(0, mid).join(' ');
            line2 = words.slice(mid).join(' ');
        }

        // Posiciones Verticales (Ajustadas para dejar espacio a la bandera imagen)
        const line1Y = line2 ? "42%" : "48%";
        const line2Y = "56%";
        
        // Calculamos dónde irá la bandera (en pixeles, para Sharp)
        // 720px altura total. 
        // Si hay 2 líneas, la bandera va más abajo (aprox 560px). Si hay 1, un poco más arriba (520px).
        const flagTopPos = line2 ? 560 : 510;
        const flagWidth = 140; // Tamaño de la bandera
        const flagLeftPos = (IMG_WIDTH - flagWidth) / 2; // Centrado horizontal

        const svgTextOverlay = `
        <svg width="${IMG_WIDTH}" height="${IMG_HEIGHT}">
            <style>
                .title { 
                    fill: white; 
                    font-family: "Arial Black", "Arial", sans-serif; 
                    font-weight: 900; 
                    font-size: 85px; 
                    text-anchor: middle; 
                    text-shadow: 0px 4px 10px rgba(0,0,0,0.8);
                }
                .source { 
                    fill: white; 
                    font-family: "Arial", sans-serif; 
                    font-weight: bold; 
                    font-size: 24px; 
                    opacity: 0.8; 
                    text-anchor: middle;
                    letter-spacing: 1px;
                }
            </style>
            
            <text x="50%" y="${line1Y}" class="title">${line1}</text>
            <text x="50%" y="${line2Y}" class="title">${line2}</text>

            <text x="50%" y="96%" class="source">Fuente: www.noticias.lat</text>
        </svg>
        `;

        // 4. PREPARAR CAPAS (COMPOSITE)
        const compositeLayers = [
             // 1. Capa Oscura (Velo negro al 50% para que se lea el texto)
            {
                input: Buffer.from(`<svg><rect width="${IMG_WIDTH}" height="${IMG_HEIGHT}" fill="black" opacity="0.5"/></svg>`),
                blend: 'over'
            },
            // 2. Texto
            {
                input: Buffer.from(svgTextOverlay),
                blend: 'over'
            }
        ];

        // 5. DESCARGAR Y AGREGAR LA BANDERA (Si existe código)
        if (flagCode) {
            try {
                // Descargamos la bandera real desde FlagCDN
                const flagUrl = `https://flagcdn.com/w160/${flagCode}.png`;
                const flagBuffer = await axios.get(flagUrl, { responseType: 'arraybuffer' }).then(r => r.data);
                
                compositeLayers.push({
                    input: flagBuffer,
                    top: flagTopPos,
                    left: parseInt(flagLeftPos),
                    // Forzamos un tamaño estándar por si acaso
                    // (FlagCDN w160 da ancho 160, el alto varía, pero Sharp lo maneja)
                });
            } catch (err) {
                console.warn("[ImageHandler] No se pudo descargar la bandera, continuando sin ella.");
            }
        }

        // 6. COMPOSICIÓN FINAL CON SHARP
        const finalImageBuffer = await sharp(imageBuffer)
            .resize(IMG_WIDTH, IMG_HEIGHT)
            .blur(5) // Blur suave (5px) para ocultar defectos de IA
            .composite(compositeLayers)
            .toFormat('jpg')
            .toBuffer();


        // 7. SUBIDA A BUNNY STORAGE
        const filename = `news-pro-${uuidv4()}.jpg`;
        const uploadUrl = `https://ny.storage.bunnycdn.com/${BUNNY_STORAGE_ZONE}/${filename}`;

        await axios.put(uploadUrl, finalImageBuffer, {
            headers: { 'AccessKey': BUNNY_STORAGE_KEY, 'Content-Type': 'image/jpeg' }
        });

        const publicUrl = `${BUNNY_CDN_URL}/${filename}`;
        console.log(`[ImageHandler] ✅ Imagen Profesional creada: ${publicUrl}`);

        return publicUrl;

    } catch (error) {
        console.error(`[ImageHandler] Error: ${error.message}`);
        return null;
    }
};