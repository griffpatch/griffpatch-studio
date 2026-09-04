import fs from 'fs';
import path from 'path';
import webdriver from 'selenium-webdriver';
import SeleniumHelper from '../helpers/selenium-helper';

const {By, Key, until} = webdriver;
const helper = new SeleniumHelper({windowWidth: 1440, windowHeight: 1000});
const describeBrowser = process.env.STUDIO_BROWSER_URL ? describe : describe.skip;
const artifacts = path.resolve('.tmp/transition-rendering');

describeBrowser('Shared native block presentation across history controls', () => {
    let driver;
    const status = () => driver.findElement(By.id('tw-studio-session-panel')).getText();
    const ready = async position => driver.wait(async () => {
        const text = await status();
        if (/restored|mismatch|reload required/.test(text)) {
            const error = await driver.findElement(By.id('tw-studio-diagnostic')).getAttribute('textContent');
            throw new Error(`${text}\n${error}`);
        }
        return text.includes(`position ${position}/43`) && !/playing|seeking|undoing|redoing/.test(text);
    }, 90000);
    const value = (id, next) => driver.executeScript(`
        const control = document.getElementById(arguments[0]);
        control.value = String(arguments[1]);
        control.dispatchEvent(new Event('change', {bubbles:true}));
    `, id, next);
    const clickTitle = async title => {
        const button = driver.findElement(By.css(`button[title="${title}"]`));
        await driver.wait(until.elementIsEnabled(button), 10000);
        await button.click();
    };
    const beginTrace = () => driver.executeScript(`
        const trace = {active:true, frames:[]};
        window.__nativeTransitionTrace = trace;
        const tick = () => {
            if (!trace.active) return;
            const workspace = document.querySelector('.blocklySvg').getBoundingClientRect();
            const palette = document.querySelector('.blocklyFlyout').getBoundingClientRect();
            const actors = [...document.querySelectorAll('[data-studio-transition-actor]')].map(root => {
                const box = root.getBoundingClientRect();
                return {
                    id:root.getAttribute('data-id'), kind:root.getAttribute('data-studio-transition-actor'),
                    x:box.x, y:box.y,
                    visible:box.left >= Math.max(workspace.left,palette.right) - 1 &&
                        box.right <= workspace.right + 1 && box.top >= workspace.top - 1 &&
                        box.bottom <= workspace.bottom + 1,
                    fields:[...root.querySelectorAll('.blocklyText')].map(field => {
                        const rect=field.getBoundingClientRect();
                        return {x:rect.x-box.x,y:rect.y-box.y,text:field.textContent};
                    })
                };
            });
            const previews = [...document.querySelectorAll('.blocklyTransitionWorkspace .blocklyInsertionMarker')]
                .filter(root=>getComputedStyle(root).visibility!=='hidden').length;
            trace.frames.push({actors,previews});
            requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
    `);
    const finishTrace = () => driver.executeScript(`
        window.__nativeTransitionTrace.active=false;
        return window.__nativeTransitionTrace.frames;
    `);
    beforeAll(() => { driver = helper.getDriver(); fs.mkdirSync(artifacts, {recursive:true}); });
    afterAll(async () => { if (driver) await driver.quit(); });

    test('keeps owned inputs attached through buttons, keyboard and timeline in both directions', async () => {
        const url = new URL(process.env.STUDIO_BROWSER_URL);
        url.searchParams.set('studio-history-pointer', '0');
        for (const [key, val] of Object.entries({
            'studio-session':'1', 'studio-take':`transition-rendering-${Date.now()}`,
            'studio-connection-matrix-fixture':'1', 'studio-debug':'1'
        })) url.searchParams.set(key,val);
        await helper.loadUri(url.toString());
        const seed = await driver.wait(until.elementLocated(By.xpath('//button[text()="Seed Matrix"]')), 20000);
        await driver.wait(until.elementIsEnabled(seed), 20000);
        await seed.click();
        await ready(43);
        await value('tw-studio-speed', 0.5);
        for (const boundary of [43, 15, 26]) {
            await value('tw-studio-step', boundary);
            await ready(boundary);
            await value('tw-studio-range-start', boundary - 1);
            await value('tw-studio-range-end', boundary);
            const routes = [
                ['previous', () => clickTitle('Previous transaction'), boundary - 1],
                ['next', () => clickTitle('Next transaction'), boundary],
                ['undo', () => driver.findElement(By.css('body')).sendKeys(Key.chord(Key.CONTROL,'z')), boundary - 1],
                ['redo', () => driver.findElement(By.css('body')).sendKeys(Key.chord(Key.CONTROL,Key.SHIFT,'z')), boundary],
                ['backward', () => clickTitle('Play selected range backward'), boundary - 1],
                ['forward', () => clickTitle('Play selected range forward'), boundary]
            ];
            for (const [name, action, destination] of routes) {
                await beginTrace();
                await action();
                if (name === 'previous' || name === 'next') {
                    await driver.wait(async () => (await driver.findElements(
                        By.css('[data-studio-transition-actor]'))).length > 0, 5000);
                    fs.writeFileSync(path.join(artifacts, `${boundary}-${name}.png`),
                        Buffer.from(await driver.takeScreenshot(), 'base64'));
                }
                await ready(destination);
                const frames = (await finishTrace()).filter(frame => frame.actors.length);
                expect(frames.length).toBeGreaterThan(2);
                const first = frames[0].actors[0];
                expect(first.fields.length).toBeGreaterThan(0);
                const last = frames[frames.length - 1].actors[0];
                expect(Math.hypot(first.x-last.x,first.y-last.y)).toBeGreaterThan(2);
                if (last.kind !== 'exit') {
                    const settled = await driver.executeScript(`
                        const root = [...document.querySelectorAll('.blocklyDraggable[data-id]')].find(element =>
                            element.getAttribute('data-id') === arguments[0] && !element.closest('.blocklyFlyout'));
                        const box = root.getBoundingClientRect();
                        return {x:box.x,y:box.y};
                    `, last.id);
                    expect(Math.abs(last.x-settled.x)).toBeLessThan(1);
                    expect(Math.abs(last.y-settled.y)).toBeLessThan(1);
                }
                for (const frame of frames) {
                    const actor=frame.actors.find(item=>item.id===first.id);
                    if (!actor.visible) throw new Error(`Offscreen actor at ${boundary}/${name}: ${JSON.stringify(actor)}`);
                    expect(actor.fields.map(field=>field.text)).toEqual(first.fields.map(field=>field.text));
                    actor.fields.forEach((field,index)=>{
                        expect(Math.abs(field.x-first.fields[index].x)).toBeLessThan(0.8);
                        expect(Math.abs(field.y-first.fields[index].y)).toBeLessThan(0.8);
                    });
                }
                expect(await driver.findElements(By.css('.blocklyTransitionWorkspace'))).toHaveLength(0);
                expect(await driver.findElements(By.id('tw-studio-native-pointer'))).toHaveLength(0);
            }
        }
    }, 240000);

    test('frames offscreen text edits before their value changes at normal and high zoom', async () => {
        for (const scale of [1, 3]) {
            await value('tw-studio-step', 17);
            await ready(17);
            const wasVisible = await driver.executeScript(`
                const ws = window.ScratchBlocks.getMainWorkspace();
                ws.setScale(arguments[0]);
                const root = ws.getTopBlocks(false).find(block => block.type === 'looks_say');
                const fieldBlock = root.getInputTargetBlock('MESSAGE').getInputTargetBlock('STRING2');
                const metrics = ws.getMetrics();
                ws.scrollbar.set(metrics.contentWidth-metrics.viewWidth,metrics.contentHeight-metrics.viewHeight);
                const visible = () => {
                    const rect=fieldBlock.getSvgRoot().getBoundingClientRect();
                    const view=ws.getParentSvg().getBoundingClientRect();
                    const palette=document.querySelector('.blocklyFlyout').getBoundingClientRect();
                    return rect.left >= palette.right && rect.right <= view.right &&
                        rect.top >= view.top && rect.bottom <= view.bottom;
                };
                const trace = {updates:[]};
                trace.observer = new MutationObserver(() => {
                    if (fieldBlock.getFieldValue('TEXT') === 'c') trace.updates.push(visible());
                });
                trace.observer.observe(fieldBlock.getSvgRoot(), {subtree:true,childList:true,characterData:true});
                window.__fieldFraming = trace;
                return visible();
            `, scale);
            expect(wasVisible).toBe(false);
            await clickTitle('Next transaction');
            await ready(18);
            const updates = await driver.executeScript(`
                window.__fieldFraming.observer.disconnect();
                return window.__fieldFraming.updates;
            `);
            expect(updates.length).toBeGreaterThan(0);
            expect(updates.every(Boolean)).toBe(true);
            const camera = () => driver.executeScript(`
                const ws=window.ScratchBlocks.getMainWorkspace();
                return ws.getCanvas().getAttribute('transform');
            `);
            const before = await camera();
            await clickTitle('Previous transaction');
            await ready(17);
            await clickTitle('Next transaction');
            await ready(18);
            expect(await camera()).toBe(before);
        }
    }, 90000);
});
