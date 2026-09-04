import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

// These tests otherwise intentionally skip when no browser URL is supplied.
// A release gate must fail loudly instead of reporting that skip as success.
const browserUrl = process.env.STUDIO_BROWSER_URL;
let validUrl = false;
try {
    const url = new URL(browserUrl);
    validUrl = ['http:', 'https:'].includes(url.protocol) &&
        ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
} catch {
    // Report the same actionable setup error for missing and malformed URLs.
}
if (!validUrl) {
    process.stderr.write('Set STUDIO_BROWSER_URL to an isolated localhost editor build before running this gate.\n');
    process.exit(1);
}

const root = fileURLToPath(new URL('../', import.meta.url));
const jest = fileURLToPath(new URL('../node_modules/jest/bin/jest.js', import.meta.url));
const suites = [
    'studio-native-complex-authoring',
    'studio-target-operations',
    'studio-native-drag-contract',
    'studio-transition-rendering',
    'studio-connection-matrix',
    'studio-history-pressure',
    'studio-playback-stop-resume',
    'studio-authoring-dialogs',
    'studio-file-new-restart',
    'studio-block-clipboard'
];
const result = spawnSync(process.execPath, [
    jest,
    ...suites.map(name => `test/integration/${name}.test.js`),
    // Parallel browsers can starve the frame sampler and hide visual defects.
    '--runInBand',
    ...process.argv.slice(2)
], {cwd: root, env: process.env, stdio: 'inherit'});
if (result.error) process.stderr.write(`${result.error.message}\n`);
process.exitCode = result.status ?? 1;
