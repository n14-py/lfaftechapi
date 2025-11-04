const mongoose = require('mongoose');

// Este es el "molde" para cada juego en tu sitio
const GameSchema = new mongoose.Schema({
    // ej: "Bullet Force"
    title: { type: String, required: true },
    
    // ej: "bullet-force" (para la URL amigable: tusinitusineli.com/juego/bullet-force)
    slug: { type: String, required: true, unique: true, index: true },
    
    // La descripción real (ya no es la de 19,000 games)
    description: { type: String },
    
    // ej: "Shooter", "Puzzle", "io"
    category: { type: String, required: true, index: true },
    
    // ej: "https_//img.gamedistribution.com/..."
    thumbnailUrl: { type: String, required: true },
    
    // ej: "https_//html5.gamedistribution.com/..."
    embedUrl: { type: String, required: true },
    
    // El
    source: { type: String },
    
    // --- ¡NUEVO! (Para tu referencia) ---
    sourceUrl: { type: String },
    
    // --- ¡NUEVO! (Datos extra que pediste) ---
    languages: [String],
    genders: [String],
    ageGroups: [String],
    
    // Para ordenar por popularidad o novedad
    views: { type: Number, default: 0 },
    
}, { timestamps: true });

// --- ¡La Magia del Buscador! ---
GameSchema.index({ 
    title: 'text', 
    description: 'text', 
    category: 'text' 
});
// ---------------------------------

module.exports = mongoose.model('Game', GameSchema);