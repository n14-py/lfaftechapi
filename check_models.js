// Archivo: lfaftechapi/check_models.js
require('dotenv').config();
const axios = require('axios');

async function check() {
    const key = process.env.GEMINI_API_KEY;
    if (!key) {
        console.error("❌ NO TIENES LA CLAVE EN EL ARCHIVO .ENV");
        return;
    }
    console.log("🔑 Usando API Key que empieza por:", key.substring(0, 10) + "...");
    
    // Consultamos directamente a la API de Google qué modelos nos permite usar
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`;
    
    try {
        const res = await axios.get(url);
        console.log("\n✅ ¡CONEXIÓN EXITOSA! ESTOS SON TUS MODELOS DISPONIBLES:");
        console.log("======================================================");
        res.data.models.forEach(m => {
            // Filtramos solo los que sirven para generar contenido
            if (m.supportedGenerationMethods && m.supportedGenerationMethods.includes("generateContent")) {
                console.log(`NOMBRE REAL: ${m.name.replace('models/', '')}`); 
            }
        });
        console.log("======================================================");
        console.log("👉 COPIA UNO DE LOS NOMBRES DE ARRIBA Y PONLO EN TU geminiClient.js");
    } catch (e) {
        console.error("\n❌ ERROR AL CONSULTAR MODELOS:");
        console.error(e.response ? e.response.data : e.message);
    }
}

check();