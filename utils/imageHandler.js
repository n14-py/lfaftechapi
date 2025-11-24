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

// --- PALETA DE COLORES "CLICKBAIT" ---
const TEXT_COLORS = [
    '#FFD700', // Amarillo Oro (Clásico)
    '#FFFFFF', // Blanco Puro (Limpio)
    '#FF0033', // Rojo YouTube (Alerta)
    '#00FF00'  // Verde Neón (Dinero/Matrix)
];

/**
 * Función para limpiar texto de emojis o caracteres raros que rompen SVG
 */
function cleanText(text) {
    return text.replace(/[^\w\s\u00C0-\u00FF,.?!]/g, "").trim();
}

/**
 * Función inteligente para dividir texto y calcular tamaño
 */
function processTextLayout(text) {
    const clean = cleanText(text.toUpperCase());
    const length = clean.length;
    
    let fontSize;
    let maxCharsPerLine;

    // Lógica de Auto-Ajuste
    if (length < 30) {
        fontSize = 110; // Texto Gigante
        maxCharsPerLine = 15;
    } else if (length < 60) {
        fontSize = 90; // Texto Grande
        maxCharsPerLine = 20;
    } else if (length < 100) {
        fontSize = 70; // Texto Mediano
        maxCharsPerLine = 25;
    } else {
        fontSize = 55; // Texto Pequeño (para títulos muy largos)
        maxCharsPerLine = 35;
    }

    const words = clean.split(' ');
    let lines = [];
    let currentLine = words[0];

    for (let i = 1; i < words.length; i++) {
        if (currentLine.length + words[i].length + 1 < maxCharsPerLine) {
            currentLine += " " + words[i];
        } else {
            lines.push(currentLine);
            currentLine = words[i];
        }
    }
    lines.push(currentLine);

    // Si salieron demasiadas líneas, cortamos y ponemos "..."
    if (lines.length > 4) {
        lines = lines.slice(0, 4);
        lines[3] += "...";
    }

    return { lines, fontSize };
}

/**
 * Función Principal
 */
exports.generateNewsThumbnail = async (prompt, newsTitle) => {
    try {
        if (!DEEPINFRA_API_KEY || !BUNNY_STORAGE_KEY) {
            console.error("❌ ERROR: Faltan claves en .env");
            return null;
        }

        console.log(`[ImageHandler] Generando imagen para: "${newsTitle.substring(0, 20)}..."`);

        // 1. DEEPINFRA (SDXL Turbo)
        const deepInfraRes = await axios.post(
            'https://api.deepinfra.com/v1/inference/stabilityai/sdxl-turbo',
            {
                prompt: prompt,
                width: IMG_WIDTH,
                height: IMG_HEIGHT,
                num_inference_steps: 4 
            },
            {
                headers: { 
                    'Authorization': `Bearer ${DEEPINFRA_API_KEY}`,
                    'Content-Type': 'application/json' 
                },
                responseType: 'json' 
            }
        );

        if (!deepInfraRes.data?.images?.[0]) throw new Error("Fallo en DeepInfra");
        const imageBuffer = Buffer.from(deepInfraRes.data.images[0].split(',')[1], 'base64');

        // 2. DISEÑO DINÁMICO
        const { lines, fontSize } = processTextLayout(newsTitle);
        
        // Elegir color al azar
        const randomColor = TEXT_COLORS[Math.floor(Math.random() * TEXT_COLORS.length)];
        
        // Calcular posición vertical centrada
        const lineHeight = fontSize * 1.1;
        const totalTextHeight = lines.length * lineHeight;
        const startY = (IMG_HEIGHT - totalTextHeight) / 2 + (fontSize * 0.8); // Ajuste visual

        const svgLines = lines.map((line, i) => 
            `<tspan x="50%" y="${startY + (i * lineHeight)}">${line}</tspan>`
        ).join('');

        const svgImage = `
        <svg width="${IMG_WIDTH}" height="${IMG_HEIGHT}">
            <style>
                .title { 
                    fill: ${randomColor}; 
                    stroke: black; 
                    stroke-width: ${fontSize * 0.15}px; 
                    paint-order: stroke fill;
                    font-size: ${fontSize}px; 
                    font-weight: 900; 
                    font-family: Arial, Impact, sans-serif; 
                    text-anchor: middle; 
                }
            </style>
            <filter id="dropShadow">
                <feGaussianBlur in="SourceAlpha" stdDeviation="3" />
                <feOffset dx="4" dy="4" result="offsetblur"/>
                <feComponentTransfer>
                    <feFuncA type="linear" slope="0.7"/>
                </feComponentTransfer>
                <feMerge> 
                    <feMergeNode/>
                    <feMergeNode in="SourceGraphic"/> 
                </feMerge>
            </filter>
            <text x="50%" y="50%" class="title" filter="url(#dropShadow)">${svgLines}</text>
        </svg>
        `;

        // 3. PROCESAMIENTO SHARP
        const finalImageBuffer = await sharp(imageBuffer)
            .resize(IMG_WIDTH, IMG_HEIGHT)
            .blur(5) // Un poco menos borroso para que se vea algo del fondo
            .modulate({ brightness: 0.65 }) // Un poco más claro
            .composite([
                { input: Buffer.from(svgImage), gravity: 'center' }
            ])
            .toFormat('jpg')
            .toBuffer();

        // 4. SUBIDA A BUNNY (New York)
        const filename = `news-${uuidv4()}.jpg`;
        // Recuerda: Si tu zona no es "ny", cambia esto.
        const uploadUrl = `https://ny.storage.bunnycdn.com/${BUNNY_STORAGE_ZONE}/${filename}`;

        await axios.put(uploadUrl, finalImageBuffer, {
            headers: {
                'AccessKey': BUNNY_STORAGE_KEY,
                'Content-Type': 'image/jpeg'
            }
        });

        const publicUrl = `${BUNNY_CDN_URL}/${filename}`;
        console.log(`[ImageHandler] ✅ Miniatura creada: ${publicUrl}`);

        return publicUrl;

    } catch (error) {
        console.error(`[ImageHandler] Error: ${error.message}`);
        return null;
    }
};