const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const {collectNotices, renderText} = require('../../scripts/release-notices.cjs');

const fixture = (t, packages) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-notice-test-'));
    t.after(() => fs.rmSync(root, {recursive: true, force: true}));
    fs.mkdirSync(path.join(root, 'node_modules'));
    fs.writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify({lockfileVersion: 3, packages}));
    const put = (file, value) => {
        const target = path.join(root, file);
        fs.mkdirSync(path.dirname(target), {recursive: true});
        fs.writeFileSync(target, typeof value === 'object' && !Buffer.isBuffer(value) ? JSON.stringify(value) : value);
    };
    return {root, put};
};

test('reviewed source notices require exact version/hash and preserve line endings', t => {
    const {root, put} = fixture(t, {'node_modules/a': {version: '1'}});
    put('node_modules/a/package.json', {name: 'a', version: '1'});
    const text = '// Copyright A\r\n// Permission\r\ncode();\r\n';
    put('node_modules/a/index.js', text);
    const supplement = [{location: 'node_modules/a', version: '1', license: 'MIT', note: 'Reviewed header',
        notices: [{file: 'index.js', startLine: 1, endLine: 2,
            sha256: crypto.createHash('sha256').update(text).digest('hex')}]}];
    const row = collectNotices(root, supplement).packages[0];
    assert.equal(row.notices[0].text, '// Copyright A\r\n// Permission\r\n');
    assert.equal(row.issues.length, 0);
    assert.equal(row.license, null);
    assert.equal(row.reviewedLicense, 'MIT');
    assert.throws(() => collectNotices(root, [{...supplement[0], version: '2'}]), /mismatch/);
    put('node_modules/a/index.js', text + 'changed');
    assert.throws(() => collectNotices(root, supplement), /hash mismatch/);
});

test('supplements reject duplicate entries, traversal and invalid line ranges', t => {
    const {root, put} = fixture(t, {'node_modules/a': {version: '1'}});
    put('node_modules/a/package.json', {name: 'a', version: '1'});
    put('node_modules/a/index.js', 'notice\n');
    const entry = {location: 'node_modules/a', version: '1', license: 'MIT', notices: [
        {file: 'index.js', startLine: 1, endLine: 1,
            sha256: crypto.createHash('sha256').update('notice\n').digest('hex')}]};
    assert.throws(() => collectNotices(root, [entry, entry]), /Duplicate/);
    assert.throws(() => collectNotices(root, [{...entry, notices: [{...entry.notices[0], file: '../../package-lock.json'}]}]), /escapes/);
    assert.throws(() => collectNotices(root, [{...entry, notices: [{...entry.notices[0], endLine: 999}]}]), /line range/);
});

test('upstream evidence stays offline and requires a pinned revision, integrity, manifest and notice hash', t => {
    const {root, put} = fixture(t, {'node_modules/a': {version: '1', integrity: 'sha512-example'}});
    const manifest = JSON.stringify({name: 'a', version: '1'});
    put('node_modules/a/package.json', manifest);
    const hash = value => crypto.createHash('sha256').update(value).digest('hex');
    const revision = 'a'.repeat(40);
    const upstream = {url: `https://raw.githubusercontent.com/owner/repo/${revision}/LICENSE`,
        revision, text: 'Copyright A\nPermission text\n', sha256: hash('Copyright A\nPermission text\n')};
    const entry = {location: 'node_modules/a', version: '1', license: 'MIT', integrity: 'sha512-example',
        packageManifestSha256: hash(manifest), notices: [{upstream}]};
    assert.equal(collectNotices(root, [entry]).packages[0].notices[0].text, upstream.text);
    assert.throws(() => collectNotices(root, [{...entry, integrity: 'different'}]), /evidence mismatch/);
    assert.throws(() => collectNotices(root, [{...entry, packageManifestSha256: 'wrong'}]), /evidence mismatch/);
    for (const changes of [{sha256: 'wrong'}, {text: ''}, {text: 'Changed'},
        {url: 'https://raw.githubusercontent.com/owner/repo/main/LICENSE'},
        {url: `https://raw.githubusercontent.com/owner/repo/main/${revision}/LICENSE`},
        {url: `${upstream.url}?ref=main`},
        {url: `https://example.com/owner/repo/${revision}/LICENSE`}]) {
        assert.throws(() => collectNotices(root, [{...entry, notices: [{upstream: {...upstream, ...changes}}]}]));
    }
});

test('collects scoped and nested versions separately, preserving notice text and legacy declarations', t => {
    const {root, put} = fixture(t, {'': {}, 'node_modules/@scope/a': {version: '1'},
        'node_modules/a/node_modules/b': {version: '2', dev: true}});
    put('node_modules/@scope/a/package.json', {name: '@scope/a', version: '1', licenses: [{type: 'MIT'}]});
    put('node_modules/@scope/a/LICENSE', 'Copyright A\r\nPermission text\r\n');
    put('node_modules/a/node_modules/b/package.json', {name: 'b', version: '2', license: 'BSD-2-Clause'});
    put('node_modules/a/node_modules/b/LICENSES/BSD.txt', 'Different notice');
    put('node_modules/a/node_modules/b/OFL.txt', 'Font licence');
    const report = collectNotices(root);
    assert.equal(report.summary.packages, 2);
    assert.equal(report.summary.noticeFiles, 3);
    assert.equal(report.summary.packagesNeedingReview, 0);
    assert.equal(report.packages[0].notices[0].text, 'Copyright A\r\nPermission text\r\n');
    assert.equal(report.packages[0].notices[0].sha256.length, 64);
    assert.match(renderText(report), /Different notice/);
    assert.deepEqual(collectNotices(root), report);
});

test('missing notices, undeclared licences and version differences remain explicit issues', t => {
    const {root, put} = fixture(t, {'node_modules/a': {version: '1'}});
    put('node_modules/a/package.json', {name: 'a', version: '2'});
    put('node_modules/a/README.md', 'Not silently treated as a licence');
    const row = collectNotices(root).packages[0];
    assert.equal(row.issues.length, 3);
    assert.equal(row.notices.length, 0);
});

test('absent optional packages stay in the inventory', t => {
    const {root} = fixture(t, {'node_modules/platform-only': {version: '1', optional: true}});
    const row = collectNotices(root).packages[0];
    assert.equal(row.optional, true);
    assert.match(row.issues[0], /Not installed/);
});

test('lockfile traversal is rejected before reading outside the package tree', t => {
    const {root} = fixture(t, {'node_modules/../../outside': {version: '1'}});
    assert.match(collectNotices(root).packages[0].issues[0], /outside node_modules/);
});

test('binary notices are hashed but never misrepresented as readable licence text', t => {
    const {root, put} = fixture(t, {'node_modules/a': {version: '1'}});
    put('node_modules/a/package.json', {name: 'a', version: '1', license: 'MIT'});
    put('node_modules/a/LICENSE.bin', Buffer.from([0, 1, 2]));
    const row = collectNotices(root).packages[0];
    assert.equal(row.notices[0].text, undefined);
    assert.match(row.issues[0], /Non-text/);
});

test('unsupported lockfiles fail rather than emitting an empty clearance-looking report', t => {
    const {root, put} = fixture(t, {});
    put('package-lock.json', {lockfileVersion: 1, dependencies: {a: {version: '1'}}});
    assert.throws(() => collectNotices(root), /v2\/v3/);
});

test('non-UTF-8 copyright names are flagged rather than silently corrupted', t => {
    const {root, put} = fixture(t, {'node_modules/font': {version: '1'}});
    put('node_modules/font/package.json', {name: 'font', version: '1', license: 'OFL-1.1'});
    put('node_modules/font/OFL.txt', Buffer.from([0x4d, 0xe3]));
    const row = collectNotices(root).packages[0];
    assert.equal(row.notices[0].text, undefined);
    assert.match(row.issues[0], /Non-UTF-8/);
});
