// Archivo: test_shorts_real.js
require('dotenv').config();
const mongoose = require('mongoose');
const Ad = require('./models/ad'); // Tu modelo real de anuncios
const { generateShortVideoScenesJSON } = require('./utils/geminiClient'); // El generador de Shorts

async function runTest() {
    console.log("\n==================================================================");
    console.log("  INICIANDO PRUEBA REAL: DIRECTOR DE SHORTS (CON SORTEO DE ADS)");
    console.log("==================================================================\n");

    try {
        // 1. Conectar a la base de datos real
        console.log("  Conectando a MongoDB Atlas...");
        await mongoose.connect(process.env.MONGODB_URI);
        console.log("  Conectado con éxito.\n");

        // 2. SISTEMA DE SORTEO REAL (Igual que en tu syncShortsController.js)
        console.log("  Buscando un anuncio activo al azar (Excluyendo 'video_incrustado' horizontal)...");
        
        const anunciosActivos = await Ad.aggregate([
            { $match: { estado: 'activo', tipo: { $ne: 'video_incrustado' } } },
            { $sample: { size: 1 } } // Saca 1 al azar
        ]);

        const adData = anunciosActivos.length > 0 ? anunciosActivos[0] : null;

        if (!adData) {
            console.log("  ADVERTENCIA: No se encontró ningún anuncio válido para Shorts en MongoDB.");
            console.log("  El Short se generará SIN publicidad.");
        } else {
            console.log(`  ¡Sorteo Ganado!`);
            console.log(`  -> Campaña: "${adData.nombreCampana}"`);
            console.log(`  -> Tipo: "${adData.tipo}"`);
            console.log(`  -> Media: ${adData.mediaUrl}\n`);
        }

        // 3. Datos de la noticia de prueba (Larga y detallada)
        const titulo = "¡Misterio en el Espacio! La NASA capta una extraña señal de radio repetitiva";
        const imagen = "https://img.freepik.com/fotos-premium/galaxia-espacio-estrellas_942223-110.jpg";
        const textoLargo = `La comunidad astronómica internacional se encuentra conmocionada tras el último anuncio de la NASA. Astrónomos utilizando el telescopio espacial James Webb han detectado una misteriosa y potente señal de radio que se repite exactamente cada 16 días, proveniente de una galaxia ubicada a millones de años luz de la Tierra. A diferencia de otras ráfagas rápidas de radio descubiertas en el pasado, este nuevo fenómeno presenta un patrón matemático casi perfecto, lo que ha desatado todo tipo de teorías. Algunos científicos sugieren que podría tratarse de una estrella de neutrones altamente magnetizada, conocida como púlsar, que gira a velocidades vertiginosas. Sin embargo, una pequeña facción de investigadores no descarta que estemos ante un intento de comunicación de una civilización extraterrestre muy avanzada. Las agencias espaciales de Europa, Japón y China ya han apuntado sus mejores radiotelescopios hacia las coordenadas exactas para intentar descifrar el origen de este enigma intergaláctico. El director de ciencias de la NASA pidió cautela, recordando que el universo tiene fenómenos naturales extremos que aún no comprendemos del todo.`;

        console.log(`  Lanzando el guion a Gemini... (Paciencia, tarda unos segunditos)\n`);
        
        // 4. Pasamos todo a la función de Gemini
        const resultado = await generateShortVideoScenesJSON(titulo, textoLargo, imagen, "id_test_shorts", adData);

        if (!resultado || resultado.error_fatal) {
            console.error("  ¡Fallo la generación del JSON! (Revisar cuota de API o censura).");
            return;
        }

        console.log("  JSON VÁLIDO RECIBIDO DE GEMINI:\n");
        console.log(JSON.stringify(resultado, null, 2));

        // 5. Análisis de tiempos y métricas
        console.log("\n==================================================");
        console.log("  REPORTE DE RENDIMIENTO (SHORTS)");
        console.log("==================================================");

        if (!resultado.scenes || resultado.scenes.length === 0) {
            console.log("  El JSON no contiene escenas.");
            return;
        }

        let totalWords = 0;
        let hasAdVideo = false;

        resultado.scenes.forEach((escena, index) => {
            if (escena.type === "ad_video") {
                hasAdVideo = true;
                console.log(`Escena ${index + 1} (ad_video): COMERCIAL FULL SCREEN (Aprox 12 seg) -> ✅ OK`);
                return;
            }

            const words = escena.text ? escena.text.trim().split(/\s+/).length : 0;
            totalWords += words;
            
            let estado = "⚠️ Revisar";
            if (escena.type === "intro") {
                estado = (words <= 16) ? "✅ OK (Intro)" : "⚠️ Intro Larga";
            } else {
                estado = (words >= 15 && words <= 30) ? "✅ OK" : "⚠️ Revisar Largo";
            }
            console.log(`Escena ${index + 1} (${escena.type.padEnd(10)}): ${words.toString().padStart(2)} palabras -> ${estado}`);
        });

        // TTS Edge lee aprox 2.5 palabras por segundo
        let estimatedSeconds = totalWords / 2.5;
        if (hasAdVideo) {
            estimatedSeconds += 12; // Sumamos 12s ficticios por el video comercial
        }

        console.log("--------------------------------------------------");
        console.log(`  Total de escenas : ${resultado.scenes.length}`);
        console.log(`  Palabras de voz  : ${totalWords}`);
        console.log(`  Tiempo estimado  : ${estimatedSeconds.toFixed(1)} segundos (Buscamos ~80s)`);
        console.log("--------------------------------------------------");

        if (estimatedSeconds >= 75 && estimatedSeconds <= 85) {
            console.log("  ¡ÉXITO TOTAL! El Short encaja perfecto en el formato de YouTube.");
        } else if (estimatedSeconds > 85) {
            console.log("  ATENCIÓN: Cuidado, te estás acercando al límite de los 90s de Shorts.");
        } else {
            console.log("  ATENCIÓN: Quedó un poco corto, pero se publicará bien.");
        }
        console.log("==================================================\n");

    } catch (error) {
        console.error("  Error fatal en la ejecución:", error);
    } finally {
        mongoose.connection.close();
        console.log("  Conexión a MongoDB cerrada.");
    }
}

runTest();