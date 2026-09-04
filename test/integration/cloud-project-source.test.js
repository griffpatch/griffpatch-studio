import fs from 'fs';
import path from 'path';
import JSZip from '@turbowarp/jszip';
import SeleniumHelper from '../helpers/selenium-helper';

const describeBrowser = process.env.STUDIO_BROWSER_URL ? describe : describe.skip;
const helper = new SeleniumHelper({windowWidth: 1280, windowHeight: 900});

describeBrowser('Cloud project source isolation in the real player', () => {
    let driver;
    let fixture;
    beforeAll(async () => {
        const zip = await JSZip.loadAsync(fs.readFileSync(path.resolve('test/fixtures/project1.sb3')));
        const project = JSON.parse(await zip.file('project.json').async('string'));
        project.targets.find(target => target.isStage).variables.cloudSourceTest = ['☁ source test', 0, true];
        zip.file('project.json', JSON.stringify(project));
        fixture = await zip.generateAsync({type: 'base64', compression: 'DEFLATE'});
    });
    beforeEach(async () => {
        driver = helper.getDriver();
        // Never test against somebody else's real room or send fixture traffic.
        await driver.sendDevToolsCommand('Network.enable', {});
        await driver.sendDevToolsCommand('Network.setBlockedURLs', {urls: ['https://*', 'wss://*', 'ws://*']});
        await driver.sendDevToolsCommand('Page.addScriptToEvaluateOnNewDocument', {source: `
            const bytes=Uint8Array.from(atob(${JSON.stringify(fixture)}),c=>c.charCodeAt(0));
            const fixtureURL=URL.createObjectURL(new Blob([bytes],{type:'application/octet-stream'}));
            const isFixture=url=>String(url).startsWith('https://projects.scratch.mit.edu/') ||
                String(url).startsWith('https://fixtures.invalid/');
            const nativeFetch=window.fetch.bind(window);
            window.fetch=(url,options)=>nativeFetch(isFixture(url)?fixtureURL:url,options);
            const open=XMLHttpRequest.prototype.open;
            XMLHttpRequest.prototype.open=function(method,url,...rest){
                return open.call(this,method,isFixture(url)?fixtureURL:url,...rest);
            };
            window.__cloudAttempts=[];
            window.WebSocket=class extends EventTarget {
                static CONNECTING=0; static OPEN=1; static CLOSING=2; static CLOSED=3;
                constructor(url){super();this.url=url;this.readyState=0;this.sent=[];
                    window.__cloudAttempts.push(this);
                    setTimeout(()=>{if(this.readyState===3)return;this.readyState=1;
                        this.onopen?.(new Event('open'));},0);}
                send(value){this.sent.push(value);}
                close(){this.readyState=3;this.onclose?.({code:1000});}
            };
        `});
    });
    afterEach(async () => {
        if (!driver) return;
        try {
            const directory = path.resolve('.tmp/cloud-source-evidence');
            fs.mkdirSync(directory, {recursive: true});
            const name = expect.getState().currentTestName.replace(/[^a-z0-9]+/gi, '-');
            fs.writeFileSync(path.join(directory, `${name}.json`), JSON.stringify({
                state: await driver.executeScript(`const s=window.ReduxStore?.getState().scratchGui;
                    return {id:s?.projectState.projectId,source:s?.projectState.isProjectFromUrl,
                        loading:s?.projectState.loadingState,hasCloud:window.vm?.runtime.hasCloudData(),
                        attempts:window.__cloudAttempts?.length};`),
                logs: await driver.manage().logs().get('browser')
            }, null, 2));
        } finally {
            await driver.quit();
        }
    });
    const loaded = async () => {
        await driver.wait(() => driver.executeScript(`return window.ReduxStore?.getState()
            .scratchGui.projectState.loadingState==='SHOWING_WITH_ID' && window.vm?.runtime.hasCloudData();`), 30000);
        await driver.executeAsyncScript(`const done=arguments[arguments.length-1];
            requestAnimationFrame(()=>requestAnimationFrame(done));`);
    };
    const snapshot = () => driver.executeScript(`const p=window.ReduxStore.getState().scratchGui.projectState;
        return {fromUrl:p.isProjectFromUrl,id:p.projectId,attempts:window.__cloudAttempts.map(s=>({
            url:s.url,messages:s.sent,state:s.readyState}))};`);
    const playerURL = () => {
        const url = new URL('index.html', process.env.STUDIO_BROWSER_URL);
        url.hash = '123456';
        url.searchParams.set('token', 'local-fixture-only');
        return url;
    };

    test.each(['https', 'data'])('%s project_url never connects, even after address removal; real Scratch fetch can connect',
        async scheme => {
            const url = playerURL();
            url.searchParams.set('project_url', scheme === 'data' ?
                `data:application/octet-stream;base64,${fixture}` : 'https://fixtures.invalid/custom.sb3');
            await driver.get(url.href);
            await loaded();
            expect(await snapshot()).toMatchObject({fromUrl: true, id: '123456', attempts: []});
            await driver.executeScript(`const url=new URL(location.href);url.searchParams.delete('project_url');
                history.replaceState(null,'',url);window.vm.emit('HAS_CLOUD_DATA_UPDATE',true);`);
            expect(await snapshot()).toMatchObject({fromUrl: true, attempts: []});
            // Real hash navigation invokes the genuine loader, not a test-only provenance setter.
            await driver.executeScript("location.hash='654321';");
            await driver.wait(() => driver.executeScript(`return window.ReduxStore.getState()
                .scratchGui.projectState.projectId==='654321';`), 5000);
            await loaded();
            await driver.wait(() => driver.executeScript('return window.__cloudAttempts.some(s=>s.sent.length);'), 5000);
            const result = await snapshot();
            expect(result.fromUrl).toBe(false);
            expect(result.attempts).toHaveLength(1);
            expect(JSON.parse(result.attempts[0].messages[0]).project_id).toBe('654321');
        });

    test('switching an active Scratch room to URL content closes it without joining the new numeric ID', async () => {
        await driver.get(playerURL().href);
        await loaded();
        await driver.wait(() => driver.executeScript('return window.__cloudAttempts.some(s=>s.sent.length);'), 5000);
        expect((await snapshot()).attempts).toHaveLength(1);
        await driver.executeScript(`const url=new URL(location.href);
            url.searchParams.set('project_url','https://fixtures.invalid/custom.sb3');
            history.replaceState(null,'',url); location.hash='654321';`);
        await driver.wait(() => driver.executeScript(`return window.ReduxStore.getState()
            .scratchGui.projectState.isProjectFromUrl===true;`), 10000);
        await loaded();
        const result = await snapshot();
        expect(result.attempts).toHaveLength(1);
        expect(result.attempts[0].state).toBe(3);
        expect(result.fromUrl).toBe(true);
        expect(result.id).toBe('654321');
    });
});
