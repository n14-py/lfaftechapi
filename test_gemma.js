require('dotenv').config();
const mongoose = require('mongoose');
const Ad = require('./models/ad'); // Importamos tu modelo real de Anuncios
const { generateVideoScenesJSON } = require('./utils/geminiClient');

async function probarCreacionDeEscenasReal() {
    console.log("\n" + "=".repeat(60));
    console.log("🎬 INICIANDO PRUEBA REAL CON MONGODB Y GEMINI 🎬");
    console.log("=".repeat(60) + "\n");

    try {
        // 1. Conectar a la base de datos real
        console.log("🔄 Conectando a tu MongoDB...");
        await mongoose.connect(process.env.MONGODB_URI);
        console.log("✅ Conectado con éxito.\n");

        // 2. Buscar un anuncio REAL que esté "activo"
        console.log("🔍 Buscando un anuncio 'activo' en la base de datos...");
        const adData = await Ad.findOne({ estado: 'activo' });

        if (!adData) {
            console.log("⚠️ NO SE ENCONTRÓ NINGÚN ANUNCIO ACTIVO EN MONGODB.");
            console.log("👉 IMPORTANTE: Ve a tu MongoDB, busca la colección 'ads' y cambia el 'estado' de un anuncio a 'activo'. Luego vuelve a correr este test.");
            mongoose.connection.close();
            return;
        }

        console.log(`✅ Anuncio encontrado en DB: "${adData.nombreCampana}"`);
        console.log(`📌 Tipo de Anuncio: ${adData.tipo}`);
        console.log(`🔗 URL Multimedia: ${adData.mediaUrl}\n`);

        // 3. Datos de la noticia de prueba
        const tituloFalso = "ROCHA MOYA: PROTECCIÓN DE LA GUARDIA NACIONAL Y ANÁLISIS DE LA EXTRADICIÓN";
        const imagenFalsa = "https://www.elfinanciero.com.mx/resizer/v2/BVLRGKWUCZAK5KQQI574NNPCWM.jpg?smart=true";
        
        // Un texto un poco más corto para que el test sea más rápido
        const textoLargoFalso = `Tras solicitar licencia como gobernador de Sinaloa para no obstaculizar las investigaciones de la Fiscalía General de la República (FGR), Rubén Rocha Moya cuenta con elementos de la Guardia Nacional que resguardan su seguridad, según informó la presidenta Claudia Sheinbaum. La decisión se tomó tras una evaluación de riesgo realizada por el Gabinete de Seguridad, un protocolo que se aplica a cualquier ciudadano que solicite apoyo en su seguridad, ya sea un gobernador, legislador o un ciudadano común.
        Sheinbaum enfatizó que la protección se ofrece a cualquier persona que sea considerada en riesgo, tras un análisis exhaustivo de la situación. En estos casos como en cualquier otro, sea para un gobernador o gobernador con licencia de cualquier estado, un diputado, senador, ciudadano que tenga consideración de riesgo de su persona solicita a la Guardia Nacional apoyo en su seguridad y se hace un análisis de riesgo.
        La solicitud de licencia de Rocha Moya se produjo después de que el gobierno de Estados Unidos lo acusara de presuntos nexos con Los Chapitos y el crimen organizado en Sinaloa. Ante este escenario, el Congreso estatal nombró a Yeraldine Bonilla como gobernadora interina.`;

        console.log("⏳ Pasando la noticia y tu anuncio REAL a Gemini... (Tardará unos segundos)\n");

        // 4. Llamada real a Gemini con los datos de MongoDB
        const jsonEscenas = await generateVideoScenesJSON(tituloFalso, textoLargoFalso, imagenFalsa, "id_articulo_prueba", adData);

        if (jsonEscenas) {
            console.log("✅ ¡ÉXITO! AQUÍ TIENES EL JSON GENERADO CON TU ANUNCIO REAL:\n");
            console.log(JSON.stringify(jsonEscenas, null, 4));
        } else {
            console.error("❌ Falló la generación. Revisa si hay errores de Gemini.");
        }

    } catch (error) {
        console.error("❌ ERROR FATAL:", error.message);
    } finally {
        // 5. Desconectar la base de datos al terminar
        mongoose.connection.close();
        console.log("\n🔌 Conexión a MongoDB cerrada.");
    }
}

probarCreacionDeEscenasReal();