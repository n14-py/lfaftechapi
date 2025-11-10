// Archivo: lfaftechapi/utils/telegramBot.js

const axios = require('axios');
const { TELEGRAM_BOT_TOKEN, TELEGRAM_CHANNEL_ID } = process.env;

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function sendTelegramMessage(article) {
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHANNEL_ID) {
        console.warn("TELEGRAM_BOT_TOKEN o TELEGRAM_CHANNEL_ID no están configurados.");
        return;
    }

    const API_URL = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/`;

    const titulo = article.titulo.trim();
    const descripcion = (article.descripcion || 'Sin descripción').substring(0, 150).trim() + "...";
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
        // ¡Este es el error que viste!
        console.error(`Error al enviar a Telegram (${titulo}):`, error.response?.data?.description || error.message);
    }
}

exports.publicarArticulosEnTelegram = async (listaDeArticulos) => {
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHANNEL_ID) {
        console.error("No se puede iniciar el bot de Telegram. Faltan las claves en el .env");
        return;
    }
    console.log(`[Telegram] Inicia la publicación de ${listaDeArticulos.length} artículos...`);
    const articulosAlReves = [...listaDeArticulos].reverse();

    for (const article of articulosAlReves) {
        try {
            await sendTelegramMessage(article); 
            await sleep(2000); // Pausa de 2 segundos para evitar SPAM
        } catch (e) {
            console.error(`Error en el bucle de Telegram: ${e.message}`);
        }
    }
    console.log("[Telegram] Publicación completada.");
};