import path from 'path';
import webdriver from 'selenium-webdriver';
import SeleniumHelper from '../helpers/selenium-helper';

const {By, until} = webdriver;

const helper = new SeleniumHelper();
const describeBrowser = process.env.STUDIO_BROWSER_URL ? describe : describe.skip;

jest.setTimeout(120000);

describeBrowser('Tutorial Studio costume creation', () => {
    let driver;
    let takeUrl;
    let journalKey;

    const studioText = async text => {
        try {
            return await driver.wait(async () => {
                const body = await driver.findElement(By.css('body')).getText();
                return body.includes(text);
            }, 30000);
        } catch (error) {
            const body = await driver.findElement(By.css('body')).getText();
            const url = await driver.getCurrentUrl();
            throw new Error(
                `Timed out waiting for Studio text: ${text}\nBrowser URL: ${url}\nVisible body:\n${body}`,
                {cause: error}
            );
        }
    };

    const clickButton = async name => {
        const button = await driver.wait(
            until.elementLocated(By.xpath(`//button[normalize-space(.)='${name}']`)),
            20000
        );
        await button.click();
    };

    const assetCount = targetName => driver.executeScript(`
        const target = window.vm.runtime.targets.find(candidate =>
            candidate.isOriginal && (candidate.isStage ? 'Stage' : candidate.getName()) === arguments[0]
        );
        return target ? target.getCostumes().length : null;
    `, targetName);

    const waitForAssetCount = async (targetName, count) => {
        try {
            return await driver.wait(async () => (await assetCount(targetName)) === count, 30000);
        } catch (error) {
            const actual = await assetCount(targetName);
            const body = await driver.findElement(By.css('body')).getText();
            throw new Error(
                `Timed out waiting for ${count} assets on ${targetName}; found ${actual}` +
                `\nVisible body:\n${body}`,
                {cause: error}
            );
        }
    };

    const summarizeJournal = serialized => {
        if (!serialized) return null;
        const journal = typeof serialized === 'string' ? JSON.parse(serialized) : serialized;
        return {
            id: journal.id,
            createdAtMs: journal.createdAtMs,
            transactionCount: journal.transactions.length,
            baseCheckpointId: journal.baseCheckpointId,
            baseProjectHash: journal.baseProjectHash,
            endProjectHash: journal.endProjectHash
        };
    };

    const waitForPlayback = () => driver.wait(async () => {
        const body = await driver.findElement(By.css('body')).getText();
        if (body.includes('played · 4 steps (4 events)')) return true;
        if (body.includes('— restored')) {
            const evidence = await driver.executeScript(
                'return document.querySelector("#tw-studio-native-evidence").textContent;'
            );
            throw new Error(`Studio restored failed native Play:\n${evidence}`);
        }
        return false;
    }, 30000);

    const playFromStart = async () => {
        await clickButton('Play');
        await waitForPlayback();
        await waitForAssetCount('Sprite1', 3);
        await waitForAssetCount('Stage', 3);
        const nativeInteraction = await driver.executeScript(
            'const value = JSON.parse(document.querySelector("#tw-studio-native-evidence").textContent);' +
            'return value.nativeInteraction || value;'
        );
        expect(nativeInteraction).toMatchObject({
            status: 'verified',
            plan: {kind: 'backdrop-paint-create'},
            evidence: {
                createControlVisible: true,
                projectMatches: true,
                pointerTravel: {completed: true, model: 'natural'}
            }
        });
        const source = await driver.getPageSource();
        expect(source).not.toContain('— restored');
        expect(source).not.toContain('state mismatch');
    };

    beforeAll(async () => {
        driver = helper.getDriver();
        await driver.manage()
            .window()
            .setSize(1440, 900);
        const url = new URL(process.env.STUDIO_BROWSER_URL);
        url.searchParams.set('studio-session', '1');
        url.searchParams.set('studio-take', `selenium-costume-create-${Date.now()}`);
        url.searchParams.set('studio-pointer-model', 'natural');
        url.searchParams.set('studio-build', 'selenium-costume-create');
        url.searchParams.set('studio-cache', String(Date.now()));
        url.searchParams.set('studio-debug', '1');
        takeUrl = url.toString();
        journalKey = `turbowarp-tutorial-studio/journal/v1/${url.searchParams.get('studio-take')}`;
    });

    afterAll(async () => {
        if (driver) await driver.quit();
    });

    test('uploads and paints through real controls, then replays before and after reload', async () => {
        await helper.loadUri(takeUrl);
        const costumesTab = await driver.wait(
            until.elementLocated(By.css('[data-studio-target="tab-costumes"]')),
            20000
        );
        await costumesTab.click();

        const uploadInput = await driver.wait(
            until.elementLocated(By.css('[data-studio-target="costume-upload-open-input"]')),
            20000
        );
        await uploadInput.sendKeys(path.resolve(__dirname, '../fixtures/100-100.svg'));
        await waitForAssetCount('Sprite1', 2);

        const menu = await driver.findElement(By.css('[data-studio-target="costume-library-open"]'));
        await driver.actions()
            .mouseMove(menu)
            .perform();
        await driver.sleep(500);
        const paint = await driver.wait(
            until.elementIsVisible(await driver.findElement(By.css('[data-studio-target="costume-paint-create"]'))),
            20000
        );
        await paint.click();
        await waitForAssetCount('Sprite1', 3);

        await driver.findElement(By.css('[data-studio-target="stage-selector"]')).click();
        const stageBackdropMenu = await driver.findElement(By.css(
            '[data-studio-target="backdrop-library-open"]'
        ));
        await driver.actions()
            .mouseMove(stageBackdropMenu)
            .perform();
        await driver.sleep(500);
        const backdropUploadInput = await driver.wait(
            until.elementLocated(By.css('[data-studio-target="backdrop-stage-upload-open-input"]')),
            20000
        );
        await backdropUploadInput.sendKeys(path.resolve(__dirname, '../fixtures/100-100.svg'));
        await waitForAssetCount('Stage', 2);

        const backdropMenu = await driver.findElement(By.css('[data-studio-target="backdrop-library-open"]'));
        await driver.actions()
            .mouseMove(backdropMenu)
            .perform();
        await driver.sleep(500);
        const backdropPaint = await driver.wait(
            until.elementIsVisible(await driver.findElement(By.css(
                '[data-studio-target="backdrop-stage-paint-create"]'
            ))),
            20000
        );
        await backdropPaint.click();
        await waitForAssetCount('Stage', 3);
        await studioText('recording · 4 steps (4 events) · position 4/4');

        await clickButton('Rewind');
        await studioText('position 0/4');
        await waitForAssetCount('Sprite1', 1);
        await waitForAssetCount('Stage', 1);
        await playFromStart();

        const persistedBeforeReload = await driver.executeScript(
            'return {href: location.href, journal: localStorage.getItem(arguments[0])};',
            journalKey
        );
        if (!persistedBeforeReload.journal) {
            throw new Error(`Studio journal was absent before reload: ${JSON.stringify(persistedBeforeReload)}`);
        }
        const beforeReloadJournal = JSON.parse(persistedBeforeReload.journal);
        await driver.sleep(3000);
        const settledBeforeReload = await driver.executeScript(
            'return {journal: localStorage.getItem(arguments[0]), ' +
            'truncations: window.__TURBOWARP_TUTORIAL_STUDIO_TRUNCATION_TRACE__ || []};',
            journalKey
        );
        const settledJournal = JSON.parse(settledBeforeReload.journal);
        if (settledJournal.transactions.length !== 4) {
            throw new Error(`Studio take changed before reload: ${JSON.stringify({
                journal: summarizeJournal(settledBeforeReload.journal),
                truncations: settledBeforeReload.truncations
            })}`);
        }

        await driver.navigate().refresh();
        const persistedAfterReload = await driver.executeScript(
            'return {href: location.href, journal: localStorage.getItem(arguments[0])};',
            journalKey
        );
        if (!persistedAfterReload.journal) {
            throw new Error(`Studio journal was absent after reload: ${JSON.stringify(persistedAfterReload)}`);
        }
        await driver.sleep(3000);
        const reloadState = await driver.executeScript(
            'const session = window.__TURBOWARP_TUTORIAL_STUDIO_SESSION__; ' +
            'return {state: session && session.getState(), journal: session && session.getJournal(), ' +
            'persisted: localStorage.getItem(arguments[0]), ' +
            'truncations: window.__TURBOWARP_TUTORIAL_STUDIO_TRUNCATION_TRACE__ || []};',
            journalKey
        );
        if (!reloadState.state || reloadState.state.stepCount !== 4) {
            throw new Error(`Studio take changed during reload: ${JSON.stringify({
                before: summarizeJournal(beforeReloadJournal),
                after: {
                    state: reloadState.state && {
                        status: reloadState.state.status,
                        stepCount: reloadState.state.stepCount,
                        cursor: reloadState.state.cursor,
                        transactionCount: reloadState.state.transactionCount,
                        projectReplaced: reloadState.state.projectReplaced,
                        diagnostic: reloadState.state.diagnostic
                    },
                    journal: summarizeJournal(reloadState.journal),
                    persisted: summarizeJournal(reloadState.persisted),
                    truncations: reloadState.truncations
                }
            })}`);
        }
        await studioText('ready to play · 4 steps (4 events) · position 0/4');
        await waitForAssetCount('Sprite1', 1);
        await waitForAssetCount('Stage', 1);
        await playFromStart();
    });
});
