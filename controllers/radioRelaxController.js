const PlaylistItem = require('../models/playlistItem');
const { v4: uuidv4 } = require('uuid');
const cloudinary = require('cloudinary').v2;
const fs = require('fs');
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

// --- 2. API para el Frontend (JSON) - ¡¡ACTUALIZADA!! ---
// Ahora soporta búsqueda por texto, paginación y ordenamiento.
exports.getPlaylistJson = async (req, res) => {
    try {
        // Nuevos parámetros desde el query del frontend
        const { query, limite, pagina } = req.query;

        const limiteNum = parseInt(limite) || 50; // 50 items por página
        const paginaNum = parseInt(pagina) || 1;
        const skip = (paginaNum - 1) * limiteNum;

        let filtro = { isActive: true };
        let sort = { order: 1 }; // Por defecto, ordenar por el orden de la playlist
        let projection = {};

        // Si el frontend envía una 'query' de búsqueda...
        if (query && query.trim() !== '') {
            filtro = {
                ...filtro,
                $text: { $search: query } // ¡Usa el índice de texto que creamos!
            };
            // Si buscamos, ordenamos por relevancia (el mejor match primero)
            projection = { score: { $meta: "textScore" } };
            sort = { score: { $meta: "textScore" } };
        }

        // Ejecutamos ambas consultas a la vez para máxima velocidad
        const [items, total] = await Promise.all([
            PlaylistItem.find(filtro, projection).sort(sort).skip(skip).limit(limiteNum),
            PlaylistItem.countDocuments(filtro)
        ]);

        // Devolvemos un objeto de paginación
        res.json({
            totalItems: total,
            totalPages: Math.ceil(total / limiteNum),
            currentPage: paginaNum,
            items: items // La lista de canciones de esta página
        });

    } catch (error) {
        console.error("Error en getPlaylistJson (paginado):", error);
        res.status(500).json({ error: "Error al obtener playlist" });
    }
};

// --- 3. Subir Canción (Drag & Drop) ---
// (Con la corrección de 'format: "m4a"' que ya hicimos)
exports.uploadTrack = async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No hay archivo de audio" });
    const localPath = req.file.path;

    try {
        console.log(`[Cloudinary] Optimizando y subiendo ${req.file.originalname}...`);
        const result = await cloudinary.uploader.upload(localPath, {
            resource_type: "video",
            folder: "radio_relax",
            audio_codec: "aac",
            bit_rate: "128k",
            audio_frequency: 44100,
            format: "m4a" // <-- La corrección importante
        });
        
        console.log(`[Cloudinary] Subida completa. URL: ${result.secure_url}`);
        
        const lastItem = await PlaylistItem.findOne().sort({ order: -1 });
        const newOrder = (lastItem && lastItem.order) ? lastItem.order + 1 : 1;

        const newItem = new PlaylistItem({
            uuid: uuidv4(),
            title: req.body.title || req.file.originalname.replace(/\.[^/.]+$/, ""),
            audioUrl: result.secure_url,
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

// --- 5. Eliminar UNA Canción ---
// (Cambiamos nombre de 'deleteTrack' a 'deleteTrackByUuid' para ser claros)
exports.deleteTrackByUuid = async (req, res) => {
    try {
        await PlaylistItem.deleteOne({ uuid: req.params.uuid });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: "Error al eliminar" });
    }
};

// --- 6. ¡NUEVA FUNCIÓN! Borrado Múltiple ---
// Esto es para la función de "Selección Múltiple"
exports.deleteMultipleTracks = async (req, res) => {
    try {
        const { uuids } = req.body; // Espera un array de UUIDs
        if (!Array.isArray(uuids) || uuids.length === 0) {
            return res.status(400).json({ error: "Se requiere un array de 'uuids'." });
        }
        
        const result = await PlaylistItem.deleteMany({
            uuid: { $in: uuids } // Borra todos los items cuyo UUID esté en la lista
        });
        
        console.log(`[Borrado Múltiple] ${result.deletedCount} tracks eliminados.`);
        res.json({ success: true, deletedCount: result.deletedCount });
    } catch (error) {
        console.error("Error en borrado múltiple:", error);
        res.status(500).json({ error: "Error al eliminar tracks." });
    }
};


// --- 7. "PUBLICAR CAMBIOS" ---
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