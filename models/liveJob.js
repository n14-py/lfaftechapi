const mongoose = require('mongoose');

const LiveJobSchema = new mongoose.Schema({
    liveId: { type: String, required: true, unique: true, index: true },
    pais: { type: String, required: true, index: true },
    paisNombre: { type: String, default: '' },
    canalId: { type: Number, required: true },
    canalNombre: { type: String, default: '' },
    status: {
        type: String,
        enum: ['queued', 'sending', 'accepted', 'live', 'complete', 'failed', 'cancelled', 'stopping'],
        default: 'queued',
        index: true
    },
    priority: { type: Number, default: 0 },
    videoCount: { type: Number, default: 0 },
    reused: { type: Boolean, default: false },
    payload: { type: Object, default: null },
    articleIds: { type: [String], default: [] },
    youtubeId: { type: String, default: null },
    watchUrl: { type: String, default: null },
    title: { type: String, default: null },
    presenter: { type: String, default: null },
    voice: { type: String, default: null },
    monetizationEnabled: { type: Boolean, default: false },
    cuentaReal: { type: Number, default: null },
    error: { type: String, default: null },
    notBefore: { type: Date, default: null },
    acceptedAt: { type: Date, default: null },
    liveAt: { type: Date, default: null },
    finishedAt: { type: Date, default: null }
}, { timestamps: true });

LiveJobSchema.index({ status: 1, priority: -1, createdAt: 1 });

module.exports = mongoose.model('LiveJob', LiveJobSchema);
