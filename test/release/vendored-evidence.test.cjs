const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const root = path.resolve(__dirname, '../..');
const evidence = require('../../docs/release/vendored-notice-evidence.json');
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

test('vendored evidence pins the exact copied file and published package comparison', () => {
    assert.ok(evidence.assets.length > 0);
    for (const asset of evidence.assets) {
        assert.ok(asset.file.startsWith('src/addons/libraries/thirdparty/'));
        assert.ok(!asset.file.split('/').includes('..'));
        const bytes = fs.readFileSync(path.join(root, asset.file));
        assert.equal(sha256(bytes), asset.sha256, 'Copied asset changed; recheck its provenance');
        const comparison = asset.packageEvidence ?
            asset.packageEvidence.files.find(f => f.path.endsWith('/chart.min.js')) : asset.sourceEvidence;
        assert.equal(comparison.matchesLocal, true);
        assert.equal(comparison.sha256, asset.sha256);
        if (asset.packageEvidence) assert.match(asset.packageEvidence.integrity, /^sha512-[A-Za-z0-9+/]+={0,2}$/);
    }
});

test('TinyColor keeps its exact Addons source and mapped MIT terms without inventing a version', () => {
    const asset = evidence.assets.find(a => a.file.endsWith('/tinycolor-min.js'));
    const notice = asset.notices[0];
    assert.equal(notice.version, null);
    assert.equal(notice.revision, asset.sourceEvidence.revision);
    assert.ok(asset.sourceEvidence.url.includes(`/${notice.revision}/`));
    assert.equal(sha256(asset.licenceMapping.text), asset.licenceMapping.sha256);
    assert.equal(JSON.parse(asset.licenceMapping.text).tinycolor2, 'MIT');
    assert.equal(sha256(notice.text), notice.sha256);
    assert.match(notice.text, /Permission is hereby granted/);
    assert.ok(fs.readFileSync(path.join(root, asset.file), 'utf8').startsWith(notice.embeddedHeader));
    assert.match(notice.embeddedHeader, /Brian Grinstead, MIT License/);
});

test('all embedded Chart.js notices retain exact header and pinned full-text evidence', () => {
    const asset = evidence.assets[0];
    const source = fs.readFileSync(path.join(root, asset.file), 'utf8');
    const headers = [...source.matchAll(/\/\*![\s\S]*?\*\//g)].map(m => m[0]);
    assert.deepEqual(asset.notices.map(n => n.embeddedHeader), headers);
    assert.deepEqual(asset.notices.map(n => [n.name, n.version]), [['chart.js', '3.9.1'], ['@kurkle/color', '0.2.1']]);
    for (const notice of asset.notices) {
        assert.equal(sha256(notice.text), notice.sha256);
        const url = new URL(notice.url);
        assert.equal(url.hostname, 'raw.githubusercontent.com');
        assert.match(notice.revision, /^[a-f0-9]{40}$/);
        assert.equal(url.pathname.split('/')[3], notice.revision);
        assert.match(notice.text, /Permission is hereby granted/);
        assert.match(notice.text, /THE SOFTWARE IS PROVIDED/);
    }
    // Full upstream terms and generated bundle headers have different date
    // ranges. Preserve both; never silently rewrite either copyright line.
    assert.match(asset.notices[1].embeddedHeader, /2022 Jukka Kurkela/);
    assert.match(asset.notices[1].text, /2018-2021 Jukka Kurkela/);
    const packaged = asset.packageEvidence.files.find(f => f.path === 'package/LICENSE.md');
    assert.equal(packaged.text, asset.notices[0].text);
    assert.equal(packaged.sha256, asset.notices[0].sha256);
});
