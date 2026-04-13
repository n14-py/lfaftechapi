const mongoose = require('mongoose');

const memberSchema = new mongoose.Schema({
    googleId: { type: String, required: true, unique: true },
    email: { type: String, required: true },
    displayName: String,
    avatar: String,
    // Niveles: 0 (ninguno), 1 (Básico), 2 (Pro), 3 (VIP)
    membershipLevel: { type: Number, default: 0 },
    // Créditos totales según su nivel
    totalCredits: { type: Number, default: 0 },
    // Créditos ya usados en el mes actual
    creditsUsed: { type: Number, default: 0 },
    // Fecha en la que se resetean sus créditos (cada 30 días)
    nextResetDate: { type: Date },
    // Fecha de la última verificación con la API de YouTube
    lastYoutubeCheck: { type: Date },
    // Tokens para poder consultar la API de YouTube en su nombre
    accessToken: String,
    refreshToken: String
}, { timestamps: true });

module.exports = mongoose.model('Member', memberSchema);