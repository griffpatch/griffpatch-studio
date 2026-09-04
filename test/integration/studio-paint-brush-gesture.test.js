import webdriver from 'selenium-webdriver';
import SeleniumHelper from '../helpers/selenium-helper';

const {By, Key, until} = webdriver;

const helper = new SeleniumHelper({windowWidth: 1440, windowHeight: 900});
const describeBrowser = process.env.STUDIO_BROWSER_URL ? describe : describe.skip;

jest.setTimeout(180000);

describeBrowser('Tutorial Studio Paint edit sessions', () => {
    let driver;
    let takeUrl;

    const bodyText = () => driver.findElement(By.css('body')).getText();
    const studioText = (text, timeout = 30000) => driver.wait(async () => {
        const body = await bodyText();
        if (body.includes('— restored') || body.includes('state mismatch') || body.includes('reload required')) {
            const diagnostics = await driver.executeScript(`
                return {
                    diagnostic: document.querySelector('#tw-studio-diagnostic')?.textContent || '',
                    evidence: document.querySelector('#tw-studio-native-evidence')?.textContent || '',
                    journal: document.querySelector('#tw-studio-journal-debug')?.textContent || ''
                };
            `);
            throw new Error(`Studio failed while waiting for ${text}:\n${JSON.stringify(diagnostics, null, 2)}`);
        }
        return body.includes(text);
    }, timeout);
    const clickButton = async name => {
        const button = await driver.wait(
            until.elementLocated(By.xpath(`//button[normalize-space(.)='${name}']`)),
            20000
        );
        await driver.wait(until.elementIsEnabled(button), 20000);
        await button.click();
    };
    const openTab = async name => {
        const selector = By.xpath(`//*[@role='tab' and normalize-space(.)='${name}']`);
        const tab = await driver.wait(async () => {
            const matches = await driver.findElements(selector);
            for (const match of matches) {
                if (await match.isDisplayed()) return match;
            }
            return false;
        }, 20000, `Visible editor tab did not appear: ${name}`);
        await tab.click();
    };
    const paintHistory = () => driver.executeScript(`
        const root = document.querySelector('[data-studio-target="costume-editor"]');
        return root ? {
            canUndo: root.getAttribute('data-studio-paint-can-undo') === 'true',
            canRedo: root.getAttribute('data-studio-paint-can-redo') === 'true'
        } : null;
    `);
    const costume = () => driver.executeScript(`
        const costume = window.vm.editingTarget.getCostumes()[0];
        return {assetId: costume.assetId, dataFormat: costume.dataFormat};
    `);
    const editingTarget = () => driver.executeScript(`
        const target = window.vm.editingTarget;
        return {
            id: target && target.id,
            isStage: Boolean(target && target.isStage),
            name: target && (target.getName ? target.getName() : target.sprite.name)
        };
    `);
    const journal = () => driver.executeScript(`
        return JSON.parse(document.querySelector('#tw-studio-journal-debug').textContent).journal;
    `);
    const pointerCount = () => driver.executeScript(`
        return document.querySelectorAll('#tw-studio-native-pointer').length;
    `);
    const pressHistory = async redo => {
        const body = await driver.findElement(By.css('body'));
        await body.sendKeys(Key.chord(Key.CONTROL, ...(redo ? [Key.SHIFT, 'z'] : ['z'])));
    };
    const convertToBitmap = async () => {
        const convert = await driver.wait(
            until.elementLocated(By.css('[data-studio-target="paint-convert-to-bitmap"]')),
            20000
        );
        await convert.click();
        await driver.wait(
            async () => (await costume()).dataFormat === 'png',
            30000,
            'Convert to Bitmap did not update the selected costume'
        );
    };
    const assertPaintHistory = async expected => {
        await driver.wait(async () => {
            const actual = await paintHistory();
            return actual && actual.canUndo === expected.canUndo && actual.canRedo === expected.canRedo;
        }, 20000, `Paint history did not settle to ${JSON.stringify(expected)}`);
        expect(await paintHistory()).toEqual(expected);
    };
    const loadTake = async url => {
        await helper.loadUri(url);
    };

    beforeAll(() => {
        driver = helper.getDriver();
        const url = new URL(process.env.STUDIO_BROWSER_URL);
        url.searchParams.set('studio-session', '1');
        url.searchParams.set('studio-take', `selenium-paint-session-${Date.now()}`);
        url.searchParams.set('studio-pointer-model', 'natural');
        url.searchParams.set('studio-build', 'selenium-paint-session');
        url.searchParams.set('studio-cache', String(Date.now()));
        url.searchParams.set('studio-debug', '1');
        takeUrl = url.toString();
    });

    afterAll(async () => {
        if (driver) await driver.quit();
    });

    test('keeps Paint undo local, records one costume visit and crosses its boundary safely', async () => {
        await loadTake(takeUrl);
        const before = await costume();

        await openTab('Costumes');
        await assertPaintHistory({canUndo: false, canRedo: false});
        await convertToBitmap();
        const after = await costume();
        expect(after.assetId).not.toBe(before.assetId);
        await assertPaintHistory({canUndo: true, canRedo: false});

        // Native Paint owns its own history until that visit's stack is
        // exhausted; Studio does not advance or create a transaction here.
        await pressHistory(false);
        await driver.wait(async () => (await costume()).dataFormat === 'svg', 30000);
        await assertPaintHistory({canUndo: false, canRedo: true});
        expect((await journal()).transactions).toHaveLength(0);
        await pressHistory(true);
        await driver.wait(async () => (await costume()).dataFormat === 'png', 30000);

        // Leaving Paint closes the coalesced edit boundary. Individual paint
        // callbacks are deliberately not Studio timeline frames.
        await openTab('Code');
        await studioText('recording · 1 steps');
        const recorded = await journal();
        expect(recorded.transactions).toHaveLength(1);
        expect(recorded.transactions[0]).toMatchObject({
            kind: 'project-operation',
            operation: {
                type: 'costume-edit-session',
                targetRef: {isStage: false, name: 'Sprite1'},
                editedCostumes: [expect.objectContaining({dataFormat: 'png'})]
            }
        });

        // A fresh Paint visit starts with a fresh native stack. With no Paint
        // action to consume, the same shortcut closes the empty visit and
        // crosses the Studio boundary without racing its checkpoint restore.
        await openTab('Costumes');
        await assertPaintHistory({canUndo: false, canRedo: false});
        await pressHistory(false);
        await studioText('position 0/1', 45000);
        expect(await costume()).toMatchObject({assetId: before.assetId, dataFormat: 'svg'});
        await assertPaintHistory({canUndo: false, canRedo: false});
        await pressHistory(true);
        await studioText('position 1/1', 45000);
        expect(await costume()).toMatchObject({assetId: after.assetId, dataFormat: 'png'});

        await openTab('Code');
        await clickButton('Rewind');
        await studioText('position 0/1', 45000);
        await clickButton('Play');
        await studioText('played · 1 steps', 45000);
        expect(await costume()).toMatchObject({assetId: after.assetId, dataFormat: 'png'});
        expect(await pointerCount()).toBe(0);
    });

    test('records a Stage backdrop visit as one semantic timeline update', async () => {
        const url = new URL(takeUrl);
        url.searchParams.set('studio-take', `selenium-backdrop-session-${Date.now()}`);
        url.searchParams.set('studio-cache', String(Date.now()));
        await loadTake(url.toString());
        await (await driver.wait(
            until.elementLocated(By.css('[data-studio-target="stage-selector"]')),
            20000
        )).click();
        const before = await costume();

        await openTab('Backdrops');
        await assertPaintHistory({canUndo: false, canRedo: false});
        await convertToBitmap();
        const after = await costume();
        await openTab('Code');
        await studioText('recording · 1 steps');

        expect((await journal()).transactions[0]).toMatchObject({
            kind: 'project-operation',
            operation: {
                type: 'backdrop-edit-session',
                targetRef: {isStage: true, name: 'Stage'},
                beforeEditingTargetRef: {isStage: true, name: 'Stage'},
                afterEditingTargetRef: {isStage: true, name: 'Stage'},
                editedCostumes: [expect.objectContaining({dataFormat: 'png'})]
            }
        });
        await pressHistory(false);
        await studioText('position 0/1', 45000);
        expect(await editingTarget()).toMatchObject({isStage: true, name: 'Stage'});
        expect(await costume()).toMatchObject({assetId: before.assetId, dataFormat: 'svg'});
        await pressHistory(true);
        await studioText('position 1/1', 45000);
        expect(await costume()).toMatchObject({assetId: after.assetId, dataFormat: 'png'});
    });
});
