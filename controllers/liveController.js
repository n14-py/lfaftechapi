const axios = require('axios');
const Article = require('../models/article');
const LiveConfig = require('../models/liveConfig');
const LiveJob = require('../models/liveJob');
const catalog = require('../utils/liveCatalog');

const IN_FLIGHT = ['sending', 'accepted', 'live', 'stopping'];
const BUSY_COOLDOWN_MS = 60 * 1000;
const ACCEPT_TIMEOUT_MS = 20 * 60 * 1000;
const LIVE_TIMEOUT_MS = 4 * 60 * 60 * 1000;

let ticking = false;
let timer = null;
let dispatchLock = false;

function serviceUrl(config) {
    const fromDb = config && config.liveServiceUrl;
    const fromEnv = process.env.LIVE_SERVICE_URL || '';
    return catalog.normalizeServiceUrl(fromDb) || catalog.normalizeServiceUrl(fromEnv) || '';
}

function authHeaders() {
    return { 'x-api-key': process.env.ADMIN_API_KEY || '' };
}

async function loadConfig() {
    let doc = await LiveConfig.findOne({ key: 'program' });
    if (!doc) {
        const defaults = catalog.normalizeConfig({
            enabled: false,
            autoDispatch: true,
            liveServiceUrl: process.env.LIVE_SERVICE_URL || '',
            paises: [],
            canales: catalog.defaultCanales()
        }).config;
        doc = await LiveConfig.create({ key: 'program', ...defaults });
    }
    return doc;
}

function publicConfig(doc) {
    const normalized = catalog.normalizeConfig({
        enabled: doc.enabled,
        autoDispatch: doc.autoDispatch,
        liveServiceUrl: doc.liveServiceUrl,
        lookbackDays: doc.lookbackDays,
        minVideos: doc.minVideos,
        maxVideos: doc.maxVideos,
        paises: doc.paises,
        canales: doc.canales && doc.canales.length ? doc.canales : catalog.defaultCanales()
    }).config;
    return {
        ...normalized,
        liveServiceUrlEfectiva: serviceUrl(normalized)
    };
}

async function inventarioDe(config) {
    const since = new Date(Date.now() - (config.lookbackDays || 5) * 24 * 60 * 60 * 1000);
    const codes = catalog.PAISES.map((p) => p.code);
    const aliases = codes.flatMap((code) => [code, code.toUpperCase()]);

    const articles = await Article.find({
        sitio: 'noticias.lat',
        pais: { $in: aliases },
        videoProcessingStatus: 'complete',
        enlaceOriginal: { $not: /#short$/i },
        fecha: { $gte: since }
    })
        .sort({ fecha: -1 })
        .limit(1500)
        .select('titulo descripcion categoria pais videoUrl fecha enlaceOriginal')
        .lean();

    const inventario = {};
    const resumen = {};
    for (const pais of catalog.PAISES) {
        inventario[pais.code] = [];
        resumen[pais.code] = { code: pais.code, nombre: pais.nombre, listos: 0, sinMp4: 0 };
    }

    for (const article of articles) {
        const code = String(article.pais || '').trim().toLowerCase();
        if (!resumen[code]) continue;
        const url = article.videoUrl && String(article.videoUrl).trim();
        if (!url) {
            resumen[code].sinMp4 += 1;
            continue;
        }
        if (inventario[code].length >= 40) continue;
        inventario[code].push(article);
        resumen[code].listos += 1;
    }

    return {
        inventario,
        resumen: catalog.PAISES.map((pais) => resumen[pais.code])
    };
}

async function idsReservados(lookbackDays) {
    const since = new Date(Date.now() - (lookbackDays || 5) * 24 * 60 * 60 * 1000);
    const jobs = await LiveJob.find({
        status: { $in: ['queued', 'sending', 'accepted', 'live', 'complete'] },
        createdAt: { $gte: since }
    }).select('articleIds').lean();
    const ids = [];
    for (const job of jobs) {
        for (const id of job.articleIds || []) ids.push(String(id));
    }
    return ids;
}

async function pingServicio(url) {
    if (!url) {
        return { ok: false, detalle: 'Falta la URL del motor de directos.' };
    }
    try {
        const res = await axios.get(`${url}/health`, { timeout: 5000 });
        const live = res.data && res.data.live;
        return {
            ok: true,
            detalle: 'Motor en línea',
            ffmpeg: Boolean(res.data && res.data.ffmpeg),
            estado: live && live.status ? live.status : 'idle',
            liveId: live && live.live_id ? live.live_id : null,
            titulo: live && live.title ? live.title : null
        };
    } catch (error) {
        return { ok: false, detalle: `No pude hablar con el motor: ${error.message}` };
    }
}

function jobVista(job) {
    if (!job) return null;
    const plain = typeof job.toObject === 'function' ? job.toObject() : job;
    return {
        id: String(plain._id),
        liveId: plain.liveId,
        pais: plain.pais,
        paisNombre: plain.paisNombre,
        canalId: plain.canalId,
        canalNombre: plain.canalNombre,
        status: plain.status,
        videoCount: plain.videoCount,
        reused: plain.reused,
        youtubeId: plain.youtubeId,
        watchUrl: plain.watchUrl,
        title: plain.title,
        presenter: plain.presenter,
        voice: plain.voice,
        monetizationEnabled: plain.monetizationEnabled,
        cuentaReal: plain.cuentaReal,
        error: plain.error,
        createdAt: plain.createdAt,
        liveAt: plain.liveAt,
        finishedAt: plain.finishedAt
    };
}

exports.getPanel = async (req, res) => {
    try {
        const doc = await loadConfig();
        const config = publicConfig(doc);
        const { resumen } = await inventarioDe(config);
        const recientes = await LiveJob.find().sort({ createdAt: -1 }).limit(80);
        const peso = (status) => (IN_FLIGHT.includes(status) ? 0 : status === 'queued' ? 1 : 2);
        recientes.sort((a, b) => {
            const diff = peso(a.status) - peso(b.status);
            if (diff) return diff;
            const ta = new Date(a.createdAt).getTime();
            const tb = new Date(b.createdAt).getTime();
            return a.status === 'queued' ? ta - tb : tb - ta;
        });
        const jobs = recientes.slice(0, 40);
        const enAire = jobs.find((job) => IN_FLIGHT.includes(job.status)) || null;
        const servicio = await pingServicio(config.liveServiceUrlEfectiva);
        res.json({
            catalogo: { paises: catalog.PAISES, canales: catalog.CANALES, maxDirectosPorCanal: catalog.MAX_DIRECTOS },
            config,
            inventario: resumen,
            jobs: jobs.map(jobVista),
            enAire: jobVista(enAire),
            servicio,
            cola: jobs.filter((job) => job.status === 'queued').length
        });
    } catch (error) {
        console.error('[Directos] Panel:', error.message);
        res.status(500).json({ error: 'No pude armar el panel de directos.' });
    }
};

exports.saveConfig = async (req, res) => {
    try {
        const parsed = catalog.normalizeConfig(req.body || {}, { strict: true });
        if (!parsed.ok) return res.status(400).json({ error: parsed.errors.join(' '), errors: parsed.errors });

        const doc = await loadConfig();
        Object.assign(doc, parsed.config);
        await doc.save();
        console.log(`[Directos] Programa guardado. ${parsed.config.paises.length} países, ${parsed.config.totalDirectos} directos por tanda.`);
        res.json({ success: true, config: publicConfig(doc) });
    } catch (error) {
        console.error('[Directos] Guardar:', error.message);
        res.status(500).json({ error: 'No pude guardar el programa.' });
    }
};

exports.buildTanda = async (req, res) => {
    try {
        const doc = await loadConfig();
        const config = publicConfig(doc);
        if (!config.paises.length) {
            return res.status(400).json({ error: 'Primero guardá el programa con al menos un país marcado.' });
        }

        const { inventario } = await inventarioDe(config);
        const reservados = await idsReservados(config.lookbackDays);
        const plan = catalog.planTanda({
            paises: config.paises,
            canales: config.canales,
            inventario,
            minVideos: config.minVideos,
            maxVideos: config.maxVideos,
            reservados
        });

        await LiveJob.updateMany({ status: 'queued' }, { $set: { status: 'cancelled', finishedAt: new Date(), error: 'Reemplazado por una tanda nueva.' } });

        const creados = [];
        for (const job of plan.jobs) {
            const saved = await LiveJob.create({
                liveId: job.liveId,
                pais: job.pais,
                paisNombre: job.paisNombre,
                canalId: job.canalId,
                canalNombre: job.canalNombre,
                status: 'queued',
                videoCount: job.videoCount,
                reused: job.reused,
                payload: job.payload,
                articleIds: job.articleIds
            });
            creados.push(jobVista(saved));
        }

        console.log(`[Directos] Tanda armada: ${creados.length} directos en cola.`);
        res.json({
            success: true,
            total: creados.length,
            programado: config.totalDirectos,
            avisos: plan.avisos,
            jobs: creados
        });
    } catch (error) {
        console.error('[Directos] Tanda:', error.message);
        res.status(500).json({ error: 'No pude armar la tanda.' });
    }
};

async function enviarJob(job, url) {
    job.status = 'sending';
    job.error = null;
    await job.save();

    let response;
    try {
        response = await axios.post(`${url}/live/start`, job.payload, {
            headers: { ...authHeaders(), 'Content-Type': 'application/json' },
            timeout: 20000,
            validateStatus: () => true
        });
    } catch (error) {
        job.status = 'queued';
        job.notBefore = new Date(Date.now() + BUSY_COOLDOWN_MS);
        job.error = `El motor no respondió: ${error.message}`;
        await job.save();
        return { ok: false, status: 0, error: job.error };
    }

    if (response.status === 202) {
        job.status = 'accepted';
        job.acceptedAt = new Date();
        job.error = null;
        await job.save();
        console.log(`[Directos] ${job.liveId} aceptado por el motor (${job.paisNombre} → ${job.canalNombre}).`);
        return { ok: true, status: 202, job: jobVista(job) };
    }

    if (response.status === 503) {
        job.status = 'queued';
        job.notBefore = new Date(Date.now() + BUSY_COOLDOWN_MS);
        job.error = 'El motor ya tiene un directo en curso.';
        await job.save();
        return { ok: false, status: 503, error: job.error, job: jobVista(job) };
    }

    const detalle = (response.data && (response.data.error || response.data.message)) || `HTTP ${response.status}`;
    job.status = 'failed';
    job.finishedAt = new Date();
    job.error = String(detalle).slice(0, 500);
    await job.save();
    console.error(`[Directos] ${job.liveId} rechazado: ${job.error}`);
    return { ok: false, status: response.status, error: job.error, job: jobVista(job) };
}

async function siguienteEnCola() {
    const ahora = new Date();
    return LiveJob.findOne({
        status: 'queued',
        $or: [{ notBefore: null }, { notBefore: { $lte: ahora } }]
    }).sort({ priority: -1, createdAt: 1 });
}

exports.dispatchNext = async (req, res) => {
    try {
        const resultado = await despachar({ manual: true });
        if (!resultado.ok && resultado.code) return res.status(resultado.code).json(resultado);
        res.json(resultado);
    } catch (error) {
        console.error('[Directos] Dispatch:', error.message);
        res.status(500).json({ error: 'No pude enviar el directo.' });
    }
};

async function despachar({ manual = false } = {}) {
    if (dispatchLock) {
        return { ok: false, code: 409, error: 'Ya estoy enviando un directo.' };
    }
    dispatchLock = true;
    try {
        return await despacharAhora({ manual });
    } finally {
        dispatchLock = false;
    }
}

async function despacharAhora({ manual = false } = {}) {
    const ocupado = await LiveJob.findOne({ status: { $in: IN_FLIGHT } });
    if (ocupado) {
        return {
            ok: false,
            code: 409,
            error: `Ya hay un directo en curso (${ocupado.paisNombre} en ${ocupado.canalNombre}).`,
            job: jobVista(ocupado)
        };
    }

    const doc = await loadConfig();
    const config = publicConfig(doc);
    if (!manual && (!config.enabled || !config.autoDispatch)) {
        return { ok: false, skipped: true, error: 'El envío automático está apagado.' };
    }

    const url = config.liveServiceUrlEfectiva;
    if (!url) {
        return { ok: false, code: 400, error: 'Falta la URL del motor de directos (noticiaslatenvivo).' };
    }

    const job = await siguienteEnCola();
    if (!job) {
        return { ok: false, code: 404, error: 'No hay directos en la cola. Armá una tanda primero.' };
    }

    const envio = await enviarJob(job, url);
    if (!envio.ok) return { ...envio, code: envio.status && envio.status !== 503 ? envio.status : 200 };
    return envio;
}

exports.preview = async (req, res) => {
    try {
        const doc = await loadConfig();
        const config = publicConfig(doc);
        const url = config.liveServiceUrlEfectiva;
        if (!url) return res.status(400).json({ error: 'Falta la URL del motor de directos.' });

        let payload = null;
        if (req.body && req.body.jobId) {
            const job = await LiveJob.findById(req.body.jobId);
            if (!job || !job.payload) return res.status(404).json({ error: 'Ese directo no tiene JSON.' });
            payload = job.payload;
        } else {
            const pais = String((req.body && req.body.pais) || '').toLowerCase();
            const canalId = Number(req.body && req.body.canalId);
            const canal = config.canales.find((item) => item.id === canalId) || catalog.CANALES.find((item) => item.id === canalId);
            if (!pais || !canal) return res.status(400).json({ error: 'Elegí un país y un canal.' });
            const { inventario } = await inventarioDe(config);
            const plan = catalog.planTanda({
                paises: [pais],
                canales: [{ ...canal, activo: true, directosPorTanda: 1 }],
                inventario,
                minVideos: config.minVideos,
                maxVideos: config.maxVideos,
                reservados: []
            });
            if (!plan.jobs.length) {
                return res.status(400).json({ error: (plan.avisos[0] && plan.avisos[0].motivo) || 'Ese país no tiene videos suficientes.' });
            }
            payload = plan.jobs[0].payload;
        }

        const response = await axios.post(`${url}/live/preview`, payload, {
            headers: { ...authHeaders(), 'Content-Type': 'application/json' },
            timeout: 25000,
            validateStatus: () => true
        });
        if (response.status >= 300) {
            const detalle = (response.data && response.data.error) || `HTTP ${response.status}`;
            return res.status(response.status).json({ error: detalle, payload });
        }
        res.json({ success: true, payload, preview: response.data });
    } catch (error) {
        console.error('[Directos] Preview:', error.message);
        res.status(502).json({ error: `El motor no contestó la vista previa: ${error.message}` });
    }
};

exports.stopCurrent = async (req, res) => {
    try {
        const doc = await loadConfig();
        const url = serviceUrl(publicConfig(doc));
        if (!url) return res.status(400).json({ error: 'Falta la URL del motor de directos.' });

        const job = await LiveJob.findOne({ status: { $in: ['accepted', 'live', 'sending'] } }).sort({ createdAt: -1 });
        if (job) {
            job.status = 'stopping';
            await job.save();
        }

        const response = await axios.post(`${url}/live/stop`, {}, {
            headers: authHeaders(),
            timeout: 15000,
            validateStatus: () => true
        });
        res.json({
            success: response.status < 300,
            status: response.status,
            motor: response.data,
            job: jobVista(job)
        });
    } catch (error) {
        console.error('[Directos] Stop:', error.message);
        res.status(502).json({ error: `No pude pedirle al motor que corte: ${error.message}` });
    }
};

exports.getJob = async (req, res) => {
    try {
        const job = await LiveJob.findById(req.params.id);
        if (!job) return res.status(404).json({ error: 'Directo no encontrado.' });
        res.json({ job: jobVista(job), payload: job.payload });
    } catch (error) {
        res.status(400).json({ error: 'ID inválido.' });
    }
};

exports.cancelJob = async (req, res) => {
    try {
        const job = await LiveJob.findById(req.params.id);
        if (!job) return res.status(404).json({ error: 'Directo no encontrado.' });
        if (job.status !== 'queued') {
            return res.status(409).json({ error: 'Solo se puede cancelar un directo que todavía está en la cola.' });
        }
        job.status = 'cancelled';
        job.finishedAt = new Date();
        job.error = 'Cancelado desde el admin.';
        await job.save();
        res.json({ success: true, job: jobVista(job) });
    } catch (error) {
        res.status(400).json({ error: 'ID inválido.' });
    }
};

exports.retryJob = async (req, res) => {
    try {
        const job = await LiveJob.findById(req.params.id);
        if (!job || !job.payload) return res.status(404).json({ error: 'No hay JSON para reintentar.' });
        const liveId = catalog.makeLiveId(job.pais, job.canalId);
        const payload = { ...job.payload, live_id: liveId };
        const copia = await LiveJob.create({
            liveId,
            pais: job.pais,
            paisNombre: job.paisNombre,
            canalId: job.canalId,
            canalNombre: job.canalNombre,
            status: 'queued',
            priority: 10,
            videoCount: job.videoCount,
            reused: job.reused,
            payload,
            articleIds: job.articleIds
        });
        res.json({ success: true, job: jobVista(copia) });
    } catch (error) {
        console.error('[Directos] Retry:', error.message);
        res.status(500).json({ error: 'No pude reencolar el directo.' });
    }
};

async function aplicarEvento(body, status) {
    const liveId = body && (body.liveId || body.live_id);
    if (!liveId) return null;
    let job = await LiveJob.findOne({ liveId: String(liveId) });
    if (!job) {
        job = new LiveJob({
            liveId: String(liveId),
            pais: body.pais || 'latam',
            paisNombre: body.paisNombre || catalog.nombrePais(body.pais),
            canalId: Number.isFinite(Number(body.cuenta)) ? Number(body.cuenta) : 0,
            canalNombre: body.canal || 'Noticias Lat',
            videoCount: body.videoCount || 0,
            articleIds: body.articleIds || [],
            payload: null
        });
    }
    job.status = status;
    if (body.youtubeId) job.youtubeId = body.youtubeId;
    if (body.watchUrl) job.watchUrl = body.watchUrl;
    if (body.title) job.title = body.title;
    if (body.presenter) job.presenter = body.presenter;
    if (body.voice) job.voice = body.voice;
    if (typeof body.monetizationEnabled === 'boolean') job.monetizationEnabled = body.monetizationEnabled;
    if (body.cuenta !== undefined && body.cuenta !== null && body.cuenta !== '') job.cuentaReal = Number(body.cuenta);
    const nombreEntrante = body.paisNombre && String(body.paisNombre).trim();
    const codigo = String(body.pais || job.pais || '').toLowerCase();
    if (nombreEntrante && nombreEntrante.toLowerCase() !== codigo) job.paisNombre = nombreEntrante;
    else if (codigo) job.paisNombre = catalog.nombrePais(codigo);
    if (status === 'live') job.liveAt = job.liveAt || new Date();
    if (status === 'complete' || status === 'failed') job.finishedAt = new Date();
    if (status === 'failed') job.error = String(body.error || 'El motor reportó un fallo.').slice(0, 500);
    if (status !== 'failed') job.error = null;
    await job.save();
    console.log(`[Directos] Webhook ${status} para ${job.liveId}.`);
    return job;
}

exports.onLiveStarted = async (req, res) => {
    try {
        const job = await aplicarEvento(req.body, 'live');
        if (!job) return res.status(400).json({ error: 'Falta liveId.' });
        res.json({ success: true });
    } catch (error) {
        console.error('[Directos] live_started:', error.message);
        res.status(500).json({ error: 'No pude registrar el inicio.' });
    }
};

exports.onLiveComplete = async (req, res) => {
    try {
        const job = await aplicarEvento(req.body, 'complete');
        if (!job) return res.status(400).json({ error: 'Falta liveId.' });
        res.json({ success: true });
        setImmediate(() => tick().catch((error) => console.error('[Directos] Post-complete:', error.message)));
    } catch (error) {
        console.error('[Directos] live_complete:', error.message);
        res.status(500).json({ error: 'No pude registrar el cierre.' });
    }
};

exports.onLiveFailed = async (req, res) => {
    try {
        const job = await aplicarEvento(req.body, 'failed');
        if (!job) return res.status(400).json({ error: 'Falta liveId.' });
        res.json({ success: true });
        setImmediate(() => tick().catch((error) => console.error('[Directos] Post-failed:', error.message)));
    } catch (error) {
        console.error('[Directos] live_failed:', error.message);
        res.status(500).json({ error: 'No pude registrar el fallo.' });
    }
};

async function reconciliar(url) {
    const job = await LiveJob.findOne({ status: { $in: ['accepted', 'live', 'sending', 'stopping'] } }).sort({ updatedAt: -1 });
    if (!job || !url) return;

    const edad = Date.now() - new Date(job.updatedAt || job.createdAt).getTime();
    if (job.status === 'sending' && edad > 2 * 60 * 1000) {
        job.status = 'queued';
        job.error = 'El envío quedó a medias. Vuelve a la cola.';
        await job.save();
        return;
    }

    let remoto = null;
    try {
        const response = await axios.get(`${url}/live/status`, {
            headers: authHeaders(),
            timeout: 8000,
            validateStatus: () => true
        });
        if (response.status < 300) remoto = response.data;
    } catch (error) {
        return;
    }
    if (!remoto) return;

    const mismo = remoto.live_id && remoto.live_id === job.liveId;
    if (mismo && remoto.status === 'live' && job.status !== 'live') {
        job.status = 'live';
        job.liveAt = job.liveAt || new Date();
        job.youtubeId = remoto.youtube_id || job.youtubeId;
        job.watchUrl = remoto.watch_url || job.watchUrl;
        job.title = remoto.title || job.title;
        job.monetizationEnabled = Boolean(remoto.monetization_enabled);
        await job.save();
    }
    if (mismo && (remoto.status === 'complete' || remoto.status === 'failed')) {
        job.status = remoto.status === 'complete' ? 'complete' : 'failed';
        job.finishedAt = new Date();
        job.error = remoto.error || null;
        job.youtubeId = remoto.youtube_id || job.youtubeId;
        job.watchUrl = remoto.watch_url || job.watchUrl;
        await job.save();
    }
    if (!mismo && (remoto.status === 'idle' || remoto.status === 'complete' || remoto.status === 'failed')) {
        if ((job.status === 'accepted' || job.status === 'sending') && edad > ACCEPT_TIMEOUT_MS) {
            job.status = 'failed';
            job.finishedAt = new Date();
            job.error = 'El motor no confirmó este directo.';
            await job.save();
        }
        if (job.status === 'live' && edad > LIVE_TIMEOUT_MS) {
            job.status = 'complete';
            job.finishedAt = new Date();
            await job.save();
        }
        if (job.status === 'stopping' && edad > 2 * 60 * 1000) {
            job.status = 'complete';
            job.finishedAt = new Date();
            job.error = null;
            await job.save();
        }
    }
}

async function tick() {
    if (ticking) return;
    ticking = true;
    try {
        const doc = await loadConfig();
        const config = publicConfig(doc);
        const url = config.liveServiceUrlEfectiva;
        await reconciliar(url);
        if (config.enabled && config.autoDispatch && url) {
            await despachar({ manual: false });
        }
    } catch (error) {
        console.error('[Directos] Reloj:', error.message);
    } finally {
        ticking = false;
    }
}

exports.startDispatcher = function startDispatcher() {
    if (timer) return;
    timer = setInterval(() => {
        tick().catch((error) => console.error('[Directos] Reloj:', error.message));
    }, 20000);
    if (typeof timer.unref === 'function') timer.unref();
    console.log('📡 [Directos] Reloj del programa en vivo activo (cola → noticiaslatenvivo).');
};
