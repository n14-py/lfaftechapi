const fs = require('fs');
const path = require('path');

// Las mismas 4 cuentas de la red (token_0 … token_3).
const CANALES = [
    { id: 0, archivoToken: 'token_0.json', nombre: 'Noticias LAT' },
    { id: 1, archivoToken: 'token_1.json', nombre: 'Noticias LAT | Última Hora' },
    { id: 2, archivoToken: 'token_2.json', nombre: 'Noticias LAT | AHORA' },
    { id: 3, archivoToken: 'token_3.json', nombre: 'Noticias LAT | HOY' },
];

const TIERS = [
    { key: 'socio-fundador', name: 'Socio Fundador', rank: 4, test: (value) => /fundador/.test(value) },
    { key: 'impulsor', name: 'Impulsor', rank: 3, test: (value) => /impulsor/.test(value) },
    { key: 'aliado', name: 'Aliado', rank: 2, test: (value) => /aliado/.test(value) },
    { key: 'colaborador', name: 'Colaborador', rank: 1, test: (value) => /colaborador/.test(value) },
];

const SUCCESS_TTL_MS = 30 * 60 * 1000;
const FAIL_TTL_MS = 5 * 60 * 1000;

let cache = null;

function classifyTier(rawName) {
    const name = String(rawName || '').trim().toLowerCase();
    if (!name) return null;
    return TIERS.find((tier) => tier.test(name)) || null;
}

function tierRank(key) {
    const tier = TIERS.find((item) => item.key === key);
    return tier ? tier.rank : 0;
}

function levelNameFromSnippet(snippet, levelMap) {
    const details = snippet && snippet.membershipsDetails;
    const direct = details && details.highestAccessibleLevelDisplayName;
    if (direct) return String(direct).trim();

    const duration = snippet && snippet.membershipsDurationAtLevel;
    if (duration && duration.displayName) return String(duration.displayName).trim();

    const levelId = (details && details.highestAccessibleLevel)
        || (duration && duration.level)
        || '';
    if (levelId && levelMap && levelMap[levelId]) return String(levelMap[levelId]).trim();
    return '';
}

function channelLinks(channelId, customUrl) {
    const raw = String(customUrl || '').trim();
    const handle = raw
        ? (raw.startsWith('@') ? raw : `@${raw.replace(/^@/, '')}`)
        : '';
    const url = handle
        ? `https://www.youtube.com/${handle}`
        : (channelId ? `https://www.youtube.com/channel/${channelId}` : '');
    const joinUrl = channelId ? `https://www.youtube.com/channel/${channelId}/join` : url;
    return { handle, url, joinUrl };
}

function httpsUrl(value) {
    return typeof value === 'string' && value.startsWith('https://') ? value : '';
}

function readMonths(snippet) {
    const candidates = [
        snippet && snippet.membershipsDuration && snippet.membershipsDuration.memberTotalDurationMonths,
        snippet && snippet.membershipsDetails && snippet.membershipsDetails.membershipsDuration
            && snippet.membershipsDetails.membershipsDuration.memberTotalDurationMonths,
        snippet && snippet.membershipsDurationAtLevel && snippet.membershipsDurationAtLevel.memberTotalDurationMonths,
    ];
    for (const value of candidates) {
        const number = Number(value);
        if (Number.isFinite(number) && number >= 0) return number;
    }
    return 0;
}

function readSince(snippet) {
    const candidates = [
        snippet && snippet.membershipsDuration && snippet.membershipsDuration.memberSince,
        snippet && snippet.membershipsDetails && snippet.membershipsDetails.membershipsDuration
            && snippet.membershipsDetails.membershipsDuration.memberSince,
        snippet && snippet.membershipsDurationAtLevel && snippet.membershipsDurationAtLevel.memberSince,
    ];
    return candidates.find((value) => typeof value === 'string' && value) || null;
}

function toPublicMember(snippet, levelMap, channelName) {
    if (!snippet) return null;
    const details = snippet.memberDetails || {};
    const name = String(details.displayName || '').trim();
    if (!name) return null;

    const rawLevel = levelNameFromSnippet(snippet, levelMap);
    const tier = classifyTier(rawLevel);
    const channelId = details.channelId || '';

    return {
        id: channelId,
        name,
        avatar: httpsUrl(details.profileImageUrl),
        url: httpsUrl(details.channelUrl) || (channelId ? `https://www.youtube.com/channel/${channelId}` : ''),
        tier: tier ? tier.key : 'miembro',
        tierName: tier ? tier.name : (rawLevel || 'Miembro'),
        rank: tier ? tier.rank : 0,
        since: readSince(snippet),
        months: readMonths(snippet),
        channelName: channelName || '',
    };
}

function mergeMembers(records) {
    const byId = new Map();

    for (const record of records || []) {
        if (!record || !record.name) continue;
        const key = record.id
            ? `id:${record.id}`
            : `name:${record.name.toLowerCase()}:${record.channelName || ''}`;
        const current = byId.get(key);

        if (!current) {
            byId.set(key, {
                ...record,
                channels: record.channelName ? [record.channelName] : [],
            });
            continue;
        }

        if (record.channelName && !current.channels.includes(record.channelName)) {
            current.channels.push(record.channelName);
        }
        if ((record.rank || 0) > (current.rank || 0)) {
            current.tier = record.tier;
            current.tierName = record.tierName;
            current.rank = record.rank;
        }
        if ((record.months || 0) > (current.months || 0)) current.months = record.months;
        if (record.since && (!current.since || record.since < current.since)) current.since = record.since;
        if (!current.avatar && record.avatar) current.avatar = record.avatar;
        if (!current.url && record.url) current.url = record.url;
        if (!current.id && record.id) current.id = record.id;
    }

    return [...byId.values()]
        .map(({ rank, channelName, ...member }) => member)
        .sort((a, b) => {
            const byTier = tierRank(b.tier) - tierRank(a.tier);
            if (byTier) return byTier;
            const byMonths = (b.months || 0) - (a.months || 0);
            if (byMonths) return byMonths;
            return a.name.localeCompare(b.name, 'es');
        });
}

function loadToken(archivo) {
    const tokenPath = path.join(__dirname, '..', 'tokens', archivo);
    if (!fs.existsSync(tokenPath)) return null;
    return JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
}

function youtubeClient(tokenData) {
    const { google } = require('googleapis');
    const auth = new google.auth.OAuth2(tokenData.client_id, tokenData.client_secret);
    auth.setCredentials({ refresh_token: tokenData.refresh_token });
    return google.youtube({ version: 'v3', auth });
}

function errorLabel(error) {
    const reason = error && error.errors && error.errors[0] && error.errors[0].reason;
    return reason || (error && error.message) || 'error';
}

async function readChannel(config) {
    const result = { channel: null, members: [], memberError: null };
    const tokenData = loadToken(config.archivoToken);
    if (!tokenData || !tokenData.refresh_token) {
        result.memberError = 'token';
        result.channel = emptyChannel(config.nombre);
        return result;
    }

    let youtube;
    try {
        youtube = youtubeClient(tokenData);
    } catch (error) {
        console.error(`[Supporters] ${config.nombre} cliente:`, error.message);
        result.memberError = 'token';
        result.channel = emptyChannel(config.nombre);
        return result;
    }

    try {
        const data = await youtube.channels.list({ part: 'snippet,statistics', mine: true });
        const item = data.data.items && data.data.items[0];
        if (item) {
            const links = channelLinks(item.id, item.snippet && item.snippet.customUrl);
            const thumbs = (item.snippet && item.snippet.thumbnails) || {};
            result.channel = {
                id: item.id,
                name: (item.snippet && item.snippet.title) || config.nombre,
                handle: links.handle,
                url: links.url,
                joinUrl: links.joinUrl,
                avatar: (thumbs.medium && thumbs.medium.url) || (thumbs.default && thumbs.default.url) || '',
                subscribers: Number(item.statistics && item.statistics.subscriberCount) || 0,
            };
        }
    } catch (error) {
        console.error(`[Supporters] ${config.nombre} perfil:`, errorLabel(error));
    }

    if (!result.channel) result.channel = emptyChannel(config.nombre);

    const levelMap = {};
    try {
        const levels = await youtube.membershipsLevels.list({ part: 'id,snippet' });
        for (const level of levels.data.items || []) {
            const display = level.snippet && level.snippet.levelDetails && level.snippet.levelDetails.displayName;
            if (level.id && display) levelMap[level.id] = display;
        }
    } catch (error) {
        console.error(`[Supporters] ${config.nombre} niveles:`, errorLabel(error));
    }

    try {
        let pageToken;
        let pages = 0;
        do {
            const params = { part: 'snippet', mode: 'all_current', maxResults: 1000 };
            if (pageToken) params.pageToken = pageToken;
            // Este método exige el scope youtube.channel-memberships.creator
            // y que YouTube haya habilitado el canal. Si falta el permiso, el canal
            // igual se devuelve y la lista de personas queda vacía.
            const response = await youtube.members.list(params);
            for (const item of response.data.items || []) {
                const member = toPublicMember(item.snippet, levelMap, result.channel.name);
                if (member) result.members.push(member);
            }
            pageToken = response.data.nextPageToken;
            pages += 1;
        } while (pageToken && pages < 20);
    } catch (error) {
        console.error(`[Supporters] ${config.nombre} miembros:`, errorLabel(error));
        result.memberError = 'youtube_unavailable';
    }

    return result;
}

function emptyChannel(nombre) {
    return {
        id: '',
        name: nombre,
        handle: '',
        url: '',
        joinUrl: '',
        avatar: '',
        subscribers: 0,
    };
}

async function collectSupporters() {
    const results = await Promise.all(CANALES.map((canal) => readChannel(canal)));
    const channels = results
        .map((result) => result.channel)
        .filter((channel) => channel && channel.name && (channel.id || channel.url));
    const members = mergeMembers(results.flatMap((result) => result.members));
    const failures = results.filter((result) => result.memberError).length;

    let syncError = null;
    if (failures === results.length) syncError = 'youtube_unavailable';
    else if (failures > 0) syncError = 'partial';

    return {
        success: true,
        updatedAt: new Date().toISOString(),
        total: members.length,
        syncError,
        channels,
        members,
    };
}

async function getPublicSupporters() {
    const now = Date.now();
    if (cache && (now - cache.at) < cache.ttl) return cache.payload;

    const payload = await collectSupporters();
    const healthy = !payload.syncError;
    cache = {
        at: now,
        ttl: healthy ? SUCCESS_TTL_MS : FAIL_TTL_MS,
        payload,
    };
    return payload;
}

async function listPublicSupporters(req, res) {
    try {
        const payload = await getPublicSupporters();
        res.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=900');
        res.json(payload);
    } catch (error) {
        console.error('[Supporters] Error al armar la lista:', error.message);
        res.json({
            success: false,
            updatedAt: new Date().toISOString(),
            total: 0,
            syncError: 'unavailable',
            channels: [],
            members: [],
        });
    }
}

module.exports = {
    CANALES,
    TIERS,
    classifyTier,
    levelNameFromSnippet,
    channelLinks,
    toPublicMember,
    mergeMembers,
    getPublicSupporters,
    listPublicSupporters,
};
