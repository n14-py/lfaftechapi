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
        if (!DEEPINFRA_API_KEY || !BUNNY_STORAGE_KEY) return null;

        // 1. Limpieza
        const cleanTitle = (textOverlay || "").replace(/["']/g, "").toUpperCase().trim();
        const flagCode = getFlagCode(cleanTitle); // Tu función existente

        // 2. Imagen Base (DeepInfra)
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

        // 3. DISEÑO MEJORADO (SVG)
        
        // Lógica de líneas (igual que antes)
        const words = cleanTitle.split(' ');
        let line1 = cleanTitle;
        let line2 = "";
        if (words.length > 4 || cleanTitle.length > 25) {
            const mid = Math.ceil(words.length / 2);
            line1 = words.slice(0, mid).join(' ');
            line2 = words.slice(mid).join(' ');
        }

        // Ajuste vertical para centrar visualmente el texto
        const textY = line2 ? "45%" : "50%"; 

        const svgOverlay = `
        <svg width="${IMG_WIDTH}" height="${IMG_HEIGHT}">
            <defs>
                <filter id="dropShadow" x="-20%" y="-20%" width="140%" height="140%">
                    <feGaussianBlur in="SourceAlpha" stdDeviation="4" />
                    <feOffset dx="3" dy="3" result="offsetblur" />
                    <feComponentTransfer>
                        <feFuncA type="linear" slope="0.7"/>
                    </feComponentTransfer>
                    <feMerge> 
                        <feMergeNode />
                        <feMergeNode in="SourceGraphic" /> 
                    </feMerge>
                </filter>
                
                <radialGradient id="vignette">
                    <stop offset="60%" stop-color="black" stop-opacity="0" />
                    <stop offset="100%" stop-color="black" stop-opacity="0.8" />
                </radialGradient>
            </defs>
            
            <rect width="100%" height="100%" fill="url(#vignette)" />

            <style>
                .title { 
                    fill: white; 
                    font-family: "Arial Black", "Arial", sans-serif; 
                    font-weight: 900; 
                    font-size: 90px; 
                    text-anchor: middle;
                    letter-spacing: -2px; /* Letras más pegadas (Estilo Impact) */
                }
                .footer-bar {
                    fill: #e91e63; /* Color corporativo (puedes cambiarlo a azul #007bff) */
                }
                .source-text {
                    fill: white;
                    font-family: "Arial", sans-serif;
                    font-weight: bold;
                    font-size: 24px;
                    text-anchor: middle;
                }
            </style>
            
            <text x="50%" y="${textY}" class="title" filter="url(#dropShadow)">
                <tspan x="50%" dy="0">${line1}</tspan>
                ${line2 ? `<tspan x="50%" dy="100">${line2}</tspan>` : ''}
            </text>

            <rect x="0" y="${IMG_HEIGHT - 15}" width="${IMG_WIDTH}" height="15" class="footer-bar" />
            
            <text x="50%" y="${IMG_HEIGHT - 40}" class="source-text" filter="url(#dropShadow)">
                Fuente: www.noticias.lat
            </text>
        </svg>
        `;

        // 4. COMPOSICIÓN
        const compositeLayers = [
            // Capa Oscura General (más suave ahora que tenemos vignette y sombra)
            { input: Buffer.from(`<svg><rect width="${IMG_WIDTH}" height="${IMG_HEIGHT}" fill="black" opacity="0.3"/></svg>`), blend: 'over' },
            // El SVG con texto y efectos
            { input: Buffer.from(svgOverlay), blend: 'over' }
        ];

        // 5. BANDERA (Ahora como "Insignia" en la esquina superior derecha)
        if (flagCode) {
            try {
                const flagUrl = `https://flagcdn.com/w160/${flagCode}.png`; // Usamos w160 para mejor calidad
                const flagBuffer = await axios.get(flagUrl, { responseType: 'arraybuffer' }).then(r => r.data);
                
                compositeLayers.push({
                    input: flagBuffer,
                    top: 40,  // Margen superior
                    left: IMG_WIDTH - 180, // Margen derecho
                    // Opcional: Podrías redondear las esquinas de la bandera con otro svg mask, pero así cuadrada queda estilo "noticiero"
                });
            } catch (err) { /* Ignorar error de bandera */ }
        }

        // 6. PROCESAR CON SHARP
        const finalImageBuffer = await sharp(imageBuffer)
            .resize(IMG_WIDTH, IMG_HEIGHT)
            .blur(5) // Blur suave
            .composite(compositeLayers)
            .toFormat('jpg')
            .toBuffer();

        // 7. SUBIR (Igual que antes)
        const filename = `news-pro-v2-${uuidv4()}.jpg`;
        const uploadUrl = `https://ny.storage.bunnycdn.com/${BUNNY_STORAGE_ZONE}/${filename}`;
        await axios.put(uploadUrl, finalImageBuffer, { headers: { 'AccessKey': BUNNY_STORAGE_KEY, 'Content-Type': 'image/jpeg' } });

        return `${BUNNY_CDN_URL}/${filename}`;

    } catch (error) {
        console.error(`[ImageHandler] Error: ${error.message}`);
        return null;
    }
};