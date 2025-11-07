const PlaylistItem = require('../models/playlistItem');
const { v4: uuidv4 } = require('uuid');
const cloudinary = require('cloudinary').v2;
const fs = require('fs'); // Importamos 'fs' normal para manejo de archivos
const axios = require('axios');

// Configura Cloudinary (como antes)
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

// --- 1. FUNCIÓN MÁGICA: Genera el playlist.txt en vivo ---
// (Sin cambios)
exports.getLivePlaylistTxt = async (req, res) => {
    try {
        const playlist = await PlaylistItem.find({ isActive: true }).sort({ order: 1 });
        
        let content = 'ffconcat version 1.0\n';
        playlist.forEach(item => {
            content += `file '${item.audioUrl}'\n`;
            content += `duration ${item.duration}\n`;
        });

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
// (Sin cambios)
exports.getPlaylistJson = async (req, res) => {
    try {
        const playlist = await PlaylistItem.find({ isActive: true }).sort({ order: 1 });
        res.json(playlist);
    } catch (error) {
        res.status(500).json({ error: "Error al obtener playlist" });
    }
};

// --- 3. Subir Canción (CON OPTIMIZACIÓN CORREGIDA) ---
exports.uploadTrack = async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No hay archivo de audio" });

    const localPath = req.file.path; // Guardamos la ruta temporal

    try {
        console.log(`[Cloudinary] Optimizando y subiendo ${req.file.originalname}...`);
        
        // --- ¡AQUÍ ESTÁ LA CORRECCIÓN! ---
        const result = await cloudinary.uploader.upload(localPath, {
            resource_type: "video", 
            folder: "radio_relax",
            
            // Parámetros de optimización:
            audio_codec: "aac",         // Códec moderno
            bit_rate: "128k",           // 128kbps (calidad streaming)
            audio_frequency: 44100,     // Frecuencia estándar
            format: "m4a"               // <-- ¡ESTA ES LA LÍNEA CORREGIDA!
        });
        
        console.log(`[Cloudinary] Subida completa. Nuevo tamaño: ${result.bytes} bytes. Nueva URL: ${result.secure_url}`);

        // Calcular el nuevo orden (al final de la lista)
        const lastItem = await PlaylistItem.findOne().sort({ order: -1 });
        const newOrder = (lastItem && lastItem.order) ? lastItem.order + 1 : 1;

        // Guardar en DB
        const newItem = new PlaylistItem({
            uuid: uuidv4(),
            title: req.body.title || req.file.originalname.replace(/\.[^/.]+$/, ""),
            audioUrl: result.secure_url, // URL del nuevo archivo .m4a
            duration: result.duration || 0,
            type: req.body.type || 'song',
            order: newOrder
        });
        await newItem.save();

        res.json(newItem);

    } catch (error) {
        console.error("Error en subida optimizada:", error);
        res.status(500).json({ error: error.message });
    } finally {
        // Limpieza del archivo temporal
        if (fs.existsSync(localPath)) {
            fs.unlinkSync(localPath);
            console.log(`[Limpieza] Archivo temporal ${localPath} eliminado.`);
        }
    }
};


// --- 4. Reordenar Playlist ---
// (Sin cambios)
exports.reorderPlaylist = async (req, res) => {
    try {
        const { items } = req.body;
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
// (Sin cambios)
exports.deleteTrack = async (req, res) => {
    try {
        await PlaylistItem.deleteOne({ uuid: req.params.uuid });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: "Error al eliminar" });
    }
};

// --- 6. "PUBLICAR CAMBIOS" ---
// (Sin cambios)
exports.publishChanges = async (req, res) => {
    console.log("Servidor A: Recibida orden de 'Publicar Cambios'");
    
    const TRANSMITTER_URL = process.env.TRANSMITTER_URL;
    const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY;

    if (!TRANSMITTER_URL || !INTERNAL_API_KEY) {
        console.error("❌ ERROR: Faltan TRANSMITTER_URL o INTERNAL_API_KEY en el Servidor A");
        return res.status(500).json({ error: "El servidor A no está configurado para contactar al transmisor." });
    }

    try {
        const response = await axios.post(
            `${TRANSMITTER_URL}/actualizar-playlist`, 
            {}, 
            {
                headers: { 'x-api-key': INTERNAL_API_KEY }
            }
        );

        console.log("✅ Servidor A: Señal enviada con éxito. Respuesta del Servidor B:", response.data.message);
        res.json({ success: true, message: "¡Publicado! El stream se reiniciará en segundos." });

    } catch (error) {
        console.error("❌ ERROR: El Servidor A no pudo contactar al Servidor B.", error.message);
        res.status(500).json({ error: "El servidor transmisor (B) no respondió. ¿Está encendido y la URL es correcta?" });
    }
};