require('dotenv').config();
const { BedrockRuntimeClient, InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');

// --- 1. Cargar Claves de AWS (Bedrock) ---
const { AWS_BEDROCK_ACCESS_KEY_ID, AWS_BEDROCK_SECRET_ACCESS_KEY, AWS_BEDROCK_REGION } = process.env;

if (!AWS_BEDROCK_ACCESS_KEY_ID || !AWS_BEDROCK_SECRET_ACCESS_KEY || !AWS_BEDROCK_REGION) {
    console.error("Error: Faltan variables de entorno de AWS Bedrock.");
}

// --- 2. Cliente de Bedrock (Lo exportamos) ---
const client = new BedrockRuntimeClient({
    region: AWS_BEDROCK_REGION,
    credentials: {
        accessKeyId: AWS_BEDROCK_ACCESS_KEY_ID,
        secretAccessKey: AWS_BEDROCK_SECRET_ACCESS_KEY,
    },
});
exports.client = client; // Exportamos el cliente
exports.InvokeModelCommand = InvokeModelCommand; // Exportamos el comando

const MODEL_ID = 'anthropic.claude-3-haiku-20240307-v1:0';

// --- 3. FUNCIÓN PARA RADIOS (Existente, sin cambios) ---
/**
 * Llama a la IA de AWS Bedrock para que INVENTE una descripción SEO para una radio.
 */
exports.generateRadioDescription = async (radio) => {
    const { nombre, pais, generos } = radio;

    // --- ¡NUEVO PROMPT! Le decimos que sea creativo. ---
    const systemPrompt = `Eres un experto en SEO y redactor de contenido para 'TuRadio.lat'. Tu tarea es escribir una descripción extensa (mínimo 600-700 palabras), atractiva y optimizada para motores de búsqueda (SEO) sobre una estación de radio específica.

Directrices estrictas:
1.  **SÉ CREATIVO:** No tienes acceso a internet. DEBES INVENTAR una historia creíble para la radio, su tipo de programación (basado en los géneros), sus locutores más famosos, y su importancia cultural en su país.
2.  **Extensión:** El artículo debe tener entre 600 y 700 palabras.
3.  **Estructura:** Párrafos claros. Sin títulos ni subtítulos.
4.  **Palabras Clave (SEO):** Integra natural y repetidamente: "escuchar radio en vivo", "radio online", "estación de radio", "${nombre}", "radios de ${pais}", "sintonizar ${nombre}", "frecuencia de radio ${nombre}".
5.  **Formato de Salida:** Responde ÚNICAMENTE con el artículo. NO incluyas "¡Claro, aquí tienes!". Solo el texto del artículo.`;
    
    const userPrompt = `Escribe la descripción SEO creativa (600-700 palabras) para esta estación:
-   Nombre de la Radio: ${nombre}
-   País: ${pais}
-   Géneros Principales: ${generos || 'música variada'}`;

    // --- 4. Llamada a Bedrock ---
    const payload = {
        modelId: MODEL_ID,
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify({
            anthropic_version: 'bedrock-2023-05-31',
            max_tokens: 2048,
            temperature: 0.75, // Un poco más creativo
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
            console.error(`Error FATAL: ¿Tienes acceso al modelo '${MODEL_ID}' en la región '${AWS_BEDROCK_REGION}'? (¿Rellenaste el formulario de Caso de Uso?)`);
        }
        return null;
    }
};


// --- 4. FUNCIÓN PARA ARTÍCULOS (Tu lógica de DeepSeek, adaptada a Bedrock) ---
/**
 * Llama a la IA de AWS Bedrock para REESCRIBIR un artículo basado en una URL.
 */
exports.generateArticleContent = async (article) => {
    
    // Corrección para leer 'url' y 'title' de la fila de memoria
    const { url, title } = article;

    if (!url || !url.startsWith('http')) {
        console.error(`Error: No se puede procesar "${title}" porque no tiene URL.`);
        return null;
    }

    // --- ¡¡CAMBIO #1: PROMPT MÁS ESTRICTO!! ---
    const systemPrompt = `Eres un reportero senior para 'Noticias.lat'. Tu trabajo es analizar una URL y devolver un artículo completo.

Tu respuesta DEBE tener el siguiente formato estricto:
LÍNEA 1: La categoría (UNA SOLA PALABRA de esta lista: politica, economia, deportes, tecnologia, entretenimiento, salud, internacional, general).
LÍNEA 2 (Y SIGUIENTES): El artículo de noticias.

REGLAS PARA EL ARTÍCULO:
1.  **EXTENSIÓN OBLIGATORIA:** El artículo DEBE ser muy extenso. El objetivo es un mínimo de 700 u 800 palabras. Desarrolla la noticia en profundidad, añade contexto, antecedentes y posibles consecuencias. No te limites a resumir.
2.  **PROFESIONAL:** Debe ser un artículo de noticias completo y profesional.
3.  **FORMATO:** NO USES JSON. NO USES MARKDOWN. NO AÑADAS TEXTO ADICIONAL.`;
    
    const userPrompt = `Analiza el contenido de este enlace y redáctalo desde cero. Recuerda el formato y la regla de extensión (mínimo 700-800 palabras):
Línea 1: solo la categoría.
Línea 2 en adelante: el artículo.
URL: ${url}`;

    const payload = {
        modelId: MODEL_ID,
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify({
            anthropic_version: 'bedrock-2023-05-31',
            // --- ¡¡CAMBIO #2: MÁS TOKENS!! ---
            max_tokens: 4000, // Aumentado de 2048 a 4000
            temperature: 0.5, // Más preciso, menos creativo
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
            
            // Parseamos la respuesta (Línea 1: Categoria, Línea 2: Artículo)
            const lines = responseText.split('\n');
            if (lines.length < 2) {
                console.error(`Error: IA (Bedrock) no siguió formato (Respuesta: ${responseText}) para ${url}`);
                return null;
            }
            
            let categoriaSugerida = lines[0].trim().toLowerCase().replace('.', ''); // Limpiamos la categoría
            let articuloGenerado = lines.slice(1).join('\n').trim();
            
            const categoriasValidas = ["politica", "economia", "deportes", "tecnologia", "entretenimiento", "salud", "internacional", "general"];
            if (!categoriasValidas.includes(categoriaSugerida)) {
                 console.warn(`Categoría no válida: "${categoriaSugerida}" para ${url}. Forzando a 'general'.`);
                 categoriaSugerida = "general";
                 articuloGenerado = responseText; // Usamos todo el texto por si falló el split
            }
            
            if (!articuloGenerado) {
                console.error(`Error: IA (Bedrock) devolvió categoría pero no artículo para ${url}`);
                return null;
            }
            
            console.log(`-> IA (Bedrock) generó artículo para ${title} (Cat: ${categoriaSugerida}, Longitud: ${articuloGenerado.length})`);
            
            return {
                categoriaSugerida: categoriaSugerida,
                articuloGenerado: articuloGenerado
            };
        }
        return null;

    } catch (error) {
        console.error(`Error al invocar Bedrock (${MODEL_ID}) para ${url}:`, error.message);
        if (error.name === 'AccessDeniedException') {
            console.error(`Error FATAL: ¿Tienes acceso al modelo '${MODEL_ID}' en la región '${AWS_BEDROCK_REGION}'?`);
        }
        return null; 
    }
};