require('dotenv').config();
const { BedrockRuntimeClient, InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');
const axios = require('axios'); // ¡Importante! Lo usaremos para buscar.

// --- 1. Cargar Claves de AWS (Bedrock) ---
const { AWS_BEDROCK_ACCESS_KEY_ID, AWS_BEDROCK_SECRET_ACCESS_KEY, AWS_BEDROCK_REGION } = process.env;

if (!AWS_BEDROCK_ACCESS_KEY_ID || !AWS_BEDROCK_SECRET_ACCESS_KEY || !AWS_BEDROCK_REGION) {
    console.error("Error: Faltan variables de entorno de AWS Bedrock.");
}

// --- 2. Cargar Clave de Búsqueda (Serper) ---
const SERPER_API_KEY = process.env.SERPER_API_KEY;
if (!SERPER_API_KEY) {
    console.error("Error: SERPER_API_KEY no encontrada en .env. La IA no podrá 'investigar'.");
}

// --- 3. Cliente de Bedrock (igual que antes) ---
const client = new BedrockRuntimeClient({
    region: AWS_BEDROCK_REGION,
    credentials: {
        accessKeyId: AWS_BEDROCK_ACCESS_KEY_ID,
        secretAccessKey: AWS_BEDROCK_SECRET_ACCESS_KEY,
    },
});

const MODEL_ID = 'anthropic.claude-3-haiku-20240307-v1:0';

// --- 4. ¡NUEVA FUNCIÓN! El "investigador" ---
/**
 * Busca en Google (vía Serper.dev) información real sobre la radio.
 */
async function _investigarRadio(radioNombre, radioPais) {
    if (!SERPER_API_KEY) return null; // No buscar si no hay clave

    const query = `informacion historia y programacion de radio ${radioNombre} ${radioPais}`;
    
    try {
        console.log(`-> Investigando (Serper): "${query}"...`);
        const response = await axios.post('https://google.serper.dev/search', { q: query }, {
            headers: { 'X-API-KEY': SERPER_API_KEY, 'Content-Type': 'application/json' }
        });
        
        if (response.data && response.data.organic) {
            // Unimos los "snippets" (fragmentos) de los 5 primeros resultados
            const contexto = response.data.organic.slice(0, 5).map(r => r.snippet).join('\n');
            console.log(`-> Contexto encontrado (${contexto.length} caracteres).`);
            return contexto;
        }
        return null;
    } catch (error) {
        console.error(`Error al investigar con Serper.dev: ${error.message}`);
        return null; // Continuar sin contexto si la búsqueda falla
    }
}


// --- 5. FUNCIÓN PRINCIPAL (Actualizada) ---
/**
 * Llama a la IA de AWS Bedrock para generar una descripción SEO para una radio,
 * PERO ahora incluye un paso previo de investigación.
 */
exports.generateRadioDescription = async (radio) => {
    const { nombre, pais, generos } = radio;

    // --- ¡PASO 1: INVESTIGAR! ---
    const contextoReal = await _investigarRadio(nombre, pais);
    // -----------------------------

    // --- ¡PASO 2: PROMPT MEJORADO! ---
    // Ahora le decimos a la IA que PRIORICE la información real.
    
    const systemPrompt = `Eres un experto en SEO y redactor de contenido para 'TuRadio.lat'. Tu tarea es escribir una descripción extensa (mínimo 600-700 palabras), atractiva y optimizada para motores de búsqueda (SEO) sobre una estación de radio específica.

Directrices estrictas:
1.  **Prioridad a los Hechos:** DEBES usar el "CONTEXTO DE BÚSQUEDA" que te proporciono. Basa la historia, el tipo de programación y los datos de la radio en esa información real.
2.  **Relleno Creativo:** Si el contexto es pobre o no da suficientes detalles (locutores, etc.), PUEDES ser creativo para rellenar los huecos, pero siempre priorizando los hechos.
3.  **Extensión:** El artículo debe tener entre 600 y 700 palabras.
4.  **Estructura:** Párrafos claros. Sin títulos ni subtítulos.
5.  **Palabras Clave (SEO):** Integra natural y repetidamente: "escuchar radio en vivo", "radio online", "estación de radio", "${nombre}", "radios de ${pais}", "sintonizar ${nombre}", "frecuencia de radio ${nombre}".
6.  **Formato de Salida:** Responde ÚNICAMENTE con el artículo. NO incluyas "¡Claro, aquí tienes!". Solo el texto del artículo.`;

    // --- ¡PASO 3: USER PROMPT MEJORADO! ---
    // Ahora le pasamos el contexto que encontramos.
    
    const userPrompt = `Aquí están los datos:
-   Nombre de la Radio: ${nombre}
-   País: ${pais}
-   Géneros Principales: ${generos || 'música variada'}

--- CONTEXTO DE BÚSQUEDA (Información Real): ---
${contextoReal || 'No se encontró información adicional. Sé creativo pero profesional.'}
---
Escribe la descripción SEO (600-700 palabras) usando este contexto como base principal.`;

    // --- PASO 4: Llamada a Bedrock (igual que antes) ---
    const payload = {
        modelId: MODEL_ID,
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify({
            anthropic_version: 'bedrock-2023-05-31',
            max_tokens: 2048,
            temperature: 0.7,
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
            const generatedText = responseBody.content[0].text.trim();
            console.log(`-> IA (Bedrock) generó descripción para ${nombre} (${generatedText.length} caracteres)`);
            return generatedText;
        } else {
            console.error("Respuesta inesperada de Bedrock:", responseBody);
            return null;
        }

    } catch (error) {
        console.error(`Error al invocar Bedrock (${MODEL_ID}) para ${nombre}:`, error.message);
        if (error.name === 'AccessDeniedException') {
            console.error(`Error FATAL: ¿Tienes acceso al modelo '${MODEL_ID}' en la región '${AWS_BEDROCK_REGION}'?`);
        }
        return null;
    }
};