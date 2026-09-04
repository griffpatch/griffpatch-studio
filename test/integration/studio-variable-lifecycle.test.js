import webdriver from 'selenium-webdriver';
import SeleniumHelper from '../helpers/selenium-helper';

const {By, Key, until} = webdriver;

const helper = new SeleniumHelper();
const describeBrowser = process.env.STUDIO_BROWSER_URL ? describe : describe.skip;

describeBrowser('Tutorial Studio variable and list lifecycle', () => {
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

    const journal = () => driver.executeScript(`
        return JSON.parse(document.querySelector('#tw-studio-journal-debug').textContent).journal;
    `);

    const variableUses = (name, type) => driver.executeScript(`
        const workspace = window.ScratchBlocks.getMainWorkspace();
        const variable = workspace.getAllVariables().find(candidate =>
            candidate.name === arguments[0] && candidate.type === arguments[1]
        );
        if (!variable) return null;
        return {
            id: variable.getId(),
            name: variable.name,
            type: variable.type,
            uses: workspace.getVariableUsesById(variable.getId()).map(block => ({
                id: block.id,
                type: block.type,
                fields: Object.fromEntries((block.inputList || []).flatMap(input =>
                    (input.fieldRow || [])
                        .filter(field => field.name)
                        .map(field => [field.name, field.getValue()])
                ))
            }))
        };
    `, name, type);

    const nativePresentation = () => driver.executeScript(`
        const result = JSON.parse(document.querySelector('#tw-studio-native-evidence').textContent);
        return result && result.nativeInteraction ? result.nativeInteraction : result;
    `);

    const assertHealthy = async () => {
        const source = await driver.getPageSource();
        expect(source).not.toContain('— restored');
        expect(source).not.toContain('state mismatch');
        expect(source).not.toContain('reload required');
    };

    const variableField = (name, type) => driver.wait(() => driver.executeScript(`
        const name = arguments[0];
        const type = arguments[1];
        const workspace = window.ScratchBlocks.getMainWorkspace();
        const flyout = workspace.getFlyout();
        const flyoutWorkspace = flyout && flyout.getWorkspace();
        for (const block of flyoutWorkspace ? flyoutWorkspace.getAllBlocks(false) : []) {
            for (const input of block.inputList || []) {
                for (const field of input.fieldRow || []) {
                    if (field instanceof window.ScratchBlocks.FieldVariable &&
                        field.variable_ && field.variable_.name === name && field.variable_.type === type) {
                        return field.getSvgRoot();
                    }
                }
            }
        }
        return null;
    `, name, type), 20000);

    const renameVariable = async ({name, type, nextName, menuLabel, expectedSteps}) => {
        const field = await variableField(name, type);
        await field.click();
        await helper.clickText(menuLabel);
        const input = await driver.wait(
            until.elementLocated(By.css('[data-studio-target="prompt-variable-name"]')),
            20000
        );
        await input.sendKeys(Key.chord(Key.CONTROL, 'a'), nextName);
        await driver.findElement(By.css('[data-studio-target="prompt-ok"]')).click();
        await studioText(`recording · ${expectedSteps} steps`);
    };

    const deleteVariable = async ({name, type, menuLabel, confirm, expectedSteps}) => {
        const field = await variableField(name, type);
        await field.click();
        await helper.clickText(menuLabel);
        if (confirm) {
            const ok = await driver.wait(
                until.elementLocated(By.css('[data-studio-target="blocks-confirm-ok"]')),
                20000
            );
            await ok.click();
        }
        await studioText(`recording · ${expectedSteps} steps`);
    };

    const createNamedData = async ({button, name, expectedSteps}) => {
        await helper.clickBlocksCategory('Variables');
        await helper.clickText(button, helper.scope.blocksTab);
        const input = await driver.wait(
            until.elementLocated(By.css('[data-studio-target="prompt-variable-name"]')),
            20000
        );
        await input.sendKeys(name);
        await driver.findElement(By.css('[data-studio-target="prompt-ok"]')).click();
        await studioText(`recording · ${expectedSteps} steps`);
    };

    const assertConfirmationBridge = async () => {
        const confirmSource = await driver.executeScript(
            'return String(window.ScratchBlocks.confirm);'
        );
        expect(confirmSource).toContain('handleConfirmStart');
        await driver.executeScript(`
            window.__studioConfirmationProbe = null;
            window.ScratchBlocks.confirm('Studio confirmation probe', answer => {
                window.__studioConfirmationProbe = answer;
            });
        `);
        const cancel = await driver.wait(
            until.elementLocated(By.css('[data-studio-target="blocks-confirm-cancel"]')),
            5000
        );
        await cancel.click();
        await driver.wait(() => driver.executeScript(
            'return window.__studioConfirmationProbe === false;'
        ), 5000);
    };

    const dragVariableBlock = async (blockType, y, expectedSteps) => {
        const flyoutBlock = await driver.wait(
            until.elementLocated(By.css(`.blocklyFlyout g[data-id="${blockType}"] > .blocklyPath`)),
            20000
        );
        const workspace = await driver.findElement(By.css('svg.blocklySvg'));
        await driver.actions()
            .mouseMove(flyoutBlock)
            .mouseDown()
            .mouseMove(workspace, {x: 430, y})
            .mouseUp()
            .perform();
        await studioText(`recording · ${expectedSteps} steps`);
    };

    const play = async () => {
        await driver.executeScript(`document.querySelector('#tw-studio-speed').value = '4';`);
        await clickButton('Play');
        await studioText('played · 8 steps', 120000);
        await studioText('position 8/8');
        await assertHealthy();
        const presentation = await nativePresentation();
        expect(presentation).toMatchObject({
            status: 'verified',
            plan: {kind: 'variable-delete-dropdown', varName: 'cupcake'},
            evidence: {
                menuVisibleBeforeClick: true,
                useCount: 2,
                confirmationRequired: true,
                confirmationVisibleBeforeSubmit: true,
                pointerTravel: {completed: true, model: 'natural'},
                workspace: {matches: true},
                vm: {matches: true},
                deletedBlocks: {workspaceAbsent: true, vmAbsent: true}
            }
        });
    };

    beforeAll(() => {
        driver = helper.getDriver();
        const url = new URL(process.env.STUDIO_BROWSER_URL);
        url.searchParams.set('studio-session', '1');
        url.searchParams.set('studio-take', `selenium-variable-lifecycle-${Date.now()}`);
        url.searchParams.set('studio-pointer-model', 'natural');
        url.searchParams.set('studio-build', 'selenium-variable-lifecycle');
        url.searchParams.set('studio-cache', String(Date.now()));
        url.searchParams.set('studio-debug', '1');
        takeUrl = url.toString();
    });

    afterAll(async () => {
        if (driver) await driver.quit();
    });

    test('authors, rewinds and replays list and confirmed variable deletion before and after reload', async () => {
        await helper.loadUri(takeUrl);
        await assertConfirmationBridge();

        // Scratch's stock project contains `my variable`, and the shared set/change
        // flyout blocks select the first scalar definition. Remove that fixture
        // default before establishing the take base so both genuine drags below
        // necessarily reference the scalar whose lifecycle this journey records.
        await helper.clickBlocksCategory('Variables');
        await deleteVariable({
            name: 'my variable',
            type: '',
            menuLabel: 'Delete the "my variable" variable',
            confirm: false,
            expectedSteps: 1
        });
        await clickButton('Set Base');
        await studioText('0 steps (0 events)');

        await createNamedData({button: 'Make a List', name: 'ingredients', expectedSteps: 1});
        await renameVariable({
            name: 'ingredients',
            type: 'list',
            nextName: 'shopping',
            menuLabel: 'Rename list',
            expectedSteps: 2
        });
        await deleteVariable({
            name: 'shopping',
            type: 'list',
            menuLabel: 'Delete the "shopping" list',
            confirm: false,
            expectedSteps: 3
        });

        await createNamedData({button: 'Make a Variable', name: 'cake', expectedSteps: 4});
        await dragVariableBlock('data_setvariableto', 250, 5);
        await dragVariableBlock('data_changevariableby', 360, 6);
        expect(await variableUses('cake', '')).toMatchObject({
            name: 'cake',
            type: '',
            uses: [
                {type: 'data_setvariableto'},
                {type: 'data_changevariableby'}
            ]
        });
        await renameVariable({
            name: 'cake',
            type: '',
            nextName: 'cupcake',
            menuLabel: 'Rename variable',
            expectedSteps: 7
        });
        await deleteVariable({
            name: 'cupcake',
            type: '',
            menuLabel: 'Delete the "cupcake" variable',
            confirm: true,
            expectedSteps: 8
        });
        await studioText('position 8/8');

        const recorded = await journal();
        expect(recorded.transactions.map(transaction => transaction.events.at(-1).type)).toEqual([
            'var_create',
            'var_rename',
            'var_delete',
            'var_create',
            'move',
            'move',
            'var_rename',
            'var_delete'
        ]);
        expect(recorded.transactions[7].events.filter(event => event.type === 'delete')).toHaveLength(2);

        await clickButton('Rewind');
        await studioText('position 0/8', 120000);
        await play();

        await driver.navigate().refresh();
        await studioText('ready to play · 8 steps');
        await studioText('position 0/8');
        await play();
    }, 300000);
});
