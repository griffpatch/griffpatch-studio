import webdriver from 'selenium-webdriver';
import SeleniumHelper from '../helpers/selenium-helper';
import {projectStructuralState} from '../../src/studio/validation/project-state-projection';
import {firstJsonDifference} from '../../src/studio/validation/first-json-difference';

const {By, Key, until} = webdriver;

const helper = new SeleniumHelper();
const describeBrowser = process.env.STUDIO_BROWSER_URL ? describe : describe.skip;

const structuralV10 = project => projectStructuralState(project, {
    normalizeAssetReferences: true,
    normalizeBlockReferences: true,
    normalizeTupleInputReferences: true,
    normalizeProcedureArgumentIds: true,
    normalizeEmptyInputs: true,
    normalizeNullFieldIds: true,
    normalizeBlockCoordinates: true,
    normalizeInertInputShadows: true
});

describeBrowser('Tutorial Studio Backpack script import', () => {
    let driver;
    let takeUrl;

    const bodyText = () => driver.findElement(By.css('body')).getText();

    const studioText = async (text, timeout = 60000) => {
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
        await driver.wait(until.elementIsEnabled(button), 20000);
        await button.click();
    };

    const blockCount = () => driver.executeScript(`
        return Object.keys(window.vm.editingTarget.blocks._blocks).length;
    `);

    const journal = () => driver.executeScript(`
        return JSON.parse(document.querySelector('#tw-studio-journal-debug').textContent).journal;
    `);

    const assertHealthy = async () => {
        const source = await driver.getPageSource();
        expect(source).not.toContain('— restored');
        expect(source).not.toContain('state mismatch');
        expect(source).not.toContain('reload required');
    };

    const assertBackpackPresentation = async itemId => {
        const result = await driver.executeScript(`
            const text = document.querySelector('#tw-studio-native-evidence')?.textContent || '';
            return text ? JSON.parse(text) : null;
        `);
        const presentation = result && result.nativeInteraction ? result.nativeInteraction : result;
        expect(presentation).toMatchObject({
            status: 'verified',
            plan: {
                kind: 'backpack-script-drag',
                backpackItem: {id: itemId, type: 'script'},
                copiedRootOpcode: 'event_whenflagclicked'
            },
            evidence: {
                controlsVisible: true,
                projectMatches: true,
                pointerTravel: {completed: true, model: 'natural'}
            }
        });
        expect(presentation.evidence.pointerTravel.frames.length).toBeGreaterThan(1);
    };

    const play = async (itemId, stepCount) => {
        await driver.executeScript(`
            document.querySelector('#tw-studio-speed').value = '4';
        `);
        await clickButton('Play');
        await studioText(`played · ${stepCount} steps`, 120000);
        await studioText(`position ${stepCount}/${stepCount}`);
        await assertHealthy();
        await assertBackpackPresentation(itemId);
    };

    beforeAll(() => {
        driver = helper.getDriver();
        const url = new URL(process.env.STUDIO_BROWSER_URL);
        url.searchParams.set('studio-session', '1');
        url.searchParams.set('studio-take', `selenium-backpack-script-${Date.now()}`);
        url.searchParams.set('studio-pointer-model', 'natural');
        url.searchParams.set('studio-connection-matrix-fixture', '1');
        url.searchParams.set('studio-build', 'selenium-backpack-script');
        url.searchParams.set('studio-cache', String(Date.now()));
        url.searchParams.set('studio-debug', '1');
        takeUrl = url.toString();
    });

    afterAll(async () => {
        if (driver) await driver.quit();
    });

    test('imports a compound nested script through Backpack and preserves every boundary', async () => {
        await helper.loadUri(takeUrl);
        await clickButton('Seed Matrix');
        await studioText('recording · 29 steps');
        const beforeImportCount = await blockCount();

        const backpackToggle = await driver.wait(
            until.elementLocated(By.css('[data-studio-target="backpack-toggle"]')),
            20000
        );
        await backpackToggle.click();
        const backpackList = await driver.wait(
            until.elementLocated(By.css('[data-studio-target="backpack-list"]')),
            20000
        );
        const scriptId = await driver.executeScript(`
            const workspace = window.ScratchBlocks.getMainWorkspace();
            const block = workspace.getTopBlocks(false).find(candidate =>
                candidate.type === 'event_whenflagclicked'
            );
            if (block) workspace.centerOnBlock(block.id);
            return block && block.id;
        `);
        expect(scriptId).not.toBeNull();
        await driver.sleep(500);
        const scriptRoot = await driver.executeScript(`
            return window.ScratchBlocks.getMainWorkspace().getBlockById(arguments[0])?.getSvgRoot() || null;
        `, scriptId);
        expect(scriptRoot).not.toBeNull();
        const scriptHitOffset = await driver.executeScript(`
            const root = arguments[0];
            const rect = root.getBoundingClientRect();
            for (let y = 8; y < Math.min(40, rect.height); y += 4) {
                for (let x = 8; x < rect.width; x += 4) {
                    const hit = document.elementFromPoint(rect.left + x, rect.top + y);
                    if (hit?.closest('.blocklyDraggable') === root) return {x, y};
                }
            }
            return null;
        `, scriptRoot);
        expect(scriptHitOffset).not.toBeNull();
        await driver.executeScript(`
            window.__studioBackpackTrace = [];
            const describeTarget = target => target && {
                tag: target.tagName,
                className: typeof target.className === 'string' ? target.className : target.className?.baseVal,
                studioTarget: target.closest?.('[data-studio-target]')?.getAttribute('data-studio-target') || null
            };
            for (const type of ['mousedown', 'mousemove', 'mouseup', 'mouseenter']) {
                document.addEventListener(type, event => {
                    if (type !== 'mousemove' || window.__studioBackpackTrace.length < 40) {
                        window.__studioBackpackTrace.push({
                            source: 'dom', type, x: event.clientX, y: event.clientY,
                            buttons: event.buttons, target: describeTarget(event.target)
                        });
                    }
                }, true);
            }
            window.vm.on('BLOCK_DRAG_UPDATE', outside => {
                window.__studioBackpackTrace.push({source: 'vm', type: 'BLOCK_DRAG_UPDATE', outside});
            });
            window.vm.on('BLOCK_DRAG_END', (blocks, topBlockId) => {
                window.__studioBackpackTrace.push({source: 'vm', type: 'BLOCK_DRAG_END', topBlockId});
            });
        `);
        await driver.actions()
            // Resolve a visible point owned by the top block itself. Its SVG
            // bounds may extend under the flyout and contain nested children.
            .mouseMove(scriptRoot, scriptHitOffset)
            .mouseDown()
            .mouseMove(backpackToggle)
            .perform();
        await driver.sleep(500);
        await driver.actions().mouseMove(backpackList).perform();
        await driver.sleep(500);
        await driver.actions().mouseUp().perform();

        let backpackItem;
        try {
            backpackItem = await driver.wait(
                until.elementLocated(By.css('[data-studio-target^="backpack-item:script:"]')),
                10000
            );
        } catch (error) {
            const diagnostics = await driver.executeScript(`
                return {
                    trace: window.__studioBackpackTrace,
                    blockCount: Object.keys(window.vm.editingTarget.blocks._blocks).length,
                    backpackText: document.querySelector('[data-studio-target="backpack-list"]')?.textContent || '',
                    scriptRect: arguments[0].getBoundingClientRect().toJSON()
                };
            `, scriptRoot);
            throw new Error(`Backpack authoring drag did not create an item:\n${JSON.stringify(diagnostics, null, 2)}`, {
                cause: error
            });
        }
        const itemTarget = await backpackItem.getAttribute('data-studio-target');
        const itemId = itemTarget.slice('backpack-item:script:'.length);
        expect(itemId).not.toBe('');
        expect(await blockCount()).toBe(beforeImportCount);
        const afterBackpackSave = await journal();
        const saveStepCount = afterBackpackSave.transactions.length;
        // Blockly may record the genuine top-level coordinate change made by
        // dragging the source to the Backpack. That is part of the authoring
        // history, not part of the imported script transaction.
        expect(saveStepCount).toBeGreaterThanOrEqual(29);
        expect(saveStepCount).toBeLessThanOrEqual(30);
        await studioText(`position ${saveStepCount}/${saveStepCount}`);

        const workspace = await driver.findElement(By.css('svg.blocklySvg'));
        await driver.actions()
            .mouseMove(backpackItem)
            .mouseDown()
            .mouseMove(workspace, {x: 420, y: 190})
            .mouseUp()
            .perform();

        await studioText('Import script — Sprite1');
        const importStep = saveStepCount + 1;
        await studioText(`recording · ${importStep} steps`);
        await studioText(`position ${importStep}/${importStep}`);
        const recorded = await journal();
        const operation = recorded.transactions[saveStepCount].operation;
        expect(operation).toMatchObject({
            type: 'block-import',
            targetRef: {name: 'Sprite1', isStage: false},
            importSource: {kind: 'backpack', id: itemId, type: 'script'},
            sourceRoot: {opcode: 'event_whenflagclicked'}
        });
        expect(operation.sourceRoot.blockCount).toBeGreaterThan(5);
        expect(await blockCount()).toBe(beforeImportCount + operation.sourceRoot.blockCount);
        const expectedAfterImport = JSON.parse(await driver.executeScript('return window.vm.toJSON();'));

        const body = await driver.findElement(By.css('body'));
        await body.sendKeys(Key.chord(Key.CONTROL, 'z'));
        await studioText(`position ${saveStepCount}/${importStep}`, 30000);
        expect(await blockCount()).toBe(beforeImportCount);
        await body.sendKeys(Key.chord(Key.CONTROL, Key.SHIFT, 'z'));
        try {
            await studioText(`position ${importStep}/${importStep}`, 30000);
        } catch (error) {
            const diagnostic = JSON.parse(await driver.executeScript(`
                return document.querySelector('#tw-studio-diagnostic')?.textContent || '{}';
            `));
            const actual = diagnostic.validation && diagnostic.validation.actualProject;
            const difference = actual ? firstJsonDifference(structuralV10(expectedAfterImport), actual) : null;
            throw new Error(`Backpack redo differs from its recorded project: ${JSON.stringify(difference)}`, {
                cause: error
            });
        }
        expect(await blockCount()).toBe(beforeImportCount + operation.sourceRoot.blockCount);
        await assertHealthy();

        await clickButton('Rewind');
        await studioText(`position 0/${importStep}`, 120000);
        await play(itemId, importStep);

        await driver.navigate().refresh();
        await studioText(`ready to play · ${importStep} steps`, 30000);
        await studioText(`position 0/${importStep}`);
        await play(itemId, importStep);
    }, 300000);
});
