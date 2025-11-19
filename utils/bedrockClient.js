require('dotenv').config();
const { BedrockRuntimeClient, InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');
const axios = require('axios');
const cheerio = require('cheerio'); // Necesario para "leer" el HTML de la web

// --- 1. Cargar Claves de AWS (Bedrock) ---
const { AWS_BEDROCK_ACCESS_KEY_ID, AWS_BEDROCK_SECRET_ACCESS_KEY, AWS_BEDROCK_REGION } = process.env;

if (!AWS_BEDROCK_ACCESS_KEY_ID || !AWS_BEDROCK_SECRET_ACCESS_KEY || !AWS_BEDROCK_REGION) {
    console.error("Error: Faltan variables de entorno de AWS Bedrock.");
}

// --- 2. Cliente de Bedrock ---
const client = new BedrockRuntimeClient({
    region: AWS_BEDROCK_REGION,
    credentials: {
        accessKeyId: AWS_BEDROCK_ACCESS_KEY_ID,
        secretAccessKey: AWS_BEDROCK_SECRET_ACCESS_KEY,
    },
});
exports.client = client; 
exports.InvokeModelCommand = InvokeModelCommand;

const MODEL_ID = 'anthropic.claude-3-haiku-20240307-v1:0';

// --- HELPER: Función para "Leer" la URL (Scraping básico) ---
async function fetchUrlContent(url) {
    try {
        // Intentamos descargar el HTML con un timeout de 4 segundos para no trabar el proceso
        const { data } = await axios.get(url, { 
            timeout: 4000,
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36' }
        });
        
        const $ = cheerio.load(data);
        
        // Eliminamos scripts, estilos y cosas que no son noticia
        $('script').remove();
        $('style').remove();
        $('nav').remove();
        $('footer').remove();
        $('header').remove();

        // Extraemos solo los párrafos
        let text = '';
        $('p').each((i, el) => {
            text += $(el).text() + '\n';
        });

        // Limpiamos espacios extra y cortamos si es excesivamente largo (para no gastar tokens infinitos)
        return text.trim().substring(0, 15000); 
    } catch (error) {
        console.warn(`[BedrockClient] No se pudo leer el contenido HTML de ${url}: ${error.message}`);
        return null; // Si falla, devolvemos null y usamos el plan B
    }
}

// --- 3. FUNCIÓN PARA RADIOS (Sin cambios solicitados, se mantiene igual) ---
exports.generateRadioDescription = async (radio) => {
    const { nombre, pais, generos } = radio;
    const systemPrompt = `Eres un experto en SEO y redactor de contenido para 'TuRadio.lat'. Tu tarea es escribir una descripción extensa (mínimo 600-700 palabras), atractiva y optimizada para motores de búsqueda (SEO) sobre una estación de radio específica.
Directrices estrictas:
1.  **SÉ CREATIVO:** DEBES INVENTAR una historia creíble para la radio, su tipo de programación, sus locutores más famosos, y su importancia cultural.
2.  **Extensión:** Entre 600 y 700 palabras.
3.  **Formato:** Solo el artículo.`;
    
    const userPrompt = `Escribe la descripción SEO creativa para: ${nombre}, País: ${pais}, Géneros: ${generos || 'música variada'}`;

    const payload = {
        modelId: MODEL_ID,
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify({
            anthropic_version: 'bedrock-2023-05-31',
            max_tokens: 2048,
            temperature: 0.75,
            system: systemPrompt,
            messages: [{ role: 'user', content: [{ type: 'text', text: userPrompt }] }]
        })
    };

    try {
        const command = new InvokeModelCommand(payload);
        const response = await client.send(command);
        const responseBody = JSON.parse(new TextDecoder().decode(response.body));
        if (responseBody.content && responseBody.content.length > 0) {
            return responseBody.content[0].text.trim();
        }
        return null;
    } catch (error) {
        console.error(`Error Bedrock Radio:`, error.message);
        return null;
    }
};


// --- 4. FUNCIÓN PARA ARTÍCULOS (¡MODIFICADA SEGÚN TUS ÓRDENES!) ---
exports.generateArticleContent = async (article) => {
    
    // Datos originales
    const { url, title, description, paisLocal } = article; // Asumimos que article trae description y paisLocal

    if (!url || !url.startsWith('http')) {
        console.error(`Error: URL inválida para "${title}".`);
        return null;
    }

    // 1. Intentamos "Entrar" a la URL
    console.log(`[BedrockClient] Intentando leer contenido real de: ${url}...`);
    const contenidoReal = await fetchUrlContent(url);

    let promptContexto = "";
    
    if (contenidoReal && contenidoReal.length > 500) {
        // CASO A: PUDIMOS LEER LA PÁGINA
        console.log(`[BedrockClient] ¡Lectura exitosa! (${contenidoReal.length} caracteres leídos). Enviando contenido real a la IA.`);
        promptContexto = `He logrado extraer el contenido textual de la URL. Úsalo como fuente principal y única verdad:
        
--- INICIO CONTENIDO EXTRAÍDO ---
${contenidoReal}
--- FIN CONTENIDO EXTRAÍDO ---`;

    } else {
        // CASO B: NO PUDIMOS LEER (O era muy poco texto) -> FALLBACK
        console.log(`[BedrockClient] No se pudo leer la web (o estaba vacía). Usando Plan B (Título + Descripción + Búsqueda interna).`);
        promptContexto = `No pude acceder al contenido completo de la URL. 
Debes redactar la noticia basándote ESTRICTAMENTE en la siguiente información disponible:
- Título: "${title}"
- Descripción breve: "${description || 'Sin descripción'}"
- País: "${paisLocal || 'Internacional'}"

INSTRUCCIÓN DE BÚSQUEDA: Usa tu base de conocimiento para identificar de qué trata esta noticia (basado en el título y país) y complétala. NO INVENTES HECHOS que no sean lógicos o verificables por el contexto.`;
    }

    // --- SYSTEM PROMPT (LAS REGLAS DE ORO) ---
    const systemPrompt = `Eres un redactor de noticias profesional para 'Noticias.lat'.

Tu tarea es generar una noticia completa siguiendo estas REGLAS DE ORO:

1. **ADAPTABILIDAD DE LONGITUD (¡MUY IMPORTANTE!):**
   - Si la fuente o la información disponible es BREVE (poca info), redacta una noticia BREVE, concisa y directa. Cambia las palabras (parafraseo) para que sea original, pero NO la alargues artificialmente con relleno basura.
   - Si la fuente es EXTENSA y rica en detalles, redacta una noticia EXTENSA, detallada, analizando el contexto y las consecuencias.
   
2. **VERACIDAD:** - NO INVENTES DATOS. Si no sabes un dato, no lo pongas.
   - Si estás reescribiendo un texto corto, cambia sinónimos y estructura, pero mantén el mensaje intacto.
   
3. **FORMATO DE SALIDA ESTRICTO:**
   LÍNEA 1: La categoría (UNA SOLA PALABRA: politica, economia, deportes, tecnologia, entretenimiento, salud, internacional, general).
   LÍNEA 2 en adelante: El cuerpo de la noticia. Sin títulos markdown (#), sin "Aquí tienes la noticia". Solo el texto.`;
    
    const userPrompt = `Redacta la noticia para esta URL: ${url}
    
${promptContexto}`;

    const payload = {
        modelId: MODEL_ID,
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify({
            anthropic_version: 'bedrock-2023-05-31',
            max_tokens: 4000, 
            temperature: 0.4, // Bajamos temperatura para que sea más fiel a los hechos y alucine menos
            system: systemPrompt,
            messages: [
                {
                    role: 'user',
                    content: [{ type: 'text', text: userPrompt }]
                }
            ]
        })
    };

    try {
        const command = new InvokeModelCommand(payload);
        const response = await client.send(command);
        const responseBody = JSON.parse(new TextDecoder().decode(response.body));

        if (responseBody.content && responseBody.content.length > 0) {
            let responseText = responseBody.content[0].text.trim();
            
            const lines = responseText.split('\n');
            if (lines.length < 2) {
                // Fallback si no respeta formato
                return { categoriaSugerida: "general", articuloGenerado: responseText };
            }
            
            let categoriaSugerida = lines[0].trim().toLowerCase().replace('.', '');
            let articuloGenerado = lines.slice(1).join('\n').trim();
            
            const categoriasValidas = ["politica", "economia", "deportes", "tecnologia", "entretenimiento", "salud", "internacional", "general"];
            if (!categoriasValidas.includes(categoriaSugerida)) {
                 categoriaSugerida = "general";
                 articuloGenerado = responseText; 
            }
            
            console.log(`-> IA Generó noticia para "${title}". Longitud: ${articuloGenerado.length} chars.`);
            
            return {
                categoriaSugerida: categoriaSugerida,
                articuloGenerado: articuloGenerado
            };
        }
        return null;

    } catch (error) {
        console.error(`Error Bedrock News:`, error.message);
        return null; 
    }
};