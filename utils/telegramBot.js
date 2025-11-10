// Archivo: lfaftechapi/utils/telegramBot.js

const axios = require('axios');
// Cargamos las claves desde el archivo .env
const { TELEGRAM_BOT_TOKEN, TELEGRAM_CHANNEL_ID } = process.env;

// Función para añadir pausas
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Envía un artículo formateado a tu canal de Telegram.
 */
async function sendTelegramMessage(article) {
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHANNEL_ID) {
        console.warn("TELEGRAM_BOT_TOKEN o TELEGRAM_CHANNEL_ID no están configurados. Omitiendo post.");
        return;
    }

    const API_URL = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/`;

    // 1. Formateamos el texto del mensaje
    const titulo = article.titulo.trim();
    const descripcion = (article.descripcion || 'Sin descripción').substring(0, 150).trim() + "...";
    
    // ¡Usamos las nuevas URLs amigables de Next.js!
    // (Asegúrate de que tu modelo 'article' tenga '_id')
    const url = `https://www.noticias.lat/articulo/${article._id}`; 
    
    // Telegram usa un formato especial llamado MarkdownV2.
    // Esta función escapa caracteres que podrían romper el mensaje (como '-', '.', '!', '(', ')').
    const escapeMarkdown = (text) => {
        if (!text) return '';
        return text.replace(/[_\[\]()~`>#+-=|{}.!]/g, '\\$&');
    }
    
    // Creamos el mensaje final
    const texto = `*${escapeMarkdown(titulo)}*\n\n${escapeMarkdown(descripcion)}\n\n[Leer artículo completo](${url})`;

    try {
        // 2. Intentamos enviar CON FOTO (si la imagen existe y es una URL)
        if (article.imagen && article.imagen.startsWith('http')) {
            await axios.post(`${API_URL}sendPhoto`, {
                chat_id: TELEGRAM_CHANNEL_ID,
                photo: article.imagen,
                caption: texto,
                parse_mode: 'MarkdownV2'
            });
        } else {
            // 3. Si no hay foto, enviamos SOLO TEXTO
            await axios.post(`${API_URL}sendMessage`, {
                chat_id: TELEGRAM_CHANNEL_ID,
                text: texto,
                parse_mode: 'MarkdownV2',
                disable_web_page_preview: false // Muestra la vista previa del enlace
            });
        }
        
    } catch (error) {
        // Si Telegram da un error (ej: 'Bad Request: CHAR_INVALID'), lo mostramos
        console.error(`Error al enviar a Telegram (${titulo}):`, error.response?.data?.description || error.message);
    }
}

/**
 * Publica una lista de artículos en Telegram CON PAUSAS,
 * para evitar ser bloqueado por SPAM.
 */
exports.publicarArticulosEnTelegram = async (listaDeArticulos) => {
    // Verificamos que las claves existan antes de empezar
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHANNEL_ID) {
        console.error("No se puede iniciar el bot de Telegram. Faltan las claves en el .env");
        return;
    }
    
    console.log(`[Telegram] Inicia la publicación de ${listaDeArticulos.length} artículos...`);
    
    // Procesamos en orden inverso (para que el artículo más nuevo se publique al final)
    const articulosAlReves = [...listaDeArticulos].reverse();

    for (const article of articulosAlReves) {
        try {
            // Pasamos el artículo completo
            await sendTelegramMessage(article); 
            
            // ¡MUY IMPORTANTE! Pausa de 2 segundos entre cada post
            // para no saturar la API de Telegram y evitar baneos.
            await sleep(2000); 
        } catch (e) {
            console.error(`Error en el bucle de Telegram: ${e.message}`);
        }
    }
    console.log("[Telegram] Publicación completada.");
};