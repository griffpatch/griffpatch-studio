import fs from 'fs';
import path from 'path';
import webdriver from 'selenium-webdriver';
import SeleniumHelper from '../helpers/selenium-helper';
import {dismissKeyboardHelp} from '../helpers/keyboard-help';
import {APP_NAME, APP_TITLE, APP_DESCRIPTION} from '../../src/lib/brand';

const {By, Key, until} = webdriver;
const helper = new SeleniumHelper({windowWidth: 1600, windowHeight: 1000});
const describeBrowser = process.env.STUDIO_BROWSER_URL ? describe : describe.skip;
const artifacts = path.resolve('.tmp/studio-brand-evidence');

describeBrowser('Griffpatch Studio preview branding', () => {
    let driver;
    beforeEach(async () => {
        driver = helper.getDriver();
        await helper.loadUri(process.env.STUDIO_BROWSER_URL);
        await driver.wait(() => driver.executeScript('return !!window.vm?.editingTarget;'), 30000);
        fs.mkdirSync(artifacts, {recursive: true});
    });
    afterEach(async () => {
        await driver.quit();
    });
    const screenshot = async name => fs.writeFileSync(path.join(artifacts, `${name}.png`),
        Buffer.from(await driver.takeScreenshot(), 'base64'));

    test('About opens the local notices and identifies the private contact', async () => {
        await driver.get(new URL('credits.html', process.env.STUDIO_BROWSER_URL).href);
        const link = await driver.wait(until.elementLocated(By.linkText('Third-party licences and notices')), 10000);
        expect(await driver.findElement(By.css('a[href="mailto:studio@griffpatch.academy"]')).isDisplayed()).toBe(true);
        await link.click();
        await driver.wait(until.urlContains('/licenses/third-party-notices.txt'), 10000);
        const notice = await driver.findElement(By.css('body')).getText();
        expect(notice).toContain('GRIFFPATCH STUDIO - THIRD-PARTY NOTICES');
        expect(notice).toContain('UNICODE LICENSE V3');
        expect(notice).toContain('Grand9K Pixel');
        await driver.get(new URL('privacy.html', process.env.STUDIO_BROWSER_URL).href);
        expect(await driver.findElement(By.css('body')).getText()).toContain('Griffpatch Ltd');
        expect(await driver.findElement(By.css('body')).getText()).toContain('Your choices and contact');
    });

    test.each(['light', 'dark'])('%s logo outline matches across banner, splash and credits', async theme => {
        await driver.executeScript('localStorage.setItem("tw:theme", arguments[0]);', theme);
        await driver.navigate().refresh();
        const banner = await driver.wait(until.elementLocated(By.css('a[aria-label="About Griffpatch Studio (Preview)"] img')), 30000);
        const style = element => driver.executeScript(`const s=getComputedStyle(arguments[0]);
            return {shadow:s.boxShadow,radius:s.borderRadius};`, element);
        const expected = {shadow: 'rgba(255, 255, 255, 0.65) 0px 0px 0px 2px', radius: '25%'};
        expect(await style(banner)).toEqual(expected);
        // The splash disappears after startup. Render its actual built markup
        // in a script-free iframe to inspect the pre-React presentation.
        const splashStyle = await driver.executeAsyncScript(`const done=arguments[arguments.length-1];
            fetch('editor.html').then(r=>r.text()).then(html=>{
                const doc=new DOMParser().parseFromString(html,'text/html');
                doc.querySelectorAll('script').forEach(s=>s.remove());
                const frame=document.createElement('iframe'); frame.sandbox='allow-same-origin';
                frame.onload=()=>{const s=frame.contentWindow.getComputedStyle(
                    frame.contentDocument.querySelector('.splash-brand img'));
                    const result={shadow:s.boxShadow,radius:s.borderRadius};frame.remove();done(result);};
                frame.srcdoc=doc.documentElement.outerHTML;document.body.appendChild(frame);
            }).catch(e=>done({error:String(e)}));`);
        expect(splashStyle).toEqual(expected);
        await driver.get(new URL('credits.html', process.env.STUDIO_BROWSER_URL).href);
        const mark = await driver.wait(until.elementLocated(By.css('header img')), 10000);
        expect(await style(mark)).toEqual(expected);
        expect(await driver.executeScript('return arguments[0].complete && arguments[0].naturalWidth > 0;', mark))
            .toBe(true);
        await screenshot(`credits-outline-${theme}`);
    });

    test.each(['light', 'dark'])('%s Advanced uses fork identity and the served privacy page is a preview notice', async theme => {
        await driver.executeScript('localStorage.setItem("tw:theme", arguments[0]);', theme);
        await driver.navigate().refresh();
        const advanced = await driver.wait(until.elementLocated(By.xpath('//span[text()="Advanced"]')), 30000);
        await driver.wait(until.elementIsVisible(advanced), 10000);
        const icon = await driver.executeAsyncScript(`const done=arguments[arguments.length-1];
            let container=arguments[0].parentElement;
            while(container && !container.querySelector('img')) container=container.parentElement;
            const image=container.querySelector('img');
            fetch(image.src).then(r=>r.text()).then(done);`, advanced);
        expect(icon).toContain('M3 5h14M3 10h14M3 15h14');
        await advanced.click();
        const store = await driver.wait(until.elementLocated(By.xpath('//button[contains(.,"Store settings in project")]')), 10000);
        const copy = await driver.executeScript('return arguments[0].parentElement.textContent;', store);
        expect(copy).toContain('when Griffpatch Studio loads this project');
        expect(copy).not.toContain('when TurboWarp loads');
        await screenshot(`advanced-identity-${theme}`);
        await driver.get(new URL('privacy.html', process.env.STUDIO_BROWSER_URL).href);
        expect(await driver.getTitle()).toContain(APP_NAME);
        expect(await driver.findElement(By.css('body')).getText()).toContain('studio.griffpatch.academy');
        expect(await driver.findElement(By.css('a[href="credits.html#preview-privacy"]')).isDisplayed()).toBe(true);
    });

    test('new project uses the small centred Studio mark costume', async () => {
        const costume = await driver.executeScript(`const t=window.vm.editingTarget;
            const c=t.getCostumes()[0]; const b=t.getBounds();
            return {asset:c.assetId,center:[c.rotationCenterX,c.rotationCenterY],size:t.size,
                width:b.right-b.left,height:b.top-b.bottom};`);
        expect(costume.asset).toBe('8703e77f090b8dd89628662a8506f961');
        expect(costume.center).toEqual([32, 32]);
        expect(costume.size).toBe(100);
        // Renderer hull bounds exclude the last raster pixel at this scale.
        expect(Math.abs(costume.width - 64)).toBeLessThanOrEqual(1);
        expect(Math.abs(costume.height - 64)).toBeLessThanOrEqual(1);
        await screenshot('default-studio-costume');
    });

    test.each(['light', 'dark'])('%s editor: typing, title edit, compact identity and About link', async theme => {
        await driver.executeScript('localStorage.setItem("tw:theme", arguments[0]);', theme);
        await driver.navigate().refresh();
        const toggle = await driver.wait(until.elementLocated(By.xpath('//button[text()="Keyboard"]')), 30000);
        await driver.wait(until.elementIsVisible(toggle), 20000);
        expect(await driver.getTitle()).toBe(APP_TITLE);
        const brand = await driver.findElement(By.css('a[aria-label="About Griffpatch Studio (Preview)"]'));
        expect(await brand.getText()).toContain(APP_NAME);
        expect(await brand.getText()).toContain('Preview');
        expect(await driver.findElements(By.css('a[href*="GarboMuffin/#comments"]'))).toHaveLength(0);
        expect(await driver.executeScript(`const a=arguments[0];
            return getComputedStyle(a).color === getComputedStyle(a.parentElement.parentElement).color;`, brand))
            .toBe(true);

        // Exercise genuine input in the editor beneath the changed menu.
        await toggle.click();
        await dismissKeyboardHelp(driver);
        await driver.wait(() => driver.executeScript(`return document.activeElement?.getAttribute('aria-label') ===
            'Scratch keyboard editor' && !!document.querySelector('[data-position]');`), 10000);
        await driver.actions().sendKeys('s')
            .perform();
        const composer = await driver.wait(until.elementLocated(By.css('[aria-label="Type a Scratch block"]')), 10000);
        await composer.sendKeys(Key.chord(Key.CONTROL, 'a'), 'say hello', Key.ENTER);
        await driver.wait(() => driver.executeScript(`return window.ScratchBlocks.getMainWorkspace()
            .getAllBlocks(false).some(b => b.type === 'looks_say');`), 10000);
        await screenshot(`editor-${theme}`);

        const title = await driver.findElement(By.css('input[class*="project-title"]'));
        await title.click();
        await title.sendKeys(Key.chord(Key.CONTROL, 'a'), 'My test game', Key.ENTER);
        await driver.wait(async () => (await driver.getTitle()) === `My test game - ${APP_TITLE}`, 10000);
        // The inherited editor has a 1024px minimum layout. Stay just above
        // that limit while exercising the compact wordmark breakpoint.
        await driver.manage().window()
            .setRect({width: 1080, height: 800});
        const bounds = await driver.executeScript(`const a=arguments[0], r=a.getBoundingClientRect();
            const icon=a.querySelector('img').getBoundingClientRect();
            return {left:r.left,right:r.right,icon:icon.width,
                wordmark:getComputedStyle(a.querySelector('span')).display,
                menuRight:a.parentElement.parentElement.getBoundingClientRect().right, width:innerWidth};`, brand);
        expect(bounds.left).toBeGreaterThanOrEqual(0);
        expect(bounds.icon).toBe(30);
        expect(bounds.wordmark).toBe('none');
        expect(bounds.menuRight).toBeLessThanOrEqual(bounds.width + 1);
        await screenshot(`editor-${theme}-narrow`);

        // About opens separately, leaving the actual edited project intact.
        const editor = await driver.getWindowHandle();
        await brand.click();
        await driver.wait(async () => (await driver.getAllWindowHandles()).length === 2, 10000);
        const about = (await driver.getAllWindowHandles()).find(handle => handle !== editor);
        await driver.switchTo().window(about);
        await driver.wait(until.elementLocated(By.id('preview-privacy')), 10000);
        expect(await driver.getTitle()).toBe(`About - ${APP_TITLE}`);
        expect(await driver.findElement(By.css('h1')).getText()).toBe(APP_NAME);
        expect(await driver.findElement(By.css('body')).getText()).toContain('not downloads of this modified build');
        await screenshot(`about-${theme}`);
        await driver.close();
        await driver.switchTo().window(editor);
        expect(await driver.executeScript(`return window.ScratchBlocks.getMainWorkspace().getAllBlocks(false)
            .filter(b => b.type === 'looks_say').length;`)).toBe(1);
    });

    test('built metadata, icons, splash, licences and secondary pages use the intended identity', async () => {
        const result = await driver.executeAsyncScript(`const done=arguments[arguments.length-1];
            (async () => {
                const manifest=await (await fetch('manifest.webmanifest')).json();
                const iconSizes=[];
                for(const icon of manifest.icons) {
                    const image=new Image(); image.src=icon.src; await image.decode();
                    iconSizes.push(image.naturalWidth+'x'+image.naturalHeight);
                }
                const pages={};
                for(const name of ['editor','index','fullscreen','embed','addons','credits']) {
                    const html=await (await fetch(name+'.html')).text();
                    const doc=new DOMParser().parseFromString(html,'text/html');
                    pages[name]={title:doc.title,icon:doc.querySelector('link[rel=icon]')?.getAttribute('href'),
                        splash:doc.querySelector('.splash-brand')?.textContent,
                        description:doc.querySelector('meta[name=description]')?.content};
                }
                const license=await (await fetch('licenses/gui-GPL-3.0.txt')).text();
                const notice=await (await fetch('licenses/upstream-trademark.txt')).text();
                const fork=await (await fetch('licenses/griffpatch-studio-notice.txt')).text();
                done({manifest,iconSizes,pages,license:license.includes('GNU GENERAL PUBLIC LICENSE'),
                    notice:notice.includes('Scratch trademarks'), fork:fork.includes('provided without warranty')});
            })().catch(error=>done({error:String(error)}));`);
        expect(result.error).toBeUndefined();
        expect(result.manifest.name).toBe(APP_TITLE);
        expect(result.manifest.short_name).toBe(APP_NAME);
        expect(result.manifest.description).toBe(APP_DESCRIPTION);
        expect(result.manifest.description).not.toMatch(/recording|tutorial/i);
        expect(result.iconSizes).toEqual(['192x192', '512x512']);
        expect(result.license && result.notice).toBe(true);
        expect(result.fork).toBe(true);
        for (const page of Object.values(result.pages)) {
            expect(page.title).toContain(APP_TITLE);
            expect(page.icon).toBe('brand/griffpatch-studio.svg');
        }
        expect(result.pages.editor.splash).toContain(APP_NAME);
        expect(result.pages.editor.description).toBe(APP_DESCRIPTION);
        expect(await driver.findElements(By.id('tw-studio-session-panel'))).toHaveLength(0);
        await driver.get(new URL('credits.html', process.env.STUDIO_BROWSER_URL).href);
        const experiments = await driver.wait(until.elementLocated(By.id('experiments')), 10000);
        expect(await experiments.getText()).not.toMatch(/cross-UI|visual undo\/redo/i);
        expect(await driver.findElement(By.css('body')).getText()).not.toMatch(/recording|tutorial/i);
        await driver.get(new URL('addons.html', process.env.STUDIO_BROWSER_URL).href);
        await driver.wait(until.elementLocated(By.css('input[aria-label="Search"]')), 10000);
        expect(await driver.getTitle()).toContain(APP_TITLE);
        expect(await driver.findElements(By.css('a[href*="GarboMuffin/#comments"]'))).toHaveLength(0);
    });
});
