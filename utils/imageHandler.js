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
// 🎨 MOTOR DE ESTILOS EXPANDIDO (30+ COMBINACIONES)
// =============================================================================

// 1. PALETAS DE COLORES (Texto y Bordes)
const PALETTES = [
    // Clásicos YouTube
    { name: 'Gold',       fill1: '#FFD700', fill2: '#FFFFFF', stroke: 'black' }, 
    { name: 'Red Alert',  fill1: '#FF0033', fill2: '#FFFFFF', stroke: 'black' }, 
    { name: 'Pure White', fill1: '#FFFFFF', fill2: '#FFFFFF', stroke: 'black' },
    
    // Neones y Tech
    { name: 'Cyber',      fill1: '#00FFFF', fill2: '#FFFFFF', stroke: '#000033' }, 
    { name: 'Matrix',     fill1: '#00FF00', fill2: '#CCFFCC', stroke: 'black' }, 
    { name: 'Hot Pink',   fill1: '#FF00FF', fill2: '#FFFFFF', stroke: 'black' },
    { name: 'Electric',   fill1: '#FFFF00', fill2: '#00FFFF', stroke: 'black' },

    // Estilos Serios / Periodísticos
    { name: 'Newspaper',  fill1: '#FFFFFF', fill2: '#DDDDDD', stroke: '#333333' }, 
    { name: 'Warning',    fill1: '#000000', fill2: '#000000', stroke: '#FFD700' }, // Letras negras borde amarillo
    { name: 'Navy',       fill1: '#FFFFFF', fill2: '#E6E6FA', stroke: '#000080' },

    // Estilos Lujosos / Dramáticos
    { name: 'Royal',      fill1: '#C0C0C0', fill2: '#FFFFFF', stroke: '#4B0082' }, // Plata y Púrpura
    { name: 'Fire',       fill1: '#FF4500', fill2: '#FFFF00', stroke: 'black' },   // Degradado fuego
    { name: 'Toxic',      fill1: '#CCFF00', fill2: '#FFFFFF', stroke: '#333333' }, // Lima
    { name: 'Sunset',     fill1: '#FF8C00', fill2: '#FF0080', stroke: 'white' },   // Naranja/Rosa borde blanco
    { name: 'Ice',        fill1: '#E0FFFF', fill2: '#FFFFFF', stroke: '#0099CC' }  // Hielo
];

// 2. LAYOUTS (Disposición en pantalla)
const LAYOUTS = [
    'TOP_GRADIENT',    // Texto arriba, sombra negra cayendo
    'BOTTOM_GRADIENT', // Texto abajo, sombra negra subiendo
    'CENTER_VIGNETTE', // Texto centro, bordes oscuros
    'TOP_BAR',         // Texto arriba, barra sólida de color de fondo (estilo TV)
    'BOTTOM_BAR',      // Texto abajo, barra sólida de color
    'BOXED_CENTER',    // Texto centro, dentro de una caja semitransparente
    'BIG_IMPACT'       // Texto GIGANTE ocupando casi todo (sin fondo extra, solo sombra)
];

/**
 * Selecciona una combinación de estilos aleatoria
 */
function getRandomStyle() {
    const palette = PALETTES[Math.floor(Math.random() * PALETTES.length)];
    const layout = LAYOUTS[Math.floor(Math.random() * LAYOUTS.length)];
    
    // Inclinación aleatoria (-3 a 3 grados) para dinamismo
    const tilt = (Math.random() * 6) - 3; 
    
    // Fuentes variadas (Linux safe fonts)
    const fonts = ["Impact", "Arial Black", "Verdana", "DejaVu Sans", "Roboto"];
    const font = fonts[Math.floor(Math.random() * fonts.length)];

    return { palette, layout, tilt, font };
}


// =============================================================================
// 🛠️ HELPERS Y LÓGICA DE TEXTO
// =============================================================================

function cleanText(text) {
    return text.replace(/[^\w\s\u00C0-\u00FF,.?!¡¿]/g, "").trim();
}

/**
 * Calcula el tamaño y las líneas del texto
 */
function processTextLayout(text, layoutType) {
    const clean = cleanText(text.toUpperCase());
    const length = clean.length;
    
    // Lógica base de tamaño
    let fontSize = (length < 15) ? 130 : (length < 30 ? 100 : 80);
    let maxChars = (fontSize > 110) ? 12 : 20;

    // Ajustes según Layout
    if (layoutType === 'BIG_IMPACT') {
        fontSize += 30; // Aún más grande
        maxChars = 10;
    }
    if (layoutType.includes('BAR') || layoutType === 'BOXED_CENTER') {
        fontSize -= 10; // Un poco más chico para que quepa en la caja
    }

    const words = clean.split(' ');
    let lines = [];
    let currentLine = words[0];

    for (let i = 1; i < words.length; i++) {
        if (currentLine.length + words[i].length + 1 < maxChars) {
            currentLine += " " + words[i];
        } else {
            lines.push(currentLine);
            currentLine = words[i];
        }
    }
    lines.push(currentLine);

    // Máximo 3 líneas para no tapar la imagen
    if (lines.length > 3) { 
        lines = lines.slice(0, 3); 
        lines[2] += "..."; 
    }

    return { lines, fontSize };
}


// =============================================================================
// 🚀 FUNCIÓN PRINCIPAL
// =============================================================================

exports.generateNewsThumbnail = async (prompt, newsTitle) => {
    try {
        if (!DEEPINFRA_API_KEY || !BUNNY_STORAGE_KEY) {
            console.error("❌ ERROR: Faltan claves en .env");
            return null;
        }

        // 1. Seleccionar Estilo para esta noticia
        const style = getRandomStyle();
        console.log(`[ImageHandler] Generando con estilo: ${style.layout} (${style.palette.name})`);

        // 2. GENERAR IMAGEN BASE (DeepInfra - SDXL Turbo)
        const deepInfraRes = await axios.post(
            'https://api.deepinfra.com/v1/inference/stabilityai/sdxl-turbo',
            {
                prompt: prompt,
                width: IMG_WIDTH,
                height: IMG_HEIGHT,
                num_inference_steps: 4 
            },
            { headers: { 'Authorization': `Bearer ${DEEPINFRA_API_KEY}` } }
        );

        if (!deepInfraRes.data?.images?.[0]) throw new Error("Fallo DeepInfra");
        const imageBuffer = Buffer.from(deepInfraRes.data.images[0].split(',')[1], 'base64');

        // 3. PROCESAR TEXTO SVG
        const { lines, fontSize } = processTextLayout(newsTitle, style.layout);
        const lineHeight = fontSize * 1.1;
        const totalTextHeight = lines.length * lineHeight;

        // Calcular posición Y inicial según Layout
        let startY = 0;
        
        if (style.layout.includes('TOP')) {
            startY = 80 + (fontSize/2);
        } else if (style.layout.includes('BOTTOM')) {
            startY = IMG_HEIGHT - totalTextHeight + (fontSize/2) - 50;
        } else { // CENTER types
            startY = (IMG_HEIGHT - totalTextHeight)/2 + fontSize;
        }

        // Generar las líneas de texto (tspan)
        const svgLines = lines.map((line, i) => {
            const color = (i === 0) ? style.palette.fill1 : style.palette.fill2;
            return `<tspan x="50%" y="${startY + (i * lineHeight)}" fill="${color}">${line}</tspan>`;
        }).join('');


        // 4. CONSTRUIR CAPAS DE FONDO (Overlays)
        // Esto dibuja las sombras, barras o cajas detrás del texto
        let backgroundSvg = '';
        
        if (style.layout === 'TOP_GRADIENT') {
            backgroundSvg = `<linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="black" stop-opacity="0.9"/><stop offset="0.6" stop-color="black" stop-opacity="0"/></linearGradient><rect width="${IMG_WIDTH}" height="${IMG_HEIGHT}" fill="url(#g)"/>`;
        } 
        else if (style.layout === 'BOTTOM_GRADIENT') {
            backgroundSvg = `<linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0.4" stop-color="black" stop-opacity="0"/><stop offset="1" stop-color="black" stop-opacity="0.9"/></linearGradient><rect width="${IMG_WIDTH}" height="${IMG_HEIGHT}" fill="url(#g)"/>`;
        } 
        else if (style.layout === 'CENTER_VIGNETTE' || style.layout === 'BIG_IMPACT') {
            backgroundSvg = `<radialGradient id="g" cx="0.5" cy="0.5" r="0.7"><stop offset="0.5" stop-color="black" stop-opacity="0"/><stop offset="1" stop-color="black" stop-opacity="0.8"/></radialGradient><rect width="${IMG_WIDTH}" height="${IMG_HEIGHT}" fill="url(#g)"/>`;
        }
        else if (style.layout === 'TOP_BAR') {
            // Barra roja o azul detrás del texto arriba
            const barColor = (style.palette.name === 'Red Alert') ? '#CC0000' : '#000033';
            const barHeight = totalTextHeight + 60;
            backgroundSvg = `<rect x="0" y="40" width="${IMG_WIDTH}" height="${barHeight}" fill="${barColor}" opacity="0.85" />`;
        }
        else if (style.layout === 'BOTTOM_BAR') {
            // Barra abajo
            const barColor = '#000000';
            const barHeight = totalTextHeight + 60;
            const barY = IMG_HEIGHT - barHeight - 30;
            backgroundSvg = `<rect x="0" y="${barY}" width="${IMG_WIDTH}" height="${barHeight}" fill="${barColor}" opacity="0.85" />`;
        }
        else if (style.layout === 'BOXED_CENTER') {
            // Caja en el centro
            const boxWidth = IMG_WIDTH * 0.9;
            const boxHeight = totalTextHeight + 80;
            const boxX = (IMG_WIDTH - boxWidth) / 2;
            const boxY = (IMG_HEIGHT - boxHeight) / 2;
            backgroundSvg = `<rect x="${boxX}" y="${boxY}" width="${boxWidth}" height="${boxHeight}" rx="20" fill="black" opacity="0.7" stroke="white" stroke-width="5"/>`;
        }


        // 5. CONSTRUIR SVG FINAL COMPLETO
        const fullSvg = `
        <svg width="${IMG_WIDTH}" height="${IMG_HEIGHT}">
            <defs>
                <filter id="heavyShadow" x="-50%" y="-50%" width="200%" height="200%">
                    <feFlood flood-color="black" result="bg" />
                    <feMorphology operator="dilate" radius="4" in="SourceAlpha" result="thicken" />
                    <feGaussianBlur in="thicken" stdDeviation="4" result="blurred" />
                    <feComposite in="bg" in2="blurred" operator="in" result="shadow" />
                    <feMerge>
                        <feMergeNode in="shadow"/>
                        <feMergeNode in="SourceGraphic"/>
                    </feMerge>
                </filter>
                
                <filter id="softShadow">
                    <feDropShadow dx="1" dy="1" stdDeviation="1" flood-color="black" flood-opacity="0.8"/>
                </filter>
            </defs>

            ${backgroundSvg}

            <style>
                .main-text {
                    font-family: "${style.font}", "Arial Black", sans-serif;
                    font-weight: 900;
                    font-size: ${fontSize}px;
                    text-anchor: middle;
                    stroke: ${style.palette.stroke};
                    stroke-width: ${fontSize * 0.06}px;
                    stroke-linejoin: round;
                    paint-order: stroke fill;
                    /* Rotación sutil */
                    transform-origin: center;
                    transform: rotate(${style.tilt}deg);
                }
                .watermark {
                    font-family: "Arial", sans-serif;
                    font-size: 20px;
                    fill: white;
                    opacity: 0.6;
                    font-weight: bold;
                }
            </style>
            
            <text x="50%" class="main-text" filter="url(#heavyShadow)">${svgLines}</text>

            <text x="25" y="${IMG_HEIGHT - 20}" class="watermark" filter="url(#softShadow)">fuente: www.noticias.lat</text>
            
        </svg>`;


        // 6. COMPOSICIÓN FINAL (SHARP)
        const finalImageBuffer = await sharp(imageBuffer)
            .resize(IMG_WIDTH, IMG_HEIGHT)
            .composite([
                { input: Buffer.from(fullSvg) }
            ])
            .toFormat('jpg')
            .toBuffer();


        // 7. SUBIDA A BUNNY
        const filename = `news-v3-${uuidv4()}.jpg`;
        const uploadUrl = `https://ny.storage.bunnycdn.com/${BUNNY_STORAGE_ZONE}/${filename}`;

        await axios.put(uploadUrl, finalImageBuffer, {
            headers: { 'AccessKey': BUNNY_STORAGE_KEY, 'Content-Type': 'image/jpeg' }
        });

        const publicUrl = `${BUNNY_CDN_URL}/${filename}`;
        console.log(`[ImageHandler] ✅ Miniatura V3 creada: ${publicUrl}`);

        return publicUrl;

    } catch (error) {
        console.error(`[ImageHandler] Error: ${error.message}`);
        return null;
    }
};