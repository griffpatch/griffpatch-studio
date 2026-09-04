import webdriver from 'selenium-webdriver';
import SeleniumHelper from '../helpers/selenium-helper';

const {By, Key, until} = webdriver;

const helper = new SeleniumHelper();
const describeBrowser = process.env.STUDIO_BROWSER_URL ? describe : describe.skip;

describeBrowser('Tutorial Studio authoring dialogs', () => {
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

    const activeProcedureEditor = async () => driver.wait(async () => {
        const editor = await driver.switchTo().activeElement();
        const className = await editor.getAttribute('class');
        return className && className.includes('blocklyHtmlInput') ? editor : null;
    }, 20000);

    const replaceActiveProcedureText = async value => {
        const editor = await activeProcedureEditor();
        await editor.sendKeys(Key.chord(Key.CONTROL, 'a'), value);
    };

    const assertHealthy = async () => {
        const source = await driver.getPageSource();
        expect(source).not.toContain('— restored');
        expect(source).not.toContain('state mismatch');
        expect(source).not.toContain('reload required');
    };

    const play = async () => {
        await setSpeed(4);
        await clickButton('Play');
        await studioText('played · 5 steps', 90000);
        await assertHealthy();
        const presentation = await nativePresentation();
        expect(presentation).toMatchObject({
            status: 'verified',
            plan: {kind: 'broadcast-create-dialog'},
            evidence: {
                dialogVisibleBeforeSubmit: true,
                menuVisibleBeforeClick: true,
                pointerTravel: {completed: true, model: 'natural'}
            }
        });
        expect(presentation.evidence.intermediateValues.at(-1)).toBe('party time');
    };

    beforeAll(() => {
        driver = helper.getDriver();
        const url = new URL(process.env.STUDIO_BROWSER_URL);
        url.searchParams.set('studio-session', '1');
        url.searchParams.set('studio-take', `selenium-authoring-dialogs-${Date.now()}`);
        url.searchParams.set('studio-pointer-model', 'natural');
        url.searchParams.set('studio-build', 'selenium-authoring-dialogs');
        url.searchParams.set('studio-cache', String(Date.now()));
        url.searchParams.set('studio-debug', '1');
        takeUrl = url.toString();
    });

    afterAll(async () => {
        if (driver) await driver.quit();
    });

    test('replays variable, list, custom-block and broadcast dialogs before and after reload', async () => {
        await helper.loadUri(takeUrl);
        await helper.clickBlocksCategory('Variables');

        await helper.clickText('Make a Variable', helper.scope.blocksTab);
        let input = await driver.wait(
            until.elementLocated(By.css('[data-studio-target="prompt-variable-name"]')),
            20000
        );
        await input.sendKeys('cake');
        await driver.findElement(By.css('[data-studio-target="prompt-scope-local"]')).click();
        await driver.findElement(By.css('[data-studio-target="prompt-ok"]')).click();
        await studioText('recording · 1 steps');

        await helper.clickBlocksCategory('Variables');
        await helper.clickText('Make a List', helper.scope.blocksTab);
        input = await driver.wait(
            until.elementLocated(By.css('[data-studio-target="prompt-variable-name"]')),
            20000
        );
        await input.sendKeys('ingredients');
        await driver.findElement(By.css('[data-studio-target="prompt-ok"]')).click();
        await studioText('recording · 2 steps');

        await helper.clickBlocksCategory('My Blocks');
        await helper.clickText('Make a Block', helper.scope.blocksTab);
        await replaceActiveProcedureText('bake');
        await helper.clickText('number or text', helper.scope.modal);
        await replaceActiveProcedureText('amount');
        await helper.clickText('boolean', helper.scope.modal);
        await replaceActiveProcedureText('ready?');
        await driver.findElement(By.css('[data-studio-target="custom-procedure-ok"]')).click();
        await studioText('recording · 3 steps');

        await helper.clickBlocksCategory('Events');
        const flyoutBroadcast = await driver.wait(
            until.elementLocated(By.css('.blocklyFlyout g[data-id="event_broadcast"] > .blocklyPath')),
            20000
        );
        const workspace = await driver.findElement(By.css('svg.blocklySvg'));
        await driver.actions()
            .mouseMove(flyoutBroadcast)
            .mouseDown()
            .mouseMove(workspace, {x: 420, y: 360})
            .mouseUp()
            .perform();
        await studioText('recording · 4 steps');

        const broadcastField = await driver.wait(async () => {
            const fields = await driver.findElements(By.css('.blocklyWorkspace .blocklyEditableText'));
            for (const field of fields) {
                if ((await field.getText()).includes('message1')) return field;
            }
            return null;
        }, 20000);
        await broadcastField.click();
        await helper.clickText('New message');
        input = await driver.wait(
            until.elementLocated(By.css('[data-studio-target="prompt-variable-name"]')),
            20000
        );
        await input.sendKeys('party time');
        await driver.findElement(By.css('[data-studio-target="prompt-ok"]')).click();
        await studioText('recording · 5 steps');
        await studioText('position 5/5');

        const recorded = await journal();
        expect(recorded.transactions).toHaveLength(5);
        expect(recorded.transactions[0].events[0]).toMatchObject({
            type: 'var_create',
            details: {varName: 'cake', varType: '', isLocal: true}
        });
        expect(recorded.transactions[1].events[0]).toMatchObject({
            type: 'var_create',
            details: {varName: 'ingredients', varType: 'list'}
        });
        expect(JSON.stringify(recorded.transactions[2])).toContain('bake %s %b');
        expect(JSON.stringify(recorded.transactions[4])).toContain('party time');

        await clickButton('Rewind');
        await studioText('position 0/5', 90000);
        await play();

        await driver.navigate().refresh();
        await studioText('ready to play · 5 steps');
        await studioText('position 0/5');
        await play();
    }, 240000);
});
