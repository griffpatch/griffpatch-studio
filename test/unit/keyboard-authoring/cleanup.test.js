import {cleanUpAtScript, isCleanUpShortcut} from '../../../src/experiments/keyboard-authoring/cleanup';
import DevTools from '../../../src/addons/addons/editor-devtools/DevTools';
import {captureScriptViewportAnchor} from '../../../src/addons/libraries/common/cs/script-viewport-anchor';

test('cleanup compensates screen displacement against the new scroll bounds', () => {
    let matrix = {e: 250, f: 200};
    const root = {getSvgRoot: () => ({getScreenCTM: () => matrix})};
    const workspace = {getBlockById: () => root,
        resizeContents: jest.fn(), getMetrics: () => ({viewLeft: 40, viewTop: 60, contentLeft: -500, contentTop: -400}),
        scrollbar: {set: jest.fn()}};
    const restore = captureScriptViewportAnchor(workspace, {getRootBlock: () => root});
    matrix = {e: 90, f: 110};
    restore();
    expect(workspace.scrollbar.set).toHaveBeenCalledWith(380, 370);
    expect(cleanUpAtScript(workspace, null)).toBe(false);
    workspace.cleanUpPlusLayout = () => false;
    expect(cleanUpAtScript(workspace, {getRootBlock: () => root})).toBe(false);
    expect(workspace.scrollbar.set).toHaveBeenCalledTimes(1);
});

test('shortcut is unambiguous and rejects Control/Command variants', () => {
    expect(isCleanUpShortcut({key: 'C', altKey: true, shiftKey: true})).toBe(true);
    expect(isCleanUpShortcut({key: 'c', altKey: true})).toBeFalsy();
    expect(isCleanUpShortcut({key: 'c', altKey: true, shiftKey: true, ctrlKey: true})).toBe(false);
    expect(isCleanUpShortcut({key: 'c', altKey: true, shiftKey: true, metaKey: true})).toBe(false);
    expect(isCleanUpShortcut({key: 'f', altKey: true, shiftKey: true})).toBe(false);
});

test('layout-only Clean-up+ includes orphan reporters but never prunes or prompts', () => {
    jest.useFakeTimers();
    try {
        const makeBlock = id => ({id, getRelativeToSurfaceXY: () => ({x: 300,y: 500}),
            getHeightWidth: () => ({width: 100,height: 40}), moveBy: jest.fn(), dispose: jest.fn()});
        const script = makeBlock('script'), orphan = makeBlock('reporter');
        const workspace = {undoStack_: [], getBlockById: () => null, getTopComments: () => [], getVariableMap: jest.fn(),
            addChangeListener: jest.fn(), removeChangeListener: jest.fn(), undo: jest.fn()};
        const tools = Object.create(DevTools.prototype);
        let group = '';
        tools.blockly = {Events: {getGroup: () => group, setGroup: value => {group = value === true ? 'layout' : value;},
            afterPendingEvents: callback => setTimeout(callback, 0)}};
        tools.getWorkspace = () => workspace;
        tools.getOrderedTopBlockColumns = () => ({cols: [{blocks: [script]}],
            orphans: {blocks: [orphan]}, maxWidths: {}});
        tools.msg = () => {throw new Error('No deletion prompt expected');};
        tools.doCleanUp(null, {layoutOnly: true});
        jest.runAllTimers();
        expect(script.moveBy).toHaveBeenCalled();
        expect(orphan.moveBy).toHaveBeenCalled();
        expect(orphan.dispose).not.toHaveBeenCalled();
        expect(workspace.getVariableMap).not.toHaveBeenCalled();
    } finally {jest.useRealTimers();}
});
