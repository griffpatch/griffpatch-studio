import fs from 'fs';
import path from 'path';
import express from 'express';
import webdriver from 'selenium-webdriver';
import SeleniumHelper from '../helpers/selenium-helper';

const {By, until} = webdriver;
const describeBrowser = process.env.SVG_ISOLATION_BUILD ? describe : describe.skip;
const normal = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80">
<defs><linearGradient id="g"><stop stop-color="#ff3030"/><stop offset="1" stop-color="#3030ff"/></linearGradient></defs>
<rect x="0" y="0" width="120" height="80" rx="10" fill="url(#g)"/>
<circle cx="25" cy="25" r="12" fill="#fff"/><text x="15" y="65" fill="#fff" font-size="18">Studio</text></svg>`;

describeBrowser('SVG sandbox boundaries in the real editor', () => {
    let server;
    let sink;
    let base;
    let sinkURL;
    let requests;
    let driver;
    const artifacts = path.resolve('.tmp/svg-isolation-evidence');
    beforeAll(async () => {
        fs.mkdirSync(artifacts, {recursive: true});
        const listen = app => new Promise(resolve => {
            const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
        });
        const app = express();
        app.use(express.static(path.resolve(process.env.SVG_ISOLATION_BUILD)));
        server = await listen(app);
        base = `http://127.0.0.1:${server.address().port}/editor.html`;
        const receiver = express();
        receiver.use((req, res) => {
            requests.push(req.url);
            res.set('Cache-Control', 'no-store');
            if (req.path.endsWith('.js')) {
                res.type('js').send('parent.__svgScriptRan=(parent.__svgScriptRan||0)+1;');
            } else if (req.path.endsWith('.css')) {
                res.type('css').send('body { background-color: rgb(1, 2, 3); }');
            } else {
                res.type('svg').send('<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2" fill="red"/></svg>');
            }
        });
        sink = await listen(receiver);
        sinkURL = `http://127.0.0.1:${sink.address().port}`;
    });
    afterAll(async () => {
        for (const listener of [server, sink]) if (listener) await new Promise(resolve => listener.close(resolve));
    });
    beforeEach(async () => {
        requests = [];
        driver = new SeleniumHelper({windowWidth: 1440, windowHeight: 1000}).getDriver();
        await driver.sendDevToolsCommand('Network.enable', {});
        // Payloads address only our second loopback server, which is NOT blocked.
        // Prevent unrelated editor services from receiving test traffic.
        await driver.sendDevToolsCommand('Network.setBlockedURLs', {urls: ['https://*', 'wss://*', 'ws://*']});
        await driver.get(base);
        await driver.wait(() => driver.executeScript('return !!window.vm?.editingTarget;'), 20000);
        await driver.executeScript(`window.__svgScriptRan=0;
            const el=document.createElement('div');el.id='svg-probe-sentinel';el.textContent='Isolation sentinel';
            el.style.cssText='position:fixed;top:4px;left:400px;z-index:999999;background:rgb(10,20,30);color:white';
            document.body.appendChild(el);`);
    });
    afterEach(async () => {
        if (!driver) return;
        try {
            const name = expect.getState().currentTestName.replace(/[^a-z0-9]+/gi, '-');
            fs.writeFileSync(path.join(artifacts, `${name}.json`), JSON.stringify({
                requests, logs: await driver.manage().logs().get('browser')
            }, null, 2));
            fs.writeFileSync(path.join(artifacts, `${name}.png`), Buffer.from(await driver.takeScreenshot(), 'base64'));
        } finally { await driver.quit(); }
    });
    const settle = () => driver.executeAsyncScript('const done=arguments[arguments.length-1];setTimeout(done,600);');
    const importCostume = async svg => {
        const result = await driver.executeAsyncScript(`const svg=arguments[0],done=arguments[arguments.length-1];
            const vm=window.vm,s=vm.runtime.storage;
            const asset=s.createAsset(s.AssetType.ImageVector,s.DataFormat.SVG,new TextEncoder().encode(svg),null,true);
            vm.addCostume(asset.assetId+'.svg',{name:'Isolation test',asset,assetId:asset.assetId,
                dataFormat:'svg',bitmapResolution:1,rotationCenterX:60,rotationCenterY:40}).then(()=>{
                vm.emitTargetsUpdate();done({ok:true});
            }).catch(e=>done({error:String(e)}));`, svg);
        expect(result).toEqual({ok: true});
        await driver.findElement(By.id('react-tabs-2')).click();
        await driver.wait(until.elementLocated(By.css('iframe.tw-paper-sandbox')), 15000);
        await settle();
    };
    const intact = async () => {
        expect(await driver.executeScript('return window.__svgScriptRan;')).toBe(0);
        expect(await driver.executeScript(`return getComputedStyle(document.querySelector('#svg-probe-sentinel')).backgroundColor;`))
            .toBe('rgb(10, 20, 30)');
        expect(requests).toEqual([]);
    };
    const policies = () => driver.executeScript(`return Array.from(document.querySelectorAll(
        'iframe.scratch-svg-renderer-sandbox,iframe.tw-paper-sandbox')).map(f=>({
            name:f.className,sandbox:f.getAttribute('sandbox'),
            policy:f.contentDocument.querySelector('meta[http-equiv="Content-Security-Policy"]').content}));`);

    test('raw project costume path and real costume-tab import isolate hostile SVG content', async () => {
        const hostile = normal.replace('</svg>', `<style>
            @import '${sinkURL}/import.css';
            * { transition: all 9999s; background-image:image-set('${sinkURL}/css.svg' 1x); }
            #svg-probe-sentinel { background:rgb(255,0,255) !important; }
            g { rect { background-image:url('${sinkURL}/nested.svg'); } }
            </style><image href="${sinkURL}/image.svg" width="10" height="10"/>
            <script>parent.__svgScriptRan++;</script>
            <foreignObject><img xmlns="http://www.w3.org/1999/xhtml" src="${sinkURL}/html.svg"
            onload="parent.__svgScriptRan++"/></foreignObject></svg>`);
        await importCostume(hostile);
        const frames = await policies();
        expect(frames.map(f => f.name).sort()).toEqual(['scratch-svg-renderer-sandbox', 'tw-paper-sandbox']);
        for (const frame of frames) {
            expect(frame.sandbox).toBe('allow-same-origin');
            expect(frame.policy).toBe("default-src 'none'; style-src 'unsafe-inline' data:; font-src data:; img-src data:");
        }
        await intact();
    });

    // Deliberately bypass DOMPurify only inside the test to exercise the sandbox
    // independently. The same probes must be effective in an unprotected frame.
    const probe = selector => driver.executeAsyncScript(`const selector=arguments[0],url=arguments[1],
        done=arguments[arguments.length-1];
        let frame=selector && document.querySelector(selector);
        if(!frame){frame=document.createElement('iframe');frame.id='unprotected-control';document.body.appendChild(frame);}
        const d=frame.contentDocument;
        d.body.innerHTML='<style>@import "'+url+'/probe.css"; body{background-image:image-set("'+url+
            '/image-set.svg" 1x)} #svg-probe-sentinel{background:magenta!important}</style>'+
            '<img src="'+url+'/probe.svg" onload="parent.__svgScriptRan++">';
        const script=d.createElement('script');script.src=url+'/probe.js';d.body.appendChild(script);
        const inline=d.createElement('script');inline.textContent='parent.__svgScriptRan++';d.body.appendChild(inline);
        void d.body.offsetHeight;
        setTimeout(()=>done({scriptRan:window.__svgScriptRan,style:getComputedStyle(
            document.querySelector('#svg-probe-sentinel')).backgroundColor}),600);`, selector, sinkURL);

    test('sandbox blocks active probes even without sanitisation; unprotected control proves probes work', async () => {
        await importCostume(normal);
        await probe('iframe.scratch-svg-renderer-sandbox');
        await intact();
        await probe('iframe.tw-paper-sandbox');
        await intact();
        const control = await probe(null);
        expect(control.scriptRan).toBeGreaterThanOrEqual(2);
        expect(requests).toEqual(expect.arrayContaining(['/probe.svg', '/probe.js', '/probe.css', '/image-set.svg']));
        await driver.executeScript('document.querySelector("#unprotected-control").remove();');
    });

    test.each([
        ['SVG x/y text', normal],
        ['plain transformed text', normal.replace('x="15" y="65"', 'transform="translate(15 65)"')],
        ['Scratch 3 tspan text', normal.replace('x="15" y="65"', 'transform="translate(15 65)"')
            .replace('>Studio</text>', '><tspan x="0" dy="0">Studio</tspan></text>')]
    ])('%s retains shape dimensions and visible paint pixels', async (label, svg) => {
        await importCostume(svg);
        const rendered = await driver.executeScript(`const t=vm.editingTarget,b=t.getBounds();
            const canvases=Array.from(document.querySelectorAll('#react-tabs-3 canvas'));
            return {width:b.right-b.left,height:b.top-b.bottom,canvases:canvases.map(c=>{
                try{const p=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
                    let colorful=0;for(let i=0;i<p.length;i+=4)if(p[i+3]&&Math.abs(p[i]-p[i+2])>40)colorful++;
                    return colorful;}catch(e){return -1;}})};`);
        expect(rendered.width).toBeGreaterThanOrEqual(118);
        expect(rendered.height).toBeGreaterThanOrEqual(78);
        expect(rendered.canvases.some(count => count > 100)).toBe(true);
        await intact();
    });
});
