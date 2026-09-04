import fs from 'fs';
import path from 'path';
import webdriver from 'selenium-webdriver';
import SeleniumHelper from '../helpers/selenium-helper';

const {By, Key} = webdriver;
const helper = new SeleniumHelper({windowWidth: 1600, windowHeight: 1000});
const describeBrowser = process.env.STUDIO_BROWSER_URL ? describe : describe.skip;
const artifacts = path.resolve('.tmp/minimap-mouth-evidence');

describeBrowser('Workspace minimap native silhouettes', () => {
    let driver;
    const painted = () => driver.executeAsyncScript(`const done=arguments[arguments.length-1];
        requestAnimationFrame(()=>requestAnimationFrame(done));`);
    beforeEach(async () => {
        driver = helper.getDriver();
        await helper.loadUri(process.env.STUDIO_BROWSER_URL);
        await driver.wait(() => driver.executeScript(`return !!window.vm?.editingTarget &&
            !!document.querySelector('[data-workspace-minimap]')?.dataset.landmarkRevision;`), 30000);
        fs.mkdirSync(artifacts, {recursive: true});
    });
    afterEach(async () => {
        try {
            const name = expect.getState().currentTestName.replace(/[^a-z0-9]+/gi, '-');
            fs.writeFileSync(path.join(artifacts, `${name}.png`), Buffer.from(await driver.takeScreenshot(), 'base64'));
        } finally {
            await driver.quit();
        }
    });

    const seed = async (xml, rtl = false) => {
        await driver.executeScript(`const B=window.ScratchBlocks, ws=B.getMainWorkspace();
            ws.clear(); ws.RTL=arguments[1]; ws.options.RTL=arguments[1];
            B.Xml.domToWorkspace(B.Xml.textToDom(arguments[0]),ws);
            ws.getAllBlocks(false).forEach(b=>b.render());
            ws.clearUndo();`, xml, rtl);
        await painted();
        await driver.sleep(150); // Native grouped events reach the addon on a later turn.
    };

    const mouthPixels = () => driver.executeScript(`
        const ws=window.ScratchBlocks.getMainWorkspace(), root=document.querySelector('[data-workspace-minimap]');
        const canvas=root.querySelector('.sa-workspace-minimap-landmarks'), ctx=canvas.getContext('2d');
        const width=canvas.clientWidth, height=canvas.clientHeight, ratio=canvas.width/width;
        const world={left:+root.dataset.worldLeft,top:+root.dataset.worldTop,
            width:+root.dataset.worldWidth,height:+root.dataset.worldHeight};
        const scale=Math.min((width-14)/world.width,(height-14)/world.height);
        const ox=(width-world.width*scale)/2, oy=(height-world.height*scale)/2;
        const result=[];
        for(const block of ws.getAllBlocks(false)) for(const input of block.inputList) {
            if(input.type!==3 || input.connection.targetBlock()) continue;
            const xy=block.getRelativeToSurfaceXY();
            const x=xy.x+(block.RTL?-1:1)*block.width*0.7, y=input.connection.y_+12;
            const px=Math.floor((ox+(x-world.left)*scale)*ratio);
            const py=Math.floor((oy+(y-world.top)*scale)*ratio);
            result.push({id:block.id,input:input.name,alpha:ctx.getImageData(px,py,1,1).data[3]});
        }
        const data=ctx.getImageData(0,0,canvas.width,canvas.height).data;
        return {mouths:result,paintedPixels:data.filter((v,i)=>i%4===3&&v>0).length};`);

    test.each([false, true])('empty, if/else and nested C mouths remain open, RTL=%s', async rtl => {
        await seed(`<xml xmlns="http://www.w3.org/1999/xhtml">
            <block type="control_repeat" id="empty" x="100" y="100"/>
            <block type="control_if_else" id="branches" x="350" y="100"/>
            <block type="control_repeat" id="outer" x="100" y="280">
                <statement name="SUBSTACK"><block type="control_if_else" id="inner"/></statement>
            </block></xml>`, rtl);
        // Exercise the actual resizer keyboard control, not a CSS override.
        const resizer = await driver.findElement(By.css('[aria-label="Resize code overview"]'));
        await resizer.sendKeys(...Array(14).fill(Key.ARROW_UP));
        await painted();
        const first = await mouthPixels();
        expect(first.mouths).toHaveLength(5);
        expect(first.mouths.every(mouth => mouth.alpha === 0)).toBe(true);
        expect(first.paintedPixels).toBeGreaterThan(60);

        // A real child insertion expands the outer mouth; the cached native
        // path must refresh, while its remaining nested mouths stay empty.
        await driver.executeScript(`const B=window.ScratchBlocks,ws=B.getMainWorkspace();
            B.Events.setGroup(true);
            const b=B.Xml.domToBlock(B.Xml.textToDom('<block type="motion_movesteps"/>'),ws);
            ws.getBlockById('inner').nextConnection.connect(b.previousConnection);
            B.Events.setGroup(false);`);
        await painted();
        await driver.sleep(150);
        expect((await mouthPixels()).mouths.every(mouth => mouth.alpha === 0)).toBe(true);
        await driver.executeScript('window.ScratchBlocks.getMainWorkspace().undo(false);');
        await painted();
        await driver.sleep(150);
        expect((await mouthPixels()).mouths.every(mouth => mouth.alpha === 0)).toBe(true);
    });

    test('dense C-block landmarks stay fixed during a real minimap drag without rescanning scripts', async () => {
        const blocks = Array.from({length: 200}, (_, i) => `<block type="control_repeat"
            x="${(i % 10) * 250}" y="${Math.floor(i / 10) * 300}"><statement name="SUBSTACK">
            <block type="motion_movesteps"><next><block type="looks_say"><next>
            <block type="motion_turnright"><next><block type="control_wait"/></next></block>
            </next></block></next></block></statement></block>`).join('');
        await seed(`<xml xmlns="http://www.w3.org/1999/xhtml">${blocks}</xml>`);
        await driver.wait(() => driver.executeScript(`return +document.querySelector('[data-workspace-minimap]')
            .dataset.blockCount===1000;`), 10000);
        const before = await driver.executeScript(`const ws=window.ScratchBlocks.getMainWorkspace();
            const original=ws.getAllBlocks; window.__minimapScans=0;
            ws.getAllBlocks=function(...args){window.__minimapScans++; return original.apply(this,args);};
            const root=document.querySelector('[data-workspace-minimap]');
            return {pixels:root.querySelector('canvas').toDataURL(),...root.dataset};`);
        const target = await driver.findElement(By.css('.sa-workspace-minimap-viewport'));
        await driver.actions().move({origin: target}).press().move({origin: target, x: 25, y: 30, duration: 700})
            .release().perform();
        await driver.wait(() => driver.executeScript(`return document.querySelector('[data-workspace-minimap]')
            .dataset.panState==='idle';`), 10000);
        const after = await driver.executeScript(`const root=document.querySelector('[data-workspace-minimap]');
            return {pixels:root.querySelector('canvas').toDataURL(),scans:window.__minimapScans,...root.dataset};`);
        expect(after.landmarkRevision).toBe(before.landmarkRevision);
        expect(after.pixels).toBe(before.pixels);
        expect(Number(after.viewportRevision)).toBeGreaterThan(Number(before.viewportRevision));
        expect(after.scans).toBe(0);
        expect([after.viewLeft, after.viewTop]).not.toEqual([before.viewLeft, before.viewTop]);
    }, 60000);
});
