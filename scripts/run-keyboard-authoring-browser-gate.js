#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');
const {spawnSync} = require('child_process');
const {
    coreContracts,
    laneNames,
    patternForLane
} = require('./keyboard-authoring-browser-gates');

const lane = process.argv[2] || 'core';
if (lane === 'list' || lane === '--list') {
    process.stdout.write(`${laneNames.join('\n')}\n`);
    process.exit(0);
}
if (!laneNames.includes(lane)) {
    process.stderr.write(`Unknown Keyboard Authoring browser lane: ${lane}\nAvailable: ${laneNames.join(', ')}\n`);
    process.exit(2);
}
if (!process.env.STUDIO_BROWSER_URL) {
    process.stderr.write('STUDIO_BROWSER_URL must point at an already-built Keyboard Authoring editor.\n');
    process.exit(2);
}

const root = path.resolve(__dirname, '..');
const lockPath = path.join(root, '.tmp', 'keyboard-authoring-browser-gate.lock');
const reportPath = path.join(os.tmpdir(), `keyboard-authoring-browser-${process.pid}.json`);
fs.mkdirSync(path.dirname(lockPath), {recursive: true});

let lock = null;
try {
    lock = fs.openSync(lockPath, 'wx');
    fs.writeFileSync(lock, String(process.pid));
} catch (error) {
    if (error.code === 'EEXIST') {
        process.stderr.write(
            `Another Keyboard Authoring browser gate owns ${lockPath}. Do not overlap browser suites.\n`
        );
        process.exit(2);
    }
    throw error;
}

let exitCode = 2;
try {
    const args = [
        path.join(root, 'node_modules', 'jest', 'bin', 'jest.js'),
        'test/integration/keyboard-authoring.test.js',
        '--runInBand',
        '--json',
        `--outputFile=${reportPath}`
    ];
    const pattern = patternForLane(lane);
    if (pattern) args.push(`--testNamePattern=${pattern}`);
    process.stdout.write(`Keyboard Authoring browser gate: ${lane}\n`);
    const result = spawnSync(process.execPath, args, {
        cwd: root,
        env: process.env,
        stdio: 'inherit'
    });
    exitCode = typeof result.status === 'number' ? result.status : 2;
    if (fs.existsSync(reportPath)) {
        const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
        const assertions = report.testResults.flatMap(suite => suite.assertionResults || []);
        const selected = assertions.filter(test => !['pending', 'todo', 'disabled'].includes(test.status));
        if (!selected.length) {
            process.stderr.write('No live browser cases ran; a skipped suite is not a passing gate.\n');
            exitCode = 2;
        } else if (lane === 'core' && selected.length !== coreContracts.length) {
            process.stderr.write(
                `Core inventory drift: expected ${coreContracts.length} cases, ran ${selected.length}.\n`
            );
            exitCode = 2;
        } else {
            const outcome = exitCode === 0 ? 'passed' : 'failed';
            process.stdout.write(
                `Browser gate ${outcome}: ${selected.length} live case${selected.length === 1 ? '' : 's'}.\n`
            );
        }
    } else {
        process.stderr.write('Jest did not produce a browser-gate report.\n');
        exitCode = 2;
    }
} finally {
    if (lock !== null) fs.closeSync(lock);
    if (fs.existsSync(lockPath)) fs.unlinkSync(lockPath);
    if (fs.existsSync(reportPath)) fs.unlinkSync(reportPath);
}

process.exit(exitCode);
