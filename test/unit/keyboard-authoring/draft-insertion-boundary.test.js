import {JSDOM} from 'jsdom';
import {captureDraftInsertionBoundary} from '../../../src/experiments/keyboard-authoring/draft-insertion-boundary';

const dom = new JSDOM('');
afterAll(() => dom.window.close());
const xml = text => new dom.window.DOMParser().parseFromString(text, 'text/xml').documentElement;

const fixture = () => {
    const calls = [];
    const child = {
        id: 'tail', isShadow: () => false,
        previousConnection: {
            isConnected: () => true, disconnect: () => calls.push('detach tail')
        }
    };
    const connection = {
        targetBlock: () => child, getShadowDom: () => null,
        setShadowDom: value => calls.push(value ? 'restore default' : 'suspend default'),
        connect: jest.fn(() => calls.push('reconnect'))
    };
    const root = {
        id: 'receiver', nextConnection: connection, getRelativeToSurfaceXY: () => ({x: 12.5, y: 24.75}),
        moveBy: jest.fn()
    };
    root.getRootBlock = () => root;
    const workspace = {
        options: {readOnly: true}, getBlockById: id => ({receiver: root, tail: child}[id])
    };
    const actor = {dispose: jest.fn(() => calls.push('dispose draft'))};
    const position = {kind: 'gap', blockId: root.id};
    return {workspace, root, child, connection, actor, position, calls};
};

test('refuses to restore a draft in an authoritative editing workspace', () => {
    expect(() => captureDraftInsertionBoundary({workspace: {options: {readOnly: false}}}))
        .toThrow('isolated read-only workspace');
});

test('detaches the retained continuation before disposing only the draft', () => {
    const f = fixture();
    const restore = captureDraftInsertionBoundary(f);
    restore(f.actor);
    expect(f.calls).toEqual(['suspend default', 'detach tail', 'dispose draft', 'reconnect', 'suspend default']);
    expect(f.actor.dispose).toHaveBeenCalledWith(false);
    expect(f.connection.connect).toHaveBeenCalledWith(f.child.previousConnection);
    expect(f.root.moveBy).not.toHaveBeenCalled();
});

test('restores fractional root coordinates only when insertion moved the receiver', () => {
    const f = fixture();
    const restore = captureDraftInsertionBoundary(f);
    f.root.getRelativeToSurfaceXY = () => ({x: 15, y: 45});
    restore(f.actor);
    expect(f.root.moveBy).toHaveBeenCalledWith(-2.5, -20.25);
});

test('fails closed if the supposedly retained continuation was replaced', () => {
    const f = fixture();
    const restore = captureDraftInsertionBoundary(f);
    f.workspace.getBlockById = id => (id === f.root.id ? f.root : {...f.child});
    expect(() => restore(f.actor)).toThrow('retained draft tail was replaced');
    expect(f.actor.dispose).not.toHaveBeenCalled();
});

test('restores the current shadow value and identity separately from its stored default', () => {
    const f = fixture();
    f.child.isShadow = () => true;
    const current = xml('<shadow id="current" type="math_number"><field name="NUM">13</field></shadow>');
    const defaultValue = xml('<shadow type="math_number"><field name="NUM">10</field></shadow>');
    f.connection.getShadowDom = () => defaultValue;
    f.connection.setShadowDom = jest.fn();
    const restored = {outputConnection: {}};
    const ScratchBlocks = {Xml: {
        blockToDom: jest.fn(() => current), domToBlock: jest.fn(() => restored)
    }};
    captureDraftInsertionBoundary({...f, ScratchBlocks})(f.actor);
    const [createdXml, target] = ScratchBlocks.Xml.domToBlock.mock.calls[0];
    expect(target).toBe(f.workspace);
    expect(createdXml).not.toBe(current);
    expect(createdXml.outerHTML).toBe(current.outerHTML);
    expect(f.connection.connect).toHaveBeenCalledWith(restored.outputConnection);
    const lastDefault = f.connection.setShadowDom.mock.calls[1][0];
    expect(lastDefault).not.toBe(defaultValue);
    expect(lastDefault.outerHTML).toBe(defaultValue.outerHTML);
    expect(f.calls).toEqual(['dispose draft', 'reconnect']);
});

test('restores a top-level insertion without assuming a superior connection exists', () => {
    const f = fixture();
    f.root.isShadow = () => false;
    f.root.previousConnection = {...f.child.previousConnection, targetConnection: null};
    const restore = captureDraftInsertionBoundary({...f, position: {kind: 'before', blockId: f.root.id}});
    restore(f.actor);
    expect(f.calls).toEqual(['detach tail', 'dispose draft']);
    expect(f.root.moveBy).not.toHaveBeenCalled();
});
