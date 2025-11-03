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

// --- 3. FUNCIÓN PRINCIPAL (Versión "Creativa") ---
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