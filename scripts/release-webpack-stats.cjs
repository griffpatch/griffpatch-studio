// Build a separate web artifact and capture untruncated module evidence. Never
// point this at a running preview. Existing destinations are refused, not cleaned.
const fs = require('fs');
const path = require('path');
const [rootArg, outputArg, statsArg, ...extra] = process.argv.slice(2);
if (!rootArg || !outputArg || !statsArg || extra.length) {
    throw new Error('Usage: node scripts/release-webpack-stats.cjs checkout new-build-directory new-stats.json');
}
const root = fs.realpathSync(rootArg);
const output = path.resolve(outputArg);
const statsFile = path.resolve(statsArg);
if (fs.existsSync(output) || fs.existsSync(statsFile)) throw new Error('Audit destinations must be new');
if (statsFile === output || statsFile.startsWith(output + path.sep)) {
    throw new Error('Statistics must be separate from the build directory');
}
process.env.NODE_ENV = 'production';
process.chdir(root);
const webpack = require(path.join(root, 'node_modules/webpack'));
const config = require(path.join(root, 'webpack.config.js'))[0];
config.output.path = output;
fs.mkdirSync(output); // Claim the new destination; deliberately not recursive.
const descriptor = fs.openSync(statsFile, 'wx');
webpack(config, (error, stats) => {
    try {
        if (error) throw error;
        const report = stats.toJson({all: false, hash: true, errors: true, warnings: true,
            modules: true, nestedModules: true, maxModules: Infinity, chunks: true, chunkModules: true, assets: true});
        fs.writeFileSync(descriptor, JSON.stringify(report));
        console.log(JSON.stringify({hash: report.hash, errors: report.errors, warnings: report.warnings.length}));
        if (stats.hasErrors()) process.exitCode = 1;
    } finally {
        fs.closeSync(descriptor);
    }
});
