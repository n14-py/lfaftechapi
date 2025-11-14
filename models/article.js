const mongoose = require('mongoose');

// Este es el "molde" universal para todos los artículos
const ArticleSchema = new mongoose.Schema({
    titulo: { type: String, required: true },
    descripcion: { type: String, required: true },
    imagen: { type: String, required: true }, // Esta será la MINIATURA
    
    // 'categoria' será "general", "deportes", "tecnologia", etc.
    categoria: { type: String, required: true, index: true }, 
    
    // 'sitio' será "noticias.lat", "pelis.lat", etc.
    sitio: { type: String, required: true, index: true }, 

    // 'pais' (ej: 'py', 'cl', 'ar', o null si es regional)
    pais: { type: String, index: true, sparse: true },
    
    // El artículo largo generado por la IA
    articuloGenerado: { type: String, required: true }, 

    // Este campo nos dirá si el bot de Telegram ya lo publicó.
    telegramPosted: { type: Boolean, default: false, index: true },

    // --- ¡CAMPOS DE VIDEO MODIFICADOS PARA EL FLUJO DE EZOIC! ---
    
    // Aquí guardaremos la URL del .mp4 crudo que subimos a Cloudinary
    cloudinary_url: { type: String }, 
    
    // Aquí guardaremos la URL/embed final del reproductor de Ezoic (la que monetiza)
    ezoicVideoUrl: { type: String },  
    
    videoProcessingStatus: { 
        type: String, 
        // Añadimos el nuevo estado 'pending_ezoic_import'
        enum: ['pending', 'processing', 'pending_ezoic_import', 'complete', 'failed'], 
        default: 'pending', // Estado por defecto
        index: true // Importante para que el nuevo robot-scraper busque rápido
    },
    // --- FIN DE CAMPOS MODIFICADOS ---

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


// Exportamos el modelo para que el resto de la app pueda usarlo
module.exports = mongoose.model('Article', ArticleSchema);