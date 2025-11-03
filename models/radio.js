const mongoose = require('mongoose');

// Este es el "molde" para las estaciones de radio
const RadioSchema = new mongoose.Schema({
    uuid: { type: String, required: true, unique: true }, 
    nombre: { type: String, required: true },
    pais_code: { type: String, required: true, index: true }, 
    pais: { type: String, required: true }, 
    generos: { type: String, index: true }, 
    logo: { type: String },
    stream_url: { type: String, required: true },
    popularidad: { type: Number, default: 0, index: true },
    
    // ¡NUEVO CAMPO PARA EL CONTENIDO GENERADO POR IA!
    descripcionGenerada: { type: String }
    
}, { timestamps: true });


// Antes solo buscaba en 'nombre' y 'generos'.
// Ahora le decimos a MongoDB que busque en 'nombre', 'generos' Y 'pais'.
RadioSchema.index({ 
    nombre: 'text', 
    generos: 'text',
    pais: 'text' 
});
// ---------------------------------

module.exports = mongoose.model('Radio', RadioSchema);