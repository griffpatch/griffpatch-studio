import {JSDOM} from 'jsdom';
import refreshProcedurePalette from '../../../src/experiments/keyboard-authoring/procedure-palette';

const {DOMParser} = new JSDOM('').window;
const xml = source => new DOMParser().parseFromString(source, 'text/xml').documentElement;
const fixture = () => ({refreshToolboxSelection_: jest.fn(), getBlockById: jest.fn()});

test.each(['create', 'delete'])('refreshes definitions and prototypes on native %s, including history events', type => {
    const workspace = fixture();
    for (const text of [
        '<block type="procedures_definition"><shadow type="procedures_prototype"/></block>',
        '<xml><block type="procedures_definition"/></xml>',
        '<shadow type="procedures_prototype"/>'
    ]) {
        for (const recordUndo of [true, false]) {
            expect(refreshProcedurePalette(workspace, {
                type, recordUndo, [type === 'create' ? 'xml' : 'oldXml']: xml(text)
            })).toBe(true);
        }
    }
    expect(workspace.refreshToolboxSelection_).toHaveBeenCalledTimes(6);
    expect(workspace.getBlockById).not.toHaveBeenCalled();
});

test('refreshes a changed prototype mutation, including rename, arguments and warp', () => {
    const workspace = fixture();
    workspace.getBlockById.mockReturnValue({type: 'procedures_prototype'});
    expect(refreshProcedurePalette(workspace, {type: 'change', element: 'mutation', blockId: 'prototype'})).toBe(true);
    expect(workspace.getBlockById).toHaveBeenCalledWith('prototype');
    expect(workspace.refreshToolboxSelection_).toHaveBeenCalledTimes(1);
});

test('ignores ordinary edits, calls, missing blocks and non-block events', () => {
    const workspace = fixture();
    workspace.getBlockById.mockReturnValue({type: 'procedures_call'});
    for (const event of [
        {type: 'ui'}, {type: 'move'}, {type: 'var_create'},
        {type: 'change', element: 'field'},
        {type: 'change', element: 'mutation', blockId: 'call'},
        {type: 'create', xml: xml('<block type="procedures_call"/>')},
        {type: 'delete', oldXml: xml('<block type="control_repeat"><block type="procedures_call"/></block>')},
        {type: 'create'}, {type: 'delete'}
    ]) expect(refreshProcedurePalette(workspace, event)).toBe(false);
    workspace.getBlockById.mockReturnValue(null);
    expect(refreshProcedurePalette(workspace, {type: 'change', element: 'mutation', blockId: 'missing'})).toBe(false);
    expect(workspace.refreshToolboxSelection_).not.toHaveBeenCalled();
});
