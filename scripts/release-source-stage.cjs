// Local reviewed-snapshot preparation. Never creates a GitHub repository, tags a
// checkout, uploads, cleans directories or includes Git history/working changes.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {execFileSync} = require('child_process');
const JSZip = require('@turbowarp/jszip');

const digest = (data, algorithm = 'sha256') => crypto.createHash(algorithm).update(data).digest('hex');
const checkPath = name => {
    const parts = name.split('/');
    if (!name || path.isAbsolute(name) || name.includes('\\') || name.includes(':') ||
        parts.some(p => !p || p === '..' || p === '.' ||
            ['.git', '.tmp', 'node_modules', '.local-data'].includes(p))) {
        throw new Error(`Unreviewed or unsafe archive path: ${name}`);
    }
};
const parseTree = text => text.split('\0').filter(Boolean).map(line => {
    const match = /^(\d+) (\w+) ([a-f0-9]+)\t([\s\S]+)$/.exec(line);
    if (!match) throw new Error('Malformed git tree');
    const [, mode, type, oid, name] = match;
    checkPath(name);
    if (type !== 'blob' || !['100644', '100755'].includes(mode)) {
        throw new Error(`Submodule/symlink needs separate review: ${name}`);
    }
    if (![40, 64].includes(oid.length)) throw new Error('Unknown Git object hash');
    return {path: name, mode, gitObject: oid};
});

async function stage (repository, revision, newDirectory) {
    if (!/^[a-f0-9]{40}$/.test(revision)) throw new Error('An explicit full commit SHA is required');
    const root = fs.realpathSync(repository);
    const output = path.resolve(newDirectory);
    if (fs.existsSync(output)) throw new Error('Output must be a new directory; refusing to overwrite');
    const git = (args, input) => execFileSync('git', ['-c', `safe.directory=${root}`, '-C', root, ...args],
        {input, maxBuffer: 256 * 1024 * 1024, windowsHide: true});
    const commit = git(['rev-parse', `${revision}^{commit}`]).toString().trim();
    if (commit !== revision) throw new Error('Revision did not resolve exactly');
    const rows = parseTree(git(['ls-tree', '-rz', '--full-tree', revision]).toString('utf8'));
    if (!rows.length) throw new Error('Refusing an empty source snapshot');
    // git archive applies export attributes and can convert line endings. Read
    // raw committed blobs instead, without checkout/smudge filters or Git history.
    const batch = git(['cat-file', '--batch'], rows.map(row => row.gitObject).join('\n') + '\n');
    const date = new Date(git(['show', '-s', '--format=%cI', revision]).toString().trim());
    const zip = new JSZip();
    let cursor = 0;
    for (const row of rows) {
        const end = batch.indexOf(10, cursor);
        const header = batch.subarray(cursor, end).toString('ascii').split(' ');
        if (end < cursor || header[0] !== row.gitObject || header[1] !== 'blob' || !/^\d+$/.test(header[2])) {
            throw new Error('Unexpected Git batch response');
        }
        const size = Number(header[2]);
        const bytes = batch.subarray(end + 1, end + 1 + size);
        cursor = end + 1 + size;
        if (bytes.length !== size || batch[cursor++] !== 10) throw new Error('Truncated Git blob');
        const gitBytes = Buffer.concat([Buffer.from(`blob ${bytes.length}\0`), bytes]);
        if (digest(gitBytes, row.gitObject.length === 40 ? 'sha1' : 'sha256') !== row.gitObject) {
            throw new Error(`Archive content differs from commit: ${row.path}`);
        }
        row.bytes = bytes.length;
        row.sha256 = digest(bytes);
        zip.file(row.path, bytes, {date, unixPermissions: parseInt(row.mode, 8)});
        if (/\.(sb3|sprite3|wav|mp3|mp4|csv|xlsx|pem|key|pfx|zip)$/i.test(row.path) ||
            /(^|\/)(\.env[^/]*|.*credentials.*|.*secret.*)$/i.test(row.path) || /^(build|dist)\//.test(row.path)) {
            row.review = 'Review fixture/media/credential-like path before publication; do not delete automatically';
        }
    }
    if (cursor !== batch.length) throw new Error('Unconsumed Git batch output');
    const buffer = await zip.generateAsync({type: 'nodebuffer', platform: 'UNIX',
        compression: 'DEFLATE', compressionOptions: {level: 6}});
    const verified = await JSZip.loadAsync(buffer, {checkCRC32: true});
    if (Object.values(verified.files).filter(f => !f.dir).length !== rows.length) throw new Error('ZIP entry count mismatch');
    for (const row of rows) {
        const bytes = await verified.file(row.path).async('nodebuffer');
        if (digest(bytes) !== row.sha256) throw new Error(`ZIP verification failed: ${row.path}`);
    }
    const manifest = {scope: 'Local source snapshot candidate, NOT approved for publication or complete dependency source delivery',
        revision, archive: 'source.zip', archiveSha256: digest(buffer), archiveBytes: buffer.length,
        fileCount: rows.length, workingTreeIncluded: false, gitHistoryIncluded: false, files: rows};
    fs.mkdirSync(output); // Atomic claim; parent must already exist. No recursive deletion.
    fs.writeFileSync(path.join(output, 'source.zip'), buffer, {flag: 'wx'});
    fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2), {flag: 'wx'});
    return {output, revision, archiveSha256: manifest.archiveSha256, archiveBytes: buffer.length,
        fileCount: rows.length, reviewPaths: rows.filter(r => r.review).map(r => r.path)};
}

if (require.main === module) {
    const args = process.argv.slice(2);
    if (args.length !== 3) throw new Error('Usage: node release-source-stage.cjs repository full-commit new-output-directory');
    stage(...args).then(result => console.log(JSON.stringify(result, null, 2)))
        .catch(error => {console.error(error.message); process.exitCode = 1;});
}
module.exports = {stage, checkPath, parseTree};
