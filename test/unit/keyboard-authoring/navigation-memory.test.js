import EventEmitter from 'events';
import {captureCaret, resolveCaret, getCaretMemory} from '../../../src/experiments/keyboard-authoring/navigation-memory';

const fixture = () => {
    const blocks = new Map();
    const make = (id, options = {}) => {
        const block = {id, inputList: [], next: null, parent: null,
            previousConnection: {}, nextConnection: {type: 3},
            getRelativeToSurfaceXY: () => ({x: 120, y: 300}),
            getParent: () => block.parent, getNextBlock: () => block.next,
            getInput: name => block.inputList.find(input => input.name === name),
            getField: name => block.inputList.flatMap(input => input.fieldRow).find(field => field.name === name),
            isShadow: () => false, ...options};
        blocks.set(id, block);
        return block;
    };
    const connect = (owner, name, child, type = 1) => {
        const slot = {name, fieldRow: [], child, connection: {type, targetBlock: () => slot.child}};
        owner.inputList.push(slot);
        if (child) child.parent = owner;
        return slot;
    };
    return {make, connect, blocks, workspace: {getBlockById: id => blocks.get(id)}};
};

describe('serializable per-sprite structural locations', () => {
    test('remembers a free caret text baseline without retaining any rendered objects', () => {
        const {workspace} = fixture();
        const position = {kind: 'workspace', x: 400, y: 120, baselineY: 146};
        const saved = captureCaret(workspace, position);
        expect(resolveCaret(workspace, saved)).toEqual(position);
        expect(resolveCaret(workspace, JSON.parse(JSON.stringify(saved)))).toEqual(position);
    });
    test('native shadow replacement returns to the owning input, not the disposed shadow ID', () => {
        const {workspace, make, connect, blocks} = fixture();
        const move = make('move');
        const shadow = make('shadow', {isShadow: () => true});
        shadow.inputList = [{fieldRow: [{name: 'NUM', EDITABLE: true, isCurrentlyEditable: () => true}]}];
        const slot = connect(move, 'STEPS', shadow);
        const saved = captureCaret(workspace, {kind: 'field', blockId: 'shadow', fieldName: 'NUM'});
        blocks.delete('shadow'); slot.child = make('new-shadow', {isShadow: () => true});
        expect(resolveCaret(workspace, saved)).toEqual({kind: 'input', blockId: 'move', inputName: 'STEPS'});
        expect(JSON.stringify(saved)).not.toContain('shadow');
    });

    test('a deleted reporter returns to its surviving input hole', () => {
        const {workspace, make, connect, blocks} = fixture();
        const move = make('move'); const reporter = make('reporter');
        const slot = connect(move, 'STEPS', reporter);
        const saved = captureCaret(workspace, {kind: 'block', blockId: 'reporter'});
        blocks.delete('reporter'); slot.child = null;
        expect(resolveCaret(workspace, saved)).toEqual({kind: 'input', blockId: 'move', inputName: 'STEPS'});
    });

    test('a newly occupied saved hole selects its new real reporter', () => {
        const {workspace, make, connect} = fixture();
        const move = make('move'); const slot = connect(move, 'STEPS', null);
        const saved = captureCaret(workspace, {kind: 'input', blockId: 'move', inputName: 'STEPS'});
        slot.child = make('replacement');
        expect(resolveCaret(workspace, saved)).toEqual({kind: 'block', blockId: 'replacement'});
    });

    test('a deleted C-mouth command returns to that specific branch', () => {
        const {workspace, make, connect, blocks} = fixture();
        const owner = make('if-else'); const child = make('else-child');
        const slot = connect(owner, 'SUBSTACK2', child, 3);
        const saved = captureCaret(workspace, {kind: 'block', blockId: child.id});
        blocks.delete(child.id); slot.child = null;
        expect(resolveCaret(workspace, saved)).toEqual({kind: 'gap', blockId: owner.id, inputName: 'SUBSTACK2'});
    });

    test('a removed field returns to its owner while a replaced shape rejects an impossible top connector', () => {
        const {workspace, make} = fixture();
        const owner = make('owner');
        const saved = captureCaret(workspace, {kind: 'field', blockId: owner.id, fieldName: 'MISSING'});
        expect(resolveCaret(workspace, saved)).toEqual({kind: 'block', blockId: owner.id});
        const above = captureCaret(workspace, {kind: 'before', blockId: owner.id});
        owner.previousConnection = null;
        expect(resolveCaret(workspace, above)).toEqual({kind: 'block', blockId: owner.id});
    });

    test('a removed whole script returns to its saved workspace location without choosing an unrelated block', () => {
        const {workspace, make, blocks} = fixture();
        make('gone'); make('unrelated');
        const saved = captureCaret(workspace, {kind: 'block', blockId: 'gone'});
        blocks.delete('gone');
        expect(resolveCaret(workspace, saved)).toEqual({kind: 'workspace', x: 120, y: 300});
        expect(captureCaret(workspace, {kind: 'block', blockId: 'gone'})).toBeNull();
    });

    test('free carets and range endpoints serialize without cached geometry or live objects', () => {
        const {workspace, make} = fixture();
        make('a'); make('b');
        const saved = captureCaret(workspace, {kind: 'block', blockId: 'a', bounds: {live: workspace}},
            {anchorBlockId: 'a', focusBlockId: 'b', blockIds: ['a', 'b']});
        expect(JSON.parse(JSON.stringify(saved)).range).toEqual({anchorBlockId: 'a', focusBlockId: 'b'});
        expect(saved.position.bounds).toBeUndefined();
        const free = captureCaret(workspace, {kind: 'workspace', x: -15, y: 990, sourcePosition: saved.position});
        expect(resolveCaret(workspace, free)).toEqual({kind: 'workspace', x: -15, y: 990});
        expect(captureCaret(workspace, {kind: 'workspace', x: NaN, y: 5})).toBeNull();
    });

    test('mode defaults off; per-editor memory survives remounts, but not File New or another VM', () => {
        const vm = {runtime: new EventEmitter()};
        const memory = getCaretMemory(vm);
        expect(memory.enabled).toBe(false);
        memory.enabled = true;
        memory.locations.set('sprite-a', {position: {kind: 'workspace', x: 1, y: 2}});
        expect(getCaretMemory(vm)).toBe(memory);
        expect(getCaretMemory({runtime: new EventEmitter()})).not.toBe(memory);
        vm.runtime.emit('PROJECT_LOADED');
        expect(memory.enabled).toBe(false);
        expect(memory.locations.size).toBe(0);
    });
});
