const mongoose = require('mongoose');

// Este es el "molde" para las estaciones de radio
const RadioSchema = new mongoose.Schema({
    // Usamos el UUID de radio-browser como nuestro ID único
    uuid: { type: String, required: true, unique: true }, 
    nombre: { type: String, required: true },
    pais_code: { type: String, required: true, index: true }, // ej: "PY"
    pais: { type: String, required: true }, // ej: "Paraguay"
    generos: { type: String, index: true }, // ej: "rock, pop, 90s"
    logo: { type: String }, // URL del favicon
    stream_url: { type: String, required: true },
    // Guardamos los "votos" o "clicks" de la API externa para ordenar por popularidad
    popularidad: { type: Number, default: 0, index: true }
}, { timestamps: true });


// --- ¡ÍNDICE PARA EL BUSCADOR! ---
// Le decimos a MongoDB que cree un índice de texto para
// buscar por 'nombre' y 'generos'.
RadioSchema.index({ 
    nombre: 'text', 
    generos: 'text' 
});
// ---------------------------------

module.exports = mongoose.model('Radio', RadioSchema);