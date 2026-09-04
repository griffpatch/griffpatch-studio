// Read-only prioritisation, not proof of complete distribution or legal clearance.
const fs = require('fs');
const crypto = require('crypto');

const resourceName = name => (name || '').split('!').pop().replace(/\\/g, '/');
const packageLocation = name => {
    // Use webpack's resource name, never its loader/issuer chain. Scoped and
    // nested installations remain separate even when their package names match.
    const resource = resourceName(name).replace(/^\.\//, '');
    if (!resource.startsWith('node_modules/')) return null;
    const match = resource.match(/^(node_modules\/(?:.*\/node_modules\/)?(?:@[^/]+\/)?[^/? ]+)(?:\/|$)/);
    return match ? match[1] : null;
};

const auditBundle = (stats, inventory) => {
    if (!Array.isArray(stats.modules) || !Array.isArray(stats.chunks)) {
        throw new Error('Complete single-compilation webpack modules and chunks are required');
    }
    if ((stats.errors || []).length || stats.filteredModules > 0) {
        throw new Error('Failed or truncated webpack statistics cannot be audited');
    }
    const packages = new Map();
    const sourceModules = new Set();
    const opaqueBundles = new Set();
    const chunks = new Set(stats.chunks.map(c => c.id));
    const visit = (module, inherited = []) => {
        if (module.filteredModules > 0) throw new Error('Truncated nested modules cannot be audited');
        const emitted = (module.chunks || []).length ? module.chunks : inherited;
        if (emitted.some(id => chunks.has(id))) {
            const name = resourceName(module.name);
            const location = packageLocation(name);
            if (location) {
                if (!packages.has(location)) packages.set(location, new Set());
                packages.get(location).add(name);
                if (/\/(?:dist|build)\/|_compressed\.js/.test(name)) opaqueBundles.add(name);
            } else if (name.startsWith('./src/') || name.startsWith('./static/')) {
                sourceModules.add(name);
            }
        }
        // Concatenated modules inherit the emitted parent's chunks. This is
        // conservative: it does not claim each nested export survived minifying.
        for (const child of module.modules || []) visit(child, emitted);
    };
    stats.modules.forEach(m => visit(m));
    const byLocation = new Map(inventory.packages.map(p => [p.location, p]));
    const represented = [...packages].sort(([a], [b]) => a.localeCompare(b)).map(([location, modules]) => {
        const p = byLocation.get(location);
        return {location, name: p?.name, version: p?.version, license: p?.license,
            issues: p ? p.issues : ['Not in supplied lockfile inventory'], modules: [...modules].sort()};
    });
    return {
        scope: 'Packages represented in emitted webpack modules; not a complete shipped-component inventory',
        exclusions: ['Copy-plugin assets and remote resources require separate review',
            'Worker/loader child compilations require separate review',
            'Precompiled dependencies may contain other libraries invisible to this module graph',
            'Packages not represented here are NOT declared safe to omit from notices or source delivery'],
        buildHash: stats.hash, lockfileSha256: inventory.lockfileSha256,
        summary: {representedPackages: represented.length,
            representedPackagesWithIssues: represented.filter(p => p.issues.length).length},
        packages: represented, opaqueBundleCandidates: [...opaqueBundles].sort(),
        applicationAndVendoredModules: [...sourceModules].sort()
    };
};

if (require.main === module) {
    const [statsFile, inventoryFile, ...extra] = process.argv.slice(2);
    if (!statsFile || !inventoryFile || extra.length) {
        throw new Error('Usage: node scripts/release-bundle-audit.cjs stats.json inventory.json');
    }
    const bytes = fs.readFileSync(statsFile);
    const report = auditBundle(JSON.parse(bytes), JSON.parse(fs.readFileSync(inventoryFile)));
    report.statsSha256 = crypto.createHash('sha256').update(bytes).digest('hex');
    console.log(JSON.stringify(report, null, 2));
}
module.exports = {packageLocation, auditBundle};
