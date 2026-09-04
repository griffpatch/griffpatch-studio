const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const root = path.resolve(__dirname, '../..');
const evidence = require('../../docs/release/unicode-data-evidence.json');
const hash = b => crypto.createHash('sha256').update(b).digest('hex');

test('Unicode provenance stays tied to the inspected generators, tables and original fixtures', () => {
    assert.equal(evidence.tables.length, 2);
    for (const row of evidence.tables) {
        assert.equal(hash(fs.readFileSync(path.join(root, row.generator.file))), row.generator.sha256);
        assert.equal(hash(fs.readFileSync(path.join(root, path.dirname(row.generator.file), 'classes.trie'))), row.installedSha256);
        assert.equal(row.codePointsCompared, 0x110000);
        assert.equal(row.mismatches, 0);
        assert.equal(row.byteIdentical, row.generatedSha256 === row.installedSha256);
        assert.ok(row.input.url.includes(`/Public/${row.unicodeVersion}/`));
    }
    for (const row of evidence.fixtures) {
        const bytes = fs.readFileSync(path.join(root, row.local));
        assert.equal(hash(bytes), row.sha256);
        assert.ok(bytes.toString('utf8').startsWith(row.header));
        assert.equal(row.matchesLocal, true);
    }
});

test('Unicode keeps original date-specific headers alongside the retrieved current notice', () => {
    assert.equal(hash(evidence.licence.text), evidence.licence.sha256);
    assert.match(evidence.licence.text, /UNICODE LICENSE V3/);
    assert.match(evidence.fixtures[0].header, /1991-2015 Unicode/);
    assert.match(evidence.fixtures[1].header, /1991-2014 Unicode/);
});
