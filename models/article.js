const mongoose = require('mongoose');

// Este es el "molde" universal para todos los artículos
// (noticias, pelis, etc., aunque para pelis haremos uno nuevo)
const ArticleSchema = new mongoose.Schema({
    titulo: { type: String, required: true },
    descripcion: { type: String, required: true },
    imagen: { type: String, required: true },
    
    // El "relleno" que GNews nos da
    contenido: { type: String }, 
    
    // 'categoria' será "general", "deportes", "tecnologia", etc.
    categoria: { type: String, required: true, index: true }, 
    
    // 'sitio' será "noticias.lat", "pelis.lat", etc.
    sitio: { type: String, required: true, index: true }, 

    fuente: String,
    enlaceOriginal: { type: String, unique: true }, // 'unique:true' evita duplicados
    fecha: { type: Date, default: Date.now }
}, { timestamps: true });

// Exportamos el modelo para que el resto de la app pueda usarlooa
module.exports = mongoose.model('Article', ArticleSchema); 