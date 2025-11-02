const mongoose = require('mongoose');

// Este es el "molde" para las estaciones de radio
const RadioSchema = new mongoose.Schema({
    uuid: { type: String, required: true, unique: true }, 
    nombre: { type: String, required: true },
    pais_code: { type: String, required: true, index: true }, 
    pais: { type: String, required: true }, // ¡Este es el campo que faltaba!
    generos: { type: String, index: true }, 
    logo: { type: String },
    stream_url: { type: String, required: true },
    popularidad: { type: Number, default: 0, index: true }
}, { timestamps: true });


// --- ¡¡AQUÍ ESTÁ LA MAGIA!! ---
// Antes solo buscaba en 'nombre' y 'generos'.
// Ahora le decimos a MongoDB que busque en 'nombre', 'generos' Y 'pais'.
RadioSchema.index({ 
    nombre: 'text', 
    generos: 'text',
    pais: 'text'  // ¡CAMPO AÑADIDO AL BUSCADOR!
});
// ---------------------------------

module.exports = mongoose.model('Radio', RadioSchema);