import webdriver from 'selenium-webdriver';
import SeleniumHelper from '../helpers/selenium-helper';

const {By, Key, until} = webdriver;

const helper = new SeleniumHelper({windowWidth: 1600, windowHeight: 1000});
const describeBrowser = process.env.STUDIO_BROWSER_URL ? describe : describe.skip;

const FILE_MENU_XPATH = '//div[contains(@class, "menu-bar_menu-bar-item")]' +
    '[*[contains(@class, "menu-bar_collapsible-label")]//*[text()="File"]]';

describeBrowser('Tutorial Studio File New restart boundary', () => {
    let driver;
    let takeUrl;

    const bodyText = () => driver.findElement(By.css('body')).getText();

    const studioText = async (text, timeout = 30000) => {
        try {
            return await driver.wait(async () => {
                const body = await bodyText();
                if (body.includes('— restored') || body.includes('state mismatch') ||
                    body.includes('reload required')) {
                    const diagnostics = await driver.executeScript(`
                        return {
                            diagnostic: document.querySelector('#tw-studio-diagnostic')?.textContent || '',
                            evidence: document.querySelector('#tw-studio-native-evidence')?.textContent || '',
                            journal: document.querySelector('#tw-studio-journal-debug')?.textContent || ''
                        };
                    `);
                    throw new Error(
                        `Studio failed while waiting for ${text}:\n${JSON.stringify(diagnostics, null, 2)}`);
                }
                return body.includes(text);
            }, timeout);
        } catch (error) {
            throw new Error(
                `Timed out waiting for Studio text: ${text}\nVisible body:\n${await bodyText()}`, {cause: error});
        }
    };

    const clickButton = async name => {
        const button = await driver.wait(
            until.elementLocated(By.xpath(`//button[normalize-space(.)='${name}']`)),
            20000
        );
        await button.click();
    };

    const journalDebug = () => driver.executeScript(`
        return JSON.parse(document.querySelector('#tw-studio-journal-debug').textContent);
    `);

    const nativePresentation = () => driver.executeScript(`
        const result = JSON.parse(document.querySelector('#tw-studio-native-evidence').textContent);
        return result && result.nativeInteraction ? result.nativeInteraction : result;
    `);

    const targetNames = () => driver.executeScript(`
        return window.vm.runtime.targets
            .filter(target => target.isOriginal)
            .map(target => target.isStage ? 'Stage' : target.getName());
    `);

    const waitForTargetNames = expected => driver.wait(async () => (
        JSON.stringify(await targetNames()) === JSON.stringify(expected)
    ), 20000);

    const chooseApple = async () => {
        await driver.findElement(By.css('[data-studio-target="sprite-library-open"]')).click();
        await helper.clickText('Apple', helper.scope.modal);
    };

    const assertHealthy = async () => {
        const source = await driver.getPageSource();
        expect(source).not.toContain('— restored');
        expect(source).not.toContain('state mismatch');
        expect(source).not.toContain('reload required');
    };

    const playApple = async () => {
        await driver.executeScript(`
            document.querySelector('#tw-studio-speed').value = '4';
        `);
        await clickButton('Play');
        await studioText('played · 1 steps (1 events) · position 1/1', 90000);
        expect(await nativePresentation()).toMatchObject({
            status: 'verified',
            plan: {kind: 'sprite-library-select'},
            evidence: {
                libraryVisibleBeforeSelect: true,
                projectMatches: true,
                pointerTravel: {completed: true, model: 'natural'}
            }
        });
        await waitForTargetNames(['Stage', 'Sprite1', 'Apple']);
        await assertHealthy();
    };

    beforeAll(() => {
        driver = helper.getDriver();
        const url = new URL(process.env.STUDIO_BROWSER_URL);
        url.searchParams.set('studio-session', '1');
        url.searchParams.set('studio-take', `selenium-file-new-restart-${Date.now()}`);
        url.searchParams.set('studio-pointer-model', 'natural');
        url.searchParams.set('studio-build', 'selenium-file-new-restart');
        url.searchParams.set('studio-cache', String(Date.now()));
        url.searchParams.set('studio-debug', '1');
        takeUrl = url.toString();
    });

    afterAll(async () => {
        if (driver) await driver.quit();
    });

    test('discards the old take and records, rewinds, plays and reloads the new project', async () => {
        await helper.loadUri(takeUrl);
        await chooseApple();
        await studioText('recording · 1 steps (1 events) · position 1/1');
        await waitForTargetNames(['Stage', 'Sprite1', 'Apple']);
        const oldDebug = await journalDebug();
        expect(oldDebug.journal.transactions).toHaveLength(1);

        await helper.clickXpath(FILE_MENU_XPATH);
        await helper.clickXpath('//li[span[text()="New"]]');
        const alert = await driver.wait(until.alertIsPresent(), 5000);
        await alert.accept();

        await studioText('recording new project · 0 steps (0 events) · position 0/0', 30000);
        await waitForTargetNames(['Stage', 'Sprite1']);
        const resetDebug = await journalDebug();
        expect(resetDebug.journal.id).not.toBe(oldDebug.journal.id);
        expect(resetDebug.journal.transactions).toHaveLength(0);
        expect(resetDebug.journal.baseCheckpointId).not.toBe(oldDebug.journal.baseCheckpointId);
        expect(await driver.executeScript(`
            const timeline = document.querySelector('#tw-studio-timeline');
            return {value: timeline.value, max: timeline.max};
        `)).toEqual({value: '0', max: '0'});

        await chooseApple();
        await studioText('recording · 1 steps (1 events) · position 1/1');
        const restartedDebug = await journalDebug();
        expect(restartedDebug.journal.transactions).toHaveLength(1);
        expect(restartedDebug.journal.transactions[0].operation.type).toBe('sprite-create');

        await clickButton('Rewind');
        await studioText('position 0/1', 90000);
        await waitForTargetNames(['Stage', 'Sprite1']);
        await playApple();

        await clickButton('Rewind');
        await studioText('position 0/1', 90000);
        await driver.navigate().refresh();
        await studioText('ready to play · 1 steps');
        await studioText('position 0/1');
        await waitForTargetNames(['Stage', 'Sprite1']);
        await playApple();
    }, 180000);

    test('fresh block edits remain reversible after File New and persisted reload', async () => {
        const url = new URL(takeUrl);
        url.searchParams.set('studio-take', `selenium-file-new-blocks-${Date.now()}`);
        await helper.loadUri(url.toString());
        const addMotionBlock = async type => {
            await helper.clickBlocksCategory('Motion');
            const point = await driver.executeScript(`
                const ws=window.ScratchBlocks.getMainWorkspace().getFlyout().getWorkspace();
                const block=ws.getAllBlocks(false).find(candidate=>candidate.type===arguments[0]);
                const box=block.getSvgRoot().querySelector('.blocklyPath').getBoundingClientRect();
                return {x:Math.round(box.left+10),y:Math.round(box.top+14)};
            `, type);
            await driver.actions().move({origin: 'viewport', ...point})
                .press()
                .move({origin: 'viewport', x: 530, y: 240, duration: 600})
                .pause(120)
                .release()
                .perform();
            await studioText('position 1/1');
        };
        const scripts = () => driver.executeScript(`
            const target=window.vm.editingTarget;
            return Object.values(target.blocks._blocks).filter(block=>!block.shadow).map(block=>block.opcode).sort();
        `);
        await addMotionBlock('motion_movesteps');
        expect(await scripts()).toEqual(['motion_movesteps']);
        const oldJournal = (await journalDebug()).journal.id;

        await helper.clickXpath(FILE_MENU_XPATH);
        await helper.clickXpath('//li[span[text()="New"]]');
        await (await driver.wait(until.alertIsPresent(), 5000)).accept();
        await studioText('recording new project · 0 steps (0 events) · position 0/0');
        expect((await journalDebug()).journal.id).not.toBe(oldJournal);
        expect(await scripts()).toEqual([]);

        await addMotionBlock('motion_turnright');
        const history = async () => {
            const body = driver.findElement(By.css('body'));
            await body.sendKeys(Key.chord(Key.CONTROL, 'z')); await studioText('position 0/1');
            expect(await scripts()).toEqual([]);
            await body.sendKeys(Key.chord(Key.CONTROL, Key.SHIFT, 'z')); await studioText('position 1/1');
            expect(await scripts()).toEqual(['motion_turnright']);
            await assertHealthy();
        };
        await history();
        await clickButton('Rewind'); await studioText('position 0/1');
        expect(await scripts()).toEqual([]);
        await clickButton('Play'); await studioText('played · 1 steps');
        await history();
        await driver.navigate().refresh(); await studioText('position 0/1');
        expect(await scripts()).toEqual([]);
        await clickButton('Play'); await studioText('played · 1 steps');
        await history();
    }, 180000);
});
