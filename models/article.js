const mongoose = require('mongoose');

// Este es el "molde" universal para todos los artículos
const ArticleSchema = new mongoose.Schema({
    titulo: { type: String, required: true },
    descripcion: { type: String, required: true },
    imagen: { type: String, required: true },
    
    // 'contenido' SE HA ELIMINADO PARA AHORRAR ESPACIO
    
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

// --- ¡NUEVO! ÍNDICE DE TEXTO PARA BÚSQUEDA ---
ArticleSchema.index({ titulo: 'text', descripcion: 'text' });
// ---------------------------------------------


// Exportamos el modelo para que el resto de la app pueda usarlooa
module.exports = mongoose.model('Article', ArticleSchema);