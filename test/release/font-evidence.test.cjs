const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const root = path.resolve(__dirname, '../..');
const rows = require('../../docs/release/font-evidence.json');
const directory = 'src/lib/tw-scratch-render-fonts';

test('font evidence covers every current local font and matches its exact bytes', () => {
    const files = fs.readdirSync(path.join(root, directory)).filter(f => f.endsWith('.woff2')).sort();
    assert.deepEqual(rows.map(r => path.posix.basename(r.file)).sort(), files);
    assert.equal(new Set(rows.map(r => r.file)).size, files.length);
    for (const row of rows) {
        assert.equal(path.posix.dirname(row.file), directory);
        const hash = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, row.file))).digest('hex');
        assert.equal(hash, row.sha256, `${row.file}: rerun the font audit after changes`);
        assert.ok(row.names['0']?.length, `${row.file}: copyright attribution missing`);
        assert.ok(row.names['13']?.length || row.names['14']?.length, `${row.file}: licence evidence missing`);
    }
});

test('pixel-font licence and inherited Scratch Savers modification attribution remain explicit', () => {
    const pixel = rows.find(r => r.file.endsWith('/Grand9K-Pixel.woff2'));
    assert.deepEqual(pixel.names['14'], ['http://creativecommons.org/licenses/by-sa/3.0/']);
    const savers = rows.find(r => r.file.endsWith('/ScratchSavers_b2.woff2'));
    assert.match(savers.names['0'].join('\n'), /2024 valadaptive; modified/);
    assert.match(savers.names['13'].join('\n'), /Open Font License, Version 1.1/);
});
