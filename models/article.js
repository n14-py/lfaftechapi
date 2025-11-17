/*
  Archivo: lfaftechapi/models/article.js
  ¡MODIFICADO PARA EL FLUJO DE YOUTUBE!
*/
const mongoose = require('mongoose');

const ArticleSchema = new mongoose.Schema({
    titulo: { type: String, required: true },
    descripcion: { type: String, required: true },
    imagen: { type: String, required: true }, // Esto sigue siendo la miniatura
    categoria: { type: String, required: true, index: true }, 
    sitio: { type: String, required: true, index: true }, 
    pais: { type: String, index: true, sparse: true },
    articuloGenerado: { type: String, required: true }, 
    telegramPosted: { type: Boolean, default: false, index: true },

    // --- ¡CAMPOS DE VIDEO ACTUALIZADOS! ---
    
    // ¡NUEVO! Aquí guardaremos el ID del video de YouTube (ej: "dQw4w9WgXcQ")
    youtubeId: { type: String }, 
    
    // Campos antiguos eliminados (ya no usamos cloudinary_url ni ezoicVideoUrl)
    
    videoProcessingStatus: { 
        type: String, 
        // Estados actualizados para el flujo de YouTube
        // 'pending' = El bot aún no ha sido llamado
        // 'processing' = El bot está trabajando en él
        // 'complete' = El bot terminó y tenemos un youtubeId
        // 'failed' = El bot falló
        enum: ['pending', 'processing', 'complete', 'failed'], 
        default: 'pending', 
        index: true 
    },
    // --- FIN DE CAMPOS ACTUALIZADOS ---

    fuente: String,
    enlaceOriginal: { type: String, unique: true },
    fecha: { type: Date, default: Date.now }
}, { timestamps: true });

ArticleSchema.index({ 
    titulo: 'text', 
    descripcion: 'text', 
    articuloGenerado: 'text' 
});

module.exports = mongoose.model('Article', ArticleSchema);