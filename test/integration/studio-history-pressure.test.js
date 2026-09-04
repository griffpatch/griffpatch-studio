import webdriver from 'selenium-webdriver';
import SeleniumHelper from '../helpers/selenium-helper';
import {STUDIO_MATRIX_STEP_COUNT} from '../helpers/studio-matrix';

const {By, Key, until} = webdriver;

const helper = new SeleniumHelper();
const describeBrowser = process.env.STUDIO_BROWSER_URL ? describe : describe.skip;

describeBrowser('Tutorial Studio queued history and branching', () => {
    let driver;
    let takeUrl;

    const bodyText = () => driver.findElement(By.css('body')).getText();

    const studioText = async (text, timeout = 60000) => {
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
        await driver.wait(until.elementIsEnabled(button), 20000);
        await button.click();
        return button;
    };

    const setSpeed = value => driver.executeScript(`
        document.querySelector('#tw-studio-speed').value = String(arguments[0]);
    `, value);

    const pressBurst = async (redo, count) => {
        const body = await driver.findElement(By.css('body'));
        const keys = Array.from({length: count}, () => 'z');
        await body.sendKeys(Key.chord(Key.CONTROL, ...(redo ? [Key.SHIFT, ...keys] : keys)));
    };

    const journal = () => driver.executeScript(`
        return JSON.parse(document.querySelector('#tw-studio-journal-debug').textContent).journal;
    `);

    const assertHealthy = async () => {
        const source = await driver.getPageSource();
        expect(source).not.toContain('— restored');
        expect(source).not.toContain('state mismatch');
        expect(source).not.toContain('reload required');
    };

    const play = async transactionCount => {
        await setSpeed(4);
        await clickButton('Play');
        await studioText(`played · ${transactionCount} steps`, 90000);
        await assertHealthy();
    };

    beforeAll(() => {
        driver = helper.getDriver();
        const url = new URL(process.env.STUDIO_BROWSER_URL);
        url.searchParams.set('studio-session', '1');
        url.searchParams.set('studio-take', `selenium-history-pressure-${Date.now()}`);
        url.searchParams.set('studio-pointer-model', 'natural');
        url.searchParams.set('studio-connection-matrix-fixture', '1');
        url.searchParams.set('studio-build', 'selenium-history-pressure');
        url.searchParams.set('studio-cache', String(Date.now()));
        url.searchParams.set('studio-debug', '1');
        takeUrl = url.toString();
    });

    afterAll(async () => {
        if (driver) await driver.quit();
    });

    test('queues burst Undo/Redo and safely replaces the abandoned future', async () => {
        await helper.loadUri(takeUrl);
        const seedButton = await clickButton('Seed Matrix');
        await driver.wait(async () => !(await seedButton.isEnabled()), 20000);
        await driver.wait(until.elementIsEnabled(seedButton), 60000);
        await studioText(`recording · ${STUDIO_MATRIX_STEP_COUNT} steps`);
        await studioText(`position ${STUDIO_MATRIX_STEP_COUNT}/${STUDIO_MATRIX_STEP_COUNT}`);
        const seededTransactionCount = (await journal()).transactions.length;
        expect(seededTransactionCount).toBeGreaterThan(8);
        await studioText(`recording · ${seededTransactionCount} steps`);
        await studioText(`position ${seededTransactionCount}/${seededTransactionCount}`);
        await setSpeed(4);

        await pressBurst(false, 8);
        await studioText(`undone · ${seededTransactionCount} steps`);
        await studioText(`position ${seededTransactionCount - 8}/${seededTransactionCount}`, 90000);
        await assertHealthy();

        await pressBurst(true, 8);
        await studioText(`redone · ${seededTransactionCount} steps`);
        await studioText(`position ${seededTransactionCount}/${seededTransactionCount}`, 90000);
        await assertHealthy();

        await pressBurst(false, 4);
        await studioText(`position ${seededTransactionCount - 4}/${seededTransactionCount}`, 90000);
        await helper.clickBlocksCategory('Motion');
        const flyoutBlock = await driver.wait(
            until.elementLocated(By.css('.blocklyFlyout g[data-id="motion_turnleft"] > .blocklyPath')),
            20000
        );
        const workspace = await driver.findElement(By.css('svg.blocklySvg'));
        const workspaceRect = await workspace.getRect();
        await driver.actions()
            .move({origin: flyoutBlock})
            .press()
            .move({
                origin: 'viewport',
                x: Math.round(workspaceRect.x + 400),
                y: Math.round(workspaceRect.y + 180)
            })
            .release()
            .perform();

        const branchedTransactionCount = seededTransactionCount - 3;
        await studioText(`recording · ${branchedTransactionCount} steps`);
        await studioText(`position ${branchedTransactionCount}/${branchedTransactionCount}`);
        const branched = await journal();
        expect(branched.transactions).toHaveLength(branchedTransactionCount);
        expect(JSON.stringify(branched.transactions[branchedTransactionCount - 1])).toContain('motion_turnleft');

        await clickButton('Rewind');
        await studioText(`position 0/${branchedTransactionCount}`, 90000);
        await play(branchedTransactionCount);

        await driver.navigate().refresh();
        await studioText(`ready to play · ${branchedTransactionCount} steps`);
        await studioText(`position 0/${branchedTransactionCount}`);
        await play(branchedTransactionCount);
    }, 240000);
});
