import {JSDOM} from 'jsdom';
import {ScriptContext} from '../../../src/addons/libraries/common/cs/script-context';
import {attachScriptInteraction} from '../../../src/addons/addons/script-breadcrumb/interaction';

let dom, context, workspace, Blockly, blocks, canvas, change, drag, dispose, available;
beforeEach(() => {
    dom = new JSDOM('<svg><g id="canvas"></g></svg>');
    canvas = dom.window.document.querySelector('g');
    blocks = {};
    for (const id of ['head', 'then', 'else', 'other', 'shadow']) {
        const node = dom.window.document.createElementNS('http://www.w3.org/2000/svg', 'g');
        node.classList.add('blocklyDraggable'); node.setAttribute('data-id', id); canvas.append(node);
        blocks[id] = {id, getSvgRoot: () => node, getRootBlock: () => blocks.head,
            isShadow: () => id === 'shadow', getParent: () => blocks.else};
    }
    blocks.other.getRootBlock = () => blocks.other;
    context = new ScriptContext(); Blockly = {}; available = true;
    workspace = {id: 'ws', getCanvas: () => canvas, getBlockById: id => blocks[id],
        addChangeListener: listener => {change = listener;}, removeChangeListener: jest.fn(),
        addBlockDragListener: listener => {drag = listener;}, removeBlockDragListener: jest.fn()};
    dispose = attachScriptInteraction({workspace, Blockly, context, targetId: () => 'sprite',
        isAvailable: () => available, refresh: jest.fn()});
});
afterEach(() => {dispose(); dom.window.close();});
const click = id => blocks[id].getSvgRoot().dispatchEvent(new dom.window.MouseEvent('mousedown', {bubbles: true}));

test('mouse field clicks track branches even when native selection has not changed', () => {
    click('then'); expect(context.get('sprite').blockId).toBe('then');
    click('shadow'); expect(context.get('sprite').blockId).toBe('else');
    click('then'); expect(context.get('sprite').blockId).toBe('then');
});
test('layout moves, create and change events cannot steal the current script', () => {
    click('then');
    for (const type of ['move', 'create', 'change']) change({type, blockId: 'other', recordUndo: true});
    expect(context.get('sprite').blockId).toBe('then');
    drag({workspaceId: 'ws', phase: 'start', blockId: 'other'});
    expect(context.get('sprite').blockId).toBe('other');
    click('else');
    drag({workspaceId: 'ws', phase: 'settled', blockId: 'other'});
    expect(context.get('sprite').blockId).toBe('else');
});
test('precise keyboard context survives delayed selection and native editing events', () => {
    context.caretActive = true;
    context.set('sprite', {kind: 'gap', blockId: 'head', inputName: 'SUBSTACK2', rootId: 'head'});
    Blockly.selected = blocks.then;
    click('then');
    change({type: 'ui', element: 'selected', newValue: 'then'});
    drag({workspaceId: 'ws', phase: 'start', blockId: 'other'});
    expect(context.get('sprite').inputName).toBe('SUBSTACK2');
    context.caretActive = false;
    click('then'); expect(context.get('sprite').blockId).toBe('then');
});
test('stale selections and inactive targets are ignored and listeners detach', () => {
    click('then');
    Blockly.selected = blocks.then;
    change({type: 'ui', element: 'selected', newValue: 'other'});
    available = false; click('else');
    expect(context.get('sprite').blockId).toBe('then');
    available = true; dispose(); click('else');
    expect(context.get('sprite').blockId).toBe('then');
    expect(workspace.removeChangeListener).toHaveBeenCalledWith(change);
    expect(workspace.removeBlockDragListener).toHaveBeenCalledWith(drag);
});
