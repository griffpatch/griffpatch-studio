import fs from 'fs';
import webdriver from 'selenium-webdriver';
import SeleniumHelper from '../helpers/selenium-helper';

const {By, Key, until} = webdriver;
const helper = new SeleniumHelper({windowWidth: 1280, windowHeight: 900});
const describeBrowser = process.env.STUDIO_BROWSER_URL ? describe : describe.skip;
describeBrowser('Keyboard guide real focus lifecycle', () => {
    let driver;
    beforeEach(async () => {
        driver = helper.getDriver();
        await helper.loadUri(process.env.STUDIO_BROWSER_URL);
    });
    afterEach(async () => { await driver.quit(); });
    test.each(['light', 'dark'])('%s first activation, Escape, reopen and draft preservation', async theme => {
        await driver.executeScript(`localStorage.setItem("tw:theme", arguments[0]);
            localStorage.removeItem('griffpatch-studio.keyboard-help-seen');`, theme);
        await driver.navigate().refresh();
        const toggle = await driver.wait(until.elementLocated(By.xpath('//button[text()="Keyboard"]')), 30000);
        await driver.wait(until.elementIsVisible(toggle), 20000);
        await toggle.click();
        const selector = 'dialog[open][aria-label="Keyboard editing guide"]';
        const guide = await driver.wait(until.elementLocated(By.css(selector)), 20000);
        expect(await guide.getText()).toContain('Quick start');
        expect(await guide.getText()).not.toContain('F3');
        await driver.findElement(By.css('[role="tab"][aria-controls="keyboard-help-panel-4"]')).click();
        expect(await guide.getText()).toContain('F3');
        await driver.actions().sendKeys(Key.HOME).perform();
        expect(await driver.findElement(By.css('dialog [role="tab"][aria-selected="true"]')).getText())
            .toBe('Quick start');
        await driver.findElement(By.css('dialog footer button')).click();
        await driver.findElement(By.css('[aria-label="Keyboard help"]')).click();
        expect(await driver.executeScript('return document.activeElement.textContent;')).toBe('Got it');
        fs.mkdirSync('.tmp/keyboard-help-evidence', {recursive: true});
        fs.writeFileSync(`.tmp/keyboard-help-evidence/${theme}.png`,
            Buffer.from(await driver.takeScreenshot(), 'base64'));
        await driver.manage().window().setRect({width: 520, height: 640});
        const bounds = await driver.executeScript(`const d=document.querySelector(arguments[0]);
            const r=d.getBoundingClientRect(); return {left:r.left,right:r.right,bottom:r.bottom,
                width:innerWidth,height:innerHeight,overflow:d.scrollWidth>d.clientWidth};`, selector);
        expect(bounds.left).toBeGreaterThanOrEqual(0);
        expect(bounds.right).toBeLessThanOrEqual(bounds.width);
        expect(bounds.bottom).toBeLessThanOrEqual(bounds.height);
        expect(bounds.overflow).toBe(false);
        await driver.manage().window().setRect({width: 1280, height: 900});
        await driver.actions().sendKeys(Key.ESCAPE).perform();
        await driver.wait(() => driver.executeScript(
            'return document.activeElement.getAttribute("aria-label") === "Scratch keyboard editor";'), 10000);
        expect(await toggle.getAttribute('aria-pressed')).toBe('true');
        await toggle.click();
        await toggle.click();
        await driver.wait(() => driver.executeScript(
            'return document.activeElement.getAttribute("aria-label") === "Scratch keyboard editor";'), 10000);
        expect(await driver.findElements(By.css(selector))).toHaveLength(0);
        await driver.actions().sendKeys('s').perform();
        const input = await driver.wait(until.elementLocated(By.css('[aria-label="Type a Scratch block"]')), 10000);
        await input.sendKeys(Key.chord(Key.CONTROL, 'a'), 'say hello');
        await driver.findElement(By.css('[aria-label="Keyboard help"]')).click();
        await driver.wait(until.elementLocated(By.css(selector)), 10000);
        await driver.actions().sendKeys(Key.ESCAPE).perform();
        await driver.wait(() => driver.executeScript(
            'return document.activeElement.getAttribute("aria-label") === "Type a Scratch block";'), 10000);
        expect(await input.getAttribute('value')).toBe('say hello');
        await input.sendKeys(Key.ENTER);
        await driver.wait(() => driver.executeScript(`return window.ScratchBlocks.getMainWorkspace()
            .getAllBlocks(false).some(b => b.type === 'looks_say');`), 10000);
    });
});
