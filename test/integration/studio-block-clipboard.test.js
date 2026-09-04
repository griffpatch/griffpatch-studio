import webdriver from 'selenium-webdriver';
import SeleniumHelper from '../helpers/selenium-helper';
import {STUDIO_MATRIX_STEP_COUNT} from '../helpers/studio-matrix';

const {By, Key, until} = webdriver;

const helper = new SeleniumHelper();
const describeBrowser = process.env.STUDIO_BROWSER_URL ? describe : describe.skip;

describeBrowser('Tutorial Studio in-workspace block clipboard', () => {
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
    };

    const journal = () => driver.executeScript(`
        return JSON.parse(document.querySelector('#tw-studio-journal-debug').textContent).journal;
    `);

    const blockCount = () => driver.executeScript(`
        return window.ScratchBlocks.getMainWorkspace().getAllBlocks(false).length;
    `);

    const assertHealthy = async () => {
        const source = await driver.getPageSource();
        expect(source).not.toContain('— restored');
        expect(source).not.toContain('state mismatch');
        expect(source).not.toContain('reload required');
    };

    const assertClipboardPresentation = async () => {
        const evidence = await driver.executeScript(`
            const text = document.querySelector('#tw-studio-native-evidence')?.textContent || '';
            return text ? JSON.parse(text) : null;
        `);
        const presentation = evidence && evidence.nativeInteraction ? evidence.nativeInteraction : evidence;
        expect(presentation).toMatchObject({
            status: 'verified',
            plan: {
                kind: 'clipboard-block-paste',
                sourceBlockType: 'event_whenflagclicked'
            },
            evidence: {
                controlsVisible: true,
                projectMatches: true,
                pointerTravel: {completed: true, model: 'natural'}
            }
        });
        expect(presentation.evidence.pointerTravel.frames.length).toBeGreaterThan(1);
    };

    const play = async stepCount => {
        await driver.executeScript(`document.querySelector('#tw-studio-speed').value = '4';`);
        await clickButton('Play');
        await studioText(`played · ${stepCount} steps`, 120000);
        await studioText(`position ${stepCount}/${stepCount}`);
        await assertHealthy();
        await assertClipboardPresentation();
    };

    beforeAll(() => {
        driver = helper.getDriver();
        const url = new URL(process.env.STUDIO_BROWSER_URL);
        url.searchParams.set('studio-session', '1');
        url.searchParams.set('studio-take', `selenium-block-clipboard-${Date.now()}`);
        url.searchParams.set('studio-pointer-model', 'natural');
        url.searchParams.set('studio-connection-matrix-fixture', '1');
        url.searchParams.set('studio-build', 'selenium-block-clipboard');
        url.searchParams.set('studio-cache', String(Date.now()));
        url.searchParams.set('studio-debug', '1');
        takeUrl = url.toString();
    });

    afterAll(async () => {
        if (driver) await driver.quit();
    });

    test('copies and pastes a compound nested stack through Scratch Blocks then replays it', async () => {
        await helper.loadUri(takeUrl);
        await clickButton('Seed Matrix');
        await driver.wait(until.elementIsEnabled(driver.findElement(
            By.xpath("//button[normalize-space(.)='Seed Matrix']")
        )), 60000);
        await studioText(`recording · ${STUDIO_MATRIX_STEP_COUNT} steps`);
        await studioText(`position ${STUDIO_MATRIX_STEP_COUNT}/${STUDIO_MATRIX_STEP_COUNT}`);
        // Clipboard behaviour should not depend on the matrix's evolving size.
        const baseCount = (await journal()).transactions.length;
        expect(baseCount).toBeGreaterThan(0);
        const total = baseCount + 1;
        const countBeforePaste = await blockCount();
        const source = await driver.executeScript(`
            const workspace = window.ScratchBlocks.getMainWorkspace();
            const block = workspace.getTopBlocks(false).find(candidate =>
                candidate.type === 'event_whenflagclicked'
            );
            if (block) workspace.centerOnBlock(block.id);
            return block && {id: block.id};
        `);
        expect(source).not.toBeNull();
        await driver.sleep(300);
        const root = await driver.executeScript(`
            return window.ScratchBlocks.getMainWorkspace().getBlockById(arguments[0])?.getSvgRoot() || null;
        `, source.id);
        const hitOffset = await driver.executeScript(`
            const root = arguments[0];
            const rect = root.getBoundingClientRect();
            for (let y = 8; y < Math.min(40, rect.height); y += 4) {
                for (let x = 8; x < rect.width; x += 4) {
                    const hit = document.elementFromPoint(rect.left + x, rect.top + y);
                    if (hit?.closest('.blocklyDraggable') === root) return {x, y};
                }
            }
            return null;
        `, root);
        expect(hitOffset).not.toBeNull();
        await driver.actions().mouseMove(root, hitOffset)
            .click()
            .perform();
        // Selecting the hat also runs its first move-10 command. Wait for that
        // real runtime effect so the next capture deterministically attaches
        // its data boundary to the preceding reorder. This exercises native
        // Play -> semantic fallback with regenerated actor AND parent IDs.
        await driver.wait(() => driver.executeScript('return window.vm.editingTarget.x===10;'), 10000);
        const body = await driver.findElement(By.css('body'));
        await body.sendKeys(Key.chord(Key.CONTROL, 'c'));
        await body.sendKeys(Key.chord(Key.CONTROL, 'v'));

        await studioText(`recording · ${total} steps`);
        await studioText(`position ${total}/${total}`);
        const recorded = await journal();
        expect(recorded.transactions).toHaveLength(total);
        expect(recorded.transactions[baseCount - 1].afterDataDeltas.length).toBeGreaterThan(0);
        expect(recorded.transactions[baseCount]).toMatchObject({
            events: [{
                type: 'create',
                interactionSource: {
                    kind: 'workspace-clipboard',
                    sourceBlockType: 'event_whenflagclicked',
                    sourceBlockRef: {ancestorType: 'event_whenflagclicked'}
                }
            }]
        });
        const copiedBlockCount = recorded.transactions[baseCount].events[0].details.ids.length;
        expect(copiedBlockCount).toBeGreaterThan(5);
        // Scratch also recreates obscured shadow blocks outside BlockCreate's
        // public ids list. The exact project checkpoint, not either count,
        // remains semantic authority.
        const countAfterPaste = await blockCount();
        expect(countAfterPaste).toBeGreaterThanOrEqual(countBeforePaste + copiedBlockCount);

        await body.sendKeys(Key.chord(Key.CONTROL, 'z'));
        await studioText(`position ${baseCount}/${total}`, 30000);
        expect(await blockCount()).toBe(countBeforePaste);
        await body.sendKeys(Key.chord(Key.CONTROL, Key.SHIFT, 'z'));
        await studioText(`position ${total}/${total}`, 30000);
        // Blockly Redo follows its public BlockCreate payload and therefore
        // omits the two inert authoring-only obscured shadows.
        expect(await blockCount()).toBe(countBeforePaste + copiedBlockCount);
        await assertHealthy();

        await clickButton('Rewind');
        await studioText(`position 0/${total}`, 120000);
        await play(total);

        await driver.navigate().refresh();
        await studioText(`ready to play · ${total} steps`, 30000);
        await studioText(`position 0/${total}`);
        await play(total);
    }, 300000);
});
