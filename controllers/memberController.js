const Member = require('../models/member');
const Article = require('../models/article'); // Usamos tu modelo de artículos
const { google } = require('googleapis');
const path = require('path');
const fs = require('fs');

// Configuración de los créditos por nivel
const LEVEL_CONFIG = {
    1: { credits: 1, name: 'Básico' },
    2: { credits: 3, name: 'Pro' },
    3: { credits: 6, name: 'VIP' }
};

// ==========================================
// 1. SINCRONIZACIÓN Y VERIFICACIÓN DE YOUTUBE
// ==========================================
exports.verifyAndSyncMember = async (req, res) => {
    const { googleId, email, displayName, avatar, tokens } = req.body;

    try {
        if (!googleId || !tokens) {
            return res.status(400).json({ success: false, error: "Datos de Google incompletos." });
        }

        let member = await Member.findOne({ googleId });

        if (!member) {
            member = new Member({ googleId, email, displayName, avatar });
        } else {
            // Actualizar datos del perfil por si cambió su foto o nombre
            member.displayName = displayName;
            member.avatar = avatar;
        }

        // Guardar tokens de acceso
        member.accessToken = tokens.access_token;
        if (tokens.refresh_token) member.refreshToken = tokens.refresh_token;

        const now = new Date();
        const oneMonthAgo = new Date();
        oneMonthAgo.setMonth(now.getMonth() - 1);

        // SOLO consultar a la API de YouTube si pasó un mes o es usuario nuevo
        if (!member.lastYoutubeCheck || member.lastYoutubeCheck < oneMonthAgo) {
            console.log(`[Members API] Verificando membresías en YouTube para: ${email}`);
            
            // Obtener canales desde el .env
            const channelIdsString = process.env.YOUTUBE_CHANNEL_IDS || '';
            const channelIds = channelIdsString.split(',').filter(id => id.trim() !== '');
            
            let totalAccumulatedCredits = 0;
            let highestLevel = 0;

            // Recorrer todos los canales y sumar beneficios
            for (const channelId of channelIds) {
                const level = await checkYoutubeMembership(member.accessToken, channelId.trim());
                
                if (level > highestLevel) highestLevel = level;
                
                if (LEVEL_CONFIG[level]) {
                    totalAccumulatedCredits += LEVEL_CONFIG[level].credits;
                }
            }

            member.membershipLevel = highestLevel;
            member.totalCredits = totalAccumulatedCredits;
            member.lastYoutubeCheck = now;
            
            // Reset de créditos mensuales
            member.creditsUsed = 0;
            member.nextResetDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
            
            console.log(`[Members API] ${email} verificado. Nivel: ${highestLevel}, Créditos: ${totalAccumulatedCredits}`);
        }

        await member.save();
        res.json({ success: true, member });

    } catch (error) {
        console.error("[Members API] Error en verifyAndSyncMember:", error);
        res.status(500).json({ success: false, error: "Error interno al verificar la membresía con YouTube." });
    }
};

// ==========================================
// 2. PUBLICAR NOTICIA Y DESCONTAR CRÉDITO
// ==========================================
exports.publishMemberArticle = async (req, res) => {
    try {
        const { googleId, title, content, videoType } = req.body;
        
        // Verificar que llegó la imagen
        if (!req.file) {
            return res.status(400).json({ success: false, error: "No se subió ninguna imagen." });
        }

        // 1. Buscar al usuario
        const member = await Member.findOne({ googleId });
        if (!member) {
            // Eliminar la imagen que se acaba de subir si el usuario no existe
            fs.unlinkSync(req.file.path);
            return res.status(404).json({ success: false, error: "Usuario no encontrado en la base de datos." });
        }

        // 2. Seguridad: Verificar que realmente tenga créditos
        const availableCredits = member.totalCredits - member.creditsUsed;
        if (availableCredits <= 0) {
            fs.unlinkSync(req.file.path);
            return res.status(403).json({ success: false, error: "Créditos insuficientes. Debes renovar tu membresía." });
        }

        console.log(`[Members API] Creando publicación de ${member.displayName}. Video: ${videoType}`);

        // 3. Crear el artículo en la base de datos
        const imagePath = `/uploads/${req.file.filename}`; // Ruta que leerá el frontend

        const newArticle = new Article({
            title: title.trim(),
            content: content.trim(),
            image: imagePath,
            author: member.displayName,
            category: "Comunidad",
            status: "published", 
            videoType: videoType, 
            isMemberContent: true, // Etiqueta especial para diferenciarlo de tus noticias oficiales
            memberGoogleId: googleId, // Para enlazarlo fuertemente a su cuenta
            publishDate: new Date()
        });

        await newArticle.save();

        // 4. Descontar 1 crédito al usuario y guardar
        member.creditsUsed += 1;
        await member.save();

        res.json({ 
            success: true, 
            message: "Noticia creada y enviada a la cola de videos.", 
            articleId: newArticle._id,
            remainingCredits: member.totalCredits - member.creditsUsed 
        });

    } catch (error) {
        console.error("[Members API] Error al publicar noticia de miembro:", error);
        // Si hay error, intentar borrar la imagen para no ocupar espacio basura
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }
        res.status(500).json({ success: false, error: "Error interno de los servidores al procesar la publicación." });
    }
};

// ==========================================
// 3. OBTENER EL HISTORIAL PARA EL PANEL
// ==========================================
exports.getMemberHistory = async (req, res) => {
    try {
        const { googleId } = req.params;
        
        const member = await Member.findOne({ googleId });
        if (!member) return res.status(404).json({ success: false, error: "Usuario no encontrado." });

        // Buscar los artículos que le pertenecen al usuario, ordenados de más nuevo a más viejo
        const articles = await Article.find({ 
            $or: [
                { memberGoogleId: googleId }, // Por ID (método nuevo y seguro)
                { author: member.displayName, isMemberContent: true } // Por nombre (retrocompatibilidad)
            ]
        }).sort({ publishDate: -1, createdAt: -1 });

        res.json({ success: true, articles });

    } catch (error) {
        console.error("[Members API] Error al obtener historial:", error);
        res.status(500).json({ success: false, error: "Error al recuperar el historial." });
    }
};

// ==========================================
// FUNCIÓN AUXILIAR: CONSULTA A YOUTUBE API
// ==========================================
async function checkYoutubeMembership(accessToken, channelId) {
    if (!channelId) return 0;

    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: accessToken });
    const youtube = google.youtube({ version: 'v3', auth });

    try {
        const response = await youtube.members.list({
            part: 'snippet',
            filterByMemberChannelId: channelId
        });

        if (response.data.items && response.data.items.length > 0) {
            // Analizar el nivel del miembro basándonos en el nombre de la membresía en YouTube
            const levelName = response.data.items[0].snippet.memberDetails.displayName.toLowerCase();
            
            // Lógica de asignación de niveles
            if (levelName.includes("vip") || levelName.includes("premium") || levelName.includes("nivel 3")) return 3;
            if (levelName.includes("pro") || levelName.includes("intermedio") || levelName.includes("nivel 2")) return 2;
            return 1; // Nivel básico por defecto si es miembro
        }
        return 0; // No es miembro
    } catch (e) {
        // El error 403 o 400 significa que el usuario no tiene acceso o no es miembro
        return 0; 
    }
}