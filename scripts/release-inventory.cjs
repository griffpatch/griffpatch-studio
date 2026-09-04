// Read-only inventory of installed direct runtime dependencies. Redirect stdout
// to a release artifact if desired; no installation, upload or mutation occurs.
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const dependencies = Object.entries(manifest.dependencies).map(([name, requested]) => {
    const directory = path.join(root, 'node_modules', name);
    try {
        const installed = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'));
        return {name, requested, version: installed.version, license: installed.license || installed.licenses || null,
            repository: installed.repository || null,
            notices: fs.readdirSync(directory).filter(file => /^(licen[sc]e|copying|notice|authors)(\.|$)/i.test(file))};
    } catch (error) {
        return {name, requested, error: error.code || error.message};
    }
});
console.log(JSON.stringify({scope: 'Installed direct runtime dependencies only; not a clearance report', dependencies}, null, 2));
