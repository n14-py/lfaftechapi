// =============================================
//         LFAF TECH - API MADRE (v3.0.0)
// =============================================
require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const cron = require('node-cron'); // ¡Importamos el paquete cron!

// Importamos el "enrutador" principal
const apiRoutes = require('./routes/index');

// --- Importamos los controladores de workers ---
const syncController = require('./controllers/syncController');

const app = express();
const PORT = process.env.PORT || 3000;

// =============================================
// MIDDLEWARES (Tu config de CORS está perfecta)
// =============================================
const whiteList = [
    'https://lfaftechapi.onrender.com',
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
      
      // --- ¡AQUÍ ENCENDEMOS LOS ROBOTS AUTOMÁTICOS! ---
      
      // 1. Inicia el robot UNIFICADO de Noticias (IA -> Telegram -> Pausa)
      syncController.startNewsWorker();
      
      // 2. Inicia el CRON JOB de 3 horas para el RECOLECTOR
      console.log("Iniciando Cron Job de Recolección (cada 3 horas)...");
      cron.schedule('0 */3 * * *', () => { // "Cada 3 horas"
          console.log('[Cron Job Interno] ¡Disparado! Ejecutando recolección de noticias...');
          // Llamamos a la función exportada
          syncController.runNewsAPIFetch();
      });

      // 3. (Opcional) Ejecutar la recolección 1 vez al iniciar
      console.log("[Inicio] Ejecutando recolección de noticias UNA VEZ al arrancar...");
      syncController.runNewsAPIFetch();
      
  })
  .catch(err => console.error('❌ Error de conexión a MongoDB:', err));

// =============================================
// RUTAS DE LA API
// =============================================
app.use('/api', apiRoutes);

// Ruta de bienvenida básica
app.get('/', (req, res) => {
    res.json({
        message: "Bienvenido a la API Central de LFAF Tech (v3.0 Escalable - WORKER UNIFICADO ACTIVO)",
        status: "ok"
    });
});

// =============================================
// INICIAR SERVIDOR
// =============================================
app.listen(PORT, () => {
    console.log(`🚀 API Central LFAF Tech (v3.0) corriendo en http://localhost:${PORT}`);
});