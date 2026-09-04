import fs from 'fs';
import path from 'path';
import webdriver from 'selenium-webdriver';
import SeleniumHelper from '../helpers/selenium-helper';
import {dismissKeyboardHelp} from '../helpers/keyboard-help';

const {By, Key, until} = webdriver;
const helper = new SeleniumHelper({windowWidth: 1600, windowHeight: 1000});
const describeBrowser = process.env.STUDIO_BROWSER_URL ? describe : describe.skip;
const artifacts = path.resolve('.tmp/keyboard-authoring-evidence');

describeBrowser('Experimental keyboard authoring in the real Scratch editor', () => {
    let driver;
    const painted = () => driver.executeAsyncScript(`const done=arguments[arguments.length-1];
        requestAnimationFrame(()=>requestAnimationFrame(done));`);
    const keys = async (...values) => {
        await driver.actions().sendKeys(...values).perform();
        await painted();
    };
    const chord = async (modifier, key) => {
        // Actions.sendKeys releases each modifier immediately; Key.chord is
        // only appropriate for WebElement.sendKeys, not the Actions API.
        await driver.actions().keyDown(modifier).sendKeys(key).keyUp(modifier).perform();
        await painted();
    };
    const enableKeyboard = async () => {
        const toggle = await driver.wait(until.elementLocated(By.xpath('//button[text()="Keyboard"]')), 30000);
        // Sprite identity changes before the loading overlay releases Code.
        // Wait for the actual user control, not just its still-mounted node.
        await driver.wait(until.elementIsVisible(toggle), 20000);
        await driver.wait(until.elementIsEnabled(toggle), 20000);
        if (await toggle.getAttribute('aria-pressed') !== 'true') await toggle.click();
        else if (!(await driver.executeScript(
            "return document.activeElement?.getAttribute('aria-label')==='Scratch keyboard editor';"
        ))) {
            // A remembered mode is intentionally not permission to steal focus
            // from sprite controls. Explicitly return through the Code control.
            await driver.findElement(By.css('[data-studio-target="tab-code"]')).click();
        }
        await dismissKeyboardHelp(driver);
        // A click is not the readiness contract. The controller focuses its
        // editor and publishes a structural caret asynchronously; typing before
        // both have happened can be lost on a busy real-browser run.
        await driver.wait(() => driver.executeScript(`const toggle=[...document.querySelectorAll('button')]
            .find(button=>button.textContent==='Keyboard');
            return toggle?.getAttribute('aria-pressed')==='true' &&
                document.activeElement?.getAttribute('aria-label')==='Scratch keyboard editor' &&
                !!document.querySelector('[data-position]');`), 20000,
        'Keyboard mode did not expose its focused structural caret');
        return toggle;
    };
    const beginNewScript = async () => {
        await enableKeyboard();
        const point = await driver.executeScript(`const ws=window.__keyboardTestWorkspace;
            const rect=ws.getParentSvg().getBoundingClientRect(), metrics=ws.getMetrics();
            const left=rect.left+(metrics?.absoluteLeft||0)+(metrics?.flyoutWidth||0)+28;
            const right=rect.right-32, top=rect.top+36, bottom=rect.bottom-68;
            const boxes=ws.getTopBlocks(false).map(block=>block.getSvgRoot().getBoundingClientRect());
            for(let y=top;y<bottom-74;y+=42) for(let x=left;x<right-210;x+=54) {
                if(!boxes.some(box=>x<box.right+18&&x+200>box.left-18&&y<box.bottom+18&&y+70>box.top-18))
                    return {x:Math.round(x),y:Math.round(y)};
            }
            return {x:Math.round(left),y:Math.round(Math.max(top,bottom-80))};`);
        await driver.actions().move({origin: 'viewport', x: point.x, y: point.y}).click().perform();
        await painted();
        await driver.wait(() => driver.executeScript(`return document.activeElement?.getAttribute('aria-label')===
            'Scratch keyboard editor' &&
            document.querySelector('[data-position]')?.dataset.position?.startsWith('workspace:');`), 10000,
        'Blank workspace click did not start a new structural script');
    };
    const screenshot = async name => fs.writeFileSync(path.join(artifacts, `${name}.png`),
        Buffer.from(await driver.takeScreenshot(), 'base64'));
    const noGhost = async () => {
        // A resting insertion caret may own ONE native presentation. A typed
        // candidate, orphaned workspace or masked unrelated root must not leak.
        let presentation;
        try {
            await driver.wait(async () => {
                presentation = await driver.executeScript(`const ws=window.__keyboardTestWorkspace;
                const copies=Object.values(window.ScratchBlocks.Workspace.WorkspaceDB_)
                    .filter(copy=>copy.options.readOnly&&!copy.isFlyout&&copy.options.parentWorkspace===ws);
                const scenes=[...document.querySelectorAll('.blocklyTransitionWorkspace')];
                return {count:copies.length,scenes:scenes.length,modes:scenes.map(s=>s.dataset.keyboardPreview),
                    phantoms:copies.map(copy=>copy.getAllBlocks(false)
                        .filter(b=>!ws.getBlockById(b.id)).map(b=>b.type)),
                    livePhantoms:ws.getAllBlocks(false).filter(b=>b.type==='tw_keyboard_draft_statement').length,
                    unowned:ws.getAllBlocks(false).filter(b=>b.getSvgRoot().style.opacity==='0' &&
                        !copies.some(copy=>copy.getBlockById(b.id))).map(b=>b.id),
                    canvasOpacity:window.ScratchBlocks.getMainWorkspace().getCanvas().style.opacity,
                    hiddenWithoutPresentation:[...ws.getAllBlocks(false).map(block=>block.getSvgRoot()),
                        ...ws.getBubbleCanvas().children].filter(node=>node.style.opacity==='0').length};`);
                return presentation.count<=1 && presentation.scenes===presentation.count &&
                    presentation.modes.every(mode=>mode==='caret') &&
                    presentation.phantoms.every(types=>types.length===1&&types[0]==='tw_keyboard_draft_statement') &&
                    presentation.livePhantoms===0 && presentation.unowned.length===0 &&
                    presentation.canvasOpacity!=='0' &&
                    (presentation.count>0 || presentation.hiddenWithoutPresentation===0);
            }, 10000);
        } catch (error) {
            throw new Error(`Keyboard presentation did not settle: ${JSON.stringify(presentation)}`);
        }
        expect(presentation.count).toBeLessThanOrEqual(1);
        expect(presentation.scenes).toBe(presentation.count);
        expect(presentation.modes).toEqual(Array(presentation.count).fill('caret'));
        expect(presentation.phantoms).toEqual(Array(presentation.count).fill(['tw_keyboard_draft_statement']));
        expect(presentation.livePhantoms).toBe(0);
        expect(presentation.unowned).toEqual([]);
        expect(presentation.canvasOpacity).not.toBe('0');
        if (!presentation.count) expect(presentation.hiddenWithoutPresentation).toBe(0);
    };
    const nativeHistory = async redo => {
        await driver.actions().keyDown(Key.CONTROL).sendKeys(redo ? 'y' : 'z').keyUp(Key.CONTROL).perform();
        await painted();
    };
    const state = async () => JSON.parse(await driver.executeScript(`
        const ws = window.__keyboardTestWorkspace;
        const blocks = window.vm.editingTarget.blocks._blocks;
        const seen = new Set();
        const tree = (id,parent) => {
            if (!id) return null;
            const b = blocks[id];
            if (!b) throw Error('Missing VM block '+id);
            if (seen.has(id)) throw Error('Shared/cyclic block '+id);
            if ((b.parent||null)!==parent) throw Error('Wrong parent '+id);
            seen.add(id);
            return {type:b.opcode, fields:Object.fromEntries(Object.entries(b.fields).map(([n,f])=>[n,f.value])),
                inputs:Object.fromEntries(Object.entries(b.inputs).filter(([,v])=>v.block).map(([n,v])=>[n,tree(v.block,id)])),
                next:tree(b.next,id)};
        };
        const roots = Object.values(blocks).filter(b=>!b.parent&&!b.shadow).map(b=>tree(b.id,null));
        const count = Object.values(blocks).filter(b=>!b.shadow).length;
        if (count !== ws.getAllBlocks(false).filter(b=>!b.isShadow()&&!b.isInsertionMarker()).length)
            throw Error('Workspace/VM count differs');
        if (Object.values(blocks).some(b=>!b.shadow&&!seen.has(b.id))) throw Error('Unreachable block');
        return JSON.stringify({roots,count,focus:document.activeElement.getAttribute('aria-label'),
            caret:document.querySelector('[data-position]')?.dataset.position,
            help:document.querySelector('[data-keyboard-authoring]')?.textContent});
    `));
    const waitForRoots = async expected => {
        const serialized = JSON.stringify(expected);
        await driver.wait(async () => JSON.stringify((await state()).roots) === serialized, 10000,
            'VM topology did not reach the expected native history boundary');
        expect((await state()).roots).toEqual(expected);
    };
    const count = async expected => {
        await driver.wait(() => driver.executeScript(`
            const ws = window.__keyboardTestWorkspace;
            return Object.values(window.vm.editingTarget.blocks._blocks).filter(b=>!b.shadow).length===arguments[0] &&
                ws.getAllBlocks(false).filter(b=>!b.isShadow()&&!b.isInsertionMarker()).length===arguments[0];
        `, expected), 10000);
        await state();
    };
    const acceptBlock = async (text, expected) => {
        await keys(...text);
        await driver.wait(until.elementLocated(By.css('[role="option"][aria-selected="true"]')), 10000);
        await keys(Key.ENTER);
        await count(expected);
        await noGhost();
    };
    // Fixture builder: acceptance now always focuses inputs. To author another
    // command, explicitly navigate with real keys to the mouth or outer gap.
    // Focus-policy tests use acceptBlock directly, before any navigation.
    const typeBlock = async (text, expected) => {
        const before = await driver.executeScript('return window.__keyboardTestWorkspace.getAllBlocks(false).map(b=>b.id);');
        await acceptBlock(text, expected);
        const inserted = await driver.executeScript(`const old=new Set(arguments[0]), ws=window.__keyboardTestWorkspace;
            const added=ws.getAllBlocks(false).filter(b=>!b.isShadow()&&!old.has(b.id));
            const ids=new Set(added.map(b=>b.id));
            const root=added.find(b=>!b.getParent()||!ids.has(b.getParent().id));
            if(!root) throw Error('No authored root after accepting a block');
            const body=root.inputList.find(input=>input.connection?.type===3);
            return {id:root.id,reporter:!!root.outputConnection,body:body?.name,tail:!!root.getNextBlock()};`,before);
        if (inserted.reporter) return;
        if (!inserted.body) {
            if (!inserted.tail) { await keys(Key.END); return; }
            // The fixture explicitly continues after the newly authored block,
            // which can be in the middle. Home/End intentionally no longer mean
            // this command's own boundaries.
            const selected=`block:${inserted.id}::`;
            for(let attempt=0;attempt<100 && (await state()).caret!==selected;attempt++) {
                await chord(Key.SHIFT,Key.TAB);
            }
            expect((await state()).caret).toBe(selected);
            await keys(Key.ENTER); await keys(Key.ESCAPE);
            expect((await state()).caret).toBe(`gap:${inserted.id}::`);
            return;
        }
        const destination=`gap:${inserted.id}:${inserted.body}:`;
        for (let attempt=0; attempt<100 && (await state()).caret!==destination; attempt++) await keys(Key.TAB);
        expect((await state()).caret).toBe(destination);
    };
    const fourCommandStack = async () => {
        await typeBlock('move 10 steps', 1);
        await typeBlock('say hello', 2);
        await typeBlock('wait 1 seconds', 3);
        await typeBlock('change x by 10', 4);
    };
    const writeClipboard = async text => {
        await driver.setPermission('clipboard-read', 'granted');
        await driver.setPermission('clipboard-write', 'granted');
        await driver.executeAsyncScript(`const value=arguments[0],done=arguments[arguments.length-1];
            navigator.clipboard.writeText(value).then(()=>done()).catch(error=>done({error:error.message}));`, text)
            .then(result => {
                if (result && result.error) throw new Error(result.error);
            });
    };
    const caretAt = async (kind, blockType, name = '', backwards = false) => {
        if (kind === 'gap' && !name) {
            const occupied = await driver.executeScript(`return window.__keyboardTestWorkspace.getAllBlocks(false)
                .some(b=>b.type===arguments[0]&&!!b.getNextBlock());`,blockType);
            if (occupied) {
                await caretAt('block',blockType,'',backwards);
                // End now means the chain tail. Enter still opens the exact
                // boundary below this command; Escape leaves its resting caret.
                await keys(Key.ENTER); await keys(Key.ESCAPE);
                await expectCaret('gap',blockType);
                return;
            }
        }
        const matches = () => driver.executeScript(`
            const caret = document.querySelector('[data-position]');
            if (!caret) return false;
            const ws = window.ScratchBlocks.getMainWorkspace();
            return ws.getAllBlocks(false).some(b=>b.type===arguments[1] &&
                caret.dataset.position === [arguments[0],b.id,arguments[0]==='field'?'':arguments[2],
                    arguments[0]==='field'?arguments[2]:''].join(':'));
        `, kind, blockType, name);
        const visited = [];
        let reverse = backwards;
        let previous = null;
        let stationary = 0;
        let changedDirection = false;
        for (let attempts = 0; attempts < 100; attempts++) {
            if (await matches()) return;
            const current = (await state()).caret;
            visited.push(current);
            if (current === previous) stationary++;
            else stationary = 0;
            previous = current;
            // Separate scripts are sorted by their live workspace position.
            // A setup helper cannot assume a newly placed root is before or
            // after its target. Try the requested direction first, then turn
            // around once at a real Tab boundary.
            if (stationary >= 1 && !changedDirection) {
                reverse = !reverse;
                changedDirection = true;
            }
            // Deliberate document traversal, not directional-navigation setup.
            if (reverse) await chord(Key.SHIFT, Key.TAB);
            else await keys(Key.TAB);
        }
        throw Error(`Caret did not reach ${kind} ${blockType} ${name}; final traversal ` +
            `${JSON.stringify(visited.slice(-12))}`);
    };
    const expectCaret = async (kind, blockType, name = '') => {
        expect(await driver.executeScript(`const at=document.querySelector('[data-position]').dataset.position;
            return window.__keyboardTestWorkspace.getAllBlocks(false).some(b=>b.type===arguments[1] &&
                at===[arguments[0],b.id,arguments[0]==='field'?'':arguments[2],
                    arguments[0]==='field'?arguments[2]:''].join(':'));`,kind,blockType,name)).toBe(true);
    };
    const expectVisibleCaret = async (kind, blockType, name = '') => {
        await driver.wait(() => driver.executeScript(`const caret=document.querySelector('[data-position]');
            if(!caret||caret.hidden) return false;
            const at=caret.dataset.position,box=caret.getBoundingClientRect();
            return box.width>0&&box.height>0&&window.__keyboardTestWorkspace.getAllBlocks(false)
                .some(b=>b.type===arguments[1]&&at===[arguments[0],b.id,
                    arguments[0]==='field'?'':arguments[2],arguments[0]==='field'?arguments[2]:''].join(':'));`,
        kind,blockType,name),10000,`Visible caret did not reach ${kind} ${blockType} ${name}`);
    };
    const clickWholeBlock = async blockType => {
        const point = await driver.executeScript(`const block=window.__keyboardTestWorkspace.getAllBlocks(false)
            .find(item=>item.type===arguments[0]);
            if(!block) throw Error('Missing block '+arguments[0]);
            const box=block.svgPath_.getBoundingClientRect();
            return {x:Math.round(box.left+14),y:Math.round(box.top+box.height/2)};`,blockType);
        await driver.actions().move({origin:'viewport',x:point.x,y:point.y}).click().perform();
        await painted();
        await expectCaret('block',blockType);
    };
    beforeEach(async () => {
        driver = helper.getDriver();
        fs.mkdirSync(artifacts, {recursive: true});
        const url = new URL(process.env.STUDIO_BROWSER_URL);
        url.searchParams.set('keyboard-authoring', '1');
        await helper.loadUri(url.toString());
        await driver.wait(() => driver.executeScript('return !!window.vm?.editingTarget;'), 30000);
        await driver.executeScript('window.__keyboardTestWorkspace=window.ScratchBlocks.getMainWorkspace();');
        await enableKeyboard();
    });
    afterEach(async () => {
        if (!driver) return;
        const name = expect.getState().currentTestName.replace(/[^a-z0-9]+/gi, '-');
        try {
            fs.writeFileSync(path.join(artifacts, `${name}.png`), Buffer.from(await driver.takeScreenshot(), 'base64'));
            fs.writeFileSync(path.join(artifacts, `${name}.json`), JSON.stringify({
                state: await state().catch(error => ({error: error.message})),
                variables: await driver.executeScript(`return window.__keyboardTestWorkspace.getAllVariables()
                    .map(v=>({name:v.name,type:v.type,local:v.isLocal}));`),
                history: await driver.executeScript(`const ws=window.__keyboardTestWorkspace;
                    const event=e=>({type:e.type,group:e.group,blockId:e.blockId,varId:e.varId});
                    return {undo:ws.undoStack_.map(event),redo:ws.redoStack_.map(event)};`),
                workspaces: await driver.executeScript(`return Object.values(window.ScratchBlocks.Workspace.WorkspaceDB_).map(ws=>({
                    id:ws.id, main:ws===window.ScratchBlocks.getMainWorkspace(),
                    flyout:ws.isFlyout, readOnly:ws.options.readOnly,
                    connected:!!ws.getCanvas?.()?.isConnected,
                    blocks:ws.getAllBlocks(false).map(b=>({id:b.id,type:b.type,shadow:b.isShadow(),
                        template:!ws.rendered?b.inputList.map(i=>({name:i.name,fields:i.fieldRow.map(f=>({
                            name:f.name,text:f.getText(),variable:f.getVariable?.()?.name,
                            dropdown:f instanceof window.ScratchBlocks.FieldDropdown}))})):null}))
                }));`),
                logs: await driver.manage().logs().get('browser')
            }, null, 2));
        } finally {
            await driver.quit();
        }
    });

    const settledSpacer = async mode => {
        // Wait for the actual animation endpoint, not a near-final geometry
        // sample: downstream checks deliberately compare exact native sizes.
        await driver.wait(() => driver.executeScript(`const scene=document.querySelector(
                '.blocklyTransitionWorkspace[data-keyboard-preview="'+arguments[0]+'"]');
            if(!scene) return false;
            return Object.values(window.ScratchBlocks.Workspace.WorkspaceDB_).some(ws=>ws.options.readOnly &&
                ws.getAllBlocks(false).some(b=>b.type==='tw_keyboard_draft_statement' &&
                    b.statementSpacerSize_?.height===window.ScratchBlocks.BlockSvg.MIN_BLOCK_Y));
        `,mode),5000);
    };
    const strictlyNoPreview = async () => {
        await driver.wait(async () => (await driver.findElements(By.css('.blocklyTransitionWorkspace'))).length===0,5000);
        await noGhost();
    };

    const expectFlushSpacer = async () => {
        const edge = await driver.executeScript(`const ws=window.__keyboardTestWorkspace;
            const copy=Object.values(window.ScratchBlocks.Workspace.WorkspaceDB_).find(w=>w.options.readOnly &&
                w.getAllBlocks(false).some(b=>b.type==='tw_keyboard_draft_statement'));
            const spacer=copy.getAllBlocks(false).find(b=>b.type==='tw_keyboard_draft_statement'),
                tail=spacer.getNextBlock(),outline=document.querySelector('[data-position] path[data-source]');
            const actual=outline.getBoundingClientRect(),receiver=tail.svgPath_.getBoundingClientRect();
            return {overlap:actual.bottom-receiver.top,notch:window.ScratchBlocks.BlockSvg.NOTCH_HEIGHT*ws.scale,
                height:actual.height,expected:spacer.height*ws.scale};`);
        // The native notch fits INTO the receiver's matching notch. No extra
        // corner radius may extend the ghost into the receiving block's body.
        // Browser layout quantizes fractional CSS coordinates; 0.05px still
        // distinguishes that from the former 4-world-unit overhang.
        expect(edge.overlap).toBeCloseTo(edge.notch,1);
        expect(edge.height).toBeCloseTo(edge.expected,1);
    };

    test('Shift-click enters Keyboard mode on the exact block without executing it', async () => {
        await acceptBlock('move 10 steps', 1);
        await keys(Key.ESCAPE, Key.ESCAPE);
        expect(await driver.findElement(By.xpath('//button[text()="Keyboard"]')).getAttribute('aria-pressed'))
            .toBe('false');
        const target = await driver.executeScript(`const ws=window.__keyboardTestWorkspace;
            const block=ws.getAllBlocks(false).find(item=>item.type==='motion_movesteps');
            const box=block.svgPath_.getBoundingClientRect();
            return {id:block.id,x:Math.round(box.left+18),y:Math.round(box.top+box.height/2),
                spriteX:window.vm.editingTarget.x};`);
        await driver.actions().keyDown(Key.SHIFT)
            .move({origin: 'viewport', x: target.x, y: target.y}).click().keyUp(Key.SHIFT).perform();
        await driver.wait(() => driver.executeScript(`const root=document.querySelector('[data-keyboard-authoring]');
            return root.querySelector('button').getAttribute('aria-pressed')==='true' &&
                document.activeElement?.getAttribute('aria-label')==='Scratch keyboard editor' &&
                document.querySelector('[data-position]')?.dataset.position===
                    'block:'+arguments[0]+'::';`, target.id), 10000);
        expect(await driver.executeScript('return window.vm.editingTarget.x;')).toBe(target.spriteX);
    });

    test('Shift-click extends the current structural selection through sibling commands', async () => {
        await beginNewScript();
        await typeBlock('move 10 steps', 1);
        await typeBlock('wait 1 seconds', 2);
        await typeBlock('say hello', 3);
        const points = await driver.executeScript(`const ws=window.__keyboardTestWorkspace;
            const first=ws.getTopBlocks(false).find(block=>block.type==='motion_movesteps');
            const chain=[first,first.getNextBlock(),first.getNextBlock().getNextBlock()];
            return chain.map(block=>{const box=block.svgPath_.getBoundingClientRect();
                return {id:block.id,x:Math.round(box.left+18),y:Math.round(box.top+box.height/2)};});`);
        await driver.actions().move({origin: 'viewport', x: points[0].x, y: points[0].y}).click().perform();
        await driver.actions().keyDown(Key.SHIFT)
            .move({origin: 'viewport', x: points[2].x, y: points[2].y}).click().keyUp(Key.SHIFT).perform();
        await driver.wait(() => driver.executeScript(`const caret=document.querySelector('[data-position]');
            return caret?.dataset.rangeCount==='3' && caret.dataset.position.startsWith('range:');`), 10000);
        expect(await driver.executeScript(`return document.querySelector('[data-position]').dataset.position;`))
            .toBe(`range:${points.map(point => point.id).join(',')}`);
    });

    test.each(['light', 'dark'])('Keyboard hover lifts only the native block colour in the %s theme', async theme => {
        const settings = await driver.findElement(By.xpath('//span[text()="Settings"]'));
        await settings.click();
        const switcher = await driver.findElements(By.xpath(`//span[text()="Switch To ${theme === 'dark' ? 'Dark' : 'Light'} Mode"]`));
        if (switcher.length) await switcher[0].click();
        else await settings.click();
        await painted();
        await driver.executeScript('window.__keyboardTestWorkspace=window.ScratchBlocks.getMainWorkspace();');
        await beginNewScript();
        await typeBlock('when flag clicked', 1);
        await typeBlock('move 2 + 3 steps', 3);
        await typeBlock('say hello', 4);
        await caretAt('block','motion_movesteps','',true);
        const toggle = await driver.findElement(By.xpath('//button[text()="Keyboard"]'));
        const inspect = () => driver.executeScript(`const ws=window.__keyboardTestWorkspace;
            return ws.getAllBlocks(false).map(block=>{const style=getComputedStyle(block.svgPath_);
                return {id:block.id,type:block.type,fill:style.fill,stroke:style.stroke,width:style.strokeWidth,
                    filter:style.filter,text:[...block.getSvgRoot().querySelectorAll('.blocklyText')]
                        .map(node=>({fill:getComputedStyle(node).fill,filter:getComputedStyle(node).filter}))};});`);
        await driver.actions().mouseMove(toggle).perform();
        const baseline = await inspect();
        const original = (await state()).roots;
        for (const type of ['event_whenflagclicked', 'operator_add', 'looks_say']) {
            const path = await driver.executeScript(`return window.__keyboardTestWorkspace.getAllBlocks(false)
                .find(block=>block.type===arguments[0]).svgPath_;`, type);
            // The operator's left edge is outside its nested numeric shadow.
            await driver.actions().mouseMove(path, {x: type === 'operator_add' ? 4 : 18, y: 20}).perform();
            const id = baseline.find(block => block.type === type).id;
            await driver.wait(() => driver.executeScript(`return document.querySelector(
                '[data-keyboard-hovered="true"]')?.getAttribute('data-id')===arguments[0];`, id), 5000);
            expect(await driver.findElements(By.css('[data-keyboard-hovered="true"]'))).toHaveLength(1);
            expect(await path.getCssValue('cursor')).toBe('pointer');
            expect(await inspect()).toEqual(baseline.map(block => block.id === id ?
                {...block, filter: 'brightness(1.12)'} : block));
            expect((await state()).roots).toEqual(original);
            await screenshot(`hover-colour-${theme}-${type}`);
            await driver.actions().mouseMove(toggle).perform();
            expect(await inspect()).toEqual(baseline);
        }
        const hatPath = await driver.executeScript(`return window.__keyboardTestWorkspace.getAllBlocks(false)
            .find(block=>block.type==='event_whenflagclicked').svgPath_;`);
        // Native execution glow lives on the SVG group; hover must not replace it.
        await driver.executeScript(`window.__keyboardTestWorkspace.getTopBlocks(false)[0].setGlowStack(true);`);
        await driver.actions().mouseMove(hatPath, {x: 18, y: 22}).perform();
        expect(await driver.executeScript('return getComputedStyle(arguments[0].parentNode).filter;', hatPath))
            .toContain('blocklyStackGlowFilter');
        await driver.executeScript(`window.__keyboardTestWorkspace.getTopBlocks(false)[0].setGlowStack(false);`);
        await driver.actions().mouseMove(toggle).perform();
        await driver.wait(async () => (await driver.findElements(
            By.css('[data-keyboard-hovered="true"]'))).length === 0, 5000);
        await keys(Key.ESCAPE, Key.ESCAPE);
        await driver.actions().mouseMove(hatPath, {x: 18, y: 22}).perform();
        expect(await driver.findElements(By.css('[data-keyboard-hovered="true"]'))).toHaveLength(0);
        expect(await hatPath.getCssValue('cursor')).toBe('grab');
    });

    test('keyboard pointer covers the selected block but native dragging and palette retain their cursors', async () => {
        await typeBlock('move 10 steps',1);
        await caretAt('block','motion_movesteps','',true);
        const path = await driver.executeScript('return window.__keyboardTestWorkspace.getTopBlocks(false)[0].svgPath_;');
        const palette = await driver.findElement(By.css('.blocklyFlyout .blocklyDraggable'));
        expect(await palette.getCssValue('cursor')).toBe('grab');
        await driver.actions().mouseMove(path,{x:12,y:14}).perform();
        expect(await path.getCssValue('cursor')).toBe('pointer');
        const start = await driver.executeScript(`const b=arguments[0].getBoundingClientRect();
            return {x:Math.round(b.left+12),y:Math.round(b.top+14)};`,path);
        await driver.actions().move(start).press().move({x:start.x+100,y:start.y+80}).perform();
        expect(await driver.executeScript('return window.__keyboardTestWorkspace.isDragging();')).toBe(true);
        expect(await path.getCssValue('cursor')).toBe('grabbing');
        await driver.actions().release().perform(); await painted();
        expect(await path.getCssValue('cursor')).toBe('pointer');
    });

    test('the compact Keyboard control sits above the native scrollbar without redundant chrome', async () => {
        const layout = await driver.executeScript(`const root=document.querySelector('[data-keyboard-authoring]');
            const bar=root.firstElementChild.getBoundingClientRect();
            const scroll=window.__keyboardTestWorkspace.scrollbar.hScroll.outerSvg_.getBoundingClientRect();
            return {text:root.firstElementChild.textContent,buttons:[...root.firstElementChild.querySelectorAll('button')]
                .map(button=>button.textContent),barBottom:bar.bottom,scrollTop:scroll.top};`);
        expect(layout.buttons).toEqual(['Keyboard', expect.stringContaining('Alt+K')]);
        expect(layout.text).toContain('Alt+K');
        expect(layout.text).not.toContain('LAB');
        expect(layout.barBottom).toBeLessThanOrEqual(layout.scrollTop - 7);
    });

    test('empty then and else reserve one native caret without changing the project or history', async () => {
        await acceptBlock('if then else',1);
        const before=(await state()).roots;
        const original=await driver.executeScript(`const ws=window.__keyboardTestWorkspace,b=ws.getTopBlocks(false)[0];
            return {id:b.id,height:b.height,undo:ws.undoStack_.length,xml:window.ScratchBlocks.Xml.domToText(
                window.ScratchBlocks.Xml.workspaceToDom(ws))};`);
        await keys(Key.ARROW_RIGHT);
        await settledSpacer('caret');
        const inspect=()=>driver.executeScript(`const ws=window.__keyboardTestWorkspace,real=ws.getBlockById(arguments[0]);
            const copy=Object.values(window.ScratchBlocks.Workspace.WorkspaceDB_).find(c=>c.options.readOnly &&
                c.getBlockById(real.id)),block=copy.getBlockById(real.id),caret=document.querySelector('[data-position]');
            const phantom=copy.getAllBlocks(false).find(b=>b.type==='tw_keyboard_draft_statement');
            return {height:block.height,realHeight:real.height,undo:ws.undoStack_.length,
                xml:window.ScratchBlocks.Xml.domToText(window.ScratchBlocks.Xml.workspaceToDom(ws)),
                parent:phantom.getParent().id,slot:block.inputList.find(i=>i.connection?.targetBlock()===phantom)?.name,
                scene:copy.id,shape:caret.querySelector('path[data-source]').dataset.source,
                caretHeight:caret.getBoundingClientRect().height,scale:ws.scale};`,original.id);
        const then=await inspect();
        expect(then.height).toBeGreaterThan(original.height);
        expect(then.realHeight).toBe(original.height);
        expect(then.undo).toBe(original.undo);
        expect(then.xml).toBe(original.xml);
        expect(then.slot).toBe('SUBSTACK');
        expect(then.shape).toBe('native');
        await screenshot('space-making-then-caret');
        await keys(Key.ENTER); await settledSpacer('draft');
        expect((await inspect()).scene).toBe(then.scene); // no close/reopen/allocation on typing
        expect((await inspect()).height).toBe(then.height);
        await keys(Key.ESCAPE,Key.ARROW_DOWN); await settledSpacer('caret');
        expect((await inspect()).slot).toBe('SUBSTACK2');
        expect((await inspect()).height).toBe(then.height); // only one branch expanded
        await screenshot('space-making-else-caret');
        await keys(Key.ARROW_LEFT); await strictlyNoPreview();
        expect((await state()).roots).toEqual(before);
        await nativeHistory(false); await count(0);
        await nativeHistory(true); await count(1);
        expect((await state()).roots).toEqual(before);
    },90000);

    test('an explicit middle slot moves the native continuation together and accepts one reversible block', async () => {
        await typeBlock('repeat 10',1);
        await typeBlock('move 2 + 3 steps',3);
        await typeBlock('wait 1 seconds',4);
        const before=(await state()).roots;
        await caretAt('block','motion_movesteps','',true);
        await keys(Key.ENTER); await settledSpacer('draft');
        const layout=await driver.executeScript(`const ws=window.__keyboardTestWorkspace;
            const copy=Object.values(window.ScratchBlocks.Workspace.WorkspaceDB_).find(w=>w.options.readOnly &&
                w.getAllBlocks(false).some(b=>b.type==='tw_keyboard_draft_statement'));
            const real=ws.getAllBlocks(false).find(b=>b.type==='control_wait'),tail=copy.getBlockById(real.id),
                shadow=tail.getInput('DURATION').connection.targetBlock(),original=ws.getBlockById(shadow.id);
            return {shift:tail.getRelativeToSurfaceXY().y-real.getRelativeToSurfaceXY().y,
                inputShift:shadow.getRelativeToSurfaceXY().y-original.getRelativeToSurfaceXY().y,
                expected:window.ScratchBlocks.BlockSvg.MIN_BLOCK_Y};`);
        expect(layout.shift).toBeCloseTo(layout.expected,5);
        expect(layout.inputShift).toBeCloseTo(layout.shift,5);
        expect((await state()).roots).toEqual(before);
        await expectFlushSpacer();
        await screenshot('space-making-middle-draft');
        const composer=await driver.executeScript(`const panel=document.querySelector('[aria-label="Type a Scratch block"]')
                .parentElement,rect=panel.getBoundingClientRect();
            const copy=Object.values(window.ScratchBlocks.Workspace.WorkspaceDB_).find(w=>w.options.readOnly &&
                w.getAllBlocks(false).some(b=>b.type==='tw_keyboard_draft_statement'));
            const stack=copy.getTopBlocks(false)[0].getSvgRoot().getBoundingClientRect();
            return {side:panel.dataset.placement,left:rect.left,stackRight:stack.right};`);
        expect(composer.side).toBe('beside');
        expect(composer.left).toBeGreaterThan(composer.stackRight);
        await acceptBlock('say inserted',5);
        expect((await state()).roots[0].inputs.SUBSTACK.next.type).toBe('looks_say');
        expect((await state()).roots[0].inputs.SUBSTACK.next.next.type).toBe('control_wait');
        await nativeHistory(false); await count(4);
        expect((await state()).roots).toEqual(before);
        await nativeHistory(true); await count(5);
        await noGhost();
    },90000);

    test.each([3,6])('the drawn ghost joins the next block cleanly after %s real zoom clicks', async zoomClicks => {
        await typeBlock('move 10 steps',1);
        await typeBlock('wait 1 seconds',2);
        const before=(await state()).roots;
        const zoom=await driver.executeScript(`return [...document.querySelectorAll('.blocklyZoom image')]
            .find(node=>(node.getAttribute('xlink:href')||node.getAttribute('href')||'').includes('zoom-in'));`);
        for(let index=0;index<zoomClicks;index++) await zoom.click();
        await driver.findElement(By.xpath('//button[text()="Keyboard"]')).click();
        await caretAt('block','motion_movesteps','',true);
        await keys(Key.ENTER); await settledSpacer('draft');
        await expectFlushSpacer();
        await screenshot(`space-making-flush-zoom-${zoomClicks}`);
        await keys(Key.ESCAPE,Key.ARROW_DOWN); await strictlyNoPreview();
        expect((await state()).roots).toEqual(before);
    },90000);

    test('the tinted insertion caret animates native space continuously and respects reduced motion', async () => {
        await driver.sendDevToolsCommand('Emulation.setEmulatedMedia', {
            features: [{name:'prefers-reduced-motion',value:'no-preference'}]
        });
        await acceptBlock('if then else',1);
        await keys(Key.ARROW_RIGHT);
        const sample=()=>driver.executeAsyncScript(`const done=arguments[arguments.length-1],start=performance.now(),out=[];
            const frame=()=>{const ws=window.__keyboardTestWorkspace,b=ws.getTopBlocks(false)[0];
                const copy=Object.values(window.ScratchBlocks.Workspace.WorkspaceDB_).find(w=>w.options.readOnly &&
                    w.getBlockById(b.id));
                out.push({height:copy?.getBlockById(b.id).height||b.height,live:b.height,
                    scene:!!copy,caretOpacity:Number(getComputedStyle(document.querySelector('[data-position]')).opacity),
                    opacity:Number(getComputedStyle(document.querySelector('[data-position] path[data-source]')).fillOpacity)});
                if(performance.now()-start>350)done(out);else requestAnimationFrame(frame);};frame();`);
        const opening=await sample();
        expect(new Set(opening.map(f=>Math.round(f.height))).size).toBeGreaterThan(2);
        for(const frame of opening.filter(f=>!f.scene)) expect(frame.caretOpacity).toBe(0);
        for(let i=1;i<opening.length;i++) {
            expect(opening[i].height).toBeGreaterThanOrEqual(opening[i-1].height);
            expect(opening[i].live).toBe(opening[0].live);
        }
        expect(opening.at(-1).opacity).toBeGreaterThan(0);
        expect(opening.at(-1).opacity).toBeLessThan(0.2);
        await keys(Key.ARROW_LEFT);
        const closing=await sample();
        expect(new Set(closing.map(f=>Math.round(f.height))).size).toBeGreaterThan(2);
        for(let i=1;i<closing.length;i++) expect(closing[i].height).toBeLessThanOrEqual(closing[i-1].height);
        await strictlyNoPreview();
        expect(await driver.executeScript(`return getComputedStyle(document.querySelector('[data-position] path[data-source]')).fill;`))
            .toBe('none');
        await driver.sendDevToolsCommand('Emulation.setEmulatedMedia', {
            features: [{name:'prefers-reduced-motion',value:'reduce'}]
        });
        await keys(Key.ARROW_DOWN); await settledSpacer('caret');
        await screenshot('space-making-tinted-caret');
        await keys(Key.ESCAPE, Key.ESCAPE); await strictlyNoPreview();
    },90000);

    test('rapid traversal skips occupied gaps and cancels transient space before native mouse editing', async () => {
        await typeBlock('if then else',1);
        await typeBlock('move 10 steps',2);
        await typeBlock('wait 1 seconds',3);
        await caretAt('block','control_if_else','',true);
        await keys(Key.ARROW_DOWN); await expectCaret('block','motion_movesteps');
        await keys(Key.ARROW_DOWN); await expectCaret('block','control_wait');
        const before=(await state()).roots;
        await keys(Key.ARROW_DOWN); await settledSpacer('caret');
        await driver.actions().sendKeys(Key.ARROW_UP,Key.ARROW_DOWN,Key.ARROW_UP,Key.ARROW_DOWN,Key.ARROW_UP).perform();
        await painted(); await strictlyNoPreview();
        await expectCaret('block','control_wait');
        expect((await state()).roots).toEqual(before);
        await keys(Key.ARROW_DOWN); await settledSpacer('caret');
        const point=await driver.executeScript(`const scene=document.querySelector('.blocklyTransitionWorkspace');
            const ws=Object.values(window.ScratchBlocks.Workspace.WorkspaceDB_).find(w=>w.options.readOnly &&
                w.getAllBlocks(false).some(b=>b.type==='tw_keyboard_draft_statement'));
            const b=ws.getAllBlocks(false).find(b=>b.type==='control_wait'),r=b.svgPath_.getBoundingClientRect();
            return {x:Math.round(r.left+12),y:Math.round(r.top+12)};`);
        await driver.actions().move({x:point.x,y:point.y}).click().perform();
        await painted(); await strictlyNoPreview();
        await expectCaret('block','control_wait');
        await keys(Key.DELETE); await count(2);
        await nativeHistory(false); await count(3);
        expect((await state()).roots).toEqual(before);
        await driver.findElement(By.xpath('//button[text()="Keyboard"]')).click();
        await strictlyNoPreview();
    },90000);

    test.each([
        ['say hello', 'input', 'looks_say', 'MESSAGE', 1],
        ['move 10 steps', 'input', 'motion_movesteps', 'STEPS', 1],
        ['repeat 10', 'input', 'control_repeat', 'TIMES', 1],
        ['if 1 < 2 then', 'block', 'operator_lt', '', 2],
        ['when space key pressed', 'field', 'event_whenkeypressed', 'KEY_OPTION', 1]
    ])('inputs first when accepting %s, including provided values and native menus',
        async (query, kind, opcode, slot, total) => {
        await acceptBlock(query, total);
        await expectCaret(kind, opcode, slot);
        const before = (await state()).roots;
        await nativeHistory(false); await count(0);
        await nativeHistory(true); await count(total);
        expect((await state()).roots).toEqual(before);
        await noGhost();
    }, 90000);

    // Unit navigation covers all inline-selector variants. One native rendered
    // math block is enough to retain this assembled-editor boundary.
    test('accepting abs focuses its operand, not the chosen operation selector', async () => {
        const operation='abs';
        await acceptBlock(operation,1);
        await expectCaret('input','operator_mathop','NUM');
        expect((await state()).roots[0].fields.OPERATOR).toBe(operation);
        await keys('7',Key.ENTER);
        expect((await state()).roots[0].inputs.NUM.fields.NUM).toBe('7');
        await caretAt('field','operator_mathop','OPERATOR',true);
        await keys(Key.ENTER);
        expect(await driver.findElements(By.css('.blocklyDropDownDiv .goog-menuitem'))).not.toHaveLength(0);
        await keys(Key.ESCAPE);
        await noGhost();
    },90000);

    test('Delete removes a whole nested reporter and leaves its restored value hole ready for replacement', async () => {
        await acceptBlock('move 10 steps',1);
        await acceptBlock('abs',2);
        // Explicitly select the operand so this test can reproduce deletion on
        // the old build too, independently of the new acceptance-focus rule.
        await caretAt('input','operator_mathop','NUM');
        await acceptBlock('1 + 2',3);
        const before=(await state()).roots;
        await caretAt('block','operator_mathop','',true);
        await keys(Key.DELETE); await count(1);
        await expectCaret('input','motion_movesteps','STEPS');
        expect((await state()).roots[0].inputs.STEPS.fields.NUM).toBe('10');
        await acceptBlock('floor',2);
        expect((await state()).roots[0].inputs.STEPS.fields.OPERATOR).toBe('floor');
        await nativeHistory(false); await count(1);
        await nativeHistory(false); await count(3);
        expect((await state()).roots).toEqual(before);
        await nativeHistory(true); await count(1);
        await nativeHistory(true); await count(2);
        await noGhost();
    },90000);

    test.each([['Delete',Key.DELETE],['Backspace',Key.BACK_SPACE]])(
        'command removal keeps the right structural destination for %s', async (name,key) => {
        await typeBlock('move 10 steps',1);
        await typeBlock('wait 1 seconds',2);
        await typeBlock('say hello',3);
        const before=(await state()).roots;
        await caretAt('block','control_wait','',true);
        await keys(key); await count(2);
        await expectCaret(key===Key.DELETE?'gap':'block','motion_movesteps');
        if(key===Key.BACK_SPACE) await keys(Key.ENTER);
        await acceptBlock('turn clockwise 15 degrees',3);
        expect((await state()).roots[0].next.type).toBe('motion_turnright');
        expect((await state()).roots[0].next.next.type).toBe('looks_say');
        await nativeHistory(false); await count(2);
        await nativeHistory(false); await count(3);
        expect((await state()).roots).toEqual(before);
        await noGhost();
    },90000);

    test.each(['SUBSTACK','SUBSTACK2'])('Delete in the first %s command preserves its empty C-mouth caret', async mouth => {
        await acceptBlock('if then else',1);
        await caretAt('gap','control_if_else',mouth);
        await typeBlock('wait 1 seconds',2);
        await caretAt('block','control_wait','',true);
        await keys(Key.DELETE); await count(1);
        await expectCaret('gap','control_if_else',mouth);
        await acceptBlock('move 10 steps',2);
        expect((await state()).roots[0].inputs[mouth].type).toBe('motion_movesteps');
        await nativeHistory(false); await count(1);
        await nativeHistory(false); await count(2);
        expect((await state()).roots[0].inputs[mouth].type).toBe('control_wait');
        await noGhost();
    },90000);

    test('Delete preserves an empty Boolean hole and Backspace returns from a reporter to its expression owner', async () => {
        await acceptBlock('if then',1);
        await acceptBlock('1 < 2',2);
        await caretAt('block','operator_lt','',true);
        await keys(Key.DELETE); await count(1);
        await expectCaret('input','control_if','CONDITION');
        await acceptBlock('not',2);
        expect((await state()).roots[0].inputs.CONDITION.type).toBe('operator_not');
        await caretAt('block','operator_not','',true);
        await keys(Key.BACK_SPACE); await count(1);
        await expectCaret('block','control_if');
        await nativeHistory(false); await count(2);
        await noGhost();
    },90000);

    test.each([false,true])('Delete at a stack root preserves its replacement site (continuation: %s)', async hasTail => {
        await typeBlock('move 10 steps',1);
        if(hasTail) await typeBlock('wait 1 seconds',2);
        const original=await driver.executeScript(`const b=window.__keyboardTestWorkspace.getTopBlocks(false)[0];
            return {id:b.id,xy:b.getRelativeToSurfaceXY(),box:b.svgPath_.getBoundingClientRect().toJSON()};`);
        await beginNewScript();
        await typeBlock('say unrelated',hasTail?3:2);
        await caretAt('block','motion_movesteps','',true);
        await keys(Key.DELETE); await count(hasTail?2:1);
        if(hasTail) await expectCaret('before','control_wait');
        else {
            expect((await state()).caret).toBe('workspace:::');
            // Reveal can pan to clear workspace chrome; preserve the native
            // deletion point, not its former screen coordinates.
            const point=await driver.executeScript(`const ws=window.__keyboardTestWorkspace,
                rect=document.querySelector('[data-position]').getBoundingClientRect(),
                p=ws.getParentSvg().createSVGPoint(); p.x=rect.left;p.y=rect.top;
                const local=p.matrixTransform(ws.getCanvas().getScreenCTM().inverse());
                return {x:local.x,y:local.y};`);
            expect(point.x).toBeCloseTo(original.xy.x,0);
            expect(point.y).toBeCloseTo(original.xy.y,0);
        }
        await acceptBlock('turn clockwise 15 degrees',hasTail?3:2);
        const roots=(await state()).roots;
        expect(roots.find(b=>b.type==='looks_say').inputs.MESSAGE.fields.TEXT).toBe('unrelated');
        if(hasTail) expect(roots.find(b=>b.type==='motion_turnright').next.type).toBe('control_wait');
        await nativeHistory(false); await count(hasTail?2:1);
        await nativeHistory(false); await count(hasTail?3:2);
        await noGhost();
    },90000);

    test('a bare say completion focuses its default message and accepts typing without another key', async () => {
        await acceptBlock('say', 1);
        expect((await state()).roots[0].type).toMatch(/^looks_say/);
        expect((await state()).caret).toMatch(/^input:.*:MESSAGE:$/);
        const before = (await state()).roots;
        await keys(...'my message', Key.ENTER);
        expect((await state()).roots[0].inputs.MESSAGE.fields.TEXT).toBe('my message');
        await nativeHistory(false); await painted();
        expect((await state()).roots).toEqual(before);
        await noGhost();
    }, 90000);

    test.each(['set x to 50', 'say hello'])('Enter on a completed command %s starts insertion below without revisiting inputs',
        async query => {
        await typeBlock(query, 1);
        await typeBlock('wait 1 seconds', 2);
        const before = (await state()).roots;
        await keys(Key.HOME, Key.ENTER);
        expect((await state()).focus).toBe('Type a Scratch block');
        expect(await driver.findElement(By.css('[aria-label="Type a Scratch block"]')).getAttribute('value')).toBe('');
        expect((await state()).roots).toEqual(before);
        await acceptBlock('turn clockwise 15 degrees', 3);
        expect((await state()).roots[0].next.type).toBe('motion_turnright');
        expect((await state()).roots[0].next.next.type).toBe('control_wait');
        await nativeHistory(false); await count(2);
        expect((await state()).roots).toEqual(before);
        await nativeHistory(true); await count(3);
        await noGhost();
    }, 90000);

    test.each([false, true])('Up opens insertion above its own stack for a new hat (second script: %s)',
        async secondScript => {
        if (secondScript) {
            await typeBlock('wait 1 seconds', 1);
            await beginNewScript();
        }
        await typeBlock('set x to 50', secondScript ? 2 : 1);
        if (secondScript) {
            // Keep the first script directly above in the same column. It must
            // not steal Up from this stack's legal insertion-before boundary.
            await driver.executeScript(`const blocks=window.__keyboardTestWorkspace.getAllBlocks(false),
                upper=blocks.find(b=>b.type==='control_wait'), lower=blocks.find(b=>b.type==='motion_setx'),
                a=upper.getRelativeToSurfaceXY(), b=lower.getRelativeToSurfaceXY();
                lower.moveBy(a.x-b.x,a.y+160-b.y);`);
            await painted();
        }
        const before = (await state()).roots;
        const original = await driver.executeScript(`const block=window.__keyboardTestWorkspace.getAllBlocks(false)
            .find(b=>b.type==='motion_setx'); return {id:block.id,x:block.getRelativeToSurfaceXY().x,
                y:block.getRelativeToSurfaceXY().y};`);
        await keys(Key.HOME, Key.ARROW_UP);
        expect((await state()).caret).toBe(`before:${original.id}::`);
        const geometry = await driver.executeScript(`const ws=window.__keyboardTestWorkspace, b=ws.getBlockById(arguments[0]);
            const c=document.querySelector('[data-position]').getBoundingClientRect(), box=b.svgPath_.getBoundingClientRect();
            return {caretTop:c.top,caretBottom:c.bottom,blockTop:box.top,notch:window.ScratchBlocks.BlockSvg.NOTCH_HEIGHT*ws.scale};`,original.id);
        expect(geometry.caretTop).toBeLessThan(geometry.blockTop-15);
        expect(geometry.caretBottom).toBeCloseTo(geometry.blockTop+geometry.notch,0);
        if (secondScript) {
            const upperId = await driver.executeScript(`return window.__keyboardTestWorkspace.getAllBlocks(false)
                .find(b=>b.type==='control_wait').id;`);
            await keys(Key.ARROW_UP);
            expect((await state()).caret).toBe(`gap:${upperId}::`);
            await keys(Key.ARROW_DOWN); await expectCaret('block','motion_setx');
            await keys(Key.ARROW_UP); await expectCaret('before','motion_setx');
        }
        await keys(Key.ARROW_LEFT, Key.ARROW_RIGHT);
        expect((await state()).caret).toBe(`before:${original.id}::`);
        expect((await state()).roots).toEqual(before);
        await keys(Key.ARROW_DOWN);
        expect((await state()).caret).toBe(`block:${original.id}::`);
        await keys(Key.ARROW_UP); await keys(...'when flag clicked');
        await screenshot(`above-stack-draft-${secondScript}`);
        expect((await state()).roots).toEqual(before);
        await keys(Key.ESCAPE); await noGhost();
        expect((await state()).caret).toBe(`before:${original.id}::`);
        await acceptBlock('when flag clicked', secondScript ? 3 : 2);
        const hat=(await state()).roots.find(b=>b.type==='event_whenflagclicked');
        expect(hat.next.type).toBe('motion_setx');
        const at=await driver.executeScript(`const b=window.__keyboardTestWorkspace.getBlockById(arguments[0]);
            return {x:b.getRelativeToSurfaceXY().x,y:b.getRelativeToSurfaceXY().y};`,original.id);
        expect(at.x).toBeCloseTo(original.x,0);
        expect(at.y).toBeCloseTo(original.y,0);
        await nativeHistory(false); await count(secondScript ? 2 : 1);
        expect((await state()).roots).toEqual(before);
        await nativeHistory(true); await count(secondScript ? 3 : 2);
        await noGhost();
    }, 90000);

    test.each(['when flag clicked', '1 + 2'])('Up never offers an attachment above a hat or loose reporter: %s',
        async query => {
        await acceptBlock(query, 1);
        await keys(Key.HOME);
        const before=(await state()).caret;
        await keys(Key.ARROW_UP, Key.ARROW_UP);
        expect((await state()).caret).toBe(before);
        expect((await state()).caret).toMatch(/^block:/);
        await noGhost();
    }, 90000);

    test('Shift Enter does not open an impossible insertion above a hat', async () => {
        await typeBlock('when flag clicked',1);
        await keys(Key.HOME);
        const before=(await state()).roots;
        await chord(Key.SHIFT,Key.ENTER);
        await expectCaret('block','event_whenflagclicked');
        expect((await state()).focus).toBe('Scratch keyboard editor');
        expect((await state()).roots).toEqual(before);
        expect(await driver.findElement(By.css('[aria-label="Type a Scratch block"]')).isDisplayed()).toBe(false);
        await strictlyNoPreview();
        await keys(Key.ENTER);
        await acceptBlock('move 10 steps',2);
        expect((await state()).roots[0].next.type).toBe('motion_movesteps');
    },90000);

    // Unit navigation retains the complete hat/cap matrix. These two live
    // representatives cover ordinary and fully constrained stack boundaries.
    test.each([[false,false],[true,true]])(
        'Home and End choose whole-stack boundaries without editing (hat %s, cap %s)', async (hat, cap) => {
            let total=0;
            if(hat) await typeBlock('when flag clicked',++total);
            await typeBlock('move 10 steps',++total);
            await typeBlock('wait 1 seconds',++total);
            if(cap) await typeBlock('stop all',++total);
            await beginNewScript();
            await typeBlock('say other stack',++total);
            const before=(await state()).roots;
            await caretAt('input','motion_movesteps','STEPS',true);
            for(let repeat=0;repeat<2;repeat++) {
                await keys(Key.END); await expectCaret(cap?'block':'gap',cap?'control_stop':'control_wait');
                await keys(Key.HOME); await expectCaret('block',hat?'event_whenflagclicked':'motion_movesteps');
            }
            expect((await state()).roots).toEqual(before);
            await caretAt('block','control_wait');
            await chord(Key.SHIFT,Key.ENTER); await keys(Key.ESCAPE);
            await keys(Key.HOME); await expectCaret('block',hat?'event_whenflagclicked':'motion_movesteps');
            await keys(Key.END); await expectCaret(cap?'block':'gap',cap?'control_stop':'control_wait');
            if(!cap) {
                await typeBlock('change y by 3',++total);
                const after=(await state()).roots;
                await nativeHistory(false); await count(total-1); await waitForRoots(before);
                await nativeHistory(true); await count(total); await waitForRoots(after);
            }
            await noGhost();
        },90000);

    test('Home and End stay within the current nested then or else chain', async () => {
        await typeBlock('if then else',1);
        await typeBlock('set x to 2',2);
        await typeBlock('repeat 2',3);
        await typeBlock('move 3 steps',4);
        await typeBlock('wait 1 seconds',5);
        await caretAt('block','control_repeat','',true);
        await keys(Key.ENTER); await typeBlock('change x by 4',6);
        await caretAt('gap','control_if_else','SUBSTACK2');
        await typeBlock('say else',7); await typeBlock('stop this script',8);
        const before=(await state()).roots;
        const cases=[
            ['looks_say','MESSAGE','looks_say','control_stop','block'],
            ['control_repeat','TIMES','motion_setx','motion_changexby','gap'],
            ['motion_movesteps','STEPS','motion_movesteps','control_wait','gap'],
            ['control_if_else','CONDITION','control_if_else','control_if_else','gap']
        ];
        for(const [owner,inputName,head,tail,tailKind] of cases) {
            await caretAt('input',owner,inputName,true);
            await keys(Key.HOME); await expectCaret('block',head);
            await keys(Key.END); await expectCaret(tailKind,tail);
            expect((await state()).roots).toEqual(before);
        }
        await caretAt('input','motion_movesteps','STEPS',true);
        await keys(Key.END); await typeBlock('change y by 5',9);
        const after=(await state()).roots;
        await nativeHistory(false); await count(8); await waitForRoots(before);
        await nativeHistory(true); await count(9); await waitForRoots(after);
        await noGhost();
    },120000);

    test.each(['SUBSTACK','SUBSTACK2'])('Home and End retain an empty %s insertion site', async mouth => {
        await typeBlock('if then else',1);
        if(mouth==='SUBSTACK2') await caretAt('gap','control_if_else',mouth);
        const before=(await state()).roots;
        await keys(Key.HOME,Key.END,Key.HOME); await expectCaret('gap','control_if_else',mouth);
        expect((await state()).roots).toEqual(before);
        await typeBlock('move 3 steps',2);
        expect((await state()).roots[0].inputs[mouth].type).toBe('motion_movesteps');
        await nativeHistory(false); await count(1); await waitForRoots(before);
    },90000);

    test('Home and End keep a free workspace caret independent of existing scripts', async () => {
        await typeBlock('move 10 steps',1);
        await beginNewScript();
        await keys(Key.ENTER,Key.ESCAPE);
        const before=await state();
        expect(before.caret).toBe('workspace:::');
        await keys(Key.HOME,Key.END);
        expect((await state()).caret).toBe(before.caret);
        expect((await state()).roots).toEqual(before.roots);
        await typeBlock('say separate',2);
        expect((await state()).roots).toHaveLength(2);
        await nativeHistory(false); await count(1); await waitForRoots(before.roots);
    },90000);

    test('Home and End retain native text and draft editing rather than jumping between blocks', async () => {
        await typeBlock('say hello',1); await typeBlock('wait 1 seconds',2);
        const before=(await state()).roots;
        await caretAt('input','looks_say','MESSAGE',true);
        await keys(Key.F2);
        const field=await driver.wait(until.elementLocated(By.css('input.blocklyHtmlInput')),10000);
        await keys(Key.HOME,'X',Key.END,'Y');
        expect(await field.getAttribute('value')).toBe('XhelloY');
        expect(await driver.executeScript('return document.activeElement===arguments[0];',field)).toBe(true);
        await keys(Key.ESCAPE);
        await driver.wait(async()=>(await state()).focus==='Scratch keyboard editor',10000);
        await keys(...'abc',Key.HOME,'A',Key.END,'Z');
        expect(await driver.findElement(By.css('input[role="combobox"]')).getAttribute('value')).toBe('AabcZ');
        await expectCaret('input','looks_say','MESSAGE');
        await keys(Key.ESCAPE); await waitForRoots(before); await noGhost();
    },90000);

    test('horizontal arrows stay within a command and its nested expression while Tab can change rows', async () => {
        await typeBlock('say first', 1);
        await typeBlock('move 2 + 3 steps', 3);
        await typeBlock('wait 1 seconds', 4);
        await caretAt('block', 'motion_movesteps', '', true);
        await expectCaret('block', 'motion_movesteps');
        const before=(await state()).roots;
        await keys(Key.ARROW_LEFT);
        await expectCaret('block', 'motion_movesteps');
        await keys(Key.ARROW_RIGHT); await expectCaret('block', 'operator_add');
        await keys(Key.ARROW_RIGHT); await expectCaret('input', 'operator_add', 'NUM1');
        await keys(Key.ARROW_RIGHT); await expectCaret('input', 'operator_add', 'NUM2');
        await keys(Key.ARROW_RIGHT); await expectCaret('input', 'operator_add', 'NUM2');
        await keys(Key.TAB); await expectCaret('block', 'control_wait');
        await keys(Key.ARROW_LEFT); await expectCaret('block', 'control_wait');
        await chord(Key.SHIFT, Key.TAB); await expectCaret('input', 'operator_add', 'NUM2');
        await keys(Key.END); await expectCaret('gap', 'control_wait');
        await keys(Key.ARROW_LEFT,Key.ARROW_RIGHT); await expectCaret('gap','control_wait');
        expect((await state()).roots).toEqual(before);
        await noGhost();
    }, 90000);

    test('Enter after typing the final set-x value reaches the next insertion point', async () => {
        await acceptBlock('set x to', 1);
        await expectCaret('input','motion_setx','X');
        const before=(await state()).roots;
        await keys('5','0',Key.ENTER);
        await expectCaret('gap','motion_setx');
        expect((await state()).roots[0].inputs.X.fields.NUM).toBe('50');
        await nativeHistory(false); await painted();
        expect((await state()).roots).toEqual(before);
        await nativeHistory(true); await painted();
        expect((await state()).roots[0].inputs.X.fields.NUM).toBe('50');
        await keys(Key.ENTER);
        expect((await state()).focus).toBe('Type a Scratch block');
        await acceptBlock('wait 1 seconds',2);
        expect((await state()).roots[0].next.type).toBe('control_wait');
        await noGhost();
    }, 90000);

    test('horizontal arrows keep C headers and bodies on separate rows with deliberate column exits', async () => {
        await acceptBlock('if 1 < 2 then',2);
        await caretAt('gap','control_if','SUBSTACK');
        await typeBlock('move 10 steps',3);
        await typeBlock('wait 1 seconds',4);
        const before=(await state()).roots;
        await caretAt('block','control_if','',true);
        await keys(Key.ARROW_RIGHT); await expectCaret('block','operator_lt');
        await keys(Key.ARROW_RIGHT); await expectCaret('input','operator_lt','OPERAND1');
        await keys(Key.ARROW_RIGHT); await expectCaret('input','operator_lt','OPERAND2');
        const expectCue = async () => expect(await driver.executeScript(
            `return !document.querySelector('[data-column-cue]').hidden;`)).toBe(true);
        await keys(Key.ARROW_RIGHT); await expectCaret('input','operator_lt','OPERAND2');
        await expectCue();
        await keys(Key.ARROW_DOWN); await expectCaret('block','motion_movesteps');
        await keys(Key.ARROW_RIGHT); await expectCaret('input','motion_movesteps','STEPS');
        await keys(Key.ARROW_RIGHT); await expectCaret('input','motion_movesteps','STEPS');
        await expectCue();
        await keys(Key.ARROW_RIGHT);
        expect((await state()).caret.startsWith('workspace:')).toBe(true);
        await keys(Key.ARROW_LEFT); await expectCaret('block','motion_movesteps');
        await keys(Key.ARROW_LEFT); await expectCaret('block','motion_movesteps');
        await expectCue();
        await keys(Key.ARROW_UP); await expectCaret('block','control_if');
        await keys(Key.ARROW_DOWN,Key.ARROW_DOWN); await expectCaret('block','control_wait');
        await keys(Key.ARROW_LEFT); await expectCaret('block','control_wait');
        await expectCue();
        await keys(Key.HOME); await expectCaret('block','motion_movesteps');
        await chord(Key.SHIFT,Key.ENTER); await keys(Key.ESCAPE);
        // Cancellation retains the explicit before-caret. It shares the
        // mouth's native connection, but arming an exit must not move it.
        await expectCaret('before','motion_movesteps');
        await keys(Key.ARROW_RIGHT); await expectCaret('before','motion_movesteps');
        await keys(Key.ARROW_LEFT); await expectCaret('before','motion_movesteps');
        await keys(Key.ARROW_DOWN); await expectCaret('block','motion_movesteps');
        expect((await state()).roots).toEqual(before);
        await noGhost();
    }, 90000);

    test('vertical arrows visit statements without between-block gaps or expression inputs', async () => {
        await typeBlock('say first', 1);
        await typeBlock('move 2 + 3 * 4 steps', 4);
        await typeBlock('wait 1 seconds', 5);
        const before=(await state()).roots;
        await caretAt('block','looks_say','',true);
        await keys(Key.ARROW_UP); await expectCaret('before','looks_say');
        await keys(Key.ARROW_DOWN); await expectCaret('block','looks_say');
        const route=[['block','looks_say'],['block','motion_movesteps'],
            ['block','control_wait'],['gap','control_wait']];
        for (const [kind,type] of route.slice(1)) {
            await keys(Key.ARROW_DOWN); await expectCaret(kind,type);
        }
        await keys(Key.ARROW_DOWN);
        expect((await state()).caret).toBe('workspace:::');
        await keys(Key.ARROW_UP); await expectCaret('gap','control_wait');
        for (const [kind,type] of route.slice(0,-1).reverse()) {
            await keys(Key.ARROW_UP); await expectCaret(kind,type);
        }
        await caretAt('input','operator_multiply','NUM2');
        await keys(Key.ARROW_DOWN); await expectCaret('block','control_wait');
        await caretAt('input','operator_multiply','NUM2',true);
        await keys(Key.ARROW_UP); await expectCaret('block','looks_say');
        expect((await state()).roots).toEqual(before);
        await nativeHistory(false); await count(4);
        await nativeHistory(true); await count(5);
        expect((await state()).roots).toEqual(before);
        await noGhost();
    },90000);

    test('repeated Down continues from a writable stack end into the next visual script', async () => {
        await typeBlock('move 10 steps',1);
        await keys(Key.ENTER,Key.ENTER);
        await typeBlock('say below',2);
        const before=(await state()).roots;
        await caretAt('block','motion_movesteps','',true);
        await keys(Key.ARROW_DOWN); await expectCaret('gap','motion_movesteps');
        await keys(Key.ARROW_DOWN); await expectCaret('block','looks_say');
        await keys(Key.ARROW_UP); await expectCaret('before','looks_say');
        await keys(Key.ARROW_DOWN); await expectCaret('block','looks_say');
        expect((await state()).roots).toEqual(before);
        await noGhost();
    },90000);

    test('Down from the last column tail offers an aligned new script and accepts a hat', async () => {
        await typeBlock('move 10 steps',1);
        await clickWholeBlock('motion_movesteps');
        await keys(Key.ARROW_DOWN); await expectCaret('gap','motion_movesteps');
        const before=(await state()).roots;
        await keys(Key.ARROW_DOWN);
        const placeholder=await driver.executeScript(`const caret=document.querySelector('[data-position]'),
            block=window.__keyboardTestWorkspace.getAllBlocks(false).find(b=>b.type==='motion_movesteps'),
            root=block.getRootBlock(),caretBox=caret.getBoundingClientRect(),rootBox=root.svgPath_.getBoundingClientRect();
            return {kind:caret.dataset.position.split(':')[0],left:caretBox.left,top:caretBox.top,
                rootLeft:rootBox.left,rootBottom:rootBox.bottom};`);
        expect(placeholder.kind).toBe('workspace');
        expect(Math.abs(placeholder.left-placeholder.rootLeft)).toBeLessThan(8);
        expect(placeholder.top).toBeGreaterThan(placeholder.rootBottom);
        expect((await state()).roots).toEqual(before);
        await typeBlock('when flag clicked',2);
        const roots=await driver.executeScript(`return window.__keyboardTestWorkspace.getTopBlocks(false)
            .map(block=>({type:block.type,x:block.getRelativeToSurfaceXY().x,y:block.getRelativeToSurfaceXY().y}));`);
        expect(roots.map(root=>root.type)).toEqual(['motion_movesteps','event_whenflagclicked']);
        expect(roots[1].x).toBeCloseTo(roots[0].x,4);
        expect(roots[1].y).toBeGreaterThan(roots[0].y);
        await noGhost();
    },90000);

    test('horizontal arrows preserve inputs and use the complete selection height between scripts', async () => {
        await typeBlock('move 10 steps',1);
        await typeBlock('wait 1 seconds',2);
        await typeBlock('say left tail',3);
        await beginNewScript();
        await typeBlock('set y to 4',4);
        await typeBlock('turn clockwise 15 degrees',5);
        await typeBlock('change y by 2',6);
        const layout=await driver.executeScript(`const ws=window.__keyboardTestWorkspace,
            left=ws.getTopBlocks(false).find(block=>block.type==='motion_movesteps'),
            right=ws.getTopBlocks(false).find(block=>block.type==='motion_sety'),
            a=left.getRelativeToSurfaceXY(),b=right.getRelativeToSurfaceXY();
            right.moveBy((a.x+420)-b.x,a.y-b.y);
            return {left:left.getRelativeToSurfaceXY(),right:right.getRelativeToSurfaceXY()};`);
        expect(layout.right.x-layout.left.x).toBeCloseTo(420,4);
        expect(layout.right.y).toBeCloseTo(layout.left.y,4);
        const before=(await state()).roots;
        await clickWholeBlock('motion_movesteps');
        await keys(Key.ARROW_RIGHT); await expectCaret('input','motion_movesteps','STEPS');
        await keys(Key.ARROW_RIGHT); await expectCaret('input','motion_movesteps','STEPS');
        await keys(Key.ARROW_RIGHT); await expectCaret('block','motion_sety');
        await keys(Key.ARROW_LEFT); await expectCaret('block','motion_sety');
        await keys(Key.ARROW_LEFT); await expectCaret('block','motion_movesteps');
        await chord(Key.CONTROL,'a');
        expect((await state()).caret.startsWith('range:')).toBe(true);
        await keys(Key.ARROW_RIGHT);
        expect((await state()).caret.startsWith('range:')).toBe(true);
        await keys(Key.ARROW_RIGHT); await expectCaret('block','motion_turnright');
        expect((await state()).roots).toEqual(before);
        await noGhost();
    },90000);

    test.each([0.75, 1.5])('horizontal lane memory avoids drift through a tall C block at zoom %s', async scale => {
        await driver.executeScript(`const ws=window.__keyboardTestWorkspace;
            let chain='<block type="control_wait"><value name="DURATION"><shadow type="math_positive_number">'+
                '<field name="NUM">1</field></shadow></value>';
            const body=chain+('<next>'+chain).repeat(7)+'</block></next>'.repeat(7)+'</block>';
            const xml='<xml><block type="looks_show" x="800" y="170"/>'+
                '<block type="control_forever" x="440" y="60"><statement name="SUBSTACK">'+body+'</statement></block>'+
                '<block type="looks_hide" x="80" y="170"/><block type="sound_stopallsounds" x="80" y="320"/></xml>';
            window.ScratchBlocks.Xml.domToWorkspace(window.ScratchBlocks.Xml.textToDom(xml),ws);
            ws.setScale(arguments[0]);ws.resize();`, scale);
        await count(12);
        // Tab reaches the first script; use its native identity through the
        // public caret path, then real keys navigate across the three columns.
        await caretAt('block', 'looks_show');
        const before = (await state()).roots;
        await keys(Key.ARROW_LEFT); await expectCaret('block', 'looks_show');
        // Body rows are spatial destinations too. Enter the command on the
        // remembered horizontal band, not the taller enclosing C silhouette.
        await keys(Key.ARROW_LEFT); await expectCaret('block', 'control_wait');
        const entered = (await state()).caret;
        await keys(Key.ARROW_LEFT); expect((await state()).caret).toBe(entered);
        await keys(Key.ARROW_LEFT); await expectCaret('block', 'looks_hide');
        expect((await state()).roots).toEqual(before);
        // A fresh deliberate selection resets the remembered band. The C
        // block's whole silhouette now favours the lower command instead.
        await caretAt('block', 'control_forever');
        await keys(Key.ARROW_LEFT, Key.ARROW_LEFT);
        await expectCaret('block', 'sound_stopallsounds');
        expect((await state()).roots).toEqual(before);
        await screenshot(`column-height-memory-${scale}`);
    }, 90000);

    test.each([0.75, 1.5, 3])('horizontal column round trips retain nested rows and full C selections at zoom %s', async scale => {
        await driver.executeScript(`const ws=window.__keyboardTestWorkspace;
            const xml='<xml><block type="event_whenflagclicked" x="100" y="80"><next>'+
                '<block type="control_if_else"><statement name="SUBSTACK">'+
                '<block type="control_repeat"><value name="TIMES"><shadow type="math_whole_number">'+
                '<field name="NUM">10</field></shadow></value><statement name="SUBSTACK">'+
                '<block type="motion_movesteps"><value name="STEPS"><shadow type="math_number">'+
                '<field name="NUM">10</field></shadow></value></block></statement><next>'+
                '<block type="control_wait"><value name="DURATION"><shadow type="math_positive_number">'+
                '<field name="NUM">1</field></shadow></value></block></next></block></statement>'+
                '<statement name="SUBSTACK2"><block type="looks_show"/></statement><next>'+
                '<block type="looks_hide"/></next></block></next></block></xml>';
            window.ScratchBlocks.Xml.domToWorkspace(window.ScratchBlocks.Xml.textToDom(xml),ws);
            ws.setScale(arguments[0]);ws.resize();`, scale);
        await count(7);
        const nativeState = () => driver.executeScript(`const ws=window.__keyboardTestWorkspace;
            return {xml:window.ScratchBlocks.Xml.domToText(window.ScratchBlocks.Xml.workspaceToDom(ws)),
                undo:ws.undoStack_.length,redo:ws.redoStack_.length};`);
        const before = await nativeState();
        for (const [type, input] of [['control_if_else','CONDITION'], ['control_repeat','TIMES'],
            ['motion_movesteps','STEPS'], ['control_wait','DURATION'], ['looks_show','']]) {
            await caretAt(input ? 'input' : 'block', type, input);
            const start = (await state()).caret;
            await keys(Key.ARROW_RIGHT); expect((await state()).caret).toBe(start);
            await keys(Key.ARROW_RIGHT);
            expect((await state()).caret.startsWith('workspace:')).toBe(true);
            // Two empty columns, so this also exercises continued free travel
            // rather than just an immediate special-case reverse operation.
            await keys(Key.ARROW_RIGHT, Key.ARROW_LEFT, Key.ARROW_LEFT);
            await expectCaret('block', type);
            await keys(Key.ARROW_LEFT); await expectCaret('block', type);
            await keys(Key.ARROW_LEFT);
            expect((await state()).caret.startsWith('workspace:')).toBe(true);
            await keys(Key.ARROW_RIGHT); await expectCaret('block', type);
            await driver.wait(() => driver.executeScript(`const ws=window.__keyboardTestWorkspace;
                const block=ws.getAllBlocks(false).find(b=>b.type===arguments[0]);
                const box=block.svgPath_.getBoundingClientRect();
                const view=ws.getParentSvg().getBoundingClientRect(),m=ws.getMetrics();
                const left=view.left+m.absoluteLeft+m.flyoutWidth;
                return box.width>0&&box.left>=left&&box.left<view.right-18&&
                    box.top>=view.top&&box.top<view.bottom-52;`, type), 2000,
            `Returning to ${type} must reveal its leading edge, not just select its hidden SVG`).catch(async error => {
                const geometry = await driver.executeScript(`const ws=window.__keyboardTestWorkspace;
                    const block=ws.getAllBlocks(false).find(b=>b.type===arguments[0]);
                    const path=block.svgPath_,box=path.getBoundingClientRect(),local=path.getBBox();
                    const xy=block.getRelativeToSurfaceXY(),matrix=ws.getCanvas().getScreenCTM();
                    return {type:arguments[0],box:{x:box.x,y:box.y,width:box.width,height:box.height},
                        local:{x:local.x,y:local.y,width:local.width,height:local.height},xy,
                        matrix:{a:matrix.a,d:matrix.d,e:matrix.e,f:matrix.f},metrics:ws.getMetrics(),
                        scrollX:ws.scrollX,scrollY:ws.scrollY};`, type);
                throw Error(`${error.message}\nReturn geometry: ${JSON.stringify(geometry)}`);
            });
        }
        expect(await nativeState()).toEqual(before);
        await screenshot(`nested-column-round-trip-${scale}`);
        await noGhost();
    },90000);

    test('Escape requires two distinct structural presses and cancellation does not arm exit', async () => {
        await acceptBlock('move 10 steps', 1);
        const toggle = await driver.findElement(By.xpath('//button[text()="Keyboard"]'));
        const on = async () => expect(await toggle.getAttribute('aria-pressed')).toBe('true');
        await driver.actions().keyDown(Key.ESCAPE).keyDown(Key.ESCAPE).keyDown(Key.ESCAPE)
            .keyUp(Key.ESCAPE).perform();
        await painted(); await on();
        await keys(Key.ARROW_RIGHT, Key.ESCAPE); await on();
        await keys(Key.ESCAPE);
        expect(await toggle.getAttribute('aria-pressed')).toBe('false');
        await enableKeyboard();
        await keys(Key.HOME, Key.ENTER); await keys(...'say unfinished');
        await keys(Key.ESCAPE); await on();
        await keys(Key.ESCAPE); await on();
        await keys(Key.ESCAPE);
        expect(await toggle.getAttribute('aria-pressed')).toBe('false');
        await enableKeyboard(); await keys(Key.HOME, Key.ARROW_RIGHT, Key.F2);
        await driver.wait(until.elementLocated(By.css('.blocklyHtmlInput')), 10000);
        await keys(Key.ESCAPE); await on();
        await keys(Key.ESCAPE); await on();
        await keys(Key.ESCAPE);
        expect(await toggle.getAttribute('aria-pressed')).toBe('false');
        expect((await state()).count).toBe(1);
    }, 90000);

    test('Script breadcrumb follows native editing, keyboard branches and offscreen heads without stealing focus', async () => {
        const breadcrumb = await driver.wait(until.elementLocated(By.css('[data-script-breadcrumb]')), 15000);
        await typeBlock('when flag clicked', 1);
        await typeBlock('if else', 2);
        await typeBlock('say hello', 3);
        const ids = await driver.executeScript(`const ws=window.__keyboardTestWorkspace;
            return Object.fromEntries(ws.getAllBlocks(false).filter(b=>!b.isShadow()).map(b=>[b.type,b.id]));`);
        await caretAt('block', 'looks_say');
        await driver.wait(async () => (await breadcrumb.getText()).includes('then'), 10000);
        await expectCaret('block', 'looks_say');
        await screenshot('breadcrumb-nested-branch');
        await chord(Key.ALT, 'k'); // Mouse-only mode still follows the selected script.
        expect(await breadcrumb.getAttribute('data-root-id')).toBe(ids.event_whenflagclicked);
        const focus = await driver.executeScript('return document.activeElement?.tagName;');
        await driver.executeScript(`const ws=window.__keyboardTestWorkspace,m=ws.getMetrics();
            const xy=ws.getBlockById(arguments[0]).getRelativeToSurfaceXY();
            ws.scrollbar.set(m.viewLeft-m.contentLeft, (xy.y+35)*ws.scale-m.contentTop);`, ids.event_whenflagclicked);
        await driver.wait(() => driver.executeScript(`return !document.querySelector('[data-script-head-pin]').hidden;`), 10000);
        expect(await driver.executeScript('return document.activeElement?.tagName;')).toBe(focus);
        const revision = await breadcrumb.getAttribute('data-context-revision');
        await driver.executeScript(`const ws=window.__keyboardTestWorkspace,m=ws.getMetrics();
            ws.scrollbar.set(m.viewLeft-m.contentLeft+5,m.viewTop-m.contentTop+2);`);
        await painted();
        expect(await breadcrumb.getAttribute('data-context-revision')).toBe(revision);
        await screenshot('breadcrumb-pinned-head-mouse-mode');
        await enableKeyboard(); await chord(Key.ALT, 's');
        await driver.wait(() => driver.executeScript(`return document.querySelector('[data-script-head-pin]').hidden;`), 10000);
        await expectCaret('block', 'looks_say');
        expect((await state()).count).toBe(3);
    }, 90000);

    test.each([1, 1.7])('Clean-up+ shortcut retains the focused script on screen at scale %s and native Undo', async scale => {
        await driver.executeScript(`const SB=window.ScratchBlocks,ws=window.__keyboardTestWorkspace;
            SB.Xml.domToWorkspace(SB.Xml.textToDom('<xml><block type="event_whenflagclicked" id="tidy-head" x="250" y="200">'+
            '<next><block type="motion_movesteps" id="tidy-focus"/></next></block>'+
            '<block type="event_whenkeypressed" id="tidy-other" x="520" y="450"/>'+
            '<block type="operator_add" id="tidy-reporter" x="650" y="200"/></xml>'),ws);
            ws.setScale(arguments[0]);`, scale);
        await caretAt('block', 'motion_movesteps');
        await driver.wait(() => driver.executeScript('return !!window.__keyboardTestWorkspace.cleanUpPlusLayout;'), 10000);
        const snapshot = () => driver.executeScript(`const ws=window.__keyboardTestWorkspace,
            m=ws.getBlockById('tidy-head').getSvgRoot().getScreenCTM();
            return {x:m.e,y:m.f,positions:ws.getTopBlocks(false).map(b=>({id:b.id,...b.getRelativeToSurfaceXY()})),
                topology:ws.getAllBlocks(false).map(b=>({id:b.id,parent:b.getParent()?.id,next:b.getNextBlock()?.id}))
                    .sort((a,b)=>a.id.localeCompare(b.id))};`);
        const before = await snapshot();
        await driver.executeScript(`window.__cleanupFrames=[]; window.__sampleCleanup=true;
            const sample=()=>{if(!window.__sampleCleanup)return;
                const m=window.__keyboardTestWorkspace.getBlockById('tidy-head').getSvgRoot().getScreenCTM();
                window.__cleanupFrames.push({x:m.e,y:m.f});requestAnimationFrame(sample);};
            requestAnimationFrame(sample);`);
        await driver.actions().keyDown(Key.ALT).keyDown(Key.SHIFT).sendKeys('c')
            .keyUp(Key.SHIFT).keyUp(Key.ALT).perform();
        await painted();
        const after = await snapshot();
        expect(after.positions).not.toEqual(before.positions);
        expect(after.topology).toEqual(before.topology);
        expect(Math.abs(after.x-before.x)).toBeLessThan(1);
        expect(Math.abs(after.y-before.y)).toBeLessThan(1);
        await expectCaret('block', 'motion_movesteps');
        // Allow subsequent native events/paint frames to settle, checking that
        // a resize doesn't silently undo the viewport compensation afterwards.
        await painted(); await painted();
        const settled = await snapshot();
        expect(Math.abs(settled.x-before.x)).toBeLessThan(1);
        expect(Math.abs(settled.y-before.y)).toBeLessThan(1);
        await chord(Key.CONTROL, 'z');
        const undone = await snapshot();
        expect(undone.positions).toEqual(before.positions);
        expect(undone.topology).toEqual(before.topology);
        expect(Math.abs(undone.x-before.x)).toBeLessThan(1);
        expect(Math.abs(undone.y-before.y)).toBeLessThan(1);
        await chord(Key.CONTROL, 'y');
        const redone = await snapshot();
        expect(redone.positions).toEqual(after.positions);
        expect(redone.topology).toEqual(before.topology);
        expect(Math.abs(redone.x-before.x)).toBeLessThan(1);
        expect(Math.abs(redone.y-before.y)).toBeLessThan(1);
        const frames = await driver.executeScript('window.__sampleCleanup=false; return window.__cleanupFrames;');
        expect(frames.length).toBeGreaterThan(2);
        expect(frames.every(frame => Math.abs(frame.x-before.x)<1 && Math.abs(frame.y-before.y)<1)).toBe(true);
        await screenshot(`cleanup-anchored-${scale}`);
    }, 90000);

    test.each([true, false])('Clean-up+ shortcut works without selection from blank Code (keyboard %s)', async keyboard => {
        await driver.executeScript(`const SB=window.ScratchBlocks,ws=window.__keyboardTestWorkspace;
            SB.Xml.domToWorkspace(SB.Xml.textToDom('<xml><block type="event_whenflagclicked" id="empty-clean-a" x="280" y="240"/>'+
            '<block type="event_whenkeypressed" id="empty-clean-b" x="520" y="420"/></xml>'),ws);`);
        if (keyboard) await beginNewScript();
        else {
            await chord(Key.ALT, 'k');
            const point = await driver.executeScript(`const r=window.__keyboardTestWorkspace.getParentSvg().getBoundingClientRect();
                return {x:Math.round(r.right-220),y:Math.round(r.bottom-210)};`);
            await driver.actions().move({origin:'viewport',...point}).click().perform();
        }
        await painted(); await painted();
        expect(await driver.executeScript('return !!window.ScratchBlocks.selected;')).toBe(false);
        const positions = () => driver.executeScript(`return window.__keyboardTestWorkspace.getTopBlocks(false)
            .map(b=>({id:b.id,...b.getRelativeToSurfaceXY()})).sort((a,b)=>a.id.localeCompare(b.id));`);
        const before = await positions();
        await driver.actions().keyDown(Key.ALT).keyDown(Key.SHIFT).sendKeys('c')
            .keyUp(Key.SHIFT).keyUp(Key.ALT).perform();
        await driver.wait(async () => JSON.stringify(await positions()) !== JSON.stringify(before), 10000);
        await painted();
        const after = await positions();
        await chord(Key.CONTROL, 'z');
        expect(await positions()).toEqual(before);
        await chord(Key.CONTROL, 'y');
        expect(await positions()).toEqual(after);
        // Finder owns text keys and must not trigger another layout.
        await chord(Key.CONTROL, 'f');
        await driver.actions().keyDown(Key.ALT).keyDown(Key.SHIFT).sendKeys('c')
            .keyUp(Key.SHIFT).keyUp(Key.ALT).perform();
        expect(await positions()).toEqual(after);
    }, 60000);

    test('Clean-up+ context menu preserves the active script in mouse mode', async () => {
        await driver.executeScript(`const SB=window.ScratchBlocks,ws=window.__keyboardTestWorkspace;
            SB.Xml.domToWorkspace(SB.Xml.textToDom('<xml><block type="event_whenflagclicked" id="menu-head" x="250" y="200"/>'+
            '<block type="event_whenkeypressed" id="menu-other" x="520" y="400"/></xml>'),ws);`);
        await caretAt('block', 'event_whenflagclicked');
        await chord(Key.ALT, 'k');
        const points = await driver.executeScript(`const ws=window.__keyboardTestWorkspace,
            b=ws.getBlockById('menu-head'),r=b.svgPath_.getBoundingClientRect(),area=ws.getParentSvg().getBoundingClientRect();
            return {block:{x:Math.round(r.left+25),y:Math.round(r.top+22)},
                background:{x:Math.round(area.right-170),y:Math.round(area.bottom-200)}};`);
        await driver.actions().move({origin:'viewport',...points.block}).click().perform();
        const snapshot = () => driver.executeScript(`const ws=window.__keyboardTestWorkspace,
            m=ws.getBlockById('menu-head').getSvgRoot().getScreenCTM();
            return {x:m.e,y:m.f,positions:ws.getTopBlocks(false).map(b=>({id:b.id,...b.getRelativeToSurfaceXY()}))};`);
        const before = await snapshot();
        await driver.actions().move({origin:'viewport',...points.background}).press(2).release(2).perform();
        const option = await driver.wait(until.elementLocated(By.xpath('//*[contains(@class,"goog-menuitem") and contains(.,"Clean up")]')), 10000);
        await option.click();
        await driver.wait(async () => JSON.stringify((await snapshot()).positions) !== JSON.stringify(before.positions), 10000);
        await painted(); await painted();
        const after = await snapshot();
        expect(Math.abs(after.x-before.x)).toBeLessThan(1);
        expect(Math.abs(after.y-before.y)).toBeLessThan(1);
        expect(await driver.findElement(By.css('[data-script-breadcrumb]')).getAttribute('data-root-id')).toBe('menu-head');
        // The menu also schedules an unused-variable check. Undo must preserve
        // the viewport after that check, without relying on keyboard ownership.
        await driver.wait(() => driver.executeScript(`return window.__keyboardTestWorkspace.undoStack_.some(e=>e.type==='move');`), 10000);
        await driver.executeAsyncScript('const done=arguments[arguments.length-1]; setTimeout(done,150);');
        await chord(Key.CONTROL, 'z');
        const undone = await snapshot();
        expect(undone.positions).toEqual(before.positions);
        expect(Math.abs(undone.x-before.x)).toBeLessThan(1);
        expect(Math.abs(undone.y-before.y)).toBeLessThan(1);
        await chord(Key.CONTROL, 'y');
        const redone = await snapshot();
        expect(redone.positions).toEqual(after.positions);
        expect(Math.abs(redone.x-before.x)).toBeLessThan(1);
        expect(Math.abs(redone.y-before.y)).toBeLessThan(1);
        await screenshot('cleanup-menu-mouse-anchor');
    }, 90000);

    test.each([true, false])('Script breadcrumb links navigate ancestors and pinned heads (keyboard %s)', async keyboard => {
        await typeBlock('when flag clicked', 1);
        await typeBlock('repeat 10', 2);
        await typeBlock('move 10 steps', 3);
        await caretAt('input', 'motion_movesteps', 'STEPS');
        await strictlyNoPreview();
        const ids = await driver.executeScript(`return Object.fromEntries(window.__keyboardTestWorkspace
            .getAllBlocks(false).filter(b=>!b.isShadow()).map(b=>[b.type,b.id]));`);
        if (!keyboard) await chord(Key.ALT, 'k');
        const before = await scriptView();
        await driver.findElement(By.css(`[data-script-path] button[data-block-id="${ids.control_repeat}"]`)).click();
        await driver.wait(() => driver.executeScript('return window.ScratchBlocks.selected?.id===arguments[0];',
            ids.control_repeat), 10000);
        if (keyboard) {
            await expectVisibleCaret('block', 'control_repeat');
            expect(await driver.executeScript('return document.activeElement?.getAttribute("aria-label");'))
                .toBe('Scratch keyboard editor');
            await chord(Key.CONTROL, Key.ARROW_LEFT); await awaitView(before.view);
            await expectVisibleCaret('input', 'motion_movesteps', 'STEPS');
        }
        await driver.executeScript(`const ws=window.__keyboardTestWorkspace,m=ws.getMetrics();
            const head=ws.getBlockById(arguments[0]).getRelativeToSurfaceXY();
            ws.scrollbar.set(m.viewLeft-m.contentLeft,(head.y+30)*ws.scale-m.contentTop);`, ids.event_whenflagclicked);
        await driver.wait(() => driver.executeScript('return !document.querySelector("[data-script-head-pin]").hidden;'), 10000);
        await driver.findElement(By.css(`[data-script-head-pin] button[data-block-id="${ids.event_whenflagclicked}"]`)).click();
        await driver.wait(() => driver.executeScript(`const ws=window.__keyboardTestWorkspace,
            root=ws.getBlockById(arguments[0]),r=root.svgPath_.getBoundingClientRect(),
            bar=document.querySelector('.sa-script-breadcrumb-bar').getBoundingClientRect();
            return window.ScratchBlocks.selected===root && r.top>=bar.bottom+20;`, ids.event_whenflagclicked), 10000);
        if (keyboard) await expectVisibleCaret('block', 'event_whenflagclicked');
        else expect(await driver.findElement(By.xpath('//button[text()="Keyboard"]')).getAttribute('aria-pressed')).toBe('false');
        const after = await scriptView();
        expect(after.xml).toBe(before.xml);
        expect([after.undo, after.redo]).toEqual([before.undo, before.redo]);
        await screenshot(`breadcrumb-click-pinned-${keyboard}`);
    }, 90000);

    test('Finder dropdown paints above the caret and closing it preserves structural selection', async () => {
        await typeBlock('when flag clicked', 1); await typeBlock('move 10 steps', 2);
        await keys(Key.HOME); await chord(Key.ALT, 's'); await driver.sleep(350);
        const before = await scriptView();
        const finder = await driver.findElement(By.css('.sa-find-input'));
        await driver.findElement(By.css('[data-studio-target="tab-code"]')).click();
        await driver.sleep(300); // Native input border transition must finish before comparing states.
        await finder.click();
        await driver.wait(until.elementLocated(By.css('.sa-find-dropdown-out.visible')), 10000);
        const layering = await driver.executeScript(`const caret=document.querySelector('[data-position]'),
            dropdown=document.querySelector('.sa-find-dropdown-out.visible'),a=caret.getBoundingClientRect(),
            b=dropdown.getBoundingClientRect();
            const left=Math.max(a.left,b.left),right=Math.min(a.right,b.right),
                top=Math.max(a.top,b.top),bottom=Math.min(a.bottom,b.bottom);
            // Make the click-through overlay temporarily hit-testable without
            // changing paint order. This catches ancestor stacking contexts,
            // not merely the two elements' own z-index numbers.
            const previous=caret.style.pointerEvents;caret.style.pointerEvents='auto';
            const nodes=document.elementsFromPoint((left+right)/2,(top+bottom)/2);
            caret.style.pointerEvents=previous;
            return {overlap:right>left&&bottom>top,caret:nodes.findIndex(n=>caret.contains(n)),
                finder:nodes.findIndex(n=>dropdown.contains(n)),hidden:caret.hidden};`);
        expect(layering.overlap).toBe(true);
        expect(layering.caret).toBeGreaterThan(layering.finder);
        expect(layering.finder).toBeGreaterThanOrEqual(0);
        expect(layering.hidden).toBe(false);
        await screenshot('finder-caret-proper-occlusion');
        await keys(Key.ESCAPE);
        await driver.wait(() => driver.executeScript('return !document.querySelector(".sa-find-dropdown-out.visible");'), 10000);
        await expectCaret('block', 'event_whenflagclicked');
        const after = await scriptView();
        expect(after.xml).toBe(before.xml);
        expect(after.position).toBe(before.position);
        expect(after.undo).toBe(before.undo);
    }, 90000);

    test('Script breadcrumb remembers mouse selections across Stage, Code and native history', async () => {
        await typeBlock('when flag clicked', 1); await typeBlock('say one', 2);
        const first = await driver.executeScript(`return window.__keyboardTestWorkspace.getTopBlocks(false)[0].id;`);
        await beginNewScript(); await typeBlock('when space key pressed', 3); await typeBlock('say two', 4);
        const sourceName = await driver.executeScript('return window.vm.editingTarget.getName();');
        const crumb = () => driver.findElement(By.css('[data-script-breadcrumb]'));
        await chord(Key.ALT, 'k');
        const point = await driver.executeScript(`const r=window.__keyboardTestWorkspace.getBlockById(arguments[0])
            .svgPath_.getBoundingClientRect();return {x:Math.round(r.left+20),y:Math.round(r.top+20)};`, first);
        await driver.actions().move({origin:'viewport', ...point}).click().perform();
        await driver.wait(async () => (await (await crumb()).getAttribute('data-root-id')) === first, 10000);
        const before = (await state()).roots;
        await driver.findElement(By.css('[data-studio-target="stage-selector"]')).click();
        await driver.wait(async () => (await (await crumb()).getText()).includes('Stage'), 10000);
        expect(await (await crumb()).getAttribute('data-root-id')).toBe('');
        await driver.findElement(By.css(`[data-studio-sprite-name="${sourceName}"]`)).click();
        await driver.wait(async () => (await (await crumb()).getAttribute('data-root-id')) === first, 10000);
        expect(await driver.findElement(By.xpath('//button[text()="Keyboard"]')).getAttribute('aria-pressed')).toBe('false');
        await driver.findElement(By.css('[data-studio-target="tab-costumes"]')).click();
        await driver.wait(async () => !(await (await crumb()).isDisplayed()), 10000);
        await driver.findElement(By.css('[data-studio-target="tab-code"]')).click();
        await driver.wait(async () => (await (await crumb()).isDisplayed()), 10000);
        expect((await state()).roots).toEqual(before);
        await enableKeyboard(); await caretAt('block', 'event_whenkeypressed');
        await keys(Key.DELETE);
        await chord(Key.CONTROL, 'z');
        await count(4);
        expect(await (await crumb()).isDisplayed()).toBe(true);
    }, 90000);

    test('Script breadcrumb works with the keyboard feature absent during native palette drag and Undo Redo', async () => {
        const url = new URL(process.env.STUDIO_BROWSER_URL);
        url.searchParams.set('keyboard-authoring', '0');
        await helper.loadUri(url.toString());
        await driver.wait(() => driver.executeScript('return !!window.vm?.editingTarget;'), 30000);
        await driver.executeScript('window.__keyboardTestWorkspace=window.ScratchBlocks.getMainWorkspace();');
        expect(await driver.findElements(By.css('[data-keyboard-authoring]'))).toHaveLength(0);
        await driver.wait(until.elementLocated(By.css('[data-script-breadcrumb]')), 15000);
        await helper.clickBlocksCategory('Motion');
        const points = await driver.executeScript(`const ws=window.__keyboardTestWorkspace,
            flyout=ws.getFlyout().getWorkspace(),b=flyout.getAllBlocks(false).find(b=>b.type==='motion_movesteps'),
            r=b.svgPath_.getBoundingClientRect(),area=ws.getParentSvg().getBoundingClientRect(),m=ws.getMetrics();
            return {from:{x:Math.round(r.left+14),y:Math.round(r.top+16)},
                to:{x:Math.round(area.left+m.absoluteLeft+m.flyoutWidth+100),y:Math.round(area.top+120)}};`);
        await driver.actions().move({origin:'viewport', ...points.from}).press()
            .move({origin:'viewport',x:points.from.x+12,y:points.from.y+5,duration:120})
            .move({origin:'viewport', ...points.to,duration:300}).release().perform();
        await count(1);
        const crumb = await driver.findElement(By.css('[data-script-breadcrumb]'));
        await driver.wait(async () => (await crumb.getText()).includes('move 10 steps'), 10000);
        const original = (await state()).roots;
        await chord(Key.CONTROL, 'z'); await count(0);
        await driver.wait(async () => (await crumb.getAttribute('data-root-id')) === '', 10000);
        await chord(Key.CONTROL, 'y'); await count(1);
        await driver.wait(async () => (await crumb.getText()).includes('move 10 steps'), 10000);
        expect((await state()).roots).toEqual(original);
        await screenshot('breadcrumb-native-no-keyboard');
    }, 90000);

    test('Script breadcrumb follows mouse field editing between branches but ignores unrelated layout', async () => {
        await chord(Key.ALT, 'k');
        await driver.executeScript(`const SB=window.ScratchBlocks,ws=window.__keyboardTestWorkspace;
            SB.Xml.domToWorkspace(SB.Xml.textToDom('<xml><block type="control_if_else" id="crumb-if" x="100" y="80">'+
            '<statement name="SUBSTACK"><block type="looks_say" id="crumb-then"><value name="MESSAGE">'+
            '<shadow type="text"><field name="TEXT">one</field></shadow></value></block></statement>'+
            '<statement name="SUBSTACK2"><block type="looks_say" id="crumb-else"><value name="MESSAGE">'+
            '<shadow type="text"><field name="TEXT">two</field></shadow></value></block></statement></block>'+
            '<block type="motion_movesteps" id="crumb-other" x="430" y="80"/></xml>'),ws);`);
        const crumb = await driver.findElement(By.css('[data-script-breadcrumb]'));
        const edit = async (id, value, branch) => {
            const point = await driver.executeScript(`const b=window.__keyboardTestWorkspace.getBlockById(arguments[0]);
                const r=b.getInputTargetBlock('MESSAGE').getField('TEXT').getSvgRoot().getBoundingClientRect();
                return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};`, id);
            await driver.actions().move({origin:'viewport',...point}).click().perform();
            const input = await driver.wait(until.elementLocated(By.css('.blocklyHtmlInput')), 10000);
            await input.sendKeys(Key.chord(Key.CONTROL, 'a'), value, Key.ENTER);
            await driver.wait(async () => (await crumb.getText()).includes(branch), 10000);
        };
        await edit('crumb-then', 'edited one', 'then');
        await edit('crumb-else', 'edited two', 'else');
        // Simulate the cleanup addon's ordinary native movement, not a user drag.
        await driver.executeScript(`window.__keyboardTestWorkspace.getBlockById('crumb-other').moveBy(25,30);`);
        await painted();
        expect(await crumb.getAttribute('data-root-id')).toBe('crumb-if');
        expect(await crumb.getText()).toContain('else');
        await edit('crumb-then', 'edited again', 'then');
        expect(await driver.findElement(By.xpath('//button[text()="Keyboard"]')).getAttribute('aria-pressed')).toBe('false');
        await screenshot('breadcrumb-mouse-branch-edit');
    }, 90000);

    test.each(['light', 'dark'])('Script breadcrumb uses the %s theme and fits a narrow workspace', async theme => {
        const settings = await driver.findElement(By.xpath('//span[text()="Settings"]'));
        await settings.click();
        const switcher = await driver.findElements(By.xpath(`//span[text()="Switch To ${theme === 'dark' ? 'Dark' : 'Light'} Mode"]`));
        if (switcher.length) await switcher[0].click(); else await settings.click();
        await painted();
        await driver.executeScript('window.__keyboardTestWorkspace=window.ScratchBlocks.getMainWorkspace();');
        await driver.manage().window().setRect({width: 1100, height: 800});
        await beginNewScript(); await typeBlock('when flag clicked', 1);
        await typeBlock('repeat 100', 2); await typeBlock('say a long message in this script', 3);
        await caretAt('block', 'looks_say');
        await driver.wait(until.elementLocated(By.css('[data-script-breadcrumb][data-root-id]:not([hidden])')), 10000);
        const style = await driver.executeScript(`const root=document.querySelector('[data-script-breadcrumb]'),
            bar=root.firstElementChild,svg=window.__keyboardTestWorkspace.getParentSvg().getBoundingClientRect();
            const r=bar.getBoundingClientRect();return {bg:getComputedStyle(bar).backgroundColor,
                text:getComputedStyle(bar).color,left:r.left,right:r.right,workspaceRight:svg.right,
                count:document.querySelectorAll('[data-script-breadcrumb]').length};`);
        const colors = style.bg.match(/[\d.]+/g).slice(0,3).map(Number);
        expect(colors.every(value => theme === 'dark' ? value < 120 : value > 180)).toBe(true);
        expect(style.bg).not.toBe(style.text);
        expect(style.right).toBeLessThanOrEqual(style.workspaceRight);
        expect(style.count).toBe(1);
        await screenshot(`breadcrumb-narrow-${theme}`);
    }, 90000);

    test('horizontal column exits require two distinct presses but free carets travel immediately', async () => {
        await acceptBlock('move 10 steps',1);
        await keys(Key.HOME,Key.ARROW_RIGHT);
        await expectCaret('input','motion_movesteps','STEPS');
        const before=await driver.executeScript(`const ws=window.__keyboardTestWorkspace;
            return {xml:window.ScratchBlocks.Xml.domToText(window.ScratchBlocks.Xml.workspaceToDom(ws)),
                undo:ws.undoStack_.length,redo:ws.redoStack_.length};`);
        // Native WebDriver repeated keydowns carry KeyboardEvent.repeat; no
        // synthetic DOM events or controller calls stand in for this journey.
        await driver.actions().keyDown(Key.ARROW_RIGHT).keyDown(Key.ARROW_RIGHT)
            .keyDown(Key.ARROW_RIGHT).keyUp(Key.ARROW_RIGHT).perform();
        await painted();
        await expectCaret('input','motion_movesteps','STEPS');
        expect(await driver.executeScript(`return !document.querySelector('[data-column-cue]').hidden;`)).toBe(true);
        expect(await driver.executeScript(`const ws=window.__keyboardTestWorkspace;
            const row=ws.getAllBlocks(false).find(b=>b.type==='motion_movesteps').svgPath_.getBoundingClientRect();
            return document.querySelector('[data-column-cue]').getBoundingClientRect().left-row.right;`))
            .toBeGreaterThanOrEqual(5);
        await screenshot('horizontal-column-exit-cue');
        await keys(Key.ARROW_RIGHT);
        expect((await state()).caret.startsWith('workspace:')).toBe(true);
        const workspaceCaret=()=>driver.executeScript(`const box=document.querySelector('[data-position]').getBoundingClientRect(),
            m=window.__keyboardTestWorkspace.getCanvas().getScreenCTM();
            return {x:(box.left-m.e)/m.a,y:(box.top-m.f)/m.d};`);
        const first=await workspaceCaret();
        await keys(Key.ARROW_RIGHT);
        const second=await workspaceCaret();
        expect(second.x-first.x).toBeGreaterThanOrEqual(239);
        await screenshot('horizontal-free-column-caret');
        await keys(Key.ARROW_DOWN);
        expect((await workspaceCaret()).y-second.y).toBeCloseTo(96,0);
        await keys(Key.ARROW_UP,Key.ARROW_LEFT);
        expect((await workspaceCaret()).x).toBeCloseTo(first.x,0);
        await keys(Key.ARROW_LEFT); await expectCaret('block','motion_movesteps');
        const after=await driver.executeScript(`const ws=window.__keyboardTestWorkspace;
            return {xml:window.ScratchBlocks.Xml.domToText(window.ScratchBlocks.Xml.workspaceToDom(ws)),
                undo:ws.undoStack_.length,redo:ws.redoStack_.length};`);
        expect(after).toEqual(before);
        await noGhost();
    },90000);

    test.each([[0.675, 'when flag clicked', 'hat'], [1.5, 'when flag clicked', 'hat'],
        [1, 'when this sprite clicked', 'hat'], [1.5, 'when flag clicked', 'tall input']])(
        'horizontal column hat placement aligns the native text row (zoom %s, %s, %s)', async (scale, query, shape) => {
            if (shape === 'tall input') {
                await keys(Key.ESCAPE);
                await driver.executeScript(`const SB=window.ScratchBlocks;
                    const sum=inside=>'<block type="operator_add"><value name="NUM1">'+inside+'</value>'+
                        '<value name="NUM2"><shadow type="math_number"><field name="NUM">2</field></shadow></value></block>';
                    const expression=sum(sum(sum('<shadow type="math_number"><field name="NUM">1</field></shadow>')));
                    SB.Xml.domToWorkspace(SB.Xml.textToDom('<xml><block type="event_whengreaterthan" x="100" y="80">'+
                        '<value name="VALUE">'+expression+'</value><next><block type="motion_movesteps"/></next></block></xml>'),
                        window.__keyboardTestWorkspace);`);
                await count(5); await caretAt('block', 'event_whengreaterthan');
            } else {
                await typeBlock('when flag clicked', 1);
                await typeBlock('move 10 steps', 2);
            }
            const total = shape === 'tall input' ? 5 : 2;
            const sourceType = shape === 'tall input' ? 'event_whengreaterthan' : 'event_whenflagclicked';
            await driver.executeScript(`const ws=window.__keyboardTestWorkspace;ws.setScale(arguments[0]);ws.resize();`, scale);
            await keys(Key.HOME); await strictlyNoPreview();
            const sourceId = await driver.executeScript(`return window.__keyboardTestWorkspace.getTopBlocks(false)[0].id;`);
            const measure = () => driver.executeScript(`const ws=window.__keyboardTestWorkspace;
                const source=ws.getBlockById(arguments[0]),m=ws.getCanvas().getScreenCTM();
                const row=block=>{
                    const text=block.getSvgRoot().querySelector('text').getBoundingClientRect();
                    return {y:block.getRelativeToSurfaceXY().y,textY:(text.top-m.f)/m.d};
                };
                const scene=Object.values(window.ScratchBlocks.Workspace.WorkspaceDB_)
                    .find(c=>c.options.readOnly&&!c.isFlyout&&c.options.parentWorkspace===ws);
                const draft=scene?.getTopBlocks(false).find(b=>b.type.startsWith('event_'));
                const placed=ws.getTopBlocks(false).find(b=>b.id!==source.id);
                return {source:row(source),caretY:(document.querySelector('[data-position]').getBoundingClientRect().top-m.f)/m.d,
                    draft:draft&&row(draft),placed:placed&&row(placed),
                    xml:window.ScratchBlocks.Xml.domToText(window.ScratchBlocks.Xml.workspaceToDom(ws))};`, sourceId);
            const before = await measure();
            const leaveRight = async () => {
                for (let i = 0; i < 30 && !(await state()).caret.startsWith('workspace:'); i++) {
                    await keys(Key.ARROW_RIGHT);
                }
            };
            await leaveRight();
            expect((await state()).caret.startsWith('workspace:')).toBe(true);
            if (shape === 'hat') expect((await measure()).caretY).toBeCloseTo(before.source.y, 1);
            // Crossing further empty columns and back must retain both the
            // placement origin and the full visual band used to find this hat.
            await keys(Key.ARROW_RIGHT, Key.ARROW_LEFT, Key.ARROW_LEFT);
            await expectCaret('block', sourceType);
            await leaveRight(); await keys(Key.ENTER);
            await keys(...query);
            await driver.wait(async () => Boolean((await measure()).draft), 5000);
            const proposed = await measure();
            if (shape === 'hat') expect(proposed.draft.y).toBeCloseTo(before.source.y, 1);
            else expect(proposed.draft.y).toBeGreaterThan(before.source.y + 4);
            expect(proposed.draft.textY).toBeCloseTo(proposed.source.textY, 1);
            await keys(Key.ESCAPE);
            expect((await measure()).xml).toBe(before.xml);
            await keys(Key.ENTER); await acceptBlock(query, total + 1);
            await keys(Key.HOME); await strictlyNoPreview();
            const accepted = await measure();
            expect(accepted.placed.y).toBeCloseTo(proposed.draft.y, 1);
            expect(accepted.placed.textY).toBeCloseTo(accepted.source.textY, 1);
            await screenshot(`hat-column-alignment-${scale}-${shape}`);
            await nativeHistory(false); await count(total);
            expect((await measure()).xml).toBe(before.xml);
            await nativeHistory(true); await count(total + 1);
            expect((await measure()).xml).toBe(accepted.xml);
            await noGhost();
        }, 90000);

    test.each([[0.675, 260], [1.5, 284]])('free caret vertical guides align adjacent script heads at zoom %s (lower head %s)', async (scale, lowerY) => {
        await keys(Key.ESCAPE);
        await driver.executeScript(`const SB=window.ScratchBlocks,ws=window.__keyboardTestWorkspace;
            SB.Xml.domToWorkspace(SB.Xml.textToDom('<xml><block type="event_whenflagclicked" x="100" y="80">'+
                '<next><block type="motion_movesteps"/></next></block>'+
                '<block type="event_whenkeypressed" x="100" y="'+arguments[1]+'"/></xml>'),ws);
            ws.setScale(arguments[0]);ws.resize();`, scale, lowerY);
        await count(3); await caretAt('block', 'event_whenflagclicked');
        const xml = () => driver.executeScript(`return window.ScratchBlocks.Xml.domToText(
            window.ScratchBlocks.Xml.workspaceToDom(window.__keyboardTestWorkspace));`);
        const before = await xml();
        const y = () => driver.executeScript(`const box=document.querySelector('[data-position]').getBoundingClientRect(),
            m=window.__keyboardTestWorkspace.getCanvas().getScreenCTM();return (box.top-m.f)/m.d;`);
        await keys(Key.ARROW_RIGHT, Key.ARROW_RIGHT);
        expect(await y()).toBeCloseTo(80, 1);
        await keys(Key.ARROW_DOWN); expect(await y()).toBeCloseTo(176, 1);
        // At 284 the ordinary step lands 12 units short, so finish at the guide.
        await keys(Key.ARROW_DOWN); expect(await y()).toBeCloseTo(lowerY, 1);
        await keys(Key.ARROW_UP); expect(await y()).toBeCloseTo(lowerY - 96, 1);
        // The move row at 128 is not another guide. Align with the script head.
        await keys(Key.ARROW_UP); expect(await y()).toBeCloseTo(80, 1);
        await keys(Key.ARROW_UP); expect(await y()).toBeCloseTo(-16, 1);
        await keys(Key.ARROW_DOWN); expect(await y()).toBeCloseTo(80, 1);
        expect(await xml()).toBe(before);
        await keys(Key.ENTER); await acceptBlock('when flag clicked', 4);
        await keys(Key.HOME); await strictlyNoPreview();
        expect(await driver.executeScript(`return window.__keyboardTestWorkspace.getTopBlocks(false)
            .filter(b=>b.type==='event_whenflagclicked').map(b=>b.getRelativeToSurfaceXY().y);`)).toEqual([80,80]);
        await nativeHistory(false); await count(3); expect(await xml()).toBe(before);
        await nativeHistory(true); await count(4); await noGhost();
    }, 90000);

    test('horizontal column exits place their cue beyond the complete native command row', async () => {
        await typeBlock('move (1 + 2) steps',2);
        await typeBlock('say a much wider command below this row',3);
        await caretAt('input','operator_add','NUM2');
        await keys(Key.ARROW_RIGHT);
        await expectCaret('input','operator_add','NUM2');
        const gap = () => driver.executeScript(`const ws=window.__keyboardTestWorkspace;
            const row=ws.getAllBlocks(false).find(b=>b.type==='motion_movesteps').svgPath_.getBoundingClientRect();
            const cue=document.querySelector('[data-column-cue]');
            return cue.hidden ? null : cue.getBoundingClientRect().left-row.right;`);
        expect(await gap()).toBeCloseTo(6,0);
        await screenshot('column-cue-after-complete-row');
        // Panning/zooming presentation must not re-anchor the cue to just the
        // selected number, or to the wider continuation on the row below.
        await driver.executeScript('window.__keyboardTestWorkspace.setScale(1.5);');
        await painted();
        expect(await gap()).toBeCloseTo(6,0);
        await keys(Key.ARROW_RIGHT);
        expect((await state()).caret.startsWith('workspace:')).toBe(true);
    },90000);

    test('free caret vertical movement meets a native stack head and accepts a hat reversibly', async () => {
        await acceptBlock('move 10 steps',1);
        await keys(Key.HOME,Key.ARROW_LEFT,Key.ARROW_LEFT);
        expect((await state()).caret.startsWith('workspace:')).toBe(true);
        // Position only the fixture, using native workspace coordinates. All
        // navigation and authoring after this setup uses real keyboard input.
        await driver.executeScript(`const ws=window.__keyboardTestWorkspace,
            box=document.querySelector('[data-position]').getBoundingClientRect(),m=ws.getCanvas().getScreenCTM(),
            block=ws.getTopBlocks(false)[0],xy=block.getRelativeToSurfaceXY();
            block.moveBy((box.left-m.e)/m.a-xy.x,(box.top-m.f)/m.d+108-xy.y);`);
        await painted();
        await keys(Key.ARROW_DOWN); await expectCaret('before','motion_movesteps');
        const before=(await state()).roots;
        await acceptBlock('when flag clicked',2);
        expect((await state()).roots[0].type).toBe('event_whenflagclicked');
        expect((await state()).roots[0].next.type).toBe('motion_movesteps');
        await nativeHistory(false); await painted();
        expect((await state()).roots).toEqual(before);
        await nativeHistory(true); await painted();
        expect((await state()).roots[0].next.type).toBe('motion_movesteps');
        await noGhost();
    },90000);

    test('Home and End modifiers distinguish a branch range from its outer script', async () => {
        await typeBlock('if then else',1);
        await typeBlock('move 10 steps',2);
        await typeBlock('say middle',3);
        await typeBlock('wait 1 seconds',4);
        await caretAt('gap','control_if_else');
        await typeBlock('change y by 2',5);
        const before=(await state()).roots;
        await caretAt('block','looks_say','',true);
        await chord(Key.SHIFT,Key.HOME);
        const expectRange=async types=>expect(await driver.executeScript(`const ws=window.__keyboardTestWorkspace;
            const ids=arguments[0].map(type=>ws.getAllBlocks(false).find(block=>block.type===type).id);
            return document.querySelector('[data-position]').dataset.position==='range:'+ids.join(',');`,types)).toBe(true);
        await expectRange(['motion_movesteps','looks_say']);
        await chord(Key.SHIFT,Key.END);
        await expectRange(['looks_say','control_wait']);
        await chord(Key.CONTROL,Key.HOME); await expectCaret('block','control_if_else');
        await chord(Key.CONTROL,Key.END); await expectCaret('gap','motion_changeyby');
        expect((await state()).roots).toEqual(before);
        await noGhost();
    },90000);

    test('horizontal arrows leave empty C mouths to vertical navigation and never select their owner', async () => {
        await acceptBlock('if then else',1);
        await expectCaret('input','control_if_else','CONDITION');
        const before=(await state()).roots;
        await keys(Key.ARROW_RIGHT); await expectCaret('input','control_if_else','CONDITION');
        await keys(Key.ARROW_DOWN); await expectCaret('gap','control_if_else','SUBSTACK');
        await keys(Key.ARROW_RIGHT); await expectCaret('gap','control_if_else','SUBSTACK');
        await keys(Key.ARROW_DOWN); await expectCaret('gap','control_if_else','SUBSTACK2');
        await keys(Key.ARROW_RIGHT); await expectCaret('gap','control_if_else','SUBSTACK2');
        await keys(Key.ARROW_LEFT); await expectCaret('gap','control_if_else','SUBSTACK2');
        await keys(Key.ARROW_UP); await expectCaret('gap','control_if_else','SUBSTACK');
        await keys(Key.ARROW_UP); await expectCaret('block','control_if_else');
        await keys(Key.END,Key.ARROW_LEFT,Key.ARROW_RIGHT); await expectCaret('gap','control_if_else');
        expect((await state()).roots).toEqual(before);
        await noGhost();
    },90000);

    test('vertical arrows follow nested then and else bodies in visual order in both directions', async () => {
        await typeBlock('if then else',1);
        await typeBlock('repeat 10',2);
        await typeBlock('move 10 steps',3);
        await caretAt('gap','control_if_else','SUBSTACK2');
        await typeBlock('say otherwise',4);
        await caretAt('gap','control_if_else');
        await typeBlock('wait 1 seconds',5);
        const before=(await state()).roots;
        await caretAt('block','control_if_else','',true);
        const route=[['block','control_if_else'],['block','control_repeat'],
            ['block','motion_movesteps'],['gap','motion_movesteps'],['gap','control_repeat'],
            ['block','looks_say'],['gap','looks_say'],['block','control_wait'],['gap','control_wait']];
        for (const [kind,type,name] of route.slice(1)) {
            await keys(Key.ARROW_DOWN); await expectCaret(kind,type,name);
        }
        for (const [kind,type,name] of route.slice(0,-1).reverse()) {
            await keys(Key.ARROW_UP); await expectCaret(kind,type,name);
        }
        await keys(Key.ARROW_RIGHT,Key.ARROW_RIGHT); await expectCaret('input','control_if_else','CONDITION');
        await keys(Key.ARROW_DOWN); await expectCaret('block','control_repeat');
        await keys(Key.ARROW_RIGHT,Key.ARROW_RIGHT); await expectCaret('input','control_repeat','TIMES');
        await keys(Key.ARROW_DOWN); await expectCaret('block','motion_movesteps');
        await keys(Key.ARROW_LEFT); await expectCaret('block','motion_movesteps');
        await keys(Key.ARROW_UP); await expectCaret('block','control_repeat');
        await keys(Key.ARROW_UP); await expectCaret('block','control_if_else');
        expect((await state()).roots).toEqual(before);
        await screenshot('nested-directional-navigation');
        await noGhost();
    },90000);

    test('Left leaves a nested reporter through its owner while Right follows operands', async () => {
        await acceptBlock('move 2 + 3 * 4 steps',3);
        await expectCaret('block','operator_add');
        const before=(await state()).roots;
        await keys(Key.ARROW_RIGHT); await expectCaret('input','operator_add','NUM1');
        await keys(Key.ARROW_RIGHT); await expectCaret('block','operator_multiply');
        await keys(Key.ARROW_LEFT); await expectCaret('block','operator_add');
        await keys(Key.ARROW_RIGHT,Key.ARROW_RIGHT,Key.ARROW_RIGHT);
        await expectCaret('input','operator_multiply','NUM1');
        await keys(Key.ARROW_RIGHT,Key.ARROW_RIGHT); await expectCaret('input','operator_multiply','NUM2');
        await keys(Key.ARROW_LEFT,Key.ARROW_LEFT); await expectCaret('block','operator_multiply');
        await keys(Key.ARROW_LEFT); await expectCaret('block','operator_add');
        await keys(Key.ARROW_LEFT); await expectCaret('block','motion_movesteps');
        expect((await state()).roots).toEqual(before);
        await noGhost();
    },90000);

    test('Down continues from a cap while Up still respects the top of a script', async () => {
        await typeBlock('when flag clicked',1);
        await acceptBlock('stop all',2);
        await clickWholeBlock('control_stop');
        await keys(Key.ENTER,Key.ENTER);
        expect((await state()).caret.startsWith('workspace:')).toBe(true);
        await typeBlock('wait 1 seconds',3);
        const before=(await state()).roots;
        await clickWholeBlock('control_stop');
        await keys(Key.ARROW_DOWN); await expectCaret('block','control_wait');
        await keys(Key.ARROW_UP); await expectCaret('before','control_wait');
        await clickWholeBlock('control_stop');
        await keys(Key.ARROW_UP); await expectCaret('block','event_whenflagclicked');
        await keys(Key.ARROW_UP,Key.ARROW_UP); await expectCaret('block','event_whenflagclicked');
        await keys(Key.ARROW_DOWN); await expectCaret('block','control_stop');
        await keys(Key.TAB); await expectCaret('field','control_stop','STOP_OPTION');
        await keys(Key.TAB); await expectCaret('block','control_wait');
        await keys(Key.ARROW_UP); await expectCaret('before','control_wait');
        expect((await state()).roots).toEqual(before);
        await noGhost();
    },90000);

    test.each([false,true])('cancelling insertion above a connected block returns to the same vertical path (mouth: %s)',
        async mouth => {
        const owner = mouth ? 'control_repeat' : 'motion_movesteps';
        await typeBlock(mouth ? 'repeat 10' : 'move 10 steps',1);
        await typeBlock('wait 1 seconds',2);
        const before=(await state()).roots;
        await caretAt('block','control_wait','',true); await chord(Key.SHIFT,Key.ENTER);
        await keys(...'say cancelled',Key.ESCAPE);
        await expectCaret('before','control_wait');
        await keys(Key.ARROW_UP); await expectCaret('block',owner);
        await keys(Key.ARROW_DOWN); await expectCaret('block','control_wait');
        expect((await state()).roots).toEqual(before);
        await nativeHistory(false); await count(1);
        await nativeHistory(true); await count(2);
        expect((await state()).roots).toEqual(before);
        await noGhost();
    },90000);

    test.each([false, true])('the outline keeps steady opacity and geometry with slow dashes (reduced motion: %s)',
        async reduced => {
        // Headless browsers inherit Windows' reduced-motion preference. Verify
        // both actual dash motion and its static accessibility alternative.
        await driver.sendDevToolsCommand('Emulation.setEmulatedMedia', {
            features: [{name: 'prefers-reduced-motion', value: reduced ? 'reduce' : 'no-preference'}]
        });
        await typeBlock('say hello', 1);
        await keys(Key.HOME);
        const samples = await driver.executeAsyncScript(`const done=arguments[arguments.length-1];
            const path=document.querySelector('[data-position] path[data-source]'), start=performance.now(), samples=[];
            const sample=()=>{
                const style=getComputedStyle(path), box=path.getBoundingClientRect();
                samples.push({opacity:style.opacity,offset:style.strokeDashoffset,dashes:style.strokeDasharray,
                    animation:style.animationName,duration:style.animationDuration,easing:style.animationTimingFunction,
                    x:box.x,y:box.y,width:box.width,height:box.height,
                    reduced:matchMedia('(prefers-reduced-motion: reduce)').matches});
                if(performance.now()-start<1300) requestAnimationFrame(sample); else done(samples);
            }; requestAnimationFrame(sample);`);
        fs.writeFileSync(path.join(artifacts,`calm-outline-samples-${reduced}.json`),JSON.stringify(samples,null,2));
        expect(samples.length).toBeGreaterThan(10);
        expect(samples.every(sample=>sample.reduced===reduced)).toBe(true);
        expect(samples.every(sample=>sample.opacity==='1')).toBe(true);
        expect(samples.every(sample=>sample.dashes==='5px, 7px')).toBe(true);
        expect(samples.every(sample=>sample.x===samples[0].x && sample.y===samples[0].y &&
            sample.width===samples[0].width && sample.height===samples[0].height)).toBe(true);
        if (samples[0].reduced) expect(samples.every(sample=>sample.animation==='none')).toBe(true);
        else {
            expect(samples.every(sample=>sample.duration==='3s' && sample.easing==='linear')).toBe(true);
            expect(new Set(samples.map(sample=>sample.offset)).size).toBeGreaterThan(10);
        }
        await screenshot(`calm-selected-outline-${reduced}`);
    }, 90000);

    test.each(['light','dark'])('the contrasting outline stays clear in the %s theme for blocks and insertion gaps',
        async theme => {
        const settings=await driver.findElement(By.xpath('//span[text()="Settings"]'));
        await settings.click();
        const toggle=await driver.findElements(By.xpath(`//span[text()="Switch To ${theme==='dark'?'Dark':'Light'} Mode"]`));
        if(toggle.length) await toggle[0].click();
        else await settings.click();
        // A GUI theme change remounts native Blocks. Refresh the test oracle,
        // not the editor state, before comparing the new workspace with its VM.
        await painted();
        await driver.executeScript('window.__keyboardTestWorkspace=window.ScratchBlocks.getMainWorkspace();');
        await beginNewScript();
        await typeBlock('repeat 10',1);
        await typeBlock('say hello',2);
        await keys(Key.HOME);
        await expectCaret('block','looks_say');
        const inspect=()=>driver.executeScript(`const path=document.querySelector('[data-position] path[data-source]'),
            keyline=path.parentNode.querySelector('[data-keyline]'),style=getComputedStyle(path),
            keyStyle=keyline&&getComputedStyle(keyline);
            return {dashes:style.strokeDasharray,filter:style.filter,glow:getComputedStyle(path.ownerSVGElement).filter,
                theme:style.getPropertyValue('--color-scheme').trim(),
                fill:style.fill,opacity:style.fillOpacity,stroke:style.stroke,width:style.strokeWidth,
                keyline:keyline&&{stroke:keyStyle.stroke,width:keyStyle.strokeWidth,dashes:keyStyle.strokeDasharray,
                    samePath:keyline.getAttribute('d')===path.getAttribute('d'),
                    sameTransform:keyline.getAttribute('transform')===path.getAttribute('transform')}};`);
        const selected=await inspect();
        expect(selected.theme).toBe(theme);
        expect(selected.dashes).toBe('5px, 7px');
        expect(selected.filter).toBe('none');
        expect(selected.glow).toBe('drop-shadow(rgba(0, 0, 0, 0.5) 0px 1px 0.4px)');
        expect(selected.stroke).toBe('rgb(223, 36, 75)');
        expect(selected.width).toBe('3px');
        expect(selected.keyline).toBeNull();
        expect(selected.fill).toBe('none');
        await screenshot(`clear-outline-${theme}-selected`);
        await keys(Key.END); await settledSpacer('caret');
        const gap=await inspect();
        expect(gap.filter).toBe(selected.filter);
        expect(gap.glow).toBe(selected.glow);
        expect(gap.dashes).toBe(selected.dashes);
        expect(gap.keyline).toEqual(selected.keyline);
        expect(gap.fill).toBe('rgb(255, 77, 90)');
        expect(gap.opacity).toBe('0.12');
        await screenshot(`clear-outline-${theme}-gap`);
        await noGhost();
        await beginNewScript();
        await typeBlock('set my variable to 0',3);
        await keys(Key.HOME);
        expect((await inspect()).keyline).toEqual(selected.keyline);
        await screenshot(`clear-outline-${theme}-orange`);
        await beginNewScript();
        await keys(...'SCORE');
        const preference=await driver.findElement(By.css('[aria-label="Default variable scope"]'));
        expect(await preference.isDisplayed()).toBe(true);
        expect((await variableOptions()).map(o=>o.scope)).toEqual(['global','local']);
        await screenshot(`variable-menu-${theme}`);
        await keys(Key.ESCAPE);
        await beginNewScript();
        await typeBlock('move 10 steps',4);
        await typeBlock('wait 1 seconds',5);
        await caretAt('block','motion_movesteps','',true);
        await chord(Key.CONTROL,'a');
        const range=await driver.executeScript(`const caret=document.querySelector('[data-position]'),
            paths=[...caret.querySelectorAll('[data-caret-paths] > path')],style=getComputedStyle(paths[0]);
            return {kind:caret.dataset.kind,count:Number(caret.dataset.rangeCount),
                contour:caret.dataset.rangeContour,paths:paths.length,masked:Boolean(paths[0].parentNode.getAttribute('mask')),
                stroke:style.stroke,width:style.strokeWidth,dashes:style.strokeDasharray,
                revision:Number(caret.dataset.renderRevision)};`);
        expect(range).toEqual({kind:'range',count:2,contour:'silhouette',paths:2,masked:true,
            stroke:'rgb(223, 36, 75)',width:'8px',dashes:'5px, 7px',revision:expect.any(Number)});
        await driver.sleep(250);
        expect(await driver.executeScript(`return Number(document.querySelector('[data-position]')
            .dataset.renderRevision);`)).toBe(range.revision);
        await screenshot(`range-outline-${theme}`);
    },90000);

    test('the combined range survives a high-contrast Blockly theme remount', async () => {
        await fourCommandStack();
        await caretAt('block','looks_say','',true);
        await chord(Key.CONTROL,'a');
        await driver.findElement(By.xpath('//span[text()="Settings"]')).click();
        await driver.findElement(By.xpath('//span[text()="Block Colors"]')).click();
        await driver.findElement(By.xpath('//span[text()="High Contrast"]')).click();
        await painted();
        await driver.executeScript('window.__keyboardTestWorkspace=window.ScratchBlocks.getMainWorkspace();');
        await enableKeyboard();
        // The native theme remount deliberately starts the new controller at
        // its workspace caret. Select a real member of the remounted stack with
        // a real mouse action before asking for the range; document-order Tab
        // intentionally does not leave a free workspace caret.
        const sayPath=await driver.executeScript(`return window.__keyboardTestWorkspace.getAllBlocks(false)
            .find(block=>block.type==='looks_say').svgPath_;`);
        await driver.actions().mouseMove(sayPath,{x:12,y:12}).click().perform();
        await painted();
        await expectCaret('block','looks_say');
        await chord(Key.CONTROL,'a');
        const range=await driver.executeScript(`const caret=document.querySelector('[data-position]'),
            paths=[...caret.querySelectorAll('[data-caret-paths] > path')],
            zoom=[...document.querySelectorAll('.blocklyZoom image')]
                .map(node=>node.getAttribute('href')||node.getAttribute('xlink:href')||'');
            return {kind:caret.dataset.kind,count:Number(caret.dataset.rangeCount),
                contour:caret.dataset.rangeContour,paths:paths.length,
                masked:Boolean(paths[0].parentNode.getAttribute('mask')),
                highContrast:zoom.every(href=>href.includes('/high-contrast/'))};`);
        expect(range).toEqual({kind:'range',count:4,contour:'silhouette',paths:4,masked:true,highContrast:true});
        await screenshot('range-outline-high-contrast');
    },90000);

    test('types and inserts between commands, preserving the tail through native undo/redo', async () => {
        await typeBlock('move 10 steps', 1);
        await typeBlock('wait 1 seconds', 2);
        await typeBlock('change x by 10', 3);
        const before = (await state()).roots;
        await keys(Key.ARROW_UP, Key.ARROW_UP, Key.ENTER);
        expect((await state()).count).toBe(3); // Empty phantom must not touch the VM.
        await typeBlock('turn clockwise 15 degrees', 4);
        const after = (await state()).roots;
        expect(after[0].type).toBe('motion_movesteps');
        expect(after[0].next.type).toBe('control_wait');
        expect(after[0].next.next.type).toBe('motion_turnright');
        expect(after[0].next.next.next.type).toBe('motion_changexby');
        await nativeHistory(false); await count(3);
        expect((await state()).roots).toEqual(before);
        await nativeHistory(true); await count(4);
        expect((await state()).roots).toEqual(after);
    }, 90000);

    test('cancels a draft without edits and splits a stack with a second Enter', async () => {
        await typeBlock('move 10 steps', 1);
        await typeBlock('wait 1 seconds', 2);
        await keys(Key.ARROW_UP, Key.ARROW_UP, Key.ENTER);
        const before = (await state()).roots;
        await keys(...'turn');
        await keys(Key.ESCAPE);
        expect((await state()).roots).toEqual(before);
        await keys(Key.ENTER, Key.ENTER);
        await driver.wait(async () => (await state()).roots.length === 2, 10000);
        await nativeHistory(false);
        await driver.wait(async () => (await state()).roots.length === 1, 10000);
        expect((await state()).roots).toEqual(before);
    }, 90000);

    test('double Enter at a stack tail starts an aligned new script', async () => {
        await typeBlock('move 10 steps', 1);
        await typeBlock('wait 1 seconds', 2);
        const tailId = await driver.executeScript(`const ws=window.__keyboardTestWorkspace;
            return ws.getAllBlocks(false).find(block=>block.type==='control_wait').id;`);
        await keys(Key.ENTER, Key.ENTER);
        await driver.wait(async () => (await state()).caret.startsWith('workspace:'), 10000);
        const alignment = await driver.executeScript(`const ws=window.__keyboardTestWorkspace;
            const tail=ws.getBlockById(arguments[0]),xy=tail.getRelativeToSurfaceXY();
            const point=ws.getParentSvg().createSVGPoint(); point.x=xy.x; point.y=xy.y;
            const client=point.matrixTransform(ws.getCanvas().getScreenCTM());
            return {tailX:xy.x,caretLeft:document.querySelector('[data-position]').getBoundingClientRect().left,
                projectedTailLeft:client.x};`, tailId);
        expect(alignment.caretLeft).toBeCloseTo(alignment.projectedTailLeft, 3);
        await typeBlock('say new script', 3);
        const placed = await driver.executeScript(`const ws=window.__keyboardTestWorkspace;
            const tail=ws.getBlockById(arguments[0]);
            const added=ws.getTopBlocks(false).find(block=>block.type==='looks_say');
            return {tailX:tail.getRelativeToSurfaceXY().x,newX:added.getRelativeToSurfaceXY().x,
                roots:ws.getTopBlocks(false).length};`, tailId);
        expect(placed.roots).toBe(2);
        expect(placed.newX).toBeCloseTo(placed.tailX, 5);
    }, 90000);

    test('a new script after a C-body tail uses the outer root and the stable command caret', async () => {
        await typeBlock('repeat 10', 1);
        await typeBlock('wait 1 seconds', 2);
        const ids = await driver.executeScript(`const ws=window.__keyboardTestWorkspace;
            return {root:ws.getTopBlocks(false)[0].id,
                tail:ws.getAllBlocks(false).find(block=>block.type==='control_wait').id};`);
        await keys(Key.ENTER, Key.ENTER);
        await driver.wait(async () => (await state()).caret.startsWith('workspace:'), 10000);
        await driver.wait(async () => driver.executeScript(`return document.querySelector(
            '[data-position^="workspace:"] path[data-source="generic"]') !== null;`), 10000,
        'The detached new-script caret did not retain its neutral command silhouette');
        const alignment = await driver.executeScript(`const ws=window.__keyboardTestWorkspace;
            const root=ws.getBlockById(arguments[0]),tail=ws.getBlockById(arguments[1]);
            const point=ws.getParentSvg().createSVGPoint();
            point.x=root.getRelativeToSurfaceXY().x; point.y=root.getRelativeToSurfaceXY().y;
            const client=point.matrixTransform(ws.getCanvas().getScreenCTM());
            const caret=document.querySelector('[data-position^="workspace:"]');
            return {rootX:root.getRelativeToSurfaceXY().x,tailX:tail.getRelativeToSurfaceXY().x,
                projectedRootLeft:client.x,caretLeft:caret.getBoundingClientRect().left,
                empty:caret.dataset.empty,source:caret.querySelector('path[data-source]')?.dataset.source};`,
        ids.root, ids.tail);
        expect(alignment.tailX).toBeGreaterThan(alignment.rootX);
        expect(alignment.caretLeft).toBeCloseTo(alignment.projectedRootLeft, 3);
        expect(alignment.empty).toBe('true');
        expect(alignment.source).toBe('generic');

        await typeBlock('say new script', 3);
        const placed = await driver.executeScript(`const ws=window.__keyboardTestWorkspace;
            const root=ws.getBlockById(arguments[0]);
            const added=ws.getTopBlocks(false).find(block=>block.type==='looks_say');
            return {rootX:root.getRelativeToSurfaceXY().x,newX:added.getRelativeToSurfaceXY().x,
                roots:ws.getTopBlocks(false).length};`, ids.root);
        expect(placed.roots).toBe(2);
        expect(placed.newX).toBeCloseTo(placed.rootX, 5);
    }, 90000);

    test('creates C-block bodies and typed nested reporters with preserved shadows', async () => {
        await typeBlock('repeat 10', 1);
        await typeBlock('move 2 + 3 * 4 steps', 4);
        const snapshot = await state();
        expect(snapshot.roots[0].type).toBe('control_repeat');
        const move = snapshot.roots[0].inputs.SUBSTACK;
        expect(move.type).toBe('motion_movesteps');
        expect(move.inputs.STEPS.type).toBe('operator_add');
        expect(move.inputs.STEPS.inputs.NUM2.type).toBe('operator_multiply');
        await nativeHistory(false); await count(1);
        await nativeHistory(true); await count(4);
        expect((await state()).roots).toEqual(snapshot.roots);
    }, 90000);

    test.each([['if', 'control_if'], ['if then else', 'control_if_else']])(
        'focuses the empty condition immediately after accepting %s', async (query, opcode) => {
        await acceptBlock(query, 1);
        expect((await state()).roots[0].type).toBe(opcode);
        expect((await state()).caret).toMatch(/^input:.*:CONDITION:$/);
        await typeBlock('1 < 2', 2);
        expect((await state()).roots[0].inputs.CONDITION.type).toBe('operator_lt');
        await nativeHistory(false); await count(1);
        expect((await state()).roots[0].inputs.CONDITION).toBeUndefined();
        await nativeHistory(true); await count(2);
        expect((await state()).roots[0].inputs.CONDITION.type).toBe('operator_lt');
    }, 90000);

    test.each([
        ['move 10 steps', 'STEPS', 'NUM', '42'],
        ['say hello', 'MESSAGE', 'TEXT', 'hello world']
    ])('types a literal directly into the first slot of %s', async (query, slot, fieldName, value) => {
        await typeBlock(query, 1);
        const before = (await state()).roots;
        await keys(Key.HOME, Key.TAB, ...value);
        const input = await driver.findElement(By.css('[aria-label="Type a Scratch block"]'));
        expect(await input.getAttribute('value')).toBe(value);
        expect(await driver.findElements(By.css('input.blocklyHtmlInput'))).toHaveLength(0);
        expect((await state()).roots).toEqual(before); // Draft value is not an edit until accepted.
        expect(await driver.findElements(By.css('.blocklyTransitionWorkspace'))).toHaveLength(1);
        await keys(Key.ENTER);
        expect((await state()).roots[0].inputs[slot].fields[fieldName]).toBe(value);
        await count(1);
        await nativeHistory(false); await painted();
        expect((await state()).roots).toEqual(before);
        await nativeHistory(true); await painted();
        expect((await state()).roots[0].inputs[slot].fields[fieldName]).toBe(value);
        await noGhost();
    }, 90000);

    test('completes an empty equals condition, fills its first input immediately, then continues into and below the C body',
        async () => {
        await acceptBlock('if', 1);
        await typeBlock('=', 2);
        expect((await state()).caret).toMatch(/^input:.*:OPERAND1:$/);
        await keys('4', '2', Key.TAB);
        expect((await state()).caret).toMatch(/^input:.*:OPERAND2:$/);
        await keys('4', '3', Key.ENTER);
        expect((await state()).caret).toMatch(/^gap:.*:SUBSTACK:$/);
        const condition = (await state()).roots[0].inputs.CONDITION;
        expect(condition.type).toBe('operator_equals');
        expect(condition.inputs.OPERAND1.fields.TEXT).toBe('42');
        expect(condition.inputs.OPERAND2.fields.TEXT).toBe('43');
        await typeBlock('say inside', 3);
        await keys(Key.ARROW_DOWN);
        // Native block IDs can contain colons. Assert the actual connection,
        // rather than parsing a delimiter inside a perfectly valid identity.
        await expectCaret('gap','control_if');
        await typeBlock('wait 1 seconds', 4);
        const before = (await state()).roots;
        expect(before[0].inputs.SUBSTACK.type).toBe('looks_say');
        expect(before[0].next.type).toBe('control_wait');
        await nativeHistory(false); await count(3);
        await nativeHistory(true); await count(4);
        expect((await state()).roots).toEqual(before);
        await noGhost();
    }, 90000);

    test('authors a Boolean left operand first, then replaces only its comparison shell', async () => {
        await helper.clickBlocksCategory('Variables');
        await helper.clickText('Make a Variable', helper.scope.blocksTab);
        await driver.findElement(By.css('[data-studio-target="prompt-variable-name"]')).sendKeys('Player Score');
        await driver.findElement(By.css('[data-studio-target="prompt-scope-local"]')).click();
        await driver.findElement(By.css('[data-studio-target="prompt-ok"]')).click();
        await beginNewScript();
        await acceptBlock('if', 1);

        await keys(...'Player Score');
        const options = await driver.executeScript(`return [...document.querySelectorAll('[role="option"]')]
            .map(option=>({text:option.childNodes[0].textContent,kind:option.dataset.kind,
                selected:option.getAttribute('aria-selected')==='true'}));`);
        expect(options[0]).toEqual(expect.objectContaining({text: 'Player Score', kind: 'variable'}));
        expect(options[0].selected).toBe(true);
        const preview = await driver.executeScript(`const live=window.__keyboardTestWorkspace;
            const copy=Object.values(window.ScratchBlocks.Workspace.WorkspaceDB_)
                .find(ws=>ws.options.readOnly&&!ws.isFlyout&&ws.options.parentWorkspace===live);
            const comparison=copy&&copy.getAllBlocks(false).find(block=>block.type==='operator_equals');
            const left=comparison&&comparison.getInputTargetBlock('OPERAND1');
            return comparison&&{leftType:left.type,leftName:left.getField('VARIABLE').getVariable().name,
                right:comparison.getInputTargetBlock('OPERAND2').getFieldValue('TEXT')};`);
        expect(preview).toEqual({leftType: 'data_variable', leftName: 'Player Score', right: '50'});
        expect((await state()).roots[0].inputs.CONDITION).toBeUndefined();

        await keys(Key.ENTER); await count(3);
        const equality = (await state()).roots;
        expect(equality[0].inputs.CONDITION.type).toBe('operator_equals');
        expect(equality[0].inputs.CONDITION.inputs.OPERAND1.type).toBe('data_variable');
        await expectCaret('block', 'operator_equals');
        expect(await driver.executeScript(`const block=window.__keyboardTestWorkspace.getAllBlocks(false)
            .find(candidate=>candidate.type==='data_variable');
            return block.getField('VARIABLE').getVariable().name;`)).toBe('Player Score');

        await keys('>');
        expect(await driver.executeScript(`return [...document.querySelectorAll('[role="option"]')]
            .map(option=>option.childNodes[0].textContent);`)).toEqual(['Replace = with >']);
        await keys(Key.ENTER); await count(3);
        const replaced = (await state()).roots;
        expect(replaced[0].inputs.CONDITION.type).toBe('operator_gt');
        expect(replaced[0].inputs.CONDITION.inputs.OPERAND1.type).toBe('data_variable');
        expect((await state()).caret).toMatch(/^input:.*:OPERAND2:$/);
        expect(await driver.executeScript(`const block=window.__keyboardTestWorkspace.getAllBlocks(false)
            .find(candidate=>candidate.type==='data_variable');
            return block.getField('VARIABLE').getVariable().name;`)).toBe('Player Score');

        await nativeHistory(false); await count(3);
        expect((await state()).roots).toEqual(equality);
        await nativeHistory(false); await count(1);
        expect((await state()).roots[0].inputs.CONDITION).toBeUndefined();
        await nativeHistory(true); await count(3);
        expect((await state()).roots).toEqual(equality);
        await nativeHistory(true); await count(3);
        expect((await state()).roots).toEqual(replaced);
        await noGhost();
    }, 90000);

    test('Tab advances a literal Boolean operand into its default selected equality shell', async () => {
        await acceptBlock('if', 1);
        await keys(...'23');
        const labels = await driver.executeScript(`return [...document.querySelectorAll('[role="option"]')]
            .map(option=>option.childNodes[0].textContent);`);
        expect(labels).toContain('Use value: "23"');
        await keys(Key.TAB);
        await count(2); await expectCaret('block', 'operator_equals');
        expect((await state()).roots[0].inputs.CONDITION.inputs.OPERAND1.fields.TEXT).toBe('23');
        await keys('<', Key.ENTER); await count(2);
        expect((await state()).caret).toMatch(/^input:.*:OPERAND2:$/);
        expect((await state()).roots[0].inputs.CONDITION.type).toBe('operator_lt');
        await noGhost();
    }, 90000);

    test('creates a Boolean left variable and its default equality as one native history action', async () => {
        await acceptBlock('if', 1);
        await keys(...'fresh score');
        const options = await variableOptions();
        expect(options).toEqual(expect.arrayContaining([
            expect.objectContaining({kind: 'create-variable', scope: 'local', text: expect.stringMatching(/fresh score/i)}),
            expect.objectContaining({kind: 'create-variable', scope: 'global', text: expect.stringMatching(/fresh score/i)})
        ]));
        expect(options.every(option => !option.selected)).toBe(true);
        expect(await driver.executeScript(`return !window.__keyboardTestWorkspace.getVariable('fresh score','');`))
            .toBe(true);

        await chooseVariable('create-variable', 'local');
        await count(3); await expectCaret('block', 'operator_equals');
        const inserted = (await state()).roots;
        expect(inserted[0].inputs.CONDITION).toMatchObject({
            type: 'operator_equals',
            inputs: {OPERAND1: {type: 'data_variable', fields: {VARIABLE: 'fresh score'}}}
        });
        const variableId = await driver.executeScript(`return window.__keyboardTestWorkspace
            .getVariable('fresh score','').getId();`);
        expect(await driver.executeScript(`return window.__keyboardTestWorkspace.getVariableById(arguments[0]).isLocal;`,
            variableId)).toBe(true);

        await nativeHistory(false); await count(1);
        expect((await state()).roots[0].inputs.CONDITION).toBeUndefined();
        expect(await driver.executeScript(`return !window.__keyboardTestWorkspace.getVariableById(arguments[0]);`,
            variableId)).toBe(true);
        await nativeHistory(true); await count(3);
        expect((await state()).roots).toEqual(inserted);
        expect(await driver.executeScript(`return window.__keyboardTestWorkspace
            .getVariableById(arguments[0])?.name;`, variableId)).toBe('fresh score');
        await noGhost();
    }, 90000);

    test('completes an ordinary reporter inside implicit equality and retains it across operator replacement',
        async () => {
            await acceptBlock('if', 1);
            await keys(...'x pos', Key.TAB);
            expect(await driver.findElement(By.css('[aria-label="Type a Scratch block"]')).getAttribute('value'))
                .toBe('x position');
            expect((await state()).roots[0].inputs.CONDITION).toBeUndefined();
            await keys(Key.TAB); await count(3); await expectCaret('block', 'operator_equals');
            const reporterId = await driver.executeScript(`return window.__keyboardTestWorkspace.getAllBlocks(false)
                .find(block=>block.type==='motion_xposition').id;`);

            await keys('>', Key.ENTER); await count(3);
            expect((await state()).roots[0].inputs.CONDITION).toMatchObject({
                type: 'operator_gt', inputs: {OPERAND1: {type: 'motion_xposition'}}
            });
            expect(await driver.executeScript(`return window.__keyboardTestWorkspace.getBlockById(arguments[0]).id;`,
                reporterId)).toBe(reporterId);
            expect((await state()).caret).toMatch(/^input:.*:OPERAND2:$/);
            await noGhost();
        }, 90000);

    test.each([['Tab', Key.TAB], ['Enter', Key.ENTER], ['Down', Key.ARROW_DOWN]])(
        '%s accepts a typed value and reaches the bottom of the stack for a new command', async (name, key) => {
        await typeBlock('move 10 steps', 1);
        await keys(Key.HOME, Key.TAB, '7', key);
        expect((await state()).caret).toMatch(/^gap:/);
        expect((await state()).roots[0].inputs.STEPS.fields.NUM).toBe('7');
        await typeBlock('wait 2 seconds', 2);
        expect((await state()).roots[0].next.type).toBe('control_wait');
        await nativeHistory(false); await count(1);
        await nativeHistory(false); await painted();
        expect((await state()).roots[0].inputs.STEPS.fields.NUM).toBe('10');
        await noGhost();
    }, 90000);

    test('a loose empty operator can be filled and exited without trapping the caret in its operands', async () => {
        await typeBlock('=', 1);
        expect((await state()).caret).toMatch(/^input:.*:OPERAND1:$/);
        await keys('4', Key.ENTER, '5', Key.ENTER);
        expect((await state()).caret).toMatch(/^after:/);
        await typeBlock('move 10 steps', 2);
        expect((await state()).roots.map(block => block.type)).toEqual(['operator_equals', 'motion_movesteps']);
        await noGhost();
    }, 90000);

    test('input completion offers reporters and a literal choice but hides command, hat and cap shapes', async () => {
        await typeBlock('say hello', 1);
        const before = (await state()).roots;
        await keys(Key.HOME, Key.TAB, ...'x pos');
        const options = async () => driver.executeScript(`return [...document.querySelectorAll('[role="option"]')]
            .map(option=>({kind:option.dataset.kind,text:option.childNodes[0].textContent,
                selected:option.getAttribute('aria-selected')}));`);
        expect((await options())[0].text).toBe('x position');
        await keys(Key.TAB); // Complete the reporter's name without inserting it.
        expect((await state()).roots).toEqual(before);
        await keys(Key.ENTER); await count(2);
        expect((await state()).roots[0].inputs.MESSAGE.type).toBe('motion_xposition');
        await nativeHistory(false); await count(1);
        expect((await state()).caret).toMatch(/^input:.*:MESSAGE:$/);
        await keys(...'x position', Key.ARROW_DOWN); // Choose the same words as literal text.
        expect((await options()).find(option => option.selected === 'true').kind).toBe('value');
        await keys(Key.ENTER);
        expect((await state()).roots[0].inputs.MESSAGE.fields.TEXT).toBe('x position');
        await keys(Key.HOME, Key.TAB, Key.ENTER);
        for (const query of ['move', 'when flag', 'stop']) {
            await chord(Key.CONTROL, 'a'); await keys(...query);
            // A command's name may now be explicitly declared as a scalar
            // variable, but the command/hat/cap itself still cannot fit here.
            expect((await options()).map(option => option.kind))
                .toEqual(['value','create-variable','create-variable']);
            expect((await variableOptions()).map(option=>option.scope)).toEqual(['local','global']);
        }
        await keys(Key.ESCAPE); await noGhost();
        expect((await state()).roots[0].inputs.MESSAGE.fields.TEXT).toBe('x position');
    }, 90000);

    test.each([['Backspace', Key.BACK_SPACE], ['Delete', Key.DELETE]])(
        '%s starts a value draft without deleting a block and a single native Undo restores the old value',
        async (name, deletion) => {
        await typeBlock('move 10 steps', 1);
        const before = (await state()).roots;
        await keys(Key.HOME, Key.TAB, deletion);
        const input = await driver.findElement(By.css('[aria-label="Type a Scratch block"]'));
        expect(await input.getAttribute('value')).toBe('');
        expect((await state()).roots).toEqual(before);
        await keys('7', Key.ENTER);
        expect((await state()).roots[0].inputs.STEPS.fields.NUM).toBe('7');
        await nativeHistory(false); await painted();
        expect((await state()).roots).toEqual(before);
        await nativeHistory(true); await painted();
        expect((await state()).roots[0].inputs.STEPS.fields.NUM).toBe('7');
        await noGhost();
    }, 90000);

    test('the moving outline uses generic command notches and exact native silhouettes for blocks and slots',
        async () => {
        await painted();
        const outline = () => driver.executeScript(`const caret=document.querySelector('[data-position]');
            const path=caret.querySelector('path[data-source]'), css=getComputedStyle(path);
            const box=path.getBoundingClientRect();
            return {kind:caret.dataset.kind,source:path.dataset.source,d:path.getAttribute('d'),
                animation:css.animationName,reduced:matchMedia('(prefers-reduced-motion: reduce)').matches,
                fill:css.fill,stroke:css.strokeWidth,
                before:getComputedStyle(caret,'::after').content,
                box:{left:box.left,top:box.top,width:box.width,height:box.height}};`);
        expect((await outline()).source).toBe('generic');
        const notch = await driver.executeScript('return window.ScratchBlocks.BlockSvg.NOTCH_PATH_LEFT;');
        expect((await outline()).d).toContain(notch);
        expect((await outline()).before).toBe('none');
        const motion = await outline();
        if (motion.reduced) expect(motion.animation).toBe('none');
        else expect(motion.animation).not.toBe('none');
        expect((await outline()).fill).toBe('rgb(255, 77, 90)');
        await screenshot('generic-outline');
        await acceptBlock('if', 1);
        const slot = await driver.executeScript(`const block=window.__keyboardTestWorkspace.getTopBlocks(false)[0];
            return block.getInput('CONDITION').outlinePath.getAttribute('d');`);
        expect((await outline()).d).toBe(slot);
        await keys(Key.HOME);
        const blockPath = await driver.executeScript(`return window.__keyboardTestWorkspace
            .getTopBlocks(false)[0].svgPath_.getAttribute('d');`);
        expect((await outline()).d).toBe(blockPath);
        expect((await outline()).source).toBe('native');
        expect((await outline()).fill).toBe('none');
        await screenshot('selected-c-outline');
        await keys(Key.TAB);
        await typeBlock('1 = 2', 2);
        await chord(Key.SHIFT, Key.TAB); // From the first operand to the whole reporter.
        const equalPath = await driver.executeScript(`return window.__keyboardTestWorkspace.getAllBlocks(false)
            .find(block=>block.type==='operator_equals').svgPath_.getAttribute('d');`);
        expect((await outline()).d).toBe(equalPath);
        await keys(Key.ENTER);
        await expectCaret('input', 'operator_equals', 'OPERAND1');
        await keys(Key.TAB, Key.TAB);
        expect((await state()).caret).toMatch(/^gap:.*:SUBSTACK:$/);
        await typeBlock('move 10 steps', 3);
        const alignment = () => driver.executeScript(`const ws=window.__keyboardTestWorkspace;
            const move=ws.getAllBlocks(false).find(block=>block.type==='motion_movesteps');
            const block=move.svgPath_.getBoundingClientRect(), caret=document.querySelector('[data-position]');
            return {delta:caret.getBoundingClientRect().left-block.left,
                scale:ws.scale,transform:caret.querySelector('path[data-source]').getAttribute('transform')};`);
        expect(Math.abs((await alignment()).delta)).toBeLessThan(1);
        const zoom = await driver.executeScript(`return [...document.querySelectorAll('.blocklyZoom image')]
            .find(node=>(node.getAttribute('xlink:href')||node.getAttribute('href')||'').includes('zoom-in'));`);
        await zoom.click(); await zoom.click(); await zoom.click();
        await driver.findElement(By.xpath('//button[text()="Keyboard"]')).click();
        await keys(Key.END);
        const zoomed = await alignment();
        expect(Math.abs(zoomed.delta)).toBeLessThan(1);
        expect(zoomed.transform).toBe(`scale(${zoomed.scale})`);
        await screenshot('zoomed-insertion-outline');
        await noGhost();
    }, 90000);

    test('switching between literal and expression previews then cancelling preserves the original input and native history',
        async () => {
        await typeBlock('say original', 1);
        await typeBlock('wait 1 seconds', 2);
        const source = (await state()).roots;
        await driver.executeScript(`const ws=window.__keyboardTestWorkspace;
            window.__literalOriginals=ws.getAllBlocks(false).slice();
            window.__literalUndoLength=ws.undoStack_.length;`);
        await keys(Key.ARROW_UP, Key.ARROW_UP, Key.HOME, Key.TAB, Key.ENTER);
        const input = await driver.findElement(By.css('[aria-label="Type a Scratch block"]'));
        for (const query of ['2 + 3', 'a long literal value', '4 * 5', '123']) {
            await chord(Key.CONTROL, 'a'); await keys(...query);
            expect(await input.getAttribute('value')).toBe(query);
            expect((await state()).roots).toEqual(source);
            expect(await driver.executeScript(`const ws=window.__keyboardTestWorkspace;
                return ws.undoStack_.length===window.__literalUndoLength &&
                    window.__literalOriginals.every(block=>ws.getBlockById(block.id)===block);`)).toBe(true);
            expect(await driver.findElements(By.css('.blocklyTransitionWorkspace'))).toHaveLength(1);
            expect((await state()).help).not.toMatch(/lost|no longer|does not fit/);
        }
        await screenshot('literal-value-outline');
        await nativeHistory(false); await painted();
        expect((await state()).roots).toEqual(source); // Text Undo only while the composer owns focus.
        await keys(Key.ESCAPE); await noGhost();
        expect((await state()).roots).toEqual(source);
        await nativeHistory(false); await count(1); // Cancellation did not add a project Undo step.
        expect((await state()).roots[0].inputs.MESSAGE.fields.TEXT).toBe('original');
    }, 90000);

    test('typing over a selected reporter previews and commits one native replacement edit', async () => {
        await typeBlock('move 2 + 3 steps', 2);
        await keys(Key.HOME, Key.ARROW_RIGHT);
        await expectCaret('block', 'operator_add');
        const originalId = await driver.executeScript(`return window.__keyboardTestWorkspace.getAllBlocks(false)
            .find(block=>block.type==='operator_add').id;`);
        await driver.executeScript(`const ws=window.__keyboardTestWorkspace;
            window.__replacementOriginals=ws.getAllBlocks(false).slice();
            window.__replacementUndoLength=ws.undoStack_.length;`);
        await keys(...'x position');
        await driver.wait(until.elementLocated(By.css('[role="option"][aria-selected="true"]')), 10000);
        expect((await state()).roots[0].inputs.STEPS.type).toBe('operator_add');
        expect(await driver.findElements(By.css('.blocklyTransitionWorkspace'))).toHaveLength(1);
        await screenshot('selected-reporter-replacement-preview');
        await keys(Key.ESCAPE); await noGhost();
        await expectCaret('block', 'operator_add');
        expect(await driver.executeScript(`const ws=window.__keyboardTestWorkspace;
            return ws.undoStack_.length===window.__replacementUndoLength &&
                window.__replacementOriginals.every(block=>ws.getBlockById(block.id)===block);`)).toBe(true);
        await keys(...'x position');
        await driver.wait(until.elementLocated(By.css('[role="option"][aria-selected="true"]')), 10000);
        await keys(Key.ENTER); await count(2);
        expect((await state()).roots[0].inputs.STEPS.type).toBe('motion_xposition');
        const replacementId = await driver.executeScript(`return window.__keyboardTestWorkspace.getAllBlocks(false)
            .find(block=>block.type==='motion_xposition').id;`);
        expect(replacementId).not.toBe(originalId);
        await nativeHistory(false); await painted(); await count(2);
        const restored = (await state()).roots[0].inputs.STEPS;
        expect(restored.type).toBe('operator_add');
        expect(restored.inputs.NUM1.fields.NUM).toBe('2');
        expect(restored.inputs.NUM2.fields.NUM).toBe('3');
        expect(await driver.executeScript(`return !!window.__keyboardTestWorkspace.getBlockById(arguments[0]);`,
            originalId)).toBe(true);
        await nativeHistory(true); await painted(); await count(2);
        expect((await state()).roots[0].inputs.STEPS.type).toBe('motion_xposition');
        expect(await driver.executeScript(`return !!window.__keyboardTestWorkspace.getBlockById(arguments[0]);`,
            replacementId)).toBe(true);
        await noGhost();
    }, 90000);

    test('wraps a selected reporter in typed operators while retaining native expression identities', async () => {
        await typeBlock('move x position steps', 2);
        await keys(Key.HOME, Key.ARROW_RIGHT);
        await expectCaret('block', 'motion_xposition');
        const sourceId = await driver.executeScript(`return window.__keyboardTestWorkspace.getAllBlocks(false)
            .find(block=>block.type==='motion_xposition').id;`);
        const historyStart = await driver.executeScript(`const ws=window.__keyboardTestWorkspace;
            window.__expressionWrapSource=ws.getBlockById(arguments[0]); return ws.undoStack_.length;`, sourceId);
        await keys(...'+ 10');
        const option = await driver.wait(until.elementLocated(
            By.css('[role="option"][data-kind="expression-wrap"][aria-selected="true"]')), 10000);
        expect(await option.getText()).toMatch(/wrap with \+ 10/i);
        expect((await state()).roots[0].inputs.STEPS.type).toBe('motion_xposition');
        expect(await driver.executeScript(`const live=window.__keyboardTestWorkspace;
            const copy=Object.values(window.ScratchBlocks.Workspace.WorkspaceDB_)
                .find(ws=>ws.options.readOnly&&!ws.isFlyout&&ws.options.parentWorkspace===live);
            const wrapper=copy&&copy.getAllBlocks(false).find(b=>b.type==='operator_add'&&!live.getBlockById(b.id));
            return wrapper&&[wrapper.getInputTargetBlock('NUM1').id,
                wrapper.getInputTargetBlock('NUM2').getFieldValue('NUM')];`)).toEqual([sourceId, '10']);

        await keys(Key.ENTER); await count(3);
        let expression = (await state()).roots[0].inputs.STEPS;
        expect(expression.type).toBe('operator_add');
        expect(expression.inputs.NUM1.type).toBe('motion_xposition');
        expect(expression.inputs.NUM2.fields.NUM).toBe('10');
        const addId = await driver.executeScript(`const ws=window.__keyboardTestWorkspace;
            return ws.getAllBlocks(false).find(b=>b.type==='operator_add').id;`);
        expect(await driver.executeScript(`return window.__keyboardTestWorkspace.getBlockById(arguments[0]).id;`,
            sourceId)).toBe(sourceId);
        expect(await driver.executeScript(`const ws=window.__keyboardTestWorkspace;
            const events=ws.undoStack_.slice(arguments[0]);
            return [ws.getBlockById(arguments[1])===window.__expressionWrapSource,
                new Set(events.map(event=>event.group)).size];`, historyStart, sourceId)).toEqual([true, 1]);
        await expectCaret('block', 'operator_add');

        await nativeHistory(false); await count(2);
        expect((await state()).roots[0].inputs.STEPS.type).toBe('motion_xposition');
        await expectCaret('block', 'motion_xposition');
        await nativeHistory(true); await count(3);
        expect((await state()).roots[0].inputs.STEPS.type).toBe('operator_add');
        await expectCaret('block', 'operator_add');

        await keys(...'* 2');
        await driver.wait(until.elementLocated(
            By.css('[role="option"][data-kind="expression-wrap"][aria-selected="true"]')), 10000);
        await keys(Key.ENTER); await count(4);
        expression = (await state()).roots[0].inputs.STEPS;
        expect(expression.type).toBe('operator_multiply');
        expect(expression.inputs.NUM1.type).toBe('operator_add');
        expect(expression.inputs.NUM2.fields.NUM).toBe('2');
        expect(await driver.executeScript(`return window.__keyboardTestWorkspace.getBlockById(arguments[0]).id;`,
            addId)).toBe(addId);
        await nativeHistory(false); await count(3);
        await expectCaret('block', 'operator_add');
        await nativeHistory(true); await count(4);
        await expectCaret('block', 'operator_multiply');
        await noGhost();
    }, 90000);

    test('selected Boolean replacement uses the same native type and history contract', async () => {
        await typeBlock('if 1 < 2 then', 2);
        // The fixture deliberately leaves focus in the empty C mouth. Home is
        // scoped to that body, so select the owning command before entering its
        // condition instead of relying on the former owner-jump shortcut.
        await caretAt('block', 'control_if', '', true);
        await keys(Key.ARROW_RIGHT);
        await expectCaret('block', 'operator_lt');
        await keys(...'mouse down?');
        await driver.wait(until.elementLocated(By.css('[role="option"][aria-selected="true"]')), 10000);
        expect((await state()).roots[0].inputs.CONDITION.type).toBe('operator_lt');
        await keys(Key.ENTER); await count(2);
        expect((await state()).roots[0].inputs.CONDITION.type).toBe('sensing_mousedown');
        await nativeHistory(false); await painted(); await count(2);
        const restored = (await state()).roots[0].inputs.CONDITION;
        expect(restored.type).toBe('operator_lt');
        expect(restored.inputs.OPERAND1.fields.TEXT).toBe('1');
        expect(restored.inputs.OPERAND2.fields.TEXT).toBe('2');
        await nativeHistory(true); await painted(); await count(2);
        expect((await state()).roots[0].inputs.CONDITION.type).toBe('sensing_mousedown');
        await noGhost();
    }, 90000);

    test('a selected expression can become an existing or explicitly created variable in one native edit', async () => {
        await typeBlock('move x position steps', 2);
        await keys(Key.HOME, Key.ARROW_RIGHT);
        await expectCaret('block', 'motion_xposition');
        await keys(...'my variable');
        let option = await driver.wait(until.elementLocated(
            By.css('[role="option"][data-kind="variable"][aria-selected="true"]')), 10000);
        expect(await option.getText()).toMatch(/my variable/i);
        await keys(Key.ENTER); await count(2);
        expect((await state()).roots[0].inputs.STEPS).toMatchObject({
            type: 'data_variable', fields: {VARIABLE: 'my variable'}});
        await nativeHistory(false); await painted(); await count(2);
        expect((await state()).roots[0].inputs.STEPS.type).toBe('motion_xposition');

        await keys(Key.HOME, Key.ARROW_RIGHT);
        await expectCaret('block', 'motion_xposition');
        await keys(...'cake');
        option = await driver.wait(until.elementLocated(
            By.css('[role="option"][data-kind="create-variable"][data-scope="local"]')), 10000);
        expect(await option.getAttribute('aria-selected')).toBe('false');
        await keys(Key.ARROW_DOWN, Key.ENTER); await count(2);
        expect((await state()).roots[0].inputs.STEPS).toMatchObject({
            type: 'data_variable', fields: {VARIABLE: 'cake'}});
        const cakeId = await driver.executeScript(`return window.__keyboardTestWorkspace.getVariable('cake','').getId();`);
        await nativeHistory(false); await painted(); await count(2);
        expect((await state()).roots[0].inputs.STEPS.type).toBe('motion_xposition');
        expect(await driver.executeScript(`return !window.__keyboardTestWorkspace.getVariableById(arguments[0]);`,
            cakeId)).toBe(true);
        await nativeHistory(true); await painted(); await count(2);
        expect((await state()).roots[0].inputs.STEPS.fields.VARIABLE).toBe('cake');
        expect(await driver.executeScript(`return !!window.__keyboardTestWorkspace.getVariableById(arguments[0]);`,
            cakeId)).toBe(true);
        await noGhost();
    }, 90000);

    test('visits a nested operator once before its operands in both Tab directions', async () => {
        await typeBlock('move 2 + 3 * 4 steps', 3);
        await keys(Key.HOME);
        const locations = await driver.executeScript(`const ws=window.__keyboardTestWorkspace;
            const move=ws.getTopBlocks(false)[0];
            const add=move.getInputTargetBlock('STEPS'), multiply=add.getInputTargetBlock('NUM2');
            return [
                ['block',move.id,'',''], ['block',add.id,'',''], ['input',add.id,'NUM1',''],
                ['block',multiply.id,'',''], ['input',multiply.id,'NUM1',''],
                ['input',multiply.id,'NUM2',''], ['gap',move.id,'','']
            ].map(parts=>parts.join(':'));`);
        const samples = [];
        for (let index = 0; index < locations.length; index++) {
            expect((await state()).caret).toBe(locations[index]);
            samples.push(await driver.executeScript(`const b=document.querySelector('[data-position]').getBoundingClientRect();
                return {x:b.x,y:b.y,width:b.width,height:b.height};`));
            if (index < locations.length - 1) await keys(Key.TAB);
        }
        for (let index = samples.length - 2; index >= 0; index--) {
            expect(samples[index]).not.toEqual(samples[index + 1]);
            await chord(Key.SHIFT, Key.TAB);
            expect((await state()).caret).toBe(locations[index]);
        }
        await count(3); await noGhost();
    }, 90000);

    test('returns to the owning value slot when native Undo removes the selected expression', async () => {
        await typeBlock('move 10 steps', 1);
        await keys(Key.HOME, Key.TAB, Key.ENTER);
        await typeBlock('2 + 3', 2);
        await nativeHistory(false); await count(1); await painted();
        expect((await state()).caret).toMatch(/^input:.*:STEPS:$/);
        await keys('9', Key.ENTER);
        expect((await state()).roots[0].inputs.STEPS.fields.NUM).toBe('9');
        await count(1); await noGhost();
    }, 90000);

    test('navigates from a supplied C header into its body without changing its values', async () => {
        await typeBlock('if 1 < 2 then', 2);
        expect((await state()).caret).toMatch(/^gap:.*:SUBSTACK:$/);
        await typeBlock('say yes', 3);
        expect((await state()).roots[0].inputs.SUBSTACK.type).toBe('looks_say');
        await beginNewScript();
        await typeBlock('repeat 10', 4);
        expect((await state()).caret).toMatch(/^gap:.*:SUBSTACK:$/);
        await typeBlock('wait 1 seconds', 5);
        expect((await state()).roots.find(b => b.type === 'control_repeat').inputs.SUBSTACK.type).toBe('control_wait');
    }, 90000);

    test('tabs between native operand editors and returns pointer-edited values to their single slot stop', async () => {
        await typeBlock('move 2 + 3 steps', 2);
        await keys(Key.HOME, Key.TAB, Key.TAB, Key.F2, '7');
        await keys(Key.TAB);
        expect(await driver.findElement(By.css('input.blocklyHtmlInput')).getAttribute('value')).toBe('3');
        await keys('8');
        await chord(Key.SHIFT, Key.TAB);
        expect(await driver.findElement(By.css('input.blocklyHtmlInput')).getAttribute('value')).toBe('7');
        await keys(Key.ENTER);
        expect((await state()).caret).toMatch(/^input:.*:NUM1:$/);
        const sum = (await state()).roots[0].inputs.STEPS;
        expect(sum.inputs.NUM1.fields.NUM).toBe('7');
        expect(sum.inputs.NUM2.fields.NUM).toBe('8');
        const field = await driver.executeScript(`return window.__keyboardTestWorkspace.getAllBlocks(false)
            .find(b=>b.type==='operator_add').getInputTargetBlock('NUM2').getField('NUM').getSvgRoot();`);
        await field.click();
        const composer = await driver.findElement(By.css('[aria-label="Type a Scratch block"]'));
        await driver.wait(async () => (await state()).focus === 'Type a Scratch block', 10000);
        expect(await composer.getAttribute('value')).toBe('8');
        await driver.wait(() => driver.executeScript('return !window.ScratchBlocks.WidgetDiv.isVisible();'),10000,
            'The previous native input did not finish closing while the composer owned focus');
        await keys(Key.ESCAPE);
        expect((await state()).caret).toMatch(/^input:.*:NUM2:$/);
        await chord(Key.SHIFT, Key.TAB);
        expect((await state()).caret).toMatch(/^input:.*:NUM1:$/);
        await chord(Key.SHIFT, Key.TAB);
        expect((await state()).caret).toMatch(/^block:/); // The sum, not a second wrapper around NUM1.
        await keys(Key.DELETE); await count(1);
        await nativeHistory(false); await count(2);
        expect((await state()).roots[0].inputs.STEPS).toEqual(sum);
        await noGhost();
    }, 90000);

    test('a pointer click on a native number shadow keeps Keyboard composition focus and native history',
        async () => {
        await typeBlock('move 10 steps', 1);
        await keys(Key.END); await settledSpacer('caret');
        const shell = await driver.executeScript(`const block=window.__keyboardTestWorkspace.getAllBlocks(false)
            .find(b=>b.type==='motion_movesteps').getInputTargetBlock('STEPS');
            const rect=block.getSvgRoot().querySelector('.blocklyBlockBackground').getBoundingClientRect();
            return {left:rect.left,right:rect.right,y:rect.top+(rect.height/2)};`);
        const composer = await driver.findElement(By.css('[aria-label="Type a Scratch block"]'));
        // First click hits the layout preview; after Escape the second hits
        // the live source. Both curved ends are outside the narrow text element
        // and should behave like its centre without turning the transparent
        // bounding-box corners into hit targets.
        for (const x of [shell.left + 2, shell.right - 2]) {
            await driver.actions().move({origin: 'viewport', x: Math.round(x), y: Math.round(shell.y)})
                .click().perform();
            await driver.wait(async () => (await state()).focus === 'Type a Scratch block', 10000);
            expect(await composer.getAttribute('value')).toBe('10');
            expect(await driver.executeScript('return [arguments[0].selectionStart,arguments[0].selectionEnd];',
                composer)).toEqual([0, 2]);
            expect(await driver.findElements(By.css('input.blocklyHtmlInput'))).toHaveLength(0);
            expect(await driver.findElement(By.css('[role="option"][aria-selected="true"]'))
                .getAttribute('data-kind')).toBe('value');
            if (x < shell.right - 2) await keys(Key.ESCAPE);
        }
        await composer.sendKeys('25', Key.ENTER); await count(1);
        await driver.wait(async () => (await state()).roots[0].inputs.STEPS.fields.NUM === '25', 10000,
            'Pointer-authored value did not reach the VM before checking native history');
        expect((await state()).roots[0].inputs.STEPS.fields.NUM).toBe('25');
        await nativeHistory(false); await count(1);
        expect((await state()).roots[0].inputs.STEPS.fields.NUM).toBe('10');
        await nativeHistory(true); await count(1);
        expect((await state()).roots[0].inputs.STEPS.fields.NUM).toBe('25');
    }, 90000);

    test('navigates into a native number field and returns focus without swallowing text editing', async () => {
        await typeBlock('move 10 steps', 1);
        await keys(Key.HOME, Key.ARROW_RIGHT, Key.F2);
        const field = await driver.wait(until.elementLocated(By.css('input.blocklyHtmlInput')), 10000);
        await field.sendKeys(Key.chord(Key.CONTROL, 'a'), '42', Key.ENTER);
        await driver.wait(async () => (await state()).roots[0].inputs.STEPS.fields.NUM === '42', 10000);
        await driver.wait(async () => (await state()).focus === 'Scratch keyboard editor', 10000);
        await keys(Key.END);
        await typeBlock('wait 2 seconds', 2);
        await nativeHistory(false); await count(1);
        expect((await state()).roots[0].inputs.STEPS.fields.NUM).toBe('42');
        await nativeHistory(false);
        await driver.wait(async () => (await state()).roots[0].inputs.STEPS.fields.NUM === '10', 10000);
    }, 90000);

    test.each(['text field', 'dropdown'])(
        'native %s dismissal preserves a newer Finder text owner', async editor => {
            await typeBlock(editor === 'text field' ? 'move 10 steps' : 'go to random position', 1);
            await keys(Key.HOME, Key.ARROW_RIGHT, editor === 'text field' ? Key.F2 : Key.ENTER);
            await driver.wait(() => driver.executeScript(`return window.ScratchBlocks.WidgetDiv.isVisible() ||
                window.ScratchBlocks.DropDownDiv.isVisible();`), 10000);
            const before = (await state()).roots;
            const finder = await driver.findElement(By.css('.sa-find-input'));
            await finder.click();
            await painted();
            expect(await driver.executeScript('return document.activeElement===arguments[0];', finder)).toBe(true);
            // Actions type into the actual owner, not WebElement.sendKeys,
            // which would repair a stolen focus before checking it.
            await keys(...'move');
            expect(await finder.getAttribute('value')).toBe('move');
            expect((await state()).roots).toEqual(before);
            await noGhost();
        }, 90000);

    test('a delayed native field return cannot focus a disabled editor after a newer mouse click', async () => {
        await typeBlock('move 10 steps', 1);
        await keys(Key.HOME, Key.ARROW_RIGHT, Key.F2);
        await driver.wait(until.elementLocated(By.css('input.blocklyHtmlInput')), 10000);
        const before = (await state()).roots;
        // Delay frame delivery, not user events or native editing. This makes
        // the close-versus-click ordering repeatable on fast and busy machines.
        await driver.executeScript(`window.__focusTestRaf=window.requestAnimationFrame;
            window.__focusTestFrames=[];
            window.requestAnimationFrame=callback=>{
                window.__focusTestFrames.push(callback); return -1;
            };`);
        const title = await driver.findElement(By.css('input[placeholder="Project title here"]'));
        try {
            await driver.actions().sendKeys(Key.ESCAPE).perform();
            await title.click();
        } finally {
            await driver.executeScript(`window.requestAnimationFrame=window.__focusTestRaf;
                window.__focusTestFrames.forEach(callback=>requestAnimationFrame(callback));
                delete window.__focusTestFrames; delete window.__focusTestRaf;`);
        }
        await painted();
        expect(await driver.findElement(By.xpath('//button[text()="Keyboard"]')).getAttribute('aria-pressed'))
            .toBe('false');
        expect(await driver.executeScript('return document.activeElement===arguments[0];', title)).toBe(true);
        await chord(Key.CONTROL, 'a'); await keys(...'Focus stays here');
        expect(await title.getAttribute('value')).toBe('Focus stays here');
        expect((await state()).roots).toEqual(before);
        await noGhost();
    }, 90000);

    test('typing a slot value and native dropdown editing both return to structural navigation', async () => {
        await typeBlock('move 10 steps', 1);
        await keys(Key.HOME, Key.ARROW_RIGHT, '4', '2');
        const field = await driver.findElement(By.css('[aria-label="Type a Scratch block"]'));
        expect(await field.getAttribute('value')).toBe('42');
        await keys(Key.ENTER);
        await beginNewScript();
        await typeBlock('go to random position', 2);
        await keys(Key.HOME, Key.ARROW_RIGHT, Key.ENTER);
        await driver.findElement(By.xpath('//*[contains(@class,"blocklyDropDownDiv")]' +
            '//*[contains(@class,"goog-menuitem-content") and normalize-space(.)="mouse-pointer"]')).click();
        await driver.wait(async () => (await state()).focus === 'Scratch keyboard editor', 10000);
        const go = (await state()).roots.find(b => b.type === 'motion_goto');
        expect(go.inputs.TO.fields.TO).toBe('_mouse_');
        await keys(Key.END);
        await typeBlock('wait 1 seconds', 3);
    }, 90000);

    test('pointer variable, broadcast, event and control dropdowns return their exact structural focus', async () => {
        await typeBlock('set my variable to 0', 1);
        await typeBlock('broadcast message1', 2);
        const chooseMenuItem = async label => {
            const items = await driver.wait(
                until.elementsLocated(By.css('.blocklyDropDownDiv .goog-menuitem')), 10000);
            const labels = [];
            for (const item of items) {
                // WebDriver getText() is empty during DropDownDiv's opening
                // animation even though the native menu content is already
                // present. Read that content without racing its paint.
                const itemLabel = String(await driver.executeScript(
                    'return arguments[0].textContent;', item)).replace(/\u00a0/g, ' ').trim();
                labels.push(itemLabel);
                if (itemLabel === label) {
                    await item.click();
                    return;
                }
            }
            throw Error(`Native dropdown did not contain ${label}; found ${JSON.stringify(labels)}`);
        };
        const clickField = async (type, fieldName) => {
            const field = await driver.executeScript(`const ws=window.__keyboardTestWorkspace;
                const block=ws.getAllBlocks(false).find(item=>item.type===arguments[0]);
                return block?.getField(arguments[1])?.getSvgRoot() ||
                    block?.inputList.flatMap(input=>input.connection?.targetBlock()||[])
                        .find(child=>child.isShadow())?.getField(arguments[1])?.getSvgRoot();`, type, fieldName);
            if (!field) throw Error(`Missing ${type}.${fieldName}`);
            await field.click();
        };

        await keys(Key.HOME);
        await chord(Key.SHIFT, Key.ARROW_DOWN);
        expect((await state()).caret).toMatch(/^range:/);
        await clickField('data_setvariableto', 'VARIABLE');
        await expectVisibleCaret('field', 'data_setvariableto', 'VARIABLE');
        await chooseMenuItem('my variable');
        await driver.wait(async () => (await state()).focus === 'Scratch keyboard editor', 10000);
        await expectCaret('field', 'data_setvariableto', 'VARIABLE');

        await keys(Key.HOME);
        await chord(Key.SHIFT, Key.ARROW_DOWN);
        expect((await state()).caret).toMatch(/^range:/);
        await clickField('event_broadcast', 'BROADCAST_OPTION');
        await expectVisibleCaret('input', 'event_broadcast', 'BROADCAST_INPUT');
        await chooseMenuItem('message1');
        await driver.wait(async () => (await state()).focus === 'Scratch keyboard editor', 10000);
        await expectCaret('input', 'event_broadcast', 'BROADCAST_INPUT');

        await beginNewScript();
        await typeBlock('when space key pressed', 3);
        await clickField('event_whenkeypressed', 'KEY_OPTION');
        await expectVisibleCaret('field', 'event_whenkeypressed', 'KEY_OPTION');
        // Arrow/space key labels use image assets and may be textless until
        // those assets paint. Choose a stable textual option; this test is
        // about native menu ownership and structural focus, not icon loading.
        await chooseMenuItem('any');
        await driver.wait(async () => (await state()).focus === 'Scratch keyboard editor', 10000);
        await expectCaret('field', 'event_whenkeypressed', 'KEY_OPTION');

        await beginNewScript();
        await typeBlock('stop all', 4);
        await clickField('control_stop', 'STOP_OPTION');
        await expectVisibleCaret('field', 'control_stop', 'STOP_OPTION');
        await chooseMenuItem('this script');
        await driver.wait(async () => (await state()).focus === 'Scratch keyboard editor', 10000);
        await expectCaret('field', 'control_stop', 'STOP_OPTION');
    }, 90000);

    test.each(['block', 'gap', 'reporter'])('holding Enter at a %s cannot skip inputs, commit or split a draft',
        async position => {
        const hasReporter=position==='reporter';
        await typeBlock(hasReporter ? 'move 2 + 3 steps' : 'move 10 steps', hasReporter ? 2 : 1);
        await typeBlock('wait 1 seconds', hasReporter ? 3 : 2);
        await keys(Key.ARROW_UP, Key.ARROW_UP, Key.HOME);
        if (position === 'gap') await keys(Key.END);
        if (hasReporter) await keys(Key.TAB);
        await driver.executeScript(`window.__keyboardRepeats=[];
            window.addEventListener('keydown',e=>window.__keyboardRepeats.push({key:e.key,type:e.type}),true);
            window.addEventListener('keyup',e=>window.__keyboardRepeats.push({key:e.key,type:e.type}),true);`);
        await driver.actions().keyDown(Key.ENTER).keyDown(Key.ENTER).keyDown(Key.ENTER).keyUp(Key.ENTER).perform();
        await painted();
        expect((await state()).roots).toHaveLength(1);
        expect((await state()).count).toBe(hasReporter ? 3 : 2);
        expect(await driver.findElement(By.css('[aria-label="Type a Scratch block"]')).isDisplayed())
            .toBe(!hasReporter);
        if (hasReporter) await expectCaret('input', 'operator_add', 'NUM1');
        // Prove a held-key stream, including drivers which do not set e.repeat.
        const repeats = await driver.executeScript('return window.__keyboardRepeats;');
        expect(repeats.map(event => event.type)).toEqual(['keydown', 'keydown', 'keydown', 'keyup']);
    }, 90000);

    test('native dragging returns its settled block to keyboard editing without running the script', async () => {
        await typeBlock('move 10 steps', 1);
        const geometry = () => driver.executeScript(`
            const block = window.ScratchBlocks.getMainWorkspace().getTopBlocks(false)[0];
            const box=block.svgPath_.getBoundingClientRect();
            return {x:Math.round(box.left+8),y:Math.round(box.top+18),
                id:block.id,spriteX:window.vm.editingTarget.x,blockX:block.getRelativeToSurfaceXY().x};
        `);
        const before = await geometry();
        await driver.actions().move({origin: 'viewport', x: before.x, y: before.y}).press().release().perform();
        await painted();
        expect((await state()).caret).toMatch(/^block:/);
        expect((await geometry()).spriteX).toBe(before.spriteX);
        await driver.actions().move({origin: 'viewport', x: before.x, y: before.y}).press()
            .move({origin: 'viewport', x: before.x + 100, y: before.y + 70, duration: 400}).release().perform();
        await driver.wait(async () => Math.abs((await geometry()).blockX - before.blockX) > 80, 10000);
        expect((await state()).count).toBe(1);
        expect((await geometry()).spriteX).toBe(before.spriteX);
        await driver.wait(async () => (await state()).focus === 'Scratch keyboard editor', 10000,
            'Native drop did not return focus to Keyboard mode');
        expect((await state()).caret).toBe(`block:${before.id}::`);
        await keys(Key.ENTER);
        expect((await state()).focus).toBe('Type a Scratch block');
        await typeBlock('wait 1 seconds', 2);
    }, 90000);

    test.each(['empty workspace', 'cancelled draft', 'zoomed workspace'])(
        'clicks blank space and types immediately in a %s', async scenario => {
        if (scenario === 'cancelled draft') await keys(Key.ENTER, ...'repeat 10');
        if (scenario === 'zoomed workspace') {
            const zoom = await driver.executeScript(`return [...document.querySelectorAll('.blocklyZoom image')]
                .find(node=>(node.getAttribute('xlink:href')||node.getAttribute('href')||'').includes('zoom-in'));`);
            await zoom.click(); await zoom.click();
            await driver.findElement(By.xpath('//button[text()="Keyboard"]')).click();
        }
        const at = await driver.executeScript(`const ws=window.__keyboardTestWorkspace;
            const box=ws.getParentSvg().getBoundingClientRect();
            // The composition input may be open on the left. Prove this is
            // genuinely blank workspace, not a click into that text box.
            const x=Math.round(box.right-260), y=Math.round(box.top+180);
            if (!document.elementFromPoint(x,y).classList.contains('blocklyMainBackground'))
                throw Error('Click-to-type fixture is not targeting blank workspace');
            const p=ws.getParentSvg().createSVGPoint(); p.x=x; p.y=y;
            const local=p.matrixTransform(ws.getCanvas().getScreenCTM().inverse());
            return {x,y,localX:local.x,localY:local.y};`);
        // No focus call or frame delay between the physical click and typing.
        await driver.actions().move({origin:'viewport',x:at.x,y:at.y}).click().sendKeys('move 10 steps').perform();
        await painted();
        expect(await driver.findElement(By.css('[role="combobox"]')).getAttribute('value')).toBe('move 10 steps');
        expect((await state()).focus).toBe('Type a Scratch block');
        expect((await state()).count).toBe(0);
        await keys(Key.ENTER); await count(1); await noGhost();
        const xy = await driver.executeScript(`const ws=window.__keyboardTestWorkspace;
            const b=ws.getTopBlocks(false)[0], p=b.getRelativeToSurfaceXY();
            return {x:p.x,y:p.y,dragging:!!ws.isDragging()};`);
        expect(xy.x).toBeCloseTo(at.localX, 0);
        expect(xy.y).toBeCloseTo(at.localY, 0);
        expect(xy.dragging).toBe(false);
        const before = (await state()).roots;
        await nativeHistory(false); await count(0);
        await nativeHistory(true); await count(1);
        expect((await state()).roots).toEqual(before);
    }, 90000);

    test.each([false, true])('keeps native background panning distinct from caret placement (return to start: %s)',
        async returnToStart => {
        await typeBlock('move 10 steps', 1);
        const before = await state();
        const at = await driver.executeScript(`const ws=window.__keyboardTestWorkspace;
            const box=ws.getParentSvg().getBoundingClientRect();
            return {x:Math.round(box.right-180),y:Math.round(box.top+350),scrollX:ws.scrollX,scrollY:ws.scrollY};`);
        await driver.actions().move({origin:'viewport',x:at.x,y:at.y}).press()
            .move({origin:'viewport',x:at.x-80,y:at.y-60,duration:300}).perform();
        expect(await driver.executeScript('return !!window.__keyboardTestWorkspace.isDragging();')).toBe(true);
        if (returnToStart) await driver.actions().move({origin:'viewport',x:at.x,y:at.y,duration:300}).perform();
        await driver.actions().release().perform(); await painted();
        const after = await state();
        expect(after.roots).toEqual(before.roots);
        expect(after.caret).toBe(before.caret);
        expect(await driver.executeScript('return !!window.__keyboardTestWorkspace.isDragging();')).toBe(false);
        if (!returnToStart) expect(await driver.executeScript(`const ws=window.__keyboardTestWorkspace;
            return Math.hypot(ws.scrollX-arguments[0],ws.scrollY-arguments[1]);`,at.scrollX,at.scrollY)).toBeGreaterThan(40);
        await noGhost();
    }, 90000);

    test('uses a bounded live draft and restores every shifted or selected descendant on cancel', async () => {
        await typeBlock('move 10 steps', 1);
        await typeBlock('wait 1 seconds', 2);
        const before = (await state()).roots;
        await keys(Key.ARROW_UP, Key.ARROW_UP, Key.ENTER, ...'say hello');
        await screenshot('middle-draft');
        expect((await state()).roots).toEqual(before);
        await keys(Key.ESCAPE);
        await noGhost();
        expect(await driver.executeScript(`return [...document.querySelectorAll('.blocklyBlockCanvas g')]
            .filter(node=>node.style.translate).length;`)).toBe(0);
        await keys(Key.HOME, Key.ARROW_RIGHT, Key.ENTER);
        await typeBlock('2 + 3', 3);
        const occupied = (await state()).roots;
        await keys(Key.HOME, Key.ARROW_RIGHT, ...'4 + 5');
        // A whole selected reporter is an explicit replacement target. Its
        // draft must remain presentation-only until Enter, and Escape must
        // restore the exact occupied expression rather than treating it as an
        // arbitrary writable hole.
        expect((await driver.findElements(By.css('[role="option"][aria-disabled="false"]'))).length)
            .toBeGreaterThan(0);
        expect((await state()).count).toBe(3);
        expect((await state()).roots).toEqual(occupied);
        await keys(Key.ESCAPE);
        expect((await state()).roots).toEqual(occupied);
        await noGhost();
    }, 90000);

    test('keeps the caret anchored after a real zoom-control click and permits ordinary page focus', async () => {
        await typeBlock('move 10 steps', 1);
        const zoom = await driver.executeScript(`return [...document.querySelectorAll('.blocklyZoom image')]
            .find(node=>(node.getAttribute('xlink:href')||node.getAttribute('href')||'').includes('zoom-in'));`);
        await zoom.click(); await zoom.click(); await zoom.click();
        await driver.findElement(By.xpath('//button[text()="Keyboard"]')).click();
        await keys(Key.HOME);
        const deltas = await driver.executeScript(`
            const box=window.ScratchBlocks.getMainWorkspace().getTopBlocks(false)[0].svgPath_.getBoundingClientRect();
            const caret=document.querySelector('[data-position]').getBoundingClientRect();
            return [Math.abs(box.x-caret.x),Math.abs(box.y-caret.y),Math.abs(box.width-caret.width)];
        `);
        deltas.forEach(delta => expect(delta).toBeLessThan(2));
        await keys(Key.ESCAPE);
        const title = await driver.findElement(By.css('input[placeholder="Project title here"]'));
        await title.click(); await title.sendKeys(Key.chord(Key.CONTROL, 'a'), 'Keyboard focus test');
        expect((await state()).count).toBe(1);
        expect(await title.getAttribute('value')).toBe('Keyboard focus test');
    }, 90000);

    test('keeps draft connections out of history and shows real C-mouth expansion before acceptance', async () => {
        await typeBlock('repeat 10', 1);
        await typeBlock('wait 1 seconds', 2);
        await keys(Key.HOME); await chord(Key.SHIFT,Key.ENTER);
        await keys(...'if 1 < 2 then');
        const before = (await state()).roots;
        expect(await driver.findElements(By.css('.blocklyTransitionWorkspace'))).toHaveLength(1);
        const expansion = await driver.executeScript(`
            const source=window.ScratchBlocks.getMainWorkspace().getTopBlocks(false)[0].svgPath_.getBoundingClientRect();
            const copy=document.querySelector('.blocklyTransitionWorkspace .blocklyBlockCanvas > g > .blocklyPath')
                .getBoundingClientRect();
            return copy.height-source.height;
        `);
        expect(expansion).toBeGreaterThan(25);
        const history = await driver.executeScript(`const ws=window.ScratchBlocks.getMainWorkspace();
            return {undo:ws.undoStack_.length,ids:ws.getAllBlocks(false).map(b=>b.id)};`);
        await chord(Key.CONTROL, 'a');
        await keys(...'repeat 20');
        await screenshot('c-block-draft');
        expect((await state()).roots).toEqual(before);
        expect(await driver.executeScript(`const ws=window.ScratchBlocks.getMainWorkspace();
            return {undo:ws.undoStack_.length,ids:ws.getAllBlocks(false).map(b=>b.id)};`)).toEqual(history);
        await keys(Key.ESCAPE);
        await noGhost();
    }, 90000);

    test('uses existing variables through the native creation dialog and typed dropdown arguments', async () => {
        await helper.clickBlocksCategory('Variables');
        await helper.clickText('Make a Variable', helper.scope.blocksTab);
        await driver.findElement(By.css('[data-studio-target="prompt-variable-name"]')).sendKeys('cake');
        await driver.findElement(By.css('[data-studio-target="prompt-scope-local"]')).click();
        await driver.findElement(By.css('[data-studio-target="prompt-ok"]')).click();
        await beginNewScript();
        await typeBlock('set cake to 5', 1);
        expect((await state()).roots[0].fields.VARIABLE).toBe('cake');
        await typeBlock('change cake by 2', 2);
        expect((await state()).roots[0].next.fields.VARIABLE).toBe('cake');
        await nativeHistory(false); await count(1);
        await nativeHistory(true); await count(2);
        expect(await driver.executeScript(`return Object.values(window.vm.editingTarget.variables)
            .filter(v=>v.name==='cake').length;`)).toBe(1);
    }, 90000);

    const variableState = () => driver.executeScript(`const ws=window.__keyboardTestWorkspace;
        return {models:ws.getVariablesOfType('').map(v=>({id:v.getId(),name:v.name,local:v.isLocal})),
            vm:window.vm.runtime.targets.filter(t=>t.isOriginal).flatMap(t=>Object.values(t.variables)
                .filter(v=>v.type==='').map(v=>({id:v.id,name:v.name,target:t.id,stage:t.isStage}))),
            fields:ws.getAllBlocks(false).filter(b=>b.getField('VARIABLE'))
                .map(b=>({block:b.id,value:b.getFieldValue('VARIABLE')})),
            undo:ws.undoStack_.filter(e=>e.type!=='ui').map(e=>({type:e.type,group:e.group})),
            target:window.vm.editingTarget.id};`);
    const variableOptions = () => driver.executeScript(`return [...document.querySelectorAll('[role="option"]')]
        .filter(o=>o.dataset.kind.includes('variable')).map(o=>({kind:o.dataset.kind,scope:o.dataset.scope,
            text:o.textContent,selected:o.getAttribute('aria-selected')==='true'}));`);
    const chooseVariable = async (kind, scope) => {
        const selector=`[role="option"][data-kind="${kind}"][data-scope="${scope}"][aria-selected="true"]`;
        for(let i=0;i<15;i++) {
            if((await driver.findElements(By.css(selector))).length) {
                await keys(Key.ENTER); return;
            }
            await keys(Key.ARROW_DOWN);
        }
        throw Error(`No reachable ${scope} ${kind}`);
    };
    const expectVariable = async (name,scope,exists=true) => {
        await driver.wait(async()=>{
            const data=await variableState();
            return data.models.some(v=>v.name===name)===exists && data.vm.some(v=>v.name===name)===exists;
        },5000);
        const data=await variableState();
        if(exists) {
            const models=data.models.filter(v=>v.name===name), vars=data.vm.filter(v=>v.name===name);
            expect(models).toHaveLength(1); expect(vars).toHaveLength(1);
            expect(models[0].local).toBe(scope==='local');
            expect(vars[0].stage).toBe(scope==='global');
            expect(vars[0].id).toBe(models[0].id);
            expect(data.fields.some(f=>f.value===models[0].id)).toBe(true);
        }
        return data;
    };

    const variablePreview = () => driver.executeScript(`const ws=window.__keyboardTestWorkspace;
        const copy=Object.values(window.ScratchBlocks.Workspace.WorkspaceDB_)
            .find(w=>w.options.readOnly&&!w.isFlyout&&w.options.parentWorkspace===ws);
        const actor=copy&&copy.getAllBlocks(false).find(b=>!ws.getBlockById(b.id)&&b.type==='data_variable');
        const caret=document.querySelector('[data-position] path[data-source]');
        return actor&&{name:actor.getField('VARIABLE').getVariable().name,readOnly:copy.options.readOnly,
            output:!!actor.outputConnection,previous:!!actor.previousConnection,next:!!actor.nextConnection,
            path:actor.svgPath_.getAttribute('d'),caretPath:caret.getAttribute('d'),
            newModels:copy.getVariablesOfType(actor.getField('VARIABLE').getVariable().type)
                .filter(v=>!ws.getVariableById(v.getId())).map(v=>v.name),
            parent:actor.getParent()?.type,source:caret.dataset.source};`);

    test.each(['SCORE','cake & icing'])(
        'an unselected Create %s previews the native rounded reporter without declaring a variable', async name => {
        const before=await variableState();
        await keys(...name);
        expect((await variableOptions()).every(o=>!o.selected)).toBe(true);
        const preview=await variablePreview();
        expect(preview).toMatchObject({name,readOnly:true,output:true,previous:false,next:false,
            source:'native',newModels:[name]});
        expect(preview.caretPath).toBe(preview.path);
        expect(await variableState()).toEqual(before);
        await keys(Key.ENTER); // Previewing is not implicit permission to declare.
        expect(await variableState()).toEqual(before);
        await keys(Key.ARROW_DOWN,Key.ARROW_DOWN); // Either scope has the same reporter geometry.
        expect((await variablePreview()).path).toBe(preview.path);
        await chord(Key.CONTROL,'a'); await keys(...'BONUS_SCORE');
        expect((await variablePreview()).newModels).toEqual(['BONUS_SCORE']);
        expect(await variableState()).toEqual(before);
        await keys(Key.ESCAPE); await noGhost();
        await keys(...name,Key.ARROW_DOWN,Key.ENTER); await count(1);
        expect(await driver.executeScript(`return window.__keyboardTestWorkspace.getTopBlocks(false)[0]
            .svgPath_.getAttribute('d');`)).toBe(preview.path);
        await nativeHistory(false); await count(0); await noGhost();
    },90000);

    test('a variable draft replaces only its displayed value slot and restores the original shadow on cancellation',
        async () => {
        await acceptBlock('say hello',1);
        const before=await variableState(), roots=(await state()).roots;
        await keys(...'SCORE'); // The literal remains first until a reporter is explicitly chosen.
        await keys(Key.ARROW_DOWN);
        expect(await variablePreview()).toMatchObject({name:'SCORE',parent:'looks_say',output:true});
        await screenshot('rounded-variable-in-value-slot');
        for(let i=0;i<3;i++) {
            await keys(Key.ARROW_UP); // Literal presentation.
            expect(await variablePreview()).toBeNull();
            await keys(Key.ARROW_DOWN);
            expect((await variablePreview()).newModels).toEqual(['SCORE']);
            expect(await variableState()).toEqual(before);
            expect((await state()).roots).toEqual(roots);
        }
        await keys(Key.ESCAPE); await strictlyNoPreview();
        expect(await variableState()).toEqual(before);
        expect((await state()).roots).toEqual(roots);
        await keys(...'my variable');
        expect(await variablePreview()).toMatchObject({name:'my variable',parent:'looks_say',newModels:[]});
        await keys(Key.ESCAPE); await strictlyNoPreview();
    },90000);

    const draftPaint = () => driver.executeScript(`const source=window.__keyboardTestWorkspace;
        const copy=Object.values(window.ScratchBlocks.Workspace.WorkspaceDB_)
            .find(w=>w.options.readOnly&&!w.isFlyout&&w.options.parentWorkspace===source);
        if(!copy) throw Error('No native draft presentation');
        const alpha=el=>{
            let opacity=1;
            for(let node=el;node&&node!==copy.getCanvas().parentNode;node=node.parentElement) {
                const css=getComputedStyle(node); opacity*=Number(css.opacity);
            }
            return opacity*Number(getComputedStyle(el).fillOpacity);
        };
        return copy.getAllBlocks(false).map(b=>({type:b.type,old:!!source.getBlockById(b.id),shadow:b.isShadow(),
            body:alpha(b.svgPath_),rootOpacity:getComputedStyle(b.getSvgRoot()).opacity,
            fields:b.inputList.flatMap(i=>i.fieldRow).map(f=>alpha(f.getSvgRoot())),
            paint:[...b.getSvgRoot().children].filter(e=>e.dataset.keyboardDraftPaint).length}));`);

    // Element-level opacity is exhaustively unit tested. Keep the two native
    // renderer shapes most likely to expose composition bugs: a deep reporter
    // expression and a concave C block.
    test.each(['move 1 + 2 * 3 steps','if then else'])(
        'ghost paint is equally faint for body, fields and nested inputs in %s', async text => {
        const before=await variableState();
        await keys(...text);
        const paint=await draftPaint();
        expect(paint.length).toBeGreaterThan(0);
        for(const block of paint) {
            expect(block.body).toBeCloseTo(.45,6);
            expect(block.rootOpacity).toBe('1');
            expect(block.paint).toBeGreaterThan(0);
            for(const field of block.fields) expect(field).toBeCloseTo(.45,6);
        }
        if(text.startsWith('move')) {
            expect(paint.filter(b=>b.shadow)).toHaveLength(3);
            expect(paint.filter(b=>!b.shadow)).toHaveLength(3);
        }
        await screenshot(`uniform-ghost-${text.replace(/\W+/g,'-')}`);
        expect(await variableState()).toEqual(before);
        await count(0);
        await keys(Key.ESCAPE); await noGhost();
    },90000);

    test('ghost paint never fades an existing receiver or attached continuation and its inputs', async () => {
        await typeBlock('move 10 steps',1);
        await typeBlock('wait 2 seconds',2);
        await keys(Key.ARROW_UP,Key.ARROW_UP,Key.ENTER);
        const before=(await state()).roots, variables=await variableState();
        const input=await driver.findElement(By.css('[aria-label="Type a Scratch block"]'));
        for(const text of ['repeat 10','say 1 + 2','go to random position']) {
            await input.sendKeys(Key.chord(Key.CONTROL,'a'),text); await painted();
            const paint=await draftPaint();
            expect(paint.filter(b=>b.old)).toHaveLength(4); // Two commands with their two shadows.
            expect(paint.filter(b=>!b.old).length).toBeGreaterThan(0);
            for(const block of paint) {
                const opacity=block.old?1:.45;
                expect(block.body).toBeCloseTo(opacity,6);
                for(const field of block.fields) expect(field).toBeCloseTo(opacity,6);
            }
            expect((await state()).roots).toEqual(before);
            expect(await variableState()).toEqual(variables);
        }
        await screenshot('uniform-ghost-with-retained-tail');
        await keys(Key.ESCAPE); await noGhost();
        expect((await state()).roots).toEqual(before);
        await nativeHistory(false); await count(1);
        await nativeHistory(true); await count(2);
        expect((await state()).roots).toEqual(before);
    },90000);

    test('variable choices never declare on typing, unselected Enter, Tab, or Escape', async () => {
        const before=await variableState();
        await keys(...'cake');
        expect((await variableOptions()).map(o=>[o.kind,o.scope,o.selected])).toEqual([
            ['create-variable','local',false],['create-variable','global',false]]);
        await keys(Key.ENTER,Key.TAB);
        expect((await variableState()).vm).toEqual(before.vm);
        expect((await variableState()).undo).toEqual(before.undo);
        await keys(Key.ESCAPE); await count(0); await noGhost();
        expect((await variableState()).models).toEqual(before.models);
        await keys(...'cake',Key.ARROW_DOWN,Key.ENTER);
        await count(1); await expectVariable('cake','local');
        const created=await variableState();
        expect(created.models).toHaveLength(before.models.length+1);
        expect(created.vm).toHaveLength(before.vm.length+1);
        const ownEvents=created.undo.slice(before.undo.length);
        expect(ownEvents.some(e=>e.type==='var_create')).toBe(true);
        expect(new Set(ownEvents.map(e=>e.group)).size).toBe(1);
        expect(ownEvents.every(e=>Boolean(e.group))).toBe(true);
        await nativeHistory(false); await count(0); await expectVariable('cake','local',false);
        await nativeHistory(true); await count(1);
        expect((await expectVariable('cake','local')).models).toEqual(created.models);
    },90000);

    test.each([
        ['set fish','fish','local','data_setvariableto','0',1],
        ['set SCORE to 8','SCORE','global','data_setvariableto','8',1],
        ['set "fish to fry" to 50','fish to fry','local','data_setvariableto','50',1],
        ['change fish by 2 + 3','fish','local','data_changevariableby',null,2]
    ])('command declaration %s creates one native edit with %s in %s scope', async(query,name,scope,opcode,value,total)=>{
        const before=await variableState();
        await keys(...query);
        const options=await variableOptions();
        expect(options).toHaveLength(2);
        expect(options.every(o=>o.kind==='create-variable-command' && o.text.includes(`Create “${name}”`)))
            .toBe(true);
        expect(options[0].scope).toBe(scope);
        expect(await variableState()).toEqual(before);
        await chooseVariable('create-variable-command',scope); await count(total);
        const created=await expectVariable(name,scope), tree=(await state()).roots;
        expect(tree[0].type).toBe(opcode);
        expect(tree[0].fields.VARIABLE).toBe(name);
        if(value!==null) expect(Object.values(tree[0].inputs.VALUE.fields)).toContain(value);
        else expect(tree[0].inputs.VALUE).toMatchObject({type:'operator_add',inputs:{
            NUM1:{fields:{NUM:'2'}},NUM2:{fields:{NUM:'3'}}}});
        if(value!==null) await expectCaret('input',opcode,'VALUE');
        else await expectCaret('block','operator_add'); // Do not duplicate the occupied input's Tab stop.
        const events=created.undo.slice(before.undo.length);
        expect(events.some(e=>e.type==='var_create')).toBe(true);
        expect(new Set(events.map(e=>e.group)).size).toBe(1);
        expect(events.every(e=>Boolean(e.group))).toBe(true);
        await screenshot(`variable-command-${scope}-${total}`);
        for(let i=0;i<3;i++) {
            await nativeHistory(false); await count(0); await expectVariable(name,scope,false);
            await nativeHistory(true); await count(total);
            expect((await expectVariable(name,scope)).models).toEqual(created.models);
            expect((await state()).roots).toEqual(tree);
        }
        await noGhost();
    },90000);

    test('command declaration preview, Tab completion and cancellation never allocate live variables', async()=>{
        const before=await variableState();
        await keys(...'set fish');
        expect((await variableOptions()).every(o=>!o.selected)).toBe(true);
        const preview=()=>driver.executeScript(`const ws=window.__keyboardTestWorkspace;
            const copy=Object.values(window.ScratchBlocks.Workspace.WorkspaceDB_)
                .find(w=>w.options.readOnly&&!w.isFlyout&&w.options.parentWorkspace===ws);
            const actor=copy?.getAllBlocks(false).find(b=>b.type==='data_setvariableto');
            return actor&&{name:actor.getField('VARIABLE').getVariable().name,
                value:actor.getInputTargetBlock('VALUE').toString(),
                owned:copy.getAllVariables().filter(v=>!ws.getVariableById(v.getId())).map(v=>v.name)};`);
        expect(await preview()).toEqual({name:'fish',value:'0',owned:['fish']});
        await keys(Key.ENTER); expect(await variableState()).toEqual(before);
        await keys(Key.ARROW_DOWN,Key.TAB);
        expect(await driver.findElement(By.css('[aria-label="Type a Scratch block"]')).getAttribute('value'))
            .toBe('set fish to');
        expect(await variableState()).toEqual(before);
        await chord(Key.CONTROL,'z');
        expect(await driver.findElement(By.css('[aria-label="Type a Scratch block"]')).getAttribute('value'))
            .toBe('set fish');
        expect(await variableState()).toEqual(before);
        await screenshot('variable-command-draft-outline');
        await keys(Key.ESCAPE); await count(0); await noGhost();
        expect(await variableState()).toEqual(before);
        await keys(...'change fish by 3');
        await driver.findElement(By.css('[data-studio-target="stage-selector"]')).click();
        await driver.wait(()=>driver.executeScript('return window.vm.editingTarget.isStage;'),5000);
        expect((await variableState()).vm).toEqual(before.vm);
        await noGhost();
    },90000);

    test('command declaration in a C mouth preserves the existing tail and shadows through repeated history', async()=>{
        await typeBlock('repeat 3',1); await typeBlock('move 10 steps',2); await typeBlock('wait 1 seconds',3);
        await caretAt('block','control_wait','',true); await chord(Key.SHIFT,Key.ENTER);
        const before=(await state()).roots, variables=await variableState();
        const originalIds=await driver.executeScript('return window.__keyboardTestWorkspace.getAllBlocks(false).map(b=>b.id).sort();');
        await keys(...'set fish to 2 + 3');
        expect((await variableState()).models).toEqual(variables.models);
        await screenshot('variable-command-between-existing-blocks');
        await chooseVariable('create-variable-command','local'); await count(5);
        const after=(await state()).roots;
        expect(after[0].inputs.SUBSTACK.next).toMatchObject({type:'data_setvariableto',next:{type:'control_wait'}});
        for(let i=0;i<3;i++) {
            await nativeHistory(false); await count(3); await expectVariable('fish','local',false);
            expect((await state()).roots).toEqual(before);
            expect(await driver.executeScript('return window.__keyboardTestWorkspace.getAllBlocks(false).map(b=>b.id).sort();'))
                .toEqual(originalIds);
            await nativeHistory(true); await count(5); await expectVariable('fish','local');
            expect((await state()).roots).toEqual(after);
        }
        await noGhost();
    },90000);

    test('command declaration reuses existing names, keeps motion matches, and never offers statements in value slots', async()=>{
        await keys(...'set fish'); await chooseVariable('create-variable-command','local'); await count(1);
        const created=await expectVariable('fish','local');
        await keys(Key.END,...'change fish by 7');
        expect(await variableOptions()).toEqual([]);
        await keys(Key.ENTER); await count(2);
        expect((await variableState()).models).toEqual(created.models);
        await keys(Key.END,...'set x to 10');
        expect(await driver.findElement(By.css('[role="option"][aria-selected="true"]')).getAttribute('data-kind'))
            .not.toBe('create-variable-command');
        await keys(Key.ENTER); await count(3);
        expect((await state()).roots[0].next.next.type).toBe('motion_setx');
        await keys(...'set new fish'); // A value slot may hold text, but never a statement.
        expect((await variableOptions()).some(o=>o.kind==='create-variable-command')).toBe(false);
        await keys(Key.ESCAPE); await noGhost();
    },90000);

    test('command declaration on Stage offers only global scope and excludes another sprite local name', async()=>{
        await keys(...'set fish'); await chooseVariable('create-variable-command','local'); await count(1);
        await driver.findElement(By.css('[data-studio-target="stage-selector"]')).click();
        await driver.wait(()=>driver.executeScript('return window.vm.editingTarget.isStage;'),5000);
        await beginNewScript();
        await keys(...'set fish'); expect(await variableOptions()).toEqual([]);
        await keys(Key.ESCAPE,...'set SHARED to 9');
        expect((await variableOptions()).map(o=>o.scope)).toEqual(['global']);
        await chooseVariable('create-variable-command','global'); await count(1);
        await expectVariable('SHARED','global');
        await nativeHistory(false); await count(0); await expectVariable('SHARED','global',false);
        await noGhost();
    },90000);

    test('command declaration creates the first variable without leaving private template workspaces behind', async()=>{
        await keys(Key.ESCAPE);
        // Empty-variable fixture; creation itself is real typing and selection.
        await driver.executeScript(`const ws=window.__keyboardTestWorkspace;
            ws.getVariablesOfType('').forEach(v=>ws.deleteVariableById(v.getId()));`);
        await driver.wait(()=>driver.executeScript(`return Object.values(window.vm.editingTarget.variables)
            .every(v=>v.type!=='');`),5000);
        const before=await variableState();
        const headless=()=>driver.executeScript(`return Object.values(window.ScratchBlocks.Workspace.WorkspaceDB_)
            .filter(w=>!w.rendered).map(w=>w.id).sort();`);
        const original=await headless();
        await beginNewScript();
        await keys(...'set FIRST to 42');
        expect(await variableState()).toEqual(before);
        expect((await variableOptions()).map(o=>o.scope)).toEqual(['global','local']);
        await keys(Key.ESCAPE); await noGhost();
        expect(await headless()).toEqual(original);
        await keys(...'set FIRST to 42'); await chooseVariable('create-variable-command','local'); await count(1);
        await expectVariable('FIRST','local'); // Deliberately override the uppercase default.
        expect(await headless()).toEqual(original);
        await nativeHistory(false); await count(0); await expectVariable('FIRST','local',false);
        await nativeHistory(true); await count(1); await expectVariable('FIRST','local');
        await noGhost();
    },90000);

    test.each([['cake','local'],['SCORE','global']])(
        'variable creation in a value slot uses %s with %s scope and preserves native shadows through history',
        async(name,scope)=>{
        await acceptBlock('say hello',1);
        await keys(...name);
        const options=await variableOptions();
        expect(options.filter(o=>o.kind==='create-variable')[0].scope).toBe(scope);
        const before=(await state()).roots;
        await chooseVariable('create-variable',scope);
        await count(2);
        const created=await expectVariable(name,scope);
        const after=(await state()).roots;
        expect(after[0].inputs.MESSAGE.type).toBe('data_variable');
        for(let i=0;i<3;i++) {
            await nativeHistory(false); await count(1); await expectVariable(name,scope,false);
            expect((await state()).roots).toEqual(before);
            await nativeHistory(true); await count(2);
            expect((await expectVariable(name,scope)).models).toEqual(created.models);
            expect((await state()).roots).toEqual(after);
        }
        await noGhost();
    },90000);

    test('variable name text can remain a literal instead of creating a variable', async()=>{
        await acceptBlock('say hello',1);
        const before=await variableState();
        await keys(...'cake');
        expect(await driver.findElement(By.css('[role="option"][aria-selected="true"]')).getAttribute('data-kind'))
            .toBe('value');
        await keys(Key.ENTER); await count(1);
        expect((await state()).roots[0].inputs.MESSAGE.fields.TEXT).toBe('cake');
        expect((await variableState()).vm).toEqual(before.vm);
    },90000);

    test('variable creation in a typed dropdown is one undo, while existing variables reuse identity', async()=>{
        await typeBlock('set my variable to 5',1);
        await caretAt('field','data_setvariableto','VARIABLE',true);
        const before=await variableState();
        await keys(...'counter');
        expect(await driver.findElement(By.css('[aria-label="Type a Scratch block"]')).getAttribute('value')).toBe('counter');
        expect(await driver.findElements(By.css('.blocklyHtmlInput'))).toHaveLength(0);
        await chooseVariable('create-variable','local'); await count(1);
        await expectVariable('counter','local');
        await expectCaret('input','data_setvariableto','VALUE');
        await nativeHistory(false); await painted();
        expect((await expectVariable('counter','local',false)).fields).toEqual(before.fields);
        await nativeHistory(true); await painted(); await expectVariable('counter','local');
        await caretAt('field','data_setvariableto','VARIABLE',true);
        await keys(...'my variable');
        expect((await variableOptions())[0]).toMatchObject({kind:'variable',scope:'global',selected:true});
        expect((await variableOptions()).some(o=>o.kind==='create-variable')).toBe(false);
        await keys(Key.ENTER); await painted();
        expect((await variableState()).fields).toEqual(before.fields);
        await nativeHistory(false); await painted();
        await expectVariable('counter','local');
        await noGhost();
    },90000);

    test('variable dropdown cancellation and F2 rename cancellation preserve identity and history', async()=>{
        await typeBlock('set my variable to 5',1);
        await caretAt('field','data_setvariableto','VARIABLE',true);
        const before=await variableState();
        await keys(Key.BACK_SPACE,...'unused',Key.ESCAPE);
        expect((await variableState()).fields).toEqual(before.fields);
        expect((await variableState()).vm).toEqual(before.vm);
        expect((await variableState()).undo).toEqual(before.undo);
        await keys(Key.F2);
        expect(await driver.executeScript('return window.ScratchBlocks.DropDownDiv.isVisible();')).toBe(false);
        const prompt=await driver.wait(until.elementLocated(By.css('[data-studio-target="prompt-variable-name"]')),10000);
        expect(await prompt.getAttribute('value')).toBe('my variable');
        await prompt.sendKeys(Key.ESCAPE);
        await driver.wait(async()=> (await driver.findElements(By.css('[data-studio-target="prompt-variable-name"]')))
            .length===0,10000);
        await driver.wait(async()=>(await state()).focus==='Scratch keyboard editor',10000);
        expect((await variableState()).fields).toEqual(before.fields);
        expect((await variableState()).vm).toEqual(before.vm);
        expect((await variableState()).undo).toEqual(before.undo);
        await noGhost();
    },90000);

    test('F2 edits ordinary values but renames the variable represented by a whole command', async()=>{
        await helper.clickBlocksCategory('Variables');
        await helper.clickText('Make a Variable', helper.scope.blocksTab);
        await driver.findElement(By.css('[data-studio-target="prompt-variable-name"]')).sendKeys('cake');
        await driver.findElement(By.css('[data-studio-target="prompt-scope-local"]')).click();
        await driver.findElement(By.css('[data-studio-target="prompt-ok"]')).click();
        await beginNewScript();
        await typeBlock('set cake to 5',1);
        await caretAt('input','data_setvariableto','VALUE',true);
        await keys(Key.F2);
        const value=await driver.wait(until.elementLocated(By.css('input.blocklyHtmlInput')),10000);
        expect(await value.getAttribute('value')).toBe('5');
        await value.sendKeys(Key.chord(Key.CONTROL,'a'),'7',Key.ENTER);
        await driver.wait(async()=>Object.values((await state()).roots[0].inputs.VALUE.fields).includes('7'),10000);
        await driver.wait(async()=>(await state()).focus==='Scratch keyboard editor',10000);
        await keys(Key.HOME);
        await expectCaret('block','data_setvariableto');
        const identity=await driver.executeScript(`const b=window.__keyboardTestWorkspace.getAllBlocks(false)
            .find(block=>block.type==='data_setvariableto'); return b.getFieldValue('VARIABLE');`);
        await keys(Key.F2);
        expect(await driver.findElements(By.css('.blocklyDropDownDiv.blocklyDropDownContent'))).toHaveLength(0);
        let prompt=await driver.wait(until.elementLocated(By.css('[data-studio-target="prompt-variable-name"]')),10000);
        expect(await prompt.getAttribute('value')).toBe('cake');
        expect(await driver.executeScript('return document.activeElement===arguments[0];',prompt)).toBe(true);
        expect(await driver.executeScript('return [arguments[0].selectionStart,arguments[0].selectionEnd];',prompt))
            .toEqual([0,'cake'.length]);
        // F2 is a rename command: the existing name is ready for immediate
        // replacement without a click or a separate Select All command.
        await prompt.sendKeys('score');
        await driver.findElement(By.css('[data-studio-target="prompt-ok"]')).click();
        await driver.wait(async()=>{
            const data=await variableState();
            return data.models.some(v=>v.id===identity&&v.name==='score') && data.fields.some(f=>f.value===identity) &&
                (await state()).roots[0].fields.VARIABLE==='score';
        },10000);
        expect((await state()).roots[0].fields.VARIABLE).toBe('score');
        await nativeHistory(false);
        await driver.wait(async()=> (await variableState()).models.some(v=>v.id===identity&&v.name==='cake') &&
            (await state()).roots[0].fields.VARIABLE==='cake',10000);
        await nativeHistory(true);
        await driver.wait(async()=> (await variableState()).models.some(v=>v.id===identity&&v.name==='score') &&
            (await state()).roots[0].fields.VARIABLE==='score',10000);
        expect((await variableState()).models.find(v=>v.id===identity).name).toBe('score');
        expect(Object.values((await state()).roots[0].inputs.VALUE.fields)).toContain('7');
    },90000);

    test('typed broadcast commands and fields create one native project identity with Undo Redo', async()=>{
        await beginNewScript();
        await keys(...'broadcast party time');
        const command='[role="option"][data-kind="create-broadcast-command"]';
        await driver.wait(async()=> (await driver.findElements(By.css(command))).length===2,10000);
        expect(await driver.findElements(By.css(`${command}[aria-selected="true"]`))).toHaveLength(0);
        const before=await driver.executeScript(`const ws=window.__keyboardTestWorkspace;
            return {blocks:ws.getAllBlocks(false).filter(b=>!b.isShadow()).length,
                broadcasts:ws.getVariablesOfType('broadcast_msg').map(v=>v.name)};`);
        await keys(Key.ENTER); // Creation remains explicit even with exact text.
        expect(await driver.executeScript(`const ws=window.__keyboardTestWorkspace;
            return {blocks:ws.getAllBlocks(false).filter(b=>!b.isShadow()).length,
                broadcasts:ws.getVariablesOfType('broadcast_msg').map(v=>v.name)};`)).toEqual(before);
        await keys(Key.ARROW_DOWN,Key.ENTER); await count(1);
        const created=await driver.executeScript(`const ws=window.__keyboardTestWorkspace,
            block=ws.getAllBlocks(false).find(b=>b.type==='event_broadcast'),
            field=block.getInputTargetBlock('BROADCAST_INPUT').getField('BROADCAST_OPTION'),
            model=field.getVariable(),stage=window.vm.runtime.getTargetForStage().variables[model.getId()];
            return {block:block.id,id:model.getId(),name:model.name,type:model.type,
                vm:stage&&{id:stage.id,name:stage.name,type:stage.type,value:stage.value}};`);
        expect(created).toMatchObject({name:'party time',type:'broadcast_msg',
            vm:{id:created.id,name:'party time',type:'broadcast_msg',value:'party time'}});
        await nativeHistory(false); await count(0);
        expect(await driver.executeScript(`return !!window.__keyboardTestWorkspace.getVariableById(arguments[0]);`,
            created.id)).toBe(false);
        await nativeHistory(true); await count(1);
        expect(await driver.executeScript(`return window.__keyboardTestWorkspace.getVariableById(arguments[0])?.name;`,
            created.id)).toBe('party time');

        // Native history deliberately suppresses structural presentation for a
        // short settling window. Do not race its final caret recovery with the
        // first horizontal navigation key.
        await driver.sleep(220); await painted();
        await keys(Key.HOME);
        await caretAt('input','event_broadcast','BROADCAST_INPUT');
        await keys(...'celebrate');
        const direct='[role="option"][data-kind="create-broadcast"]';
        await driver.wait(until.elementLocated(By.css(direct)),10000);
        expect(await driver.findElements(By.css(`${direct}[aria-selected="true"]`))).toHaveLength(0);
        await keys(Key.ARROW_DOWN,Key.ENTER);
        const replacement=await driver.executeScript(`const ws=window.__keyboardTestWorkspace,
            block=ws.getBlockById(arguments[0]),field=block.getInputTargetBlock('BROADCAST_INPUT')
                .getField('BROADCAST_OPTION'),model=field.getVariable();
            return {id:model.getId(),name:model.name,type:model.type};`,created.block);
        expect(replacement).toMatchObject({name:'celebrate',type:'broadcast_msg'});
        await nativeHistory(false);
        await driver.wait(()=>driver.executeScript(`const ws=window.__keyboardTestWorkspace,
            block=ws.getBlockById(arguments[0]); return block.getInputTargetBlock('BROADCAST_INPUT')
                .getField('BROADCAST_OPTION').getVariable().name==='party time' &&
                !ws.getVariableById(arguments[1]);`,created.block,replacement.id),10000);
        await nativeHistory(true);
        await driver.wait(()=>driver.executeScript(`const ws=window.__keyboardTestWorkspace,
            block=ws.getBlockById(arguments[0]); return block.getInputTargetBlock('BROADCAST_INPUT')
                .getField('BROADCAST_OPTION').getVariable().name==='celebrate' &&
                ws.getVariableById(arguments[1])?.name==='celebrate';`,created.block,replacement.id),10000);
        expect((await state()).count).toBe(1);
    },120000);

    test('F2 renames a broadcast identity and native Undo Redo restore its VM value and references', async()=>{
        await helper.clickBlocksCategory('Events');
        const flyout=await driver.wait(
            until.elementLocated(By.css('.blocklyFlyout g[data-id="event_broadcast"] > .blocklyPath')),20000);
        const workspaceSvg=await driver.findElement(By.css('svg.blocklySvg'));
        await driver.actions().mouseMove(flyout).mouseDown().mouseMove(workspaceSvg,{x:420,y:360}).mouseUp().perform();
        const broadcastField=await driver.wait(async()=>{
            const fields=await driver.findElements(By.css('.blocklyWorkspace .blocklyEditableText'));
            for(const candidate of fields) if((await candidate.getText()).includes('message1')) return candidate;
            return null;
        },20000);
        expect(await broadcastField.getText()).toContain('message1');
        const initial=await driver.executeScript(`const ws=window.__keyboardTestWorkspace;
            const v=ws.getVariablesOfType('broadcast_msg').find(item=>item.name==='message1');
            return {id:v.getId(),block:ws.getAllBlocks(false).find(b=>b.type==='event_broadcast').id};`);
        const broadcastState=()=>driver.executeScript(`const ws=window.__keyboardTestWorkspace,id=arguments[0],
            model=ws.getVariableById(id),stage=window.vm.runtime.getTargetForStage().variables[id],
            refs=window.vm.runtime.targets.flatMap(t=>Object.values(t.blocks._blocks))
                .filter(b=>b.fields?.BROADCAST_OPTION?.id===id).map(b=>b.fields.BROADCAST_OPTION.value);
            return {workspace:model?.name,vmName:stage?.name,vmValue:stage?.value,refs};`,initial.id);
        await enableKeyboard();
        await keys(Key.HOME); await expectCaret('block','event_broadcast'); await keys(Key.F2);
        expect(await driver.findElements(By.css('.blocklyDropDownDiv.blocklyDropDownContent'))).toHaveLength(0);
        let prompt=await driver.wait(until.elementLocated(By.css('[data-studio-target="prompt-variable-name"]')),10000);
        expect(await prompt.getAttribute('value')).toBe('message1');
        expect(await driver.executeScript('return document.activeElement===arguments[0];',prompt)).toBe(true);
        expect(await driver.executeScript('return [arguments[0].selectionStart,arguments[0].selectionEnd];',prompt))
            .toEqual([0,'message1'.length]);
        await prompt.sendKeys(Key.ESCAPE);
        await driver.wait(async()=> (await driver.findElements(By.css('[data-studio-target="prompt-variable-name"]')))
            .length===0,10000);
        await driver.wait(async()=>(await state()).focus==='Scratch keyboard editor',10000);
        expect(await broadcastState()).toEqual({workspace:'message1',vmName:'message1',vmValue:'message1',
            refs:['message1']});
        await keys(Key.F2);
        prompt=await driver.wait(until.elementLocated(By.css('[data-studio-target="prompt-variable-name"]')),10000);
        expect(await driver.executeScript('return document.activeElement===arguments[0];',prompt)).toBe(true);
        expect(await driver.executeScript('return [arguments[0].selectionStart,arguments[0].selectionEnd];',prompt))
            .toEqual([0,'message1'.length]);
        await prompt.sendKeys('party');
        await driver.findElement(By.css('[data-studio-target="prompt-ok"]')).click();
        await driver.wait(async()=>(await state()).focus==='Scratch keyboard editor',10000);
        await driver.wait(async()=> (await broadcastState()).refs.every(value=>value==='party'),10000);
        expect(await broadcastState()).toEqual({workspace:'party',vmName:'party',vmValue:'party',refs:['party']});
        await nativeHistory(false);
        await driver.wait(async()=> (await broadcastState()).vmValue==='message1',10000);
        expect(await broadcastState()).toEqual({workspace:'message1',vmName:'message1',vmValue:'message1',
            refs:['message1']});
        await nativeHistory(true);
        await driver.wait(async()=> (await broadcastState()).vmValue==='party',10000);
        expect(await broadcastState()).toEqual({workspace:'party',vmName:'party',vmValue:'party',refs:['party']});
        expect((await state()).count).toBe(1);
    },120000);

    test('variable scope choice overrides case and the preference persists without changing the name', async()=>{
        await keys(...'SCORE');
        expect((await variableOptions())[0].scope).toBe('global');
        await driver.findElement(By.css('[aria-label="Default variable scope"] option[value="local"]')).click();
        expect((await variableOptions())[0].scope).toBe('local');
        await chooseVariable('create-variable','global'); // Explicit override still available.
        await count(1); await expectVariable('SCORE','global');
        await driver.navigate().refresh();
        await driver.wait(() => driver.executeScript('return !!window.vm?.editingTarget && !!window.ScratchBlocks?.getMainWorkspace();'), 30000);
        await driver.executeScript('window.__keyboardTestWorkspace=window.ScratchBlocks.getMainWorkspace();');
        await beginNewScript();
        await keys(...'OTHER');
        expect(await driver.findElement(By.css('[aria-label="Default variable scope"]')).getAttribute('value')).toBe('local');
        expect((await variableOptions())[0].scope).toBe('local');
        await chooseVariable('create-variable','local'); await count(1); await expectVariable('OTHER','local');
    },90000);

    test('variable declarations respect Stage scope and cross-sprite global name conflicts', async()=>{
        await keys(...'shared'); await chooseVariable('create-variable','local'); await count(1);
        const local=await expectVariable('shared','local');
        await driver.findElement(By.css('[data-studio-target="stage-selector"]')).click();
        await driver.wait(()=>driver.executeScript('return window.vm.editingTarget.isStage;'),5000);
        await beginNewScript();
        await keys(...'shared');
        expect((await variableOptions()).filter(o=>o.kind==='create-variable')).toEqual([]);
        await keys(Key.ESCAPE,...'stage score');
        expect((await variableOptions()).map(o=>o.scope)).toEqual(['global']);
        await chooseVariable('create-variable','global'); await count(1);
        const after=await expectVariable('stage score','global');
        expect(after.vm.filter(v=>v.name==='shared')).toEqual(local.vm.filter(v=>v.name==='shared'));
        await nativeHistory(false); await count(0); await expectVariable('stage score','global',false);
    },90000);

    test('variable suggestions feed implicit comparisons, reject statement gaps and replace selected expressions', async()=>{
        await acceptBlock('if',1);
        await keys(...'cake');
        expect((await variableOptions()).map(option=>[option.kind,option.scope,option.selected])).toEqual([
            ['create-variable','local',false],['create-variable','global',false]
        ]);
        expect(await driver.executeScript(`return !window.__keyboardTestWorkspace.getVariable('cake','');`)).toBe(true);
        await keys(Key.ESCAPE,Key.TAB,...'cake');
        expect(await variableOptions()).toEqual([]);
        await keys(Key.ESCAPE);
        await beginNewScript();
        await acceptBlock('say 1 + 2',3);
        const occupied=(await state()).roots;
        await keys(...'cake');
        expect((await variableOptions()).map(option=>[option.kind,option.scope,option.selected])).toEqual([
            ['create-variable','local',false],['create-variable','global',false]
        ]);
        expect((await state()).roots).toEqual(occupied);
        await keys(Key.ESCAPE); await count(3); await noGhost();
        expect((await state()).roots).toEqual(occupied);
    },90000);

    test('variable draft cancels on sprite change without creating or consuming history', async()=>{
        const before=await variableState();
        await keys(...'pending');
        await driver.findElement(By.css('[data-studio-target="stage-selector"]')).click();
        await driver.wait(()=>driver.executeScript('return window.vm.editingTarget.isStage;'),5000);
        expect((await variableState()).vm).toEqual(before.vm);
        expect(await driver.findElement(By.css('[aria-label="Type a Scratch block"]')).isDisplayed()).toBe(false);
        await count(0); await noGhost();
    },90000);

    test('does not place a draft on a different target after a sprite or project change', async () => {
        await typeBlock('move 10 steps', 1);
        await keys(...'wait 2');
        await driver.findElement(By.css('[data-studio-target="stage-selector"]')).click();
        await driver.wait(() => driver.executeScript('return window.vm.editingTarget.isStage;'), 10000);
        await noGhost(); await count(0);
        await beginNewScript();
        await keys(...'move');
        // The Stage cannot use Motion blocks. Its current palette is authoritative.
        expect(await driver.findElements(By.css('[role="option"][data-kind="block"]'))).toHaveLength(0);
        await keys(Key.ESCAPE);
        await helper.clickText('File');
        await helper.clickXpath('//li[span[text()="New"]]');
        await (await driver.wait(until.alertIsPresent(), 5000)).accept();
        await driver.wait(() => driver.executeScript('return !window.vm.editingTarget.isStage;'), 10000);
        await noGhost(); await count(0);
        await beginNewScript();
        await typeBlock('move 3 steps', 1);
    }, 90000);

    test('excludes end caps in the middle of a stack and accepts a separate workspace script', async () => {
        await typeBlock('move 10 steps', 1);
        await typeBlock('wait 1 seconds', 2);
        const before = (await state()).roots;
        await keys(Key.ARROW_UP, Key.ARROW_UP, Key.ENTER, ...'stop all');
        expect(await driver.findElement(By.css('[role="option"][aria-selected="true"]'))
            .getAttribute('aria-disabled')).toBe('true');
        await keys(Key.ENTER);
        expect((await state()).roots).toEqual(before);
        await keys(Key.ESCAPE);
        await beginNewScript();
        await typeBlock('when flag clicked', 3);
        const after = await state();
        expect(after.roots).toHaveLength(2);
        const nonOverlap = await driver.executeScript(`const boxes=window.ScratchBlocks.getMainWorkspace()
            .getTopBlocks(false).map(b=>b.getSvgRoot().getBoundingClientRect());
            return boxes[0].right<boxes[1].left || boxes[1].right<boxes[0].left ||
                boxes[0].bottom<boxes[1].top || boxes[1].bottom<boxes[0].top;`);
        expect(nonOverlap).toBe(true);
    }, 90000);

    test('records accepted keyboard edits in Studio and replays them without recording the draft', async () => {
        const url = new URL(process.env.STUDIO_BROWSER_URL);
        url.searchParams.set('keyboard-authoring', '1');
        url.searchParams.set('studio-session', '1');
        url.searchParams.set('studio-debug', '1');
        url.searchParams.set('studio-take', `keyboard-recording-${Date.now()}`);
        await helper.loadUri(url.toString());
        const ready = cursor => driver.wait(async () => {
            const panel = await driver.findElement(By.id('tw-studio-session-panel')).getText();
            if (/restored|mismatch|reload required/.test(panel)) throw new Error(panel);
            return panel.includes(`position ${cursor}/`) && !/playing|undoing|redoing|seeking/.test(panel);
        }, 90000);
        await driver.wait(until.elementLocated(By.id('tw-studio-session-panel')), 30000);
        await ready(0);
        await driver.executeScript('window.__keyboardTestWorkspace=window.ScratchBlocks.getMainWorkspace();');
        await enableKeyboard();
        await typeBlock('when flag clicked', 1); await ready(1);
        await typeBlock('move 10 steps', 2); await ready(2);
        await typeBlock('repeat 10', 3); await ready(3);
        await typeBlock('wait 1 seconds', 4); await ready(4);
        const before = (await state()).roots;
        const journal = JSON.parse(await driver.findElement(By.id('tw-studio-journal-debug')).getAttribute('textContent'));
        expect(journal.journal.transactions).toHaveLength(4);
        expect(JSON.stringify(journal)).not.toContain('tw_keyboard_draft_statement');
        await driver.findElement(By.xpath('//button[text()="Play"]')).click();
        // The cursor is already at 4 before Play starts its asynchronous rewind.
        // Waiting for that cursor alone can click Undo while playback is busy.
        await driver.wait(async () => (await driver.findElement(By.id('tw-studio-session-panel')).getText())
            .includes('played · 4 steps'), 90000);
        await ready(4);
        expect((await state()).roots).toEqual(before);
        await noGhost();
        await driver.findElement(By.id('tw-studio-previous')).click();
        await ready(3); await count(3);
        await driver.findElement(By.id('tw-studio-next')).click();
        await ready(4); await count(4);
        expect((await state()).roots).toEqual(before);
        await noGhost();
    }, 180000);

    test('records a keyboard block move as one Studio transaction with reversible Play history', async () => {
        const url = new URL(process.env.STUDIO_BROWSER_URL);
        url.searchParams.set('keyboard-authoring', '1');
        url.searchParams.set('studio-session', '1');
        url.searchParams.set('studio-debug', '1');
        url.searchParams.set('studio-take', `keyboard-range-move-${Date.now()}`);
        await helper.loadUri(url.toString());
        const ready = cursor => driver.wait(async () => {
            const panel = await driver.findElement(By.id('tw-studio-session-panel')).getText();
            if (/restored|mismatch|reload required/.test(panel)) throw new Error(panel);
            return panel.includes(`position ${cursor}/`) && !/playing|undoing|redoing|seeking/.test(panel);
        }, 90000);
        await driver.wait(until.elementLocated(By.id('tw-studio-session-panel')), 30000);
        await ready(0);
        await driver.executeScript('window.__keyboardTestWorkspace=window.ScratchBlocks.getMainWorkspace();');
        await enableKeyboard();
        await typeBlock('move 10 steps', 1); await ready(1);
        await typeBlock('say hello', 2); await ready(2);
        await typeBlock('wait 1 seconds', 3); await ready(3);
        const original = (await state()).roots;
        await caretAt('block', 'looks_say', '', true);
        await chord(Key.ALT, Key.ARROW_DOWN); await ready(4); await count(3); await noGhost();
        const moved = (await state()).roots;
        expect([moved[0].type, moved[0].next.type, moved[0].next.next.type])
            .toEqual(['motion_movesteps', 'control_wait', 'looks_say']);
        const journal = JSON.parse(await driver.findElement(By.id('tw-studio-journal-debug')).getAttribute('textContent'));
        expect(journal.journal.transactions).toHaveLength(4);
        expect(journal.journal.transactions[3].events.some(event =>
            event.interactionSource && event.interactionSource.kind === 'keyboard-authoring')).toBe(true);
        await driver.findElement(By.id('tw-studio-previous')).click();
        await ready(3); expect((await state()).roots).toEqual(original);
        await driver.findElement(By.id('tw-studio-next')).click();
        await ready(4); expect((await state()).roots).toEqual(moved);
        await driver.findElement(By.xpath('//button[text()="Play"]')).click();
        await driver.wait(async () => {
            const panel = await driver.findElement(By.id('tw-studio-session-panel')).getText();
            if (/restored|mismatch|reload required/.test(panel)) throw new Error(panel);
            return panel.includes('played · 4 steps');
        }, 90000);
        await ready(4); expect((await state()).roots).toEqual(moved);
        await noGhost();
    }, 180000);

    test.each([false,true])('records explicit variable creation and use as a Studio transaction with Play and history (command: %s)', async command=>{
        const url=new URL(process.env.STUDIO_BROWSER_URL);
        url.searchParams.set('keyboard-authoring','1'); url.searchParams.set('studio-session','1');
        url.searchParams.set('studio-debug','1'); url.searchParams.set('studio-take',`keyboard-variable-${Date.now()}`);
        await helper.loadUri(url.toString());
        await driver.wait(until.elementLocated(By.id('tw-studio-session-panel')),30000);
        const ready=position=>driver.wait(async()=>{
            const panel=await driver.findElement(By.id('tw-studio-session-panel')).getText();
            if(/restored|mismatch|reload required/.test(panel)) throw Error(panel);
            return panel.includes(`position ${position}/`) && !/playing|undoing|redoing|seeking/.test(panel);
        },90000);
        await ready(0);
        await driver.executeScript('window.__keyboardTestWorkspace=window.ScratchBlocks.getMainWorkspace();');
        await enableKeyboard();
        await acceptBlock('say hello',1); await ready(1);
        if(command) await keys(Key.END);
        await keys(...(command?'set cake to 5':'cake'));
        await chooseVariable(command?'create-variable-command':'create-variable','local');
        await count(2); await ready(2); await expectVariable('cake','local');
        const before=(await state()).roots;
        const journal=JSON.parse(await driver.findElement(By.id('tw-studio-journal-debug')).getAttribute('textContent'));
        expect(journal.journal.transactions).toHaveLength(2);
        expect(journal.journal.transactions.every(t=>t.events.some(e=>e.interactionSource?.kind==='keyboard-authoring')))
            .toBe(true);
        expect(JSON.stringify(journal)).not.toContain('tw_keyboard_draft_statement');
        await driver.findElement(By.id('tw-studio-previous')).click();
        await ready(1); await count(1); await expectVariable('cake','local',false);
        await driver.findElement(By.id('tw-studio-next')).click();
        await ready(2); await count(2); await expectVariable('cake','local');
        await driver.findElement(By.xpath('//button[text()="Play"]')).click();
        await driver.wait(async()=>{
            const panel=await driver.findElement(By.id('tw-studio-session-panel')).getText();
            if(/restored|mismatch|reload required/.test(panel)) throw Error(panel);
            return panel.includes('played · 2 steps');
        },90000);
        await ready(2); await count(2); await expectVariable('cake','local');
        expect((await state()).roots).toEqual(before);
        await noGhost();
    },180000);

    test('navigates both if/else branches and fills an initially empty Boolean hole', async () => {
        await acceptBlock('if then else', 1);
        expect((await state()).roots[0].type).toBe('control_if_else');
        expect((await state()).caret).toContain(':CONDITION:');
        await keys(Key.ARROW_DOWN);
        expect((await state()).caret).toContain(':SUBSTACK:');
        await keys(Key.ARROW_DOWN);
        expect((await state()).caret).toContain(':SUBSTACK2:');
        await typeBlock('say no', 2);
        await keys(Key.ARROW_UP); await expectCaret('block','looks_say');
        await keys(Key.ARROW_UP);
        expect((await state()).caret).toContain(':SUBSTACK:');
        await typeBlock('say yes', 3);
        await keys(Key.HOME);
        // Return to the outer condition using actual structural navigation.
        await keys(Key.ARROW_UP, Key.HOME);
        await caretAt('input', 'control_if_else', 'CONDITION');
        await typeBlock('1 < 2', 4);
        const before = (await state()).roots;
        expect(before[0].inputs.CONDITION.type).toBe('operator_lt');
        expect(before[0].inputs.SUBSTACK.inputs.MESSAGE.fields.TEXT).toBe('yes');
        expect(before[0].inputs.SUBSTACK2.inputs.MESSAGE.fields.TEXT).toBe('no');
        await nativeHistory(false); await count(3);
        expect((await state()).roots[0].inputs.CONDITION).toBeUndefined();
        await nativeHistory(true); await count(4);
        expect((await state()).roots).toEqual(before);
    }, 90000);

    test('keeps a native define ghost through incomplete arguments without creating live blocks', async () => {
        await beginNewScript();
        await keys(...'define Test');
        const snapshot = () => driver.executeScript(`const ws=window.__keyboardTestWorkspace;
            const copy=Object.values(window.ScratchBlocks.Workspace.WorkspaceDB_).find(w=>w.options.readOnly&&
                w.getAllBlocks(false).some(b=>b.type==='procedures_definition'));
            const definition=copy?.getAllBlocks(false).find(b=>b.type==='procedures_definition');
            const prototype=definition?.getInputTargetBlock('custom_block');
            return {code:prototype?.getProcCode(),names:prototype?.displayNames_,
                live:ws.getAllBlocks(false).filter(b=>!b.isShadow()).length,undo:ws.undoStack_.length};`);
        const before = await snapshot();
        await keys(' ');
        for (const char of '(th') {
            await keys(char);
            expect(await snapshot()).toMatchObject({code:'Test %s',live:0,undo:before.undo});
        }
        expect((await snapshot()).names).toEqual(['th']);
        await keys(Key.ARROW_DOWN,Key.ENTER);
        expect(await snapshot()).toMatchObject({code:'Test %s',names:['th'],live:0,undo:before.undo});
        await keys(...'ing) if <re');
        expect(await snapshot()).toMatchObject({code:'Test %s if %b',names:['thing','re'],live:0});
        await keys(...'ady>',Key.ARROW_DOWN,Key.ENTER); await count(1);
        await nativeHistory(false); await count(0);
        await nativeHistory(true); await count(1);
        await beginNewScript();
        await keys(...'define Other (');
        expect((await snapshot()).code).toBe('Other %s');
        await keys(Key.ESCAPE); await noGhost(); await count(1);
    },90000);

    test.each(['+23','+ 23'])(
        'typing %s extends a structurally selected number and preserves native history', async suffix => {
            await typeBlock('move 23 steps',1);
            await keys(Key.HOME,Key.ARROW_RIGHT); await expectCaret('input','motion_movesteps','STEPS');
            await keys(suffix[0]);
            const draftInput = await driver.findElement(By.css('[aria-label="Type a Scratch block"]'));
            expect(await draftInput.getAttribute('value')).toBe(`23 ${suffix[0]}`);
            expect(await driver.executeScript('return [arguments[0].selectionStart,arguments[0].selectionEnd];',draftInput))
                .toEqual([4,4]);
            await keys(...suffix.slice(1),Key.ENTER); await count(2);
            const after = (await state()).roots;
            expect(after[0].inputs.STEPS).toMatchObject({
                type:'operator_add',
                inputs:{NUM1:{fields:{NUM:'23'}},NUM2:{fields:{NUM:'23'}}}
            });
            await nativeHistory(false); await count(1);
            expect((await state()).roots[0].inputs.STEPS.fields.NUM).toBe('23');
            await nativeHistory(true); await count(2);
            expect((await state()).roots).toEqual(after);
        },90000);

    test('typing -10 replaces a selected numeric literal without entering a special input mode', async () => {
        await typeBlock('move 23 steps',1);
        await keys(Key.HOME,Key.ARROW_RIGHT); await expectCaret('input','motion_movesteps','STEPS');
        await keys('-');
        const input = await driver.findElement(By.css('[aria-label="Type a Scratch block"]'));
        expect(await input.getAttribute('value')).toBe('-');
        expect(await driver.executeScript(`return [...document.querySelectorAll('[role="option"]')]
            .map(option=>({kind:option.dataset.kind,selected:option.getAttribute('aria-selected')}));`))
            .toEqual(expect.arrayContaining([
                expect.objectContaining({kind:'block',selected:'true'}),
                expect.objectContaining({kind:'value'})
            ]));
        expect((await state()).help).not.toMatch(/negative value/i);
        await keys('1','0');
        expect(await input.getAttribute('value')).toBe('-10');
        expect(await driver.findElement(By.css('[role="option"][aria-selected="true"]')).getAttribute('data-kind'))
            .toBe('value');
        await keys(Key.ENTER); await count(1);
        expect((await state()).roots[0].inputs.STEPS.fields.NUM).toBe('-10');
        await nativeHistory(false); await count(1);
        expect((await state()).roots[0].inputs.STEPS.fields.NUM).toBe('23');
        await nativeHistory(true); await count(1);
        expect((await state()).roots[0].inputs.STEPS.fields.NUM).toBe('-10');
    },90000);

    test('typing -10 also replaces a selected text literal through ordinary completion', async () => {
        await typeBlock('say hello',1);
        await keys(Key.HOME,Key.ARROW_RIGHT); await expectCaret('input','looks_say','MESSAGE');
        await keys(...'-10',Key.ENTER); await count(1);
        expect((await state()).roots[0].inputs.MESSAGE.fields.TEXT).toBe('-10');
        await nativeHistory(false); await count(1);
        expect((await state()).roots[0].inputs.MESSAGE.fields.TEXT).toBe('hello');
        await nativeHistory(true); await count(1);
        expect((await state()).roots[0].inputs.MESSAGE.fields.TEXT).toBe('-10');
    },90000);

    test('typing spaced minus extends the selected numeric literal instead of replacing it', async () => {
        await typeBlock('move 23 steps',1);
        await keys(Key.HOME,Key.ARROW_RIGHT); await expectCaret('input','motion_movesteps','STEPS');
        await keys(...'- 10');
        const input = await driver.findElement(By.css('[aria-label="Type a Scratch block"]'));
        expect(await input.getAttribute('value')).toBe('- 10');
        expect(await driver.findElement(By.css('[role="option"][aria-selected="true"]')).getText())
            .toMatch(/23\s*-\s*10/);
        await keys(Key.ENTER); await count(2);
        expect((await state()).roots[0].inputs.STEPS).toMatchObject({
            type:'operator_subtract',
            inputs:{NUM1:{fields:{NUM:'23'}},NUM2:{fields:{NUM:'10'}}}
        });
        await nativeHistory(false); await count(1);
        expect((await state()).roots[0].inputs.STEPS.fields.NUM).toBe('23');
        await nativeHistory(true); await count(2);
        expect((await state()).roots[0].inputs.STEPS.type).toBe('operator_subtract');
    },90000);

    test('typing -10 on a selected reporter wraps it as reporter minus 10', async () => {
        await typeBlock('move my variable steps',2);
        await caretAt('block','data_variable','',true);
        const sourceId = await driver.executeScript(`return window.__keyboardTestWorkspace.getAllBlocks(false)
            .find(block=>block.type==='data_variable').id;`);
        await keys(...'-10');
        const input = await driver.findElement(By.css('[aria-label="Type a Scratch block"]'));
        expect(await input.getAttribute('value')).toBe('-10');
        const option = await driver.wait(until.elementLocated(
            By.css('[role="option"][data-kind="expression-wrap"][aria-selected="true"]')),10000);
        expect(await option.getText()).toMatch(/wrap with - 10/i);
        await keys(Key.ENTER); await count(3);
        const expression = (await state()).roots[0].inputs.STEPS;
        expect(expression).toMatchObject({
            type:'operator_subtract',
            inputs:{NUM1:{type:'data_variable'},NUM2:{fields:{NUM:'10'}}}
        });
        expect(await driver.executeScript(`return !!window.__keyboardTestWorkspace.getBlockById(arguments[0]);`,
            sourceId)).toBe(true);
        await nativeHistory(false); await count(2);
        expect((await state()).roots[0].inputs.STEPS.type).toBe('data_variable');
        await nativeHistory(true); await count(3);
        expect((await state()).roots[0].inputs.STEPS.type).toBe('operator_subtract');
    },90000);

    test('native field text selection can still replace a number with a signed value', async () => {
        await typeBlock('move 23 steps',1);
        await keys(Key.HOME,Key.ARROW_RIGHT,Key.F2);
        const field = await driver.wait(until.elementLocated(By.css('input.blocklyHtmlInput')),10000);
        await field.sendKeys(Key.chord(Key.CONTROL,'a'),'-23',Key.ENTER);
        await painted(); await count(1);
        expect((await state()).roots[0].inputs.STEPS.fields.NUM).toBe('-23');
    },90000);

    test('extends a numeric text slot inside a condition and keeps draft text undo local', async () => {
        await typeBlock('if 23 > 50 then',2);
        await caretAt('input','operator_gt','OPERAND1',true);
        await keys('+');
        const input = await driver.findElement(By.css('[aria-label="Type a Scratch block"]'));
        expect(await input.getAttribute('value')).toBe('23 +');
        await chord(Key.CONTROL,'z');
        expect(await input.getAttribute('value')).toBe('23 ');
        await count(2);
        await keys('+','4',Key.ENTER); await count(3);
        expect((await state()).roots[0].inputs.CONDITION.inputs.OPERAND1).toMatchObject({
            type:'operator_add',inputs:{NUM1:{fields:{NUM:'23'}},NUM2:{fields:{NUM:'4'}}}
        });
        await nativeHistory(false); await count(2);
        expect((await state()).roots[0].inputs.CONDITION.inputs.OPERAND1.fields.TEXT).toBe('23');
    },90000);

    test('Tab completes wa to wait and a unique wa 4 abbreviation retains its argument', async () => {
        await beginNewScript();
        await keys('w','a',Key.TAB);
        const input = await driver.findElement(By.css('[aria-label="Type a Scratch block"]'));
        expect((await input.getAttribute('value')).trim()).toBe('wait');
        await keys(Key.ESCAPE);
        await beginNewScript();
        await keys(...'wa 4',Key.TAB);
        expect(await input.getAttribute('value')).toMatch(/^wait 4(?: seconds)?\s*$/);
        await keys(Key.ENTER); await count(1);
        expect((await state()).roots[0]).toMatchObject({type:'control_wait',inputs:{DURATION:{fields:{NUM:'4'}}}});
        await nativeHistory(false); await count(0);
        await nativeHistory(true); await count(1);
    },90000);

    test.each(['light','dark'])('Find Bar search and instance panels follow the %s editor theme', async theme => {
        const settings = await driver.findElement(By.xpath('//span[text()="Settings"]'));
        await settings.click();
        const toggle = await driver.findElements(By.xpath(`//span[text()="Switch To ${theme==='dark'?'Dark':'Light'} Mode"]`));
        if (toggle.length) await toggle[0].click();
        else await settings.click();
        await painted();
        await driver.executeScript('window.__keyboardTestWorkspace=window.ScratchBlocks.getMainWorkspace();');
        await beginNewScript();
        await typeBlock('when flag clicked',1);
        await keys(Key.HOME); await chord(Key.CONTROL,Key.ENTER);
        const countLabel = await driver.wait(until.elementLocated(By.css('.sa-find-carousel-count')),10000);
        await countLabel.click();
        const panel = await driver.wait(until.elementLocated(By.css('.sa-find-info-panel')),10000);
        await driver.wait(() => driver.executeScript(`return document.querySelector('.sa-find-nav-controls')
            .getAnimations().every(animation=>animation.playState!=='running');`),5000);
        const colors = await driver.executeScript(`const panel=arguments[0],style=getComputedStyle(panel);
            return {background:style.backgroundColor,text:style.color,
                heading:getComputedStyle(panel.querySelector('.sa-find-info-instances-table thead th')).backgroundColor,
                carouselBackground:getComputedStyle(document.querySelector('.sa-find-carousel')).backgroundColor,
                carouselText:getComputedStyle(document.querySelector('.sa-find-carousel')).color,
                label:getComputedStyle(document.querySelector('.sa-find-selected-label')).color};`,panel);
        const channels = color => color.match(/[\d.]+/g).slice(0,3).map(Number);
        const luminance = color => channels(color).map(n => n/255).map(n => n<=.04045?n/12.92:((n+.055)/1.055)**2.4)
            .reduce((sum,n,i)=>sum+n*[.2126,.7152,.0722][i],0);
        const background = luminance(colors.background), foreground = luminance(colors.text);
        expect((Math.max(background,foreground)+.05)/(Math.min(background,foreground)+.05)).toBeGreaterThan(4.5);
        expect(channels(colors.background).every(n=>theme==='dark'?n<120:n>180)).toBe(true);
        expect(colors.heading).toBe(colors.background);
        expect(colors.label).toBe(colors.text);
        const carouselBackground = luminance(colors.carouselBackground), carouselText = luminance(colors.carouselText);
        expect((Math.max(carouselBackground,carouselText)+.05)/(Math.min(carouselBackground,carouselText)+.05))
            .toBeGreaterThan(4.5);
        await screenshot(`find-bar-${theme}-instances`);
        await countLabel.click();
        await driver.findElement(By.css('.sa-find-clear-btn')).click();
        const finder = await driver.findElement(By.css('.sa-find-input'));
        const restingBorder = await finder.getCssValue('border-color');
        expect(await finder.getCssValue('border-style')).toBe('solid');
        expect(await finder.getCssValue('border-width')).toBe('1px');
        expect(channels(restingBorder)).not.toEqual(channels(await finder.getCssValue('background-color')));
        await finder.sendKeys('flag');
        await driver.wait(async () => await finder.getCssValue('border-color') !== restingBorder, 3000);
        expect(await driver.executeScript('return document.activeElement===arguments[0];',finder)).toBe(true);
        const dropdown = await driver.wait(until.elementLocated(By.css('.sa-find-dropdown-out.visible')),10000);
        expect(channels(await dropdown.getCssValue('background-color'))).toEqual(channels(colors.background));
        await screenshot(`find-bar-${theme}-search`);
    },90000);

    test('defines a native custom block from text and starts authoring its body', async()=>{
        await beginNewScript();
        await keys(...'define jump (height) if <ready?>');
        const option='[role="option"][data-kind="create-procedure"]';
        await driver.wait(until.elementLocated(By.css(option)),10000);
        expect(await driver.findElements(By.css(option))).toHaveLength(2);
        expect(await driver.findElement(By.css(`${option}[aria-selected="true"]`)).getAttribute('data-warp'))
            .toBe('false');
        const preview=await driver.executeScript(`const source=window.__keyboardTestWorkspace,
            copy=Object.values(window.ScratchBlocks.Workspace.WorkspaceDB_).find(ws=>ws.options.readOnly&&
                ws.getAllBlocks(false).some(b=>b.type==='procedures_definition')),
            definition=copy&&copy.getAllBlocks(false).find(b=>b.type==='procedures_definition'),
            prototype=definition&&definition.getInputTargetBlock('custom_block');
            return {live:source.getAllBlocks(false).filter(b=>!b.isShadow()).length,
                type:definition?.type,code:prototype?.getProcCode(),names:prototype?.displayNames_,
                arguments:prototype?.argumentIds_,defaults:prototype?.argumentDefaults_};`);
        expect(preview).toMatchObject({live:0,type:'procedures_definition',code:'jump %s if %b',
            names:['height','ready?'],defaults:['','false']});
        expect(new Set(preview.arguments).size).toBe(2);
        await keys(Key.ENTER); await count(1);
        const definition=await driver.executeScript(`const ws=window.__keyboardTestWorkspace,
            block=ws.getAllBlocks(false).find(b=>b.type==='procedures_definition'),
            prototype=block.getInputTargetBlock('custom_block'),mutation=prototype.mutationToDom();
            return {id:block.id,prototype:prototype.id,code:prototype.getProcCode(),
                names:prototype.displayNames_,arguments:prototype.argumentIds_,defaults:prototype.argumentDefaults_,
                mutation:{ids:mutation.getAttribute('argumentids'),names:mutation.getAttribute('argumentnames'),
                    defaults:mutation.getAttribute('argumentdefaults'),warp:mutation.getAttribute('warp')},
                caret:document.querySelector('[data-position]').dataset.position};`);
        expect(definition).toMatchObject({code:'jump %s if %b',names:['height','ready?'],defaults:['','false'],
            mutation:{names:'["height","ready?"]',defaults:'["","false"]',warp:'false'},
            caret:`gap:${definition.id}::`});
        expect(JSON.parse(definition.mutation.ids)).toEqual(definition.arguments);
        expect(new Set(definition.arguments).size).toBe(2);
        await acceptBlock('move 10 steps',2);
        expect(await driver.executeScript(`const ws=window.__keyboardTestWorkspace,
            definition=ws.getBlockById(arguments[0]);
            return definition.getNextBlock()?.type;`,definition.id)).toBe('motion_movesteps');
        await nativeHistory(false); await count(1);
        await nativeHistory(false); await count(0);
        await nativeHistory(true); await count(1);
        await nativeHistory(true); await count(2);
        expect(await driver.executeScript(`const ws=window.__keyboardTestWorkspace,
            definition=ws.getAllBlocks(false).find(b=>b.type==='procedures_definition');
            return definition.getNextBlock()?.type;`)).toBe('motion_movesteps');
    },120000);

    test.each(['standalone','inline'])(
        'custom block palette updates after %s declaration and native Undo/Redo without switching sprite', async mode => {
            await helper.clickBlocksCategory('My Blocks');
            await beginNewScript();
            if (mode === 'inline') await typeBlock('move 10 steps',1);
            const palette = () => driver.executeScript(`const ws=window.__keyboardTestWorkspace;
                return {target:window.vm.editingTarget.id,category:ws.toolbox_.getSelectedCategoryId(),
                    calls:ws.getFlyout().getWorkspace().getTopBlocks(false)
                        .filter(b=>b.type==='procedures_call').map(b=>({code:b.getProcCode(),
                            connected:b.getSvgRoot().isConnected,arguments:b.argumentIds_}))};`);
            const before = await palette();
            expect(before.calls).toEqual([]);
            await keys(...'define palette helper (amount)');
            await keys(Key.ARROW_DOWN,Key.ENTER);
            const total = mode === 'inline' ? 3 : 1;
            await count(total);
            await driver.wait(async()=>(await palette()).calls.length===1,10000,
                'The new custom block did not appear in the existing My Blocks palette');
            const created = await palette();
            expect(created).toMatchObject({target:before.target,category:before.category,
                calls:[{code:'palette helper %s',connected:true}]});
            expect(created.calls[0].arguments).toHaveLength(1);
            await nativeHistory(false); await count(mode === 'inline' ? 1 : 0);
            await driver.wait(async()=>(await palette()).calls.length===0,10000);
            expect(await palette()).toEqual(before);
            await nativeHistory(true); await count(total);
            await driver.wait(async()=>(await palette()).calls.length===1,10000);
            expect(await palette()).toEqual(created);
        },90000);

    test.each(['middle','above','end','then','else','empty mouth'])(
        'inline define inserts a native call at %s with one reversible definition', async location => {
            if (['then','else','empty mouth'].includes(location)) {
                await typeBlock('if then else',1);
                if (location !== 'empty mouth') await typeBlock('wait 1 seconds',2);
                if (location === 'else') {
                    await caretAt('gap','control_if_else','SUBSTACK2');
                    await typeBlock('say other',3);
                }
                if (location !== 'empty mouth') {
                    // Occupied mouth starts deliberately are not Tab stops.
                    // Open the insertion point above its first real command.
                    await caretAt('block',location === 'else' ? 'looks_say' : 'control_wait','',true);
                    await chord(Key.SHIFT,Key.ENTER);
                }
            } else {
                await typeBlock('move 10 steps',1);
                await typeBlock('wait 1 seconds',2);
                if (location === 'middle') {
                    await caretAt('block','motion_movesteps','',true); await keys(Key.ENTER);
                }
                if (location === 'above') {
                    await caretAt('block','motion_movesteps','',true);
                    await chord(Key.SHIFT,Key.ENTER);
                }
            }
            const before = await state();
            const originals = await driver.executeScript(`return window.__keyboardTestWorkspace.getAllBlocks(false)
                .filter(b=>!b.isShadow()).map(b=>b.id);`);
            await keys(...'define helper');
            const option = '[role="option"][data-kind="create-procedure"]';
            await driver.wait(until.elementLocated(By.css(option)),10000);
            expect(await driver.findElement(By.css(option)).getText()).toContain('Also creates a definition');
            const preview = await driver.executeScript(`const source=window.__keyboardTestWorkspace;
                const copy=Object.values(window.ScratchBlocks.Workspace.WorkspaceDB_).find(ws=>ws.options.readOnly&&
                    ws.options.parentWorkspace===source);
                return copy.getAllBlocks(false).filter(b=>!source.getBlockById(b.id)).map(b=>b.type);`);
            expect(preview).toEqual(['procedures_call']);
            expect((await state()).roots).toEqual(before.roots);
            await keys(Key.ARROW_DOWN,Key.ENTER);
            await count(before.count+2); await noGhost();
            const after = await state();
            const graph = await driver.executeScript(`const ws=window.__keyboardTestWorkspace,
                call=ws.getAllBlocks(false).find(b=>b.type==='procedures_call'),
                def=ws.getAllBlocks(false).find(b=>b.type==='procedures_definition'),
                a=call.getRootBlock().getBoundingRectangle(),b=def.getBoundingRectangle();
                return {call:call.id,def:def.id,parent:call.getParent()?.type||null,next:call.getNextBlock()?.type||null,
                    body:call.getParent()?.inputList.find(i=>i.connection?.targetBlock()===call)?.name||null,
                    overlaps:a.topLeft.x<b.bottomRight.x&&a.bottomRight.x>b.topLeft.x&&
                        a.topLeft.y<b.bottomRight.y&&a.bottomRight.y>b.topLeft.y,
                    originalIds:arguments[0].every(id=>!!ws.getBlockById(id)),
                    groups:[...new Set(ws.undoStack_.filter(e=>e.blockId===call.id||e.blockId===def.id).map(e=>e.group))]};`,
            originals);
            expect(graph).toMatchObject({overlaps:false,originalIds:true});
            expect(graph.groups).toHaveLength(1);
            expect(graph.groups[0]).toBeTruthy();
            expect(after.caret).toBe(`gap:${graph.call}::`);
            if (location === 'middle') expect(graph).toMatchObject({parent:'motion_movesteps',next:'control_wait'});
            if (location === 'above') expect(graph).toMatchObject({parent:null,next:'motion_movesteps'});
            if (location === 'end') expect(graph).toMatchObject({parent:'control_wait',next:null});
            if (location === 'then') expect(graph).toMatchObject({body:'SUBSTACK',next:'control_wait'});
            if (location === 'else') expect(graph).toMatchObject({body:'SUBSTACK2',next:'looks_say'});
            if (location === 'empty mouth') expect(graph).toMatchObject({body:'SUBSTACK',next:null});
            for (let i=0;i<2;i++) {
                await nativeHistory(false); await count(before.count); await waitForRoots(before.roots);
                await nativeHistory(true); await count(after.count); await waitForRoots(after.roots);
                await noGhost();
            }
        },120000);

    test('inline define shares native argument identities, focuses inputs and jumps to its definition', async () => {
        await typeBlock('move 10 steps',1); await typeBlock('wait 1 seconds',2);
        await caretAt('block','motion_movesteps','',true); await keys(Key.ENTER);
        const before = (await state()).roots;
        await keys(...'define helper (amount) if <ready>');
        await keys(Key.ARROW_DOWN,Key.ENTER); await count(4);
        const identity = () => driver.executeScript(`const ws=window.__keyboardTestWorkspace,
            call=ws.getAllBlocks(false).find(b=>b.type==='procedures_call'),
            def=ws.getAllBlocks(false).find(b=>b.type==='procedures_definition'),
            proto=def.getInputTargetBlock('custom_block');
            return {call:call.id,definition:def.id,callIds:call.argumentIds_,definitionIds:proto.argumentIds_,
                code:call.getProcCode(),names:proto.displayNames_,
                inputTypes:call.inputList.filter(i=>i.connection).map(i=>i.connection.targetBlock()?.type||null)};`);
        const created = await identity();
        expect(created).toMatchObject({code:'helper %s if %b',names:['amount','ready'],inputTypes:['text',null]});
        expect(created.callIds).toEqual(created.definitionIds);
        expect((await state()).caret).toBe(`input:${created.call}:${created.callIds[0]}:`);
        await keys('7',Key.ENTER);
        expect((await state()).roots.find(b=>b.type==='motion_movesteps').next.inputs[created.callIds[0]].fields.TEXT)
            .toBe('7');
        await nativeHistory(false); await count(4);
        await nativeHistory(false); await count(2); await waitForRoots(before);
        await nativeHistory(true); await count(4);
        expect(await identity()).toEqual(created);
        // The restored middle caret reserves visible space. Navigate to the
        // call rather than clicking its hidden authoritative SVG coordinates.
        await keys(Key.ARROW_DOWN); await expectCaret('block','procedures_call');
        await chord(Key.CONTROL,Key.ENTER);
        await driver.wait(async () => (await state()).caret===`block:${created.definition}::`,10000);
        await noGhost();
    },120000);

    test('inline define reuses an existing signature and cancellation never creates a definition', async () => {
        await typeBlock('move 10 steps',1);
        await keys(...'define helper (amount)',Key.ARROW_DOWN,Key.ENTER); await count(3);
        const signature = await driver.executeScript(`const ws=window.__keyboardTestWorkspace,
            def=ws.getAllBlocks(false).find(b=>b.type==='procedures_definition');
            return {id:def.id,arguments:def.getInputTargetBlock('custom_block').argumentIds_};`);
        await caretAt('gap','procedures_call');
        const before = (await state()).roots;
        await keys(...'define helper (different label)');
        expect(await driver.findElement(By.css('[role="option"][data-kind="create-procedure"]')).getText())
            .toContain('Use existing custom block');
        await keys(Key.ARROW_DOWN,Key.ENTER); await count(4);
        const read = () => driver.executeScript(`const ws=window.__keyboardTestWorkspace;
            return {definitions:ws.getAllBlocks(false).filter(b=>b.type==='procedures_definition').map(b=>b.id),
                calls:ws.getAllBlocks(false).filter(b=>b.type==='procedures_call').map(b=>b.argumentIds_)};`);
        expect(await read()).toEqual({definitions:[signature.id],calls:[signature.arguments,signature.arguments]});
        await nativeHistory(false); await count(3); await waitForRoots(before);
        await nativeHistory(true); await count(4);
        await keys(Key.END,...'define abandoned (na');
        await keys(Key.ARROW_DOWN,Key.ENTER); await count(4);
        expect(await driver.findElements(By.css('input[role="combobox"]'))).toHaveLength(1);
        await keys(Key.ESCAPE); await noGhost();
        expect((await read()).definitions).toEqual([signature.id]);
        await nativeHistory(false); await count(3); await waitForRoots(before);
    },120000);

    test.each(['suffix','suggestion','completed suggestion'])('typed definitions enable run without screen refresh using %s', async mode => {
        await typeBlock('move 10 steps',1);
        await keys(...`define quick (amount)${mode==='suffix'?' :: warp':''}`);
        const options='[role="option"][data-kind="create-procedure"]';
        expect(await driver.findElements(By.css(options))).toHaveLength(2);
        if(mode!=='suffix') await keys(Key.ARROW_DOWN);
        expect(await driver.findElement(By.css(`${options}[aria-selected="true"]`)).getAttribute('data-warp'))
            .toBe('true');
        if(mode==='completed suggestion') {
            await keys(Key.TAB);
            expect(await driver.findElement(By.css('input[role="combobox"]')).getAttribute('value'))
                .toBe('define quick (amount) :: warp');
        }
        await keys(Key.ENTER); await count(3);
        const warpState=()=>driver.executeScript(`const ws=window.__keyboardTestWorkspace,
            definition=ws.getAllBlocks(false).find(b=>b.type==='procedures_definition'),
            call=ws.getAllBlocks(false).find(b=>b.type==='procedures_call');
            return {definition:definition.getInputTargetBlock('custom_block').warp_,call:call.warp_,
                code:call.getProcCode(),vm:window.vm.editingTarget.blocks._blocks[call.id].mutation.warp};`);
        expect(await warpState()).toEqual({definition:true,call:true,code:'quick %s',vm:'true'});
        await nativeHistory(false); await count(1);
        await nativeHistory(true); await count(3);
        expect(await warpState()).toEqual({definition:true,call:true,code:'quick %s',vm:'true'});
    },90000);

    test('normal suggestion overrides a typed warp modifier and remains the default for the next declaration', async () => {
        await beginNewScript();
        await keys(...'define normal :: warp');
        await keys(Key.ARROW_DOWN,Key.TAB);
        expect(await driver.findElement(By.css('input[role="combobox"]')).getAttribute('value')).toBe('define normal');
        await keys(Key.ENTER); await count(1);
        expect(await driver.executeScript(`return window.__keyboardTestWorkspace.getTopBlocks(false)[0]
            .getInputTargetBlock('custom_block').warp_;`)).toBe(false);
        await keys(...'define next');
        expect(await driver.findElement(By.css('[role="option"][aria-selected="true"]')).getAttribute('data-warp'))
            .toBe('false');
        await keys(Key.ENTER); await count(3); await noGhost();
        expect(await driver.executeScript(`return window.__keyboardTestWorkspace.getAllBlocks(false)
            .filter(b=>b.type==='procedures_definition')
            .map(b=>b.getInputTargetBlock('custom_block').warp_);`)).toEqual([false,false]);
    },90000);

    const spacingFixture = async () => {
        await typeBlock('move 10 steps',1);
        await beginNewScript();
        await typeBlock('say below',2);
        await beginNewScript();
        await typeBlock('wait 1 seconds',3);
        const ids=await driver.executeScript(`const ws=window.__keyboardTestWorkspace,
            top=ws.getAllBlocks(false).find(b=>b.type==='motion_movesteps'),
            below=ws.getAllBlocks(false).find(b=>b.type==='looks_say'),
            side=ws.getAllBlocks(false).find(b=>b.type==='control_wait');
            const place=(b,x,y)=>{const xy=b.getRelativeToSurfaceXY();b.moveBy(x-xy.x,y-xy.y);};
            place(top,100,100);place(below,100,100+top.getHeightWidth().height+50);place(side,550,100);
            return {top:top.id,below:below.id,side:side.id};`);
        await painted();
        await driver.executeScript('window.__keyboardTestWorkspace.clearUndo();');
        return ids;
    };
    const spacingState = ids => driver.executeScript(`const ws=window.__keyboardTestWorkspace;
        return Object.fromEntries(Object.entries(arguments[0]).map(([name,id])=>{
            const block=ws.getBlockById(id),xy=block.getRelativeToSurfaceXY(),size=block.getHeightWidth();
            return [name,{x:xy.x,y:xy.y,height:size.height}];}));`,ids);

    test('live tidy makes room for keyboard C-mouth growth and restores every stack with one Undo', async () => {
        const ids=await spacingFixture();
        const path=await driver.executeScript('return window.__keyboardTestWorkspace.getBlockById(arguments[0]).svgPath_;',
            ids.top);
        await driver.actions().mouseMove(path,{x:8,y:12}).click().perform(); await painted();
        await keys(Key.END);
        const original=await spacingState(ids);
        await typeBlock('repeat 10',4);
        const afterInsert=await spacingState(ids);
        expect(afterInsert.top.y).toBe(original.top.y);
        expect(afterInsert.below.y).toBe(afterInsert.top.y+afterInsert.top.height+50);
        expect(afterInsert.below.y).toBeGreaterThan(original.below.y);
        expect(afterInsert.side).toEqual(original.side);
        await typeBlock('say in body',5);
        const grown=await spacingState(ids);
        expect(grown.below.y).toBe(grown.top.y+grown.top.height+50);
        expect(grown.side).toEqual(original.side);
        await nativeHistory(false);await count(4);expect(await spacingState(ids)).toEqual(afterInsert);
        await nativeHistory(false);await count(3);expect(await spacingState(ids)).toEqual(original);
        await nativeHistory(true);await count(4);expect(await spacingState(ids)).toEqual(afterInsert);
        await nativeHistory(true);await count(5);expect(await spacingState(ids)).toEqual(grown);
        await noGhost();
    },120000);

    test('live tidy handles a real mouse drop with the original native drag Undo group', async () => {
        const ids=await spacingFixture();
        await driver.executeScript('window.__keyboardTestWorkspace.getBlockById(arguments[0]).moveBy(0,100);',ids.below);
        await painted(); await driver.executeScript('window.__keyboardTestWorkspace.clearUndo();');
        const original=await spacingState(ids);
        await driver.findElement(By.xpath('//button[text()="Keyboard"]')).click();
        const points=await driver.executeScript(`const ws=window.__keyboardTestWorkspace,
            top=ws.getBlockById(arguments[0].top),below=ws.getBlockById(arguments[0].below),
            a=top.svgPath_.getBoundingClientRect(),b=below.svgPath_.getBoundingClientRect();
            return {start:{x:Math.round(b.left+15),y:Math.round(b.top+14)},
                end:{x:Math.round(a.left+15+28*ws.scale),y:Math.round(a.bottom+14+44*ws.scale)}};`,ids);
        await driver.actions().move(points.start).press().move(points.end).release().perform();
        await driver.executeAsyncScript(`const done=arguments[arguments.length-1];
            window.__keyboardTestWorkspace.whenBlockOperationsComplete(done);`);
        await painted();
        const placed=await spacingState(ids);
        expect(await driver.executeScript('return window.__keyboardTestWorkspace.getBlockById(arguments[0]).getNextBlock();',
            ids.top)).toBeNull();
        expect(placed.below.x).toBe(placed.top.x);
        expect(placed.below.y).toBe(placed.top.y+placed.top.height+50);
        expect(placed.side).toEqual(original.side);
        const groups=await driver.executeScript(`return [...new Set(window.__keyboardTestWorkspace.undoStack_
            .filter(e=>e.recordUndo).map(e=>e.group))];`);
        expect(groups).toHaveLength(1);
        await nativeHistory(false);expect(await spacingState(ids)).toEqual(original);
        await nativeHistory(true);expect(await spacingState(ids)).toEqual(placed);
    },120000);

    test('typing transforms the selected command while Enter still opens insertion below', async () => {
        await typeBlock('say hello', 1);
        await caretAt('block', 'looks_say', '', true);
        const original = (await state()).roots;
        const historyBefore = await driver.executeScript('return window.__keyboardTestWorkspace.undoStack_.length;');
        await keys(...'think goodbye');
        await driver.wait(until.elementLocated(By.css(
            '[role="option"][data-kind="block-transform"][aria-selected="true"]'
        )), 10000);
        expect((await state()).roots).toEqual(original);
        expect(await driver.executeScript(`return Object.values(window.ScratchBlocks.Workspace.WorkspaceDB_)
            .filter(copy=>copy.options.readOnly&&!copy.isFlyout)
            .some(copy=>copy.getAllBlocks(false).some(block=>!block.isShadow()&&block.type==='looks_think'));`)).toBe(true);
        await keys(Key.ENTER); await count(1); await noGhost();
        const transformed = (await state()).roots;
        expect(transformed[0].type).toBe('looks_think');
        expect(transformed[0].inputs.MESSAGE.fields.TEXT).toBe('goodbye');
        expect(await driver.executeScript(`const ws=window.__keyboardTestWorkspace;
            return {groups:[...new Set(ws.undoStack_.slice(arguments[0]).filter(event=>event.recordUndo)
                .map(event=>event.group))],events:ws.undoStack_.length-arguments[0]};`, historyBefore))
            .toMatchObject({groups: [expect.any(String)]});
        await nativeHistory(false); await count(1); expect((await state()).roots).toEqual(original);
        await nativeHistory(true); await count(1); expect((await state()).roots).toEqual(transformed);
        await expectCaret('block', 'looks_think');
        await keys(Key.ENTER);
        expect((await state()).focus).toBe('Type a Scratch block');
        await keys(Key.ESCAPE);
        await expectCaret('gap', 'looks_think');
    }, 90000);

    test('selected block input types rank a lossless repeat-until transform before numeric repeat', async () => {
        await typeBlock('if 1 < 2 then', 2);
        await caretAt('block', 'control_if', '', true);
        const conditionId = await driver.executeScript(`const ws=window.__keyboardTestWorkspace,
            block=ws.getAllBlocks(false).find(candidate=>candidate.type==='control_if');
            return block.getInput('CONDITION').connection.targetBlock().id;`);
        await keys(...'repeat');
        await driver.wait(until.elementLocated(By.css('[role="option"][data-kind="block-transform"]')), 10000);
        const choices = await driver.executeScript(`return [...document.querySelectorAll(
            '[role="option"][data-kind="block-transform"]')].map(option=>({
                text:option.firstChild.textContent,disabled:option.getAttribute('aria-disabled')
        }));`);
        const untilIndex = choices.findIndex(choice => /repeat until/i.test(choice.text));
        const numericIndex = choices.findIndex(choice => /to repeat$/i.test(choice.text.trim()));
        expect(untilIndex).toBeGreaterThanOrEqual(0);
        expect(numericIndex).toBeGreaterThanOrEqual(0);
        expect(untilIndex).toBeLessThan(numericIndex);
        expect(choices[untilIndex].disabled).toBe('false');
        expect(choices[numericIndex].disabled).toBe('false');
        await keys(Key.ENTER); await count(2); await noGhost();
        expect(await driver.executeScript(`const ws=window.__keyboardTestWorkspace,
            block=ws.getAllBlocks(false).find(candidate=>candidate.type==='control_repeat_until');
            return block && block.getInput('CONDITION').connection.targetBlock().id;`)).toBe(conditionId);
    }, 90000);

    test('else transforms the adjacent if and empty-else Backspace contracts it losslessly', async () => {
        await typeBlock('if 1 < 2 then', 2);
        await typeBlock('say yes', 3);
        await caretAt('gap', 'control_if');
        await typeBlock('wait 1 seconds', 4);
        await caretAt('gap', 'control_if', '', true);
        const original = (await state()).roots;
        const identities = await driver.executeScript(`const ws=window.__keyboardTestWorkspace,
            owner=ws.getAllBlocks(false).find(block=>block.type==='control_if');
            return {condition:owner.getInput('CONDITION').connection.targetBlock().id,
                body:owner.getInput('SUBSTACK').connection.targetBlock().id,
                continuation:owner.getNextBlock().id};`);
        await keys(...'else');
        await driver.wait(until.elementLocated(By.css('[role="option"][aria-selected="true"]')), 10000);
        expect((await state()).roots).toEqual(original);
        await keys(Key.ENTER); await count(4);
        const expanded = (await state()).roots;
        expect(expanded[0].type).toBe('control_if_else');
        expect(expanded[0].inputs.CONDITION).toEqual(original[0].inputs.CONDITION);
        expect(expanded[0].inputs.SUBSTACK).toEqual(original[0].inputs.SUBSTACK);
        expect(expanded[0].next).toEqual(original[0].next);
        expect(await driver.executeScript(`const ws=window.__keyboardTestWorkspace,
            owner=ws.getAllBlocks(false).find(block=>block.type==='control_if_else');
            return {condition:owner.getInput('CONDITION').connection.targetBlock().id,
                body:owner.getInput('SUBSTACK').connection.targetBlock().id,
                continuation:owner.getNextBlock().id};`)).toEqual(identities);
        await expectCaret('gap', 'control_if_else', 'SUBSTACK2');
        await keys(Key.BACK_SPACE); await count(4); await noGhost();
        expect((await state()).roots).toEqual(original);
        await nativeHistory(false); await count(4); expect((await state()).roots).toEqual(expanded);
        await nativeHistory(false); await count(4); expect((await state()).roots).toEqual(original);
        await nativeHistory(true); await count(4); expect((await state()).roots).toEqual(expanded);
        await nativeHistory(true); await count(4); expect((await state()).roots).toEqual(original);
    }, 90000);

    test('a general command transform retains a nested reporter and both stack neighbours', async () => {
        await typeBlock('move 10 steps', 1);
        await typeBlock('say x position', 3);
        await typeBlock('wait 1 seconds', 4);
        const identities = await driver.executeScript(`const ws=window.__keyboardTestWorkspace,
            source=ws.getAllBlocks(false).find(block=>block.type==='looks_say');
            return {source:source.id,reporter:source.getInput('MESSAGE').connection.targetBlock().id,
                above:source.getPreviousBlock().id,below:source.getNextBlock().id};`);
        await caretAt('block', 'looks_say', '', true);
        await keys(...'think');
        await driver.wait(until.elementLocated(By.css(
            '[role="option"][data-kind="block-transform"][aria-selected="true"]'
        )), 10000);
        await keys(Key.ENTER); await count(4); await noGhost();
        const transformed = await driver.executeScript(`const ws=window.__keyboardTestWorkspace,
            block=ws.getAllBlocks(false).find(item=>item.type==='looks_think');
            return {type:block.type,reporter:block.getInput('MESSAGE').connection.targetBlock().id,
                above:block.getPreviousBlock().id,below:block.getNextBlock().id};`);
        expect(transformed).toEqual({type: 'looks_think', reporter: identities.reporter,
            above: identities.above, below: identities.below});
        await nativeHistory(false); await count(4);
        expect(await driver.executeScript('return !!window.__keyboardTestWorkspace.getBlockById(arguments[0]);',
            identities.source)).toBe(true);
        await nativeHistory(true); await count(4);
        expect(await driver.executeScript(`const ws=window.__keyboardTestWorkspace,
            block=ws.getAllBlocks(false).find(item=>item.type==='looks_think');
            return block.getInput('MESSAGE').connection.targetBlock().id;`)).toBe(identities.reporter);
    }, 90000);

    test('Backspace refuses to remove an else branch that contains authored blocks', async () => {
        await typeBlock('if then else', 1);
        await caretAt('gap', 'control_if_else', 'SUBSTACK2');
        await typeBlock('say keep me', 2);
        await caretAt('block', 'control_if_else', '', true);
        const before = (await state()).roots;
        const historyBefore = await driver.executeScript('return window.__keyboardTestWorkspace.undoStack_.length;');
        await keys(Key.BACK_SPACE); await count(2);
        expect((await state()).roots).toEqual(before);
        expect(await driver.executeScript('return window.__keyboardTestWorkspace.undoStack_.length;'))
            .toBe(historyBefore);
        expect(await driver.executeScript(`return document.querySelector('[aria-live="polite"]')?.textContent ||
            [...document.querySelectorAll('[aria-live]')].map(node=>node.textContent).join(' ');`))
            .toMatch(/else branch contains blocks/i);
    }, 90000);

    test('deletes selected reporters and C blocks with native healing and reversible input shadows', async () => {
        await typeBlock('move 2 + 3 steps', 2);
        const expression = (await state()).roots;
        await keys(Key.HOME);
        const operator = await driver.executeScript(`return window.__keyboardTestWorkspace.getAllBlocks(false)
            .find(block=>block.type==='operator_add').svgPath_;`);
        // Click the operator symbol, not an offset into its right operand.
        await driver.actions().mouseMove(operator).click().perform();
        await painted(); await expectCaret('block', 'operator_add');
        await keys(Key.DELETE); await count(1);
        expect((await state()).roots[0].inputs.STEPS.type).toBe('math_number');
        await nativeHistory(false); await count(2);
        expect((await state()).roots).toEqual(expression);
        await nativeHistory(true); await count(1);
        await keys(Key.HOME, Key.END);
        await typeBlock('repeat 10', 2);
        await typeBlock('wait 1 seconds', 3);
        await keys(Key.HOME, Key.ARROW_UP, Key.END);
        await typeBlock('say done', 4);
        const nested = (await state()).roots;
        await caretAt('block','control_repeat','',true);
        await expectCaret('block','control_repeat');
        await keys(Key.DELETE); await count(2);
        expect((await state()).roots[0].next.type).toBe('looks_say');
        await nativeHistory(false); await count(4);
        expect((await state()).roots).toEqual(nested);
    }, 90000);

    test('types a custom-block call with number and Boolean arguments from a real definition dialog', async () => {
        await helper.clickBlocksCategory('My Blocks');
        await helper.clickText('Make a Block', helper.scope.blocksTab);
        const replaceText = async text => {
            const field = await driver.wait(until.elementLocated(By.css('input.blocklyHtmlInput')), 10000);
            await field.sendKeys(Key.chord(Key.CONTROL, 'a'), text);
        };
        await replaceText('bake');
        await helper.clickText('number or text', helper.scope.modal);
        await replaceText('amount');
        await helper.clickText('boolean', helper.scope.modal);
        await replaceText('ready');
        await driver.findElement(By.css('[data-studio-target="custom-procedure-ok"]')).click();
        await driver.wait(() => driver.executeScript(`return window.__keyboardTestWorkspace
            .getAllBlocks(false).some(b=>b.type==='procedures_definition');`), 10000);
        // Closing the native dialog creates the workspace block synchronously,
        // but Events.fire delivers its VM create event on the next task.
        await count(1);
        const baseline = (await state()).count;
        await beginNewScript();
        expect(await driver.executeScript('return window.ScratchBlocks.getMainWorkspace()===window.__keyboardTestWorkspace;'))
            .toBe(true);
        await acceptBlock('bake 5 1 < 2', baseline + 2);
        const before = (await state()).roots;
        const call = before.find(root => root.type === 'procedures_call');
        const argumentIds = await driver.executeScript(`const block=Object.values(window.vm.editingTarget.blocks._blocks)
            .find(item=>item.opcode==='procedures_call');
            return JSON.parse(block.mutation.argumentids);`);
        // Object key iteration is not procedure argument order. The mutation's
        // IDs are the contract, including when generated IDs sort differently.
        await expectCaret('input', 'procedures_call', argumentIds[0]);
        expect(call.inputs[argumentIds[0]].type).toBe('text');
        expect(call.inputs[argumentIds[0]].fields.TEXT).toBe('5');
        expect(call.inputs[argumentIds[1]].type).toBe('operator_lt');
        await nativeHistory(false); await count(baseline);
        await nativeHistory(true); await count(baseline + 2);
        expect((await state()).roots).toEqual(before);
    }, 90000);

    const cycleFoundResult = async (reverse = false, alias = false) => {
        const action = driver.actions();
        if (alias) action.keyDown(Key.CONTROL);
        if (reverse) action.keyDown(Key.SHIFT);
        action.sendKeys(alias ? 'g' : Key.F3);
        if (reverse) action.keyUp(Key.SHIFT);
        if (alias) action.keyUp(Key.CONTROL);
        await action.perform(); await painted();
    };

    test.each(['Enter','Escape'])('Finder %s with no chosen result preserves editing focus and leaves the project alone', async exitKey => {
        await typeBlock('move 10 steps',1);
        const before=await state();
        await cycleFoundResult(); await cycleFoundResult(true,true);
        expect((await state()).roots).toEqual(before.roots);
        expect((await state()).focus).toBe('Scratch keyboard editor');
        expect((await state()).caret).toBe(before.caret);
        const search=await driver.findElement(By.css('.sa-find-input'));
        await search.click(); await search.sendKeys('no such result xyz');
        await cycleFoundResult(); await cycleFoundResult(true,true);
        expect(await driver.executeScript('return document.activeElement===arguments[0];',search)).toBe(true);
        expect(await search.getAttribute('value')).toBe('no such result xyz');
        if (exitKey==='Escape') {
            await keys(Key.ESCAPE);
            expect(await search.getAttribute('value')).toBe('');
            expect(await driver.executeScript('return document.activeElement===arguments[0];',search)).toBe(true);
        }
        await keys(exitKey==='Enter'?Key.ENTER:Key.ESCAPE);
        await driver.wait(async()=>(await state()).focus==='Scratch keyboard editor',10000);
        expect((await state()).roots).toEqual(before.roots);
        await typeBlock('wait 1 seconds',2);
        await nativeHistory(false); await count(1); await waitForRoots(before.roots);
    },90000);

    const historyExample = async () => {
        await beginNewScript();
        await acceptBlock('define journey (amount)', 1);
        await beginNewScript();
        await acceptBlock('journey 5', 2);
        await keys(Key.HOME, Key.ARROW_RIGHT);
        const origin = await state();
        expect(origin.caret.startsWith('input:')).toBe(true);
        const ids = await driver.executeScript(`const ws=window.__keyboardTestWorkspace;
            return {call:ws.getAllBlocks(false).find(b=>b.type==='procedures_call').id,
                definition:ws.getAllBlocks(false).find(b=>b.type==='procedures_definition').id,
                undo:ws.undoStack_.length};`);
        return {...ids, origin};
    };
    const atHistoryCaret = async caret => driver.wait(async () => {
        const current = await state();
        return current.caret === caret && current.focus === 'Scratch keyboard editor';
    }, 10000, `Navigation history did not return to ${caret}`);

    test('Finder shared history returns from a definition to the exact call input with native text editing', async () => {
        const example = await historyExample();
        await chord(Key.CONTROL, Key.ENTER);
        await atHistoryCaret(`block:${example.definition}::`);
        await chord(Key.CONTROL, Key.ARROW_LEFT);
        await atHistoryCaret(example.origin.caret);
        await chord(Key.CONTROL, Key.ARROW_RIGHT);
        await atHistoryCaret(`block:${example.definition}::`);
        await chord(Key.CONTROL, Key.ARROW_LEFT);
        await atHistoryCaret(example.origin.caret);
        expect((await state()).roots).toEqual(example.origin.roots);
        expect(await driver.executeScript('return window.__keyboardTestWorkspace.undoStack_.length;')).toBe(example.undo);
        await keys(Key.F2);
        const input = await driver.wait(until.elementLocated(By.css('input.blocklyHtmlInput')), 10000);
        await input.sendKeys(Key.chord(Key.CONTROL, 'a'), '17', Key.ENTER);
        await driver.wait(async () => JSON.stringify((await state()).roots).includes('17'), 10000);
        await nativeHistory(false); await waitForRoots(example.origin.roots);
    }, 90000);

    test('Finder interrupted history return never steals focus from a newly clicked text field', async () => {
        const example = await historyExample();
        await driver.executeScript(`const block=window.__keyboardTestWorkspace.getBlockById(arguments[0]);
            block.moveBy(1200,500);`, example.definition);
        await painted();
        await chord(Key.CONTROL, Key.ENTER);
        await atHistoryCaret(`block:${example.definition}::`);
        // Separate modifier presses are part of rapid Back/Forward, not an
        // unrelated navigation that may overwrite the still-returning entry.
        await driver.actions().keyDown(Key.CONTROL).sendKeys(Key.ARROW_LEFT).keyUp(Key.CONTROL)
            .keyDown(Key.CONTROL).sendKeys(Key.ARROW_RIGHT).keyUp(Key.CONTROL).perform();
        await atHistoryCaret(`block:${example.definition}::`);
        await chord(Key.CONTROL, Key.ARROW_LEFT); await atHistoryCaret(example.origin.caret);
        await chord(Key.CONTROL, Key.ARROW_RIGHT); await atHistoryCaret(`block:${example.definition}::`);
        await driver.actions().keyDown(Key.CONTROL).sendKeys(Key.ARROW_LEFT).keyUp(Key.CONTROL).perform();
        const title = await driver.findElement(By.css('input[placeholder="Project title here"]'));
        await title.click();
        // Observe beyond the longest scroll animation: a late completion must
        // not re-focus Code after this real mouse input chose another owner.
        expect(await driver.executeAsyncScript(`const title=arguments[0],done=arguments[arguments.length-1],
            until=performance.now()+450; const frame=()=>performance.now()<until?requestAnimationFrame(frame):
                done(document.activeElement===title); frame();`, title)).toBe(true);
        expect((await state()).roots).toEqual(example.origin.roots);
    }, 90000);

    test('Finder refocusing search during full cancellation keeps the new text owner', async () => {
        const example = await historyExample();
        await driver.executeScript(`window.__keyboardTestWorkspace.getBlockById(arguments[0]).moveBy(1200,500);`,
            example.definition);
        await painted();
        const search = await driver.findElement(By.css('.sa-find-input'));
        await search.click(); await search.sendKeys('journey',Key.ARROW_DOWN);
        await driver.wait(async () => (await state()).caret===`block:${example.definition}::`,10000);
        // Start the asynchronous return, then genuinely refocus/retype before
        // it completes. Neither the history adapter nor Escape's late focus
        // event may take the new search back to the structural surface.
        await search.sendKeys(Key.ESCAPE,Key.ESCAPE);
        await search.click(); await search.sendKeys('new query');
        expect(await driver.executeAsyncScript(`const search=arguments[0],done=arguments[arguments.length-1],
            until=performance.now()+450; const frame=()=>performance.now()<until?requestAnimationFrame(frame):
                done(document.activeElement===search); frame();`,search)).toBe(true);
        expect(await search.getAttribute('value')).toBe('new query');
        expect((await state()).roots).toEqual(example.origin.roots);
    },90000);

    test.each(['Enter', 'Escape'])('Finder search %s coalesces preview locations and restores its exact origin', async exitKey => {
        const example = await historyExample();
        const search = await driver.findElement(By.css('.sa-find-input'));
        await search.click(); await search.sendKeys('journey', Key.ARROW_DOWN);
        await driver.wait(async () => (await state()).caret===`block:${example.definition}::`, 10000);
        await keys(Key.ARROW_RIGHT);
        await driver.wait(async () => (await state()).caret===`block:${example.call}::`, 10000);
        await keys(Key.ARROW_LEFT);
        await driver.wait(async () => (await state()).caret===`block:${example.definition}::`, 10000);
        if (exitKey === 'Escape') {
            await keys(Key.ESCAPE);
            expect(await search.getAttribute('value')).toBe('');
            expect(await driver.executeScript('return document.activeElement===arguments[0];',search)).toBe(true);
            await keys(Key.ESCAPE);
        } else {
            await keys(Key.ENTER);
            await atHistoryCaret(`block:${example.definition}::`);
            await chord(Key.CONTROL, Key.ARROW_LEFT);
        }
        await atHistoryCaret(example.origin.caret);
        expect((await state()).roots).toEqual(example.origin.roots);
        expect(await driver.executeScript('return window.__keyboardTestWorkspace.undoStack_.length;')).toBe(example.undo);
        if (exitKey === 'Enter') {
            await chord(Key.CONTROL, Key.ARROW_RIGHT);
            await atHistoryCaret(`block:${example.definition}::`);
        }
    }, 90000);

    test('Finder per-sprite return remembers nested input focus across Stage and Code without stealing picker focus', async () => {
        await acceptBlock('move (1 + 2) steps', 2);
        await caretAt('input', 'operator_add', 'NUM2');
        const source = await state();
        const name = await driver.executeScript('return window.vm.editingTarget.getName();');
        await driver.findElement(By.css('[data-studio-target="stage-selector"]')).click();
        await driver.wait(() => driver.executeScript('return window.vm.editingTarget.isStage;'), 10000);
        expect((await state()).focus).not.toBe('Scratch keyboard editor');
        await driver.findElement(By.css('[data-studio-target="tab-code"]')).click();
        await driver.wait(async () => (await state()).focus==='Scratch keyboard editor', 10000);
        await acceptBlock('wait 2 seconds', 1);
        await keys(Key.HOME, Key.ARROW_RIGHT);
        const stage = await state();
        await driver.findElement(By.css(`[data-studio-sprite-name="${name}"]`)).click();
        await driver.wait(async () => (await state()).caret===source.caret, 10000);
        expect((await state()).focus).not.toBe('Scratch keyboard editor');
        await driver.findElement(By.css('[data-studio-target="tab-code"]')).click();
        await atHistoryCaret(source.caret);
        await driver.findElement(By.css('[data-studio-target="tab-costumes"]')).click();
        await driver.findElement(By.css('[data-studio-target="tab-code"]')).click();
        await atHistoryCaret(source.caret);
        await driver.findElement(By.css('[data-studio-target="stage-selector"]')).click();
        await driver.findElement(By.css('[data-studio-target="tab-code"]')).click();
        await atHistoryCaret(stage.caret);
        expect((await state()).roots).toEqual(stage.roots);
        // An explicit mode-off choice, unlike a sprite/tab visit, stays off.
        await keys(Key.ESCAPE, Key.ESCAPE);
        await driver.findElement(By.css(`[data-studio-sprite-name="${name}"]`)).click();
        await driver.findElement(By.css('[data-studio-target="tab-code"]')).click();
        expect(await driver.findElement(By.css('[data-keyboard-authoring] button')).getAttribute('aria-pressed')).toBe('false');
    }, 90000);

    test.each(['Ctrl Enter', 'Ctrl click', 'ordinary search'])(
        '%s follows a custom call and carousel focus returns for F2 editing', async mode=>{
        await helper.clickBlocksCategory('My Blocks');
        await helper.clickText('Make a Block',helper.scope.blocksTab);
        const replaceText=async text=>{
            const field=await driver.wait(until.elementLocated(By.css('input.blocklyHtmlInput')),10000);
            await field.sendKeys(Key.chord(Key.CONTROL,'a'),text);
        };
        await replaceText('bake');
        await helper.clickText('number or text',helper.scope.modal);
        await replaceText('amount');
        await driver.findElement(By.css('[data-studio-target="custom-procedure-ok"]')).click();
        await driver.wait(()=>driver.executeScript(`return window.__keyboardTestWorkspace.getAllBlocks(false)
            .some(b=>b.type==='procedures_definition');`),10000);
        await count(1);
        await beginNewScript();
        await typeBlock('bake 5',2);
        await keys(Key.HOME); await expectCaret('block','procedures_call');
        const ids=await driver.executeScript(`const ws=window.__keyboardTestWorkspace;
            return ws.getAllBlocks(false).filter(b=>['procedures_definition','procedures_call'].includes(b.type))
                .map(b=>({id:b.id,type:b.type,code:b.type==='procedures_definition'?
                    b.getInputTargetBlock('custom_block').getProcCode():b.getProcCode()}));`);
        const procedureState=()=>driver.executeScript(`const ws=window.__keyboardTestWorkspace;
            return ws.getAllBlocks(false).filter(b=>['procedures_definition','procedures_call'].includes(b.type))
                .map(b=>({id:b.id,type:b.type,code:b.type==='procedures_definition'?
                    b.getInputTargetBlock('custom_block').getProcCode():b.getProcCode()}));`);
        if (mode === 'ordinary search') {
            const search = await driver.findElement(By.css('.sa-find-input'));
            await search.click();
            await search.sendKeys('bake');
            // Filtering and custom-procedure discovery can finish after the
            // keyup that changed the query on a loaded browser run. Do not send
            // ArrowDown until the intended native definition choice is visible.
            await driver.wait(async()=>{
                for (const item of await driver.findElements(By.css('.sa-find-dropdown li:not(.sa-find-heading)'))) {
                    if (await item.isDisplayed() && (await item.getText()).startsWith('bake')) return true;
                }
                return false;
            },10000,'Find Bar did not expose the bake procedure choice');
            await search.sendKeys(Key.ARROW_DOWN);
        } else if (mode === 'Ctrl click') {
            const call = ids.find(item=>item.type==='procedures_call');
            const point = await driver.executeScript(`const block=window.__keyboardTestWorkspace.getBlockById(arguments[0]),
                box=block.svgPath_.getBoundingClientRect();
                return {x:Math.round(box.left+16),y:Math.round(box.top+box.height/2)};`,call.id);
            await driver.actions().keyDown(Key.CONTROL).move({origin:'viewport',...point})
                .click().keyUp(Key.CONTROL).perform();
            await painted();
        } else await chord(Key.CONTROL,Key.ENTER);
        await driver.wait(async()=>{
            const label=await driver.findElement(By.css('.sa-find-selected-label')).getText();
            return label.startsWith('bake');
        },10000);
        expect(await driver.findElement(By.css('.sa-find-carousel-count')).getText()).toBe('1 / 2');
        await driver.wait(() => driver.executeScript(`return document.querySelector('[data-position]')?.dataset.position
            ==='block:'+arguments[0]+'::';`,ids.find(item=>item.type==='procedures_definition').id),10000);
        await expectCaret('block','procedures_definition');
        if (mode === 'ordinary search') {
            expect(await driver.executeScript('return document.activeElement.classList.contains("sa-find-input");'))
                .toBe(true);
        }
        const carouselControls=await driver.findElements(By.css('.sa-find-carousel-control'));
        await carouselControls[1].click();
        await driver.wait(() => driver.executeScript(`return document.querySelector('[data-position]')?.dataset.position
            ==='block:'+arguments[0]+'::';`,ids.find(item=>item.type==='procedures_call').id),10000);
        await expectCaret('block','procedures_call');
        expect(await driver.findElement(By.css('.sa-find-carousel-count')).getText()).toBe('2 / 2');
        expect(await procedureState()).toEqual(ids);
        const atResult = async (type, searchFocused = false) => {
            const id = ids.find(item=>item.type===type).id;
            await driver.wait(() => driver.executeScript(`return document.querySelector('[data-position]')?.dataset.position
                ==='block:'+arguments[0]+'::' && (arguments[1] ? document.activeElement.matches('.sa-find-input') :
                    document.activeElement.getAttribute('aria-label')==='Scratch keyboard editor');`,id,searchFocused),10000);
        };
        if (mode === 'ordinary search') {
            // Browsing updates the same block caret without stealing the search
            // input. Both keyboard carousel keys remain available until Enter.
            expect(await driver.executeScript('return document.activeElement.classList.contains("sa-find-input");'))
                .toBe(true);
            await keys(Key.ARROW_LEFT);
            await expectCaret('block','procedures_definition');
            await keys(Key.ARROW_RIGHT);
            await expectCaret('block','procedures_call');
            for (const alias of [false,true]) {
                await cycleFoundResult(true,alias); await atResult('procedures_definition',true);
                await cycleFoundResult(false,alias); await atResult('procedures_call',true);
            }
            await screenshot('find-bar-keyboard-carousel');
            await keys(Key.ENTER);
            await driver.wait(async()=>(await state()).focus==='Scratch keyboard editor',10000);
            expect(await procedureState()).toEqual(ids);
        }
        for (const alias of [false,true]) {
            await cycleFoundResult(true,alias); await atResult('procedures_definition');
            await cycleFoundResult(false,alias); await atResult('procedures_call');
        }
        // Cycling must neither swallow structural keys nor discard an unfinished
        // composition. Return from a canceled draft to the same accepted result.
        await keys(Key.END,...'wait');
        const draftValue=await driver.findElement(By.css('input[role="combobox"]')).getAttribute('value');
        await cycleFoundResult(); await cycleFoundResult(true,true);
        expect(await driver.findElement(By.css('input[role="combobox"]')).getAttribute('value')).toBe(draftValue);
        expect(await procedureState()).toEqual(ids);
        await keys(Key.ESCAPE,Key.HOME);
        await atResult('procedures_call');
        await keys(Key.ARROW_RIGHT,Key.F2);
        const nativeInput=await driver.wait(until.elementLocated(By.css('input.blocklyHtmlInput')),10000);
        await nativeInput.sendKeys(Key.chord(Key.CONTROL,'a'),'12');
        await cycleFoundResult(); await cycleFoundResult(true,true);
        expect(await nativeInput.getAttribute('value')).toBe('12');
        expect(await driver.executeScript('return document.activeElement===arguments[0];',nativeInput)).toBe(true);
        await keys(Key.ESCAPE);
        await driver.wait(async()=>(await state()).focus==='Scratch keyboard editor',10000);
        await keys(Key.ARROW_LEFT);
        await atResult('procedures_call');
        await keys(Key.F2);
        await helper.clickText('bake',helper.scope.modal);
        let name=await driver.wait(until.elementLocated(By.css('input.blocklyHtmlInput')),10000);
        expect(await name.getAttribute('value')).toBe('bake');
        await name.sendKeys(Key.ESCAPE);
        await driver.wait(async()=> (await driver.findElements(By.css('[data-studio-target="custom-procedure-ok"]')))
            .length===0,10000);
        await driver.wait(async()=>(await state()).focus==='Scratch keyboard editor',10000);
        expect(await procedureState()).toEqual(ids);
        expect(await driver.executeScript(`return {
            enabled:document.querySelector('[data-keyboard-authoring] button').getAttribute('aria-pressed'),
            draft:!document.querySelector('[aria-label="Type a Scratch block"]').parentElement.hidden
        };`)).toEqual({enabled:'true',draft:false});
        await keys(Key.F2);
        await helper.clickText('bake',helper.scope.modal);
        name=await driver.wait(until.elementLocated(By.css('input.blocklyHtmlInput')),10000);
        await name.sendKeys(Key.chord(Key.CONTROL,'a'),'cook');
        await driver.findElement(By.css('[data-studio-target="custom-procedure-ok"]')).click();
        await driver.wait(async()=> (await procedureState()).every(item=>item.code.startsWith('cook')),10000);
        expect((await procedureState()).map(item=>item.id).sort()).toEqual(ids.map(item=>item.id).sort());
        expect((await state()).count).toBe(2);
        // The current result collection must refresh after an actual edit,
        // retaining native IDs rather than jumping to a stale pre-rename item.
        await cycleFoundResult(true); await atResult('procedures_definition');
        await cycleFoundResult(); await atResult('procedures_call');
        expect((await procedureState()).every(item=>item.code.startsWith('cook'))).toBe(true);
        if (mode === 'ordinary search') {
            await driver.findElement(By.css('[data-keyboard-authoring] button')).click();
            const search = await driver.findElement(By.css('.sa-find-input'));
            await search.click();
            await search.sendKeys(Key.chord(Key.CONTROL, 'a'), 'cook');
            await driver.wait(async()=>{
                for (const item of await driver.findElements(By.css('.sa-find-dropdown li:not(.sa-find-heading)'))) {
                    if (await item.isDisplayed() && (await item.getText()).startsWith('cook')) return true;
                }
                return false;
            },10000,'Find Bar did not expose the renamed cook procedure choice');
            await search.sendKeys(Key.ARROW_DOWN, Key.ENTER);
            await driver.wait(() => driver.executeScript(`return !document.activeElement.matches(
                '.sa-find-input, [aria-label="Scratch keyboard editor"]');`),10000);
            expect(await driver.findElement(By.css('[data-keyboard-authoring] button')).getAttribute('aria-pressed'))
                .toBe('false');
            expect(await procedureState()).toEqual(ids.map(item=>({...item,code:item.code.replace(/^bake/,'cook')})));
        }
    },120000);

    test.each(['Ctrl Enter', 'ordinary search', 'ordinary search and immediate Enter', 'F3', 'Ctrl G'])(
        'Find Bar %s follows event usages across sprites and preserves manual sprite return', async mode => {
        await typeBlock('when flag clicked', 1);
        await typeBlock('move 10 steps', 2);
        const source = await driver.executeScript(`return {id:window.vm.editingTarget.id,
            name:window.vm.editingTarget.getName()};`);
        const chooser = await driver.findElement(By.xpath('//button[@aria-label="Choose a Sprite"]'));
        await driver.actions().move({origin: chooser}).perform();
        const paint = await driver.wait(async () => {
            for (const button of await driver.findElements(By.xpath('//button[@aria-label="Paint"]'))) {
                if (await button.isDisplayed()) return button;
            }
            return null;
        }, 5000);
        await driver.wait(() => driver.executeScript(`const button=arguments[0],box=button.getBoundingClientRect();
            const menu=button.closest('[class*="action-menu_more-buttons_"]');
            return menu && !menu.getAnimations().some(animation=>animation.playState==='running') &&
                button.contains(document.elementFromPoint(box.left+box.width/2,box.top+box.height/2));`,paint),5000,
        'Sprite Paint menu did not finish expanding to a stable click target');
        await paint.click();
        await driver.wait(() => driver.executeScript('return window.vm.editingTarget.id!==arguments[0];',source.id),10000,
            'Paint did not create and select the second sprite');
        await driver.findElement(By.xpath('//*[@role="tab" and contains(.,"Code")]')).click();
        await enableKeyboard();
        await beginNewScript();
        await typeBlock('when flag clicked', 1);
        await typeBlock('say hello', 2);
        const destinationId = await driver.executeScript('return window.vm.editingTarget.id;');
        const projectBlocks = () => driver.executeScript(`return window.vm.runtime.targets.filter(t=>t.isOriginal)
            .map(t=>({id:t.id,blocks:Object.fromEntries(Object.entries(t.blocks._blocks).map(([id,block])=>{
                // VM XML serialization intentionally writes coordinates only on
                // root blocks. A sprite reload can remove meaningless child
                // x/y="0" defaults; compare every semantic field and root XY.
                const {x,y,...rest}=block;
                return [id,block.topLevel?block:rest];
            }))}));`);
        const before = await projectBlocks();
        await keys(Key.HOME, Key.ARROW_UP);
        await expectCaret('block', 'event_whenflagclicked');
        let browsing = mode === 'ordinary search';
        if (mode.startsWith('ordinary search')) {
            const search = await driver.findElement(By.css('.sa-find-input'));
            await search.click();
            await search.sendKeys('flag', Key.ARROW_DOWN);
            if (!browsing) await keys(Key.ENTER);
        } else await chord(Key.CONTROL, Key.ENTER);
        const readyAt = async (id, opcode) => {
            await driver.wait(() => driver.executeScript(`const ws=window.__keyboardTestWorkspace;
                const at=document.querySelector('[data-position]')?.dataset.position;
                return window.vm.editingTarget.id===arguments[0] &&
                    (arguments[2] ? document.activeElement?.classList.contains('sa-find-input') :
                        document.activeElement?.getAttribute('aria-label')==='Scratch keyboard editor') &&
                    document.querySelector('[data-keyboard-authoring] button')?.getAttribute('aria-pressed')==='true' &&
                    ws.getAllBlocks(false).some(b=>b.type===arguments[1]&&at==='block:'+b.id+'::');`,id,opcode,browsing),10000,
            `Finder did not hand selection to ${opcode} on ${id} (browsing: ${browsing})`);
        };
        await readyAt(destinationId,'event_whenflagclicked');
        const keyboardCycle = mode === 'F3' || mode === 'Ctrl G';
        if (keyboardCycle) await cycleFoundResult(true,mode==='Ctrl G');
        else await driver.findElements(By.css('.sa-find-carousel-control')).then(buttons=>buttons[0].click());
        await readyAt(source.id,'event_whenflagclicked');
        if (browsing) {
            await keys(Key.ENTER);
            browsing = false;
            await readyAt(source.id,'event_whenflagclicked');
        }
        await keys(Key.ARROW_DOWN); await expectCaret('block','motion_movesteps');
        await keys(Key.ARROW_RIGHT); await expectCaret('input','motion_movesteps','STEPS');
        if (keyboardCycle) await cycleFoundResult(false,mode==='Ctrl G');
        else await driver.findElements(By.css('.sa-find-carousel-control')).then(buttons=>buttons[1].click());
        await readyAt(destinationId,'event_whenflagclicked');
        expect(await projectBlocks()).toEqual(before);
        await chord(Key.CONTROL,Key.ARROW_LEFT);
        await driver.wait(() => driver.executeScript('return window.vm.editingTarget.id===arguments[0];',source.id),10000);
        await expectVisibleCaret('input','motion_movesteps','STEPS');
        await chord(Key.CONTROL,Key.ARROW_RIGHT);
        await readyAt(destinationId,'event_whenflagclicked');
        expect(await projectBlocks()).toEqual(before);
        if (keyboardCycle) {
            const action=driver.actions();
            if(mode==='Ctrl G') action.keyDown(Key.CONTROL);
            action.keyDown(Key.SHIFT).sendKeys(mode==='Ctrl G'?'g':Key.F3).keyUp(Key.SHIFT)
                .sendKeys(mode==='Ctrl G'?'g':Key.F3);
            if(mode==='Ctrl G') action.keyUp(Key.CONTROL);
            await action.perform();
        } else {
            const controls = await driver.findElements(By.css('.sa-find-carousel-control'));
            await driver.actions().move({origin: controls[0]}).click().move({origin: controls[1]}).click().perform();
        }
        await readyAt(destinationId,'event_whenflagclicked');
        expect(await projectBlocks()).toEqual(before);
        // A deliberately interrupted carousel preview need not have selected
        // its intermediate result. Establish a completed operand visit before
        // asserting what a later manual sprite return must remember.
        await cycleFoundResult(true); await readyAt(source.id,'event_whenflagclicked');
        await keys(Key.ARROW_DOWN,Key.ARROW_RIGHT);
        await expectCaret('input','motion_movesteps','STEPS');
        await cycleFoundResult(); await readyAt(destinationId,'event_whenflagclicked');
        await keys(Key.ARROW_DOWN); await expectCaret('block','looks_say');
        await keys(Key.ENTER); await typeBlock('wait 1 seconds',3);
        await nativeHistory(false); await count(2);
        await nativeHistory(true); await count(3);
        await driver.findElement(By.css(`[data-studio-sprite-name="${source.name}"]`)).click();
        await driver.wait(() => driver.executeScript('return window.vm.editingTarget.id===arguments[0];',source.id),10000);
        expect(await driver.findElement(By.css('[data-keyboard-authoring] button')).getAttribute('aria-pressed'))
            .toBe('true');
        await expectCaret('input', 'motion_movesteps', 'STEPS');
        await driver.findElements(By.css('.sa-find-carousel-control')).then(buttons=>buttons[1].click());
        await painted();
        expect(await driver.findElement(By.css('[data-keyboard-authoring] button')).getAttribute('aria-pressed'))
            .toBe('true');
    },120000);

    test('clicking a tail displaced by a draft selects the visible block without accepting the draft', async () => {
        await typeBlock('move 10 steps', 1);
        await typeBlock('wait 1 seconds', 2);
        const before = (await state()).roots;
        const id = await driver.executeScript(`return window.ScratchBlocks.getMainWorkspace()
            .getAllBlocks(false).find(b=>b.type==='control_wait').id;`);
        await keys(Key.ARROW_UP, Key.ARROW_UP, Key.ENTER, ...'repeat 10');
        const location = await driver.executeScript(`const root=Array.from(document.querySelectorAll(
            '.blocklyTransitionWorkspace g[data-id]')).find(node=>node.getAttribute('data-id')===arguments[0]);
            const box=root.querySelector('.blocklyPath').getBoundingClientRect();
            return {x:Math.round(box.left+10),y:Math.round(box.top+14)};`, id);
        await driver.actions().move({origin:'viewport', ...location}).click().perform();
        await painted(); await noGhost();
        expect((await state()).caret).toBe(`block:${id}::`);
        expect((await state()).roots).toEqual(before);
    }, 90000);

    test('uses representative live Pen flyout templates without a second block vocabulary', async () => {
        await helper.clickXpath('//button[@title="Add Extension"]');
        await helper.clickText('Pen');
        const expectedFlyoutTypes = ['pen_clear', 'pen_penDown', 'pen_setPenColorToColor', 'pen_changePenSizeBy'];
        await driver.wait(() => driver.executeScript(`const types=new Set(window.ScratchBlocks.getMainWorkspace()
            .getFlyout().getWorkspace().getAllBlocks(false).map(block=>block.type));
            return arguments[0].every(type=>types.has(type));`, expectedFlyoutTypes), 15000);
        await beginNewScript();
        await typeBlock('pen down', 1);
        fs.writeFileSync(path.join(artifacts, 'pen-colour-descriptor.json'), JSON.stringify(
            await driver.executeScript(`const block=window.__keyboardTestWorkspace.getFlyout().getWorkspace()
                .getAllBlocks(false).find(b=>b.type==='pen_setPenColorToColor');
                const describe=b=>b.inputList.map(input=>({name:input.name,
                    fields:input.fieldRow.map(field=>({name:field.name,text:field.getText(),arg:field.argType_,class:field.className_})),
                    child:input.connection?.targetBlock()?describe(input.connection.targetBlock()):null}));
                return describe(block);`), null, 2));
        await typeBlock('set pen color to #aabbcc', 2);
        await typeBlock('erase all', 3);
        await typeBlock('change pen size by 3', 4);
        const before = (await state()).roots;
        expect(before[0].type).toBe('pen_penDown');
        expect(before[0].next.type).toBe('pen_setPenColorToColor');
        expect(before[0].next.inputs.COLOR.fields.COLOUR).toBe('#aabbcc');
        expect(before[0].next.next.type).toBe('pen_clear');
        expect(before[0].next.next.next).toMatchObject({
            type: 'pen_changePenSizeBy',
            inputs: {SIZE: {type: 'math_number', fields: {NUM: '3'}}}
        });
        await nativeHistory(false); await count(3);
        await nativeHistory(true); await count(4);
        expect((await state()).roots).toEqual(before);
    }, 90000);

    test('uses live Music templates, localized category identity and native history', async () => {
        await helper.clickXpath('//button[@title="Add Extension"]');
        await helper.clickText('Music');
        const expectedFlyoutTypes = ['music_playDrumForBeats', 'music_restForBeats',
            'music_playNoteForBeats', 'music_setInstrument', 'music_changeTempo'];
        await driver.wait(() => driver.executeScript(`const types=new Set(window.ScratchBlocks.getMainWorkspace()
            .getFlyout().getWorkspace().getAllBlocks(false).map(block=>block.type));
            return arguments[0].every(type=>types.has(type));`, expectedFlyoutTypes), 15000);

        await beginNewScript();
        await keys(...'play drum (1) snare drum for 0.25 beats');
        const selected = await driver.wait(until.elementLocated(
            By.css('[role="option"][aria-selected="true"]')
        ), 10000);
        expect(await selected.findElement(By.css('span')).getText()).toBe('Music');
        await keys(Key.ENTER); await count(1); await keys(Key.END);
        await typeBlock('rest for 0.5 beats', 2);
        await typeBlock('play note 60 for 0.25 beats', 3);
        await typeBlock('set instrument to (1) piano', 4);
        await typeBlock('change tempo by 20', 5);

        const before = (await state()).roots;
        expect(before[0].type).toBe('music_playDrumForBeats');
        expect(before[0].next.type).toBe('music_restForBeats');
        expect(before[0].next.next.type).toBe('music_playNoteForBeats');
        expect(before[0].next.next.next.type).toBe('music_setInstrument');
        expect(before[0].next.next.next.next.type).toBe('music_changeTempo');
        await nativeHistory(false); await count(4);
        await nativeHistory(true); await count(5);
        expect((await state()).roots).toEqual(before);
    }, 90000);

    test('authors localized Music menus with the live French category and native history', async () => {
        const url = new URL(process.env.STUDIO_BROWSER_URL);
        url.searchParams.set('keyboard-authoring', '1');
        url.searchParams.set('locale', 'fr');
        await helper.loadUri(url.toString());
        await driver.wait(() => driver.executeScript('return !!window.vm?.editingTarget;'), 30000);
        await driver.executeScript('window.__keyboardTestWorkspace=window.ScratchBlocks.getMainWorkspace();');
        await enableKeyboard();

        await helper.clickXpath('//button[@title="Ajouter une extension" or @aria-label="Ajouter une extension"]');
        await helper.clickText('Musique');
        const expectedFlyoutTypes = ['music_playDrumForBeats', 'music_setInstrument'];
        await driver.wait(() => driver.executeScript(`const types=new Set(window.ScratchBlocks.getMainWorkspace()
            .getFlyout().getWorkspace().getAllBlocks(false).map(block=>block.type));
            return arguments[0].every(type=>types.has(type));`, expectedFlyoutTypes), 15000);

        await beginNewScript();
        await keys(...'jouer du tambour (1) Caisse claire pendant 0.25 temps');
        const selected = await driver.wait(until.elementLocated(
            By.css('[role="option"][aria-selected="true"]')
        ), 10000);
        expect(await selected.findElement(By.css('span')).getText()).toBe('Musique');
        await keys(Key.ENTER); await count(1); await keys(Key.END);
        await typeBlock("choisir l'instrument n° (1) Piano", 2);

        const before = (await state()).roots;
        expect(before).toHaveLength(1);
        expect(before[0].type).toBe('music_playDrumForBeats');
        expect(before[0].next.type).toBe('music_setInstrument');
        await nativeHistory(false); await count(1);
        await nativeHistory(true); await count(2);
        expect((await state()).roots).toEqual(before);
    }, 90000);

    test('uses live Video Sensing hats, reporters, menus and commands', async () => {
        await helper.clickXpath('//button[@title="Add Extension"]');
        await helper.clickText('Video Sensing');
        const expectedFlyoutTypes = ['videoSensing_whenMotionGreaterThan', 'videoSensing_videoOn',
            'videoSensing_videoToggle', 'videoSensing_setVideoTransparency'];
        await driver.wait(() => driver.executeScript(`const types=new Set(window.ScratchBlocks.getMainWorkspace()
            .getFlyout().getWorkspace().getAllBlocks(false).map(block=>block.type));
            return arguments[0].every(type=>types.has(type));`, expectedFlyoutTypes), 15000);

        await beginNewScript();
        await keys(...'when video motion > 10');
        const selected = await driver.wait(until.elementLocated(
            By.css('[role="option"][aria-selected="true"]')
        ), 10000);
        expect(await selected.findElement(By.css('span')).getText()).toBe('Video Sensing');
        await keys(Key.ENTER); await count(1); await noGhost();

        await beginNewScript();
        await acceptBlock('video motion on sprite', 2);
        await beginNewScript();
        await typeBlock('turn video on', 3);
        await typeBlock('set video transparency to 50', 4);

        const before = (await state()).roots;
        expect(before.find(root => root.type === 'videoSensing_whenMotionGreaterThan')).toBeDefined();
        expect(before.find(root => root.type === 'videoSensing_videoOn')).toBeDefined();
        const commands = before.find(root => root.type === 'videoSensing_videoToggle');
        expect(commands.next.type).toBe('videoSensing_setVideoTransparency');
        await nativeHistory(false); await count(3);
        await nativeHistory(true); await count(4);
        expect((await state()).roots).toEqual(before);
    }, 90000);

    test('authors localized core and icon-bearing blocks from the live German flyout', async () => {
        const url = new URL(process.env.STUDIO_BROWSER_URL);
        url.searchParams.set('keyboard-authoring', '1');
        url.searchParams.set('locale', 'de');
        await helper.loadUri(url.toString());
        await driver.wait(() => driver.executeScript('return !!window.vm?.editingTarget;'), 30000);
        await driver.executeScript('window.__keyboardTestWorkspace=window.ScratchBlocks.getMainWorkspace();');
        await enableKeyboard();

        await typeBlock('gehe 10 er Schritt', 1);
        await typeBlock('drehe dich im Uhrzeigersinn um 15 Grad', 2);
        await beginNewScript();
        await typeBlock('Wenn Flagge angeklickt wird', 3);

        const roots = (await state()).roots;
        expect(roots).toHaveLength(2);
        expect(roots.find(root => root.type === 'motion_movesteps').next.type).toBe('motion_turnright');
        expect(roots.find(root => root.type === 'event_whenflagclicked')).toBeDefined();
    }, 90000);

    test('authors Japanese core and icon-bearing blocks with localized category badges', async () => {
        const url = new URL(process.env.STUDIO_BROWSER_URL);
        url.searchParams.set('keyboard-authoring', '1');
        url.searchParams.set('locale', 'ja');
        await helper.loadUri(url.toString());
        await driver.wait(() => driver.executeScript('return !!window.vm?.editingTarget;'), 30000);
        await driver.executeScript('window.__keyboardTestWorkspace=window.ScratchBlocks.getMainWorkspace();');
        await enableKeyboard();

        await beginNewScript();
        await keys(...'10 歩動かす');
        let selected = await driver.wait(until.elementLocated(
            By.css('[role="option"][aria-selected="true"]')
        ), 10000);
        expect(await selected.findElement(By.css('span')).getText()).toBe('動き');
        await keys(Key.ENTER); await count(1); await keys(Key.END);

        await beginNewScript();
        await keys(...'緑の旗が押されたとき');
        selected = await driver.wait(until.elementLocated(
            By.css('[role="option"][aria-selected="true"]')
        ), 10000);
        expect(await selected.findElement(By.css('span')).getText()).toBe('イベント');
        await keys(Key.ENTER); await count(2); await noGhost();

        const before = (await state()).roots;
        expect(before.find(root => root.type === 'motion_movesteps')).toBeDefined();
        expect(before.find(root => root.type === 'event_whenflagclicked')).toBeDefined();
        await nativeHistory(false); await count(1);
        await nativeHistory(true); await count(2);
        expect((await state()).roots).toEqual(before);
    }, 90000);

    test('measures draft latency in a large native workspace without mutating its scripts', async () => {
        // Deliberately bulk-loaded performance fixture, not claimed as 1000 real
        // authoring gestures. The search and cancellation below use real keys.
        await driver.executeScript(`
            const ws=window.ScratchBlocks.getMainWorkspace();
            let xml='<xml>';
            const command='<block type="motion_movesteps"><value name="STEPS"><shadow type="math_number">' +
                '<field name="NUM">10</field></shadow></value>';
            for(let i=0;i<200;i++) {
                xml+=command.replace('<block ', '<block x="'+(80+i%10*260)+'" y="'+(80+Math.floor(i/10)*350)+'" ');
                for(let n=1;n<5;n++) xml+='<next>'+command;
                xml+='</block></next>'.repeat(4)+'</block>';
            }
            window.ScratchBlocks.Xml.domToWorkspace(window.ScratchBlocks.Xml.textToDom(xml+'</xml>'),ws);
        `);
        await count(1000);
        // A passive preview can mask source SVGs. Reach the first native
        // command through the structural path before measuring allocation.
        await keys(Key.TAB, Key.HOME); await strictlyNoPreview();
        await driver.executeScript(`window.__keyboardLatencies=[];
            window.__keyboardSceneAllocations=0;
            window.__keyboardSceneProfile=[];
            const ws=window.__keyboardTestWorkspace;
            const original=ws.createTransitionWorkspace;
            ws.createTransitionWorkspace=function(...args) {
                const start=performance.now();
                window.__keyboardSceneAllocations++;
                const scene=original.apply(this,args);
                window.__keyboardSceneProfile.push({durationMs:performance.now()-start,
                    sourceNodes:ws.getAllBlocks(false).length,copyNodes:scene.workspace.getAllBlocks(false).length});
                return scene;
            };
            window.addEventListener('keydown', event=>{
                if(event.key.length!==1 || event.ctrlKey || event.metaKey) return;
                const start=performance.now();
                requestAnimationFrame(()=>window.__keyboardLatencies.push(performance.now()-start));
            },true);`);
        await keys(Key.END, ...'wait 1 seconds');
        const times = await driver.executeScript('return window.__keyboardLatencies;');
        const scenes = await driver.executeScript('return window.__keyboardSceneAllocations;');
        const allocation = await driver.executeScript('return window.__keyboardSceneProfile;');
        fs.writeFileSync(path.join(artifacts, 'large-workspace-latency.json'), JSON.stringify({
            blocks:1000, scenes, allocation, keyToFrameMs:times, maxMs:Math.max(...times),
            meanMs:times.reduce((a,b)=>a+b,0)/times.length,
            steadyMeanMs:times.slice(1).reduce((a,b)=>a+b,0)/(times.length-1)
        }, null, 2));
        expect(times).toHaveLength('wait 1 seconds'.length);
        expect(scenes).toBe(1);
        expect(allocation[0].copyNodes).toBe(10); // Only the edited five-block stack and its shadows.
        await keys(Key.ESCAPE); await noGhost(); await count(1000);
    }, 120000);

    test('accepts a fast mixed typing stream without waiting for each Blockly event queue to settle', async () => {
        await keys(...'move 1 steps', Key.ENTER, Key.END, ...'wait 2 seconds', Key.ENTER, Key.END,
            ...'say hello', Key.ENTER, Key.END);
        await count(3); await noGhost();
        const before = (await state()).roots;
        expect(before[0].next.next.type).toBe('looks_say');
        for (const expected of [2, 1, 0]) {
            await nativeHistory(false); await count(expected);
        }
        for (const expected of [1, 2, 3]) {
            await nativeHistory(true); await count(expected);
        }
        expect((await state()).roots).toEqual(before);
    }, 90000);

    test('inserts above a middle command and a stack root with Shift+Enter and native undo', async () => {
        await typeBlock('move 10 steps', 1);
        await typeBlock('wait 1 seconds', 2);
        const before = (await state()).roots;
        await caretAt('block','control_wait','',true); await chord(Key.SHIFT, Key.ENTER);
        await typeBlock('say before', 3);
        expect((await state()).roots[0].next.type).toBe('looks_say');
        expect((await state()).roots[0].next.next.type).toBe('control_wait');
        await keys(Key.HOME, Key.ARROW_UP, Key.ARROW_UP); await chord(Key.SHIFT, Key.ENTER);
        await typeBlock('when flag clicked', 4);
        const after = (await state()).roots;
        expect(after[0].type).toBe('event_whenflagclicked');
        expect(after[0].next.type).toBe('motion_movesteps');
        await nativeHistory(false); await count(3);
        await nativeHistory(false); await count(2);
        expect((await state()).roots).toEqual(before);
        await nativeHistory(true); await count(3);
        await nativeHistory(true); await count(4);
        expect((await state()).roots).toEqual(after);
    }, 90000);

    test('chooses and cancels a native dropdown using only keys then continues at the structural caret', async () => {
        await typeBlock('go to random position', 1);
        await keys(Key.HOME, Key.ARROW_RIGHT, Key.ENTER);
        await driver.wait(until.elementLocated(By.css('.blocklyDropDownDiv .goog-menu')), 10000);
        await keys(Key.ARROW_DOWN, Key.ARROW_DOWN, Key.ENTER);
        await driver.wait(async () => (await state()).roots[0].inputs.TO.fields.TO === '_mouse_', 10000);
        await driver.wait(async () => (await state()).focus === 'Scratch keyboard editor', 10000);
        await keys(Key.ENTER, Key.ARROW_DOWN, Key.ESCAPE);
        await driver.wait(() => driver.executeScript('return !window.ScratchBlocks.DropDownDiv.isVisible();'), 10000);
        expect((await state()).roots[0].inputs.TO.fields.TO).toBe('_mouse_');
        await keys(Key.TAB);
        expect((await state()).caret).toMatch(/^gap:/);
        await typeBlock('wait 1 seconds', 2);
        await nativeHistory(false); await count(1);
        await nativeHistory(false);
        await driver.wait(async () => (await state()).roots[0].inputs.TO.fields.TO === '_random_', 10000);
    }, 90000);

    test('keeps an oversized C header in view at zoom without alternating camera corrections', async () => {
        await typeBlock('repeat 10', 1);
        for (let index = 0; index < 18; index++) await typeBlock('wait 1 seconds', index + 2);
        const before = (await state()).roots;
        const zoom = await driver.executeScript(`return [...document.querySelectorAll('.blocklyZoom image')]
            .find(node=>(node.getAttribute('xlink:href')||node.getAttribute('href')||'').includes('zoom-in'));`);
        // Use actual zoom controls, not a test-only camera setter.
        for (let index = 0; index < 8; index++) await zoom.click();
        await enableKeyboard();
        await chord(Key.CONTROL, Key.HOME);
        await expectCaret('block','control_repeat');
        const geometry = () => driver.executeScript(`const ws=window.__keyboardTestWorkspace;
            const repeat=ws.getTopBlocks(false)[0];
            const block=repeat.svgPath_.getBoundingClientRect();
            const field=repeat.getInputTargetBlock('TIMES').getSvgRoot().getBoundingClientRect();
            const viewport=ws.getParentSvg().getBoundingClientRect();
            const caret=document.querySelector('[data-position]').getBoundingClientRect();
            return {scale:ws.scale, block:{top:block.top,height:block.height},
                field:{top:field.top,bottom:field.bottom}, viewport:{top:viewport.top,bottom:viewport.bottom},
                caret:{top:caret.top,height:caret.height}, scrollX:ws.scrollX,scrollY:ws.scrollY};`);
        const samples = [await geometry()];
        for (let index = 0; index < 4; index++) {
            await keys(Key.HOME); samples.push(await geometry());
        }
        fs.writeFileSync(path.join(artifacts, 'oversized-c-camera.json'), JSON.stringify(samples, null, 2));
        expect(samples[0].scale).toBeGreaterThan(2);
        expect(samples[0].block.height).toBeGreaterThan(samples[0].viewport.bottom - samples[0].viewport.top);
        for (const sample of samples) {
            expect(sample.field.top).toBeGreaterThanOrEqual(sample.viewport.top + 12);
            expect(sample.field.bottom).toBeLessThan(sample.viewport.bottom - 60);
            // Outline follows the entire C silhouette; camera still frames its
            // header instead of trying to fit the oversized body on screen.
            expect(Math.abs(sample.caret.height - sample.block.height)).toBeLessThan(2);
            expect(Math.abs(sample.scrollY - samples[0].scrollY)).toBeLessThan(2);
        }
        expect((await state()).roots).toEqual(before);
    }, 120000);

    const scriptView = () => driver.executeScript(`const ws=window.__keyboardTestWorkspace;
        const caret=document.querySelector('[data-position]');
        const root=ws.getTopBlocks(false).find(b=>!b.isInsertionMarker());
        const box=el=>{const r=el.getBoundingClientRect();return {left:r.left,top:r.top,width:r.width,height:r.height};};
        const rect=ws.getParentSvg().getBoundingClientRect(),m=ws.getMetrics();
        return {head:root?box(root.svgPath_):null,caret:box(caret),position:caret.dataset.position,
            bounds:{left:rect.left+m.absoluteLeft+m.flyoutWidth,
                top:rect.top+Number(ws.getParentSvg().parentElement.querySelector(
                    '[data-workspace-inset-top]:not([hidden])')?.dataset.workspaceInsetTop||0),
                right:rect.right-18,bottom:rect.bottom-52},
            view:{left:m.viewLeft,top:m.viewTop,scale:ws.scale},
            xml:window.ScratchBlocks.Xml.domToText(window.ScratchBlocks.Xml.workspaceToDom(ws)),
            undo:ws.undoStack_.length,redo:ws.redoStack_.length};`);
    const sameView = (a, b) => Math.abs(a.left-b.left)<1 && Math.abs(a.top-b.top)<1 && a.scale===b.scale;
    const awaitView = view => driver.wait(async () => sameView((await scriptView()).view, view), 10000,
        `Camera did not restore ${JSON.stringify(view)}`);

    test('Show current script frames its hat and exact nested caret and returns to the untouched offscreen view', async () => {
        await typeBlock('when flag clicked',1);
        await typeBlock('move (1 + 2) steps',3);
        await typeBlock('say hello',4);
        await keys(Key.HOME,Key.ARROW_DOWN,Key.ARROW_RIGHT,Key.ARROW_RIGHT,Key.ARROW_RIGHT);
        await expectCaret('input','operator_add','NUM2');
        await strictlyNoPreview();
        // Deliberately pan the selected script out of view, as a user may do
        // with the minimap. Navigation must return to this exact camera later.
        await driver.executeScript(`const ws=window.__keyboardTestWorkspace,m=ws.getMetrics();
            ws.scrollbar.set(m.viewLeft-m.contentLeft+450,m.viewTop-m.contentTop+350);`);
        await painted();
        const before=await scriptView();
        const diagnostic=await driver.executeScript(`const ws=window.__keyboardTestWorkspace,root=ws.getTopBlocks(false)[0];
            const p=root.svgPath_;const bbox=p.getBBox(),m=ws.getCanvas().getScreenCTM();
            const nodes=[];for(let n=p;n&&n!==ws.getCanvas();n=n.parentNode)nodes.push({tag:n.tagName,
                transform:n.getAttribute('transform')});
            return {metrics:ws.getMetrics(),scroll:{x:ws.scrollX,y:ws.scrollY},xy:root.getRelativeToSurfaceXY(),
                bbox:{x:bbox.x,y:bbox.y,width:bbox.width,height:bbox.height},
                matrix:{a:m.a,b:m.b,c:m.c,d:m.d,e:m.e,f:m.f},nodes};`);
        await chord(Key.ALT,'s');
        await driver.sleep(350);
        fs.writeFileSync(path.join(artifacts,'show-script-short-measurement.json'),
            JSON.stringify({before,diagnostic,framed:await scriptView()},null,2));
        await driver.wait(async()=>{const s=await scriptView();return Math.abs(s.head.left-s.bounds.left-32)<1 &&
            Math.abs(s.head.top-s.bounds.top-32)<1;},10000,'Hat did not reach the requested top-left framing');
        const after=await scriptView();
        expect(after.position).toBe(before.position);
        expect(after.xml).toBe(before.xml);
        expect([after.undo,after.redo,after.view.scale]).toEqual([before.undo,before.redo,before.view.scale]);
        await screenshot('show-current-script-short');
        await chord(Key.ALT,'s');
        expect(sameView((await scriptView()).view,after.view)).toBe(true);
        await chord(Key.CONTROL,Key.ARROW_LEFT); await awaitView(before.view);
        await chord(Key.CONTROL,Key.ARROW_RIGHT); await awaitView(after.view);
        expect((await scriptView()).position).toBe(before.position);
        // A real input owns text keys; framing must neither accept nor lose it.
        await keys(Key.F2);
        const field=await driver.wait(until.elementLocated(By.css('input.blocklyHtmlInput')),10000);
        await field.sendKeys(Key.chord(Key.CONTROL,'a'),'27');
        await chord(Key.ALT,'s');
        expect(await field.getAttribute('value')).toBe('27');
        expect(sameView((await scriptView()).view,after.view)).toBe(true);
        await keys(Key.ESCAPE);
    },90000);

    test('Show current script frames a free placeholder without creating blocks',async()=>{
        const before=await scriptView();
        expect(before.head).toBe(null);
        await chord(Key.ALT,'s');
        await driver.wait(async()=>{const s=await scriptView();return Math.abs(s.caret.left-s.bounds.left-32)<2 &&
            Math.abs(s.caret.top-s.bounds.top-32)<2;},10000);
        const after=await scriptView();
        expect(after.xml).toBe(before.xml);
        expect(after.undo).toBe(before.undo);
        expect(after.position).toBe(before.position);
        await chord(Key.ALT,'s'); await awaitView(after.view);
    },60000);

    test.each([0.75,1.5,3])('Show current script keeps a long-stack caret at two thirds at zoom %s',async scale=>{
        // Native import is fixture setup. Selection and the command under test
        // use real keyboard actions, not a direct controller invocation.
        await driver.executeScript(`const ws=window.__keyboardTestWorkspace;
            const command='<block type="control_wait"><value name="DURATION"><shadow type="math_positive_number">'+
                '<field name="NUM">1</field></shadow></value>';
            const xml='<xml>'+command.replace('<block ','<block x="80" y="80" ')+
                ('<next>'+command).repeat(29)+'</block></next>'.repeat(29)+'</block></xml>';
            window.ScratchBlocks.Xml.domToWorkspace(window.ScratchBlocks.Xml.textToDom(xml),ws);
            ws.setScale(arguments[0]);ws.resize();`,scale);
        await count(30); await keys(Key.TAB,Key.END,Key.ARROW_UP,Key.ARROW_RIGHT);
        await expectCaret('input','control_wait','DURATION'); await strictlyNoPreview();
        const before=await scriptView();
        await chord(Key.ALT,'s');
        await driver.wait(async()=>{const s=await scriptView();return Math.abs(s.caret.top+s.caret.height-
            (s.bounds.top+(s.bounds.bottom-s.bounds.top)*2/3))<2;},10000);
        // Geometry can enter the tolerance just before the shared animation's
        // final frame. Sample idempotence at completion, not that near miss.
        await driver.sleep(350);
        const after=await scriptView();
        expect(after.head.top).toBeLessThan(after.bounds.top);
        expect(after.position).toBe(before.position);
        expect(after.xml).toBe(before.xml);
        expect(after.undo).toBe(before.undo);
        expect(after.view.scale).toBe(scale);
        await chord(Key.ALT,'s'); await awaitView(after.view);
        await screenshot(`show-current-script-long-${scale}`);
    },90000);

    test('Show current script prioritises a wide nested operand in a narrow editor and yields to a click',async()=>{
        await driver.manage().window().setRect({width:1100,height:850});
        await typeBlock('move (1 + (2 + (3 + (4 + (5 + 6))))) steps',6);
        await keys(Key.HOME);
        for(let i=0;i<11;i++) await keys(Key.ARROW_RIGHT);
        await expectCaret('input','operator_add','NUM2');
        await strictlyNoPreview();
        await driver.executeScript('window.__keyboardTestWorkspace.setScale(2);window.__keyboardTestWorkspace.resize();');
        await painted();
        await chord(Key.ALT,'s');
        await driver.wait(async()=>{const s=await scriptView();return Math.abs(s.caret.left+s.caret.width-
            (s.bounds.right-32))<2;},10000);
        const framed=await scriptView();
        expect(framed.caret.left).toBeGreaterThanOrEqual(framed.bounds.left+30);
        await chord(Key.CONTROL,Key.ARROW_LEFT);
        await driver.sleep(350);
        await chord(Key.ALT,'s');
        await driver.findElement(By.css('input[class*="project-title-input"]')).click();
        await driver.sleep(350);
        const interrupted=await scriptView();
        await driver.sleep(100);
        expect(sameView((await scriptView()).view,interrupted.view)).toBe(true);
        expect(await driver.executeScript('return document.activeElement.className;')).toMatch(/project-title-input/);
        await screenshot('show-current-script-wide');
    },90000);

    test('native navigation sizing on a 200-block stack stays bounded without edits', async () => {
        await driver.executeScript(`const ws=window.__keyboardTestWorkspace;
            const command='<block type="control_wait"><value name="DURATION"><shadow type="math_positive_number">'+
                '<field name="NUM">1</field></shadow></value>';
            const xml='<xml>'+command.replace('<block ','<block x="80" y="80" ')+
                ('<next>'+command).repeat(199)+'</block></next>'.repeat(199)+'</block></xml>';
            window.ScratchBlocks.Xml.domToWorkspace(window.ScratchBlocks.Xml.textToDom(xml),ws);`);
        await count(200);
        // The initial free caret may already be presenting an insertion scene
        // that masks/moves the imported root. Enter via semantic keyboard
        // navigation, not an obsolete source SVG's screen coordinates.
        await keys(Key.TAB,Key.HOME);
        await expectCaret('block','control_wait');
        const before=await driver.executeScript(`const ws=window.__keyboardTestWorkspace;
            window.__navigationSamples=[];window.__navigationSizingCalls=0;
            for(const block of ws.getAllBlocks(false)) {
                const original=block.getHeightWidth;
                block.getHeightWidth=function(...args){window.__navigationSizingCalls++;return original.apply(this,args);};
            }
            window.addEventListener('keydown',event=>{
                if(event.key!=='ArrowLeft')return;
                const started=performance.now();window.__navigationSizingCalls=0;
                requestAnimationFrame(()=>window.__navigationSamples.push({
                    ms:performance.now()-started,calls:window.__navigationSizingCalls}));
            },true);
            return {xml:window.ScratchBlocks.Xml.domToText(window.ScratchBlocks.Xml.workspaceToDom(ws)),
                undo:ws.undoStack_.length};`);
        for(let i=0;i<6;i++) {
            await driver.actions().keyDown(Key.ARROW_LEFT).perform();
            await painted();
        }
        await driver.actions().keyUp(Key.ARROW_LEFT).perform();
        await expectCaret('block','control_wait');
        const samples=await driver.executeScript('return window.__navigationSamples;');
        fs.writeFileSync(path.join(artifacts,`navigation-sizing-${new URL(process.env.STUDIO_BROWSER_URL).port}.json`),
            JSON.stringify({blocks:200,samples},null,2));
        expect(samples).toHaveLength(6);
        // Count native work, not a flaky wall-clock ceiling. The first key may
        // also reconcile the previous selection, hence one extra snapshot.
        expect(Math.max(...samples.map(sample=>sample.calls))).toBeLessThanOrEqual(200*4);
        const after=await driver.executeScript(`const ws=window.__keyboardTestWorkspace;
            return {xml:window.ScratchBlocks.Xml.domToText(window.ScratchBlocks.Xml.workspaceToDom(ws)),
                undo:ws.undoStack_.length};`);
        expect(after).toEqual(before);
    },90000);

    test('measures a long single-stack draft and preserves every continuation on cancel', async () => {
        // Separate from the many-short-stacks fixture: rebuilding one affected
        // root is not necessarily cheap when it owns hundreds of descendants.
        const first = await driver.executeScript(`const ws=window.__keyboardTestWorkspace;
            const command='<block type="control_wait"><value name="DURATION"><shadow type="math_positive_number">' +
                '<field name="NUM">1</field></shadow></value>';
            const xml='<xml>'+command.replace('<block ', '<block x="80" y="80" ') +
                ('<next>'+command).repeat(199)+'</block></next>'.repeat(199)+'</block></xml>';
            window.ScratchBlocks.Xml.domToWorkspace(window.ScratchBlocks.Xml.textToDom(xml),ws);
            return ws.getTopBlocks(true)[0].svgPath_;`);
        await count(200);
        const before = (await state()).roots;
        await driver.executeScript(`window.__keyboardLongLatencies=[];
            const ws=window.__keyboardTestWorkspace;
            const original=ws.createTransitionWorkspace;
            ws.createTransitionWorkspace=function(...args) {
                const scene=original.apply(this,args);
                window.__keyboardLongScene=scene.workspace;
                window.__keyboardLongOriginals=scene.workspace.getAllBlocks(false).filter(block=>!block.isShadow());
                return scene;
            };
            window.addEventListener('keydown', event=>{
                if(event.key.length!==1 || event.ctrlKey || event.metaKey) return;
                const start=performance.now();
                requestAnimationFrame(()=>window.__keyboardLongLatencies.push(performance.now()-start));
            },true);`);
        // Install the transition hook before opening the measured boundary.
        // A resting caret may reuse its native scene; instrumenting afterwards
        // would miss that existing scene and make the identity assertion test
        // the fixture rather than the editor.
        await driver.actions().mouseMove(first, {x:10,y:15}).click().perform();
        await keys(Key.ENTER); await keys(Key.ESCAPE);
        await keys(...'repeat 10');
        const times = await driver.executeScript('return window.__keyboardLongLatencies;');
        fs.writeFileSync(path.join(artifacts, 'long-stack-latency.json'), JSON.stringify({
            blocks:200, keyToFrameMs:times, maxMs:Math.max(...times),
            meanMs:times.reduce((a,b)=>a+b,0)/times.length,
            steadyMeanMs:times.slice(1).reduce((a,b)=>a+b,0)/(times.length-1)
        }, null, 2));
        expect(times).toHaveLength('repeat 10'.length);
        expect(await driver.executeScript(`return window.__keyboardLongOriginals.every(block=>
            window.__keyboardLongScene.getBlockById(block.id)===block);`)).toBe(true);
        await keys(Key.ESCAPE); await noGhost(); await count(200);
        expect((await state()).roots).toEqual(before);
    }, 120000);

    test('continues keyboard editing after undo and creates a clean native history branch', async () => {
        await typeBlock('move 1 steps', 1);
        await typeBlock('wait 2 seconds', 2);
        await typeBlock('say old', 3);
        await nativeHistory(false); await count(2);
        expect(await driver.findElement(By.xpath('//button[text()="Keyboard"]')).getAttribute('aria-pressed'))
            .toBe('true');
        expect((await state()).focus).toBe('Scratch keyboard editor');
        await keys(Key.END);
        await typeBlock('say new', 3);
        const branch = (await state()).roots;
        expect(branch[0].next.next.inputs.MESSAGE.fields.TEXT).toBe('new');
        await nativeHistory(true); await painted();
        expect((await state()).roots).toEqual(branch);
        await nativeHistory(false); await count(2);
        await nativeHistory(true); await count(3);
        expect((await state()).roots).toEqual(branch);
    }, 90000);

    test('moves from a split boundary into its own tail instead of jumping to the first script', async () => {
        await typeBlock('move 1 steps', 1);
        await typeBlock('wait 2 seconds', 2);
        const waitId = await driver.executeScript(`return window.__keyboardTestWorkspace
            .getAllBlocks(false).find(block=>block.type==='control_wait').id;`);
        await keys(Key.ARROW_UP, Key.ARROW_UP, Key.ENTER, Key.ENTER);
        await driver.wait(async () => (await state()).roots.length === 2, 10000);
        expect((await state()).caret).toBe(`before:${waitId}::`);
        await keys(Key.ARROW_DOWN);
        expect((await state()).caret).toBe(`block:${waitId}::`);
        await keys(Key.END);
        await typeBlock('say tail', 3);
        const tail = (await state()).roots.find(block => block.type === 'control_wait');
        expect(tail.next.inputs.MESSAGE.fields.TEXT).toBe('tail');
        await nativeHistory(false); await count(2);
        await nativeHistory(false);
        await driver.wait(async () => (await state()).roots.length === 1, 10000);
        expect((await state()).roots[0].next.type).toBe('control_wait');
    }, 90000);

    test('keeps text undo inside an unaccepted draft without undoing real blocks', async () => {
        await typeBlock('move 1 steps', 1);
        const before = (await state()).roots;
        await keys(...'say draft text');
        const input = await driver.findElement(By.css('[aria-label="Type a Scratch block"]'));
        expect(await input.getAttribute('value')).toBe('say draft text');
        await nativeHistory(false); await painted();
        expect((await state()).roots).toEqual(before);
        expect((await state()).focus).toBe('Type a Scratch block');
        expect((await input.getAttribute('value')).length).toBeLessThan('say draft text'.length);
        await nativeHistory(true); await painted();
        expect(await input.getAttribute('value')).toBe('say draft text');
        await keys(Key.ESCAPE); await noGhost();
        expect((await state()).roots).toEqual(before);
        await nativeHistory(false); await count(0);
    }, 90000);

    test('a resting new-script caret reserves room before any block text is typed', async () => {
        await typeBlock('move 10 steps', 1);
        await beginNewScript(); await typeBlock('say lower', 2);
        const fixture = await driver.executeScript(`const ws=window.__keyboardTestWorkspace;
            const upper=ws.getTopBlocks(false).find(block=>block.type==='motion_movesteps');
            const lower=ws.getTopBlocks(false).find(block=>block.type==='looks_say');
            const upperXY=upper.getRelativeToSurfaceXY(), lowerXY=lower.getRelativeToSurfaceXY();
            const target={x:upperXY.x,y:upperXY.y+upper.getHeightWidth().height+50};
            window.ScratchBlocks.Events.disable();
            try { lower.moveBy(target.x-lowerXY.x,target.y-lowerXY.y); }
            finally { window.ScratchBlocks.Events.enable(); }
            ws.resizeContents();
            const original=ws.createTransitionWorkspace;
            window.__keyboardLayoutFixture={upperId:upper.id,lowerId:lower.id,
                sourceY:lower.getRelativeToSurfaceXY().y};
            ws.createTransitionWorkspace=function(...args) {
                const scene=original.apply(this,args);
                window.__keyboardLayoutScene=scene.workspace;
                return scene;
            };
            return window.__keyboardLayoutFixture;`);
        // Gaps are deliberate edit actions, not ordinary Tab stops. Select
        // the owning command, then use the same Enter, Enter gesture as a user.
        await caretAt('block', 'motion_movesteps', '', true);
        await keys(Key.ENTER, Key.ENTER);
        await driver.wait(async () => (await state()).caret.startsWith('workspace:'), 10000);
        let preview;
        let previousCopyY;
        await driver.wait(async () => {
            preview = await driver.executeScript(`const ws=window.__keyboardTestWorkspace;
                const source=ws.getBlockById(arguments[0]);
                const copy=window.__keyboardLayoutScene?.getBlockById(arguments[0]);
                const caret=document.querySelector('[data-position^="workspace:"]');
                return {sourceY:source?.getRelativeToSurfaceXY().y,
                    sourceOpacity:source?.getSvgRoot().style.opacity,
                    copyY:copy?.getRelativeToSurfaceXY().y,
                    caretSource:caret?.querySelector('path[data-source]')?.dataset.source};`, fixture.lowerId);
            const stable = preview.copyY > preview.sourceY + 40 && previousCopyY !== undefined &&
                Math.abs(preview.copyY - previousCopyY) < 0.01;
            previousCopyY = preview.copyY;
            return stable;
        }, 10000, 'The empty new-script caret did not reserve room for one command row');
        expect(preview.sourceY).toBe(fixture.sourceY);
        expect(preview.sourceOpacity).toBe('0');
        expect(preview.caretSource).toBe('generic');
        expect((await state()).count).toBe(2);

        await keys(...'wait 2 seconds'); await keys(Key.ENTER); await count(3);
        const acceptedY = await driver.executeScript(`return window.__keyboardTestWorkspace.getBlockById(arguments[0])
            .getRelativeToSurfaceXY().y;`, fixture.lowerId);
        expect(Math.abs(acceptedY - preview.copyY)).toBeLessThan(1);
        await nativeHistory(false); await count(2);
        expect(await driver.executeScript(`return window.__keyboardTestWorkspace.getBlockById(arguments[0])
            .getRelativeToSurfaceXY().y;`, fixture.lowerId)).toBe(fixture.sourceY);
    }, 90000);

    test.each([['repeat', 0.675], ['repeat', 1.5], ['command', 1], ['if_else', 1], ['if_else_empty', 1]])(
        'a resting terminal caret reserves neighbouring stacks without edits (%s, zoom %s)', async (shape, scale) => {
            const type = shape === 'command' ? 'motion_movesteps' :
                shape === 'repeat' ? 'control_repeat' : 'control_if_else';
            const fixture = await driver.executeScript(`const ws=window.__keyboardTestWorkspace,SB=window.ScratchBlocks;
                const move='<block type="motion_movesteps"><value name="STEPS"><shadow type="math_number">'+
                    '<field name="NUM">10</field></shadow></value></block>';
                const cBlock=arguments[0]==='repeat' ?
                    '<block type="control_repeat"><value name="TIMES"><shadow type="math_whole_number">'+
                    '<field name="NUM">10</field></shadow></value><statement name="SUBSTACK">'+move+
                    '</statement></block>' : '<block type="control_if_else"><statement name="SUBSTACK">'+move+
                    '</statement>'+(arguments[0]==='if_else'?'<statement name="SUBSTACK2">'+move+'</statement>':'')+
                    '</block>';
                const upper=arguments[0]==='command' ? move.replace('<block ', '<block x="100" y="80" ') :
                    '<block type="event_whenflagclicked" x="100" y="80"><next>'+cBlock+'</next></block>';
                SB.Xml.domToWorkspace(SB.Xml.textToDom('<xml>'+upper+
                    '<block type="event_whenkeypressed" x="100" y="400"><field name="KEY_OPTION">e</field></block>'+
                    '<block type="looks_show" x="100" y="500"/>'+
                    '<block type="looks_hide" x="550" y="400"/></xml>'),ws);
                const root=ws.getTopBlocks(false).find(b=>b.type===
                    (arguments[0]==='command'?'motion_movesteps':'event_whenflagclicked'));
                const lower=ws.getTopBlocks(false).find(b=>b.type==='event_whenkeypressed');
                const next=ws.getTopBlocks(false).find(b=>b.type==='looks_show');
                const right=ws.getTopBlocks(false).find(b=>b.type==='looks_hide');
                const place=(b,x,y)=>{const p=b.getRelativeToSurfaceXY();b.moveBy(x-p.x,y-p.y);};
                SB.Events.disable();
                try {
                    place(lower,100,root.getRelativeToSurfaceXY().y+root.getHeightWidth().height+50);
                    place(next,100,lower.getRelativeToSurfaceXY().y+lower.getHeightWidth().height+50);
                    place(right,550,lower.getRelativeToSurfaceXY().y);
                } finally { SB.Events.enable(); }
                ws.setScale(arguments[1]);ws.resize();
                return {lower:lower.id,next:next.id,right:right.id};`, shape, scale);
            const total = shape === 'command' ? 4 : shape === 'if_else' ? 7 : 6;
            await count(total);
            await caretAt('block', type);
            await strictlyNoPreview();
            const nativeState = () => driver.executeScript(`const ws=window.__keyboardTestWorkspace;
                return {xml:window.ScratchBlocks.Xml.domToText(window.ScratchBlocks.Xml.workspaceToDom(ws)),
                    undo:ws.undoStack_.length,redo:ws.redoStack_.length};`);
            const before = await nativeState();
            const inspect = () => driver.executeScript(`const ws=window.__keyboardTestWorkspace;
                const copy=Object.values(window.ScratchBlocks.Workspace.WorkspaceDB_)
                    .find(c=>c.options.readOnly&&!c.isFlyout&&c.options.parentWorkspace===ws);
                const caret=document.querySelector('[data-position]').getBoundingClientRect();
                return Object.entries(arguments[0]).map(([name,id])=>{
                    const real=ws.getBlockById(id),drawn=copy?.getBlockById(id);
                    return {name,sourceY:real.getRelativeToSurfaceXY().y,sourceOpacity:real.getSvgRoot().style.opacity,
                        copyY:drawn?.getRelativeToSurfaceXY().y,
                        clearance:drawn?.svgPath_.getBoundingClientRect().top-caret.bottom};
                });`, fixture);
            for (let visit = 0; visit < 2; visit++) {
                await keys(Key.END); await expectCaret('gap', type); await settledSpacer('caret');
                await driver.wait(async () => (await inspect()).slice(0,2)
                    .every(row => row.copyY > row.sourceY + 40), 5000,
                'Resting end-of-stack caret must reserve room for both following stacks before typing');
                const rows = await inspect();
                expect(rows[0].clearance).toBeGreaterThan(20 * scale);
                expect(rows.slice(0,2).map(row => row.sourceOpacity)).toEqual(['0','0']);
                expect(rows[2].sourceOpacity).not.toBe('0'); // no unrelated-column masking
                expect(await nativeState()).toEqual(before);
                expect((await state()).count).toBe(total);
                if (shape !== 'command' && visit === 0) {
                    // Observe every painted frame, not only the two settled
                    // layouts: relocating the reservation must not briefly
                    // restore the lower scripts and then push them away again.
                    const handoff = async (...arrows) => {
                        await driver.executeScript(`const ids=arguments[0],ws=window.__keyboardTestWorkspace;
                            window.__caretHandoffFrames=[];window.__caretHandoffDone=false;
                            const read=()=>{
                                const scenes=Object.values(window.ScratchBlocks.Workspace.WorkspaceDB_)
                                    .filter(c=>c.options.readOnly&&!c.isFlyout&&c.options.parentWorkspace===ws);
                                return {scenes:scenes.length,ys:ids.map(id=>{
                                    const source=ws.getBlockById(id),copy=scenes[0]?.getBlockById(id);
                                    const shown=source.getSvgRoot().style.opacity==='0'&&copy?copy:source;
                                    return shown.getRelativeToSurfaceXY().y;
                                })};
                            };
                            window.__caretHandoffFrames.push(read());
                            window.addEventListener('keydown',()=>{
                                const until=performance.now()+700;
                                const frame=()=>{
                                    window.__caretHandoffFrames.push(read());
                                    if(performance.now()<until)requestAnimationFrame(frame);
                                    else window.__caretHandoffDone=true;
                                };requestAnimationFrame(frame);
                            },{once:true,capture:true});`, [fixture.lower, fixture.next]);
                        for (const arrow of arrows) await keys(arrow);
                        await driver.wait(() => driver.executeScript('return window.__caretHandoffDone;'), 5000);
                        const frames = await driver.executeScript('return window.__caretHandoffFrames;');
                        expect(frames.length).toBeGreaterThan(5);
                        expect(frames.every(frame => frame.scenes === 1)).toBe(true);
                        for (let i = 0; i < 2; i++) {
                            const ys = frames.map(frame => frame.ys[i]);
                            const ends = [ys[0], ys[ys.length - 1]];
                            expect(Math.min(...ys)).toBeGreaterThanOrEqual(Math.min(...ends) - 0.1);
                            expect(Math.max(...ys)).toBeLessThanOrEqual(Math.max(...ends) + 0.1);
                        }
                        expect(await nativeState()).toEqual(before);
                    };
                    await handoff(Key.ARROW_UP);
                    await expectCaret('gap', shape === 'if_else_empty' ? type : 'motion_movesteps',
                        shape === 'if_else_empty' ? 'SUBSTACK2' : '');
                    await handoff(Key.ARROW_DOWN); await expectCaret('gap', type);
                    // A second destination arriving during the deferred handoff
                    // must likewise preserve the currently painted reservation.
                    await handoff(Key.ARROW_UP, Key.ARROW_DOWN, Key.ARROW_UP, Key.ARROW_DOWN);
                    await expectCaret('gap', type);
                }
                // Home leaves the reservation altogether. Up from a C's outer
                // tail first reaches its body's insertion gap (another preview).
                await keys(Key.HOME);
                await expectCaret('block', shape === 'command' ? type : 'event_whenflagclicked');
                await strictlyNoPreview();
                expect(await nativeState()).toEqual(before);
                await caretAt('block', type);
            }
            await keys(Key.END); await settledSpacer('caret');
            await screenshot(`terminal-caret-spacing-${shape}-${scale}`);
            await keys(Key.ENTER); await settledSpacer('draft');
            await keys(...'wait 1 seconds');
            await keys(Key.ESCAPE, Key.HOME); await strictlyNoPreview();
            expect(await nativeState()).toEqual(before);
            // Accepting commits the same spacing through native Undo/Redo.
            await caretAt('block', type);
            await keys(Key.END, Key.ENTER); await acceptBlock('wait 1 seconds', total + 1);
            await keys(Key.HOME); await strictlyNoPreview();
            const accepted = await nativeState();
            expect(accepted.xml).not.toBe(before.xml);
            await nativeHistory(false); await count(total);
            expect((await nativeState()).xml).toBe(before.xml);
            await nativeHistory(true); await count(total + 1);
            expect((await nativeState()).xml).toBe(accepted.xml);
            await noGhost();
        }, 90000);

    test('an empty middle-stack placeholder moves neighbouring roots before typing', async () => {
        await typeBlock('move 10 steps', 1);
        await typeBlock('wait 1 seconds', 2);
        await keys(Key.ENTER, Key.ENTER);
        await typeBlock('say lower', 3);
        const fixture = await driver.executeScript(`const ws=window.__keyboardTestWorkspace;
            const lower=ws.getTopBlocks(false).find(block=>block.type==='looks_say');
            const original=ws.createTransitionWorkspace;
            window.__keyboardLayoutFixture={lowerId:lower.id,sourceY:lower.getRelativeToSurfaceXY().y};
            ws.createTransitionWorkspace=function(...args) {
                const scene=original.apply(this,args);
                window.__keyboardLayoutScene=scene.workspace;
                return scene;
            };
            return window.__keyboardLayoutFixture;`);
        await caretAt('block', 'motion_movesteps', '', true);
        await keys(Key.ENTER); await settledSpacer('draft');
        let preview;
        await driver.wait(async () => {
            preview = await driver.executeScript(`const ws=window.__keyboardTestWorkspace;
                const source=ws.getBlockById(arguments[0]);
                const copy=window.__keyboardLayoutScene?.getBlockById(arguments[0]);
                const panel=document.querySelector('[aria-label="Type a Scratch block"]')?.parentElement;
                return {sourceY:source?.getRelativeToSurfaceXY().y,
                    sourceOpacity:source?.getSvgRoot().style.opacity,
                    copyY:copy?.getRelativeToSurfaceXY().y,
                    panelSide:panel?.dataset.placement};`, fixture.lowerId);
            return preview.copyY > preview.sourceY + 40;
        }, 10000, 'The empty connected placeholder did not move the neighbouring root');
        expect(preview.sourceY).toBe(fixture.sourceY);
        expect(preview.sourceOpacity).toBe('0');
        expect(preview.panelSide).toBe('beside');
        expect((await state()).count).toBe(3);

        await acceptBlock('turn clockwise 15 degrees', 4);
        expect((await state()).roots[0].next.type).toBe('motion_turnright');
        expect((await state()).roots[0].next.next.type).toBe('control_wait');
        const acceptedY = await driver.executeScript(`return window.__keyboardTestWorkspace.getBlockById(arguments[0])
            .getRelativeToSurfaceXY().y;`, fixture.lowerId);
        expect(Math.abs(acceptedY - preview.copyY)).toBeLessThan(1);
        await nativeHistory(false); await count(3);
        expect(await driver.executeScript(`return window.__keyboardTestWorkspace.getBlockById(arguments[0])
            .getRelativeToSurfaceXY().y;`, fixture.lowerId)).toBe(fixture.sourceY);
        await nativeHistory(true); await count(4);
        expect(await driver.executeScript(`return window.__keyboardTestWorkspace.getBlockById(arguments[0])
            .getRelativeToSurfaceXY().y;`, fixture.lowerId)).toBe(acceptedY);
    }, 90000);

    test('previews neighbouring stack spacing and commits the same layout in one native Undo group', async () => {
        await typeBlock('move 10 steps', 1);
        await beginNewScript(); await typeBlock('wait 1 seconds', 2);
        await beginNewScript(); await typeBlock('say lower', 3);
        const before = await state();
        const fixture = await driver.executeScript(`const ws=window.__keyboardTestWorkspace;
            const upper=ws.getTopBlocks(false).find(block=>block.type==='control_wait');
            const lower=ws.getTopBlocks(false).find(block=>block.type==='looks_say');
            const upperXY=upper.getRelativeToSurfaceXY(), lowerXY=lower.getRelativeToSurfaceXY();
            const target={x:upperXY.x,y:upperXY.y+upper.getHeightWidth().height+50};
            window.ScratchBlocks.Events.disable();
            try { lower.moveBy(target.x-lowerXY.x,target.y-lowerXY.y); }
            finally { window.ScratchBlocks.Events.enable(); }
            ws.resizeContents();
            const original=ws.createTransitionWorkspace;
            window.__keyboardLayoutFixture={lowerId:lower.id,sourceY:lower.getRelativeToSurfaceXY().y};
            ws.createTransitionWorkspace=function(...args) {
                const scene=original.apply(this,args);
                window.__keyboardLayoutScene=scene.workspace;
                return scene;
            };
            return window.__keyboardLayoutFixture;`);
        await caretAt('block', 'control_wait', '', true);
        await keys(Key.ENTER); await keys(...'repeat 10');
        let preview;
        await driver.wait(async () => {
            preview = await driver.executeScript(`const ws=window.__keyboardTestWorkspace;
                const source=ws.getBlockById(arguments[0]);
                const copy=window.__keyboardLayoutScene?.getBlockById(arguments[0]);
                return {sourceY:source?.getRelativeToSurfaceXY().y,
                    sourceOpacity:source?.getSvgRoot().style.opacity,
                    copyY:copy?.getRelativeToSurfaceXY().y};`, fixture.lowerId);
            return preview.copyY > preview.sourceY + 40;
        }, 10000, 'The isolated draft did not reserve space for its native shape');
        expect(preview.sourceY).toBe(fixture.sourceY);
        expect(preview.sourceOpacity).toBe('0');
        expect((await state()).roots).toEqual(before.roots);

        await keys(Key.ESCAPE); await noGhost();
        expect((await state()).roots).toEqual(before.roots);
        expect(await driver.executeScript(`return window.__keyboardTestWorkspace.getBlockById(arguments[0])
            .getRelativeToSurfaceXY().y;`, fixture.lowerId)).toBe(fixture.sourceY);

        await keys(...'repeat 10'); await keys(Key.ENTER); await count(4);
        const acceptedY = await driver.executeScript(`return window.__keyboardTestWorkspace.getBlockById(arguments[0])
            .getRelativeToSurfaceXY().y;`, fixture.lowerId);
        expect(Math.abs(acceptedY - preview.copyY)).toBeLessThan(1);
        await nativeHistory(false); await count(3);
        expect((await state()).roots).toEqual(before.roots);
        expect(await driver.executeScript(`return window.__keyboardTestWorkspace.getBlockById(arguments[0])
            .getRelativeToSurfaceXY().y;`, fixture.lowerId)).toBe(fixture.sourceY);
    }, 90000);

    test.each([['literal', 0.675], ['reporter', 1.5], ['insert', 0.675]])(
        'wide keyboard %s drafts keep columns still until one reversible commit at zoom %s', async (kind, scale) => {
        await typeBlock('say hello', 1);
        for (const [index, query] of ['wait 1 seconds', 'move 10 steps', 'set x to 50', 'think elsewhere', 'show'].entries()) {
            await beginNewScript(); await typeBlock(query, index + 2);
        }
        const fixture = await driver.executeScript(`const ws=window.__keyboardTestWorkspace;
            const types=['looks_say','control_wait','motion_movesteps','motion_setx','looks_think','looks_show'];
            const coordinates=[[100,100],[100,300],[380,60],[380,400],[620,150],[1600,50]];
            const ids=types.map((type,index)=>{const block=ws.getTopBlocks(false).find(b=>b.type===type),
                xy=block.getRelativeToSurfaceXY(),[x,y]=coordinates[index]; block.moveBy(x-xy.x,y-xy.y);return block.id;});
            const original=ws.createTransitionWorkspace;
            ws.createTransitionWorkspace=function(...args){const scene=original.apply(this,args);
                window.__keyboardColumnScene=scene.workspace;return scene;};
            ws.setScale(arguments[0]); return ids;`, scale);
        await painted();
        await caretAt(kind === 'insert' ? 'block' : 'input','looks_say',kind === 'insert' ? '' : 'MESSAGE',true);
        if (kind === 'insert') await keys(Key.ENTER);
        const inspect = copy => driver.executeScript(`const live=window.__keyboardTestWorkspace,
            scene=arguments[1]?window.__keyboardColumnScene:null;
            return arguments[0].map(id=>{const block=scene?.getBlockById(id)||live.getBlockById(id),
                xy=block.getRelativeToSurfaceXY(),size=block.getHeightWidth();
                return {x:xy.x,y:xy.y,width:size.width,height:size.height};});`, fixture, copy);
        const before = await state();
        const original = await inspect(false);
        await driver.executeScript('window.__keyboardTestWorkspace.clearUndo();');
        const word = 'abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyz';
        const wide = kind === 'reporter' ? `join ${word} ${word}` : kind === 'insert' ? `say ${word}` : word;
        const narrow = kind === 'insert' ? 'say hi' : 'hi';
        const enterWide = async () => {
            await keys(...wide);
            await driver.wait(async () => (await inspect(true))[0].width > original[0].width + 100, 10000,
                'The draft did not show the wider candidate');
            await driver.sleep(220); // The presentation uses a 160 ms position tween.
        };
        await enterWide();
        const preview = await inspect(true);
        expect(preview.slice(2)).toEqual(original.slice(2));
        expect(await driver.executeScript(`return arguments[0].slice(2).every(id=>
            !window.__keyboardColumnScene.getBlockById(id));`,fixture)).toBe(true);
        expect(await inspect(false)).toEqual(original);
        expect((await state()).roots).toEqual(before.roots);
        await screenshot(`wide-column-${kind}-${scale}`);

        await chord(Key.CONTROL,'a'); await keys(...narrow); await driver.sleep(220);
        expect((await inspect(true)).slice(2)).toEqual(original.slice(2));
        await keys(Key.ESCAPE); await noGhost();
        expect(await inspect(false)).toEqual(original);
        expect((await state()).roots).toEqual(before.roots);
        await enterWide();
        await keys(Key.ENTER); await count(kind === 'literal' ? 6 : 7); await noGhost();
        const accepted = await inspect(false);
        expect(accepted[2].x).toBeGreaterThan(original[2].x + 60);
        expect(accepted[2].x - original[2].x).toBeCloseTo(accepted[3].x - original[3].x, 3);
        for (const index of [2,3,4]) expect(accepted[index].y).toBe(original[index].y);
        expect(accepted[2].x).toBeGreaterThanOrEqual(accepted[0].x + accepted[0].width + 63.9);
        expect(accepted[4].x).toBeGreaterThanOrEqual(Math.max(accepted[2].x+accepted[2].width,
            accepted[3].x+accepted[3].width) + 63.9);
        expect(accepted[5]).toEqual(original[5]);
        const acceptedRoots = (await state()).roots;
        expect(await driver.executeScript(`return [...new Set(window.__keyboardTestWorkspace.undoStack_
            .filter(event=>event.recordUndo).map(event=>event.group))].length;`)).toBe(1);
        await nativeHistory(false); await count(6);
        expect(await inspect(false)).toEqual(original);
        expect((await state()).roots).toEqual(before.roots);
        await nativeHistory(true); await count(kind === 'literal' ? 6 : 7);
        expect(await inspect(false)).toEqual(accepted);
        expect((await state()).roots).toEqual(acceptedRoots);
    }, 90000);

    test('a resting new-script placeholder leaves the right column stationary and uncopied', async () => {
        await typeBlock('move 10 steps',1);
        await beginNewScript(); await typeBlock('wait 1 seconds',2);
        const point = await driver.executeScript(`const ws=window.__keyboardTestWorkspace;
            ws.getTopBlocks(false).forEach((block,index)=>{const xy=block.getRelativeToSurfaceXY();
                block.moveBy(500-xy.x,100+index*250-xy.y);});
            const original=ws.createTransitionWorkspace;
            ws.createTransitionWorkspace=function(...args){const scene=original.apply(this,args);
                window.__keyboardColumnScene=scene.workspace;return scene;};
            const m=ws.getCanvas().getScreenCTM();return {x:Math.round(m.e+320*m.a),y:Math.round(m.f+100*m.d)};`);
        await painted();
        const original = await state();
        await driver.executeScript('window.__keyboardTestWorkspace.clearUndo();');
        await driver.actions().move({origin:'viewport',...point}).click().perform();
        await settledSpacer('caret');
        expect(await driver.executeScript(`const ws=window.__keyboardTestWorkspace,scene=window.__keyboardColumnScene;
            return ws.getTopBlocks(false).every(block=>!scene.getBlockById(block.id));`)).toBe(true);
        expect(await driver.executeScript(`const ws=window.__keyboardTestWorkspace;
            return {positions:ws.getTopBlocks(false).map(b=>b.getRelativeToSurfaceXY().x),undo:ws.undoStack_.length};`))
            .toEqual({positions:[500,500],undo:0});
        expect((await state()).roots).toEqual(original.roots);
        await keys(Key.ESCAPE,Key.ESCAPE); await noGhost();
        expect(await driver.executeScript('return window.__keyboardTestWorkspace.getTopBlocks(false).map(b=>b.getRelativeToSurfaceXY().x);'))
            .toEqual([500,500]);
    },90000);

    test('keyboard previews retain expanded and collapsed Scratch comments instead of curved warning bubbles', async () => {
        await typeBlock('move 10 steps',1);
        await typeBlock('wait 1 seconds',2);
        await driver.executeScript(`const ws=window.__keyboardTestWorkspace,blocks=ws.getAllBlocks(false)
            .filter(b=>!b.isShadow());
            blocks.forEach((block,i)=>{block.setCommentText('Existing comment '+i,'preview-comment-'+i,420,100+i*180,i===1);
                block.comment.setSize(210,130);});ws.clearUndo();`);
        await painted();
        const inspect = copy => driver.executeScript(`const live=window.__keyboardTestWorkspace;
            const ws=arguments[0]?Object.values(window.ScratchBlocks.Workspace.WorkspaceDB_)
                .find(w=>w.options.parentWorkspace===live && w.isTransitionWorkspace):live;
            return ws.getAllBlocks(false).filter(b=>b.comment).map(b=>{const c=b.comment;
                const xy=c.getXY(),blockXY=b.getRelativeToSurfaceXY();
                return {id:b.id,text:c.getText(),offset:{x:xy.x-blockXY.x,y:Math.round((xy.y-blockXY.y)*1000)/1000},
                    size:c.getHeightWidth(),minimized:c.isMinimized(),
                    native:c.bubble_ instanceof window.ScratchBlocks.ScratchBubble,
                    readonly:!!c.textarea_?.readOnly};}).sort((a,b)=>a.id.localeCompare(b.id));`,copy);
        const original = await inspect(false);
        await caretAt('block','motion_movesteps','',true); await keys(Key.ENTER);
        await keys(...'say hello'); await painted();
        const preview = await inspect(true);
        expect(preview.map(c=>({...c,readonly:false}))).toEqual(original);
        expect(preview.every(c=>c.readonly && c.native)).toBe(true);
        expect(await driver.findElements(By.css('.blocklyTransitionWorkspace .blocklyBubbleText'))).toHaveLength(0);
        await screenshot('native-comment-preview');
        await keys(Key.ESCAPE,Key.ESCAPE,Key.ESCAPE); await strictlyNoPreview();
        expect(await inspect(false)).toEqual(original);
        expect(await driver.executeScript('return window.__keyboardTestWorkspace.undoStack_.length;')).toBe(0);
    });

    test('changes draft shape without rebuilding the retained tail or losing shadow input defaults', async () => {
        await typeBlock('move 10 steps', 1);
        await typeBlock('wait 2 seconds', 2);
        const source = (await state()).roots;
        await driver.executeScript(`const ws=window.__keyboardTestWorkspace;
            const original=ws.createTransitionWorkspace;
            ws.createTransitionWorkspace=function(...args) {
                const scene=original.apply(this,args);
                window.__keyboardDraftScene=scene.workspace;
                window.__keyboardDraftOriginals=scene.workspace.getAllBlocks(false).filter(block=>!block.isShadow());
                return scene;
            };`);
        await keys(Key.ARROW_UP, Key.ARROW_UP, Key.ENTER);
        for (const query of ['repeat 10', 'say hello', 'if 1 < 2 then', 'wait 3 seconds']) {
            await chord(Key.CONTROL, 'a'); await keys(...query);
            expect((await state()).roots).toEqual(source);
            expect(await driver.executeScript(`return window.__keyboardDraftOriginals.every(block=>
                window.__keyboardDraftScene.getBlockById(block.id)===block);`)).toBe(true);
            expect(await driver.executeScript(`const ws=window.__keyboardDraftScene;
                const root=ws.getTopBlocks(false)[0];
                return root.getNextBlock().getNextBlock().type;`)).toBe('control_wait');
        }
        await keys(Key.ESCAPE); await noGhost();
        await keys(Key.HOME, Key.ARROW_RIGHT, Key.ENTER);
        for (const query of ['2 + 3', '4 * 5', '9 / 3']) {
            if (await driver.findElements(By.css('[aria-label="Type a Scratch block"]:not([hidden])'))
                .then(elements => elements.length && elements[0].isDisplayed())) await chord(Key.CONTROL, 'a');
            await keys(...query);
            expect((await state()).roots).toEqual(source);
            expect(await driver.executeScript(`const ws=window.__keyboardDraftScene;
                const root=ws.getTopBlocks(false)[0];
                return root.getInput('STEPS').connection.getShadowDom().querySelector('field').textContent;`)).toBe('10');
        }
        await keys(Key.ENTER); await count(3); await noGhost();
        await nativeHistory(false); await count(2);
        expect((await state()).roots).toEqual(source);
        await nativeHistory(true); await count(3);
        expect((await state()).roots[0].inputs.STEPS.type).toBe('operator_divide');
    }, 90000);

    test('reveals the caret immediately when keyboard mode resumes after a native workspace pan', async () => {
        await typeBlock('move 10 steps', 1);
        for (let index = 0; index < 20; index++) await typeBlock('wait 1 seconds', index + 2);
        const before = (await state()).roots;
        await keys(Key.ESCAPE, Key.ESCAPE);
        expect(await driver.findElement(By.xpath('//button[text()="Keyboard"]')).getAttribute('aria-pressed'))
            .toBe('false');
        await driver.actions().scroll(850, 400, 0, -1800).perform();
        await painted();
        const outside = await driver.executeScript(`const ws=window.__keyboardTestWorkspace;
            const selected=window.ScratchBlocks.selected.svgPath_.getBoundingClientRect();
            const svg=ws.getParentSvg().getBoundingClientRect();
            return selected.top > svg.bottom;`);
        expect(outside).toBe(true);
        await driver.executeScript(`window.addEventListener('click', () => requestAnimationFrame(() => {
            const ws=window.__keyboardTestWorkspace;
            const caret=document.querySelector('[data-position]').getBoundingClientRect();
            const svg=ws.getParentSvg().getBoundingClientRect(); const m=ws.getMetrics();
            window.__keyboardFirstCaretFrame={top:caret.top,bottom:caret.bottom,left:caret.left,right:caret.right,
                minX:svg.left+m.absoluteLeft+m.flyoutWidth,maxX:svg.right-18,minY:svg.top,maxY:svg.bottom-52};
        }),{once:true,capture:true});`);
        await driver.findElement(By.xpath('//button[text()="Keyboard"]')).click();
        await painted();
        const box = await driver.executeScript('return window.__keyboardFirstCaretFrame;');
        fs.writeFileSync(path.join(artifacts,'offscreen-enable.json'),JSON.stringify(box,null,2));
        expect(box.left).toBeGreaterThanOrEqual(box.minX);
        expect(box.right).toBeLessThanOrEqual(box.maxX);
        expect(box.top).toBeGreaterThanOrEqual(box.minY);
        expect(box.bottom).toBeLessThanOrEqual(box.maxY);
        expect((await state()).roots).toEqual(before);
    }, 90000);

    test.each([['Backspace', Key.BACK_SPACE], ['Delete', Key.DELETE]])(
        'starts native field editing with deletion key %s', async (name, deletion) => {
        await typeBlock('move 10 steps', 1);
        await keys(Key.HOME, Key.ARROW_RIGHT, Key.F2, deletion);
        const fields = await driver.findElements(By.css('input.blocklyHtmlInput'));
        expect(fields).toHaveLength(1);
        expect(await fields[0].getAttribute('value')).toBe('');
        await keys('7', Key.ENTER);
        await driver.wait(async () => (await state()).roots[0].inputs.STEPS.fields.NUM === '7', 10000);
        await count(1);
        // Two separately settled text changes use Scratch's existing history
        // granularity. Keyboard mode must not replace or coalesce that history.
        await nativeHistory(false);
        await driver.wait(async () => (await state()).roots[0].inputs.STEPS.fields.NUM === '', 10000);
        await nativeHistory(false);
        await driver.wait(async () => (await state()).roots[0].inputs.STEPS.fields.NUM === '10', 10000);
        await nativeHistory(true);
        await driver.wait(async () => (await state()).roots[0].inputs.STEPS.fields.NUM === '', 10000);
        await nativeHistory(true);
        await driver.wait(async () => (await state()).roots[0].inputs.STEPS.fields.NUM === '7', 10000);
    }, 90000);

    test('undoes a Tab completion as text without losing the typed prefix or editing the project', async () => {
        await typeBlock('move 10 steps', 1);
        const before = (await state()).roots;
        await keys(...'wai');
        const input = await driver.findElement(By.css('[aria-label="Type a Scratch block"]'));
        await keys(Key.TAB);
        const completed = await input.getAttribute('value');
        expect(completed).toMatch(/^wait /);
        await nativeHistory(false); await painted();
        expect(await input.getAttribute('value')).toBe('wai');
        await nativeHistory(true); await painted();
        expect(await input.getAttribute('value')).toBe(completed);
        expect((await state()).roots).toEqual(before);
        await keys(Key.ESCAPE); await noGhost();
    }, 90000);

    test.each([1100, 1024])('keeps a long-expression composition panel inside a narrow script editor at %spx', async width => {
        await driver.manage().window().setRect({width,height:900});
        await painted();
        await typeBlock('when flag clicked', 1);
        await keys(...'move 1 + 2 + 3 + 4 + 5 + 6 + 7 + 8 steps');
        const box = await driver.executeScript(`const ws=window.__keyboardTestWorkspace;
            const svg=ws.getParentSvg().getBoundingClientRect(); const m=ws.getMetrics();
            const input=document.querySelector('[aria-label="Type a Scratch block"]');
            const rect=input.parentElement.getBoundingClientRect();
            const toolbar=document.querySelector('[data-keyboard-authoring] button').parentElement.getBoundingClientRect();
            return {left:rect.left,right:rect.right,width:rect.width,top:rect.top,bottom:rect.bottom,
                toolbarLeft:toolbar.left,toolbarRight:toolbar.right,
                availableLeft:svg.left+m.absoluteLeft+m.flyoutWidth,availableRight:svg.right-18,
                availableTop:svg.top,availableBottom:svg.bottom-52};`);
        fs.writeFileSync(path.join(artifacts,`narrow-composition-${width}.json`),JSON.stringify(box,null,2));
        expect(box.left).toBeGreaterThanOrEqual(box.availableLeft);
        expect(box.right).toBeLessThanOrEqual(box.availableRight);
        expect(box.top).toBeGreaterThanOrEqual(box.availableTop);
        expect(box.bottom).toBeLessThanOrEqual(box.availableBottom);
        expect(box.toolbarLeft).toBeGreaterThanOrEqual(box.availableLeft);
        expect(box.toolbarRight).toBeLessThanOrEqual(box.availableRight);
        await screenshot(`narrow-expression-draft-${width}`);
        await keys(Key.ENTER); await count(9); await noGhost();
        const before = (await state()).roots;
        await nativeHistory(false); await count(1);
        await nativeHistory(true); await count(9);
        expect((await state()).roots).toEqual(before);
    }, 90000);

    test('copies only the edited stack and restores its comment when clicking an unrelated live script', async () => {
        await typeBlock('move 10 steps', 1);
        await typeBlock('wait 1 seconds', 2);
        await beginNewScript();
        await typeBlock('say other', 3);
        // Keep the unrelated script out of both the receiving stack's
        // expansion and its right-hand composition panel, using a native drag.
        const otherStart = await driver.executeScript(`const block=window.__keyboardTestWorkspace.getAllBlocks(false)
            .find(item=>item.type==='looks_say'); const box=block.svgPath_.getBoundingClientRect();
            return {id:block.id,x:Math.round(box.left+8),y:Math.round(box.top+18)};`);
        await driver.actions().move({origin:'viewport',x:otherStart.x,y:otherStart.y}).press()
            .move({origin:'viewport',x:otherStart.x+350,y:otherStart.y+300,duration:250}).release().perform();
        await painted();
        const waitPath = await driver.executeScript(`return window.__keyboardTestWorkspace.getAllBlocks(false)
            .find(block=>block.type==='control_wait').svgPath_;`);
        await driver.actions().mouseMove(waitPath,{x:8,y:18}).contextClick().perform();
        await driver.wait(until.elementLocated(By.xpath(
            '//div[contains(@class,"goog-menuitem")][contains(.,"Add Comment")]')), 10000).click();
        const comment = await driver.wait(until.elementLocated(By.css('.scratchCommentTextarea')), 10000);
        await comment.sendKeys('Keep this explanation');
        await driver.findElement(By.css('input[placeholder="Project title here"]')).click();
        const before = (await state()).roots;
        const source = await driver.executeScript(`return window.ScratchBlocks.Xml.domToText(
            window.ScratchBlocks.Xml.workspaceToDom(window.__keyboardTestWorkspace));`);
        await driver.findElement(By.xpath('//button[text()="Keyboard"]')).click();
        await caretAt('block','motion_movesteps','',true);
        await keys(Key.ENTER, ...'repeat 10');
        const during = await driver.executeScript(`const ws=window.__keyboardTestWorkspace;
            const copy=Object.values(window.ScratchBlocks.Workspace.WorkspaceDB_)
                .find(candidate=>candidate.options.readOnly && candidate.options.parentWorkspace===ws);
            const wait=ws.getAllBlocks(false).find(block=>block.type==='control_wait');
            const other=ws.getAllBlocks(false).find(block=>block.type==='looks_say');
            return {copyCount:copy.getAllBlocks(false).filter(block=>!block.isShadow()).length,
                copiesOther:!!copy.getBlockById(other.id),otherOpacity:other.getSvgRoot().style.opacity,
                commentOpacity:wait.comment.bubble_.getSvgRoot().style.opacity,
                copiedComment:copy.getBlockById(wait.id).getCommentText(),
                source:window.ScratchBlocks.Xml.domToText(window.ScratchBlocks.Xml.workspaceToDom(ws))};`);
        expect(during).toMatchObject({copyCount:3,copiesOther:false,otherOpacity:'',commentOpacity:'0',
            copiedComment:'Keep this explanation',source});
        expect((await state()).roots).toEqual(before);
        await screenshot('scoped-draft-comment');
        const otherPath = await driver.executeScript(`return window.__keyboardTestWorkspace.getAllBlocks(false)
            .find(block=>block.type==='looks_say').svgPath_;`);
        expect(await driver.executeScript(`const path=arguments[0],box=path.getBoundingClientRect();
            return path.parentNode.contains(document.elementFromPoint(box.left+8,box.top+18));`,otherPath)).toBe(true);
        await driver.actions().mouseMove(otherPath,{x:8,y:18}).click().perform();
        await painted(); await noGhost();
        expect((await state()).caret).toBe(`block:${otherStart.id}::`);
        expect((await state()).roots).toEqual(before);
        expect(await driver.executeScript(`return window.__keyboardTestWorkspace.getAllBlocks(false)
            .find(block=>block.type==='control_wait').comment.bubble_.getSvgRoot().style.opacity;`)).toBe('');
        expect(await driver.executeScript('return window.vm.runtime.threads.length;')).toBe(0);
        await keys(Key.END); await typeBlock('wait 2 seconds', 4);
        await nativeHistory(false); await count(3);
        expect((await state()).roots).toEqual(before);
        await nativeHistory(true); await count(4);
    }, 90000);

    test('anchors composition horizontally and reserves space only for taller candidate shapes', async () => {
        await typeBlock('when flag clicked', 1);
        await keys(Key.ENTER);
        const before = (await state()).roots;
        const samples = [];
        for (const query of ['', 'm', 'move 10 steps', 'move 1 + 2 + 3 + 4 + 5 + 6 + 7 + 8 steps',
            'repeat 10', 'if 1 < 2 then', 'zzzzzz', 'move 10 steps']) {
            await chord(Key.CONTROL, 'a');
            if (query) await keys(...query);
            else await keys(Key.BACK_SPACE);
            samples.push(await driver.executeScript(`
                const input=document.querySelector('[aria-label="Type a Scratch block"]');
                const rect=input.getBoundingClientRect();
                const caret=document.querySelector('[data-position]').getBoundingClientRect();
                return {query:input.value,x:rect.left,y:rect.top,width:rect.width,
                    caretX:caret.left,caretY:caret.top,caretWidth:caret.width,caretHeight:caret.height,
                    options:document.querySelectorAll('[role="option"]').length};`));
            if (query.startsWith('move 1 +')) await screenshot('composition-wide-typing');
        }
        fs.writeFileSync(path.join(artifacts,'composition-typing-positions.json'),JSON.stringify(samples,null,2));
        expect((await state()).roots).toEqual(before);
        let bottom = samples[0].caretY + samples[0].caretHeight;
        for (const sample of samples) {
            bottom = Math.max(bottom, sample.caretY + sample.caretHeight);
            expect(Math.abs(sample.x - samples[0].x)).toBeLessThan(2);
            expect(Math.abs(sample.y - samples[0].y -
                (bottom - samples[0].caretY - samples[0].caretHeight))).toBeLessThan(2);
            expect(sample.y).toBeGreaterThan(sample.caretY + sample.caretHeight);
        }
        await keys(Key.ESCAPE); await noGhost();
    }, 90000);

    test('keeps the input steady when an above-draft suggestion list changes height', async () => {
        await typeBlock('when flag clicked', 1);
        for (let index = 0; index < 14; index++) await typeBlock('wait 1 seconds', index + 2);
        await keys(Key.ENTER);
        const samples = [];
        for (const query of ['m', 'move 10 steps', 'zzzzzz', 'repeat 10', 'm']) {
            await chord(Key.CONTROL,'a'); await keys(...query);
            samples.push(await driver.executeScript(`
                const input=document.querySelector('[aria-label="Type a Scratch block"]');
                const field=input.getBoundingClientRect(); const panel=input.parentElement.getBoundingClientRect();
                const caret=document.querySelector('[data-position]').getBoundingClientRect();
                return {query:input.value,x:field.left,y:field.top,top:panel.top,bottom:panel.bottom,
                    side:input.parentElement.dataset.placement,caretY:caret.top,
                    options:document.querySelectorAll('[role="option"]').length};`));
        }
        fs.writeFileSync(path.join(artifacts,'composition-above-positions.json'),JSON.stringify(samples,null,2));
        await screenshot('composition-above-draft');
        expect(samples[0].side).toBe('above');
        for (const sample of samples) {
            expect(sample.side).toBe('above');
            expect(Math.abs(sample.x - samples[0].x)).toBeLessThan(2);
            expect(Math.abs(sample.y - samples[0].y)).toBeLessThan(2);
            expect(sample.bottom).toBeLessThan(sample.caretY);
        }
        await keys(Key.ESCAPE); await noGhost(); await count(15);
    }, 90000);

    test('ranks a fitting short query first and Ctrl Space completes text without inserting', async () => {
        await keys('m');
        const first = await driver.wait(until.elementLocated(By.css('[role="option"]')), 10000);
        expect((await first.getText()).toLowerCase()).toMatch(/^move\b/);
        expect(await first.getAttribute('aria-disabled')).toBe('false');
        const input = await driver.findElement(By.css('[aria-label="Type a Scratch block"]'));
        await chord(Key.CONTROL, Key.SPACE);
        const completed = await input.getAttribute('value');
        expect(completed.toLowerCase()).toMatch(/^move\b/);
        await count(0);
        await nativeHistory(false); await painted();
        expect(await input.getAttribute('value')).toBe('m');
        await nativeHistory(true); await painted();
        expect(await input.getAttribute('value')).toBe(completed);
        await keys(Key.ENTER); await count(1); await noGhost();
        expect((await state()).roots[0].type).toBe('motion_movesteps');
    }, 90000);

    test('self-sprite sensing completion creates native original-sprite reporters without changing the palette', async () => {
        const menu = () => driver.executeScript(`const ws=window.__keyboardTestWorkspace,
            source=ws.getFlyout().getWorkspace().getAllBlocks(false).find(b=>b.type==='sensing_of');
            return source.getInputTargetBlock('OBJECT').getField('OBJECT').getOptions().map(o=>o[1]);`);
        expect(await menu()).not.toContain('Sprite1');
        const properties = ['x position', 'y position', 'direction', 'costume name', 'size', 'volume'];
        for (let i = 0; i < properties.length; i++) {
            await beginNewScript();
            await acceptBlock(`${properties[i]} of Sprite1`, i + 1);
            await keys(Key.HOME);
            const roots = (await state()).roots;
            expect(roots.some(root=>root.type==='sensing_of' && root.fields.PROPERTY===properties[i] &&
                root.inputs.OBJECT.fields.OBJECT==='Sprite1')).toBe(true);
        }
        const before = (await state()).roots;
        await nativeHistory(false); await count(5);
        await nativeHistory(true); await count(6); expect((await state()).roots).toEqual(before);
        expect(await menu()).not.toContain('Sprite1');
        // Evaluate the actual native primitives with a clone as the caller:
        // explicit Sprite1 still resolves the original, not the clone's motion.
        expect(await driver.executeScript(`const vm=window.vm,original=vm.editingTarget;
            original.setXY(73,41); const clone=original.makeClone(); vm.runtime.addTarget(clone);
            try { clone.setXY(-99,-88);
                const read=vm.runtime.getOpcodeFunction('sensing_of');
                return {x:read({PROPERTY:'x position',OBJECT:'Sprite1'},{target:clone}),
                    y:read({PROPERTY:'y position',OBJECT:'Sprite1'},{target:clone}),cloneX:clone.x};
            } finally { vm.runtime.disposeTarget(clone); }`)).toEqual({x:73,y:41,cloneX:-99});
        await noGhost();
    }, 90000);

    test.each(['resting', 'draft', 'menu', 'mouse', 'mouse-menu'])('block paste keeps its placement owner at a new script (%s)', async mode => {
        // Returning from the project page recreates Keyboard's workspace while
        // the already initialized addon may still own an earlier key listener.
        await helper.clickText('See Project Page');
        await helper.clickText('See inside');
        await driver.executeScript('window.__keyboardTestWorkspace=window.ScratchBlocks.getMainWorkspace();');
        await enableKeyboard();
        await typeBlock('move 10 steps', 1);
        await keys(Key.HOME);
        const original = (await state()).roots;
        const oldIds = await driver.executeScript('return window.__keyboardTestWorkspace.getTopBlocks(false).map(b=>b.id);');
        await chord(Key.CONTROL, 'c');
        await keys(Key.ARROW_LEFT, Key.ARROW_LEFT);
        expect((await state()).caret.startsWith('workspace:')).toBe(true);
        const target = await driver.executeScript(`const box=document.querySelector('[data-position]').getBoundingClientRect(),
            m=window.__keyboardTestWorkspace.getCanvas().getScreenCTM();
            return {x:(box.left-m.e)/m.a,y:(box.top-m.f)/m.d};`);
        if (mode === 'draft') await keys(Key.ENTER);
        const mouseMode = mode.startsWith('mouse');
        if (mouseMode) await driver.findElement(By.xpath('//button[text()="Keyboard"]')).click();
        // Leave the actual mouse far from the caret, making addon takeover visible.
        await driver.actions().move({origin:'viewport',x:1250,y:250}).perform();
        if (mode.endsWith('menu')) {
            await driver.actions().move({origin:'viewport',x:900,y:500}).contextClick().perform();
            await helper.clickText('Paste');
        } else await chord(Key.CONTROL, 'v');
        await count(2);
        // The addon starts its drag after a 10 ms timer, not during paste itself.
        await driver.sleep(100);
        const after = await driver.executeScript(`const ws=window.__keyboardTestWorkspace,
            added=ws.getTopBlocks(false).find(b=>!arguments[0].includes(b.id));
            return {dragging:!!ws.isDragging(),xy:added.getRelativeToSurfaceXY(),id:added.id};`, oldIds);
        expect(after.dragging).toBe(mode === 'mouse');
        if (mouseMode) {
            expect(Math.abs(after.xy.x - target.x)).toBeGreaterThan(50);
            await driver.actions().move({origin:'viewport',x:650,y:280}).click().perform();
            await painted();
            expect(await driver.executeScript('return !!window.__keyboardTestWorkspace.isDragging();')).toBe(false);
            return;
        }
        expect(after.xy.x).toBeCloseTo(target.x, 1);
        expect(after.xy.y).toBeCloseTo(target.y, 1);
        expect((await state()).focus).toBe('Scratch keyboard editor');
        expect((await state()).caret).toBe(`block:${after.id}::`);
        await noGhost();
        const pasted = (await state()).roots;
        await nativeHistory(false); await count(1); expect((await state()).roots).toEqual(original);
        await nativeHistory(true); await count(2); expect((await state()).roots).toEqual(pasted);
    }, 90000);

    test('copies cuts pastes and duplicates native subtrees at structural carets with native history', async () => {
        await typeBlock('move 2 + 3 steps', 2);
        const original = (await state()).roots;
        await keys(Key.HOME);
        const operator = await driver.executeScript(`return window.__keyboardTestWorkspace.getAllBlocks(false)
            .find(block=>block.type==='operator_add').svgPath_;`);
        await driver.actions().mouseMove(operator).click().perform();
        await painted(); await expectCaret('block', 'operator_add');
        await chord(Key.CONTROL, 'c');
        await chord(Key.CONTROL, 'v');
        await count(2);
        expect((await state()).help).toContain('does not fit');
        await keys(Key.DELETE); await count(1);
        await expectCaret('input', 'motion_movesteps', 'STEPS');
        await chord(Key.CONTROL, 'v'); await count(2); await noGhost();
        expect((await state()).roots).toEqual(original);
        await nativeHistory(false); await count(1);
        await nativeHistory(true); await count(2);
        expect((await state()).roots).toEqual(original);

        await keys(Key.HOME);
        await expectCaret('block', 'motion_movesteps');
        await chord(Key.CONTROL, 'd'); await count(4); await noGhost();
        const duplicated = (await state()).roots;
        expect(duplicated).toHaveLength(2);
        expect(duplicated[0]).toEqual(duplicated[1]);
        await nativeHistory(false); await count(2);
        await nativeHistory(true); await count(4);
        expect((await state()).roots).toEqual(duplicated);
        await keys(Key.HOME);
        await chord(Key.CONTROL, 'x'); await count(2); await noGhost();
        await nativeHistory(false); await count(4);
        expect((await state()).roots).toEqual(duplicated);
    }, 90000);

    test('selects an exact sibling range and copies it as one reversible native stack', async () => {
        await fourCommandStack();
        const original = (await state()).roots;
        await caretAt('block', 'looks_say', '', true);
        await chord(Key.SHIFT, Key.ARROW_DOWN);
        const selection = await driver.executeScript(`const caret=document.querySelector('[data-position]');
            const paths=caret.querySelectorAll('[data-caret-paths] > path');
            return {kind:caret.dataset.kind,count:Number(caret.dataset.rangeCount),paths:paths.length,
                contour:caret.dataset.rangeContour,masked:Boolean(paths[0].parentNode.getAttribute('mask')),
                revision:Number(caret.dataset.renderRevision),focus:window.ScratchBlocks.selected.type};`);
        expect(selection).toEqual({kind: 'range', count: 2, paths: 2, contour: 'silhouette', masked: true,
            revision: expect.any(Number), focus: 'control_wait'});
        await driver.sleep(250);
        expect(await driver.executeScript(`return Number(document.querySelector('[data-position]')
            .dataset.renderRevision);`)).toBe(selection.revision);
        await chord(Key.CONTROL, 'c');
        await beginNewScript();
        await chord(Key.CONTROL, 'v'); await count(6); await noGhost();
        const roots = (await state()).roots;
        expect(roots).toHaveLength(2);
        expect([roots[1].type, roots[1].next.type]).toEqual(['looks_say', 'control_wait']);
        expect(roots[1].next.next).toBeNull();
        await nativeHistory(false); await count(4);
        expect((await state()).roots).toEqual(original);
        await nativeHistory(true); await count(6);
        expect((await state()).roots[1]).toEqual(roots[1]);
    }, 90000);

    test('rebuilds a cached range contour for zoom and pan but not while the viewport is idle', async () => {
        await fourCommandStack();
        await caretAt('block', 'looks_say', '', true);
        await chord(Key.SHIFT, Key.ARROW_DOWN);
        const inspect = () => driver.executeScript(`const caret=document.querySelector('[data-position]'),
            paths=[...caret.querySelectorAll('[data-caret-paths] > path')],box=caret.getBoundingClientRect(),
            ws=window.__keyboardTestWorkspace;
            return {revision:Number(caret.dataset.renderRevision),scale:ws.scale,scrollX:ws.scrollX,scrollY:ws.scrollY,
                count:paths.length,contour:caret.dataset.rangeContour,
                masked:Boolean(paths[0].parentNode.getAttribute('mask')),left:box.left,top:box.top,
                width:box.width,height:box.height,transforms:paths.map(path=>path.getAttribute('transform'))};`);
        const initial = await inspect();
        expect(initial).toMatchObject({count:2,contour:'silhouette',masked:true});
        await driver.sleep(500);
        expect((await inspect()).revision).toBe(initial.revision);

        await driver.executeScript(`const ws=window.__keyboardTestWorkspace; ws.setScale(ws.scale * 1.2);`);
        await driver.wait(async () => (await inspect()).revision > initial.revision, 10000,
            'Range contour did not follow the changed native workspace scale');
        const zoomed = await inspect();
        expect(zoomed.scale).toBeGreaterThan(initial.scale);
        expect(zoomed.width).toBeGreaterThan(initial.width);
        expect(zoomed.transforms).not.toEqual(initial.transforms);
        await driver.sleep(500);
        expect((await inspect()).revision).toBe(zoomed.revision);

        await driver.executeScript(`const ws=window.__keyboardTestWorkspace,metrics=ws.getMetrics();
            ws.scrollbar.set(-ws.scrollX + 48 - metrics.contentLeft,
                -ws.scrollY + 32 - metrics.contentTop);`);
        await driver.wait(async () => (await inspect()).revision > zoomed.revision, 10000,
            'Range contour did not follow the changed native workspace scroll');
        const panned = await inspect();
        expect([panned.scrollX,panned.scrollY]).not.toEqual([zoomed.scrollX,zoomed.scrollY]);
        expect([panned.left,panned.top]).not.toEqual([zoomed.left,zoomed.top]);
        expect(panned).toMatchObject({count:2,contour:'silhouette',masked:true});
        await screenshot('range-outline-zoom-pan-cache');
    }, 90000);

    test('cuts a middle sibling range with native healing and exact Undo Redo topology', async () => {
        await fourCommandStack();
        const original = (await state()).roots;
        await caretAt('block', 'looks_say', '', true);
        await chord(Key.SHIFT, Key.ARROW_DOWN);
        await chord(Key.CONTROL, 'x'); await count(2); await noGhost();
        let root = (await state()).roots[0];
        expect([root.type, root.next.type]).toEqual(['motion_movesteps', 'motion_changexby']);
        expect(root.next.next).toBeNull();
        await nativeHistory(false); await count(4);
        expect((await state()).roots).toEqual(original);
        await nativeHistory(true); await count(2);
        root = (await state()).roots[0];
        expect([root.type, root.next.type]).toEqual(['motion_movesteps', 'motion_changexby']);

        await nativeHistory(false); await count(4);
        await caretAt('block', 'looks_say');
        await chord(Key.SHIFT, Key.ARROW_DOWN);
        await keys(Key.BACK_SPACE); await count(2); await noGhost();
        await expectCaret('block', 'motion_movesteps');
        await nativeHistory(false); await count(4);
        expect((await state()).roots).toEqual(original);

        await caretAt('block', 'looks_say');
        await chord(Key.SHIFT, Key.ARROW_DOWN);
        await keys(Key.DELETE); await count(2); await noGhost();
        await expectCaret('gap', 'motion_movesteps');
        await nativeHistory(false); await count(4);
        expect((await state()).roots).toEqual(original);
    }, 90000);

    test('keeps ranges inside one C-mouth chain while a selected C block retains its native body', async () => {
        await typeBlock('repeat 2', 1);
        await typeBlock('say inside', 2);
        await typeBlock('wait 1 seconds', 3);
        await caretAt('gap', 'control_repeat');
        await typeBlock('change x by 10', 4);

        await caretAt('block', 'looks_say', '', true);
        await chord(Key.SHIFT, Key.ARROW_DOWN);
        await chord(Key.SHIFT, Key.ARROW_DOWN); // The outer continuation is not a sibling of this body.
        expect(await driver.executeScript(`const caret=document.querySelector('[data-position]');
            return [Number(caret.dataset.rangeCount),window.ScratchBlocks.selected.type];`))
            .toEqual([2, 'control_wait']);
        await chord(Key.SHIFT, Key.ARROW_UP);
        expect(await driver.executeScript(`const caret=document.querySelector('[data-position]');
            return [caret.dataset.kind,window.ScratchBlocks.selected.type];`)).toEqual(['block', 'looks_say']);

        await caretAt('block', 'control_repeat', '', true);
        await chord(Key.SHIFT, Key.ARROW_DOWN);
        await chord(Key.CONTROL, 'c');
        await beginNewScript();
        await keys(Key.ESCAPE); await chord(Key.CONTROL, 'v'); await count(8); await noGhost();
        const copied = (await state()).roots[1];
        expect(copied.type).toBe('control_repeat');
        expect(copied.inputs.SUBSTACK.type).toBe('looks_say');
        expect(copied.inputs.SUBSTACK.next.type).toBe('control_wait');
        expect(copied.next.type).toBe('motion_changexby');
        await nativeHistory(false); await count(4);
        await nativeHistory(true); await count(8);
    }, 90000);

    test('Ctrl A selects only the current structural statement chain', async () => {
        await fourCommandStack();
        const beforeHistory = await driver.executeScript('return window.__keyboardTestWorkspace.undoStack_.length;');
        await caretAt('block', 'looks_say', '', true);
        await chord(Key.CONTROL, 'a'); await noGhost();
        expect(await driver.executeScript(`const caret=document.querySelector('[data-position]');
            return [caret.dataset.kind,Number(caret.dataset.rangeCount),window.ScratchBlocks.selected.type,
                window.__keyboardTestWorkspace.undoStack_.length];`))
            .toEqual(['range', 4, 'motion_changexby', beforeHistory]);

        await chord(Key.CONTROL, 'c');
        await beginNewScript();
        await keys(Key.ESCAPE); await chord(Key.CONTROL, 'v'); await count(8); await noGhost();
        let copied = (await state()).roots[1];
        expect([copied.type, copied.next.type, copied.next.next.type, copied.next.next.next.type])
            .toEqual(['motion_movesteps', 'looks_say', 'control_wait', 'motion_changexby']);

        await nativeHistory(false); await count(4);
        await caretAt('block', 'control_wait', '', true);
        await chord(Key.CONTROL, 'a');
        expect(await driver.executeScript(`const caret=document.querySelector('[data-position]');
            return [caret.dataset.kind,Number(caret.dataset.rangeCount),window.ScratchBlocks.selected.type];`))
            .toEqual(['range', 4, 'motion_changexby']);
        copied = (await state()).roots[0];
        expect(copied.next.next.next.type).toBe('motion_changexby');
    }, 90000);

    test('Ctrl A inside a C mouth selects its body without crossing to the owner or continuation', async () => {
        await typeBlock('repeat 2', 1);
        await typeBlock('say inside', 2);
        await typeBlock('wait 1 seconds', 3);
        await caretAt('gap', 'control_repeat');
        await typeBlock('change x by 10', 4);
        await caretAt('block', 'looks_say', '', true);
        await chord(Key.CONTROL, 'a'); await noGhost();
        expect(await driver.executeScript(`const caret=document.querySelector('[data-position]');
            return [caret.dataset.kind,Number(caret.dataset.rangeCount),window.ScratchBlocks.selected.type];`))
            .toEqual(['range', 2, 'control_wait']);
        await chord(Key.CONTROL, 'c');
        await beginNewScript();
        await keys(Key.ESCAPE); await chord(Key.CONTROL, 'v'); await count(6); await noGhost();
        const copied = (await state()).roots[1];
        expect([copied.type, copied.next.type]).toEqual(['looks_say', 'control_wait']);
        expect(copied.next.next).toBeNull();
    }, 90000);

    test('wraps a selected statement range in a C block with one native Undo boundary', async () => {
        await fourCommandStack();
        const original = (await state()).roots;
        const selectedIds = await driver.executeScript(`const ws=window.__keyboardTestWorkspace;
            return ['looks_say','control_wait'].map(type=>ws.getAllBlocks(false).find(b=>b.type===type).id);`);
        await caretAt('block', 'looks_say', '', true);
        await chord(Key.SHIFT, Key.ARROW_DOWN);
        await keys(...'repeat 2');
        await driver.wait(until.elementLocated(By.css('[role="option"][aria-selected="true"]')), 10000);

        // The read-only presentation uses the same connection operation: the
        // selected native identities sit inside the proposed mouth while the
        // authoritative project is still completely unchanged.
        expect(await driver.executeScript(`const live=window.__keyboardTestWorkspace;
            const copy=Object.values(window.ScratchBlocks.Workspace.WorkspaceDB_)
                .find(ws=>ws.options.readOnly&&!ws.isFlyout&&ws.options.parentWorkspace===live);
            const actor=copy&&copy.getAllBlocks(false).find(b=>b.type==='control_repeat'&&!live.getBlockById(b.id));
            const body=actor&&actor.getInput('SUBSTACK').connection.targetBlock();
            return {live:live.getAllBlocks(false).filter(b=>!b.isShadow()).length,
                actor:actor&&actor.type,body:body&&[body.id,body.getNextBlock().id]};`))
            .toEqual({live: 4, actor: 'control_repeat', body: selectedIds});
        expect((await state()).roots).toEqual(original);

        await keys(Key.ENTER); await count(5); await noGhost();
        let root = (await state()).roots[0];
        expect([root.type, root.next.type, root.next.next.type])
            .toEqual(['motion_movesteps', 'control_repeat', 'motion_changexby']);
        expect([root.next.inputs.SUBSTACK.type, root.next.inputs.SUBSTACK.next.type])
            .toEqual(['looks_say', 'control_wait']);
        expect(await driver.executeScript(`const ws=window.__keyboardTestWorkspace;
            return arguments[0].map(id=>[ws.getBlockById(id).id,ws.getBlockById(id).getParent().type]);`,selectedIds))
            .toEqual([[selectedIds[0], 'control_repeat'], [selectedIds[1], 'looks_say']]);
        const wrapped = (await state()).roots;
        await nativeHistory(false); await count(4); await waitForRoots(original);
        expect(await driver.executeScript(`const caret=document.querySelector('[data-position]');
            return [caret.dataset.kind,Number(caret.dataset.rangeCount)];`)).toEqual(['range', 2]);
        await nativeHistory(true); await count(5); await waitForRoots(wrapped);
        await expectCaret('input', 'control_repeat', 'TIMES');
    }, 90000);

    test('wraps a range already inside a C mouth and uses the first body of a multi-mouth block', async () => {
        await typeBlock('repeat 2', 1);
        await typeBlock('say inside', 2);
        await typeBlock('wait 1 seconds', 3);
        await typeBlock('move 10 steps', 4);
        const original = (await state()).roots;
        await caretAt('block', 'looks_say', '', true);
        await chord(Key.SHIFT, Key.ARROW_DOWN);
        await acceptBlock('if then else', 5);
        let outer = (await state()).roots[0];
        const conditional = outer.inputs.SUBSTACK;
        expect(conditional.type).toBe('control_if_else');
        expect([conditional.inputs.SUBSTACK.type, conditional.inputs.SUBSTACK.next.type])
            .toEqual(['looks_say', 'control_wait']);
        expect(conditional.inputs.SUBSTACK2).toBeUndefined();
        expect(conditional.next.type).toBe('motion_movesteps');
        const wrapped = (await state()).roots;
        await nativeHistory(false); await count(4); await waitForRoots(original);
        expect(await driver.executeScript(`const caret=document.querySelector('[data-position]');
            return [caret.dataset.kind,Number(caret.dataset.rangeCount)];`)).toEqual(['range', 2]);
        await nativeHistory(true); await count(5); await waitForRoots(wrapped);
        await expectCaret('input', 'control_if_else', 'CONDITION');
        outer = (await state()).roots[0];
        expect(outer.inputs.SUBSTACK.inputs.SUBSTACK.type).toBe('looks_say');
    }, 90000);

    test('deletes a leading C-mouth range through its native statement connection', async () => {
        await typeBlock('repeat 2', 1);
        await typeBlock('say inside', 2);
        await typeBlock('wait 1 seconds', 3);
        await typeBlock('move 10 steps', 4);
        const original = (await state()).roots;
        await caretAt('block', 'looks_say', '', true);
        await chord(Key.SHIFT, Key.ARROW_DOWN);
        await keys(Key.DELETE); await count(2); await noGhost();
        const repeat = (await state()).roots[0];
        expect(repeat.type).toBe('control_repeat');
        expect(repeat.inputs.SUBSTACK.type).toBe('motion_movesteps');
        await expectCaret('before', 'motion_movesteps');
        await nativeHistory(false); await count(4);
        expect((await state()).roots).toEqual(original);
        await nativeHistory(true); await count(2);
        expect((await state()).roots[0].inputs.SUBSTACK.type).toBe('motion_movesteps');
    }, 90000);

    test('moves a selected command or sibling range one slot with Alt arrows and native history', async () => {
        await fourCommandStack();
        const original = (await state()).roots;
        const originalXY = {x: original[0].x, y: original[0].y};
        await caretAt('block', 'looks_say', '', true);
        await chord(Key.SHIFT, Key.ARROW_DOWN);
        await chord(Key.ALT, Key.ARROW_DOWN); await count(4); await noGhost();
        let root = (await state()).roots[0];
        expect([root.type, root.next.type, root.next.next.type, root.next.next.next.type])
            .toEqual(['motion_movesteps', 'motion_changexby', 'looks_say', 'control_wait']);
        expect({x: root.x, y: root.y}).toEqual(originalXY);
        expect(await driver.executeScript(`const caret=document.querySelector('[data-position]');
            return [caret.dataset.kind,Number(caret.dataset.rangeCount),window.ScratchBlocks.selected.type];`))
            .toEqual(['range', 2, 'control_wait']);
        const movedRange = (await state()).roots;
        await nativeHistory(false); await count(4);
        await waitForRoots(original);
        await nativeHistory(true); await count(4); await waitForRoots(movedRange);

        await caretAt('block', 'motion_changexby', '', true);
        await chord(Key.ALT, Key.ARROW_DOWN); await count(4); await noGhost();
        root = (await state()).roots[0];
        expect([root.type, root.next.type, root.next.next.type, root.next.next.next.type])
            .toEqual(['motion_movesteps', 'looks_say', 'motion_changexby', 'control_wait']);
        expect({x: root.x, y: root.y}).toEqual(originalXY);
        const movedSingle = (await state()).roots;
        await nativeHistory(false); await count(4);
        await waitForRoots(movedRange);
        await nativeHistory(true); await count(4); await waitForRoots(movedSingle);
    }, 90000);

    test('moves a selected range within a C mouth without crossing its owner connection', async () => {
        await typeBlock('repeat 2', 1);
        await typeBlock('say inside', 2);
        await typeBlock('wait 1 seconds', 3);
        await typeBlock('move 10 steps', 4);
        const original = (await state()).roots;
        await caretAt('block', 'looks_say', '', true);
        await chord(Key.SHIFT, Key.ARROW_DOWN);
        await chord(Key.ALT, Key.ARROW_DOWN); await count(4); await noGhost();
        let body = (await state()).roots[0].inputs.SUBSTACK;
        expect([body.type, body.next.type, body.next.next.type])
            .toEqual(['motion_movesteps', 'looks_say', 'control_wait']);
        expect(await driver.executeScript(`const caret=document.querySelector('[data-position]');
            return [caret.dataset.kind,Number(caret.dataset.rangeCount),window.ScratchBlocks.selected.type];`))
            .toEqual(['range', 2, 'control_wait']);
        const moved = (await state()).roots;
        await nativeHistory(false); await count(4);
        await waitForRoots(original);
        await nativeHistory(true); await count(4); await waitForRoots(moved);

        await caretAt('block', 'looks_say', '', true);
        await chord(Key.SHIFT, Key.ARROW_DOWN);
        await chord(Key.ALT, Key.ARROW_UP); await count(4); await noGhost();
        body = (await state()).roots[0].inputs.SUBSTACK;
        expect([body.type, body.next.type, body.next.next.type])
            .toEqual(['looks_say', 'control_wait', 'motion_movesteps']);
    }, 90000);

    test('pastes exact multiline commands through the real clipboard as one atomic history edit', async () => {
        const beforeHistory = await driver.executeScript('return window.__keyboardTestWorkspace.undoStack_.length;');
        await writeClipboard('move 10 steps\nnot a Scratch command');
        await chord(Key.CONTROL, 'v'); await painted();
        await count(0);
        expect(await driver.executeScript('return window.__keyboardTestWorkspace.undoStack_.length;'))
            .toBe(beforeHistory);
        expect((await state()).help).toMatch(/line 2.*exactly/i);

        await writeClipboard('move 10 steps\nsay hello\nwait 1 seconds');
        await chord(Key.CONTROL, 'v'); await count(3); await noGhost();
        const root = (await state()).roots[0];
        expect([root.type, root.next.type, root.next.next.type])
            .toEqual(['motion_movesteps', 'looks_say', 'control_wait']);
        expect(root.next.next.next).toBeNull();
        expect(await driver.executeScript(`const groups=new Set(window.__keyboardTestWorkspace.undoStack_
            .map(event=>event.group).filter(Boolean)); return groups.size;`)).toBe(1);
        await nativeHistory(false); await count(0);
        await nativeHistory(true); await count(3);
    }, 90000);

    test('pastes a multiline command stack into a live middle boundary without losing its tail', async () => {
        await typeBlock('move 10 steps', 1);
        await typeBlock('change x by 10', 2);
        const original = (await state()).roots;
        await caretAt('block', 'motion_movesteps', '', true);
        await keys(Key.ENTER);
        expect((await state()).caret).toMatch(/^gap:/);
        await writeClipboard('say hello\nwait 1 seconds');
        await chord(Key.CONTROL, 'v'); await count(4); await noGhost();
        let root = (await state()).roots[0];
        expect([root.type, root.next.type, root.next.next.type, root.next.next.next.type])
            .toEqual(['motion_movesteps', 'looks_say', 'control_wait', 'motion_changexby']);
        await nativeHistory(false); await count(2);
        expect((await state()).roots).toEqual(original);
        await nativeHistory(true); await count(4);
        root = (await state()).roots[0];
        expect(root.next.next.next.type).toBe('motion_changexby');
    }, 90000);

    test('pastes native subtrees across sprites and Stage with Scratch variable-sharing rules', async () => {
        await typeBlock('when this sprite clicked', 1);
        await keys(...'set score to 1', Key.ARROW_DOWN, Key.ENTER); await count(2);
        await keys(Key.END, ...'add apple to groceries', Key.ARROW_DOWN, Key.ENTER); await count(3);
        await keys(Key.END, ...'broadcast party time', Key.ARROW_DOWN, Key.ENTER); await count(4);
        await caretAt('block', 'event_whenthisspriteclicked', '', true);
        await chord(Key.CONTROL, 'c');
        const source = await driver.executeScript(`return {
            id:window.vm.editingTarget.id,
            name:window.vm.editingTarget.getName(),
            variables:Object.values(window.vm.editingTarget.variables).map(v=>({id:v.id,name:v.name,type:v.type})),
            broadcast:Object.values(window.vm.runtime.getTargetForStage().variables)
                .find(v=>v.name==='party time'&&v.type==='broadcast_msg')
        };`);
        expect(source.variables.map(variable => variable.name).sort()).toEqual(['groceries', 'score']);

        const chooser = await driver.findElement(By.xpath('//button[@aria-label="Choose a Sprite"]'));
        // React's action menu is hover-only. Dispatch the same bubbling event
        // for fixture setup, then use a real Selenium click on the revealed
        // native Surprise action. Pointer behavior itself is covered elsewhere.
        await driver.executeScript(`arguments[0].dispatchEvent(new MouseEvent('mouseover', {
            bubbles:true, clientX:arguments[0].getBoundingClientRect().left + 10,
            clientY:arguments[0].getBoundingClientRect().top + 10}));`, chooser);
        await driver.sleep(500);
        const surprise = await driver.findElements(By.xpath('//button[@aria-label="Surprise"]'));
        const visibleSurprise = await surprise.reduce(async (found, candidate) =>
            (await found) || (await candidate.isDisplayed() ? candidate : null), Promise.resolve(null));
        expect(visibleSurprise).not.toBeNull();
        await visibleSurprise.click();
        await driver.wait(() => driver.executeScript(`return window.vm.runtime.targets.length===3 &&
            !window.vm.editingTarget.isStage && window.vm.editingTarget.id!==arguments[0];`, source.id), 30000);
        const destinationId = await driver.executeScript('return window.vm.editingTarget.id;');
        await enableKeyboard();

        await beginNewScript();
        await keys(...'set score to 9', Key.ARROW_DOWN, Key.ENTER); await count(1);
        const destinationScore = await driver.executeScript(`return Object.values(window.vm.editingTarget.variables)
            .find(variable=>variable.name==='score'&&variable.type==='').id;`);
        await beginNewScript();
        await chord(Key.CONTROL, 'v'); await count(5); await noGhost();
        let destination = await driver.executeScript(`return {
            variables:Object.values(window.vm.editingTarget.variables).map(v=>({id:v.id,name:v.name,type:v.type})),
            setId:Object.values(window.vm.editingTarget.blocks._blocks)
                .find(block=>block.opcode==='data_setvariableto'&&block.fields.VARIABLE.value==='score'&&
                    block.fields.VARIABLE.id===arguments[0])?.fields.VARIABLE.id,
            broadcastId:(()=>{const blocks=window.vm.editingTarget.blocks._blocks;
                const broadcast=Object.values(blocks).find(block=>block.opcode==='event_broadcast');
                return blocks[broadcast?.inputs.BROADCAST_INPUT.block]?.fields.BROADCAST_OPTION.id;})(),
            hat:Object.values(window.vm.editingTarget.blocks._blocks)
                .find(block=>block.opcode==='event_whenthisspriteclicked')?.opcode
        };`, destinationScore);
        expect(destination.variables.map(variable => variable.name).sort()).toEqual(['groceries', 'score']);
        expect(destination.setId).toBe(destinationScore);
        expect(destination.broadcastId).toBe(source.broadcast.id);
        expect(destination.hat).toBe('event_whenthisspriteclicked');
        const destinationGroceries = destination.variables.find(variable => variable.name === 'groceries').id;
        expect(source.variables.map(variable => variable.id)).not.toContain(destinationGroceries);
        await nativeHistory(false); await count(1);
        expect(await driver.executeScript(`return Object.values(window.vm.editingTarget.variables)
            .map(variable=>variable.name);`)).toEqual(['score']);
        await nativeHistory(true); await count(5);
        destination = await driver.executeScript(`return Object.values(window.vm.editingTarget.variables)
            .map(v=>({id:v.id,name:v.name,type:v.type}));`);
        expect(destination.find(variable => variable.name === 'groceries').id).toBe(destinationGroceries);

        await driver.findElement(By.css('[data-studio-target="stage-selector"]')).click();
        await driver.wait(() => driver.executeScript('return window.vm.editingTarget.isStage;'), 10000);
        const stageBaseline = await driver.executeScript(`return Object.values(window.vm.editingTarget.variables)
            .map(v=>({id:v.id,name:v.name,type:v.type}));`);
        await enableKeyboard();
        await beginNewScript();
        await chord(Key.CONTROL, 'v'); await count(4); await noGhost();
        const stage = await driver.executeScript(`return {
            variables:Object.values(window.vm.editingTarget.variables).map(v=>({id:v.id,name:v.name,type:v.type})),
            broadcastId:(()=>{const blocks=window.vm.editingTarget.blocks._blocks;
                const broadcast=Object.values(blocks).find(block=>block.opcode==='event_broadcast');
                return blocks[broadcast?.inputs.BROADCAST_INPUT.block]?.fields.BROADCAST_OPTION.id;})(),
            hat:Object.values(window.vm.editingTarget.blocks._blocks)
                .find(block=>block.opcode==='event_whenstageclicked')?.opcode
        };`);
        expect(stage.hat).toBe('event_whenstageclicked');
        expect(stage.broadcastId).toBe(source.broadcast.id);
        const addedStageVariables = stage.variables.filter(variable =>
            !stageBaseline.some(existing => existing.id === variable.id));
        expect(addedStageVariables.map(variable => variable.name).sort()).toEqual(['Stage: groceries', 'Stage: score']);
        expect(addedStageVariables.map(variable => variable.id).sort()).toEqual(source.variables
            .map(variable => `StageVarFromLocal_${variable.id}`).sort());
        await nativeHistory(false); await count(0);
        expect(await driver.executeScript(`return Object.values(window.vm.editingTarget.variables)
            .map(v=>({id:v.id,name:v.name,type:v.type}));`)).toEqual(stageBaseline);
        await nativeHistory(true); await count(4);
        expect(await driver.executeScript(`return Object.keys(window.vm.editingTarget.variables)
            .filter(id=>!arguments[0].includes(id)).sort();`, stageBaseline.map(variable => variable.id)))
            .toEqual(source.variables.map(variable => `StageVarFromLocal_${variable.id}`).sort());

        // A second paste must reuse both Stage identities. Walking both grouped
        // edits backward and forward must never duplicate or orphan them.
        await beginNewScript();
        await chord(Key.CONTROL, 'v'); await count(8); await noGhost();
        expect(await driver.executeScript(`return Object.keys(window.vm.editingTarget.variables)
            .filter(id=>!arguments[0].includes(id)).sort();`, stageBaseline.map(variable => variable.id)))
            .toEqual(source.variables.map(variable => `StageVarFromLocal_${variable.id}`).sort());
        await nativeHistory(false); await count(4);
        await nativeHistory(false); await count(0);
        expect(await driver.executeScript(`return Object.keys(window.vm.editingTarget.variables).sort();`))
            .toEqual(stageBaseline.map(variable => variable.id).sort());
        await nativeHistory(true); await count(4);
        await nativeHistory(true); await count(8);
        expect(await driver.executeScript(`return Object.keys(window.vm.editingTarget.variables)
            .filter(id=>!arguments[0].includes(id)).sort();`, stageBaseline.map(variable => variable.id)))
            .toEqual(source.variables.map(variable => `StageVarFromLocal_${variable.id}`).sort());

        // Clipboard survival must not keep Keyboard mode or a structural caret
        // on the old target; only the serialized native subtree crosses over.
        expect(destinationId).not.toBe(source.id);
    }, 120000);

    test('cuts across sprites and gives the destination paste one native history group', async () => {
        await keys(...'set score to 1');
        await chooseVariable('create-variable-command', 'local'); await count(1); await noGhost();
        const source = await driver.executeScript(`return {
            id:window.vm.editingTarget.id,
            name:window.vm.editingTarget.getName(),
            variable:Object.values(window.vm.editingTarget.variables)
                .find(variable=>variable.name==='score'&&variable.type==='').id
        };`);
        await caretAt('block', 'data_setvariableto', '', true);
        await chord(Key.CONTROL, 'x'); await count(0); await painted();

        const chooser = await driver.findElement(By.xpath('//button[@aria-label="Choose a Sprite"]'));
        await driver.executeScript(`arguments[0].dispatchEvent(new MouseEvent('mouseover', {
            bubbles:true, clientX:arguments[0].getBoundingClientRect().left + 10,
            clientY:arguments[0].getBoundingClientRect().top + 10}));`, chooser);
        const surprise = await driver.wait(async () => {
            const candidates = await driver.findElements(By.xpath('//button[@aria-label="Surprise"]'));
            return candidates.reduce(async (found, candidate) =>
                (await found) || (await candidate.isDisplayed() ? candidate : null), Promise.resolve(null));
        }, 5000, 'Scratch did not reveal the native Surprise action');
        await surprise.click();
        await driver.wait(() => driver.executeScript(`return window.vm.runtime.targets.length===3 &&
            !window.vm.editingTarget.isStage && window.vm.editingTarget.id!==arguments[0];`, source.id), 30000);
        await enableKeyboard();
        await beginNewScript();
        await keys(Key.ESCAPE); await chord(Key.CONTROL, 'v');
        await count(1); await noGhost();
        const destinationVariable = await driver.executeScript(`return Object.values(window.vm.editingTarget.variables)
            .find(variable=>variable.name==='score'&&variable.type==='').id;`);
        expect(destinationVariable).not.toBe(source.variable);
        await nativeHistory(false); await count(0);
        expect(await driver.executeScript(`return Object.values(window.vm.editingTarget.variables)
            .some(variable=>variable.name==='score'&&variable.type==='');`)).toBe(false);
        await nativeHistory(true); await count(1);
        expect(await driver.executeScript(`return Object.values(window.vm.editingTarget.variables)
            .find(variable=>variable.name==='score'&&variable.type==='').id;`)).toBe(destinationVariable);

        // Scratch replaces the one Blockly workspace when a target changes,
        // so its ordinary Undo stack does not follow us back to the source.
        // The source edit remains cut; only Studio's project-level history is
        // cross-target. This test preserves that native editor contract.
        await driver.findElement(By.css(`[data-studio-sprite-name="${source.name}"]`)).click();
        await driver.wait(() => driver.executeScript('return window.vm.editingTarget.id===arguments[0];', source.id), 10000);
        await driver.executeScript('window.__keyboardTestWorkspace=window.ScratchBlocks.getMainWorkspace();');
        await count(0);
        expect(await driver.executeScript(`return Object.values(window.vm.editingTarget.variables)
            .find(variable=>variable.name==='score'&&variable.type==='').id;`)).toBe(source.variable);
    }, 120000);

    test('rejects an occupied cross-target paste without identities or history and clears it on New Project', async () => {
        await keys(...'score'); await chooseVariable('create-variable', 'local'); await count(1); await painted();
        await caretAt('block', 'data_variable', '', true); await chord(Key.CONTROL, 'c');
        const sourceId = await driver.executeScript('return window.vm.editingTarget.id;');

        const chooser = await driver.findElement(By.xpath('//button[@aria-label="Choose a Sprite"]'));
        await driver.actions().mouseMove(chooser).perform();
        const surprise = await driver.wait(async () => {
            const candidates = await driver.findElements(By.xpath('//button[@aria-label="Surprise"]'));
            return candidates.reduce(async (found, candidate) =>
                (await found) || (await candidate.isDisplayed() ? candidate : null), Promise.resolve(null));
        }, 5000, 'Scratch did not reveal the native Surprise action');
        await surprise.click();
        await driver.wait(() => driver.executeScript(`return window.vm.runtime.targets.length===3 &&
            !window.vm.editingTarget.isStage && window.vm.editingTarget.id!==arguments[0];`, sourceId), 30000);
        await beginNewScript();
        await typeBlock('say 1 + 2', 2);
        await caretAt('block', 'operator_add', '', true);
        const before = await state();
        await chord(Key.CONTROL, 'v'); await painted();
        expect((await state()).roots).toEqual(before.roots);
        expect((await state()).help).toContain('does not fit');
        expect(await driver.executeScript(`return Object.values(window.vm.editingTarget.variables)
            .some(variable=>variable.name==='score'&&variable.type==='');`)).toBe(false);
        // A rejected paste contributes no event group, so Undo reaches the
        // destination's preceding authored command immediately.
        await nativeHistory(false); await count(0);
        await nativeHistory(true); await count(2);

        await helper.clickText('File');
        await helper.clickXpath('//li[span[text()="New"]]');
        await (await driver.wait(until.alertIsPresent(), 5000)).accept();
        // File -> New may clear and reuse the mounted Blockly workspace. Its
        // observable contract is the default Stage plus one empty sprite, not
        // replacement object identities.
        await driver.wait(() => driver.executeScript(`return window.vm.runtime.targets.length===2 &&
            !window.vm.editingTarget.isStage &&
            Object.values(window.vm.editingTarget.blocks._blocks).filter(block=>!block.shadow).length===0;`),30000,
        'New Project did not reach its default empty sprite state');
        await driver.executeScript('window.__keyboardTestWorkspace=window.ScratchBlocks.getMainWorkspace();');
        await beginNewScript();
        await keys(Key.ESCAPE); await chord(Key.CONTROL, 'v');
        await count(0); await noGhost();
        expect((await state()).help).toContain('Copy a whole block');
    }, 120000);

    test('creates scoped lists through typed commands, explicit reporters and native list fields', async () => {
        await keys(...'add apple to groceries');
        const declaration = await driver.findElements(By.css('[role="option"][data-kind="create-list-command"]'));
        expect(declaration).toHaveLength(2);
        expect(await driver.executeScript(`return window.__keyboardTestWorkspace.getVariablesOfType('list').length;`))
            .toBe(0);
        await keys(Key.ARROW_DOWN, Key.ENTER); await count(1); await noGhost();
        let lists = await driver.executeScript(`return window.__keyboardTestWorkspace.getVariablesOfType('list')
            .map(item=>({name:item.name,local:item.isLocal}));`);
        expect(lists).toEqual([{name: 'groceries', local: true}]);
        expect((await state()).roots[0]).toMatchObject({type: 'data_addtolist', fields: {LIST: 'groceries'},
            inputs: {ITEM: {type: 'text', fields: {TEXT: 'apple'}}}});
        await nativeHistory(false); await count(0);
        expect(await driver.executeScript(`return window.__keyboardTestWorkspace.getVariablesOfType('list').length;`))
            .toBe(0);
        await nativeHistory(true); await count(1);

        await caretAt('block', 'data_addtolist', '', true);
        await keys(Key.ENTER); await keys(Key.ESCAPE);
        await expectCaret('gap', 'data_addtolist');
        await typeBlock('delete all of groceries', 2);
        expect((await state()).roots[0].next.type).toBe('data_deletealloflist');
        await beginNewScript();
        await keys(...'list INVENTORY');
        expect(await driver.findElements(By.css('[role="option"][data-kind="create-list"]'))).toHaveLength(2);
        await keys(Key.ARROW_DOWN, Key.ENTER); await count(3); await noGhost();
        lists = await driver.executeScript(`return window.__keyboardTestWorkspace.getVariablesOfType('list')
            .map(item=>({name:item.name,local:item.isLocal})).sort((a,b)=>a.name.localeCompare(b.name));`);
        expect(lists).toEqual([{name: 'groceries', local: true}, {name: 'INVENTORY', local: false}]);

        await caretAt('field', 'data_addtolist', 'LIST', true);
        await keys(...'snacks');
        expect(await driver.findElements(By.css('[role="option"][data-kind="create-list"]'))).toHaveLength(2);
        await keys(Key.ARROW_DOWN, Key.ENTER); await count(3); await noGhost();
        expect((await state()).roots.find(root => root.type === 'data_addtolist').fields.LIST).toBe('snacks');
        await nativeHistory(false); await count(3);
        await driver.wait(async () =>
            (await state()).roots.find(root => root.type === 'data_addtolist').fields.LIST === 'groceries', 10000);
        expect((await state()).roots.find(root => root.type === 'data_addtolist').fields.LIST).toBe('groceries');
        await nativeHistory(true); await count(3);
        await driver.wait(async () =>
            (await state()).roots.find(root => root.type === 'data_addtolist').fields.LIST === 'snacks', 10000);
        expect((await state()).roots.find(root => root.type === 'data_addtolist').fields.LIST).toBe('snacks');
    }, 90000);

    test('survives a long mixed identity completion clipboard field and history branch', async () => {
        await keys(...'set score to 1', Key.ARROW_DOWN, Key.ENTER); await count(1);
        await keys(Key.END, ...'add apple to groceries', Key.ARROW_DOWN, Key.ENTER); await count(2);
        await keys(Key.END, 'm'); await chord(Key.CONTROL, Key.SPACE); await keys(Key.ENTER); await count(3);
        const beforeCopy = (await state()).roots;
        await caretAt('block', 'data_setvariableto', '', true); await chord(Key.CONTROL, 'c');
        await beginNewScript();
        await keys(Key.ESCAPE); await chord(Key.CONTROL, 'v'); await count(6); await noGhost();
        const copied = (await state()).roots;
        expect(copied).toHaveLength(2);
        await nativeHistory(false); await count(3);
        expect((await state()).roots).toEqual(beforeCopy);
        await nativeHistory(true); await count(6);
        expect((await state()).roots).toEqual(copied);
        await caretAt('block', 'data_setvariableto', '', true);
        await chord(Key.CONTROL, 'x'); await count(3);
        await nativeHistory(false); await count(6);
        await nativeHistory(false); await count(3);
        await keys(Key.HOME, Key.END); await typeBlock('say clean branch', 4);
        const branched = (await state()).roots;
        await nativeHistory(true); await painted();
        expect((await state()).roots).toEqual(branched);
        await helper.clickText('Costumes', 'li'); await painted(); await noGhost();
        await helper.clickText('Code', 'li'); await painted(); await noGhost();
        expect((await state()).roots).toEqual(branched);
        expect(await driver.executeScript('return window.vm.runtime.threads.length;')).toBe(0);
    }, 90000);

    test('survives repeated mixed mouse, native field, draft, history and editor-tab changes', async () => {
        await typeBlock('when flag clicked', 1);
        await typeBlock('repeat 10', 2);
        await typeBlock('move 10 steps', 3);
        await typeBlock('wait 1 seconds', 4);
        const clickCommand = async type => {
            // Enabling restores the semantic selection before its next paint.
            // Locate the displayed caret, not the old gap's stale DOM label.
            await painted();
            if ((await state()).caret.startsWith('gap:')) await settledSpacer('caret');
            const point = await driver.executeScript(`const ws=window.__keyboardTestWorkspace,
                source=ws.getAllBlocks(false).find(b=>b.type===arguments[0]);
                const copy=Object.values(window.ScratchBlocks.Workspace.WorkspaceDB_).find(w=>w.options.readOnly &&
                    w.options.parentWorkspace===ws&&w.getBlockById(source.id));
                const box=(copy?.getBlockById(source.id)||source).svgPath_.getBoundingClientRect();
                return {x:Math.round(box.left+8),y:Math.round(box.top+16)};`,type);
            await driver.actions().move({origin:'viewport',x:point.x,y:point.y}).click().perform();
            await painted();
            await expectCaret('block',type);
        };
        const clickMove = () => clickCommand('motion_movesteps');
        for (let cycle = 0; cycle < 3; cycle++) {
            await clickMove();
            const before = (await state()).roots;
            await keys(Key.END, ...'if 1 < 2 then');
            await chord(Key.CONTROL, 'a');
            await keys(...'repeat 20', Key.ESCAPE); await noGhost();
            expect((await state()).roots).toEqual(before);

            // Clicking a value now enters Keyboard composition. Cancel that,
            // then F2 explicitly opens its native editor; both must return to
            // the same slot without changing the unaccepted draft.
            await clickMove();
            const field = await driver.executeScript(`return window.__keyboardTestWorkspace.getAllBlocks(false)
                .find(block=>block.type==='motion_movesteps').getInputTargetBlock('STEPS').getField('NUM').getSvgRoot();`);
            await field.click();
            await driver.wait(async () => (await state()).focus === 'Type a Scratch block',10000);
            await keys(Key.ESCAPE,Key.F2);
            const text = await driver.wait(until.elementLocated(By.css('input.blocklyHtmlInput')), 10000);
            await text.sendKeys(Key.chord(Key.CONTROL,'a'),String(20 + cycle),Key.ENTER);
            await driver.wait(async () => (await state()).focus === 'Scratch keyboard editor', 10000);
            const edited = (await state()).roots;
            expect(edited[0].next.inputs.SUBSTACK.inputs.STEPS.fields.NUM).toBe(String(20 + cycle));

            await clickMove(); await keys(Key.END); await typeBlock('turn clockwise 15 degrees', 5);
            const inserted = (await state()).roots;
            await nativeHistory(false); await count(4);
            expect((await state()).roots).toEqual(edited);
            await nativeHistory(true); await count(5);
            expect((await state()).roots).toEqual(inserted);
            // A resting insertion caret can now displace this continuation.
            // Click its visible native copy, not the masked source's old box.
            // Native history settles before the passive caret's dwell/reflow;
            // do not locate a source element and click its obsolete coordinates
            // after that reflow starts during WebDriver's mouse movement.
            await clickCommand('motion_turnright');
            await keys(Key.DELETE); await count(4);
            expect((await state()).roots).toEqual(edited);

            await clickMove(); await keys(Key.END, ...'say cancelled');
            const title = await driver.findElement(By.css('input[placeholder="Project title here"]'));
            await title.click(); await painted(); await noGhost();
            expect(await driver.findElement(By.xpath('//button[text()="Keyboard"]')).getAttribute('aria-pressed'))
                .toBe('false');
            await title.sendKeys(Key.chord(Key.CONTROL,'a'),`Mixed authoring ${cycle}`);
            expect((await state()).roots).toEqual(edited);
            await driver.findElement(By.xpath('//button[text()="Keyboard"]')).click();
            await clickMove(); await keys(Key.END, ...'wait 9 seconds');
            await helper.clickText('Costumes', 'li');
            await painted(); await noGhost();
            await helper.clickText('Code', 'li');
            await painted(); await noGhost();
            expect((await state()).roots).toEqual(edited);
            await enableKeyboard();
        }
        expect(await driver.executeScript('return window.vm.runtime.threads.length;')).toBe(0);
        expect((await state()).count).toBe(4);
    }, 90000);
});
