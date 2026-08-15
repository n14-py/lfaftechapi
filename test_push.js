// Archivo: lfaftechapi/test_push.js
// Importamos con la nueva sintaxis modular de Firebase
const { initializeApp, cert } = require('firebase-admin/app');
const { getMessaging } = require('firebase-admin/messaging');

// 1. Cargar tus credenciales de cartero
const serviceAccount = require('./firebase-service-account.json');

// 2. Inicializar Firebase (Nueva sintaxis)
initializeApp({
    credential: cert(serviceAccount)
});

async function probarNotificacion() {
    console.log("==========================================");
    console.log("🚀 INICIANDO ENVÍO DE NOTIFICACIÓN A USUARIOS");
    console.log("==========================================\n");

    // 3. Armar el mensaje (Amigable y profesional para los lectores)
    const mensaje = {
        notification: {
            title: "Noticias.lat 🌎",
            body: "¡Hola! ¿Ya leíste las noticias de hoy? Entra para mantenerte al tanto de lo que pasa en el mundo."
        },
        data: {
            // Mandamos variables invisibles por si la app necesita hacer algo al hacer clic
            click_action: "FLUTTER_NOTIFICATION_CLICK",
            type: "engagement"
        },
        // Enviaremos a todos los usuarios reales que tengan la app instalada
        topic: 'all_users' 
    };

    try {
        console.log("📡 Enviando notificación a la audiencia...");
        
        // 4. Enviar el mensaje usando el nuevo módulo de mensajería
        const respuesta = await getMessaging().send(mensaje);
        
        console.log("\n✅ ¡ÉXITO TOTAL!");
        console.log("El mensaje fue entregado a Firebase. ID de respuesta:", respuesta);
        console.log("Revisa la pantalla de tu celular Android para ver cómo les llegó.");
        
    } catch (error) {
        console.error("\n❌ ERROR AL ENVIAR LA NOTIFICACIÓN:");
        console.error(error.message);
        
        if (error.message.includes("Topic provided is invalid") || error.message.includes("MessageRateExceeded")) {
            console.log("\n💡 PISTA: Asegúrate de que en Flutter tu app tenga la línea: FirebaseMessaging.instance.subscribeToTopic('all_users');");
        }
    } finally {
        // Cerramos el script
        process.exit();
    }
}

// Ejecutar la prueba
probarNotificacion();