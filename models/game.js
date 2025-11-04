const mongoose = require('mongoose');

// Este es el "molde" para cada juego en tu sitio
const GameSchema = new mongoose.Schema({
    // ej: "Bullet Force"
    title: { type: String, required: true },
    
    // ej: "bullet-force" (para la URL amigable: tusinitusineli.com/juego/bullet-force)
    slug: { type: String, required: true, unique: true, index: true },
    
    // La reseña única de 300-500 palabras generada por AWS Bedrock
    description: { type: String },
    
    // ej: "Shooter", "Puzzle", "io"
    category: { type: String, required: true, index: true },
    
    // ej: "https://imgs.crazygames.com/bullet-force.png"
    thumbnailUrl: { type: String, required: true },
    
    // ej: "https://www.crazygames.com/embed/bullet-force"
    embedUrl: { type: String, required: true },
    
    // El sitio de donde lo scrapeamos (ej: "CrazyGames")
    source: { type: String },
    
    // --- ¡¡LÍNEA AÑADIDA!! ---
    // La URL original de GameDistribution (para tu referencia)
    sourceUrl: { type: String },
    
    // Para ordenar por popularidad o novedad
    views: { type: Number, default: 0 },
    
}, { timestamps: true });

// --- ¡La Magia del Buscador! ---
// (Esto ya existía)
GameSchema.index({ 
    title: 'text', 
    description: 'text', 
    category: 'text' 
});
// ---------------------------------

module.exports = mongoose.model('Game', GameSchema);