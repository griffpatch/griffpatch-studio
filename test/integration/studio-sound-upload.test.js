import path from 'path';
import webdriver from 'selenium-webdriver';
import SeleniumHelper from '../helpers/selenium-helper';

const {By, until} = webdriver;

const helper = new SeleniumHelper();
const describeBrowser = process.env.STUDIO_BROWSER_URL ? describe : describe.skip;

describeBrowser('Tutorial Studio sound upload', () => {
    let driver;
    let takeUrl;

    const studioText = async text => {
        try {
            return await driver.wait(async () => {
                const body = await driver.findElement(By.css('body')).getText();
                return body.includes(text);
            }, 20000);
        } catch (error) {
            const body = await driver.findElement(By.css('body')).getText();
            throw new Error(`Timed out waiting for Studio text: ${text}\nVisible body:\n${body}`, {cause: error});
        }
    };

    const clickButton = async name => {
        const button = await driver.wait(
            until.elementLocated(By.xpath(`//button[normalize-space(.)='${name}']`)),
            20000
        );
        await button.click();
    };

    const waitForPlayback = () => driver.wait(async () => {
        const body = await driver.findElement(By.css('body')).getText();
        if (body.includes('played · 1 steps (1 events)')) return true;
        if (body.includes('— restored')) {
            const evidence = await driver.executeScript(
                'return document.querySelector("#tw-studio-native-evidence").textContent;'
            );
            throw new Error(`Studio restored failed native Play:\n${evidence}`);
        }
        return false;
    }, 20000);

    const playFromStart = async () => {
        await clickButton('Play');
        await waitForPlayback();
        await driver.wait(until.elementLocated(By.xpath("//input[@value='sneaker']")), 20000);
        const source = await driver.getPageSource();
        expect(source).not.toContain('— restored');
        expect(source).not.toContain('state mismatch');
    };

    const rewindAndPlay = async () => {
        await clickButton('Rewind');
        await studioText('position 0/1');
        await playFromStart();
    };

    beforeAll(() => {
        driver = helper.getDriver();
        const url = new URL(process.env.STUDIO_BROWSER_URL);
        url.searchParams.set('studio-session', '1');
        url.searchParams.set('studio-take', `selenium-sound-upload-${Date.now()}`);
        url.searchParams.set('studio-pointer-model', 'natural');
        url.searchParams.set('studio-build', 'selenium-sound-upload');
        url.searchParams.set('studio-cache', String(Date.now()));
        url.searchParams.set('studio-debug', '1');
        takeUrl = url.toString();
    });

    afterAll(async () => {
        if (driver) await driver.quit();
    });

    test('uploads the real WAV fixture and replays it before and after reload', async () => {
        await helper.loadUri(takeUrl);
        const soundsTab = await driver.wait(
            until.elementLocated(By.css('[data-studio-target="tab-sounds"]')),
            20000
        );
        await soundsTab.click();

        const uploadInput = await driver.wait(
            until.elementLocated(By.css('[data-studio-target="sound-upload-open-input"]')),
            20000
        );
        await uploadInput.sendKeys(path.resolve(__dirname, '../fixtures/sneaker.wav'));

        await driver.wait(until.elementLocated(By.xpath("//input[@value='sneaker']")), 20000);
        await studioText('recording · 1 steps (1 events) · position 1/1');
        await rewindAndPlay();

        await driver.navigate().refresh();
        await studioText('ready to play · 1 steps (1 events) · position 0/1');
        await playFromStart();
    });
});
