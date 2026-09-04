import path from 'path';
import express from 'express';
import webdriver from 'selenium-webdriver';
import SeleniumHelper from '../helpers/selenium-helper';

const {By, Key, until} = webdriver;
const describeBrowser = process.env.URL_STARTUP_BUILD ? describe : describe.skip;

// Serve only the explicitly supplied candidate, on a temporary loopback port.
// Neither the user's browser profile nor any running preview is touched.
describeBrowser('native URL decoding during editor startup', () => {
    let server;
    let base;
    let driver;
    beforeAll(async () => {
        const app = express();
        app.use(express.static(path.resolve(process.env.URL_STARTUP_BUILD)));
        server = await new Promise(resolve => {
            const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
        });
        base = `http://127.0.0.1:${server.address().port}/editor.html`;
    });
    afterAll(async () => {
        if (server) await new Promise(resolve => server.close(resolve));
    });
    beforeEach(async () => {
        driver = new SeleniumHelper({windowWidth: 1440, windowHeight: 1000}).getDriver();
        await driver.manage().setTimeouts({pageLoad: 20000, script: 5000});
    });
    afterEach(async () => { if (driver) await driver.quit(); });

    const load = async query => {
        const start = Date.now();
        await driver.get(`${base}${query}`);
        await driver.wait(() => driver.executeScript('return !!window.vm?.editingTarget;'), 20000);
        console.log(`URL startup ready in ${Date.now() - start} ms`);
    };

    test('encoded and duplicate locale parameters retain first-choice precedence', async () => {
        await load('?%6Cocale=%64%65&locale=en&lang=it');
        await driver.wait(until.elementLocated(By.xpath('//span[text()="Datei"]')), 10000);
    });

    test('malformed unused value does not prevent startup or enable the disabled tutorial URL handler', async () => {
        await load(`?unused=${'%FF'.repeat(4096)}&locale=en&tutorial=all&tutorial=unknown`);
        await driver.wait(until.elementLocated(By.xpath('//span[text()="File"]')), 10000);
        // TurboWarp intentionally omits QueryParserHOC from the GUI composition.
        expect(await driver.findElements(By.css('[role="dialog"][aria-label="Choose a Tutorial"]'))).toHaveLength(0);
    });

    test('malformed key and locale still allow normal editing and a subsequent clean navigation', async () => {
        await load(`?${'%FF'.repeat(2048)}=unused&locale=%FF&tutorial=%FF&project_title=Hello+%E2%9C%93`);
        const title = await driver.wait(until.elementLocated(By.css('input[class*="project-title"]')), 10000);
        expect(await title.getAttribute('value')).toBe('Hello ✓');
        await title.click();
        await title.sendKeys(Key.chord(Key.CONTROL, 'a'), 'URL regression passed', Key.ENTER);
        expect(await title.getAttribute('value')).toBe('URL regression passed');
        await load('?locale=en');
        await driver.wait(until.elementLocated(By.xpath('//span[text()="File"]')), 10000);
    });
});
