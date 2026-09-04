import EventEmitter from 'events';
import {JSDOM} from 'jsdom';
import {ScriptContext, getScriptContext} from '../../../src/addons/libraries/common/cs/script-context';
import {headerLabel, scriptDescription, pinnedHead} from '../../../src/addons/addons/script-breadcrumb/model';
import {attachBreadcrumb} from '../../../src/addons/addons/script-breadcrumb/userscript';
import {workspaceTopInset} from '../../../src/addons/libraries/common/cs/workspace-insets';

const field = text => ({getText: () => text});
const block = (id, text, parent = null) => ({id, inputList: [{fieldRow: [field(text)]}],
    getParent: () => parent, getRootBlock: () => parent ? parent.getRootBlock() : blockMap[id],
    getInput: name => blockMap[id].inputList.find(input => input.name === name)});
let blockMap;
beforeEach(() => {blockMap = {};});

test('context is per VM/target, serializable, bounded to identities and cleared on project load', () => {
    const vm = {runtime: new EventEmitter()};
    const context = getScriptContext(vm);
    const listener = jest.fn();
    const unsubscribe = context.subscribe(listener);
    context.set('a', {blockId: 'one', rootId: 'root', native: {recursive: 'do not retain'}});
    context.set('b', {blockId: 'two'});
    expect(getScriptContext(vm)).toBe(context);
    expect(context.get('a')).not.toHaveProperty('native');
    expect(context.get('b').blockId).toBe('two');
    expect(getScriptContext({runtime: new EventEmitter()}).get('a')).toBeNull();
    context.set('b', {blockId: 'two'});
    expect(listener).toHaveBeenCalledTimes(2);
    vm.runtime.emit('PROJECT_LOADED');
    expect(context.get('a')).toBeNull();
    unsubscribe();
    context.set('a', {blockId: 'new'});
    expect(listener).toHaveBeenCalledTimes(3);
});

test('headers exclude descendants and tails, preserve arbitrary text, and default to Script', () => {
    const root = block('root', '<untrusted name>');
    root.toString = () => {throw new Error('No recursive formatting');};
    root.inputList.push({type: 3, fieldRow: []}, {fieldRow: [field('else body must not appear')]});
    expect(headerLabel(root)).toBe('<untrusted name>');
    expect(headerLabel(null)).toBe('Script');
});

test('nested then/else scopes follow native body ownership through intervening statements', () => {
    const head = blockMap.head = block('head', 'when clicked');
    const conditional = blockMap.if = block('if', 'if', head);
    const first = blockMap.first = block('first', 'move', conditional);
    const second = blockMap.second = block('second', 'say', first);
    conditional.inputList.push({type: 3, name: 'SUBSTACK', connection: {targetBlock: () => null}},
        {type: 3, name: 'SUBSTACK2', connection: {targetBlock: () => first}});
    const workspace = {getBlockById: id => blockMap[id]};
    expect(scriptDescription(workspace, {blockId: second.id}, {CONTROL_ELSE: 'sonst'})).toMatchObject({
        rootId: 'head', title: 'when clicked', scopes: ['sonst'],
        links: [{blockId: 'head', label: 'when clicked'}, {blockId: 'if', label: 'sonst'}]
    });
    expect(scriptDescription(workspace, {blockId: 'if', kind: 'gap', inputName: 'SUBSTACK2'}).scopes).toEqual(['else']);
    expect(scriptDescription(workspace, {blockId: 'deleted', rootId: 'head'}).rootId).toBe('head');
    expect(scriptDescription(workspace, {blockId: 'deleted'})).toBeNull();
});

test('pin only labels a script whose head is above and tail is still below the viewport', () => {
    const bounds = {left: 50, right: 600, top: 0};
    expect(pinnedHead({x: 100, top: 20, bottom: 500}, bounds)).toBeNull();
    expect(pinnedHead({x: 100, top: -200, bottom: -2}, bounds)).toBeNull();
    expect(pinnedHead({x: 100, top: -20, bottom: 500}, bounds)).toEqual({left: 100, top: 0});
    expect(pinnedHead({x: -50, top: -20, bottom: 500}, bounds).left).toBe(50);
    expect(pinnedHead({x: 800, top: -20, bottom: 500}, bounds).left).toBe(500);
});

test('empty context operations are no-ops', () => {
    const context = new ScriptContext();
    context.set(null, {blockId: 'a'});
    expect(context.locations.size).toBe(0);
});

test('addon rendering is event driven, cheap during panning and detachable', () => {
    const originalDocument = global.document;
    const dom = new JSDOM('');
    global.document = dom.window.document;
    const originalRAF = global.requestAnimationFrame;
    const originalCancel = global.cancelAnimationFrame;
    const originalResize = global.ResizeObserver;
    const originalMutation = global.MutationObserver;
    let pending;
    let pan;
    global.requestAnimationFrame = callback => {pending = callback; return 1;};
    global.cancelAnimationFrame = () => {pending = null;};
    const disconnected = jest.fn();
    global.ResizeObserver = class { observe () {} disconnect () { disconnected(); } };
    global.MutationObserver = class {
        constructor (callback) {pan = callback;}
        observe () {}
        disconnect () {disconnected();}
    };
    const tick = () => {const next = pending; pending = null; if (next) next();};
    const vm = new EventEmitter();
    vm.runtime = new EventEmitter();
    const asset = {encodeDataURI: jest.fn(() => 'data:image/png;base64,example')};
    vm.editingTarget = {id: 'sprite', currentCostume: 0, getName: () => 'Sprite 1', getCostumes: () => [{asset}]};
    const container = document.createElement('div');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    container.appendChild(svg); document.body.appendChild(container);
    svg.getBoundingClientRect = () => ({left: 0, top: 0, width: 800, height: 600});
    let offset = 0;
    svg.createSVGPoint = () => ({x: 0, y: 0, matrixTransform () {return {x: this.x, y: this.y + offset};}});
    const b = blockMap.root = block('root', 'repeat 10');
    b.getHeightWidth = jest.fn(() => ({height: 800, width: 180}));
    b.getRelativeToSurfaceXY = () => ({x: 100, y: 80});
    const workspace = {getBlockById: id => blockMap[id], getParentSvg: () => svg,
        getCanvas: () => svg, getMetrics: () => ({absoluteLeft: 0, flyoutWidth: 0}),
        addChangeListener: jest.fn(), removeChangeListener: jest.fn()};
    const redux = new EventTarget();
    svg.getScreenCTM = () => ({});
    redux.state = {scratchGui: {editorTab: {activeTabIndex: 0}, mode: {isPlayerOnly: false}}};
    const self = new EventTarget();
    const addon = {tab: {traps: {vm}, redux}, self};
    let attachment;
    try {
        getScriptContext(vm).set('sprite', {blockId: 'root', rootId: 'root'});
        attachment = attachBreadcrumb({workspace, Blockly: {}, addon});
        tick();
        const root = container.querySelector('[data-script-breadcrumb]');
        const pin = container.querySelector('[data-script-head-pin]');
        expect(root.textContent).toContain('Sprite 1');
        expect(root.querySelector('[data-script-path] button').dataset.blockId).toBe('root');
        expect(workspaceTopInset(workspace)).toBe(32);
        expect(pin.hidden).toBe(true);
        const revision = root.dataset.contextRevision;
        for (let i = 0; i < 30; i++) {offset = -100 - i; pan(); tick();}
        expect(pin.hidden).toBe(false);
        expect(root.dataset.contextRevision).toBe(revision);
        expect(b.getHeightWidth).toHaveBeenCalledTimes(1);
        expect(asset.encodeDataURI).toHaveBeenCalledTimes(1);
        vm.emit('targetsUpdate'); tick();
        expect(root.dataset.contextRevision).toBe(revision);
        self.disabled = true;
        self.dispatchEvent(new Event('disabled')); tick();
        expect(root.hidden).toBe(true);
        expect(workspaceTopInset(workspace)).toBe(0);
        self.disabled = false;
        self.dispatchEvent(new Event('reenabled')); tick();
        expect(root.hidden).toBe(false);
        expect(workspaceTopInset(workspace)).toBe(32);
        getScriptContext(vm).clear(); tick();
        expect(root.dataset.rootId).toBe('');
        expect(pin.hidden).toBe(true);
        expect(root.querySelector('.sa-script-breadcrumb-sprite').disabled).toBe(true);
        attachment.dispose(); attachment = null;
        expect(container.querySelector('[data-script-breadcrumb]')).toBeNull();
        expect(workspaceTopInset(workspace)).toBe(0);
        expect(vm.listenerCount('workspaceUpdate')).toBe(0);
        expect(vm.listenerCount('targetsUpdate')).toBe(0);
        expect(disconnected).toHaveBeenCalledTimes(2);
        expect(workspace.removeChangeListener).toHaveBeenCalledTimes(1);
    } finally {
        attachment?.dispose(); container.remove();
        global.requestAnimationFrame = originalRAF;
        global.cancelAnimationFrame = originalCancel;
        global.ResizeObserver = originalResize;
        global.MutationObserver = originalMutation;
        global.document = originalDocument;
        dom.window.close();
    }
});
