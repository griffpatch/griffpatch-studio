import {JSDOM} from 'jsdom';
import DevTools from '../../../src/addons/addons/editor-devtools/DevTools';

const dom = new JSDOM('', {url: 'http://localhost/editor.html'});
const originalEvent = global.CustomEvent;
beforeAll(() => { global.CustomEvent = dom.window.CustomEvent; });
afterAll(() => { global.CustomEvent = originalEvent; dom.window.close(); });

const fixture = (enabled = true) => {
    const canvas = dom.window.document.createElement('div');
    const block = {id: 'new', svgPath_: {}, setIntersects: jest.fn()};
    const workspace = {getCanvas: () => canvas, getTopBlocks: () => [block]};
    const tools = Object.create(DevTools.prototype);
    tools.addon = {settings: {get: () => enabled}};
    tools.getWorkspace = () => workspace;
    tools.mouseXY = {x: 500, y: 600};
    tools.domHelpers = {triggerDragAndDrop: jest.fn()};
    return {tools, canvas, block};
};

test('the deferred drag consults its current owner, not key listener order', () => {
    jest.useFakeTimers();
    try {
        const {tools, canvas, block} = fixture();
        const ids = new Set();
        // The addon observed Ctrl+V first and scheduled pickup. A keyboard
        // consumer owns placement by the time the native paste has completed.
        setTimeout(() => tools.beginDragOfNewBlocksNotInIDs(ids), 10);
        canvas.addEventListener('scratch-addons-before-paste-drag', event => event.preventDefault());
        jest.runAllTimers();
        expect(block.setIntersects).not.toHaveBeenCalled();
        expect(tools.domHelpers.triggerDragAndDrop).not.toHaveBeenCalled();
    } finally { jest.useRealTimers(); }
});

test('unclaimed paste and a removed owner preserve the original mouse drag', () => {
    const {tools, canvas, block} = fixture();
    const claim = event => event.preventDefault();
    canvas.addEventListener('scratch-addons-before-paste-drag', claim);
    tools.beginDragOfNewBlocksNotInIDs(new Set());
    canvas.removeEventListener('scratch-addons-before-paste-drag', claim);
    tools.beginDragOfNewBlocksNotInIDs(new Set());
    expect(block.setIntersects).toHaveBeenCalledTimes(1);
    expect(tools.domHelpers.triggerDragAndDrop).toHaveBeenCalledWith(block.svgPath_, null, {x: 500, y: 600});
});

test.each([false, true])('disabled paste-at-mouse or no new stack does not request placement (%s)', enabled => {
    const {tools, canvas} = fixture(enabled);
    const listener = jest.fn();
    canvas.addEventListener('scratch-addons-before-paste-drag', listener);
    tools.beginDragOfNewBlocksNotInIDs(new Set(enabled ? ['new'] : []));
    expect(listener).not.toHaveBeenCalled();
    expect(tools.domHelpers.triggerDragAndDrop).not.toHaveBeenCalled();
});
