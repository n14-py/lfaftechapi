// Archivo: lfaftechapi/models/article.js
const mongoose = require('mongoose');

// Este es el "molde" universal para todos los artículos
const ArticleSchema = new mongoose.Schema({
    titulo: { type: String, required: true },
    descripcion: { type: String, required: true },
    imagen: { type: String, required: true },
    
    // 'categoria' será "general", "deportes", "tecnologia", etc.
    // (Gracias a bedrockClient.js, ahora siempre llegará limpia y en minúsculas)
    categoria: { type: String, required: true, index: true }, 
    
    // 'sitio' será "noticias.lat", etc.
    sitio: { type: String, required: true, index: true }, 

    // 'pais' (ej. 'py', 'cl', 'ar', o null si es regional)
    pais: { type: String, index: true, sparse: true },
    
    // El artículo largo generado por la IA
    articuloGenerado: { type: String, required: true }, 

    // Este campo nos dirá si el bot de Telegram ya lo publicó.
    telegramPosted: { type: Boolean, default: false, index: true },

    // --- CAMPOS PARA EL BOT DE YOUTUBE ---
    // 'pending': Esperando turno
    // 'processing': El bot de Python lo está creando
    // 'complete': Ya existe en YouTube
    // 'failed': Algo salió mal
    videoProcessingStatus: { 
        type: String, 
        enum: ['pending', 'processing', 'complete', 'failed'], 
        default: 'pending', 
        index: true 
    },
    // El ID del video de YouTube (ej: dQw4w9WgXcQ)
    youtubeId: { type: String, sparse: true },
    // --- FIN DE CAMPOS DE YOUTUBE ---

    fuente: String,
    enlaceOriginal: { type: String, unique: true }, // 'unique:true' evita duplicados
    fecha: { type: Date, default: Date.now }
}, { timestamps: true });


// =========================================================
// 🚀 OPTIMIZACIÓN DE ÍNDICES (Estrategia "Máximo Espacio")
// =========================================================

// 1. ÍNDICE DE BÚSQUEDA DE TEXTO (Vital para el buscador)
// Esto permite buscar palabras dentro del título y descripción.
ArticleSchema.index({ 
    titulo: 'text', 
    descripcion: 'text' 
});

// 2. ÍNDICES COMPUESTOS (Para velocidad en la Home y Filtros)
// Ayudan a mostrar "Lo último de Política" o "Lo último de Argentina" rapidísimo.
ArticleSchema.index({ sitio: 1, fecha: -1 });
ArticleSchema.index({ pais: 1, fecha: -1 });
ArticleSchema.index({ categoria: 1, fecha: -1 });

// Exportamos el modelo
module.exports = mongoose.model('Article', ArticleSchema);