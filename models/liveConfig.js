const mongoose = require('mongoose');

const CanalSchema = new mongoose.Schema({
    id: { type: Number, required: true },
    nombre: { type: String, required: true },
    activo: { type: Boolean, default: true },
    directosPorTanda: { type: Number, default: 1 }
}, { _id: false });

const LiveConfigSchema = new mongoose.Schema({
    key: { type: String, default: 'program', unique: true },
    enabled: { type: Boolean, default: false },
    autoDispatch: { type: Boolean, default: true },
    liveServiceUrl: { type: String, default: '' },
    lookbackDays: { type: Number, default: 5 },
    minVideos: { type: Number, default: 8 },
    maxVideos: { type: Number, default: 15 },
    paises: { type: [String], default: [] },
    canales: { type: [CanalSchema], default: [] }
}, { timestamps: true });

module.exports = mongoose.model('LiveConfig', LiveConfigSchema);
