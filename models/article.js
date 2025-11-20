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
    articuloGenerado: { type: String, required: true }, 

    // Este campo nos dirá si el bot de Telegram ya lo publicó.
    telegramPosted: { type: Boolean, default: false, index: true },

    // --- CAMPOS PARA EL BOT DE YOUTUBE ---
    videoProcessingStatus: { 
        type: String, 
        enum: ['pending', 'processing', 'complete', 'failed'], 
        default: 'pending', 
        index: true 
    },
    youtubeId: { type: String, sparse: true },
    // --- FIN DE CAMPOS DE YOUTUBE ---

    fuente: String,
    enlaceOriginal: { type: String, unique: true }, // 'unique:true' evita duplicados
    fecha: { type: Date, default: Date.now }
}, { timestamps: true });


// =========================================================
// 🚀 OPTIMIZACIÓN DE ÍNDICES (Estrategia "Máximo Espacio")
// =========================================================

// 1. ÍNDICE DE BÚSQUEDA LIGERO (Vital para ahorrar espacio)
// Al NO indexar 'articuloGenerado', ahorras cientos de MBs.
// El buscador encontrará noticias por título y descripción.
ArticleSchema.index({ 
    titulo: 'text', 
    descripcion: 'text' 
});

// 2. ÍNDICES COMPUESTOS (Para velocidad en la Home y Filtros)
ArticleSchema.index({ sitio: 1, fecha: -1 });
ArticleSchema.index({ pais: 1, fecha: -1 });
ArticleSchema.index({ categoria: 1, fecha: -1 });

// 3. LIMPIEZA AUTOMÁTICA (DESACTIVADA)
// Hemos quitado el índice TTL. Las noticias se guardarán PARA SIEMPRE
// o hasta que se llene el plan gratuito.
// ArticleSchema.index({ fecha: 1 }, { expireAfterSeconds: 7776000 }); <--- ELIMINADO


// Exportamos el modelo
module.exports = mongoose.model('Article', ArticleSchema);