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
    articuloGenerado: { type: String, required: true }, // <- ¡Ahora es 'required'!

    // Este campo nos dirá si el bot de Telegram ya lo publicó.
    telegramPosted: { type: Boolean, default: false, index: true },

    fuente: String,
    enlaceOriginal: { type: String, unique: true }, // 'unique:true' evita duplicados
    fecha: { type: Date, default: Date.now }
}, { timestamps: true });

// --- ¡ÍNDICE DE BÚSQUEDA! ---
// (Este es el importante para el buscador público)
ArticleSchema.index({ 
    titulo: 'text', 
    descripcion: 'text', 
    articuloGenerado: 'text' 
});

// --- ¡ÍNDICES DE ROBOT ELIMINADOS! ---
// Ya no necesitamos los índices para 'articuloGenerado: 1'
// porque el nuevo worker usa una fila en memoria y no consulta la DB
// para encontrar trabajo.
// ------------------------------------


// Exportamos el modelo para que el resto de la app pueda usarlo
module.exports = mongoose.model('Article', ArticleSchema);