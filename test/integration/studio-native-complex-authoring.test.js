import fs from 'fs';
import path from 'path';
import webdriver from 'selenium-webdriver';
import SeleniumHelper from '../helpers/selenium-helper';
import {performStudioHistoryEdit} from '../helpers/studio-history';
import {beginPointerTiming, endPointerTiming, clickTiming} from '../helpers/studio-pointer-timing';

const {By, Key, until} = webdriver;
const helper = new SeleniumHelper({windowWidth: 1600, windowHeight: 1000});
const describeBrowser = process.env.STUDIO_BROWSER_URL ? describe : describe.skip;
const artifacts = path.resolve('.tmp/native-complex-authoring');

describeBrowser('Real mouse-authored nested inputs and custom arguments', () => {
    let driver;
    let phase;
    let takeName;
    const boundaries = new Map();
    const journal = () => driver.executeScript(`
        return JSON.parse(document.querySelector('#tw-studio-journal-debug').textContent).journal;
    `);
    const healthy = async () => {
        const text = await driver.findElement(By.id('tw-studio-session-panel')).getText();
        if (/restored|mismatch|reload required/.test(text)) {
            const detail = await driver.findElement(By.id('tw-studio-diagnostic')).getAttribute('textContent');
            throw new Error(`${phase}: ${text}\n${detail}`);
        }
        return text;
    };
    const ready = (cursor, total) => driver.wait(async () => {
        const text = await healthy();
        return text.includes(`position ${cursor}/${total}`) && !/playing|undoing|redoing|seeking/.test(text);
    }, 90000);
    const position = async () => Number((await healthy()).match(/position (\d+)\//)[1]);
    // Independent VM-tree oracle: compare meaning across regenerated IDs, and
    // reject dangling inputs, cycles, shared children and wrong parent links.
    const projectShape = () => driver.executeScript(`
        return window.vm.runtime.targets.filter(target=>target.isOriginal).map(target=>{
            const blocks=target.blocks._blocks, seen=new Set();
            const tree=(id,parent)=>{
                if(!id)return null;
                const block=blocks[id];
                if(!block)throw new Error('Missing VM child '+id);
                if(seen.has(id))throw new Error('Shared/cyclic VM child '+id);
                if((block.parent || null)!==parent)throw new Error('Wrong VM parent '+id);
                seen.add(id);
                return {opcode:block.opcode,shadow:!!block.shadow,
                    fields:Object.fromEntries(Object.entries(block.fields).sort()
                        .map(([name,field])=>[name,field.value])),
                    inputs:Object.fromEntries(Object.entries(block.inputs).filter(([,input])=>input.block).sort()
                        .map(([name,input])=>
                        [name,tree(input.block,id)])),next:tree(block.next,id)};
            };
            const scripts=Object.values(blocks).filter(block=>!block.parent && !block.shadow)
                .map(block=>tree(block.id,null)).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
            if(Object.values(blocks).some(block=>!block.shadow && !seen.has(block.id)))
                throw new Error('Unreachable VM block in '+target.getName());
            return {name:target.getName(),scripts};
        });
    `);
    const remember = async cursor => boundaries.set(cursor, await projectShape());
    const assertBoundary = async cursor => {
        expect(boundaries.has(cursor)).toBe(true);
        expect(await projectShape()).toEqual(boundaries.get(cursor));
        const counts = await driver.executeScript(`
            const ws=window.__authoringWorkspace || window.ScratchBlocks.getMainWorkspace();
            return {
                workspace:ws.getAllBlocks(false).filter(block=>!block.isShadow() && !block.isInsertionMarker()).length,
                vm:Object.values(window.vm.editingTarget.blocks._blocks).filter(block=>!block.shadow).length
            };
        `);
        // A correct VM alone must not hide an orphan still rendered in Blockly.
        expect(counts.workspace).toBe(counts.vm);
    };
    const settle = () => driver.executeAsyncScript(`
        const done = arguments[arguments.length-1];
        (window.__authoringWorkspace || window.ScratchBlocks.getMainWorkspace()).whenBlockOperationsComplete(() =>
            requestAnimationFrame(() => requestAnimationFrame(done)));
    `);
    const click = async label => {
        const selector = By.xpath(`//button[normalize-space(.)='${label}']`);
        const button = await driver.wait(until.elementLocated(selector), 20000);
        await driver.wait(until.elementIsEnabled(button), 20000);
        await button.click();
    };
    const control = (id, value) => driver.executeScript(`
        const control=document.getElementById(arguments[0]);
        control.value=String(arguments[1]);
        control.dispatchEvent(new Event('change',{bubbles:true}));
    `, id, value);
    const findBlock = (type, flyout = false, field = null) => driver.executeScript(`
        const main=window.__authoringWorkspace || window.ScratchBlocks.getMainWorkspace();
        const ws=arguments[1] ? main.getFlyout().getWorkspace() : main;
        return ws.getAllBlocks(false).find(block => block.type===arguments[0] &&
            (!arguments[2] || block.getFieldValue('VALUE')===arguments[2]))?.id || null;
    `, type, flyout, field);
    const inputName = (id, index) => driver.executeScript(`
        const workspace=window.__authoringWorkspace || window.ScratchBlocks.getMainWorkspace();
        return workspace.getBlockById(arguments[0]).inputList
            .filter(input => input.connection)[arguments[1]].name;
    `, id, index);

    // Read-only geometry establishes the actual mouse target. Creation and
    // connections below are exclusively genuine pointer gestures, never XML,
    // connect(), moveBy() or fabricated Blockly events.
    const drag = async (id, flyout, destination) => {
        const before = await position();
        await remember(before);
        const points = await driver.executeScript(`
            const main=window.__authoringWorkspace || window.ScratchBlocks.getMainWorkspace();
            const ws=arguments[1] ? main.getFlyout().getWorkspace() : main;
            const block=ws.getBlockById(arguments[0]);
            const root=block.getSvgRoot();
            const box=root.querySelector('.blocklyPath').getBoundingClientRect();
            let start=null;
            for(let y=2;y<box.height-1 && !start;y+=3) {
                for(let x=2;x<box.width-1;x+=3) {
                    const hit=document.elementFromPoint(box.left+x,box.top+y);
                    if(hit && root.contains(hit) && !hit.closest('.blocklyEditableText') &&
                        hit.closest('[data-id]')===root) {start={x:box.left+x,y:box.top+y};break;}
                }
            }
            if(!start) throw new Error('No visible non-editable pickup point for '+block.type+' '+JSON.stringify({
                id:block.id,box:box.toJSON(),rootId:root.getAttribute('data-id'),
                hit:document.elementFromPoint(box.left+3,box.bottom-8)?.outerHTML.slice(0,350)
            }));
            const dest=arguments[2];
            if(!dest.parentId) return {start,end:dest};
            const parent=main.getBlockById(dest.parentId);
            const target=dest.inputName ? parent.getInput(dest.inputName).connection : parent.nextConnection;
            const local=dest.wrapInput ? block.getInput(dest.wrapInput).connection :
                block.outputConnection || block.previousConnection;
            const project=(workspace,connection)=>{
                const point=main.getParentSvg().createSVGPoint();
                point.x=connection.x_;point.y=connection.y_;
                return point.matrixTransform(workspace.getCanvas().getScreenCTM());
            };
            const sourcePoint=project(ws,local), targetPoint=project(main,target);
            const ratio=main.scale/ws.scale;
            const grab={x:(start.x-sourcePoint.x)*ratio,y:(start.y-sourcePoint.y)*ratio};
            return {start,grab,attached:!arguments[1] && !!block.getParent() && !block.isShadow(),
                end:{x:targetPoint.x+grab.x,y:targetPoint.y+grab.y}};
        `, id, flyout, destination);
        await driver.actions().move({origin: 'viewport', x: Math.round(points.start.x), y: Math.round(points.start.y)})
            .press()
            .perform();
        if (points.attached) {
            // A real user aims at the socket after unplugging has resized its
            // owner. Read the new target during this same held mouse gesture.
            await driver.actions().move({origin: 'viewport',
                x: Math.round(points.start.x + 80),
                y: Math.round(points.start.y + 100),
                duration: 200})
                .perform();
            points.end = await driver.executeScript(`
                const main=window.__authoringWorkspace || window.ScratchBlocks.getMainWorkspace();
                const parent=main.getBlockById(arguments[0].parentId);
                const connection=arguments[0].inputName ?
                    parent.getInput(arguments[0].inputName).connection : parent.nextConnection;
                const point=main.getParentSvg().createSVGPoint();point.x=connection.x_;point.y=connection.y_;
                const target=point.matrixTransform(main.getCanvas().getScreenCTM());
                return {x:target.x+arguments[1].x,y:target.y+arguments[1].y};
            `, destination, points.grab);
        }
        await driver.actions().move({
            origin: 'viewport',
            x: Math.round(points.end.x),
            y: Math.round(points.end.y),
            duration: 600
        })
            .pause(120)
            .release()
            .perform();
        await settle();
        await ready(before + 1, before + 1);
        await remember(before + 1);
        const transaction = (await journal()).transactions[before];
        const gesture = transaction.events.find(event => event.gesture)?.gesture;
        expect(gesture?.source).toBe('scratch-blocks-drag');
        // Unplugging a reporter also creates its replacement shadow. The
        // native gesture identity, not the first create event, owns the drag.
        const actorId = gesture.blockId;
        if (destination.parentId) {
            const attachment = await driver.executeScript(`
                const workspace=window.__authoringWorkspace || window.ScratchBlocks.getMainWorkspace();
                const block=workspace.getBlockById(arguments[0]);
                return {parent:block.getParent()?.id,input:block.getParent()?.inputList.find(input=>
                    input.connection && input.connection.targetBlock()===block)?.name || null};
            `, actorId);
            expect(attachment).toEqual({parent: destination.parentId, input: destination.inputName || null});
        }
        return actorId;
    };

    const trace = () => driver.executeScript(`
        const trace={active:true,frames:[]};window.__complexFrames=trace;
        const tick=()=>{
            if(!trace.active)return;
            const actors=[...document.querySelectorAll('[data-studio-transition-actor]')].map(root=>{
                const box=root.getBoundingClientRect();
                return {id:root.getAttribute('data-id'),kind:root.getAttribute('data-studio-transition-actor'),
                    x:box.x,y:box.y,fields:
                    [...root.querySelectorAll('.blocklyText')].map(field=>{
                        const rect=field.getBoundingClientRect();
                        return {text:field.textContent,x:rect.x-box.x,y:rect.y-box.y};
                    }),shapes:[...root.querySelectorAll('.blocklyPath')].map(path=>{
                        const rect=path.getBoundingClientRect();
                        return {x:rect.x-box.x,y:rect.y-box.y,width:rect.width,height:rect.height};
                    })};
            });
            trace.frames.push(actors);requestAnimationFrame(tick);
        };requestAnimationFrame(tick);
    `);
    const finishTrace = async () => {
        const frames = await driver.executeScript(`
            window.__complexFrames.active=false;return window.__complexFrames.frames;
        `);
        const animated = frames.filter(frame => frame.length);
        expect(animated.length).toBeGreaterThan(2);
        const first = animated[0][0];
        for (const frame of animated) {
            const actor = frame.find(item => item.id === first.id);
            expect(actor.fields.map(field => field.text)).toEqual(first.fields.map(field => field.text));
            actor.fields.forEach((field, index) => {
                expect(Math.abs(field.x - first.fields[index].x)).toBeLessThan(0.8);
                expect(Math.abs(field.y - first.fields[index].y)).toBeLessThan(0.8);
            });
            // Empty input shadows have no text. Their actual outlines must
            // travel with the actor too, not merely its non-empty labels.
            expect(actor.shapes).toHaveLength(first.shapes.length);
            actor.shapes.forEach((shape, index) => {
                for (const dimension of ['x', 'y', 'width', 'height']) {
                    expect(Math.abs(shape[dimension] - first.shapes[index][dimension])).toBeLessThan(0.8);
                }
            });
        }
        const last = animated[animated.length - 1][0];
        const actual = await driver.executeScript(`
            const ws=window.__authoringWorkspace || window.ScratchBlocks.getMainWorkspace();
            const block=ws.getBlockById(arguments[0]);
            if(!block)return null;
            const box=block.getSvgRoot().getBoundingClientRect();return {x:box.x,y:box.y};
        `, last.id);
        if (last.kind === 'exit') expect(actual).toBeNull();
        else {
            expect(actual).not.toBeNull();
            expect(Math.abs(actual.x - last.x)).toBeLessThan(1);
            expect(Math.abs(actual.y - last.y)).toBeLessThan(1);
        }
        expect(await driver.findElements(By.css('.blocklyTransitionWorkspace'))).toHaveLength(0);
        expect(await driver.findElements(By.id('tw-studio-native-pointer'))).toHaveLength(0);
    };
    const exercise = async (label, expectedNativeKinds = []) => {
        const total = (await journal()).transactions.length;
        const watchNative = () => driver.executeScript(`
            window.__nativeKinds=[];
            window.__nativeKindsObserver?.disconnect();
            const element=document.getElementById('tw-studio-native-evidence');
            window.__nativeKindsObserver=new MutationObserver(()=>{
                const result=JSON.parse(element.textContent || 'null');
                const native=result?.nativeInteraction || result;
                if(native?.status==='verified')window.__nativeKinds.push({
                    kind:native.plan.kind,frames:native.evidence.frames?.length || 0
                });
            });
            window.__nativeKindsObserver.observe(element,{childList:true,subtree:true,characterData:true});
        `);
        const assertNative = async () => {
            const presentations = await driver.executeScript('return window.__nativeKinds;');
            for (const kind of expectedNativeKinds) {
                expect(presentations.some(item => item.kind === kind && item.frames > 2)).toBe(true);
            }
        };
        const history = async stage => {
            for (const [direction, cursor] of [
                ['undo', total - 1], ['undo', total - 2], ['redo', total - 1], ['redo', total]
            ]) {
                phase = `${label} ${stage} ${direction}`;
                await trace();
                await performStudioHistoryEdit(driver, direction === 'redo');
                await ready(cursor, total);
                await finishTrace();
                await assertBoundary(cursor);
            }
        };
        await history('authored');
        phase = `${label} rewind`; await click('Rewind'); await ready(0, total);
        phase = `${label} Play`; await watchNative();
        await control('tw-studio-speed', 2); await click('Play'); await ready(total, total);
        await assertNative();
        await assertBoundary(total);
        await history('after Play');
        await driver.navigate().refresh(); await ready(0, total);
        await driver.executeScript('window.__authoringWorkspace=window.ScratchBlocks.getMainWorkspace();');
        phase = `${label} reloaded Play`;
        await watchNative();
        await control('tw-studio-speed', 2); await click('Play'); await ready(total, total);
        await assertNative();
        await assertBoundary(total);
        await history('after reload and Play');
    };
    beforeAll(() => {
        driver = helper.getDriver(); fs.mkdirSync(artifacts, {recursive: true});
    });
    afterAll(async () => {
        if (driver) await driver.quit();
    });
    afterEach(async () => {
        if (expect.getState().currentTestName) {
            const name = takeName;
            fs.writeFileSync(path.join(artifacts, `${name}.png`), Buffer.from(await driver.takeScreenshot(), 'base64'));
            const evidence = await driver.executeScript(`return {
                diagnostic:document.querySelector('#tw-studio-diagnostic')?.textContent,
                native:document.querySelector('#tw-studio-native-evidence')?.textContent,
                nativeKinds:window.__nativeKinds || [],
                roots:window.__authoringWorkspace?.getTopBlocks(false).map(block=>{
                    const root=block.getSvgRoot(),box=root.getBoundingClientRect();
                    return {id:block.id,type:block.type,box:box.toJSON(),connected:root.isConnected,
                        parent:root.parentNode?.outerHTML.slice(0,180),html:root.outerHTML.slice(0,400),
                        hit:document.elementFromPoint(box.left+10,box.top+18)?.outerHTML.slice(0,180)};
                }),
                captureTrace:window.__authoringCaptureTrace,
                wrapPreview:window.__wrapPreviewTrace?.frames,
                journal:document.querySelector('#tw-studio-journal-debug')?.textContent || null
            };`);
            // Preserve the original navigation failure if the editor never loaded.
            const capturedJournal = evidence.journal ? JSON.parse(evidence.journal).journal : null;
            delete evidence.journal;
            fs.writeFileSync(path.join(artifacts, `${name}.json`),
                JSON.stringify({phase, journal: capturedJournal, evidence}, null, 2));
        }
    });
    const open = async (name, {historyPointer = false} = {}) => {
        takeName = name;
        boundaries.clear();
        phase = `${name} authoring`;
        const url = new URL(process.env.STUDIO_BROWSER_URL);
        url.searchParams.set('studio-session', '1'); url.searchParams.set('studio-debug', '1');
        if (historyPointer === null) url.searchParams.delete('studio-history-pointer');
        else url.searchParams.set('studio-history-pointer', historyPointer ? '1' : '0');
        url.searchParams.set('studio-take', `native-${name}-${Date.now()}`);
        await helper.loadUri(url.toString()); await ready(0, 0);
        // getMainWorkspace() means focused workspace, including dialog editors.
        // Hold the editor instance, as the production bridge does.
        await driver.executeScript('window.__authoringWorkspace=window.ScratchBlocks.getMainWorkspace();');
        await driver.executeScript(`
            const trace=window.__authoringCaptureTrace=[];
            window.__authoringWorkspace.addChangeListener(event=>{
                if(event.recordUndo)trace.push({event:event.toJson(),recordUndo:event.recordUndo});
            });
            window.__authoringWorkspace.addBlockDragListener(detail=>trace.push({drag:detail}));
        `);
        await remember(0);
    };
    const selectSprite = async name => {
        await driver.findElement(By.css(`[data-studio-sprite-name="${name}"]`)).click();
        await driver.wait(() => driver.executeScript('return window.vm.editingTarget.getName()===arguments[0];', name),
            20000);
        await settle();
    };
    const copyBlock = async (id, destination) => {
        const before = await position();
        await remember(before);
        const point = await driver.executeScript(`
            const root=window.__authoringWorkspace.getBlockById(arguments[0]).getSvgRoot();
            const box=root.querySelector('.blocklyPath').getBoundingClientRect();
            for(let y=8;y<Math.min(35,box.height);y+=4)for(let x=8;x<box.width-3;x+=4){
                const hit=document.elementFromPoint(box.left+x,box.top+y);
                if(hit && hit.closest('[data-id]')===root && !hit.closest('.blocklyEditableText'))
                    return {x:Math.round(box.left+x),y:Math.round(box.top+y)};
            }
            throw new Error('No visible clipboard selection point');
        `, id);
        await driver.actions().move({origin: 'viewport', ...point})
            .click()
            .perform();
        const body = driver.findElement(By.css('body'));
        await body.sendKeys(Key.chord(Key.CONTROL, 'c'));
        await body.sendKeys(Key.chord(Key.CONTROL, 'v'));
        // TurboWarp's default devtools addon starts a paste-at-mouse gesture.
        // Complete that actual held copy, rather than trying to pick it up again.
        // Do not wait for operation completion while that gesture is still held.
        await driver.wait(() => driver.executeScript('return window.__authoringWorkspace.isDragging();'), 10000);
        await driver.actions().move({origin: 'viewport', ...destination, duration: 600})
            .click()
            .perform();
        await settle(); await ready(before + 1, before + 1); await remember(before + 1);
        const create = (await journal()).transactions[before].events.find(event => event.type === 'create');
        expect(create.interactionSource.kind).toBe('workspace-clipboard');
        expect((await journal()).transactions[before].events.some(event => event.type === 'move' &&
            event.gesture?.blockId === create.blockId)).toBe(true);
        return create.blockId;
    };

    test('configurable history cursor follows actors, clicks sprites and yields to queued keys', async () => {
        await open('history-cursor', {historyPointer: null});
        const setting = () => driver.findElement(By.id('tw-studio-history-pointer'));
        expect(await setting().isSelected()).toBe(true);
        await driver.findElement(By.css('[data-studio-target="sprite-library-open"]')).click();
        await helper.clickText('Apple', helper.scope.modal);
        await ready(1, 1); await remember(1);
        await helper.clickBlocksCategory('Control');
        await drag(await findBlock('control_wait', true), true, {x: 510, y: 230});
        await selectSprite('Sprite1'); await helper.clickBlocksCategory('Control');
        const moving = await drag(await findBlock('control_wait', true), true, {x: 510, y: 230});
        await drag(moving, false, {x: 620, y: 330});
        const total = 4;
        const recordedTransactions = (await journal()).transactions;
        const beginPointerTrace = () => driver.executeScript(`
            const trace=window.__historyPointerTrace={active:true,frames:[],clicks:[]};
            const onClick=event=>{
                const card=event.target.closest('[data-studio-sprite-name]');
                const pointer=document.getElementById('tw-studio-native-pointer');
                if(card)trace.clicks.push({name:card.dataset.studioSpriteName,time:performance.now(),
                    point:{x:event.clientX,y:event.clientY},
                    pointer:Boolean(pointer && getComputedStyle(pointer).visibility!=='hidden' &&
                        Number(getComputedStyle(pointer).opacity)>0 &&
                        Math.hypot(parseFloat(pointer.style.left)-event.clientX,
                            parseFloat(pointer.style.top)-event.clientY)<2)});
            };
            document.addEventListener('click',onClick,true);
            const tick=()=>{
                if(!trace.active){document.removeEventListener('click',onClick,true);return;}
                const root=document.querySelector('[data-studio-transition-actor]');
                const box=root?.getBoundingClientRect();
                const pointer=document.getElementById('tw-studio-native-pointer');
                const selected=[...document.querySelectorAll('[data-studio-sprite-name]')]
                    .find(card=>card.className.includes('is-selected'));
                trace.frames.push({time:performance.now(),name:selected?.dataset.studioSpriteName,
                    cursor:Number(document.getElementById('tw-studio-step').value),
                    actor:box?{x:box.x,y:box.y,kind:root.dataset.studioTransitionActor}:null,
                    pointer:pointer && getComputedStyle(pointer).visibility!=='hidden' &&
                        Number(getComputedStyle(pointer).opacity)>0 ?
                        {x:parseFloat(pointer.style.left),y:parseFloat(pointer.style.top),
                            pressed:pointer.dataset.pressed==='true'}:null});
                requestAnimationFrame(tick);
            };requestAnimationFrame(tick);
        `);
        const endPointerTrace = async label => {
            const captured = await driver.executeScript(
                'window.__historyPointerTrace.active=false;return window.__historyPointerTrace;');
            fs.writeFileSync(path.join(artifacts, `history-cursor-${label}.json`), JSON.stringify(captured, null, 2));
            return captured;
        };
        const press = redo => driver.findElement(By.css('body')).sendKeys(
            Key.chord(Key.CONTROL, ...(redo ? [Key.SHIFT, 'z'] : ['z'])));
        const key = redo => performStudioHistoryEdit(driver, redo);
        // A selection is the ENTIRE first command, not the first half of one
        // animation. Assert independently that no project's blocks changed.
        await selectSprite('Apple');
        await press(false);
        await driver.wait(async () => (await healthy()).includes('selected Sprite1 — press Undo again'), 10000);
        await ready(total, total); await assertBoundary(total);
        expect(await healthy()).toContain('selected Sprite1 — press Undo again');
        expect((await journal()).transactions).toEqual(recordedTransactions);
        await press(false); await ready(3, total); await assertBoundary(3);
        await press(true); await ready(total, total); await assertBoundary(total);
        await control('tw-studio-sprite-pause', 850);
        await driver.wait(async () => (await journal()).presentation.targetSelectionPauseMs === 850, 10000);
        expect((await journal()).presentation.targetSelectionPauseMs).toBe(850);
        await beginPointerTrace();
        await beginPointerTiming(driver);
        for (let cursor = total - 1; cursor >= 0; cursor--) {
            await key(false); await ready(cursor, total); await assertBoundary(cursor);
        }
        for (let cursor = 1; cursor <= total; cursor++) {
            await key(true); await ready(cursor, total); await assertBoundary(cursor);
        }
        const shown = await endPointerTrace('enabled');
        const historyTiming = await endPointerTiming(driver);
        const selectionTimings = historyTiming.clicks.filter(item => ['Apple', 'Sprite1'].includes(item.name))
            .map(item => clickTiming(historyTiming, item));
        fs.writeFileSync(path.join(artifacts, 'sprite-selection-timing.json'),
            JSON.stringify({trace: historyTiming, selectionTimings}, null, 2));
        expect(selectionTimings.length).toBe(3);
        selectionTimings.forEach(timing => expect(timing.beforePressMs).toBeGreaterThanOrEqual(170));
        const held = shown.frames.filter(frame => frame.actor && frame.pointer?.pressed);
        expect(held.length).toBeGreaterThan(12);
        expect(new Set(held.map(frame => frame.actor.kind))).toEqual(new Set(['enter', 'exit', 'move']));
        for (const frame of held) {
            expect(Math.abs(frame.pointer.x - frame.actor.x - 16)).toBeLessThan(2);
            expect(Math.abs(frame.pointer.y - frame.actor.y - 18)).toBeLessThan(2);
        }
        expect(shown.clicks.filter(press => press.pointer).map(press => press.name))
            .toEqual(['Apple', 'Sprite1', 'Sprite1']);
        const addBounds = await driver.findElement(By.css('[data-studio-target="sprite-library-open"]')).getRect();
        let selected = 'Sprite1';
        let since = 0;
        for (const frame of shown.frames.filter(item => item.name)) {
            if (frame.name === selected) continue;
            const lastSelection = since;
            const clickedCard = shown.clicks.some(press => press.name === frame.name && press.pointer &&
                press.time >= lastSelection && press.time <= frame.time);
            const createdOnAdd = frame.name === 'Apple' && frame.cursor <= 1 && frame.pointer &&
                Math.hypot(frame.pointer.x - addBounds.x - (addBounds.width / 2),
                    frame.pointer.y - addBounds.y - (addBounds.height / 2)) < 2;
            expect(Boolean(clickedCard || createdOnAdd)).toBe(true);
            selected = frame.name; since = frame.time;
        }
        // Begin near the old idle deadline, then move slowly across it. Reuse
        // must cancel that old fade rather than losing the cursor mid-drag.
        await control('tw-studio-speed', 0.5);
        await driver.sleep(1800);
        await beginPointerTrace();
        await driver.findElement(By.id('tw-studio-previous')).click();
        await ready(3, total); await assertBoundary(3);
        const idleReuse = await endPointerTrace('idle-reuse');
        const lastMovingFrame = idleReuse.frames.filter(frame => frame.actor).pop();
        expect(lastMovingFrame.pointer).toMatchObject({pressed: true});
        await key(true); await ready(total, total); await assertBoundary(total);
        await control('tw-studio-speed', 1);
        // Disable via the real checkbox, then reload the same take: neither
        // the off preference nor the journal may depend on a diagnostic URL.
        await setting().click();
        await selectSprite('Apple');
        await beginPointerTrace();
        await press(false);
        await driver.wait(async () => (await healthy()).includes('selected Sprite1 — press Undo again'), 10000);
        await ready(total, total); await assertBoundary(total);
        expect(await healthy()).toContain('selected Sprite1 — press Undo again');
        await key(false); await ready(3, total); await assertBoundary(3);
        await key(true); await ready(total, total); await assertBoundary(total);
        const hidden = await endPointerTrace('disabled');
        expect(hidden.frames.every(frame => !frame.pointer)).toBe(true);
        await driver.navigate().refresh(); await ready(0, total);
        await driver.executeScript('window.__authoringWorkspace=window.ScratchBlocks.getMainWorkspace();');
        expect(await setting().isSelected()).toBe(false);
        expect(await driver.findElement(By.id('tw-studio-sprite-pause')).getAttribute('value')).toBe('850');
        await setting().click();
        await control('tw-studio-step', total); await ready(total, total);
        await control('tw-studio-speed', 0.5);
        await beginPointerTrace();
        await driver.findElement(By.id('tw-studio-previous')).click();
        await driver.wait(() => driver.executeScript(
            "return !!document.querySelector('[data-studio-transition-actor]');"), 10000);
        // Four edits plus two sprite stops = six commands, including the
        // one already in flight. Selection must still count during catch-up.
        await driver.findElement(By.css('body')).sendKeys(Key.chord(Key.CONTROL, 'z', 'z'));
        await driver.findElement(By.id('tw-studio-previous')).click();
        await driver.findElement(By.css('body')).sendKeys(Key.chord(Key.CONTROL, 'z', 'z'));
        await ready(0, total); await assertBoundary(0);
        const burst = await endPointerTrace('queued');
        expect(burst.frames.some(frame => frame.cursor === 2 && !frame.pointer)).toBe(true);
        expect(await driver.findElements(By.css('.blocklyTransitionWorkspace'))).toHaveLength(0);
        // The next individual command must recover normal visible presentation.
        await beginPointerTrace(); await key(true); await ready(1, total); await assertBoundary(1);
        const resumed = await endPointerTrace('resumed');
        expect(resumed.clicks.some(press => press.name === 'Apple' && press.pointer)).toBe(false);
        expect(resumed.frames.some(frame => frame.pointer?.pressed)).toBe(true);
        // Interrupt a sprite-selector journey itself, while the native input
        // shield is mounted. History keys must still reach the command queue.
        await key(true); await ready(2, total);
        await beginPointerTrace(); await press(true);
        await driver.executeAsyncScript(`
            const done=arguments[arguments.length-1],start=performance.now();
            const tick=()=>{
                const pointer=document.getElementById('tw-studio-native-pointer');
                if(pointer && !pointer.dataset.pressed &&
                    window.vm.editingTarget.getName()==='Apple' &&
                    document.querySelector('#tw-studio-session-panel').textContent.includes('redoing')){
                    done(true);return;
                }
                if(performance.now()-start>5000){done(false);return;}
                requestAnimationFrame(tick);
            };tick();
        `).then(observed => expect(observed).toBe(true));
        await driver.findElement(By.id('tw-studio-next')).click();
        await press(true); await ready(total, total); await assertBoundary(total);
        await endPointerTrace('queued-sprite-click');
        // Automatic traversal must pause at the same stop, before any edit
        // or follow-on pointer travel. Measure actual rendered frames, not
        // only the configured delay or final graph.
        await control('tw-studio-speed', 1);
        await beginPointerTrace();
        await driver.findElement(By.css('[title="Play timeline backward"]')).click();
        await ready(0, total); await assertBoundary(0);
        const timedHistory = await endPointerTrace('timed-timeline');
        const appleClick = timedHistory.clicks.find(press => press.name === 'Apple');
        expect(appleClick).toBeDefined();
        const nextActor = timedHistory.frames.find(frame => frame.time > appleClick.time && frame.actor);
        expect(nextActor.time - appleClick.time).toBeGreaterThanOrEqual(800);
        await beginPointerTrace(); await beginPointerTiming(driver); await click('Play');
        await ready(total, total); await assertBoundary(total);
        const timedPlay = await endPointerTrace('timed-play');
        const playTiming = await endPointerTiming(driver);
        const libraryOpen = playTiming.clicks.find(item => item.name === 'sprite-library-open');
        const spriteSelection = playTiming.clicks.find(item => item.name === 'Sprite1');
        expect(libraryOpen).toBeDefined();
        expect(spriteSelection).toBeDefined();
        for (const event of [libraryOpen, spriteSelection]) {
            const timing = clickTiming(playTiming, event);
            expect(timing.beforePressMs).toBeGreaterThanOrEqual(170);
            expect(timing.afterClickMs).toBeGreaterThanOrEqual(170);
        }
        const libraryPick = playTiming.clicks.find(item => item.name.endsWith('.svg'));
        expect(libraryPick).toBeDefined();
        expect(clickTiming(playTiming, libraryPick).beforePressMs).toBeGreaterThanOrEqual(170);
        const created = playTiming.frames.find(frame => frame.time > libraryPick.time &&
            frame.sprites.includes('Apple'));
        const movedAfterCreate = playTiming.frames.find(frame => frame.time > created.time && frame.pointer &&
            Math.hypot(frame.pointer.x - libraryPick.point.x, frame.pointer.y - libraryPick.point.y) > 1);
        expect(movedAfterCreate.time - created.time).toBeGreaterThanOrEqual(170);
        fs.writeFileSync(path.join(artifacts, 'sprite-library-timing.json'), JSON.stringify(playTiming, null, 2));
        const spriteClick = timedPlay.clicks.find(press => press.name === 'Sprite1');
        expect(spriteClick).toBeDefined();
        const nextTravel = timedPlay.frames.find(frame => frame.time > spriteClick.time && frame.pointer &&
            Math.hypot(frame.pointer.x - spriteClick.point.x, frame.pointer.y - spriteClick.point.y) > 4);
        expect(nextTravel.time - spriteClick.time).toBeGreaterThanOrEqual(800);
        // Escape while looking at the selected sprite must not consume its
        // edit. The following single Undo applies exactly that edit.
        await control('tw-studio-step', 2); await ready(2, total);
        await selectSprite('Sprite1');
        await driver.findElement(By.css('[title="Play timeline backward"]')).click();
        await driver.wait(async () => (await healthy()).includes('selected Apple'), 10000);
        await driver.findElement(By.css('body')).sendKeys(Key.ESCAPE);
        await ready(2, total); await assertBoundary(2);
        expect(await healthy()).toContain('stopped');
        await press(false); await ready(1, total); await assertBoundary(1);
        await press(true); await ready(2, total); await assertBoundary(2);
        // Full Play has an input shield during selection. Escape must also
        // cancel that driver's pause before any native block drag begins.
        await click('Play');
        await driver.wait(() => driver.executeScript(`
            return window.vm.editingTarget.getName()==='Sprite1' &&
                document.getElementById('tw-studio-speed').disabled &&
                document.getElementById('tw-studio-step').value==='2';
        `), 10000);
        await driver.findElement(By.css('body')).sendKeys(Key.ESCAPE);
        await driver.wait(async () => (await healthy()).includes('stopped'), 10000);
        await ready(2, total); await assertBoundary(2);
        expect((await journal()).transactions).toEqual(recordedTransactions);
    }, 180000);

    test('snapshot sprite creation arrives, pauses, clicks, and holds before the next action', async () => {
        await open('snapshot-sprite-click');
        const spriteMenu = await driver.findElement(By.css('[data-studio-target="sprite-library-open"]'));
        await driver.actions()
            .move({origin: spriteMenu})
            .perform();
        const paint = spriteMenu.findElement(By.xpath('..')).findElement(By.css('[aria-label="Paint"]'));
        await driver.wait(until.elementIsVisible(paint), 10000); await paint.click();
        await ready(1, 1); await remember(1);
        await driver.findElement(By.xpath('//*[@role="tab" and contains(.,"Code")]')).click();
        await helper.clickBlocksCategory('Control');
        await drag(await findBlock('control_wait', true), true, {x: 510, y: 230});
        const recorded = (await journal()).transactions;
        expect(recorded[0].operation).toMatchObject({type: 'sprite-create'});
        expect(recorded[0].operation.libraryItem).toBeUndefined();
        await click('Rewind'); await ready(0, 2);
        await control('tw-studio-speed', 1);
        const icon = await driver.findElement(By.css('[data-studio-target="sprite-library-open"]')).getRect();
        const point = {x: icon.x + (icon.width / 2), y: icon.y + (icon.height / 2)};
        await beginPointerTiming(driver); await click('Play');
        await ready(2, 2); await assertBoundary(2);
        const creationTrace = await endPointerTiming(driver);
        const created = creationTrace.frames.find(frame => frame.sprites.includes('Sprite2'));
        fs.writeFileSync(path.join(artifacts, 'sprite-snapshot-timing.json'), JSON.stringify(creationTrace, null, 2));
        expect(created).toBeDefined();
        expect(created.selected).toBe('Sprite2');
        expect(creationTrace.clicks.some(event => event.name === 'Sprite2')).toBe(false);
        expect(created.pointer).toBeTruthy();
        expect(Math.hypot(created.pointer.x - point.x, created.pointer.y - point.y)).toBeLessThan(1);
        const timing = clickTiming(creationTrace, {name: 'snapshot creation', time: created.time, point});
        expect(timing.beforePressMs).toBeGreaterThanOrEqual(170);
        expect(timing.afterClickMs).toBeGreaterThanOrEqual(170);
        expect(creationTrace.frames.some(frame => frame.time < timing.arrival.time && frame.pointer &&
            Math.hypot(frame.pointer.x - point.x, frame.pointer.y - point.y) > 8)).toBe(true);
        // No library is opened for a checkpoint-only creation.
        expect(creationTrace.clicks.some(event => event.name === 'sprite-library-open')).toBe(false);
        expect((await journal()).transactions).toEqual(recorded);
        fs.writeFileSync(path.join(artifacts, 'sprite-snapshot-timing.json'), JSON.stringify(creationTrace, null, 2));
        // Escape during the arrival hold must not create anything. Play then
        // resumes from the same boundary without duplicating the new sprite.
        await click('Rewind'); await ready(0, 2);
        await control('tw-studio-speed', 0.5);
        await click('Play');
        await driver.executeAsyncScript(`
            const done=arguments[arguments.length-1],point=arguments[0],start=performance.now();
            const tick=()=>{
                const pointer=document.getElementById('tw-studio-native-pointer');
                if(pointer && pointer.dataset.pressed!=='true' &&
                    Math.hypot(parseFloat(pointer.style.left)-point.x,parseFloat(pointer.style.top)-point.y)<0.05){
                    done(true);return;
                }
                if(performance.now()-start>5000){done(false);return;}requestAnimationFrame(tick);
            };tick();
        `, point).then(observed => expect(observed).toBe(true));
        await driver.findElement(By.css('body')).sendKeys(Key.ESCAPE);
        await driver.wait(async () => (await healthy()).includes('stopped'), 10000);
        await ready(0, 2); await assertBoundary(0);
        await control('tw-studio-speed', 1); await click('Play');
        await ready(2, 2); await assertBoundary(2);
        await performStudioHistoryEdit(driver, false); await ready(1, 2); await assertBoundary(1);
        await performStudioHistoryEdit(driver, true); await ready(2, 2); await assertBoundary(2);
    }, 120000);

    test.each(['redo', 'timeline'])(
        'creates and selects a sprite on the Add click, not on its new tile (%s)', async mode => {
            await open(`creation-order-${mode}`, {historyPointer: true});
            const spriteMenu = await driver.findElement(By.css('[data-studio-target="sprite-library-open"]'));
            await driver.actions()
                .move({origin: spriteMenu})
                .perform();
            const paint = spriteMenu.findElement(By.xpath('..')).findElement(By.css('[aria-label="Paint"]'));
            await driver.wait(until.elementIsVisible(paint), 10000); await paint.click();
            await ready(1, 1); await remember(1);
            await driver.findElement(By.xpath('//*[@role="tab" and contains(.,"Code")]')).click();
            await helper.clickBlocksCategory('Control');
            await drag(await findBlock('control_wait', true), true, {x: 510, y: 230});
            const recorded = (await journal()).transactions;
            await click('Rewind'); await ready(0, 2);
            await control('tw-studio-speed', 1);
            const icon = await driver.findElement(By.css('[data-studio-target="sprite-library-open"]')).getRect();
            const point = {x: icon.x + (icon.width / 2), y: icon.y + (icon.height / 2)};
            await beginPointerTiming(driver);
            if (mode === 'redo') await driver.findElement(By.id('tw-studio-next')).click();
            else await driver.findElement(By.css('[title="Play timeline forward"]')).click();
            const cursor = mode === 'timeline' ? 2 : 1;
            await ready(cursor, 2); await assertBoundary(cursor);
            const creationTrace = await endPointerTiming(driver);
            fs.writeFileSync(path.join(artifacts, `sprite-creation-order-${mode}.json`),
                JSON.stringify(creationTrace, null, 2));
            const created = creationTrace.frames.find(frame => frame.sprites.includes('Sprite2'));
            expect(created).toBeDefined();
            expect(created.selected).toBe('Sprite2');
            expect(created.pointer).toBeTruthy();
            expect(Math.hypot(created.pointer.x - point.x, created.pointer.y - point.y)).toBeLessThan(1);
            const timing = clickTiming(creationTrace, {name: 'Add sprite', time: created.time, point});
            expect(timing.beforePressMs).toBeGreaterThanOrEqual(170);
            expect(creationTrace.clicks.some(event => ['Sprite1', 'Sprite2'].includes(event.name))).toBe(false);
            if (cursor === 1) {
                await driver.findElement(By.id('tw-studio-next')).click();
                await ready(2, 2); await assertBoundary(2);
            }
            // Instant seeking stays instant, but still selects the newly
            // created sprite without a phantom tile click.
            await control('tw-studio-step', 0); await ready(0, 2);
            await beginPointerTiming(driver);
            await control('tw-studio-step', 1); await ready(1, 2); await assertBoundary(1);
            const instantTrace = await endPointerTiming(driver);
            expect(instantTrace.clicks.some(event => event.name === 'Sprite2')).toBe(false);
            expect(instantTrace.frames.every(frame => !frame.pointer)).toBe(true);
            expect(instantTrace.frames.findLast(frame => frame.sprites.includes('Sprite2')).selected).toBe('Sprite2');
            if (mode === 'redo') {
                await control('tw-studio-step', 0); await ready(0, 2);
                await driver.findElement(By.id('tw-studio-history-pointer')).click();
                await beginPointerTiming(driver);
                await driver.findElement(By.id('tw-studio-next')).click();
                await ready(1, 2); await assertBoundary(1);
                const disabledTrace = await endPointerTiming(driver);
                expect(disabledTrace.frames.every(frame => !frame.pointer)).toBe(true);
                expect(disabledTrace.clicks.some(event => event.name === 'Sprite2')).toBe(false);
                await driver.findElement(By.id('tw-studio-history-pointer')).click();
                // A keyboard request during a toolbar-started Add must join
                // that same queue, on either side of the creation click.
                for (const [first, second, interruptAt] of [
                    ['toolbar', 'keyboard', 'before'], ['toolbar', 'keyboard', 'after'],
                    ['keyboard', 'toolbar', 'before'], ['keyboard', 'toolbar', 'after'],
                    ['toolbar', 'toolbar', 'before'], ['keyboard', 'keyboard', 'after']
                ]) {
                    await control('tw-studio-step', 0); await ready(0, 2);
                    await control('tw-studio-speed', 0.5);
                    const request = surface => (surface === 'toolbar' ?
                        driver.findElement(By.id('tw-studio-next')).click() :
                        driver.findElement(By.css('body')).sendKeys(Key.chord(Key.CONTROL, Key.SHIFT, 'z')));
                    await request(first);
                    const observed = await driver.executeAsyncScript(`
                        const [point,phase,done]=arguments,start=performance.now();
                        const tick=()=>{
                            const pointer=document.getElementById('tw-studio-native-pointer');
                            const created=!!document.querySelector('[data-studio-sprite-name="Sprite2"]');
                            const atAdd=pointer && Math.hypot(parseFloat(pointer.style.left)-point.x,
                                parseFloat(pointer.style.top)-point.y)<0.05;
                            const panel=document.getElementById('tw-studio-session-panel');
                            const busy=panel.textContent.includes('redoing');
                            if(busy && atAdd && (phase==='after' ? created : !created)){done(true);return;}
                            if(performance.now()-start>5000){done(false);return;}requestAnimationFrame(tick);
                        };tick();
                    `, point, interruptAt);
                    expect(observed).toBe(true);
                    await request(second);
                    await driver.wait(async () => (await position()) === 2, 6000,
                        `${first} to ${second} Redo was lost ${interruptAt} sprite creation`);
                    await ready(2, 2); await assertBoundary(2);
                    await control('tw-studio-speed', 1);
                }
            }
            expect((await journal()).transactions).toEqual(recorded);
        }, 120000
    );

    test('mixed history bursts preserve order, endpoints and input rendering', async () => {
        await open('mixed-history', {historyPointer: true});
        await helper.clickBlocksCategory('Control');
        let parent = await drag(await findBlock('control_wait', true), true, {x: 510, y: 230});
        for (let index = 0; index < 2; index++) {
            parent = await drag(await findBlock('control_wait', true), true, {parentId: parent});
        }
        const recorded = (await journal()).transactions;
        const key = redo => driver.findElement(By.css('body')).sendKeys(
            Key.chord(Key.CONTROL, ...(redo ? [Key.SHIFT, 'z'] : ['z'])));
        const button = redo => driver.findElement(By.id(redo ? 'tw-studio-next' : 'tw-studio-previous')).click();
        const actorVisible = () => driver.wait(() => driver.executeScript(
            "return !!document.querySelector('[data-studio-transition-actor]');"), 10000);
        await control('tw-studio-speed', 0.5);
        await button(false); await actorVisible();
        await key(false); await button(true); await key(true);
        await ready(3, 3); await assertBoundary(3);
        // A final in-flight Undo can be reversed before cursor=0 is published.
        await control('tw-studio-step', 1); await ready(1, 3);
        await key(false); await actorVisible();
        await button(true); await ready(1, 3); await assertBoundary(1);
        // Excess Undo requests stop at the base, then Redo still applies once.
        await key(false); await actorVisible();
        await driver.findElement(By.css('body')).sendKeys(Key.chord(Key.CONTROL, 'z', 'z', 'z'));
        await button(true); await ready(1, 3); await assertBoundary(1);
        // Catch-up is temporary. An individual history edit must again show
        // the whole block and its attached inputs, without leftover overlays.
        await driver.findElement(By.id('tw-studio-history-pointer')).click();
        await trace(); await button(true); await ready(2, 3); await finishTrace(); await assertBoundary(2);
        await driver.navigate().refresh(); await ready(0, 3);
        await driver.executeScript('window.__authoringWorkspace=window.ScratchBlocks.getMainWorkspace();');
        await control('tw-studio-speed', 4); await click('Play'); await ready(3, 3); await assertBoundary(3);
        expect((await journal()).transactions).toEqual(recorded);
    }, 120000);

    test('nested operators keep their owned slots through real drags, history, Play and reload', async () => {
        await open('nested'); await helper.clickBlocksCategory('Operators');
        const prototype = await findBlock('operator_add', true);
        const outer = await drag(prototype, true, {x: 520, y: 230});
        const inner = await drag(prototype, true, {parentId: outer, inputName: 'NUM1'});
        await drag(prototype, true, {parentId: inner, inputName: 'NUM1'});
        await exercise('nested creation');
        // IDs may be regenerated by Play. Resolve the outer root structurally
        // for this newly authored move, not by stale IDs from before reload.
        const roots = await driver.executeScript(`return window.ScratchBlocks.getMainWorkspace().getTopBlocks(false)
            .filter(block=>block.type==='operator_add')
            .map(block=>({id:block.id,inner:block.getInputTargetBlock('NUM1').id}));`);
        await drag(roots[0].inner, false, {parentId: roots[0].id, inputName: 'NUM2'});
        await exercise('nested move with child');
    }, 180000);

    test('custom definition argument copies remain intact through history, Play and reload', async () => {
        await open('custom'); await helper.clickBlocksCategory('My Blocks');
        await helper.clickText('Make a Block', helper.scope.blocksTab);
        const type = async value => {
            const editor = await driver.wait(async () => {
                const element = await driver.switchTo().activeElement();
                return (await element.getAttribute('class') || '').includes('blocklyHtmlInput') ? element : null;
            }, 20000);
            await editor.sendKeys(Key.chord(Key.CONTROL, 'a'), value);
            // The HTML widget can precede its SVG field update. Confirm the
            // displayed text before clicking the next dialog control.
            await driver.wait(() => driver.executeScript(`
                return [...document.querySelectorAll('.blocklyText')].some(field=>field.textContent===arguments[0]);
            `, value), 10000);
        };
        await type('bake'); await helper.clickText('number or text', helper.scope.modal); await type('amount');
        await helper.clickText('boolean', helper.scope.modal); await type('ready?');
        await driver.findElement(By.css('[data-studio-target="custom-procedure-ok"]')).click();
        await settle(); await ready(1, 1);
        const call = await drag(await findBlock('procedures_call', true), true, {x: 540, y: 350});
        const amount = await findBlock('argument_reporter_string_number', false, 'amount');
        await drag(amount, false, {parentId: call, inputName: await inputName(call, 0)});
        const boolean = await findBlock('argument_reporter_boolean', false, 'ready?');
        await drag(boolean, false, {parentId: call, inputName: await inputName(call, 1)});
        for (const transaction of (await journal()).transactions.slice(2)) {
            expect(transaction.events.some(event => event.gesture?.origin?.kind === 'workspace-copy')).toBe(true);
        }
        await exercise('custom argument copy');
    }, 180000);

    test('copied substacks move between independent roots without losing nested inputs', async () => {
        await open('copied-substacks');
        await helper.clickBlocksCategory('Control');
        const source = await drag(await findBlock('control_repeat', true), true, {x: 510, y: 230});
        const wait = await drag(await findBlock('control_wait', true), true,
            {parentId: source, inputName: 'SUBSTACK'});
        await helper.clickBlocksCategory('Operators');
        const add = await drag(await findBlock('operator_add', true), true, {parentId: wait, inputName: 'DURATION'});
        await drag(await findBlock('operator_add', true), true, {parentId: add, inputName: 'NUM1'});
        const copy = await copyBlock(source, {x: 790, y: 420});
        const child = await driver.executeScript(`
            return window.__authoringWorkspace.getBlockById(arguments[0]).getInputTargetBlock('SUBSTACK').id;
        `, copy);
        await drag(child, false, {parentId: source, inputName: 'SUBSTACK'});
        await exercise('copied compound substack', ['clipboard-block-paste']);
        // Interrupt the compound paste during its native placement, not during
        // an unrelated flyout move. Verify the committed boundary independently.
        phase = 'copied compound substack interrupted placement';
        await control('tw-studio-step', 4); await ready(4, 6);
        await control('tw-studio-speed', 0.5); await click('Play');
        await driver.wait(() => driver.executeScript(`
            return window.__authoringWorkspace.isDragging();
        `), 20000);
        const body = driver.findElement(By.css('body'));
        await body.sendKeys(Key.ESCAPE);
        await driver.wait(async () => (await healthy()).includes('stopped'), 20000);
        const stopped = await position();
        expect([4, 5]).toContain(stopped);
        await assertBoundary(stopped);
        expect(await driver.executeScript('return Boolean(window.__authoringWorkspace.isDragging());')).toBe(false);
        await body.sendKeys(Key.chord(Key.CONTROL, 'z')); await ready(stopped - 1, 6);
        await assertBoundary(stopped - 1);
        await body.sendKeys(Key.chord(Key.CONTROL, Key.SHIFT, 'z')); await ready(stopped, 6);
        await assertBoundary(stopped);
        await control('tw-studio-speed', 2); await click('Play'); await ready(6, 6);
        await assertBoundary(6);
    }, 240000);

    test.each([
        ['control_repeat', false, 1, false], ['control_if_else', true, 1, false],
        ['control_forever', false, 2, false], ['control_repeat', false, 1, true]
    ])(
        'previews a real %s wrap identically in Play and history (nested: %s, zoom: %s, existing: %s)',
        async (type, nested, scale, existing) => {
            await open(`wrap-preview-${type}${existing ? '-existing' : ''}`);
            await driver.executeScript('window.__authoringWorkspace.setScale(arguments[0]);', scale);
            await helper.clickBlocksCategory('Events');
            const root = await drag(await findBlock('event_whenflagclicked', true), true, {x: 530, y: 230});
            await helper.clickBlocksCategory('Control');
            const parent = nested ? await drag(await findBlock('control_repeat', true), true, {parentId: root}) : root;
            const destination = {parentId: parent, ...(nested ? {inputName: 'SUBSTACK'} : {})};
            const child = await drag(await findBlock('control_wait', true), true, destination);
            await drag(await findBlock('control_wait', true), true, {parentId: child});
            const existingWrapper = existing ?
                await drag(await findBlock(type, true), true, {x: 800, y: 450}) : null;
            const startTrace = () => driver.executeScript(`
                const trace={active:true,frames:[]};window.__wrapPreviewTrace=trace;
                const tick=()=>{
                    if(!trace.active)return;
                    const scene=document.querySelector('.blocklyTransitionWorkspace');
                    const ws=window.__authoringWorkspace;
                    const canvas=scene || document;
                    const roots=[...canvas.querySelectorAll('g[data-id]')].filter(el=>
                        !el.closest('.blocklyFlyout') && (!scene || el.closest('.blocklyTransitionWorkspace')));
                    const mainBlocks=ws.getAllBlocks(false);
                    const isType=(el,type)=>mainBlocks.some(block=>block.id===el.getAttribute('data-id') &&
                        !block.isInsertionMarker() && block.type===type);
                    const wrapper=scene ? scene.querySelector('[data-studio-transition-actor]') :
                        roots.find(el=>isType(el,arguments[0]));
                    const marker=roots.find(el=>el.classList.contains('blocklyInsertionMarker') &&
                        getComputedStyle(el).visibility!=='hidden' && el.getBoundingClientRect().width>0);
                    const flag=roots.find(el=>isType(el,'event_whenflagclicked'));
                    const waits=roots.filter(el=>isType(el,'control_wait'));
                    const point=el=>{const b=el.querySelector('.blocklyPath').getBoundingClientRect();
                        return {x:b.x,y:b.y,width:b.width,height:b.height};};
                    if(wrapper && waits.length===2 && flag) trace.frames.push({
                        scene:!!scene,kind:wrapper.getAttribute('data-studio-transition-actor'),
                        actor:point(wrapper),flag:point(flag),waits:waits.map(point),
                        carried:waits.filter(el=>wrapper.contains(el)).length,
                        enclosed:marker ? waits.filter(el=>marker.contains(el)).length : 0,
                        marker:marker ? point(marker) : null
                    });
                    requestAnimationFrame(tick);
                };requestAnimationFrame(tick);
            `, type);
            const endTrace = async label => {
                const frames = await driver.executeScript(`
                    window.__wrapPreviewTrace.active=false;return window.__wrapPreviewTrace.frames;
                `);
                fs.writeFileSync(path.join(artifacts, `${takeName}-${label}.json`), JSON.stringify(frames, null, 2));
                return frames;
            };
            await startTrace();
            await drag(existingWrapper || await findBlock(type, true), !existing,
                {...destination, wrapInput: 'SUBSTACK'});
            const authored = await endTrace('authored');
            const naturalPreview = authored.filter(frame => frame.marker && frame.enclosed === 2).pop();
            expect(naturalPreview).toBeDefined();
            const relative = frame => frame.waits.map(wait => ({
                x: wait.x - frame.flag.x, y: wait.y - frame.flag.y
            }));
            const assertWrapPreview = frames => {
                const previews = frames.filter(frame => frame.marker);
                expect(previews.length).toBeGreaterThan(2);
                for (const frame of previews) {
                    expect(frame.carried).toBe(0);
                    expect(frame.enclosed).toBe(2);
                    relative(frame).forEach((point, index) => {
                        expect(Math.abs(point.x - relative(naturalPreview)[index].x)).toBeLessThan(1);
                        expect(Math.abs(point.y - relative(naturalPreview)[index].y)).toBeLessThan(1);
                    });
                }
                const entering = previews.filter(frame => frame.kind === 'enter').pop();
                const exiting = previews.find(frame => frame.kind === 'exit');
                for (const frame of [entering, exiting].filter(Boolean)) {
                    expect(Math.abs(frame.actor.height - frame.marker.height)).toBeLessThan(1);
                }
            };
            const total = 4 + Number(nested) + Number(existing);
            const visiblePreview = () => driver.executeScript(`
                return [...document.querySelectorAll('.blocklyTransitionWorkspace .blocklyInsertionMarker')]
                    .some(el=>getComputedStyle(el).visibility!=='hidden' && el.getBoundingClientRect().width>0);
            `);
            await control('tw-studio-range-start', total - 1);
            await control('tw-studio-range-end', total);
            await control('tw-studio-speed', 0.5);
            for (let cycle = 0; cycle < 2; cycle++) {
                for (const redo of [false, true]) {
                    phase = `${type} ${cycle} ${redo ? 'redo' : 'undo'}`;
                    await startTrace();
                    if (cycle === 0) {
                        await driver.findElement(By.css('body')).sendKeys(
                            redo ? Key.chord(Key.CONTROL, Key.SHIFT, 'z') : Key.chord(Key.CONTROL, 'z'));
                    } else {
                        await driver.findElement(By.css(`[title="Play selected range ${
                            redo ? 'forward' : 'backward'}"]`)).click();
                    }
                    if (!existing) await driver.wait(visiblePreview, 5000);
                    fs.writeFileSync(path.join(artifacts, `${takeName}-${cycle}-${redo ? 'redo' : 'undo'}.png`),
                        Buffer.from(await driver.takeScreenshot(), 'base64'));
                    await ready(redo ? total : total - 1, total);
                    await assertBoundary(redo ? total : total - 1);
                    assertWrapPreview(await endTrace(`${cycle}-${redo ? 'redo' : 'undo'}`));
                }
                await startTrace(); await click('Play');
                await driver.wait(async () => (await healthy()).includes('played'), 90000);
                await ready(total, total); await assertBoundary(total);
                assertWrapPreview(await endTrace(`${cycle}-play`));
            }
        }, 180000
    );

    test.each([false, true])('codes then shares a stack after checkpoint replay (edit copy: %s)', async editCopy => {
        await open(editCopy ? 'code-share-then-wrap' : 'code-before-sprite-share');
        await helper.clickBlocksCategory('Events');
        const root = await drag(await findBlock('event_whenflagclicked', true), true, {x: 511, y: 233});
        await helper.clickBlocksCategory('Control');
        await drag(await findBlock('control_wait', true), true, {parentId: root});
        const spriteMenu = await driver.findElement(By.css('[data-studio-target="sprite-library-open"]'));
        await driver.actions().move({origin: spriteMenu})
            .perform();
        const paint = spriteMenu.findElement(By.xpath('..')).findElement(By.css('[aria-label="Paint"]'));
        await driver.wait(() => driver.executeScript(`
            const el=arguments[0],box=el.getBoundingClientRect();
            return el.contains(document.elementFromPoint(box.x+box.width/2,box.y+box.height/2));
        `, paint), 10000); await paint.click();
        await ready(3, 3); await remember(3);
        await driver.findElement(By.xpath('//*[@role="tab" and contains(.,"Code")]')).click();
        await selectSprite('Sprite1');
        const source = await driver.findElement(By.css(`g[data-id="${root}"] > .blocklyPath`));
        const target = await driver.findElement(By.css('[data-studio-sprite-name="Sprite2"]'));
        await driver.actions().move({origin: source})
            .press()
            .move({origin: target, duration: 900})
            .release()
            .perform();
        await settle(); await ready(4, 4); await remember(4);
        if (editCopy) {
            await selectSprite('Sprite2'); await helper.clickBlocksCategory('Control');
            const copiedRoot = await findBlock('event_whenflagclicked');
            const wrapper = await drag(await findBlock('control_repeat', true), true,
                {parentId: copiedRoot, wrapInput: 'SUBSTACK'});
            expect(await driver.executeScript(`
                return window.__authoringWorkspace.getBlockById(arguments[0])
                    .getInputTargetBlock('SUBSTACK')?.type;
            `, wrapper)).toBe('control_wait');
            await selectSprite('Sprite1'); await helper.clickBlocksCategory('Control');
            await drag(await findBlock('control_wait', true), true, {parentId: await findBlock('control_wait')});
        }
        const total = editCopy ? 6 : 4;
        for (let cycle = 0; cycle < 2; cycle++) {
            phase = `code-before-sprite-share Play ${cycle}`;
            await driver.executeScript(`
                window.__sharePresentation={active:true,frames:[],clicks:[]};
                const trace=window.__sharePresentation;
                const onClick=event=>{
                    const card=event.target.closest('[data-studio-sprite-name]');
                    const pointer=document.getElementById('tw-studio-native-pointer');
                    if(card)trace.clicks.push({name:card.dataset.studioSpriteName,time:performance.now(),
                        pointer:Boolean(pointer && getComputedStyle(pointer).visibility!=='hidden' &&
                            Number(getComputedStyle(pointer).opacity)>0 &&
                            Math.hypot(parseFloat(pointer.style.left)-event.clientX,
                                parseFloat(pointer.style.top)-event.clientY)<2)});
                };
                document.addEventListener('click',onClick,true);
                const tick=()=>{
                    if(!trace.active){document.removeEventListener('click',onClick,true);return;}
                    const status=document.getElementById('tw-studio-session-panel').textContent;
                    if(/playing ·/.test(status)){
                        const root=document.querySelector('[data-studio-share-actor]');
                        const box=root?.getBoundingClientRect();
                        const selected=[...document.querySelectorAll('[data-studio-sprite-name]')]
                            .find(card=>card.className.includes('is-selected'));
                        const destination=document.querySelector('[data-studio-sprite-name="Sprite2"]')
                            ?.getBoundingClientRect();
                        const pointer=document.getElementById('tw-studio-native-pointer');
                        const x=parseFloat(pointer?.style.left),y=parseFloat(pointer?.style.top);
                        const add=document.querySelector('[data-studio-target="sprite-library-open"]')
                            ?.getBoundingClientRect();
                        const visible=pointer && getComputedStyle(pointer).visibility!=='hidden' &&
                            Number(getComputedStyle(pointer).opacity)>0;
                        const inside=rect=>rect && x>=rect.left && x<=rect.right &&
                            y>=rect.top && y<=rect.bottom;
                        trace.frames.push({time:performance.now(),name:selected?.dataset.studioSpriteName,
                            cursor:Number(document.getElementById('tw-studio-step').value),
                            pointerOnAdd:Boolean(visible && inside(add)),
                            pressedOnAdd:Boolean(visible && inside(add) && pointer.dataset.pressed==='true'),
                            actor:box?{x:box.x,y:box.y,width:box.width,height:box.height}:null,
                            heldOnDestination:Boolean(inside(box) && inside(destination))});
                    }
                    requestAnimationFrame(tick);
                };requestAnimationFrame(tick);
            `);
            await control('tw-studio-speed', 2); await click('Play');
            await driver.wait(async () => (await healthy()).includes('played'), 90000);
            await ready(total, total); await assertBoundary(total);
            const presentation = await driver.executeScript(`
                window.__sharePresentation.active=false;return window.__sharePresentation;
            `);
            fs.writeFileSync(path.join(artifacts, `${takeName}-selection-${cycle}.json`),
                JSON.stringify(presentation, null, 2));
            const shares = presentation.frames.filter(frame => frame.actor);
            expect(shares.length).toBeGreaterThan(2);
            expect(shares.every(frame => frame.name === 'Sprite1')).toBe(true);
            expect(shares.filter(frame => frame.heldOnDestination).length).toBeGreaterThan(2);
            let previousName = 'Sprite1';
            let previousTime = 0;
            // A checkpoint can briefly unmount all selector cards while assets
            // load. Keep the previous identity across that loading frame; it
            // is not a selection of another sprite or a reason to waive the
            // click requirement for the next actual selected card. Creation
            // selects through Add, rather than an extra new-tile click.
            for (const frame of presentation.frames.filter(item => item.name)) {
                if (frame.name !== previousName) {
                    const since = previousTime;
                    const clickedCard = presentation.clicks.some(press => press.name === frame.name && press.pointer &&
                        press.time >= since && press.time <= frame.time);
                    const createdOnAdd = frame.name === 'Sprite2' && [2, 3].includes(frame.cursor) &&
                        frame.pointerOnAdd && presentation.frames.some(previous => previous.pressedOnAdd &&
                            previous.time >= since && previous.time < frame.time);
                    expect(Boolean(clickedCard || createdOnAdd)).toBe(true);
                    previousName = frame.name;
                    previousTime = frame.time;
                }
            }
            if (!editCopy) {
                const result = await driver.executeScript(
                    'return JSON.parse(document.getElementById("tw-studio-native-evidence").textContent);');
                expect(result.nativeInteraction || result).toMatchObject({status: 'verified',
                    evidence: {stackMoved: true, projectMatches: true}});
            }
            for (let cursor = total - 1; cursor >= 0; cursor--) {
                await performStudioHistoryEdit(driver);
                await ready(cursor, total); await assertBoundary(cursor);
            }
            for (let cursor = 1; cursor <= total; cursor++) {
                await performStudioHistoryEdit(driver, true);
                await ready(cursor, total); await assertBoundary(cursor);
            }
            if (editCopy) {
                await control('tw-studio-speed', 4);
                await driver.findElement(By.css('[title="Play timeline backward"]')).click();
                await ready(0, total); await assertBoundary(0);
                await driver.findElement(By.css('[title="Play timeline forward"]')).click();
                await ready(total, total); await assertBoundary(total);
            }
            if (cycle === 0) {
                await driver.navigate().refresh(); await ready(0, total);
                await driver.executeScript('window.__authoringWorkspace=window.ScratchBlocks.getMainWorkspace();');
            }
        }
    }, 180000);

    test.each([false, true])('attached substack sharing has no phantom history (Alt: %s)', async duplicate => {
        await open(duplicate ? 'shared-duplicate-substack' : 'shared-attached-substack');
        await driver.findElement(By.css('[data-studio-target="sprite-library-open"]')).click();
        await helper.clickText('Apple', helper.scope.modal);
        await ready(1, 1); await remember(1);
        await selectSprite('Sprite1'); await helper.clickBlocksCategory('Control');
        const wait = await drag(await findBlock('control_wait', true), true, {x: 510, y: 230});
        const repeat = await drag(await findBlock('control_if_else', true), true, {parentId: wait});
        await drag(await findBlock('control_wait', true), true, {parentId: repeat, inputName: 'SUBSTACK'});
        const before = await position();
        const point = await driver.executeScript(`
            const root=window.__authoringWorkspace.getBlockById(arguments[0]).getSvgRoot();
            const box=root.querySelector('.blocklyPath').getBoundingClientRect();
            for(let y=3;y<32;y+=3) for(let x=3;x<box.width-3;x+=3) {
                const hit=document.elementFromPoint(box.left+x,box.top+y);
                if(hit && hit.closest('[data-id]')===root && !hit.closest('.blocklyEditableText'))
                    return {x:Math.round(box.left+x),y:Math.round(box.top+y)};
            }
            throw new Error('No exposed substack pickup');
        `, repeat);
        const apple = await driver.findElement(By.css('[data-studio-sprite-name="Apple"]'));
        const actions = driver.actions();
        if (duplicate) actions.keyDown(Key.ALT);
        await actions.move({origin: 'viewport', ...point})
            .press()
            .move({origin: apple, duration: 900})
            .release()
            .keyUp(Key.ALT)
            .perform();
        await settle();
        await driver.wait(async () => (await healthy()).includes('Copy script'), 20000);
        const total = (await journal()).transactions.length;
        await ready(total, total); await remember(total);
        expect(total).toBe(before + 1);
        await performStudioHistoryEdit(driver);
        await ready(before, total); await assertBoundary(before);
        await performStudioHistoryEdit(driver);
        await ready(before - 1, total); await assertBoundary(before - 1);
        const shareApproach = () => driver.executeScript(`
            const frames=window.__shareFrames;
            return frames.length>2 && frames[frames.length-1].x>900;
        `);
        for (let cycle = 0; cycle < 2; cycle++) {
            await control('tw-studio-speed', 0.5);
            await driver.executeScript(`
                window.__shareFrames=[];window.__watchShare=true;
                const tick=()=>{
                    if(!window.__watchShare)return;
                    const root=document.querySelector('[data-studio-share-actor]');
                    if(root){const box=root.getBoundingClientRect();
                        window.__shareFrames.push({x:box.x,y:box.y,width:box.width,height:box.height,
                            labels:[...root.querySelectorAll('.blocklyText')].map(el=>el.textContent)});}
                    requestAnimationFrame(tick);
                };requestAnimationFrame(tick);
            `);
            await click('Play');
            await driver.wait(shareApproach, 30000);
            fs.writeFileSync(path.join(artifacts, `share-drag-${cycle}.png`),
                Buffer.from(await driver.takeScreenshot(), 'base64'));
            await ready(total, total); await assertBoundary(total);
            const frames = await driver.executeScript('window.__watchShare=false;return window.__shareFrames;');
            expect(frames.length).toBeGreaterThan(8);
            expect(frames.every(frame => frame.labels.includes('else') && frame.labels.includes('wait'))).toBe(true);
            expect(Math.max(...frames.map(frame => frame.x)) - Math.min(...frames.map(frame => frame.x)))
                .toBeGreaterThan(300);
            for (let cursor = total - 1; cursor >= 0; cursor--) {
                await performStudioHistoryEdit(driver);
                await ready(cursor, total); await assertBoundary(cursor);
            }
            for (let cursor = 1; cursor <= total; cursor++) {
                await performStudioHistoryEdit(driver, true);
                await ready(cursor, total); await assertBoundary(cursor);
            }
            if (cycle === 0) {
                await driver.navigate().refresh(); await ready(0, total);
                await driver.executeScript('window.__authoringWorkspace=window.ScratchBlocks.getMainWorkspace();');
            }
        }
    }, 180000);

    test('cross-sprite branching preserves each target through history, Play and reload', async () => {
        await open('cross-sprite-branch');
        await driver.findElement(By.css('[data-studio-target="sprite-library-open"]')).click();
        await helper.clickText('Apple', helper.scope.modal);
        await ready(1, 1); await remember(1);
        await selectSprite('Sprite1'); await helper.clickBlocksCategory('Control');
        const repeat = await drag(await findBlock('control_repeat', true), true, {x: 510, y: 230});
        const wait = await drag(await findBlock('control_wait', true), true,
            {parentId: repeat, inputName: 'SUBSTACK'});
        await helper.clickBlocksCategory('Operators');
        await drag(await findBlock('operator_add', true), true, {parentId: wait, inputName: 'DURATION'});
        await selectSprite('Apple'); await helper.clickBlocksCategory('Control');
        const other = await drag(await findBlock('control_repeat', true), true, {x: 540, y: 280});
        const otherWait = await drag(await findBlock('control_wait', true), true,
            {parentId: other, inputName: 'SUBSTACK'});
        await helper.clickBlocksCategory('Operators');
        await drag(await findBlock('operator_add', true), true, {parentId: otherWait, inputName: 'DURATION'});
        // Start history on a different sprite from the transaction being undone.
        await selectSprite('Sprite1');
        for (const cursor of [6, 5]) {
            await performStudioHistoryEdit(driver);
            await ready(cursor, 7); await assertBoundary(cursor);
        }
        await selectSprite('Sprite1'); await helper.clickBlocksCategory('Control');
        const sourceId = await findBlock('control_repeat');
        await drag(await findBlock('control_wait', true), true, {parentId: sourceId, inputName: 'SUBSTACK'});
        expect((await journal()).transactions).toHaveLength(6);
        await exercise('cross-sprite branch replacement');
    }, 240000);
});
