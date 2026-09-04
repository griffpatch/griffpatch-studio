import webdriver from 'selenium-webdriver';
import SeleniumHelper from '../helpers/selenium-helper';
import {STUDIO_MATRIX_STEP_COUNT as STEP_COUNT} from '../helpers/studio-matrix';

const {By, Key, until} = webdriver;

const helper = new SeleniumHelper();
const describeBrowser = process.env.STUDIO_BROWSER_URL ? describe : describe.skip;

describeBrowser('Tutorial Studio connection matrix', () => {
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
        await driver.wait(until.elementIsEnabled(button), 20000);
        await button.click();
    };

    const setControlValue = (selector, value, eventType = 'change') => driver.executeScript(`
        const control = document.querySelector(arguments[0]);
        control.value = String(arguments[1]);
        control.dispatchEvent(new Event(arguments[2], {bubbles: true}));
    `, selector, value, eventType);

    const clickTitledButton = async title => {
        const button = await driver.wait(
            until.elementLocated(By.css(`button[title="${title}"]`)),
            20000
        );
        await driver.wait(until.elementIsEnabled(button), 20000);
        await button.click();
    };

    const seek = async index => {
        await setControlValue('#tw-studio-timeline', index);
        await studioText(`position ${index}/${STEP_COUNT}`, 45000);
    };

    const journal = () => driver.executeScript(`
        return JSON.parse(document.querySelector('#tw-studio-journal-debug').textContent).journal;
    `);

    const nativeEvidence = () => driver.executeScript(`
        const result = JSON.parse(document.querySelector('#tw-studio-native-evidence').textContent);
        return result && result.nativeInteraction ? result.nativeInteraction : result;
    `);

    const assertHealthy = async () => {
        const source = await driver.getPageSource();
        expect(source).not.toContain('— restored');
        expect(source).not.toContain('state mismatch');
        expect(source).not.toContain('reload required');
    };

    const assertPresentationClean = async () => {
        const residue = await driver.executeScript(`
            const proxySelector = [
                '.tw-studio-history-lifecycle-proxy',
                '.tw-studio-history-displacement-proxy',
                '.tw-studio-history-primary-move-proxy'
            ].join(',');
            return {
                proxies: document.querySelectorAll(proxySelector).length,
                pointers: document.querySelectorAll('#tw-studio-native-pointer').length,
                hiddenWorkspaceBlocks: Array.from(
                    document.querySelectorAll('.blocklyBlockCanvas > .blocklyDraggable')
                ).filter(element => getComputedStyle(element).visibility === 'hidden')
                    .map(element => element.getAttribute('data-id')),
                nativeScenes: document.querySelectorAll('.blocklyTransitionWorkspace').length
            };
        `);
        expect(residue).toEqual({proxies: 0, pointers: 0, hiddenWorkspaceBlocks: [], nativeScenes: 0});
    };

    const historyKey = async redo => {
        const body = await driver.findElement(By.css('body'));
        await body.sendKeys(Key.chord(Key.CONTROL, ...(redo ? [Key.SHIFT, 'z'] : ['z'])));
    };

    const beginPresentationTrace = () => driver.executeScript(`
        const proxySelectors = [
            '.tw-studio-history-lifecycle-proxy',
            '.tw-studio-history-displacement-proxy',
            '.tw-studio-history-primary-move-proxy'
        ];
        const proxySelector = proxySelectors.join(',');
        const proxyBlockSelector = proxySelectors.map(selector =>
            selector + ' .blocklyDraggable').join(',');
        const trace = {active: true, frames: []};
        window.__studioPresentationTrace = trace;
        const sample = () => {
            if (!trace.active) return;
            const roots = [
                ...document.querySelectorAll('.blocklyBlockCanvas .blocklyDraggable'),
                ...document.querySelectorAll(proxyBlockSelector)
            ].filter(element => {
                const rect = element.getBoundingClientRect();
                const style = getComputedStyle(element);
                const canvas = element.closest('.blocklyBlockCanvas');
                return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' &&
                    (!canvas || Number(getComputedStyle(canvas).opacity) > 0.05) &&
                    Number(style.opacity || 1) > 0.05;
            });
            const counts = roots.reduce((result, element) => {
                const id = element.getAttribute('data-id');
                if (id) result[id] = (result[id] || 0) + 1;
                return result;
            }, {});
            trace.frames.push({
                duplicateIds: Object.keys(counts).filter(id => counts[id] > 1),
                nativeScenes: document.querySelectorAll('.blocklyTransitionWorkspace').length,
                proxyCount: document.querySelectorAll(proxySelector).length
            });
            requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
    `);

    const finishPresentationTrace = () => driver.executeScript(`
        const trace = window.__studioPresentationTrace || {frames: []};
        trace.active = false;
        return trace.frames;
    `);

    const play = async () => {
        await setControlValue('#tw-studio-speed', 4);
        await clickButton('Play');
        await studioText(`played · ${STEP_COUNT} steps`, 90000);
        await assertHealthy();
    };

    beforeAll(() => {
        driver = helper.getDriver();
        const url = new URL(process.env.STUDIO_BROWSER_URL);
        url.searchParams.set('studio-history-pointer', '0');
        url.searchParams.set('studio-session', '1');
        url.searchParams.set('studio-take', `selenium-connection-matrix-${Date.now()}`);
        url.searchParams.set('studio-pointer-model', 'natural');
        url.searchParams.set('studio-connection-matrix-fixture', '1');
        url.searchParams.set('studio-build', 'selenium-connection-matrix');
        url.searchParams.set('studio-cache', String(Date.now()));
        url.searchParams.set('studio-debug', '1');
        takeUrl = url.toString();
    });

    afterAll(async () => {
        if (driver) await driver.quit();
    });

    test('seeks, replays and reloads the full command/reporter/Boolean/shadow matrix', async () => {
        await helper.loadUri(takeUrl);
        await clickButton('Seed Matrix');
        await studioText(`recording · ${STEP_COUNT} steps`);
        await studioText(`position ${STEP_COUNT}/${STEP_COUNT}`);

        const recorded = await journal();
        expect(recorded.transactions).toHaveLength(STEP_COUNT);
        expect(recorded.transactions[33].events).toHaveLength(3);
        expect(recorded.transactions[36].events).toHaveLength(3);
        expect(recorded.transactions[41].events).toHaveLength(2);
        expect(recorded.transactions[42].events.length).toBeGreaterThanOrEqual(3);
        const serialized = JSON.stringify(recorded.transactions);
        for (const opcode of [
            'control_repeat',
            'control_if_else',
            'operator_join',
            'operator_equals',
            'operator_and',
            'sensing_touchingobject',
            'sensing_keypressed'
        ]) {
            expect(serialized).toContain(opcode);
        }
        expect(serialized).toContain('"newValue":"a"');
        expect(serialized).toContain('"newValue":"b"');
        expect(serialized).toContain('"newValue":"c"');

        // Prove the actual range transport and its shared speed setting in
        // both directions before exercising direct boundary seeks.
        await setControlValue('#tw-studio-speed', 4);
        await clickTitledButton('Play timeline backward');
        await studioText(`positioned · ${STEP_COUNT} steps`);
        await studioText(`position 0/${STEP_COUNT}`, 90000);
        await clickTitledButton('Play timeline forward');
        await studioText(`positioned · ${STEP_COUNT} steps`);
        await studioText(`position ${STEP_COUNT}/${STEP_COUNT}`, 90000);

        await setControlValue('#tw-studio-range-start', 15);
        await setControlValue('#tw-studio-range-end', 18);
        await clickTitledButton('Play selected range forward');
        await studioText(`positioned · ${STEP_COUNT} steps`);
        await studioText(`position 18/${STEP_COUNT}`, 90000);
        await clickTitledButton('Play selected range backward');
        await studioText(`positioned · ${STEP_COUNT} steps`);
        await studioText(`position 15/${STEP_COUNT}`, 90000);

        // Cross the repeated nested-shadow edits in both directions before a
        // complete replay; this is the historical expected-b/actual-c shape.
        await seek(18);
        await seek(15);
        await seek(18);
        await seek(STEP_COUNT);

        await clickButton('Rewind');
        await studioText(`position 0/${STEP_COUNT}`, 90000);
        await play();
        const finalEvidence = await nativeEvidence();
        expect(finalEvidence).toMatchObject({
            plan: {
                kind: 'existing-block-drag',
                splitSourceRoot: true
            },
            status: 'verified',
            evidence: {
                isolatedPickup: true
            }
        });
        expect(finalEvidence.evidence.stationaryRemainderIds.length).toBeGreaterThan(0);
        const dragFrames = finalEvidence.evidence.frames;
        expect(dragFrames.length).toBeGreaterThan(10);
        expect(dragFrames.every(frame => frame.previewTargetMatches === true)).toBe(true);
        expect(dragFrames.slice(0, Math.floor(dragFrames.length / 2))
            .every(frame => !frame.markerVisible)).toBe(true);
        expect(dragFrames.slice(-3).every(frame => frame.markerVisible)).toBe(true);
        expect(dragFrames.some(frame => frame.connectionCorrection)).toBe(false);
        expect(finalEvidence.evidence.draggedBlockIds.filter(blockId =>
            finalEvidence.evidence.stationaryRemainderIds.includes(blockId)
        )).toEqual([]);

        // The exact four-command compound reorder at the end of the matrix is
        // also a permanent ordinary-history regression. Repeated semantic
        // Undo/Redo must remain connected, pointer-free and leave no hidden
        // live roots or presentation clones behind after each animation.
        for (let cycle = 0; cycle < 3; cycle += 1) {
            await beginPresentationTrace();
            await historyKey(false);
            await studioText(`position ${STEP_COUNT - 1}/${STEP_COUNT}`, 30000);
            const undoFrames = await finishPresentationTrace();
            await assertHealthy();
            await assertPresentationClean();
            expect(undoFrames.length).toBeGreaterThan(0);
            expect(undoFrames.filter(frame => frame.duplicateIds.length)).toEqual([]);
            await beginPresentationTrace();
            await historyKey(true);
            await studioText(`position ${STEP_COUNT}/${STEP_COUNT}`, 30000);
            const redoFrames = await finishPresentationTrace();
            await assertHealthy();
            await assertPresentationClean();
            expect(redoFrames.length).toBeGreaterThan(0);
            expect(redoFrames.filter(frame => frame.duplicateIds.length)).toEqual([]);
        }

        await driver.navigate().refresh();
        await studioText(`ready to play · ${STEP_COUNT} steps`, 30000);
        await studioText(`position 0/${STEP_COUNT}`);
        await play();
    }, 240000);
});
