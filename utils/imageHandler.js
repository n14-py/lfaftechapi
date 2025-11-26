const axios = require('axios');
const sharp = require('sharp');
const { v4: uuidv4 } = require('uuid');

// --- CARGAR VARIABLES ---
const DEEPINFRA_API_KEY = process.env.DEEPINFRA_API_KEY; 
const BUNNY_STORAGE_KEY = process.env.BUNNY_STORAGE_API_KEY; 
const BUNNY_STORAGE_ZONE = process.env.BUNNY_STORAGE_ZONE; 
const BUNNY_CDN_URL = process.env.BUNNY_CDN_URL; 

const IMG_WIDTH = 1280;
const IMG_HEIGHT = 720;

// --- DICCIONARIO DE BANDERAS ---
const FLAGS = {
    "paraguay": "🇵🇾", "py": "🇵🇾",
    "argentina": "🇦🇷", "ar": "🇦🇷",
    "brasil": "🇧🇷", "br": "🇧🇷",
    "estados unidos": "🇺🇸", "usa": "🇺🇸", "eeuu": "🇺🇸",
    "venezuela": "🇻🇪", "ve": "🇻🇪",
    "mexico": "🇲🇽", "mx": "🇲🇽",
    "españa": "🇪🇸", "es": "🇪🇸",
    "colombia": "🇨🇴", "co": "🇨🇴",
    "chile": "🇨🇱", "cl": "🇨🇱",
    "peru": "🇵🇪", "pe": "🇵🇪",
    "bolivia": "🇧🇴", "bo": "🇧🇴",
    "uruguay": "🇺🇾", "uy": "🇺🇾",
    "ecuador": "🇪🇨", "ec": "🇪🇨",
    "mundo": "🌎", "internacional": "🌎"
};

// Función para encontrar la bandera en el texto del título o usar una por defecto
function getFlagEmoji(text) {
    if (!text) return "🌎";
    const lowerText = text.toLowerCase();
    
    // Buscar coincidencia exacta o parcial en el mapa
    for (const [key, emoji] of Object.entries(FLAGS)) {
        if (lowerText.includes(key)) return emoji;
    }
    return ""; // Si no encuentra país, mejor no poner nada o poner 🌎
}

// --- GENERADOR DE MINIATURA ---
exports.generateNewsThumbnail = async (prompt, textOverlay) => {
    try {
        if (!DEEPINFRA_API_KEY || !BUNNY_STORAGE_KEY) {
            console.error("❌ ERROR: Faltan claves en .env");
            return null;
        }

        // 1. Limpieza del texto (Sujeto + Acción)
        // Convertimos a MAYÚSCULAS para que se vea como titular fuerte
        const cleanTitle = textOverlay.replace(/["']/g, "").toUpperCase().trim();
        
        // Detectar bandera basada en el texto (ej: si dice "Shakira en Paraguay" -> 🇵🇾)
        const flagEmoji = getFlagEmoji(cleanTitle);

        console.log(`[ImageHandler] Generando estilo PRO: "${cleanTitle}" ${flagEmoji}`);

        // 2. PEDIR IMAGEN BASE (DeepInfra)
        const deepInfraRes = await axios.post(
            'https://api.deepinfra.com/v1/inference/stabilityai/sdxl-turbo',
            {
                prompt: prompt + ", photorealistic, journalism style, 8k", // Forzamos realismo
                width: IMG_WIDTH,
                height: IMG_HEIGHT,
                num_inference_steps: 4
            },
            { headers: { 'Authorization': `Bearer ${DEEPINFRA_API_KEY}` } }
        );

        if (!deepInfraRes.data?.images?.[0]) throw new Error("Fallo DeepInfra");
        const imageBuffer = Buffer.from(deepInfraRes.data.images[0].split(',')[1], 'base64');

        // 3. CREAR SVG DE TEXTO (Overlay Profesional)
        // Usamos Arial Black o Roboto (fuentes seguras en servidor)
        // Fondo negro semitransparente (opacity="0.6") cubriendo todo
        
        // Dividir texto si es muy largo (máximo 2 líneas para que se vea grande)
        const words = cleanTitle.split(' ');
        let line1 = words.join(' ');
        let line2 = '';
        
        if (line1.length > 20) {
            const mid = Math.floor(words.length / 2);
            line1 = words.slice(0, mid + 1).join(' ');
            line2 = words.slice(mid + 1).join(' ');
        }

        const svgOverlay = `
        <svg width="${IMG_WIDTH}" height="${IMG_HEIGHT}">
            <style>
                .title { fill: white; font-family: Arial, sans-serif; font-weight: 900; font-size: 85px; text-anchor: middle; }
                .flag { font-size: 100px; text-anchor: middle; }
                .source { fill: white; font-family: Arial, sans-serif; font-weight: normal; font-size: 24px; opacity: 0.8; text-anchor: middle; }
            </style>
            
            <text x="50%" y="${line2 ? '42%' : '48%'}" class="title">${line1}</text>
            <text x="50%" y="56%" class="title">${line2}</text>
            
            <text x="50%" y="${line2 ? '78%' : '70%'}" class="flag">${flagEmoji}</text>

            <text x="50%" y="95%" class="source">Fuente: www.noticias.lat</text>
        </svg>
        `;

        // 4. COMPOSICIÓN CON SHARP (Aquí ocurre la magia del Blur)
        const finalImageBuffer = await sharp(imageBuffer)
            .resize(IMG_WIDTH, IMG_HEIGHT)
            .blur(15) // <--- AQUÍ ESTÁ EL BLUR (10-15px es ideal)
            .composite([
                // Capa oscura (Rectángulo negro semi-transparente)
                {
                    input: Buffer.from(`<svg><rect width="${IMG_WIDTH}" height="${IMG_HEIGHT}" fill="black" opacity="0.55"/></svg>`),
                    blend: 'over'
                },
                // Texto y Bandera
                {
                    input: Buffer.from(svgOverlay),
                    blend: 'over'
                }
            ])
            .toFormat('jpg')
            .toBuffer();

        // 5. SUBIR A BUNNY
        const filename = `news-pro-${uuidv4()}.jpg`;
        const uploadUrl = `https://ny.storage.bunnycdn.com/${BUNNY_STORAGE_ZONE}/${filename}`;

        await axios.put(uploadUrl, finalImageBuffer, {
            headers: { 'AccessKey': BUNNY_STORAGE_KEY, 'Content-Type': 'image/jpeg' }
        });

        const publicUrl = `${BUNNY_CDN_URL}/${filename}`;
        console.log(`[ImageHandler] ✅ Imagen PRO creada: ${publicUrl}`);

        return publicUrl;

    } catch (error) {
        console.error(`[ImageHandler] Error: ${error.message}`);
        return null;
    }
};