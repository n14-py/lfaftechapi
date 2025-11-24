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

/**
 * Limpieza de texto
 */
function cleanText(text) {
    return text.replace(/[^\w\s\u00C0-\u00FF,.?!¡¿]/g, "").trim();
}

/**
 * Divide el texto en líneas para que quepa arriba
 */
function processTextLayout(text) {
    const clean = cleanText(text.toUpperCase());
    const length = clean.length;
    
    // Configuramos letras GRANDES y "GORDITAS"
    let fontSize;
    let maxCharsPerLine;

    // Ajuste dinámico para que siempre se vea grande
    if (length < 25) {
        fontSize = 130; // ¡Masivo!
        maxCharsPerLine = 12;
    } else if (length < 50) {
        fontSize = 100; // Muy grande
        maxCharsPerLine = 16;
    } else {
        fontSize = 80; // Grande
        maxCharsPerLine = 22;
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

    // Limitamos a 3 líneas máximo para no tapar la imagen
    if (lines.length > 3) {
        lines = lines.slice(0, 3);
        lines[2] += "...";
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

        console.log(`[ImageHandler] Generando miniatura ÉPICA para: "${newsTitle.substring(0, 20)}..."`);

        // 1. OBTENER IMAGEN IA (DeepInfra - SDXL Turbo)
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

        // 2. PREPARAR EL DISEÑO
        const { lines, fontSize } = processTextLayout(newsTitle);
        const lineHeight = fontSize * 1.05;
        
        // Calculamos posición: Texto ARRIBA con un pequeño margen
        const startY = 80 + (fontSize / 2); 

        // Generamos las líneas de texto SVG
        // Alternamos colores: Primera línea AMARILLO (Impacto), siguientes BLANCO (Claridad)
        const svgLines = lines.map((line, i) => {
            const color = (i === 0) ? '#FFD700' : '#FFFFFF'; // Oro y Blanco
            return `<tspan x="50%" y="${startY + (i * lineHeight)}" fill="${color}">${line}</tspan>`;
        }).join('');

        // 3. CAPA DE TEXTO CON SOMBRAS Y BORDES (SVG AVANZADO)
        const svgTextOverlay = `
        <svg width="${IMG_WIDTH}" height="${IMG_HEIGHT}">
            <defs>
                <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
                    <feGaussianBlur in="SourceAlpha" stdDeviation="4"/> <feOffset dx="6" dy="6" result="offsetblur"/> <feComponentTransfer>
                        <feFuncA type="linear" slope="0.8"/> </feComponentTransfer>
                    <feMerge> 
                        <feMergeNode/>
                        <feMergeNode in="SourceGraphic"/> 
                    </feMerge>
                </filter>
            </defs>
            <style>
                .title { 
                    stroke: black; 
                    stroke-width: ${fontSize * 0.08}px; /* Borde negro grueso */
                    stroke-linejoin: round;
                    paint-order: stroke fill;
                    font-size: ${fontSize}px; 
                    font-weight: 900; /* Lo más gordo posible */
                    font-family: "Arial Black", "Verdana", sans-serif; 
                    text-anchor: middle; 
                }
            </style>
            <text x="50%" class="title" filter="url(#shadow)">${svgLines}</text>
        </svg>
        `;

        // 4. CAPA DE DEGRADADO (CINE)
        // Oscurece solo la parte de arriba para que el texto resalte, deja el resto transparente
        const gradientOverlay = `
        <svg width="${IMG_WIDTH}" height="${IMG_HEIGHT}">
            <defs>
                <linearGradient id="grad1" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" style="stop-color:rgb(0,0,0);stop-opacity:0.9" />
                    <stop offset="40%" style="stop-color:rgb(0,0,0);stop-opacity:0" />
                </linearGradient>
            </defs>
            <rect width="${IMG_WIDTH}" height="${IMG_HEIGHT}" fill="url(#grad1)" />
        </svg>
        `;

        // 5. COMPOSICIÓN FINAL (SHARP)
        // Orden: Imagen Fondo -> Degradado -> Texto
        const finalImageBuffer = await sharp(imageBuffer)
            .resize(IMG_WIDTH, IMG_HEIGHT)
            // ¡YA NO HAY BLUR GLOBAL! La imagen se ve nítida.
            .composite([
                { input: Buffer.from(gradientOverlay) }, // Pone la sombra arriba
                { input: Buffer.from(svgTextOverlay) }   // Pone el texto encima
            ])
            .toFormat('jpg')
            .toBuffer();

        // 6. SUBIDA A BUNNY (New York)
        const filename = `news-epic-${uuidv4()}.jpg`;
        const uploadUrl = `https://ny.storage.bunnycdn.com/${BUNNY_STORAGE_ZONE}/${filename}`;

        await axios.put(uploadUrl, finalImageBuffer, {
            headers: {
                'AccessKey': BUNNY_STORAGE_KEY,
                'Content-Type': 'image/jpeg'
            }
        });

        const publicUrl = `${BUNNY_CDN_URL}/${filename}`;
        console.log(`[ImageHandler] ✅ Miniatura TOP creada: ${publicUrl}`);

        return publicUrl;

    } catch (error) {
        console.error(`[ImageHandler] Error: ${error.message}`);
        return null;
    }
};