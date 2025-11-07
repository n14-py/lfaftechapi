const mongoose = require('mongoose');

const PlaylistItemSchema = new mongoose.Schema({
    uuid: { type: String, required: true, unique: true },
    title: { type: String, required: true },
    audioUrl: { type: String, required: true }, // URL de Cloudinary
    duration: { type: Number, required: true }, // Duración en segundos
    type: { type: String, enum: ['song', 'jingle', 'ad'], default: 'song' },
    order: { type: Number, required: true, index: true }, // Para el orden de reproducción
    isActive: { type: Boolean, default: true }
}, { timestamps: true });

PlaylistItemSchema.index({ order: 1 });

module.exports = mongoose.model('PlaylistItem', PlaylistItemSchema);