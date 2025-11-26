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
// 🌎 DICCIONARIO DE BANDERAS (Detecta país en el título)
// =============================================================================
const FLAGS = {
    "paraguay": "🇵🇾", "py": "🇵🇾", "asunción": "🇵🇾",
    "argentina": "🇦🇷", "ar": "🇦🇷", "buenos aires": "🇦🇷",
    "brasil": "🇧🇷", "br": "🇧🇷", "rio de janeiro": "🇧🇷", "sao paulo": "🇧🇷",
    "estados unidos": "🇺🇸", "usa": "🇺🇸", "eeuu": "🇺🇸", "trump": "🇺🇸", "biden": "🇺🇸",
    "venezuela": "🇻🇪", "ve": "🇻🇪", "maduro": "🇻🇪", "caracas": "🇻🇪",
    "mexico": "🇲🇽", "mx": "🇲🇽", "amlo": "🇲🇽",
    "españa": "🇪🇸", "es": "🇪🇸", "madrid": "🇪🇸",
    "colombia": "🇨🇴", "co": "🇨🇴", "bogota": "🇨🇴", "petro": "🇨🇴",
    "chile": "🇨🇱", "cl": "🇨🇱", "santiago": "🇨🇱", "boric": "🇨🇱",
    "peru": "🇵🇪", "pe": "🇵🇪", "lima": "🇵🇪",
    "bolivia": "🇧🇴", "bo": "🇧🇴", "la paz": "🇧🇴",
    "uruguay": "🇺🇾", "uy": "🇺🇾", "montevideo": "🇺🇾",
    "ecuador": "🇪🇨", "ec": "🇪🇨", "quito": "🇪🇨",
    "el salvador": "🇸🇻", "sv": "🇸🇻", "bukele": "🇸🇻",
    "honduras": "🇭🇳", "hn": "🇭🇳",
    "guatemala": "🇬🇹", "gt": "🇬🇹",
    "nicaragua": "🇳🇮", "ni": "🇳🇮",
    "costa rica": "🇨🇷", "cr": "🇨🇷",
    "panama": "🇵🇦", "pa": "🇵🇦",
    "cuba": "🇨🇺", "cu": "🇨🇺",
    "rusia": "🇷🇺", "putin": "🇷🇺",
    "ucrania": "🇺🇦", "zelensky": "🇺🇦",
    "china": "🇨🇳", "xi jinping": "🇨🇳",
    "israel": "🇮🇱", "gaza": "🇵🇸", "palestina": "🇵🇸",
    "mundo": "🌎", "internacional": "🌎"
};

/**
 * Busca un emoji de bandera basado en el texto del título
 */
function getFlagEmoji(text) {
    if (!text) return "🌎";
    const lowerText = text.toLowerCase();
    
    // Buscar coincidencia en el mapa
    for (const [key, emoji] of Object.entries(FLAGS)) {
        if (lowerText.includes(key)) return emoji;
    }
    // Si no encuentra nada específico, no devolvemos nada (o podrías poner "🌎")
    return ""; 
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
        // Quitamos comillas y espacios extra. Convertimos a MAYÚSCULAS para impacto.
        const cleanTitle = (textOverlay || "").replace(/["']/g, "").toUpperCase().trim();
        
        // Detectar bandera
        const flagEmoji = getFlagEmoji(cleanTitle);

        console.log(`[ImageHandler] Generando estilo PRO: "${cleanTitle}" ${flagEmoji}`);

        // 2. GENERAR IMAGEN BASE (DeepInfra - SDXL Turbo)
        // Pedimos estilo fotorealista para que, aunque esté borrosa, los colores sean reales.
        const deepInfraRes = await axios.post(
            'https://api.deepinfra.com/v1/inference/stabilityai/sdxl-turbo',
            {
                prompt: prompt + ", photorealistic, journalism style, 8k, news footage",
                width: IMG_WIDTH,
                height: IMG_HEIGHT,
                num_inference_steps: 4 
            },
            { headers: { 'Authorization': `Bearer ${DEEPINFRA_API_KEY}` } }
        );

        if (!deepInfraRes.data?.images?.[0]) throw new Error("Fallo DeepInfra");
        const imageBuffer = Buffer.from(deepInfraRes.data.images[0].split(',')[1], 'base64');


        // 3. PREPARAR EL SVG (Texto y Elementos Gráficos)
        
        // Lógica para dividir el texto en 2 líneas si es muy largo
        const words = cleanTitle.split(' ');
        let line1 = cleanTitle;
        let line2 = "";

        // Si tiene más de 4 palabras o es muy largo, cortamos a la mitad
        if (words.length > 4 || cleanTitle.length > 25) {
            const mid = Math.ceil(words.length / 2);
            line1 = words.slice(0, mid).join(' ');
            line2 = words.slice(mid).join(' ');
        }

        // Definimos posiciones Y (altura) dependiendo de si hay 1 o 2 líneas
        // Para que quede siempre centrado verticalmente
        const line1Y = line2 ? "42%" : "48%";
        const line2Y = "56%";
        const flagY  = line2 ? "78%" : "70%";

        const svgOverlay = `
        <svg width="${IMG_WIDTH}" height="${IMG_HEIGHT}">
            <style>
                /* Fuente del Título: Grande, Gruesa (Bold), Blanca */
                .title { 
                    fill: white; 
                    font-family: "Arial Black", "Arial", sans-serif; 
                    font-weight: 900; 
                    font-size: 85px; 
                    text-anchor: middle; 
                    text-shadow: 0px 4px 10px rgba(0,0,0,0.8); /* Sombra suave para legibilidad extra */
                }
                
                /* Fuente de la Bandera */
                .flag { 
                    font-size: 100px; 
                    text-anchor: middle; 
                    text-shadow: 0px 4px 10px rgba(0,0,0,0.5);
                }
                
                /* Fuente de la Web (Abajo) */
                .source { 
                    fill: white; 
                    font-family: "Arial", sans-serif; 
                    font-weight: bold; 
                    font-size: 28px; 
                    opacity: 0.9; 
                    text-anchor: middle;
                    letter-spacing: 1px;
                }
            </style>
            
            <text x="50%" y="${line1Y}" class="title">${line1}</text>
            <text x="50%" y="${line2Y}" class="title">${line2}</text>
            
            <text x="50%" y="${flagY}" class="flag">${flagEmoji}</text>

            <text x="50%" y="95%" class="source">Fuente: www.noticias.lat</text>
        </svg>
        `;


        // 4. COMPOSICIÓN FINAL CON SHARP
        // Aquí aplicamos el Blur suave y la capa oscura
        const finalImageBuffer = await sharp(imageBuffer)
            .resize(IMG_WIDTH, IMG_HEIGHT)
            // BLUR: 5 es suave (como pediste). 
            // Suficiente para ocultar defectos de IA, pero se entiende qué hay detrás.
            .blur(5) 
            .composite([
                // 1. CAPA OSCURA (Velo negro)
                // Opacidad 0.4 (40%) es suficiente para oscurecer y que el texto resalte,
                // sin matar la foto de fondo.
                {
                    input: Buffer.from(`<svg><rect width="${IMG_WIDTH}" height="${IMG_HEIGHT}" fill="black" opacity="0.4"/></svg>`),
                    blend: 'over'
                },
                // 2. TEXTO Y ELEMENTOS (El SVG que creamos arriba)
                {
                    input: Buffer.from(svgOverlay),
                    blend: 'over'
                }
            ])
            .toFormat('jpg')
            .toBuffer();


        // 5. SUBIDA A BUNNY STORAGE
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
        // Retornar null para manejar el error arriba si es necesario
        return null;
    }
};