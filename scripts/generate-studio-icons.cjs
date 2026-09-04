// Raster derivatives of the original vector mark. Uses the existing browser
// test dependency, with an isolated temporary profile and no network content.
// Run: node scripts/generate-studio-icons.cjs
const fs = require('fs');
const os = require('os');
const path = require('path');
const {Builder} = require('selenium-webdriver');
const chrome = require('selenium-webdriver/chrome');

(async () => {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-icon-render-'));
    const directory = path.resolve(__dirname, '../static/brand');
    const svg = fs.readFileSync(path.join(directory, 'griffpatch-studio.svg'), 'utf8');
    let driver;
    try {
        driver = await new Builder().forBrowser('chrome').setChromeOptions(new chrome.Options().addArguments(
            '--headless=new', `--user-data-dir=${profile}`
        )).build();
        await driver.get('about:blank');
        for (const size of [180, 192, 512]) {
            const data = await driver.executeAsyncScript(`
                const [svg, size, done] = arguments;
                const image = new Image();
                image.onerror = () => done({error: 'Could not render SVG'});
                image.onload = () => {
                    const canvas = document.createElement('canvas');
                    canvas.width = canvas.height = size;
                    canvas.getContext('2d').drawImage(image, 0, 0, size, size);
                    done({png: canvas.toDataURL('image/png').split(',')[1]});
                };
                image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
            `, svg, size);
            if (data.error) throw new Error(data.error);
            fs.writeFileSync(path.join(directory, `studio-${size}.png`), Buffer.from(data.png, 'base64'));
        }
    } finally {
        if (driver) await driver.quit();
        // This exact path was allocated by mkdtemp above, never a user profile.
        fs.rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
