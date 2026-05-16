// Archivo: lfaftechapi/test_inyectar_urls.js
require('dotenv').config();
const mongoose = require('mongoose');
const Article = require('./models/article');

// =====================================================================
// ⚙️ PEGA AQUÍ LOS DATOS QUE TE DIO EL SCRIPT DE PYTHON
// =====================================================================
const ID_NOTICIA = "6a089cd448299650312434c4"; // Ej: "60a1b2c3d4e5f..."
const URL_VIDEO = "https://pub-32bf4851ff77488ebe727d3dad5fbb4d.r2.dev/videos/real_vid_1778970470.mp4";
const URL_AUDIO = "https://pub-32bf4851ff77488ebe727d3dad5fbb4d.r2.dev/audios/real_aud_1778970490.mp3";
// =====================================================================

async function inyectarEnBaseDeDatos() {
    if (!ID_NOTICIA || !URL_VIDEO || !URL_AUDIO) {
        console.error("❌ Faltan datos. Asegúrate de rellenar las 3 constantes arriba.");
        return;
    }

    try {
        const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
        await mongoose.connect(uri);
        console.log("🔌 Conectado a MongoDB");

        console.log("📝 Actualizando la noticia...");
        const resultado = await Article.findByIdAndUpdate(
            ID_NOTICIA,
            {
                $set: {
                    videoUrl: URL_VIDEO,
                    audioUrl: URL_AUDIO,
                    videoProcessingStatus: 'complete'
                }
            },
            { new: true } // Para que nos devuelva el documento actualizado
        );

        if (resultado) {
            console.log("\n🎉 ¡INYECCIÓN COMPLETADA CON ÉXITO!");
            console.log(`Noticia actualizada: "${resultado.titulo}"`);
            console.log("👉 Abre tu app en Flutter y revisa la noticia en Detalles y en la pestaña de TV.");
        } else {
            console.log(`❌ No se encontró ninguna noticia con el ID: ${ID_NOTICIA}`);
        }

    } catch (error) {
        console.error("❌ Ocurrió un error al inyectar en MongoDB:", error);
    } finally {
        mongoose.connection.close();
        console.log("🔌 Conexión cerrada.");
    }
}

inyectarEnBaseDeDatos();