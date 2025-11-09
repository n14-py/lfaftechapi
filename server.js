// =============================================
//         LFAF TECH - API MADRE (v3.0.0)
// =============================================
require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');

// Importamos el "enrutador" principal (que ahora incluye /api/games)
const apiRoutes = require('./routes/index');

const app = express();
const PORT = process.env.PORT || 3000;

// =============================================
// MIDDLEWARES (¡AQUÍ ESTÁ LA SOLUCIÓN DE CORS!)
// =============================================

// 1. Definimos los sitios web que SÍ tienen permiso de llamar a esta API
const whiteList = [

    'https://lfaftechapi.onrender.com',

    'http://127.0.0.1:5500',  // Tu localhost (IP)
    'http://localhost:5500',   // Tu localhost (Nombre)
    'http://127.0.0.1:5501',
    'http://localhost:3000',
    'http://192.168.0.4:3000',
    // --- SITIOS EXISTENTES ---
    'https://www.noticias.lat', // Tu sitio de noticias en Vercel
    'https://noticias.lat',
    'https://www.turadio.lat' ,  // Tu sitio de radio
    'https://turadio.lat', 
    
    // --- ¡¡NUEVOS SITIOS AÑADIDOS!! ---
    'https://www.tusinitusineli.com', // Tu nuevo sitio de juegos
    'https://tusinitusineli.vercel.app/',
    'https://tusinitusineli.com'
];

const corsOptions = {
    origin: function (origin, callback) {
        // Si el 'origin' (el sitio que llama) está en nuestra lista blanca,
        // o si es una llamada desde el mismo servidor (como Postman, que no tiene origin),
        // le damos permiso.
        if (whiteList.indexOf(origin) !== -1 || !origin) {
            callback(null, true);
        } else {
            // --- ¡AQUÍ ESTÁ LA DEPURACIÓN! ---
            // Si el origen no está en la lista, lo mostramos en el log de Render
            console.error(`CORS Error: El origen ${origin} NO está en la whitelist.`);
            // --- FIN DE LA DEPURACIÓN ---
            callback(new Error('No permitido por CORS')); // Y lo bloqueamos
        }
    }
};

app.use(cors(corsOptions)); // ¡Usamos las opciones de CORS!
app.use(express.json());

app.use(express.static(path.join(__dirname, 'public')));

// =============================================
// CONEXIÓN A MONGODB
// =============================================
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ Conectado a MongoDB Atlas (LFAFTechRed)'))
  .catch(err => console.error('❌ Error de conexión a MongoDB:', err));

// =============================================
// RUTAS DE LA API
// =============================================
app.use('/api', apiRoutes); // Esto ahora incluye /api/articles, /api/radio, y /api/juegos

// Ruta de bienvenida básica
app.get('/', (req, res) => {
    res.json({
        message: "Bienvenido a la API Central de LFAF Tech (v3.0 Escalable)",
        status: "ok"
    });
});

// =============================================
// INICIAR SERVIDOR
// =============================================
app.listen(PORT, () => {
    console.log(`🚀 API Central LFAF Tech (v3.0) corriendo en http://localhost:${PORT}`);
});