import webdriver from 'selenium-webdriver';
import SeleniumHelper from '../helpers/selenium-helper';

const {Button, By, Key, until} = webdriver;

const helper = new SeleniumHelper();
const describeBrowser = process.env.STUDIO_BROWSER_URL ? describe : describe.skip;

const MEOW_ASSET = '83c36d806dc92327b9e7049a565c6bff';
const BOING_ASSET = '53a3c2e27d1fb5fdb14aaf0cb41e7889';

describeBrowser('Tutorial Studio sound lifecycle', () => {
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

    const soundItem = (index, assetId) => driver.wait(until.elementLocated(By.css(
        `[data-studio-target="sound-item:${index}:${assetId}"]`
    )), 20000);

    const addLibrarySound = async md5ext => {
        await driver.findElement(By.css('[data-studio-target="sound-library-open"]')).click();
        const item = await driver.wait(until.elementLocated(By.css(
            `[data-studio-library-key="${md5ext}"]`
        )), 20000);
        await driver.executeScript('arguments[0].scrollIntoView({block: "center"});', item);
        await item.click();
    };

    const play = async () => {
        await setSpeed(4);
        await clickButton('Play');
        await studioText('played · 6 steps (6 events) · position 6/6', 90000);
        const presentation = await nativePresentation();
        expect(presentation).toMatchObject({
            status: 'verified',
            plan: {kind: 'sound-reorder-drag'},
            evidence: {
                controlsVisible: true,
                projectMatches: true,
                pointerTravel: {completed: true, model: 'natural'}
            }
        });
        const source = await driver.getPageSource();
        expect(source).not.toContain('— restored');
        expect(source).not.toContain('state mismatch');
        expect(source).not.toContain('reload required');
    };

    beforeAll(() => {
        driver = helper.getDriver();
        const url = new URL(process.env.STUDIO_BROWSER_URL);
        url.searchParams.set('studio-session', '1');
        url.searchParams.set('studio-take', `selenium-sound-lifecycle-${Date.now()}`);
        url.searchParams.set('studio-pointer-model', 'natural');
        url.searchParams.set('studio-build', 'selenium-sound-lifecycle');
        url.searchParams.set('studio-cache', String(Date.now()));
        url.searchParams.set('studio-debug', '1');
        takeUrl = url.toString();
    });

    afterAll(async () => {
        if (driver) await driver.quit();
    });

    test('replays duplicate, typed rename, delete and reorder before and after reload', async () => {
        await helper.loadUri(takeUrl);
        await driver.findElement(By.css('[data-studio-target="tab-sounds"]')).click();

        await addLibrarySound(`${MEOW_ASSET}.wav`);
        await studioText('recording · 1 steps');

        const meow = await soundItem(0, MEOW_ASSET);
        await driver.actions().click(meow, Button.RIGHT).perform();
        const duplicateSelector = `[data-studio-target="sound-item:0:${MEOW_ASSET}:duplicate"]`;
        const duplicate = await driver.wait(async () => {
            const matches = await driver.findElements(By.css(duplicateSelector));
            for (const match of matches) {
                if (await match.isDisplayed()) return match;
            }
            return null;
        }, 20000);
        await driver.actions().mouseMove(duplicate).click().perform();
        await studioText('recording · 2 steps');

        await (await soundItem(1, MEOW_ASSET)).click();
        const nameInput = await driver.wait(
            until.elementLocated(By.css('[data-studio-target="sound-name-input"]')),
            20000
        );
        await nameInput.sendKeys(Key.chord(Key.CONTROL, 'a'), 'Boom', Key.ENTER);
        await studioText('recording · 3 steps');

        const deleteButton = await driver.wait(until.elementLocated(By.css(
            `[data-studio-target="sound-item:1:${MEOW_ASSET}:delete"]`
        )), 20000);
        await deleteButton.click();
        await studioText('recording · 4 steps');

        await addLibrarySound(`${BOING_ASSET}.wav`);
        await studioText('recording · 5 steps');

        const boing = await soundItem(1, BOING_ASSET);
        const destination = await soundItem(0, MEOW_ASSET);
        await driver.actions()
            .mouseMove(boing)
            .mouseDown()
            .mouseMove(destination)
            .mouseUp()
            .perform();
        await studioText('recording · 6 steps (6 events) · position 6/6');

        const recorded = await journal();
        expect(recorded.transactions.map(transaction => transaction.operation.type)).toEqual([
            'sound-add',
            'sound-duplicate',
            'sound-rename',
            'sound-delete',
            'sound-add',
            'sound-reorder'
        ]);
        expect(recorded.transactions[1].operation).toMatchObject({
            soundIndex: 0,
            sourceSound: {assetId: MEOW_ASSET, name: 'Meow'},
            addedSound: {assetId: MEOW_ASSET, name: 'Meow2'}
        });
        expect(recorded.transactions[2].operation).toMatchObject({
            soundIndex: 1,
            requestedName: 'Boom',
            renamedSound: {assetId: MEOW_ASSET, name: 'Boom'}
        });
        expect(recorded.transactions[5].operation).toMatchObject({
            soundIndex: 1,
            newIndex: 0,
            movedSound: {assetId: BOING_ASSET, name: 'Boing'}
        });

        await clickButton('Rewind');
        await studioText('position 0/6', 90000);
        await play();

        await clickButton('Rewind');
        await studioText('position 0/6', 90000);
        await driver.navigate().refresh();
        await studioText('ready to play · 6 steps');
        await studioText('position 0/6');
        await play();
    }, 300000);
});
