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
            member.displayName = displayName;
            member.avatar = avatar;
        }

        member.accessToken = tokens.access_token;
        if (tokens.refresh_token) member.refreshToken = tokens.refresh_token;

        const now = new Date();
        
        // --- LÓGICA DE ACTUALIZACIÓN INTELIGENTE ---
        // Forzamos verificación si:
        // 1. Es un usuario nuevo (no tiene lastYoutubeCheck).
        // 2. No tiene créditos (probablemente se acaba de suscribir para obtenerlos).
        // 3. Han pasado más de 24 horas (por si se suscribió a otro canal adicional).
        const unDiaEnMs = 24 * 60 * 60 * 1000;
        const tiempoDesdeUltimoCheck = member.lastYoutubeCheck ? (now - member.lastYoutubeCheck) : unDiaEnMs;

        const necesitaVerificacion = !member.lastYoutubeCheck || 
                                     (member.totalCredits - member.creditsUsed <= 0) || 
                                     (tiempoDesdeUltimoCheck >= unDiaEnMs);

        if (necesitaVerificacion) {
            console.log(`[Members API] Verificando membresías en YouTube para: ${email}`);
            
            const channelIdsString = process.env.YOUTUBE_CHANNEL_IDS || '';
            const channelIds = channelIdsString.split(',').filter(id => id.trim() !== '');
            
            let totalAccumulatedCredits = 0;
            let highestLevel = 0;

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
            
            // Si es un usuario nuevo o su ciclo ya venció, reseteamos el contador mensual
            const unMesEnMs = 30 * 24 * 60 * 60 * 1000;
            if (!member.nextResetDate || now > member.nextResetDate) {
                member.creditsUsed = 0;
                member.nextResetDate = new Date(now.getTime() + unMesEnMs);
            }
            
            console.log(`[Members API] ${email} sincronizado. Créditos actuales: ${member.totalCredits - member.creditsUsed}`);
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
        
        if (!req.file) {
            return res.status(400).json({ success: false, error: "No se subió ninguna imagen." });
        }

        const member = await Member.findOne({ googleId });
        if (!member) {
            if (req.file) fs.unlinkSync(req.file.path);
            return res.status(404).json({ success: false, error: "Usuario no encontrado." });
        }

        const availableCredits = member.totalCredits - member.creditsUsed;
        if (availableCredits <= 0) {
            if (req.file) fs.unlinkSync(req.file.path);
            return res.status(403).json({ success: false, error: "Créditos insuficientes." });
        }

        const imagePath = `/uploads/${req.file.filename}`;

        const newArticle = new Article({
            title: title.trim(),
            content: content.trim(),
            image: imagePath,
            author: member.displayName,
            category: "Comunidad",
            status: "published", 
            videoType: videoType, 
            isMemberContent: true,
            memberGoogleId: googleId,
            publishDate: new Date()
        });

        await newArticle.save();

        member.creditsUsed += 1;
        await member.save();

        res.json({ 
            success: true, 
            message: "Noticia creada con éxito.", 
            articleId: newArticle._id,
            remainingCredits: member.totalCredits - member.creditsUsed 
        });

    } catch (error) {
        console.error("[Members API] Error al publicar:", error);
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        res.status(500).json({ success: false, error: "Error al procesar la publicación." });
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

        const articles = await Article.find({ 
            $or: [
                { memberGoogleId: googleId },
                { author: member.displayName, isMemberContent: true }
            ]
        }).sort({ publishDate: -1, createdAt: -1 });

        res.json({ success: true, articles });
    } catch (error) {
        console.error("[Members API] Error historial:", error);
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
            const levelName = response.data.items[0].snippet.memberDetails.displayName.toLowerCase();
            if (levelName.includes("vip") || levelName.includes("premium") || levelName.includes("nivel 3")) return 3;
            if (levelName.includes("pro") || levelName.includes("intermedio") || levelName.includes("nivel 2")) return 2;
            return 1;
        }
        return 0;
    } catch (e) {
        return 0; 
    }
}