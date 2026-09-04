import webdriver from 'selenium-webdriver';
import SeleniumHelper from '../helpers/selenium-helper';

const {Button, By, until} = webdriver;

const helper = new SeleniumHelper();
const describeBrowser = process.env.STUDIO_BROWSER_URL ? describe : describe.skip;

describeBrowser('Tutorial Studio comment authoring', () => {
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
        await driver.wait(until.elementIsEnabled(button), 20000);
        await button.click();
    };

    const journal = () => driver.executeScript(`
        return JSON.parse(document.querySelector('#tw-studio-journal-debug').textContent).journal;
    `);

    const nativePresentation = () => driver.executeScript(`
        const result = JSON.parse(document.querySelector('#tw-studio-native-evidence').textContent);
        return result && result.nativeInteraction ? result.nativeInteraction : result;
    `);

    const liveComment = () => driver.executeScript(`
        const workspace = window.ScratchBlocks.getMainWorkspace();
        const block = workspace.getTopBlocks(false)[0];
        if (!block || !block.comment) return null;
        const size = block.comment.getHeightWidth();
        const coordinate = block.comment.getXY();
        return {
            id: block.comment.id,
            blockId: block.comment.blockId,
            text: block.comment.getText(),
            minimized: Boolean(block.comment.isMinimized_),
            size: {width: size.width, height: size.height},
            coordinate: {x: coordinate.x, y: coordinate.y}
        };
    `);

    const liveWorkspaceComment = () => driver.executeScript(`
        const comment = window.ScratchBlocks.getMainWorkspace().getTopComments(false)[0];
        if (!comment) return null;
        const size = comment.getHeightWidth();
        const coordinate = comment.getXY();
        return {
            id: comment.id,
            blockId: comment.blockId || null,
            text: comment.getText(),
            minimized: comment.isMinimized(),
            size: {width: size.width, height: size.height},
            coordinate: {x: coordinate.x, y: coordinate.y}
        };
    `);

    const assertHealthy = async () => {
        const source = await driver.getPageSource();
        expect(source).not.toContain('— restored');
        expect(source).not.toContain('state mismatch');
        expect(source).not.toContain('reload required');
    };

    const rightClickBlockPath = async blockPath => {
        const hitOffset = await driver.executeScript(`
            const path = arguments[0];
            const root = path.closest('.blocklyDraggable');
            const rect = path.getBoundingClientRect();
            for (let y = 6; y < Math.min(30, rect.height); y += 4) {
                for (let x = 6; x < Math.min(80, rect.width); x += 4) {
                    const hit = document.elementFromPoint(rect.left + x, rect.top + y);
                    if (hit?.closest('.blocklyDraggable') === root) return {x, y};
                }
            }
            return null;
        `, blockPath);
        expect(hitOffset).not.toBeNull();
        await driver.actions()
            .mouseMove(blockPath, hitOffset)
            .click(undefined, Button.RIGHT)
            .perform();
    };

    const dragElementBy = async (element, delta) => {
        // Exercise the actual Scratch Blocks DOM listeners in Chromium. The
        // legacy Selenium action endpoint does not reliably hold a button over
        // SVG children in headless Chrome, so emit the same native event route
        // explicitly and advance across several browser frames.
        await driver.executeAsyncScript(`
            const element = arguments[0];
            const delta = arguments[1];
            const done = arguments[arguments.length - 1];
            const rect = element.getBoundingClientRect();
            const source = {x: rect.left + (rect.width / 2), y: rect.top + (rect.height / 2)};
            const event = (type, point, buttons) => new MouseEvent(type, {
                bubbles: true,
                cancelable: true,
                view: window,
                button: 0,
                buttons,
                clientX: point.x,
                clientY: point.y
            });
            element.dispatchEvent(event('mousedown', source, 1));
            let frame = 0;
            const move = () => {
                frame += 1;
                const progress = frame / 8;
                const point = {
                    x: source.x + (delta.x * progress),
                    y: source.y + (delta.y * progress)
                };
                document.dispatchEvent(event('mousemove', point, 1));
                if (frame < 8) {
                    requestAnimationFrame(move);
                } else {
                    element.dispatchEvent(event('mouseup', point, 0));
                    requestAnimationFrame(done);
                }
            };
            requestAnimationFrame(move);
        `, element, delta);
    };

    const clickElementThroughMouseEvents = element => driver.executeScript(`
        const element = arguments[0];
        const rect = element.getBoundingClientRect();
        const point = {x: rect.left + (rect.width / 2), y: rect.top + (rect.height / 2)};
        const event = type => new MouseEvent(type, {
            bubbles: true,
            cancelable: true,
            view: window,
            button: 0,
            buttons: type === 'mousedown' ? 1 : 0,
            clientX: point.x,
            clientY: point.y
        });
        element.dispatchEvent(event('mousedown'));
        element.dispatchEvent(event('mouseup'));
        element.dispatchEvent(event('click'));
    `, element);

    const play = async ({steps, finalKind, live, menuVisibleBeforeClick = false}) => {
        await driver.executeScript(`document.querySelector('#tw-studio-speed').value = '4';`);
        await clickButton('Play');
        await studioText(`played · ${steps} steps`, 90000);
        await studioText(`position ${steps}/${steps}`);
        await assertHealthy();
        expect(await live()).toBeNull();
        const presentation = await nativePresentation();
        expect(presentation).toMatchObject({
            status: 'verified',
            plan: {kind: finalKind},
            evidence: {
                controlsVisible: true,
                pointerTravel: {completed: true, model: 'natural'},
                workspaceMatches: true,
                ...(menuVisibleBeforeClick ? {menuVisibleBeforeClick: true} : {})
            }
        });
    };

    beforeAll(() => {
        driver = helper.getDriver();
    });

    const take = label => {
        const url = new URL(process.env.STUDIO_BROWSER_URL);
        url.searchParams.set('studio-session', '1');
        url.searchParams.set('studio-take', `selenium-${label}-${Date.now()}`);
        url.searchParams.set('studio-pointer-model', 'natural');
        url.searchParams.set('studio-build', `selenium-${label}`);
        url.searchParams.set('studio-cache', String(Date.now()));
        url.searchParams.set('studio-debug', '1');
        return url.toString();
    };

    afterAll(async () => {
        if (driver) await driver.quit();
    });

    test('authors and replays the complete attached-comment lifecycle through real controls', async () => {
        takeUrl = take('block-comments');
        await helper.loadUri(takeUrl);
        await helper.clickBlocksCategory('Motion');
        const flyoutBlock = await driver.wait(
            until.elementLocated(By.css('.blocklyFlyout g[data-id="motion_movesteps"] > .blocklyPath')),
            20000
        );
        const workspace = await driver.findElement(By.css('svg.blocklySvg'));
        await driver.actions()
            .mouseMove(flyoutBlock)
            .mouseDown()
            .mouseMove(workspace, {x: 420, y: 260})
            .mouseUp()
            .perform();
        await studioText('recording · 1 steps');

        const blockPath = await driver.executeScript(`
            return window.ScratchBlocks.getMainWorkspace().getTopBlocks(false)[0]
                ?.getSvgRoot()?.querySelector(':scope > .blocklyPath') || null;
        `);
        expect(blockPath).not.toBeNull();
        await rightClickBlockPath(blockPath);
        const addComment = await driver.wait(until.elementLocated(By.xpath(
            '//div[contains(@class,"goog-menuitem")][contains(.,"Add Comment")]'
        )), 20000);
        await addComment.click();
        await studioText('recording · 2 steps');

        const textarea = await driver.wait(
            until.elementLocated(By.css('.blocklyWorkspace .scratchCommentTextarea')),
            20000
        );
        await textarea.sendKeys('Explain this');
        await driver.findElement(By.css('input[placeholder="Project title here"]')).click();
        await studioText('recording · 3 steps');
        expect(await liveComment()).toMatchObject({text: 'Explain this'});

        const resizeHandle = await driver.executeScript(`
            return window.ScratchBlocks.getMainWorkspace().getTopBlocks(false)[0]
                ?.comment?.bubble_?.resizeGroup_?.querySelector('polygon') || null;
        `);
        expect(resizeHandle).not.toBeNull();
        const beforeResize = await liveComment();
        await dragElementBy(resizeHandle, {x: 80, y: 50});
        const afterResize = await liveComment();
        expect(afterResize.size.width).toBeGreaterThan(beforeResize.size.width + 50);
        expect(afterResize.size.height).toBeGreaterThan(beforeResize.size.height + 30);
        await studioText('recording · 4 steps');

        const minimizeArrow = await driver.executeScript(`
            return window.ScratchBlocks.getMainWorkspace().getTopBlocks(false)[0]
                ?.comment?.bubble_?.minimizeArrow_ || null;
        `);
        expect(minimizeArrow).not.toBeNull();
        await minimizeArrow.click();
        await studioText('recording · 5 steps');
        expect(await liveComment()).toMatchObject({minimized: true});
        await minimizeArrow.click();
        await studioText('recording · 6 steps');
        expect(await liveComment()).toMatchObject({minimized: false});

        const topBar = await driver.executeScript(`
            return window.ScratchBlocks.getMainWorkspace().getTopBlocks(false)[0]
                ?.comment?.bubble_?.commentTopBar_ || null;
        `);
        expect(topBar).not.toBeNull();
        const beforeMove = await liveComment();
        await dragElementBy(topBar, {x: 90, y: 60});
        await studioText('recording · 7 steps');
        const afterMove = await liveComment();
        expect(afterMove.coordinate.x).toBeGreaterThan(beforeMove.coordinate.x + 50);
        expect(afterMove.coordinate.y).toBeGreaterThan(beforeMove.coordinate.y + 30);

        await rightClickBlockPath(blockPath);
        const removeComment = await driver.wait(until.elementLocated(By.xpath(
            '//div[contains(@class,"goog-menuitem")][contains(.,"Remove Comment")]'
        )), 20000);
        await removeComment.click();
        await studioText('recording · 8 steps');
        await studioText('position 8/8');
        expect(await liveComment()).toBeNull();

        const recorded = await journal();
        expect(recorded.transactions).toHaveLength(8);
        expect(recorded.transactions.slice(1).map(transaction => transaction.events[0].type))
            .toEqual([
                'comment_create',
                'comment_change',
                'comment_change',
                'comment_change',
                'comment_change',
                'comment_move',
                'comment_delete'
            ]);
        expect(recorded.transactions[2].events[0].details.newContents).toEqual({text: 'Explain this'});
        expect(recorded.transactions[3].events[0].details.newContents).toMatchObject({
            width: afterResize.size.width,
            height: afterResize.size.height
        });
        expect(recorded.transactions[4].events[0].details.newContents).toEqual({minimized: true});
        expect(recorded.transactions[5].events[0].details.newContents).toEqual({minimized: false});
        expect(recorded.transactions[6].events[0].details.newCoordinate).toMatchObject(afterMove.coordinate);

        await clickButton('Rewind');
        await studioText('position 0/8', 90000);
        await play({
            steps: 8,
            finalKind: 'block-comment-delete',
            live: liveComment,
            menuVisibleBeforeClick: true
        });

        await driver.navigate().refresh();
        await studioText('ready to play · 8 steps');
        await studioText('position 0/8');
        await play({
            steps: 8,
            finalKind: 'block-comment-delete',
            live: liveComment,
            menuVisibleBeforeClick: true
        });
    }, 240000);

    test('authors and replays the complete workspace-comment lifecycle through real controls', async () => {
        takeUrl = take('workspace-comments');
        await helper.loadUri(takeUrl);
        const background = await driver.wait(
            until.elementLocated(By.css('.blocklyMainBackground')),
            20000
        );
        await driver.actions()
            .mouseMove(background, {x: 520, y: 260})
            .click(undefined, Button.RIGHT)
            .perform();
        const addComment = await driver.wait(until.elementLocated(By.xpath(
            '//div[contains(@class,"goog-menuitem")][contains(.,"Add Comment")]'
        )), 20000);
        await addComment.click();
        await studioText('recording · 1 steps');
        const created = await liveWorkspaceComment();
        expect(created).toMatchObject({
            blockId: null,
            text: '',
            minimized: false,
            size: {width: 200, height: 200}
        });

        const textarea = await driver.wait(
            until.elementLocated(By.css('.blocklyWorkspace .scratchCommentTextarea')),
            20000
        );
        await textarea.sendKeys('Scene note');
        await driver.findElement(By.css('input[placeholder="Project title here"]')).click();
        await studioText('recording · 2 steps');
        expect(await liveWorkspaceComment()).toMatchObject({text: 'Scene note'});

        const resizeHandle = await driver.executeScript(`
            return window.ScratchBlocks.getMainWorkspace().getTopComments(false)[0]
                ?.resizeGroup_?.querySelector('polygon') || null;
        `);
        expect(resizeHandle).not.toBeNull();
        const beforeResize = await liveWorkspaceComment();
        await dragElementBy(resizeHandle, {x: 80, y: 50});
        const afterResize = await liveWorkspaceComment();
        expect(afterResize.size.width).toBeGreaterThan(beforeResize.size.width + 50);
        expect(afterResize.size.height).toBeGreaterThan(beforeResize.size.height + 30);
        await studioText('recording · 3 steps');

        const minimizeArrow = await driver.executeScript(`
            return window.ScratchBlocks.getMainWorkspace().getTopComments(false)[0]
                ?.minimizeArrow_ || null;
        `);
        expect(minimizeArrow).not.toBeNull();
        await minimizeArrow.click();
        await studioText('recording · 4 steps');
        expect(await liveWorkspaceComment()).toMatchObject({minimized: true});
        await minimizeArrow.click();
        await studioText('recording · 5 steps');
        expect(await liveWorkspaceComment()).toMatchObject({minimized: false});

        const topBar = await driver.executeScript(`
            return window.ScratchBlocks.getMainWorkspace().getTopComments(false)[0]
                ?.svgHandleTarget_ || null;
        `);
        expect(topBar).not.toBeNull();
        const beforeMove = await liveWorkspaceComment();
        await dragElementBy(topBar, {x: 90, y: 60});
        await studioText('recording · 6 steps');
        const afterMove = await liveWorkspaceComment();
        expect(afterMove.coordinate.x).toBeGreaterThan(beforeMove.coordinate.x + 50);
        expect(afterMove.coordinate.y).toBeGreaterThan(beforeMove.coordinate.y + 30);

        const deleteIcon = await driver.executeScript(`
            return window.ScratchBlocks.getMainWorkspace().getTopComments(false)[0]
                ?.deleteIcon_ || null;
        `);
        expect(deleteIcon).not.toBeNull();
        await clickElementThroughMouseEvents(deleteIcon);
        await studioText('recording · 7 steps');
        await studioText('position 7/7');
        expect(await liveWorkspaceComment()).toBeNull();

        const recorded = await journal();
        expect(recorded.transactions).toHaveLength(7);
        expect(recorded.transactions.map(transaction => transaction.events[0].type)).toEqual([
            'comment_create',
            'comment_change',
            'comment_change',
            'comment_change',
            'comment_change',
            'comment_move',
            'comment_delete'
        ]);
        expect(recorded.transactions.every(transaction => transaction.events[0].blockId === null)).toBe(true);
        expect(recorded.transactions[0].events[0].details.state).toMatchObject({
            text: '',
            width: 200,
            height: 200,
            minimized: false
        });
        expect(recorded.transactions[5].events[0].details.newCoordinate).toMatchObject(afterMove.coordinate);

        await clickButton('Rewind');
        await studioText('position 0/7', 90000);
        await play({
            steps: 7,
            finalKind: 'workspace-comment-delete',
            live: liveWorkspaceComment
        });

        await driver.navigate().refresh();
        await studioText('ready to play · 7 steps');
        await studioText('position 0/7');
        await play({
            steps: 7,
            finalKind: 'workspace-comment-delete',
            live: liveWorkspaceComment
        });
    }, 240000);
});
