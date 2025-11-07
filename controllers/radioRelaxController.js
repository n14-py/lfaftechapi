const PlaylistItem = require('../models/playlistItem');
const { v4: uuidv4 } = require('uuid');
const cloudinary = require('cloudinary').v2;
const fs = require('fs');

// Configura Cloudinary con tus credenciales del .env
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

// --- 1. FUNCIÓN MÁGICA: Genera el playlist.txt en vivo ---
// El Servidor B llamará a esta URL para saber qué tocar.
exports.getLivePlaylistTxt = async (req, res) => {
    try {
        const playlist = await PlaylistItem.find({ isActive: true }).sort({ order: 1 });
        
        let content = 'ffconcat version 1.0\n';
        playlist.forEach(item => {
            content += `file '${item.audioUrl}'\n`;
            content += `duration ${item.duration}\n`;
        });

        // Si la lista está vacía, evitamos que FFmpeg crashee
        if (playlist.length === 0) {
            content += "# Playlist vacia\n";
        }

        res.header('Content-Type', 'text/plain');
        res.send(content);
    } catch (error) {
        console.error("Error generando playlist.txt:", error);
        res.status(500).send("# Error generando playlist");
    }
};

// --- 2. API para el Frontend (JSON) ---
exports.getPlaylistJson = async (req, res) => {
    try {
        const playlist = await PlaylistItem.find({ isActive: true }).sort({ order: 1 });
        res.json(playlist);
    } catch (error) {
        res.status(500).json({ error: "Error al obtener playlist" });
    }
};

// --- 3. Subir Canción (Drag & Drop) ---
exports.uploadTrack = async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: "No hay archivo de audio" });

        // Subir a Cloudinary (usando resource_type: 'video' para audio es lo recomendado)
        const result = await cloudinary.uploader.upload(req.file.path, {
            resource_type: "video",
            folder: "radio_relax",
            use_filename: true,
            unique_filename: false
        });

        // Eliminar archivo temporal local
        fs.unlinkSync(req.file.path);

        // Calcular el nuevo orden (al final de la lista)
        const lastItem = await PlaylistItem.findOne().sort({ order: -1 });
        const newOrder = (lastItem && lastItem.order) ? lastItem.order + 1 : 1;

        // Guardar en DB
        const newItem = new PlaylistItem({
            uuid: uuidv4(),
            title: req.body.title || req.file.originalname.replace(/\.[^/.]+$/, ""),
            audioUrl: result.secure_url,
            duration: result.duration || 0, // Cloudinary suele devolver la duración
            type: req.body.type || 'song',
            order: newOrder
        });
        await newItem.save();

        res.json(newItem);
    } catch (error) {
        console.error("Error en subida:", error);
        res.status(500).json({ error: error.message });
    }
};

// --- 4. Reordenar Playlist ---
exports.reorderPlaylist = async (req, res) => {
    try {
        const { items } = req.body; // Espera array de { uuid, order }
        const operations = items.map(item => ({
            updateOne: {
                filter: { uuid: item.uuid },
                update: { $set: { order: item.order } }
            }
        }));
        await PlaylistItem.bulkWrite(operations);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: "Error al reordenar" });
    }
};

// --- 5. Eliminar Canción ---
exports.deleteTrack = async (req, res) => {
    try {
        await PlaylistItem.deleteOne({ uuid: req.params.uuid });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: "Error al eliminar" });
    }
};