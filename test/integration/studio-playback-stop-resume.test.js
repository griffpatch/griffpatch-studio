import webdriver from 'selenium-webdriver';
import SeleniumHelper from '../helpers/selenium-helper';
import {STUDIO_MATRIX_STEP_COUNT} from '../helpers/studio-matrix';

const {By, Key, until} = webdriver;

const helper = new SeleniumHelper();
const describeBrowser = process.env.STUDIO_BROWSER_URL ? describe : describe.skip;

describeBrowser('Tutorial Studio realistic Play stop and resume', () => {
    let driver;
    let takeUrl;
    let stepCount;

    const bodyText = () => driver.findElement(By.css('body')).getText();
    const panelText = () => driver.executeScript(`
        return document.querySelector('#tw-studio-session-panel').innerText;
    `);

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
    };

    const setSpeed = value => driver.executeScript(`
        const speed = document.querySelector('#tw-studio-speed');
        speed.value = String(arguments[0]);
        speed.dispatchEvent(new Event('change', {bubbles: true}));
    `, value);

    const assertHealthy = async () => {
        const source = await driver.getPageSource();
        expect(source).not.toContain('— restored');
        expect(source).not.toContain('state mismatch');
        expect(source).not.toContain('reload required');
    };

    const playAtFourTimes = async () => {
        await setSpeed(4);
        await clickButton('Play');
        await studioText(`played · ${stepCount} steps`, 90000);
        await studioText(`position ${stepCount}/${stepCount}`);
        await assertHealthy();
    };

    beforeAll(() => {
        driver = helper.getDriver();
        const url = new URL(process.env.STUDIO_BROWSER_URL);
        url.searchParams.set('studio-session', '1');
        url.searchParams.set('studio-take', `selenium-play-stop-resume-${Date.now()}`);
        url.searchParams.set('studio-pointer-model', 'natural');
        url.searchParams.set('studio-connection-matrix-fixture', '1');
        url.searchParams.set('studio-build', 'selenium-play-stop-resume');
        url.searchParams.set('studio-cache', String(Date.now()));
        url.searchParams.set('studio-debug', '1');
        takeUrl = url.toString();
    });

    afterAll(async () => {
        if (driver) await driver.quit();
    });

    test('stops at a safe cursor and resumes through history and reload', async () => {
        await helper.loadUri(takeUrl);
        await clickButton('Seed Matrix');
        await driver.wait(until.elementIsEnabled(await driver.findElement(
            By.xpath("//button[normalize-space(.)='Seed Matrix']")
        )), 30000);
        stepCount = STUDIO_MATRIX_STEP_COUNT;
        await studioText(`recording · ${stepCount} steps`);
        await studioText(`position ${stepCount}/${stepCount}`);
        await clickButton('Rewind');
        await studioText(`position 0/${stepCount}`, 90000);

        await setSpeed(0.5);
        await clickButton('Play');
        const activeCursor = await driver.wait(async () => {
            const text = await panelText();
            const match = text.match(new RegExp(`playing[^\\n]*position (\\d+)\\/${stepCount}`));
            if (!match) return false;
            const cursor = Number(match[1]);
            return cursor > 0 && cursor < stepCount ? cursor : false;
        }, 90000);

        const body = await driver.findElement(By.css('body'));
        // Observe settlement rather than adding a wait before the next user
        // input. Escape and Undo arrive in one real keyboard action chain.
        await driver.executeScript(`
            window.__stoppedHistory=[];
            const session=window.__TURBOWARP_TUTORIAL_STUDIO_SESSION__;
            window.__stopUndoCalls=[];
            window.__stopOriginalUndo=session.undo;
            session.undo=function(...args) {
                window.__stopUndoCalls.push(session.getState().cursor);
                return window.__stopOriginalUndo.apply(this,args);
            };
            window.__stopHistoryObserver=session.subscribe(state=>{
                window.__stoppedHistory.push({status:state.status,cursor:state.cursor,
                    busy:state.busy,queue:state.historyCommandActive});
            });
        `);
        await driver.actions().sendKeys(Key.ESCAPE)
            .keyDown(Key.CONTROL)
            .sendKeys('z')
            .keyUp(Key.CONTROL)
            .perform();
        await studioText(`undone · ${stepCount} steps`, 30000);
        const stopTrace = await driver.executeScript(`
            window.__stopHistoryObserver();
            window.__TURBOWARP_TUTORIAL_STUDIO_SESSION__.undo=window.__stopOriginalUndo;
            return window.__stoppedHistory;
        `);
        const stopped = stopTrace.find(state => state.status === 'stopped');
        expect(stopped).toBeDefined();
        const stoppedCursor = stopped.cursor;
        expect(stoppedCursor).toBeGreaterThanOrEqual(activeCursor);
        expect(stoppedCursor).toBeLessThan(stepCount);
        await studioText(`position ${stoppedCursor - 1}/${stepCount}`, 30000);
        // Freshness notifications may republish an unchanged "undoing" state.
        // Count real command invocations, not subscriber notifications, while
        // still requiring the exact one-step result and healthy playback.
        expect(await driver.executeScript('return window.__stopUndoCalls;')).toEqual([stoppedCursor]);
        expect(stopTrace.some(state => state.status === 'undoing')).toBe(true);
        expect(stopTrace.some(state => state.queue)).toBe(true);
        await assertHealthy();

        await playAtFourTimes();

        await body.sendKeys(Key.chord(Key.CONTROL, 'z'));
        await studioText(`position ${stepCount - 1}/${stepCount}`, 30000);
        await body.sendKeys(Key.chord(Key.CONTROL, Key.SHIFT, 'z'));
        await studioText(`position ${stepCount}/${stepCount}`, 30000);
        await assertHealthy();

        await driver.navigate().refresh();
        await studioText(`ready to play · ${stepCount} steps`, 30000);
        await studioText(`position 0/${stepCount}`);
        await playAtFourTimes();
    }, 240000);
});
