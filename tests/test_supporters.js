const assert = require('assert');
const {
    classifyTier,
    levelNameFromSnippet,
    channelLinks,
    toPublicMember,
    mergeMembers,
} = require('../utils/youtubeSupporters');

function testClassify() {
    assert.strictEqual(classifyTier('Socio Fundador').key, 'socio-fundador');
    assert.strictEqual(classifyTier('IMPULSOR').key, 'impulsor');
    assert.strictEqual(classifyTier('aliado').key, 'aliado');
    assert.strictEqual(classifyTier(' Colaborador ').key, 'colaborador');
    assert.strictEqual(classifyTier('VIP'), null);
    assert.strictEqual(classifyTier(''), null);
}

function testLevelName() {
    const map = { lvl_gold: 'Socio Fundador' };
    assert.strictEqual(
        levelNameFromSnippet({ membershipsDetails: { highestAccessibleLevelDisplayName: 'Impulsor' } }, map),
        'Impulsor'
    );
    assert.strictEqual(
        levelNameFromSnippet({ membershipsDetails: { highestAccessibleLevel: 'lvl_gold' } }, map),
        'Socio Fundador'
    );
    assert.strictEqual(
        levelNameFromSnippet({ membershipsDurationAtLevel: { level: 'lvl_gold' } }, map),
        'Socio Fundador'
    );
}

function testLinks() {
    const links = channelLinks('UCabc', '@noticias-lat');
    assert.strictEqual(links.handle, '@noticias-lat');
    assert.strictEqual(links.url, 'https://www.youtube.com/@noticias-lat');
    assert.strictEqual(links.joinUrl, 'https://www.youtube.com/channel/UCabc/join');
}

function testPublicMemberDropsSecretsAndEmptyNames() {
    const member = toPublicMember({
        memberDetails: {
            channelId: 'UCmember',
            displayName: 'Ana Pérez',
            profileImageUrl: 'https://yt3.ggpht.com/ana',
            channelUrl: 'https://www.youtube.com/channel/UCmember',
            email: 'ana@example.com',
        },
        membershipsDetails: { highestAccessibleLevelDisplayName: 'Socio Fundador' },
        membershipsDuration: { memberSince: '2026-01-15T00:00:00Z', memberTotalDurationMonths: 4 },
    }, {}, 'Noticias LAT | AHORA');

    assert.strictEqual(member.name, 'Ana Pérez');
    assert.strictEqual(member.tier, 'socio-fundador');
    assert.strictEqual(member.months, 4);
    assert.strictEqual(member.email, undefined);
    assert.strictEqual(toPublicMember({ memberDetails: { displayName: '   ' } }, {}, 'Canal'), null);
}

function testMergeKeepsHighestTierAndBothChannels() {
    const low = toPublicMember({
        memberDetails: { channelId: 'UCana', displayName: 'Ana Pérez', channelUrl: 'https://www.youtube.com/channel/UCana' },
        membershipsDetails: { highestAccessibleLevelDisplayName: 'Colaborador' },
        membershipsDuration: { memberTotalDurationMonths: 2, memberSince: '2026-06-01T00:00:00Z' },
    }, {}, 'Noticias LAT');

    const high = toPublicMember({
        memberDetails: { channelId: 'UCana', displayName: 'Ana Pérez', channelUrl: 'https://www.youtube.com/channel/UCana' },
        membershipsDetails: { highestAccessibleLevelDisplayName: 'Socio Fundador' },
        membershipsDuration: { memberTotalDurationMonths: 8, memberSince: '2025-08-01T00:00:00Z' },
    }, {}, 'Noticias LAT | AHORA');

    const other = toPublicMember({
        memberDetails: { channelId: 'UCbeto', displayName: 'Beto Díaz', channelUrl: 'https://www.youtube.com/channel/UCbeto' },
        membershipsDetails: { highestAccessibleLevelDisplayName: 'Aliado' },
        membershipsDuration: { memberTotalDurationMonths: 1 },
    }, {}, 'Noticias LAT | HOY');

    const merged = mergeMembers([low, high, other]);
    assert.strictEqual(merged.length, 2);
    assert.strictEqual(merged[0].name, 'Ana Pérez');
    assert.strictEqual(merged[0].tier, 'socio-fundador');
    assert.strictEqual(merged[0].months, 8);
    assert.strictEqual(merged[0].since, '2025-08-01T00:00:00Z');
    assert.deepStrictEqual(merged[0].channels, ['Noticias LAT', 'Noticias LAT | AHORA']);
    assert.strictEqual(merged[0].rank, undefined);
    assert.strictEqual(merged[1].tier, 'aliado');
}

function main() {
    testClassify();
    testLevelName();
    testLinks();
    testPublicMemberDropsSecretsAndEmptyNames();
    testMergeKeepsHighestTierAndBothChannels();
    console.log('supporters ok');
}

main();
