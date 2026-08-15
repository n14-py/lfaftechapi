




// Archivo: lfaftechapi/utils/pushScheduler.js
const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getMessaging } = require('firebase-admin/messaging');
const cron = require('node-cron');
const Article = require('../models/article');

try {
    const serviceAccount = require('../firebase-service-account.json');
    if (!getApps().length) {
        initializeApp({ credential: cert(serviceAccount) });
    }
    console.log("🔥 Motor PUSH Independiente Inicializado correctamente.");
} catch (error) {
    console.warn("⚠️ [Firebase PUSH] Error de inicialización.");
}

async function enviarNoticiaTop() {
    try {
        const hace24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const articulo = await Article.findOne({
            fecha: { $gte: hace24h },
            categoria: { $in: ['politica', 'economia', 'internacional', 'tecnologia'] }
        }).sort({ fecha: -1 }); 

        if (!articulo) return;

        const mensaje = {
            notification: {
                title: "🚨 Lo más destacado: " + articulo.categoria.toUpperCase(),
                body: articulo.titulo
            },
            data: {
                // CORREGIDO: Adaptado exactamente al código main.dart de tu app
                article_id: articulo._id.toString(),
                click_action: "FLUTTER_NOTIFICATION_CLICK"
            },
            topic: 'all_users'
        };

        await getMessaging().send(mensaje);
        console.log(`[PUSH] 📲 Noticia enviada a la App: ${articulo.titulo}`);
    } catch (error) {
        console.error("[PUSH] Error enviando noticia:", error.message);
    }
}

async function enviarMensajeAmigable() {
    try {


        const mensajes = [
            // Los originales
            "👋 ¡Hola! El mundo no se detiene. Entra a ver qué está pasando ahora en Noticias.lat.",
            "☕ Tómate un respiro y ponte al día con los últimos titulares.",
            "📱 Tu resumen informativo te espera. Abre la app para no perderte de nada.",
            
            // De Curiosidad e Interés
            "🤔 ¿Qué está pasando en el mundo en este instante? Descúbrelo ahora mismo en la app.",
            "🌍 Desde tu región hasta el otro lado del mundo. Toda la información a un clic de distancia.",
            "💡 ¿Te perdiste algo importante hoy? Te lo contamos todo en Noticias.lat.",
            "👀 Tenemos nuevos titulares que podrían interesarte. ¡Échales un vistazo rápido!",
            "🎯 Información que va directo al grano. Toca aquí para leer las últimas novedades.",
            "🌟 Tu dosis de información está lista. ¡Que no te lo cuenten otros, descúbrelo tú mismo!",
            "🔍 Si está pasando, está en Noticias.lat. Entra y compruébalo.",
            "🌐 No te quedes fuera de la conversación. Descubre las noticias del día.",
            "🔥 Calientitas, recién salidas de nuestra redacción. Así están las noticias de hoy.",
            
            // Recordatorios de Funciones (Audio/Video)
            "🎧 ¿No tienes tiempo de leer? Recuerda que puedes escuchar todas nuestras noticias con IA.",
            "🎬 ¿Ya viste nuestros últimos reportajes en video? Información dinámica para gente ocupada.",
            "⚡ Noticias breves, audios y videos. Todo tu ecosistema informativo en un solo lugar.",
            
            // Momentos del día (Mañana/Tarde/Noche)
            "🌅 ¡Buen día! Empieza tu jornada bien informado y con el pie derecho.",
            "☀️ El mundo ya despertó y hay mucho que contar. Descubre qué está pasando hoy.",
            "🥪 ¿Pausa para almorzar? Acompáñala con las noticias más destacadas del momento.",
            "⏱️ Tómate 5 minutos para ti. Entérate de lo que sucede en el mundo en un par de toques.",
            "🚶‍♂️ De camino a casa o en un break, siempre es un buen momento para informarse.",
            "🌙 El día casi termina, pero la información no. Revisa el resumen de hoy.",
            "🛋️ Ponte cómodo y repasa las noticias que marcaron la jornada.",
            "🌃 Antes de desconectar por completo, échale un vistazo a los titulares más importantes.",
            
            // Acción directa
            "📰 Las noticias no esperan. Abre la app y mantente un paso adelante.",
            "📲 ¡Toc, toc! Hay información fresca esperándote. ¿Te la vas a perder?",
            "🗞️ Mantente conectado con la realidad. Los titulares te esperan.",
            "📌 Lo más relevante de la jornada, seleccionado para ti. ¡Entra ya!",
            "🔔 Ring, ring... ¡La actualidad te llama! Ponte al día en solo un par de minutos.",
            "🧠 Entrena tu mente con buena información. Los temas de hoy están listos.",
            "⏳ Solo te tomará unos minutos estar al tanto de todo. ¡Anímate y entra!",
            "✨ Información de calidad, directo en tu bolsillo. ¿Qué esperas para leer?"
        ];
        
        const randomMsg = mensajes[Math.floor(Math.random() * mensajes.length)];

        const mensaje = {
            notification: {
                title: "Noticias.lat 🌎",
                body: randomMsg
            },
            data: {
                click_action: "FLUTTER_NOTIFICATION_CLICK",
                type: "engagement"
            },
            topic: 'all_users'
        };

        await getMessaging().send(mensaje);
        console.log(`[PUSH] 📲 Mensaje amigable enviado a la App.`);
    } catch (error) {
        console.error("[PUSH] Error enviando engagement:", error.message);
    }
}

exports.iniciarMotorPush = () => {
    console.log("⏰ Reloj de Notificaciones PUSH programado.");
    
    cron.schedule('0 9,14,19 * * *', () => { enviarNoticiaTop(); });
    cron.schedule('0 21 * * *', () => { enviarMensajeAmigable(); });
};













