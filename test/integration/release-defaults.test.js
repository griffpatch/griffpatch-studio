import fs from 'fs';
import webdriver from 'selenium-webdriver';
import SeleniumHelper from '../helpers/selenium-helper';
const {By, Key, until} = webdriver;
const helper = new SeleniumHelper({windowWidth: 1440, windowHeight: 1000});
const describeBrowser = process.env.STUDIO_BROWSER_URL ? describe : describe.skip;
describeBrowser('Release defaults in a fresh browser', () => {
    let driver;
    beforeEach(() => { driver = helper.getDriver(); });
    afterEach(async () => { await driver.quit(); });
    test('plain editor offers Keyboard, starts off and enables only after clicking', async () => {
        const url = new URL(process.env.STUDIO_BROWSER_URL);
        url.search = '';
        await helper.loadUri(url.href);
        const toggle = await driver.wait(until.elementLocated(By.xpath('//button[text()="Keyboard"]')), 30000);
        await driver.wait(until.elementIsVisible(toggle), 20000);
        expect(await toggle.getAttribute('aria-pressed')).toBe('false');
        expect(await driver.findElements(By.css('dialog[open]'))).toHaveLength(0);
        await toggle.click();
        const guide = await driver.wait(until.elementLocated(By.css('dialog[open] footer button')), 10000);
        expect(await toggle.getAttribute('aria-pressed')).toBe('true');
        await guide.click();
        await driver.actions().sendKeys('s').perform();
        const input = await driver.wait(until.elementLocated(By.css('[aria-label="Type a Scratch block"]')), 10000);
        await input.sendKeys(Key.chord(Key.CONTROL, 'a'), 'say hello', Key.ENTER);
        await driver.wait(() => driver.executeScript(`return window.ScratchBlocks.getMainWorkspace()
            .getAllBlocks(false).some(b=>b.type==='looks_say');`), 10000);
        expect(await driver.findElements(By.id('tw-studio-session-panel'))).toHaveLength(0);
        const resources = await driver.executeScript(`return [...new Set(performance.getEntriesByType('resource')
            .filter(e=>/^https?:/.test(e.name)).map(e=>new URL(e.name).origin))].sort();`);
        fs.mkdirSync('.tmp/release-audit', {recursive: true});
        fs.writeFileSync('.tmp/release-audit/local-edit-resource-origins.json', JSON.stringify(resources, null, 2));
        await toggle.click();
        expect(await toggle.getAttribute('aria-pressed')).toBe('false');
        // Native project replacement must not enable keyboard mode either.
        await driver.executeAsyncScript(`const done=arguments[arguments.length-1];
            Promise.resolve(window.vm.clear()).then(()=>done()).catch(e=>done(String(e)));`);
        expect(await toggle.getAttribute('aria-pressed')).toBe('false');
    });
    test('explicit opt-out removes the keyboard integration', async () => {
        const url = new URL(process.env.STUDIO_BROWSER_URL);
        url.search = '?keyboard-authoring=0';
        await helper.loadUri(url.href);
        await driver.wait(() => driver.executeScript('return !!window.vm?.editingTarget;'), 30000);
        expect(await driver.findElements(By.css('[data-keyboard-authoring]'))).toHaveLength(0);
    });
});
