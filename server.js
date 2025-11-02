// =============================================
//         LFAF TECH - API MADRE (v3.0.0)
// =============================================
require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

// Importamos el "enrutador" principal
const apiRoutes = require('./routes/index');

const app = express();
const PORT = process.env.PORT || 3000;

// =============================================
// MIDDLEWARES
// =============================================
// Definimos los sitios web que SÍ tienen permiso de llamar a esta API
const whiteList = [
    'https://www.noticias.lat', // Tu sitio de noticias
    'https://turadio.lat'      // Tu nuevo sitio de radio (asumiendo que es .lat)
    // Añade aquí tu URL de Vercel si es diferente, ej: 'https://turadio.vercel.app'
    // Añade aquí tu localhost si pruebas localmente, ej: 'http://127.0.0.1:5500'
];

app.use(cors({
    origin: function (origin, callback) {
        // Si el 'origin' (el sitio que llama) está en nuestra lista blanca,
        // o si es una llamada desde el mismo servidor (undefined origin),
        // le damos permiso.
        if (whiteList.indexOf(origin) !== -1 || !origin) {
            callback(null, true);
        } else {
            // Si el dominio no está en la lista, lo bloqueamos.
            callback(new Error('No permitido por CORS'));
        }
    }
}));
app.use(express.json());

// =============================================
// CONEXIÓN A MONGODB
// =============================================
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ Conectado a MongoDB Atlas (LFAFTechRed)'))
  .catch(err => console.error('❌ Error de conexión a MongoDB:', err));

// =============================================
// RUTAS DE LA API
// =============================================
// Le decimos a Express que todas las rutas que empiecen con '/api'
// deben ser manejadas por nuestro archivo 'routes/index.js'
app.use('/api', apiRoutes);

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