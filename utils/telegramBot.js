// Archivo: lfaftechapi/utils/telegramBot.js
const axios = require('axios');
const Article = require('../models/article'); // Importar el modelo
const { TELEGRAM_BOT_TOKEN, TELEGRAM_CHANNEL_ID } = process.env;

// (Tus console.log de debug, los mantengo)
console.log("==================================================");
console.log("[DEBUG] Verificando variables de Telegram...");
console.log("[DEBUG] TELEGRAM_CHANNEL_ID (leído por la app):", TELEGRAM_CHANNEL_ID || "¡¡NO DEFINIDO!!");
console.log("[DEBUG] TELEGRAM_BOT_TOKEN (primeros 10 chars):", TELEGRAM_BOT_TOKEN ? TELEGRAM_BOT_TOKEN.substring(0, 10) + "..." : "¡¡NO DEFINIDO!!");
console.log("==================================================");

/**
 * [INTERNO] Esta función solo CONSTRUYE y ENVÍA el mensaje.
 */
async function _internalSend(article) {
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHANNEL_ID) {
        console.warn("TELEGRAM_BOT_TOKEN o TELEGRAM_CHANNEL_ID no están configurados.");
        throw new Error("Claves de Telegram no configuradas.");
    }

    const API_URL = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/`;

    const titulo = article.titulo.trim();
    
    // --- ¡¡AQUÍ ESTÁ LA CORRECCIÓN!! ---
    // 1. Usamos el artículo de la IA.
    // 2. Tomamos el primer párrafo (hasta el primer salto de línea)
    // 3. Lo cortamos a 150 caracteres por si es muy largo.
    const descripcion = (article.articuloGenerado || article.descripcion)
        .split('\n')[0] // Tomar solo el primer párrafo
        .substring(0, 150) // Cortar a 150 caracteres
        .trim() + "...";
    // --- FIN DE LA CORRECCIÓN ---

    const url = `https://www.noticias.lat/articulo/${article._id}`; 
    
    const escapeMarkdown = (text) => {
        if (!text) return '';
        return text.replace(/[_\[\]()~`>#+-=|{}.!]/g, '\\$&');
    }
    
    const texto = `*${escapeMarkdown(titulo)}*\n\n${escapeMarkdown(descripcion)}\n\n[Leer artículo completo](${url})`;

    try {
        if (article.imagen && article.imagen.startsWith('http')) {
            await axios.post(`${API_URL}sendPhoto`, {
                chat_id: TELEGRAM_CHANNEL_ID,
                photo: article.imagen,
                caption: texto,
                parse_mode: 'MarkdownV2'
            });
        } else {
            await axios.post(`${API_URL}sendMessage`, {
                chat_id: TELEGRAM_CHANNEL_ID,
                text: texto,
                parse_mode: 'MarkdownV2',
                disable_web_page_preview: false
            });
        }
    } catch (error) {
        const errorMsg = error.response?.data?.description || error.message;
        console.error(`Error al enviar a Telegram (${titulo}):`, errorMsg);
        
        if (errorMsg.includes("chat not found")) {
            throw new Error("ChatNotFound");
        }
        throw error;
    }
}

/**
 * [¡FUNCIÓN EXPORTADA!]
 * Publica UN artículo y lo marca en la base de datos.
 */
exports.publicarUnArticulo = async (article) => {
    if (!article || !article._id) {
        console.error("[News Worker] Se intentó publicar un artículo inválido.");
        return;
    }

    try {
        // 1. Intentar enviar el mensaje
        await _internalSend(article);
        
        // 2. Si tiene éxito, marcarlo en la base de datos
        await Article.updateOne(
            { _id: article._id },
            { $set: { telegramPosted: true } }
        );
        
        console.log(`[News Worker] Publicado con éxito: ${article.titulo}`);
        
    } catch (e) {
        console.error(`[News Worker] Fallo al procesar ${article.titulo}: ${e.message}`);
        
        // Si el chat no se encuentra, marcamos como posteado para no reintentar
        if (e.message === "ChatNotFound") {
            console.error("Error 'Chat not found'. Marcando como publicado para evitar bucle.");
            await Article.updateOne(
                { _id: article._id },
                { $set: { telegramPosted: true } }
            );
        }
        // Si es otro error, NO lo marcamos, para que el worker
        // lo reintente en el próximo ciclo.
    }
};