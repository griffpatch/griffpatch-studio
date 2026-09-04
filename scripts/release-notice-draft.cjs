// Offline review artifacts only. This is deliberately not a publish command.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {collectNotices} = require('./release-notices.cjs');
const {auditBundle} = require('./release-bundle-audit.cjs');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const json = value => JSON.stringify(value, null, 2) + '\n';

const sourcePlan = (lock, represented) => {
    const selected = new Set(represented.map(p => p.location));
    return Object.entries(lock.packages).filter(([location]) => location).map(([location, p]) => ({
        location, version: p.version, resolved: p.resolved || null, integrity: p.integrity || null,
        developmentOnly: Boolean(p.dev), representedInDirectBundleMap: selected.has(location),
        status: 'Planning row only; consult the separate verified acquisition manifests',
        review: /^(git\+|github:)/.test(p.resolved || '') ?
            'Acquire pinned repository source and required build inputs; confirm compiled dependencies separately' :
            'Verify locked package archive and identify original source/build inputs when package contains compiled files'
    }));
};

const renderDraft = (inventory, bundle, extra) => {
    const byLocation = new Map(inventory.packages.map(p => [p.location, p]));
    const lines = ['THIRD-PARTY NOTICES - LOCAL REVIEW DRAFT',
        'NOT APPROVED FOR PUBLICATION. Missing notices and source-delivery reviews remain.',
        `Bundle: ${bundle.buildHash}`, `Lockfile SHA256: ${inventory.lockfileSha256}`,
        'The direct module map omits some embedded libraries, copied assets and worker compilations.',
        'Absence from this selection is NOT permission to omit a component from the final distribution.', ''];
    for (const row of bundle.packages) {
        const p = byLocation.get(row.location);
        if (!p) throw new Error(`Missing inventory package: ${row.location}`);
        lines.push(`===== ${p.name} ${p.version} =====`, `Location: ${p.location}`,
            `Declared licence: ${JSON.stringify(p.reviewedLicense || p.license)}`);
        for (const issue of p.issues) lines.push(`OPEN REVIEW: ${issue}`);
        for (const n of p.notices) {
            lines.push(`Source: ${n.path}`, `SHA256: ${n.sha256}`, n.text || '[Original non-text notice requires review]');
        }
        lines.push('');
    }
    for (const n of extra) {
        if (typeof n.text !== 'string' || hash(Buffer.from(n.text)) !== n.sha256) {
            throw new Error('Supplementary text hash mismatch');
        }
        lines.push(`===== ${n.label} =====`, n.status, `Source: ${n.url}`, `SHA256: ${n.sha256}`, n.text, '');
    }
    return lines.join('\n');
};

const checkFile = (root, relative, expected) => {
    const absolute = fs.realpathSync(path.resolve(root, relative));
    const rel = path.relative(root, absolute);
    if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) throw new Error('Evidence path escapes root');
    if (hash(fs.readFileSync(absolute)) !== expected) throw new Error(`Evidence file hash mismatch: ${relative}`);
};

function stageDraft(root, statsPath, output) {
    root = fs.realpathSync(root);
    output = path.resolve(output);
    if (fs.existsSync(output)) throw new Error('Output must be new; refusing overwrite');
    const read = relative => JSON.parse(fs.readFileSync(path.join(root, relative)));
    const inventory = collectNotices(root, read('docs/release/notice-supplement.json'));
    const statsBytes = fs.readFileSync(statsPath);
    const bundle = auditBundle(JSON.parse(statsBytes), inventory);
    bundle.statsSha256 = hash(statsBytes);
    const vendored = read('docs/release/vendored-notice-evidence.json');
    const later = read('docs/release/later-notice-evidence.json');
    const unicode = read('docs/release/unicode-data-evidence.json');
    const fonts = read('docs/release/font-evidence.json');
    const extra = [];
    for (const a of vendored.assets) {
        checkFile(root, a.file, a.sha256);
        for (const n of a.notices) extra.push({...n, label: `${n.name} ${n.version || ''} (${a.file})`,
            status: n.embeddedHeader ? `Also preserve embedded header: ${n.embeddedHeader}` : 'Vendored notice evidence'});
    }
    for (const e of later.entries) {
        checkFile(root, `node_modules/${e.name}/package.json`, e.packageManifestSha256);
        extra.push({...e.notice, label: `${e.name} ${e.version} - LATER UPSTREAM EVIDENCE`, status: e.status});
    }
    for (const f of fonts) checkFile(root, f.file, f.sha256);
    const gaps = bundle.packages.filter(p => p.issues.length).map(p => ({name:p.name,version:p.version,issues:p.issues}));
    const files = {
        'THIRD-PARTY-NOTICES-DRAFT.txt': renderDraft(inventory, bundle, extra),
        'all-dependencies.json': json(inventory),
        'bundle-map.json': json(bundle),
        'dependency-source-plan.json': json(sourcePlan(read('package-lock.json'), bundle.packages)),
        'font-evidence.json': json(fonts),
        'unicode-data-evidence.json': json(unicode),
        'vendored-notice-evidence.json': json(vendored),
        'later-notice-evidence.json': json(later),
        'REVIEW-STATUS.json': json({publishable:false, scope:'Local review kit, not legal clearance or complete source delivery',
            buildHash:bundle.buildHash,lockfileSha256:inventory.lockfileSha256,statsSha256:bundle.statsSha256,
            unresolvedDirectPackages:gaps, otherReviews:['Later notice applicability',
                'Fonts and copied asset rights/full notices', 'Precompiled libraries and worker contents',
                'Actual corresponding dependency source acquisition', 'Source snapshot content suitability']})
    };
    // Retain exact original notice texts and build instructions, not retyped terms.
    for (const relative of ['LICENSE', 'docs/release/CLEAN-BUILD.md', 'docs/release/FONT-NOTICES.md',
        'docs/release/VENDORED-NOTICES.md', 'docs/release/SOURCE-SNAPSHOTS.md']) {
        files[path.basename(relative)] = fs.readFileSync(path.join(root, relative));
    }
    fs.mkdirSync(output);
    const manifest = [];
    for (const [name, content] of Object.entries(files)) {
        const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content);
        fs.writeFileSync(path.join(output, name), bytes, {flag:'wx'});
        manifest.push({file:name,bytes:bytes.length,sha256:hash(bytes)});
    }
    fs.writeFileSync(path.join(output, 'manifest.json'), json(manifest), {flag:'wx'});
    return {output,files:manifest.length,representedPackages:bundle.summary.representedPackages,
        unresolvedDirectPackages:gaps.length,publishable:false};
}

// Public-readable attribution, separate from the scanner's internal review kit.
// Include the broader dependency set so workers/embedded builds aren't excluded
// merely because the direct webpack module map doesn't name them.
function publicNotices(root) {
    root = fs.realpathSync(root);
    const read = relative => JSON.parse(fs.readFileSync(path.join(root, relative)));
    const inventory = collectNotices(root, read('docs/release/notice-supplement.json'));
    const text = relative => fs.readFileSync(path.join(root, relative), 'utf8');
    const lines = ['GRIFFPATCH STUDIO - THIRD-PARTY NOTICES',
        'This collection retains notices for the editor and its dependency/build tool distribution.',
        'Not every listed package is loaded by the browser. Individual components retain their own licences.',
        'Package declarations and author metadata are identified as such; they are not new copyright grants.',
        `Lockfile SHA256: ${inventory.lockfileSha256}`, '',
        '=== Griffpatch Studio and upstream GUI ===', text('FORK-NOTICE.md'),
        '=== GNU General Public License version 3 ===', text('LICENSE'),
        '=== Scratch Addons and TurboWarp adaptation ===', text('src/addons/README.md'),
        text('src/addons/pull.js').split('*/')[0] + '*/',
        'Local Finder and keyboard-authoring adaptations are included in the GUI source under its GPL-3.0 licence.', ''];
    for (const p of inventory.packages) {
        lines.push(`===== ${p.name || p.location} ${p.version || p.lockedVersion || ''} =====`,
            `Package: ${p.location}`, `Declared licence: ${JSON.stringify(p.reviewedLicense || p.license || null)}`);
        const manifestPath = path.join(root, p.location, 'package.json');
        if (fs.existsSync(manifestPath)) {
            const manifest = JSON.parse(fs.readFileSync(manifestPath));
            if (manifest.author) lines.push(`Author (package metadata): ${JSON.stringify(manifest.author)}`);
            if (manifest.repository) lines.push(`Repository (package metadata): ${JSON.stringify(manifest.repository)}`);
        }
        if (!p.notices.length) lines.push('No standalone notice was included in this package; the declaration above is retained.',
            'Common MIT and Apache-2.0 terms are included below where those licences are declared.');
        for (const n of p.notices) {
            if (typeof n.text !== 'string') throw new Error(`Non-text notice needs separate inclusion: ${p.location}/${n.path}`);
            lines.push(`Notice source: ${n.path}`, n.text);
        }
        lines.push('');
    }
    const addNotice = n => {
        if (hash(Buffer.from(n.text)) !== n.sha256) throw new Error('Supplementary text hash mismatch');
        lines.push(`Source: ${n.url}`, n.text, '');
    };
    const vendored = read('docs/release/vendored-notice-evidence.json');
    for (const asset of vendored.assets) {
        checkFile(root, asset.file, asset.sha256);
        lines.push(`=== Copied library: ${asset.file} ===`);
        for (const n of asset.notices) {
            if (n.embeddedHeader) lines.push(n.embeddedHeader);
            addNotice(n);
        }
    }
    for (const entry of read('docs/release/later-notice-evidence.json').entries) {
        checkFile(root, `node_modules/${entry.name}/package.json`, entry.packageManifestSha256);
        lines.push(`=== ${entry.name}: additional upstream notice ===`,
            'The installed package declares MIT. This additional upstream notice was published later;',
            'its original date and wording are preserved, not presented as an original packaged file.');
        addNotice(entry.notice);
    }
    const mit = vendored.assets.flatMap(a => a.notices).find(n => n.name === 'tinycolor2');
    lines.push('=== Common MIT permission and warranty terms ===',
        'For the packages identified above as declaring MIT. Individual attributions remain above.');
    addNotice(mit);
    lines.push('=== Apache License 2.0: standard terms ===', text('node_modules/@ampproject/remapping/LICENSE'));
    for (const font of read('docs/release/font-evidence.json')) {
        checkFile(root, font.file, font.sha256);
        lines.push(`=== Font: ${font.file} ===`,
            'Embedded font metadata (original copyright, licence, reserved names and modification notices):');
        for (const [id, values] of Object.entries(font.names)) lines.push(`Name table ${id}:`, ...values);
        lines.push('Font source: https://github.com/TurboWarp/scratch-render-fonts/tree/7b6768fc6dfef6b343a06f992587b74807043961/src',
            'These WOFF2 files are retained unchanged from that dependency.', '');
    }
    lines.push('=== SIL Open Font License 1.1: terms for the OFL fonts ===',
        text('src/lib/tw-scratch-render-fonts/OFL.txt'),
        'The Londrina attribution in the retained upstream OFL file is not a substitute for each font attribution above.',
        '=== Grand9K Pixel ===',
        'CC BY-SA 3.0 Unported: https://creativecommons.org/licenses/by-sa/3.0/',
        'Full terms: https://creativecommons.org/licenses/by-sa/3.0/legalcode', '');
    const unicode = read('docs/release/unicode-data-evidence.json');
    lines.push('=== Unicode data ===');
    for (const table of unicode.tables) lines.push(table.input.url, table.input.header);
    addNotice(unicode.licence);
    return lines.join('\n');
}

if (require.main === module) {
    const args = process.argv.slice(2);
    if (args[0] === '--public' && args.length === 2) {
        process.stdout.write(publicNotices(args[1]));
        return;
    }
    if (args.length !== 3) throw new Error('Usage: release-notice-draft.cjs root stats.json new-output');
    console.log(JSON.stringify(stageDraft(...args), null, 2));
}
module.exports = {sourcePlan, renderDraft, checkFile, stageDraft, publicNotices};
