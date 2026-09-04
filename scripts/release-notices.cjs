// Conservative local evidence collector. It does not decide licence compatibility,
// prove which packages webpack ships, or publish anything. Keep all notices intact.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {TextDecoder} = require('util');

const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const inside = (root, file) => {
    const relative = path.relative(root, file);
    return relative === '' || (!relative.startsWith(`..${path.sep}`) &&
        relative !== '..' && !path.isAbsolute(relative));
};
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const noticeName = /^(licen[sc]es?|copying|notices?|copyright|authors|ofl|unlicense|patents|third[._-]party)([._-]|$)/i;

const applySupplement = (root, packages, supplement) => {
    const seen = new Set();
    for (const entry of supplement) {
        if (seen.has(entry.location)) throw new Error(`Duplicate supplement: ${entry.location}`);
        seen.add(entry.location);
        const row = packages.find(p => p.location === entry.location);
        if (!row || row.version !== entry.version || row.lockedVersion !== entry.version) {
            throw new Error(`Supplement version/location mismatch: ${entry.location}`);
        }
        const directory = path.resolve(root, entry.location);
        const installedRoot = fs.realpathSync(path.join(root, 'node_modules'));
        if (!inside(installedRoot, directory) || !inside(installedRoot, fs.realpathSync(directory))) {
            throw new Error('Supplement package escapes installed tree');
        }
        if (!entry.notices?.length) throw new Error('Supplement requires pinned notice evidence');
        for (const notice of entry.notices) {
            if (notice.upstream) {
                const source = notice.upstream;
                const url = new URL(source.url);
                const segments = url.pathname.split('/');
                if (url.protocol !== 'https:' || url.hostname !== 'raw.githubusercontent.com' ||
                    url.username || url.password || url.port || url.search || url.hash ||
                    !/^[a-f0-9]{40}$/.test(source.revision) || segments[3] !== source.revision ||
                    segments.length < 5 || segments.slice(1).some(segment => !segment)) {
                    throw new Error('Upstream notice requires a pinned GitHub revision');
                }
                if (!entry.integrity || row.integrity !== entry.integrity ||
                    digest(fs.readFileSync(path.join(directory, 'package.json'))) !== entry.packageManifestSha256) {
                    throw new Error('Upstream notice package evidence mismatch');
                }
                if (typeof source.text !== 'string' || !source.text.trim() || source.text.includes('\0') ||
                    digest(Buffer.from(source.text)) !== source.sha256) {
                    throw new Error('Upstream notice text hash mismatch');
                }
                row.notices.push({path: source.url, revision: source.revision,
                    sha256: source.sha256, text: source.text});
                continue;
            }
            const file = path.resolve(directory, notice.file);
            if (!inside(directory, file) || !inside(directory, fs.realpathSync(file))) {
                throw new Error('Supplement notice escapes package');
            }
            const bytes = fs.readFileSync(file);
            if (digest(bytes) !== notice.sha256) throw new Error(`Supplement hash mismatch: ${file}`);
            const lines = new TextDecoder('utf-8', {fatal: true, ignoreBOM: true}).decode(bytes).split(/(?<=\n)/);
            if (!Number.isInteger(notice.startLine) || !Number.isInteger(notice.endLine) ||
                notice.startLine < 1 || notice.endLine < notice.startLine || notice.endLine > lines.length) {
                throw new Error(`Invalid supplement line range: ${file}`);
            }
            const text = lines.slice(notice.startLine - 1, notice.endLine).join('');
            row.notices.push({path: `${notice.file}:${notice.startLine}-${notice.endLine}`,
                sourceSha256: notice.sha256, sha256: digest(Buffer.from(text)), text});
        }
        row.reviewedLicense = entry.license;
        row.reviewNote = entry.note;
        // Resolve only the two evidence gaps this manifest can actually address.
        row.issues = row.issues.filter(issue => issue !== 'No conventional notice file; inspect README/source headers' &&
            !(entry.license && issue === 'No declared licence; inspect source headers/upstream'));
    }
};

const collectNotices = (root, supplement = []) => {
    root = fs.realpathSync(root);
    const lockBytes = fs.readFileSync(path.join(root, 'package-lock.json'));
    const lock = JSON.parse(lockBytes);
    if (![2, 3].includes(lock.lockfileVersion) || !lock.packages) {
        throw new Error('A package-lock v2/v3 packages map is required');
    }
    const installedRoot = fs.realpathSync(path.join(root, 'node_modules'));
    const packages = Object.keys(lock.packages).filter(Boolean).sort().map(location => {
        const locked = lock.packages[location];
        const row = {location, lockedVersion: locked.version || null,
            resolved: locked.resolved || null, integrity: locked.integrity || null,
            developmentOnly: Boolean(locked.dev), optional: Boolean(locked.optional),
            notices: [], issues: []};
        try {
            const directory = path.resolve(root, location);
            if (!location.startsWith('node_modules/') || !inside(installedRoot, directory)) {
                throw new Error('Package location is outside node_modules');
            }
            const actualDirectory = fs.realpathSync(directory);
            if (!inside(installedRoot, actualDirectory)) throw new Error('External package link requires review');
            const manifestFile = path.join(actualDirectory, 'package.json');
            if (!inside(actualDirectory, fs.realpathSync(manifestFile))) {
                throw new Error('External package manifest requires review');
            }
            const installed = readJson(manifestFile);
            row.name = installed.name || location.split('node_modules/').pop();
            row.version = installed.version || null;
            row.license = installed.license || installed.licenses || null;
            if (row.version !== row.lockedVersion) row.issues.push('Installed/locked version differs');
            if (!row.license) row.issues.push('No declared licence; inspect source headers/upstream');
            const visit = (directoryToRead, withinNoticeDirectory = false) => {
                for (const entry of fs.readdirSync(directoryToRead, {withFileTypes: true}).sort(
                    (a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0
                )) {
                    if (!withinNoticeDirectory && !noticeName.test(entry.name)) continue;
                    const file = path.join(directoryToRead, entry.name);
                    if (entry.isSymbolicLink()) {
                        row.issues.push(`Notice symlink requires review: ${path.relative(actualDirectory, file)}`);
                    } else if (entry.isDirectory()) {
                        visit(file, true);
                    } else if (entry.isFile()) {
                        const bytes = fs.readFileSync(file);
                        const notice = {path: path.relative(actualDirectory, file).split(path.sep).join('/'),
                            sha256: digest(bytes)};
                        if (bytes.includes(0)) {
                            row.issues.push(`Non-text notice requires review: ${notice.path}`);
                        } else {
                            try {
                                notice.text = new TextDecoder('utf-8', {fatal: true, ignoreBOM: true}).decode(bytes);
                            } catch (error) {
                                row.issues.push(`Non-UTF-8 notice requires original-byte review: ${notice.path}`);
                            }
                        }
                        row.notices.push(notice);
                    }
                }
            };
            visit(actualDirectory);
            if (!row.notices.length) row.issues.push('No conventional notice file; inspect README/source headers');
        } catch (error) {
            row.issues.push(error.code === 'ENOENT' ? 'Not installed (check platform/optional status)' : error.message);
        }
        return row;
    });
    applySupplement(root, packages, supplement);
    return {
        scope: 'All locked installed packages, including build tools; NOT a shipped-bundle or legal clearance report',
        excluded: 'Application/vendored source, artwork, remote extensions and nonconventional source-header notices need separate review',
        lockfileSha256: digest(lockBytes),
        summary: {packages: packages.length, developmentOnly: packages.filter(p => p.developmentOnly).length,
            noticeFiles: packages.reduce((total, p) => total + p.notices.length, 0),
            packagesNeedingReview: packages.filter(p => p.issues.length).length},
        packages
    };
};

const renderText = report => [
    'THIRD-PARTY NOTICE EVIDENCE - DRAFT, NOT RELEASE CLEARANCE', report.scope, report.excluded,
    `Lockfile SHA256: ${report.lockfileSha256}`, '',
    ...report.packages.flatMap(p => [
        `===== ${p.name || p.location} ${p.version || p.lockedVersion || ''} =====`,
        `Installed location: ${p.location}`, `Declared licence: ${JSON.stringify(p.license || null)}`,
        ...(p.reviewedLicense ? [`Reviewed licence evidence: ${p.reviewedLicense}`, p.reviewNote] : []),
        `Review notes: ${p.issues.join('; ') || 'None from this limited scanner'}`, '',
        ...p.notices.flatMap(n => [`--- ${n.path} (SHA256 ${n.sha256}) ---`,
            n.text === undefined ? '[Notice needs encoding/content review: preserve the original file]' : n.text, ''])
    ])
].join('\n');

if (require.main === module) {
    const args = process.argv.slice(2);
    if (args.some(arg => !arg.startsWith('--root=') && !arg.startsWith('--supplement=') && arg !== '--text')) {
        throw new Error('Usage: node scripts/release-notices.cjs [--root=checkout] [--supplement=reviewed.json] [--text]');
    }
    const rootArg = args.find(arg => arg.startsWith('--root='));
    const supplementArg = args.find(arg => arg.startsWith('--supplement='));
    const report = collectNotices(rootArg ? rootArg.slice(7) : path.resolve(__dirname, '..'),
        supplementArg ? readJson(supplementArg.slice(13)) : []);
    console.log(args.includes('--text') ? renderText(report) : JSON.stringify(report, null, 2));
}
module.exports = {collectNotices, renderText};
