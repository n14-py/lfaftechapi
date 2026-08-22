const mongoose = require('mongoose');

const AdSchema = new mongoose.Schema({
    // Referencia al anunciante
    advertiserId: { type: mongoose.Schema.Types.ObjectId, ref: 'Advertiser', required: true },
    
    nombreCampana: { type: String, required: true },
    
    // El tipo de anuncio define en qué plataforma y formato se mostrará
    tipo: { 
        type: String, 
        enum: ['banner_flotante', 'video_incrustado', 'video_incrustado_short', 'mencion_ia', 'banner_web', 'interstitial_app'], 
        required: true 
    },

    // CASILLAS DE DESTINO (Dónde quiere el cliente que aparezca)
    mostrarEnVideo: { type: Boolean, default: true },
    mostrarEnWeb: { type: Boolean, default: false },
    mostrarEnApp: { type: Boolean, default: false },
    
    // URL en Cloudflare R2 de la foto, gif o video del anuncio
    mediaUrl: { type: String, required: true }, 
    
    // Hacia dónde va el usuario si hace clic
    enlaceDestino: { type: String }, 
    
    // Texto exacto que leerá la IA
    textoMencion: { type: String }, 

    // Límite de videos en los que aparecerá (0 = sin límite)
    limiteVideos: { type: Number, default: 0 }, 

    // ==========================================
    // CONTADORES Y MÉTRICAS
    // ==========================================
    vistasWeb: { type: Number, default: 0 },
    vistasApp: { type: Number, default: 0 },
    clicksWeb: { type: Number, default: 0 },
    clicksApp: { type: Number, default: 0 },

    // Tracking de redes sociales
    publicaciones: [{
        plataforma: { type: String, enum: ['youtube', 'tiktok', 'facebook'] },
        idPublicacion: String, 
        urlPublicacion: String, 
        fechaPublicacion: { type: Date, default: Date.now }
    }],

    // Estado con "revision" como predeterminado para los creados por clientes
    estado: { 
        type: String, 
        enum: ['revision', 'activo', 'pausado', 'finalizado'], 
        default: 'revision' 
    }
}, { timestamps: true });

// Índice para hacer búsquedas rápidas por anunciante o estado
AdSchema.index({ advertiserId: 1, estado: 1 });

module.exports = mongoose.model('Ad', AdSchema);