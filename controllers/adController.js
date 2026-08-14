const Advertiser = require('../models/advertiser');
const Ad = require('../models/ad');
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const fs = require('fs');
const path = require('path');

// Configuración de conexión a Cloudflare R2
const s3Client = new S3Client({
    region: "auto",
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY,
        secretAccessKey: process.env.R2_SECRET_KEY,
    },
});


// ==========================================
// PANEL MAESTRO (TUS FUNCIONES)
// ==========================================

// 1. Crear una cuenta para un nuevo anunciante
exports.createAdvertiser = async (req, res) => {
    try {
        const { empresa, email, password, telefono } = req.body;
        const newAdvertiser = new Advertiser({ empresa, email, password, telefono });
        await newAdvertiser.save();
        res.json({ success: true, message: 'Anunciante creado con éxito.', advertiser: newAdvertiser });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

// 2. Cargarle un anuncio a un cliente
exports.createAd = async (req, res) => {
    try {
        const { advertiserId, nombreCampana, tipo, mediaUrl, enlaceDestino, textoMencion } = req.body;
        const newAd = new Ad({ advertiserId, nombreCampana, tipo, mediaUrl, enlaceDestino, textoMencion });
        await newAd.save();
        res.json({ success: true, message: 'Anuncio creado y listo para rotar.', ad: newAd });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

// ==========================================
// PANEL CLIENTE (ANUNCIANTE)
// ==========================================

// 3. Inicio de sesión para que el cliente vea sus números
exports.loginAdvertiser = async (req, res) => {
    try {
        const { email, password } = req.body;
        const advertiser = await Advertiser.findOne({ email, password, estado: 'activo' });
        
        if (!advertiser) {
            return res.status(401).json({ success: false, error: 'Credenciales inválidas o cuenta suspendida.' });
        }
        res.json({ success: true, message: 'Login exitoso', advertiserId: advertiser._id, empresa: advertiser.empresa });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

// 4. Enviar los datos al panel del cliente (Vistas, Clics, Links)
exports.getAdvertiserDashboard = async (req, res) => {
    try {
        const { advertiserId } = req.params;
        // Buscamos todos los anuncios de este cliente
        const ads = await Ad.find({ advertiserId }).sort({ createdAt: -1 });
        res.json({ success: true, ads });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

// ==========================================
// SISTEMA DE TRACKING (CONTADORES EXACTOS)
// ==========================================

// 5. Contar CLICS y redirigir (Se usará en los banners de Web y App)
exports.trackClick = async (req, res) => {
    try {
        const { adId, plataforma } = req.query; // plataforma: 'web' o 'app'
        const ad = await Ad.findById(adId);
        
        if (!ad) return res.status(404).send('Anuncio no encontrado');

        // Sumamos el clic donde corresponda
        if (plataforma === 'app') {
            ad.clicksApp += 1;
        } else {
            ad.clicksWeb += 1;
        }
        await ad.save();

        // Redirigir mágicamente a la web del cliente
        if (ad.enlaceDestino) {
            res.redirect(ad.enlaceDestino);
        } else {
            res.send('Gracias por su interés.');
        }
    } catch (error) {
        res.status(500).send('Error procesando el clic.');
    }
};

// 6. Contar VISTAS (Llamada invisible desde la Web/App cuando aparece el banner)
exports.trackView = async (req, res) => {
    try {
        const { adId, plataforma } = req.body;
        const ad = await Ad.findById(adId);
        
        if (ad) {
            if (plataforma === 'app') {
                ad.vistasApp += 1;
            } else {
                ad.vistasWeb += 1;
            }
            await ad.save();
        }
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};


// 7. Crear anuncio desde el panel del cliente (Va a revisión por defecto)
exports.createAdClient = async (req, res) => {
    try {
        const { advertiserId, nombreCampana, tipo, mediaUrl, enlaceDestino, textoMencion, limiteVideos } = req.body;
        
        const newAd = new Ad({ 
            advertiserId, 
            nombreCampana, 
            tipo, 
            mediaUrl, 
            enlaceDestino, 
            textoMencion,
            limiteVideos: parseInt(limiteVideos) || 0,
            estado: 'revision' // Obligamos a que nazca en revisión
        });
        
        await newAd.save();
        res.json({ success: true, message: 'Campaña enviada a revisión exitosamente.', ad: newAd });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

// 8. Aprobar anuncio (Solo Admin)
exports.approveAd = async (req, res) => {
    try {
        const { adId } = req.params;
        const ad = await Ad.findByIdAndUpdate(adId, { estado: 'activo' }, { new: true });
        
        if (!ad) return res.status(404).json({ success: false, error: 'Anuncio no encontrado' });
        
        res.json({ success: true, message: 'Anuncio aprobado y activo en rotación.', ad });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};


// 9. Subir archivo multimedia a Cloudflare R2
exports.uploadAdMedia = async (req, res) => {
    if (!req.file) return res.status(400).json({ success: false, error: "No se subió ningún archivo." });

    try {
        const fileStream = fs.createReadStream(req.file.path);
        const ext = path.extname(req.file.originalname);
        // Creamos un nombre único para el anuncio
        const fileName = `anuncios/ad_${Date.now()}_${Math.round(Math.random() * 1E9)}${ext}`;

        const uploadParams = {
            Bucket: process.env.R2_BUCKET_NAME,
            Key: fileName,
            Body: fileStream,
            ContentType: req.file.mimetype,
        };

        // Subimos a R2
        await s3Client.send(new PutObjectCommand(uploadParams));

        // Borramos el archivo temporal del disco duro de tu servidor para que no se llene
        fs.unlinkSync(req.file.path);

        // Devolvemos la URL pública final
        const publicUrl = `${process.env.R2_PUBLIC_DOMAIN}/${fileName}`;
        res.json({ success: true, url: publicUrl });

    } catch (error) {
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }
        res.status(500).json({ success: false, error: "Error al subir a R2: " + error.message });
    }
};


// 10. Obtener anuncios activos para Web o App (Rotación aleatoria)
exports.getActiveAds = async (req, res) => {
    try {
        const { plataforma } = req.query; // Esperamos 'web' o 'app'
        
        // Buscamos solo los anuncios activos
        let filtro = { estado: 'activo' };
        
        // Filtramos según dónde pidió salir el cliente
        if (plataforma === 'web') {
            filtro.mostrarEnWeb = true;
        } else if (plataforma === 'app') {
            filtro.mostrarEnApp = true;
        }

        const ads = await Ad.find(filtro).lean();
        
        // Mezclamos los anuncios de forma aleatoria para que no salga siempre el mismo primero
        const shuffledAds = ads.sort(() => 0.5 - Math.random());
        
        res.json({ success: true, ads: shuffledAds });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};