const {test} = require('node:test');
const assert = require('node:assert/strict');
const {packageLocation, auditBundle} = require('../../scripts/release-bundle-audit.cjs');
const inventory = {lockfileSha256: 'lock', packages: [
    {location: 'node_modules/a', name: 'a', version: '1', issues: []},
    {location: 'node_modules/a/node_modules/@s/b', name: '@s/b', version: '2', issues: ['Review']}
]};
const stats = modules => ({hash: 'build', modules, chunks: [{id: 0}], errors: []});

test('keeps nested/scoped locations and excludes source and loader chains', () => {
    assert.equal(packageLocation('./node_modules/a/node_modules/@s/b/index.js'), 'node_modules/a/node_modules/@s/b');
    assert.equal(packageLocation('.\\node_modules\\a\\index.js'), 'node_modules/a');
    assert.equal(packageLocation('./src/module.js'), null);
    assert.equal(packageLocation('babel-loader!./src/module.js'), null);
    assert.equal(packageLocation('./node_modules/css-loader??ref!./node_modules/a/style.css'), 'node_modules/a');
    assert.equal(packageLocation('./node_modules/file-loader/index.js!./src/a.svg'), null);
});
test('includes concatenated modules, skips nonemitted ones and deduplicates packages', () => {
    const report = auditBundle(stats([
        {name: './src/main.js + 2 modules', chunks: [0], modules: [
            {name: './node_modules/a/index.js', chunks: []},
            {name: './node_modules/a/node_modules/@s/b/index.js'}]},
        {name: './node_modules/a/other.js', chunks: [0]},
        {name: './node_modules/unused/index.js', chunks: []}
    ]), inventory);
    assert.deepEqual(report.summary, {representedPackages: 2, representedPackagesWithIssues: 1});
    assert.equal(report.packages[0].modules.length, 2);
});
test('does not infer membership from an issuer or loader', () => {
    const report = auditBundle(stats([{name: './src/a.js', chunks: [0],
        identifier: 'node_modules/babel-loader/index.js!./src/a.js', issuerName: './node_modules/a/index.js'}]), inventory);
    assert.equal(report.packages.length, 0);
});
test('missing inventory packages and opaque bundles remain explicit', () => {
    const report = auditBundle(stats([{name: './node_modules/other/dist/web.js', chunks: [0]}]), inventory);
    assert.match(report.packages[0].issues[0], /Not in/);
    assert.equal(report.opaqueBundleCandidates.length, 1);
});
test('rejects incomplete, failed and truncated statistics', () => {
    for (const s of [{}, {...stats([]), errors: ['failure']}, {...stats([]), filteredModules: 4},
        stats([{name: './src/a.js', chunks: [0], filteredModules: 2}])]) {
        assert.throws(() => auditBundle(s, inventory));
    }
});
