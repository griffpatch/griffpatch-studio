import {createLayoutTransaction} from '../../../src/addons/libraries/common/cs/layout-transaction';

const fixture = () => {
    let group = '', uid = 0, x = 100, scroll = 0;
    const listeners = new Set(), pending = [], barriers = [];
    const root = {id: 'root', getRootBlock: () => root,
        getSvgRoot: () => ({getScreenCTM: () => ({e: x-scroll, f: 50})})};
    const ws = {undoStack_: [], redoStack_: [], getBlockById: () => root, resizeContents: jest.fn(),
        getMetrics: () => ({viewLeft: scroll, viewTop: 0, contentLeft: 0, contentTop: 0}),
        scrollbar: {set: jest.fn(value => {scroll = value;})},
        addChangeListener: fn => listeners.add(fn), removeChangeListener: fn => listeners.delete(fn),
        undo(redo) {
            const source = redo ? this.redoStack_ : this.undoStack_, target = redo ? this.undoStack_ : this.redoStack_;
            const last = source[source.length-1];
            if (!last) return;
            do { const event = source.pop(); x += redo ? event.dx : -event.dx; target.push(event); }
            while (last.group && source.length && source[source.length-1].group === last.group);
        }};
    const Blockly = {Events: {getGroup: () => group, setGroup: value => {group = value === true ? `group${++uid}` : value;},
        afterPendingEvents: fn => barriers.push(fn)}};
    const move = dx => {x += dx; pending.push({recordUndo: true, group, dx});};
    const flush = () => {
        for (const event of pending.splice(0)) {ws.undoStack_.push(event); listeners.forEach(fn => fn(event));}
        barriers.splice(0).forEach(fn => fn());
    };
    return {ws, Blockly, root, move, flush, listeners, screen: () => x-scroll};
};

test('apply, undo and redo anchor marked native groups; ordinary moves do not', () => {
    const f = fixture(), tx = createLayoutTransaction(f.ws, f.Blockly, () => f.root);
    tx.run(() => {f.move(60); f.move(20);}); tx.finish(); f.flush();
    expect(f.screen()).toBe(100);
    f.ws.undo(false); expect(f.screen()).toBe(100);
    f.ws.undo(true); expect(f.screen()).toBe(100);
    f.move(30); f.flush();
    const calls = f.ws.scrollbar.set.mock.calls.length;
    f.ws.undo(false);
    expect(f.screen()).toBe(100);
    expect(f.ws.scrollbar.set).toHaveBeenCalledTimes(calls);
    expect(f.listeners.size).toBe(0);
});

test('delayed transaction parts do not consume an interleaved user edit or its group', () => {
    const f = fixture(), tx = createLayoutTransaction(f.ws, f.Blockly, () => f.root);
    tx.run(() => f.move(60)); f.flush();
    f.move(15); f.flush();
    tx.run(() => {}); tx.finish(); f.flush();
    const calls = f.ws.scrollbar.set.mock.calls.length;
    f.ws.undo(false);
    expect(f.ws.scrollbar.set).toHaveBeenCalledTimes(calls);
    f.ws.undo(false);
    expect(f.ws.scrollbar.set).toHaveBeenCalledTimes(calls+1);
});

test('enclosing groups and exceptions restore state; empty/cleared histories are safe', () => {
    const f = fixture(); f.Blockly.Events.setGroup('enclosing');
    const tx = createLayoutTransaction(f.ws, f.Blockly, () => f.root);
    expect(f.Blockly.Events.getGroup()).toBe('enclosing');
    expect(() => tx.run(() => {f.move(40); throw new Error('failed');})).toThrow('failed');
    expect(f.Blockly.Events.getGroup()).toBe('enclosing');
    tx.finish(); tx.finish(); f.flush();
    expect(f.screen()).toBe(100);
    f.ws.undoStack_.length = 0;
    expect(() => f.ws.undo(false)).not.toThrow();
    expect(() => tx.run(() => {})).toThrow('finished');
});

test('the active anchor is resolved anew at undo, not fixed to the original selection', () => {
    const f = fixture(); let selected = f.root;
    const tx = createLayoutTransaction(f.ws, f.Blockly, () => selected);
    tx.run(() => f.move(60)); tx.finish(); f.flush();
    selected = null;
    const calls = f.ws.scrollbar.set.mock.calls.length;
    f.ws.undo(false);
    expect(f.ws.scrollbar.set).toHaveBeenCalledTimes(calls);
});
