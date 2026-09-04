import webdriver from 'selenium-webdriver';
import SeleniumHelper from '../helpers/selenium-helper';

const {Button, By, Key, until} = webdriver;

const helper = new SeleniumHelper();
const describeBrowser = process.env.STUDIO_BROWSER_URL ? describe : describe.skip;

describeBrowser('Tutorial Studio costume and backdrop lifecycle', () => {
    let driver;
    let takeUrl;

    const bodyText = () => driver.findElement(By.css('body')).getText();

    const studioText = async (text, timeout = 30000) => {
        try {
            return await driver.wait(async () => {
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

    const setSpeed = value => driver.executeScript(`
        document.querySelector('#tw-studio-speed').value = String(arguments[0]);
    `, value);

    const journal = () => driver.executeScript(`
        return JSON.parse(document.querySelector('#tw-studio-journal-debug').textContent).journal;
    `);

    const nativePresentation = () => driver.executeScript(`
        const result = JSON.parse(document.querySelector('#tw-studio-native-evidence').textContent);
        return result && result.nativeInteraction ? result.nativeInteraction : result;
    `);

    const assetState = targetName => driver.executeScript(`
        const target = window.vm.runtime.targets.find(candidate =>
            candidate.isOriginal && (candidate.isStage ? 'Stage' : candidate.getName()) === arguments[0]
        );
        return target ? target.getCostumes().map(costume => ({
            assetId: costume.assetId,
            name: costume.name
        })) : null;
    `, targetName);

    const waitForAssetNames = (targetName, expected) => driver.wait(async () => {
        const state = await assetState(targetName);
        return state && JSON.stringify(state.map(item => item.name)) === JSON.stringify(expected);
    }, 20000);

    const assetItem = (kind, index, assetId) => driver.wait(until.elementLocated(By.css(
        `[data-studio-target="${kind}-item:${index}:${assetId}"]`
    )), 20000);

    const duplicateAsset = async (kind, index, assetId) => {
        await driver.actions().click(await assetItem(kind, index, assetId), Button.RIGHT).perform();
        const selector = `[data-studio-target="${kind}-item:${index}:${assetId}:duplicate"]`;
        const duplicate = await driver.wait(async () => {
            const matches = await driver.findElements(By.css(selector));
            for (const match of matches) {
                if (await match.isDisplayed()) return match;
            }
            return null;
        }, 20000);
        await driver.actions().mouseMove(duplicate).click().perform();
    };

    const renameSelectedAsset = async name => {
        const input = await driver.wait(until.elementLocated(By.css(
            '[data-studio-target="costume-editor"] input[type="text"]'
        )), 20000);
        await input.sendKeys(Key.chord(Key.CONTROL, 'a'), name, Key.ENTER);
    };

    const reorderAsset = async (kind, sourceIndex, sourceAssetId, destinationIndex, destinationAssetId) => {
        const source = await assetItem(kind, sourceIndex, sourceAssetId);
        const destination = await assetItem(kind, destinationIndex, destinationAssetId);
        await driver.actions()
            .mouseMove(source)
            .mouseDown()
            .mouseMove(destination)
            .mouseUp()
            .perform();
    };

    const deleteAsset = async (kind, index, assetId) => {
        await driver.actions().click(await assetItem(kind, index, assetId), Button.RIGHT).perform();
        const selector = `[data-studio-target="${kind}-item:${index}:${assetId}:delete-menu"]`;
        const button = await driver.wait(async () => {
            const matches = await driver.findElements(By.css(selector));
            for (const match of matches) {
                if (await match.isDisplayed()) return match;
            }
            return null;
        }, 20000);
        await driver.actions().mouseMove(button).click().perform();
    };

    const seek = async position => {
        await driver.executeScript(`
            const timeline = document.querySelector('#tw-studio-timeline');
            timeline.value = String(arguments[0]);
            timeline.dispatchEvent(new Event('input', {bubbles: true}));
            timeline.dispatchEvent(new Event('change', {bubbles: true}));
        `, position);
        await studioText(`position ${position}/8`, 90000);
    };

    const pointerCount = () => driver.executeScript(`
        return document.querySelectorAll('#tw-studio-native-pointer').length;
    `);

    const pointerState = () => driver.executeScript(`
        const pointer = document.querySelector('#tw-studio-native-pointer');
        return pointer ? {
            idle: pointer.dataset.idle || null,
            fading: pointer.dataset.fading || null,
            opacity: getComputedStyle(pointer).opacity
        } : null;
    `);

    const verifyIdlePointerFade = async () => {
        const startedAt = Date.now();
        const idle = await driver.wait(async () => {
            const state = await pointerState();
            return state && state.idle === 'true' && state.opacity === '1' ? state : null;
        }, 2000);
        expect(idle).toMatchObject({idle: 'true', fading: null, opacity: '1'});
        const fading = await driver.wait(async () => {
            const state = await pointerState();
            return state && state.fading === 'true' ? state : null;
        }, 4000);
        expect(fading).toMatchObject({idle: null, fading: 'true'});
        expect(Date.now() - startedAt).toBeGreaterThanOrEqual(1700);
        await driver.wait(async () => (await pointerCount()) === 0, 2000);
    };

    const assertHealthy = async () => {
        const source = await driver.getPageSource();
        expect(source).not.toContain('— restored');
        expect(source).not.toContain('state mismatch');
        expect(source).not.toContain('reload required');
    };

    const play = async ({verifyPointerFade = false} = {}) => {
        await setSpeed(4);
        await clickButton('Play');
        await studioText('played · 8 steps (8 events) · position 8/8', 120000);
        const presentation = await nativePresentation();
        expect(presentation).toMatchObject({
            status: 'verified',
            plan: {kind: 'backdrop-delete-click'},
            evidence: {
                controlsVisible: true,
                projectMatches: true,
                pointerTravel: {completed: true, model: 'natural'}
            }
        });
        expect(await pointerCount()).toBe(1);
        await assertHealthy();
        if (verifyPointerFade) await verifyIdlePointerFade();
    };

    beforeAll(() => {
        driver = helper.getDriver();
        const url = new URL(process.env.STUDIO_BROWSER_URL);
        url.searchParams.set('studio-session', '1');
        url.searchParams.set('studio-take', `selenium-costume-lifecycle-${Date.now()}`);
        url.searchParams.set('studio-pointer-model', 'natural');
        url.searchParams.set('studio-build', 'selenium-costume-lifecycle');
        url.searchParams.set('studio-cache', String(Date.now()));
        url.searchParams.set('studio-debug', '1');
        takeUrl = url.toString();
    });

    afterAll(async () => {
        if (driver) await driver.quit();
    });

    test('replays duplicate-ID assets, settled reorders and pointer-free scrubbing after reload', async () => {
        await helper.loadUri(takeUrl);
        await driver.findElement(By.css('[data-studio-target="tab-costumes"]')).click();

        const initialCostumes = await assetState('Sprite1');
        expect(initialCostumes).toHaveLength(1);
        await duplicateAsset('costume', 0, initialCostumes[0].assetId);
        await studioText('recording · 1 steps');

        await (await assetItem('costume', 1, initialCostumes[0].assetId)).click();
        await renameSelectedAsset('Hero');
        await studioText('recording · 2 steps');

        await reorderAsset('costume', 1, initialCostumes[0].assetId, 0, initialCostumes[0].assetId);
        await studioText('recording · 3 steps');
        await waitForAssetNames('Sprite1', ['Hero', ...initialCostumes.map(item => item.name)]);

        await deleteAsset('costume', 0, initialCostumes[0].assetId);
        await studioText('recording · 4 steps');
        await waitForAssetNames('Sprite1', initialCostumes.map(item => item.name));

        await driver.findElement(By.css('[data-studio-target="stage-selector"]')).click();
        const initialBackdrops = await assetState('Stage');
        expect(initialBackdrops).toHaveLength(1);
        await duplicateAsset('backdrop', 0, initialBackdrops[0].assetId);
        await studioText('recording · 5 steps');

        await (await assetItem('backdrop', 1, initialBackdrops[0].assetId)).click();
        await renameSelectedAsset('Night');
        await studioText('recording · 6 steps');

        await reorderAsset('backdrop', 1, initialBackdrops[0].assetId, 0, initialBackdrops[0].assetId);
        await studioText('recording · 7 steps');
        await waitForAssetNames('Stage', ['Night', initialBackdrops[0].name]);

        await deleteAsset('backdrop', 0, initialBackdrops[0].assetId);
        await studioText('recording · 8 steps (8 events) · position 8/8');
        await waitForAssetNames('Stage', initialBackdrops.map(item => item.name));

        const recorded = await journal();
        expect(recorded.transactions.map(transaction => transaction.operation.type)).toEqual([
            'costume-duplicate',
            'costume-rename',
            'costume-reorder',
            'costume-delete',
            'backdrop-duplicate',
            'backdrop-rename',
            'backdrop-reorder',
            'backdrop-delete'
        ]);
        expect(recorded.transactions[0].operation.sourceCostume.assetId).toBe(
            recorded.transactions[0].operation.addedCostume.assetId
        );
        expect(recorded.transactions[4].operation.sourceCostume.assetId).toBe(
            recorded.transactions[4].operation.addedCostume.assetId
        );

        await clickButton('Rewind');
        await studioText('position 0/8', 90000);
        await play();

        await seek(3);
        expect(await pointerCount()).toBe(0);
        await waitForAssetNames('Sprite1', ['Hero', ...initialCostumes.map(item => item.name)]);
        await waitForAssetNames('Stage', initialBackdrops.map(item => item.name));

        await seek(8);
        expect(await pointerCount()).toBe(0);
        await waitForAssetNames('Sprite1', initialCostumes.map(item => item.name));
        await waitForAssetNames('Stage', initialBackdrops.map(item => item.name));
        await assertHealthy();

        await clickButton('Rewind');
        await studioText('position 0/8', 90000);
        await driver.navigate().refresh();
        await studioText('ready to play · 8 steps');
        await studioText('position 0/8');
        await play({verifyPointerFade: true});
    }, 300000);
});
