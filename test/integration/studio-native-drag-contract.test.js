import webdriver from 'selenium-webdriver';
import SeleniumHelper from '../helpers/selenium-helper';

const {By, Key, until} = webdriver;
const helper = new SeleniumHelper({windowWidth: 1440, windowHeight: 900});
const describeBrowser = process.env.STUDIO_BROWSER_URL ? describe : describe.skip;

describeBrowser('Native drag recording contract', () => {
    let driver;
    let phase = 'authoring';
    const journal = () => driver.executeScript(`
        return JSON.parse(document.querySelector('#tw-studio-journal-debug').textContent).journal;
    `);
    const panel = () => driver.findElement(By.id('tw-studio-session-panel')).getText();
    const ready = async position => driver.wait(async () => {
        const text = await panel();
        if (/restored|state mismatch|reload required/.test(text)) {
            const diagnostic = await driver.executeScript(`return {
                diagnostic: document.querySelector('#tw-studio-diagnostic')?.textContent,
                journal: document.querySelector('#tw-studio-journal-debug')?.textContent,
                evidence: document.querySelector('#tw-studio-native-evidence')?.textContent
            };`);
            throw new Error(`${phase}: ${text}\n${JSON.stringify(diagnostic)}`);
        }
        return text.includes(position);
    }, 60000);
    const click = async label => {
        const button = await driver.wait(until.elementLocated(By.xpath(`//button[normalize-space(.)='${label}']`)), 20000);
        await driver.wait(until.elementIsEnabled(button), 20000);
        await button.click();
    };
    const drag = async (start, end) => {
        await driver.actions().move({origin: 'viewport', x: Math.round(start.x), y: Math.round(start.y)})
            .press().move({origin: 'viewport', x: Math.round(end.x), y: Math.round(end.y), duration: 600})
            .pause(150).release().perform();
    };
    const pathFor = id => driver.findElement(By.css(`.blocklyBlockCanvas g[data-id="${id}"] > .blocklyPath`));
    beforeAll(() => { driver = helper.getDriver(); });
    afterAll(async () => { if (driver) await driver.quit(); });

    test('records actual four-block pickup identities and survives Play, history and reload', async () => {
        const url = new URL(process.env.STUDIO_BROWSER_URL);
        url.searchParams.set('studio-session', '1');
        url.searchParams.set('studio-take', `native-contract-${Date.now()}`);
        url.searchParams.set('studio-debug', '1');
        await helper.loadUri(url.toString());
        await ready('position 0/0');
        // The in-app browser reuses its HTTP cache between builds. A fresh
        // Selenium profile alone would miss a stale, unversioned sb.js.
        const blocksScript = await driver.executeScript(`
            return Array.from(document.scripts).map(script => script.src)
                .find(src => src.includes('/sb.'));
        `);
        expect(blocksScript).toMatch(/\/sb\.[a-f0-9]+\.js(?:\?|$)/);
        const ids = [];
        for (const [index, opcode] of ['motion_movesteps', 'motion_turnright', 'motion_turnleft', 'motion_changexby'].entries()) {
            const flyout = await driver.wait(until.elementLocated(By.css(`.blocklyFlyout g[data-id="${opcode}"] > .blocklyPath`)), 20000);
            const source = await flyout.getRect();
            const previous = index ? await (await pathFor(ids[index - 1])).getRect() : null;
            const end = previous ? {x: previous.x + 20, y: previous.y + previous.height + 6} : {x: 455, y: 200};
            await drag({x: source.x + 20, y: source.y + 12}, end);
            await ready(`position ${index + 1}/${index + 1}`);
            // The create event publishes the new count at pickup. Wait for
            // the actual drop event too, not just an in-progress step number.
            await driver.wait(async () => {
                const current = (await journal()).transactions[index];
                return current && current.events.some(event => event.type === 'move' &&
                    (index ? event.details.newLocation.parentId === ids[index - 1] :
                        event.details.newLocation.coordinate));
            }, 10000);
            const tx = (await journal()).transactions[index];
            const created = tx.events.find(event => event.type === 'create');
            expect(created.gesture).toMatchObject({source: 'scratch-blocks-drag', blockId: created.blockId});
            if (index) {
                expect(tx.events.some(event => event.type === 'move' &&
                    event.details.newLocation.parentId === ids[index - 1])).toBe(true);
            }
            ids.push(created.blockId);
        }
        const root = await (await pathFor(ids[0])).getRect();
        const third = await (await pathFor(ids[2])).getRect();
        // A real pointer drag picks up the third block and its tail, and drops
        // it immediately after the first. No synthetic connection events.
        await drag({x: third.x + 20, y: third.y + 12}, {x: root.x + 20, y: root.y + root.height + 6});
        await ready('position 5/5');
        await driver.wait(async () => {
            const current = (await journal()).transactions[4];
            return current && current.events.some(event => event.type === 'move' &&
                event.blockId === ids[2] && event.details.newLocation.parentId === ids[0]);
        }, 10000);
        const moved = (await journal()).transactions[4];
        expect(moved.events.some(event => event.gesture && event.gesture.blockId === ids[2])).toBe(true);
        expect(moved.events.filter(event => event.gesture).every(event => event.gesture.blockId === ids[2])).toBe(true);
        expect(moved.events[0].gesture.blockIds).toEqual(expect.arrayContaining([ids[2], ids[3]]));
        expect(moved.events[0].gesture.blockIds).not.toContain(ids[1]);
        expect(moved.events.some(event => event.type === 'move' && event.blockId === ids[1] &&
            event.details.newLocation.parentId === ids[3])).toBe(true);
        phase = 'ordinary editing undo';
        await driver.findElement(By.css('body')).sendKeys(Key.chord(Key.CONTROL, 'z'));
        await ready('position 4/5');
        phase = 'ordinary editing redo';
        await driver.findElement(By.css('body')).sendKeys(Key.chord(Key.CONTROL, Key.SHIFT, 'z'));
        await ready('position 5/5');
        phase = 'rewind';
        await click('Rewind');
        await ready('position 0/5');
        phase = 'first Play';
        await click('Play');
        await ready('played · 5 steps');
        for (let cycle = 0; cycle < 3; cycle++) {
            phase = `undo ${cycle}`;
            await driver.findElement(By.css('body')).sendKeys(Key.chord(Key.CONTROL, 'z'));
            await ready('position 4/5');
            phase = `redo ${cycle}`;
            await driver.findElement(By.css('body')).sendKeys(Key.chord(Key.CONTROL, Key.SHIFT, 'z'));
            await ready('position 5/5');
        }
        await driver.navigate().refresh();
        await ready('position 0/5');
        await click('Play');
        await ready('played · 5 steps');
    }, 180000);
});
