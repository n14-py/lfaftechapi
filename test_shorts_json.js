// Archivo: test_shorts_json.js
require('dotenv').config();
const { generateShortVideoScenesJSON } = require('./utils/geminiClient');

async function runTest() {
    console.log("\n==================================================");
    console.log("🚀 INICIANDO PRUEBA: DIRECTOR DE SHORTS (85 SEG) 🚀");
    console.log("==================================================\n");

    const titulo = "El turismo rompe récords históricos en Ecuador";
    const imagen = "https://img.eldiario.ec/upload/2026/05/turismo.jpg";
    
    // Un texto de prueba con suficiente información para que la IA pueda expandirlo a 9-10 escenas
    const textoLargo = `El turismo en Ecuador ha roto todos los récords históricos durante este último feriado nacional. Las autoridades confirmaron un aumento masivo de viajeros en todo el país, lo que ha generado una reactivación económica espectacular en los últimos años. Destinos costeros y de montaña alcanzaron una ocupación hotelera del cien por ciento. Restaurantes, comercios locales y empresas de transporte reportaron ingresos muy por encima de las expectativas trazadas por los gremios. El gobierno nacional ha destacado el comportamiento cívico de los ciudadanos y el arduo trabajo de las fuerzas de seguridad para garantizar que no se presenten incidentes graves durante estas festividades. La industria hotelera ya se prepara para la próxima temporada alta con gran optimismo. Las autoridades de tránsito informaron que más de un millón de vehículos se desplazaron por las principales carreteras del país, demostrando la confianza de la población en la seguridad vial. Este repunte representa un alivio crucial para la economía de las pequeñas familias emprendedoras.`;

    try {
        console.log("🧠 Consultando a Gemini (Por favor espera unos segundos)...\n");
        const resultado = await generateShortVideoScenesJSON(titulo, textoLargo, imagen, "test_123");

        if (!resultado || resultado.error_fatal) {
            console.error("❌ Falló la generación del JSON o el contenido fue censurado.");
            return;
        }

        console.log("✅ JSON VÁLIDO RECIBIDO DE GEMINI:\n");
        console.log(JSON.stringify(resultado, null, 2));
        
        console.log("\n==================================================");
        console.log("📊 REPORTE ANALÍTICO DE TIEMPO Y MÉTRICAS");
        console.log("==================================================");

        if (!resultado.scenes || resultado.scenes.length === 0) {
            console.log("❌ El JSON no contiene el array de escenas.");
            return;
        }

        let totalWords = 0;
        resultado.scenes.forEach((escena, index) => {
            // Contamos las palabras de cada escena separando por espacios
            const words = escena.text ? escena.text.trim().split(/\s+/).length : 0;
            totalWords += words;
            
            // Un pequeño semáforo visual para las palabras por escena
            let estado = (words >= 19 && words <= 26) ? "🟢 OK" : "🟡 Revisar";
            if (escena.type === "intro") estado = (words <= 16) ? "🟢 OK (Intro)" : "🟡 Intro Larga";
            
            console.log(`Escena ${index + 1} (${escena.type.padEnd(8)}): ${words.toString().padStart(2)} palabras -> ${estado}`);
        });

        // ⏱️ LA MATEMÁTICA DEL TIEMPO (Edge TTS lee aprox 2.5 palabras por segundo)
        const estimatedSeconds = (totalWords / 2.5).toFixed(1);

        console.log("--------------------------------------------------");
        console.log(`🎬 Total de escenas : ${resultado.scenes.length} (Rango Ideal: 9 a 10)`);
        console.log(`📝 Total de palabras: ${totalWords} (Rango Ideal: 210 a 225)`);
        console.log(`⏱️  Tiempo estimado  : ${estimatedSeconds} segundos`);
        console.log("--------------------------------------------------");

        if (estimatedSeconds >= 82 && estimatedSeconds <= 89) {
            console.log("🎉 ¡ÉXITO TOTAL! El motor está perfectamente calibrado para Shorts de 85s.");
        } else if (estimatedSeconds > 89) {
            console.log("⚠️ ATENCIÓN: El video será un poco largo (peligro de pasar los 90s de YouTube Shorts).");
        } else {
            console.log("⚠️ ATENCIÓN: El video quedará un poco corto, pero funcionará perfectamente.");
        }
        console.log("==================================================\n");

    } catch (error) {
        console.error("❌ Error en la ejecución de la prueba:", error);
    }
}

// Ejecutar
runTest();