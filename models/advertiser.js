const mongoose = require('mongoose');

const AdvertiserSchema = new mongoose.Schema({
    // Nombre de la empresa o persona que te contrata
    empresa: { type: String, required: true },
    
    // Datos de acceso para su panel privado
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true }, // Guardaremos esto de forma segura
    
    // Datos de contacto opcionales
    telefono: { type: String },
    
    // Control de acceso por si necesitas suspenderle la cuenta
    estado: { type: String, enum: ['activo', 'inactivo'], default: 'activo' },

    // Token temporal para sesiones (opcional pero recomendado para el login)
    sessionToken: { type: String, default: null }
}, { timestamps: true });

module.exports = mongoose.model('Advertiser', AdvertiserSchema);