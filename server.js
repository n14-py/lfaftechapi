// =============================================
//         LFAF TECH - API MADRE (v3.0.0)
// =============================================
require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
// NOTA: Eliminamos 'node-cron', ya no se necesita.

// Importamos el "enrutador" principal
const apiRoutes = require('./routes/index');

// --- Importamos los controladores de workers ---
const syncController = require('./controllers/syncController');

const app = express();
const PORT = process.env.PORT || 3000;

// =============================================
// MIDDLEWARES
// =============================================
const whiteList = [
    'https://lfaftechapi.onrender.com',
    'https://lfaftechapi-7nrb.onrender.com',
    'http://127.0.0.1:5500',
    'http://localhost:5500',
    'http://127.0.0.1:5501',
    'http://localhost:3000',
    'http://192.168.0.4:3000',
    'https://www.noticias.lat',
    'https://noticias.lat',
    'https://www.turadio.lat' ,
    'https://turadio.lat', 
    'https://www.tusinitusineli.com',
    'https://tusinitusineli.vercel.app/',
    'https://tusinitusineli-34p6e1kjp-nando14s-projects.vercel.app',
    'https://tusinitusineli.com'
];

const corsOptions = {
    origin: function (origin, callback) {
        if (whiteList.indexOf(origin) !== -1 || !origin) {
            callback(null, true);
        } else {
            console.error(`CORS Error: El origen ${origin} NO está en la whitelist.`);
            callback(new Error('No permitido por CORS'));
        }
    }
};

app.use(cors(corsOptions));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// =============================================
// CONEXIÓN A MONGODB Y ARRANQUE DE WORKERS
// =============================================
mongoose.connect(process.env.MONGODB_URI)
  .then(() => {
      console.log('✅ Conectado a MongoDB Atlas (LFAFTechRed)');
      
      // --- ¡AQUÍ ENCENDEMOS EL ROBOT INTELIGENTE! ---
      
      // Solo necesitamos llamar a esto. 
      // El worker se encarga de:
      // 1. Limpiar videos zombies.
      // 2. Verificar si hay noticias.
      // 3. Si no hay, ir a buscarlas (Fetch bajo demanda).
      // 4. Gestionar los 3 bots de video.
      syncController.startNewsWorker();
      
      console.log("🤖 Worker Maestro iniciado (Modo: Bajo Demanda + Anti-Zombies)");
      
  })
  .catch(err => console.error('❌ Error de conexión a MongoDB:', err));

// =============================================
// RUTAS DE LA API
// =============================================
app.use('/api', apiRoutes);

// Ruta de bienvenida básica
app.get('/', (req, res) => {
    res.json({
        message: "Bienvenido a la API Central de LFAF Tech (v3.1 - MULTI-BOT ON DEMAND)",
        status: "ok"
    });
});

// =============================================
// INICIAR SERVIDOR
// =============================================
app.listen(PORT, () => {
    console.log(`🚀 API Central LFAF Tech corriendo en http://localhost:${PORT}`);
});