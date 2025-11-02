const mongoose = require('mongoose');

// Este es el "molde" universal para todos los artículos
const ArticleSchema = new mongoose.Schema({
    titulo: { type: String, required: true },
    descripcion: { type: String, required: true },
    imagen: { type: String, required: true },
    
    // 'categoria' será "general", "deportes", "tecnologia", etc.
    categoria: { type: String, required: true, index: true }, 
    
    // 'sitio' será "noticias.lat", "pelis.lat", etc.
    sitio: { type: String, required: true, index: true }, 

    // 'pais' (ej. 'py', 'cl', 'ar', o null si es regional)
    pais: { type: String, index: true, sparse: true },
    
    // El artículo largo generado por la IA
    articuloGenerado: { type: String },

    fuente: String,
    enlaceOriginal: { type: String, unique: true }, // 'unique:true' evita duplicados
    fecha: { type: Date, default: Date.now }
}, { timestamps: true });

// --- ¡¡AQUÍ ESTÁ LA MAGIA!! ---
// Antes solo buscaba en 'titulo' y 'descripcion'.
// Ahora le decimos a MongoDB que cree un índice de texto que incluya
// el título, la descripción Y el artículo generado.
ArticleSchema.index({ 
    titulo: 'text', 
    descripcion: 'text', 
    articuloGenerado: 'text' 
});
// ---------------------------------------------


// Exportamos el modelo para que el resto de la app pueda usarlo
module.exports = mongoose.model('Article', ArticleSchema);