require('dotenv').config(); // Cargar variables de entorno
const { BedrockRuntimeClient, InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');

// 1. Cargar y verificar las claves de AWS desde .env
const { AWS_BEDROCK_ACCESS_KEY_ID, AWS_BEDROCK_SECRET_ACCESS_KEY, AWS_BEDROCK_REGION } = process.env;

if (!AWS_BEDROCK_ACCESS_KEY_ID || !AWS_BEDROCK_SECRET_ACCESS_KEY || !AWS_BEDROCK_REGION) {
    console.error("Error: Faltan variables de entorno de AWS Bedrock. Asegúrate de configurar AWS_BEDROCK_ACCESS_KEY_ID, AWS_BEDROCK_SECRET_ACCESS_KEY y AWS_BEDROCK_REGION en tu .env");
}

// 2. Crear el cliente de Bedrock
const client = new BedrockRuntimeClient({
    region: AWS_BEDROCK_REGION,
    credentials: {
        accessKeyId: AWS_BEDROCK_ACCESS_KEY_ID,
        secretAccessKey: AWS_BEDROCK_SECRET_ACCESS_KEY,
    },
});

// 3. Definir el modelo que solicitaste (Haiku es el más rápido y barato)
const MODEL_ID = 'anthropic.claude-3-haiku-20240307-v1:0';

/**
 * Llama a la IA de AWS Bedrock para generar una descripción SEO para una radio.
 * @param {object} radio - El objeto de la radio (debe tener nombre, pais, generos)
 * @returns {Promise<string|null>} - El texto de la descripción o null si falla.
 */
exports.generateRadioDescription = async (radio) => {
    const { nombre, pais, generos } = radio;
    
    // 4. El "System Prompt" (las reglas del juego para la IA)
    // ¡Este es el cerebro del SEO!
    const systemPrompt = `Eres un experto en SEO y redactor de contenido para 'TuRadio.lat'. Tu tarea es escribir una descripción extensa (mínimo 600-700 palabras), atractiva y optimizada para motores de búsqueda (SEO) sobre una estación de radio específica.

Directrices estrictas:
1.  **Extensión:** El artículo debe tener entre 600 y 700 palabras. Esto es crucial para el SEO.
2.  **Estructura:** Usa párrafos claros. No uses títulos ni subtítulos.
3.  **Tono:** Profesional, entusiasta y descriptivo.
4.  **Palabras Clave (Keywords):** Debes integrar natural y repetidamente las siguientes palabras clave: "escuchar radio en vivo", "radio online", "estación de radio", "${nombre}", "radios de ${pais}", "sintonizar ${nombre}", "frecuencia de radio ${nombre}".
5.  **Contenido:** El artículo debe inventar o describir la historia de la radio (si no la sabe, que sea creativo), su tipo de programación (basado en los géneros), sus locutores más famosos (puede inventarlos), su importancia cultural en ${pais}, y por qué la gente debería escucharla gratis en TuRadio.lat.
6.  **Formato de Salida:** Responde ÚNICAMENTE con el artículo. NO incluyas frases como "¡Claro, aquí tienes!" o "Espero que te guste". Solo el texto del artículo.`;

    // 5. El "User Prompt" (los datos específicos)
    const userPrompt = `Escribe la descripción SEO (600-700 palabras) para la siguiente estación:
-   Nombre de la Radio: ${nombre}
-   País: ${pais}
-   Géneros Principales: ${generos || 'música variada'}`;

    // 6. Construir el 'body' que pide AWS para Claude 3
    const payload = {
        modelId: MODEL_ID,
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify({
            anthropic_version: 'bedrock-2023-05-31', // Versión requerida por Anthropic
            max_tokens: 2048, // Suficiente para 700 palabras (aprox. 1000 tokens)
            temperature: 0.7, // Un buen balance de creatividad y coherencia
            system: systemPrompt,
            messages: [
                {
                    role: 'user',
                    content: [{ type: 'text', text: userPrompt }]
                }
            ]
        })
    };

    // 7. Enviar la petición a Bedrock
    try {
        const command = new InvokeModelCommand(payload);
        const response = await client.send(command);

        // 8. Decodificar la respuesta
        const responseBody = JSON.parse(new TextDecoder().decode(response.body));
        
        if (responseBody.content && responseBody.content.length > 0) {
            const generatedText = responseBody.content[0].text.trim();
            console.log(`-> IA generó descripción para ${nombre} (${generatedText.length} caracteres)`);
            return generatedText;
        } else {
            console.error("Respuesta inesperada de Bedrock:", responseBody);
            return null;
        }

    } catch (error) {
        console.error(`Error al invocar Bedrock (${MODEL_ID}) para ${nombre}:`, error.message);
        // Error común si no pediste acceso al modelo en la consola de AWS
        if (error.name === 'AccessDeniedException') {
            console.error(`Error FATAL: ¿Tienes acceso al modelo '${MODEL_ID}' en la región '${AWS_BEDROCK_REGION}'?`);
        }
        return null;
    }
};