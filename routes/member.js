const express = require('express');
const router = express.Router();
const memberController = require('../controllers/memberController');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// 1. Asegurarnos de que la carpeta "uploads" exista en la raíz de la API
const uploadDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadDir)){
    fs.mkdirSync(uploadDir, { recursive: true });
}

// 2. Configuración de almacenamiento de Multer
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'uploads/'); // Guardar en la carpeta uploads
    },
    filename: (req, file, cb) => {
        // Crear un nombre único: member-16780092-numeroaleatorio.jpg
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, `member-${uniqueSuffix}${path.extname(file.originalname)}`);
    }
});

// 3. Filtro de seguridad: Solo aceptar imágenes
const fileFilter = (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|webp|gif/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);

    if (extname && mimetype) {
        return cb(null, true);
    } else {
        cb(new Error('Formato no válido. Solo se permiten imágenes (jpeg, jpg, png, webp).'));
    }
};

// 4. Inicializar Multer con límite de tamaño (5MB)
const upload = multer({ 
    storage: storage,
    fileFilter: fileFilter,
    limits: { fileSize: 5 * 1024 * 1024 } 
});

// ==========================================
// 5. DEFINICIÓN DE RUTAS
// ==========================================

// Ruta para verificar y sincronizar membresías (No necesita foto)
router.post('/sync', memberController.verifyAndSyncMember);

// Ruta para publicar noticia y video (Necesita procesar la 'image')
router.post('/publish', upload.single('image'), memberController.publishMemberArticle);

// Ruta para consultar el historial del miembro
router.get('/history/:googleId', memberController.getMemberHistory);

module.exports = router;