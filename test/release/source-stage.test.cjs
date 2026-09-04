const {test} = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const {execFileSync} = require('child_process');
const JSZip = require('@turbowarp/jszip');
const {stage, checkPath, parseTree} = require('../../scripts/release-source-stage.cjs');

test('source candidates refuse cache/history, traversal and platform-absolute paths', () => {
    for (const name of ['../file', 'src/../../file', '/file', 'C:/file', 'src\\file',
        '.git/config', '.tmp/project.sb3', 'node_modules/a/index.js', 'src/.local-data/x', 'src//x']) {
        assert.throws(() => checkPath(name));
    }
    for (const name of ['src/editor.js', '.gitignore', 'docs/build.md', 'test/fixtures/project1.sb3', 'build/gen_blocks.js']) {
        assert.doesNotThrow(() => checkPath(name));
    }
});

test('source tree retains executable mode and unusual filenames, rejects links/submodules', () => {
    const hash = 'a'.repeat(40);
    assert.deepEqual(parseTree(`100755 blob ${hash}\tscripts/with space.js\0`),
        [{path: 'scripts/with space.js', mode: '100755', gitObject: hash}]);
    for (const row of [`120000 blob ${hash}\tlink\0`, `160000 commit ${hash}\tsubmodule\0`, 'bad\0']) {
        assert.throws(() => parseTree(row));
    }
});

test('staging cannot accept a branch name or overwrite an existing directory', async () => {
    const root = path.resolve(__dirname, '../..');
    await assert.rejects(stage(root, 'HEAD', root), /explicit full commit/);
    await assert.rejects(stage(root, 'a'.repeat(40), root), /refusing to overwrite/);
});

test('real Git snapshot preserves committed bytes, ignores dirty work and retains build source', async t => {
    const temporary = fs.realpathSync(os.tmpdir());
    const directory = fs.mkdtempSync(path.join(temporary, 'griffpatch-source-stage-test-'));
    t.after(() => {
        // Only this test's newly allocated fixture may be removed.
        assert.equal(path.dirname(directory), temporary);
        assert.ok(path.basename(directory).startsWith('griffpatch-source-stage-test-'));
        fs.rmSync(directory, {recursive: true, force: true});
    });
    const repository = path.join(directory, 'repo');
    fs.mkdirSync(repository);
    const git = (...args) => execFileSync('git', ['-c', 'user.name=Source Test',
        '-c', 'user.email=test@example.invalid', '-c', `safe.directory=${repository}`, '-C', repository, ...args],
    {windowsHide: true});
    git('init', '-q');
    git('config', 'core.autocrlf', 'true');
    fs.mkdirSync(path.join(repository, 'build'));
    fs.writeFileSync(path.join(repository, '.gitattributes'), '* text=auto\nkept.txt export-ignore\n');
    fs.writeFileSync(path.join(repository, 'kept.txt'), 'original\n');
    fs.writeFileSync(path.join(repository, 'build', 'generator.js'), 'source\n');
    fs.writeFileSync(path.join(repository, 'binary.bin'), Buffer.from([0, 255, 13, 10, 2]));
    git('add', '.');
    git('commit', '-qm', 'fixture');
    const revision = git('rev-parse', 'HEAD').toString().trim();
    fs.writeFileSync(path.join(repository, 'kept.txt'), 'uncommitted change');
    fs.writeFileSync(path.join(repository, 'private-untracked.txt'), 'not for publication');
    const output = path.join(directory, 'candidate');
    const result = await stage(repository, revision, output);
    const archive = await JSZip.loadAsync(fs.readFileSync(path.join(output, 'source.zip')));
    assert.equal(result.fileCount, 4);
    assert.equal(await archive.file('kept.txt').async('string'), 'original\n');
    assert.equal(await archive.file('build/generator.js').async('string'), 'source\n');
    assert.deepEqual(await archive.file('binary.bin').async('nodebuffer'), Buffer.from([0, 255, 13, 10, 2]));
    assert.equal(archive.file('private-untracked.txt'), null);
    assert.equal(archive.file('.git/config'), null);
    assert.deepEqual(result.reviewPaths, ['build/generator.js']);
    assert.equal(fs.readFileSync(path.join(repository, 'kept.txt'), 'utf8'), 'uncommitted change');
    await assert.rejects(stage(repository, revision, output), /refusing to overwrite/);
});
