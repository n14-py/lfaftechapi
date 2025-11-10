// Archivo: lfaftechapi/utils/telegramBot.js

const axios = require('axios');
const Article = require('../models/article'); // ¡NUEVO! Importar el modelo
const { TELEGRAM_BOT_TOKEN, TELEGRAM_CHANNEL_ID } = process.env;

// (Tus console.log de debug, los mantengo)
console.log("==================================================");
console.log("[DEBUG] Verificando variables de Telegram...");
console.log("[DEBUG] TELEGRAM_CHANNEL_ID (leído por la app):", TELEGRAM_CHANNEL_ID || "¡¡NO DEFINIDO!!");
console.log("[DEBUG] TELEGRAM_BOT_TOKEN (primeros 10 chars):", TELEGRAM_BOT_TOKEN ? TELEGRAM_BOT_TOKEN.substring(0, 10) + "..." : "¡¡NO DEFINIDO!!");
console.log("==================================================");

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * [INTERNO] Esta función solo CONSTRUYE y ENVÍA el mensaje.
 * (Es tu función sendTelegramMessage original, pero renombrada)
 */
async function _internalSend(article) {
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHANNEL_ID) {
        console.warn("TELEGRAM_BOT_TOKEN o TELEGRAM_CHANNEL_ID no están configurados.");
        throw new Error("Claves de Telegram no configuradas.");
    }

    const API_URL = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/`;

    const titulo = article.titulo.trim();
    const descripcion = (article.descripcion || 'Sin descripción').substring(0, 150).trim() + "...";
    const url = `https://www.noticias.lat/articulo/${article._id}`; 
    
    const escapeMarkdown = (text) => {
        if (!text) return '';
        // (Tu lógica de escape está perfecta)
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
        
        // Si el chat no se encuentra, lanzamos un error especial
        if (errorMsg.includes("chat not found")) {
            throw new Error("ChatNotFound"); // Error especial que capturaremos
        }
        // Otro error (ej. timeout), lanzamos el error para que el worker reintente
        throw error;
    }
}

/**
 * [¡NUEVA FUNCIÓN EXPORTADA!]
 * Esta es la función que llamará nuestro "worker" de Telegram.
 * Publica UN artículo y lo marca en la base de datos.
 */
exports.publicarUnArticulo = async (article) => {
    if (!article || !article._id) {
        console.error("[Telegram Worker] Se intentó publicar un artículo inválido.");
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
        
        console.log(`[Telegram Worker] Publicado con éxito: ${article.titulo}`);
        
    } catch (e) {
        console.error(`[Telegram Worker] Fallo al procesar ${article.titulo}: ${e.message}`);
        
        // Si el error es "ChatNotFound", marcamos como posteado para no reintentar
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

// La función 'publicarArticulosEnTelegram' (la que tomaba una lista)
// se elimina, ya que el nuevo worker no la necesita.