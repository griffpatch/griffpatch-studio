import webdriver from 'selenium-webdriver';
import SeleniumHelper from '../helpers/selenium-helper';
import {performStudioHistoryEdit} from '../helpers/studio-history';

const {By, until} = webdriver;

const helper = new SeleniumHelper();
const describeBrowser = process.env.STUDIO_BROWSER_URL ? describe : describe.skip;

describeBrowser('Tutorial Studio target operations', () => {
    let driver;
    let takeUrl;

    const bodyText = () => driver.findElement(By.css('body')).getText();

    const studioText = async text => {
        try {
            return await driver.wait(async () => {
                const body = await bodyText();
                if (body.includes('— restored')) {
                    const diagnostics = await driver.executeScript(`
                        return {
                            diagnostic: document.querySelector('#tw-studio-diagnostic')?.textContent || '',
                            evidence: document.querySelector('#tw-studio-native-evidence')?.textContent || '',
                            journal: document.querySelector('#tw-studio-journal-debug')?.textContent || ''
                        };
                    `);
                    throw new Error(`Studio restored while waiting for ${text}:\n${JSON.stringify(diagnostics, null, 2)}`);
                }
                return body.includes(text);
            }, 20000);
        } catch (error) {
            throw new Error(`Timed out waiting for Studio text: ${text}\nVisible body:\n${await bodyText()}`, {cause: error});
        }
    };

    const clickButton = async name => {
        const button = await driver.wait(
            until.elementLocated(By.xpath(`//button[normalize-space(.)='${name}']`)),
            20000
        );
        await button.click();
    };

    const targetOrder = () => driver.executeScript(`
        return window.vm.runtime.targets
            .filter(target => target.isOriginal)
            .map(target => target.getName());
    `);

    const waitForTargetOrder = expected => driver.wait(async () => {
        const actual = await targetOrder();
        return JSON.stringify(actual) === JSON.stringify(expected);
    }, 20000);

    const blockCount = targetName => driver.executeScript(`
        const target = window.vm.runtime.targets.find(candidate =>
            candidate.isOriginal && candidate.getName() === arguments[0]
        );
        return target ? Object.keys(target.blocks._blocks).length : null;
    `, targetName);

    const waitForBlockCount = (targetName, expected) => driver.wait(
        async () => (await blockCount(targetName)) === expected,
        20000
    );

    const assertHealthy = async () => {
        const source = await driver.getPageSource();
        expect(source).not.toContain('— restored');
        expect(source).not.toContain('state mismatch');
        expect(source).not.toContain('reload required');
    };

    const nativeEvidence = () => driver.executeScript(`
        const text = document.querySelector('#tw-studio-native-evidence')?.textContent || '';
        return text ? JSON.parse(text) : null;
    `);

    const assertNativePresentation = async kind => {
        const result = await nativeEvidence();
        // Project operations expose checkpoint validation at the outer layer
        // and retain the GUI-interaction proof as the nested native result.
        const presentation = result && result.nativeInteraction ? result.nativeInteraction : result;
        expect(presentation).toMatchObject({
            status: 'verified',
            plan: {kind},
            evidence: {
                controlsVisible: true,
                projectMatches: true,
                pointerTravel: {completed: true, model: 'natural'}
            }
        });
        expect(presentation.evidence.pointerTravel.frames.length).toBeGreaterThan(1);
    };

    const pressHistory = redo => performStudioHistoryEdit(driver, redo);

    const playFromStart = async (transactionCount, expectedNativeKind = null) => {
        await clickButton('Play');
        await studioText(`played · ${transactionCount} steps`);
        await assertHealthy();
        if (expectedNativeKind) await assertNativePresentation(expectedNativeKind);
    };

    beforeAll(() => {
        driver = helper.getDriver();
        const url = new URL(process.env.STUDIO_BROWSER_URL);
        url.searchParams.set('studio-session', '1');
        url.searchParams.set('studio-take', `selenium-target-operations-${Date.now()}`);
        url.searchParams.set('studio-pointer-model', 'natural');
        url.searchParams.set('studio-build', 'selenium-target-operations');
        url.searchParams.set('studio-cache', String(Date.now()));
        url.searchParams.set('studio-debug', '1');
        takeUrl = url.toString();
    });

    afterAll(async () => {
        if (driver) await driver.quit();
    });

    test('reorders sprite cards and preserves order through Undo, Redo, Play and reload', async () => {
        await helper.loadUri(takeUrl);
        const libraryButton = await driver.wait(
            until.elementLocated(By.css('[data-studio-target="sprite-library-open"]')),
            20000
        );
        await libraryButton.click();
        await helper.clickText('Apple', helper.scope.modal);
        await studioText('recording · 1 steps (1 events) · position 1/1');
        await waitForTargetOrder(['Stage', 'Sprite1', 'Apple']);

        const apple = await driver.wait(
            until.elementLocated(By.css('[data-studio-sprite-name="Apple"]')),
            20000
        );
        const sprite1 = await driver.wait(
            until.elementLocated(By.css('[data-studio-sprite-name="Sprite1"]')),
            20000
        );
        await driver.actions()
            .mouseMove(apple)
            .mouseDown()
            .mouseMove(sprite1)
            .mouseUp()
            .perform();

        await studioText('Reorder sprite — Apple');
        await studioText('recording · 2 steps (2 events) · position 2/2');
        await waitForTargetOrder(['Stage', 'Apple', 'Sprite1']);

        await pressHistory(false);
        await studioText('undone · 2 steps (2 events) · position 1/2');
        await waitForTargetOrder(['Stage', 'Sprite1', 'Apple']);
        await assertHealthy();

        await pressHistory(true);
        await studioText('redone · 2 steps (2 events) · position 2/2');
        await waitForTargetOrder(['Stage', 'Apple', 'Sprite1']);
        await assertHealthy();

        await clickButton('Rewind');
        await studioText('position 0/2');
        await waitForTargetOrder(['Stage', 'Sprite1']);
        await playFromStart(2, 'sprite-reorder-drag');
        await waitForTargetOrder(['Stage', 'Apple', 'Sprite1']);

        await driver.navigate().refresh();
        await studioText('ready to play · 2 steps (2 events) · position 0/2');
        await waitForTargetOrder(['Stage', 'Sprite1']);
        await playFromStart(2, 'sprite-reorder-drag');
        await waitForTargetOrder(['Stage', 'Apple', 'Sprite1']);
    });

    test('copies a script by dragging it onto another sprite and replays the transfer', async () => {
        const url = new URL(takeUrl);
        url.searchParams.set('studio-take', `selenium-block-transfer-${Date.now()}`);
        url.searchParams.set('studio-cache', String(Date.now()));
        await helper.loadUri(url.toString());

        const libraryButton = await driver.wait(
            until.elementLocated(By.css('[data-studio-target="sprite-library-open"]')),
            20000
        );
        await libraryButton.click();
        await helper.clickText('Apple', helper.scope.modal);
        await studioText('position 1/1');

        const sprite1 = await driver.wait(
            until.elementLocated(By.css('[data-studio-sprite-name="Sprite1"]')),
            20000
        );
        await sprite1.click();
        const flyoutBlock = await driver.wait(
            until.elementLocated(By.css('.blocklyFlyout g[data-id="motion_movesteps"] > .blocklyPath')),
            20000
        );
        const workspace = await driver.findElement(By.css('svg.blocklySvg'));
        await driver.actions()
            .mouseMove(flyoutBlock)
            .mouseDown()
            .mouseMove(workspace, {x: 400, y: 180})
            .mouseUp()
            .perform();

        await studioText('Add move steps — Sprite1');
        await studioText('position 2/2');
        const copiedBlockCount = await blockCount('Sprite1');
        expect(copiedBlockCount).toBeGreaterThan(0);
        await waitForBlockCount('Apple', 0);

        const workspaceBlock = await driver.wait(
            until.elementLocated(By.css('.blocklyWorkspace > .blocklyBlockCanvas > g.blocklyDraggable > .blocklyPath')),
            20000
        );
        const apple = await driver.findElement(By.css('[data-studio-sprite-name="Apple"]'));
        await driver.actions()
            .mouseMove(workspaceBlock)
            .mouseDown()
            .mouseMove(apple)
            .mouseUp()
            .perform();

        await studioText('Copy script — Apple');
        await studioText('position 3/3');
        await waitForBlockCount('Sprite1', copiedBlockCount);
        await waitForBlockCount('Apple', copiedBlockCount);

        await pressHistory(false);
        await studioText('undone');
        await studioText('position 2/3');
        await waitForBlockCount('Sprite1', copiedBlockCount);
        await waitForBlockCount('Apple', 0);
        await assertHealthy();

        await pressHistory(true);
        await studioText('redone');
        await studioText('position 3/3');
        await waitForBlockCount('Apple', copiedBlockCount);
        await assertHealthy();

        await clickButton('Rewind');
        await studioText('position 0/3');
        await waitForTargetOrder(['Stage', 'Sprite1']);
        await playFromStart(3, 'cross-sprite-script-drag');
        await waitForBlockCount('Sprite1', copiedBlockCount);
        await waitForBlockCount('Apple', copiedBlockCount);

        await driver.navigate().refresh();
        await studioText('ready to play');
        await studioText('position 0/3');
        await playFromStart(3, 'cross-sprite-script-drag');
        await waitForBlockCount('Sprite1', copiedBlockCount);
        await waitForBlockCount('Apple', copiedBlockCount);
    });
});
