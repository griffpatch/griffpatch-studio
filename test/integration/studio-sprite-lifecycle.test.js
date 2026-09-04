import webdriver from 'selenium-webdriver';
import SeleniumHelper from '../helpers/selenium-helper';
import {performStudioHistoryEdit} from '../helpers/studio-history';

const {Button, By, Key, until} = webdriver;

const helper = new SeleniumHelper();
const describeBrowser = process.env.STUDIO_BROWSER_URL ? describe : describe.skip;

jest.setTimeout(120000);

describeBrowser('Tutorial Studio sprite lifecycle', () => {
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
                        `Studio failed while waiting for ${text}:\n${JSON.stringify(diagnostics, null, 2)}`
                    );
                }
                return body.includes(text);
            }, timeout);
        } catch (error) {
            throw new Error(
                `Timed out waiting for Studio text: ${text}\nVisible body:\n${await bodyText()}`,
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

    const setSpeed = value => driver.executeScript(`
        document.querySelector('#tw-studio-speed').value = String(arguments[0]);
    `, value);

    const spriteNames = () => driver.executeScript(`
        return window.vm.runtime.targets
            .filter(target => target.isOriginal && !target.isStage)
            .map(target => target.getName());
    `);

    const waitForSpriteNames = expected => driver.wait(async () => (
        JSON.stringify(await spriteNames()) === JSON.stringify(expected)
    ), 20000);

    const journal = () => driver.executeScript(`
        return JSON.parse(document.querySelector('#tw-studio-journal-debug').textContent).journal;
    `);

    const nativePresentation = () => driver.executeScript(`
        const value = JSON.parse(document.querySelector('#tw-studio-native-evidence').textContent);
        return value.nativeInteraction || value;
    `);

    const assertHealthy = async () => {
        const source = await driver.getPageSource();
        expect(source).not.toContain('— restored');
        expect(source).not.toContain('state mismatch');
        expect(source).not.toContain('reload required');
    };

    const pressHistory = redo => performStudioHistoryEdit(driver, redo);

    const play = async () => {
        await setSpeed(4);
        await clickButton('Play');
        await studioText('played · 3 steps (3 events) · position 3/3', 90000);
        expect(await nativePresentation()).toMatchObject({
            status: 'verified',
            plan: {kind: 'sprite-delete-click'},
            evidence: {
                controlsVisible: true,
                projectMatches: true,
                pointerTravel: {completed: true, model: 'natural'}
            }
        });
        await waitForSpriteNames(['Sprite1']);
        await assertHealthy();
    };

    beforeAll(async () => {
        driver = helper.getDriver();
        await driver.manage()
            .window()
            .setSize(1440, 900);
        const url = new URL(process.env.STUDIO_BROWSER_URL);
        url.searchParams.set('studio-session', '1');
        url.searchParams.set('studio-take', `selenium-sprite-lifecycle-${Date.now()}`);
        url.searchParams.set('studio-pointer-model', 'natural');
        url.searchParams.set('studio-build', 'selenium-sprite-lifecycle');
        url.searchParams.set('studio-cache', String(Date.now()));
        url.searchParams.set('studio-debug', '1');
        takeUrl = url.toString();
    });

    afterAll(async () => {
        if (driver) await driver.quit();
    });

    test('duplicates, renames and deletes through real controls before and after reload', async () => {
        await helper.loadUri(takeUrl);
        const sprite1 = await driver.wait(
            until.elementLocated(By.css('[data-studio-sprite-name="Sprite1"]')),
            20000
        );
        await driver.actions()
            .click(sprite1, Button.RIGHT)
            .perform();
        const duplicate = await driver.wait(
            until.elementIsVisible(await driver.findElement(By.css(
                '[data-studio-target="sprite:Sprite1:duplicate"]'
            ))),
            20000
        );
        await duplicate.click();
        await studioText('recording · 1 steps (1 events) · position 1/1');
        await waitForSpriteNames(['Sprite1', 'Sprite2']);

        await (await driver.findElement(By.css('[data-studio-sprite-name="Sprite2"]'))).click();
        const nameInput = await driver.wait(
            until.elementLocated(By.css('[data-studio-target="sprite-name-input"]')),
            20000
        );
        await nameInput.sendKeys(Key.chord(Key.CONTROL, 'a'), 'Guide', Key.ENTER);
        await studioText('recording · 2 steps (2 events) · position 2/2');
        await waitForSpriteNames(['Sprite1', 'Guide']);

        const deleteButton = await driver.wait(
            until.elementIsVisible(await driver.findElement(By.css(
                '[data-studio-target="sprite:Guide:delete"]'
            ))),
            20000
        );
        await deleteButton.click();
        await studioText('recording · 3 steps (3 events) · position 3/3');
        await waitForSpriteNames(['Sprite1']);

        expect((await journal()).transactions.map(transaction => transaction.operation.type)).toEqual([
            'sprite-duplicate',
            'sprite-rename',
            'sprite-delete'
        ]);

        await pressHistory(false);
        await studioText('position 2/3');
        await waitForSpriteNames(['Sprite1', 'Guide']);
        await driver.findElement(By.css('[data-studio-sprite-name="Sprite1"]')).click();
        await driver.findElement(By.css('body')).sendKeys(Key.chord(Key.CONTROL, 'z'));
        await studioText('selected Guide — press Undo again');
        await studioText('position 2/3');
        await waitForSpriteNames(['Sprite1', 'Guide']);
        await pressHistory(false);
        await studioText('position 1/3');
        await waitForSpriteNames(['Sprite1', 'Sprite2']);
        await pressHistory(false);
        await studioText('position 0/3');
        await waitForSpriteNames(['Sprite1']);

        await pressHistory(true);
        await studioText('position 1/3');
        await waitForSpriteNames(['Sprite1', 'Sprite2']);
        await driver.findElement(By.css('[data-studio-sprite-name="Sprite1"]')).click();
        await driver.findElement(By.css('body')).sendKeys(Key.chord(Key.CONTROL, Key.SHIFT, 'z'));
        await studioText('selected Sprite2 — press Redo again');
        await studioText('position 1/3');
        await waitForSpriteNames(['Sprite1', 'Sprite2']);
        await pressHistory(true);
        await studioText('position 2/3');
        await waitForSpriteNames(['Sprite1', 'Guide']);
        await pressHistory(true);
        await studioText('position 3/3');
        await waitForSpriteNames(['Sprite1']);

        await clickButton('Rewind');
        await studioText('position 0/3');
        await waitForSpriteNames(['Sprite1']);
        await play();

        await clickButton('Rewind');
        await studioText('position 0/3');
        await driver.navigate().refresh();
        await studioText('ready to play · 3 steps (3 events) · position 0/3');
        await waitForSpriteNames(['Sprite1']);
        await play();
    });
});
