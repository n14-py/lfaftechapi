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
    articuloGenerado: { type: String, default: null }, // <- Lo ponemos 'default: null'

    // --- ¡CAMPO NUEVO! ---
    // Este campo nos dirá si el bot de Telegram ya lo publicó.
    telegramPosted: { type: Boolean, default: false, index: true },
    // --- FIN DEL CAMPO NUEVO ---

    fuente: String,
    enlaceOriginal: { type: String, unique: true }, // 'unique:true' evita duplicados
    fecha: { type: Date, default: Date.now }
}, { timestamps: true });

// --- ¡ÍNDICE DE BÚSQUEDA! ---
// (Esto ya lo tenías y está perfecto)
ArticleSchema.index({ 
    titulo: 'text', 
    descripcion: 'text', 
    articuloGenerado: 'text' 
});

// --- ¡NUEVO ÍNDICE PARA EL ROBOT! ---
// Esto hace súper rápido que el robot encuentre artículos que necesitan IA.
ArticleSchema.index({ articuloGenerado: 1 });

// Esto hace súper rápido que el robot de Telegram encuentre artículos listos.
ArticleSchema.index({ telegramPosted: 1, articuloGenerado: 1 });
// ------------------------------------


// Exportamos el modelo para que el resto de la app pueda usarlo
module.exports = mongoose.model('Article', ArticleSchema);