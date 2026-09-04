import {f2Target} from '../../../src/experiments/keyboard-authoring/f2-target';

const field = (name, variable = null, editable = true) => ({
    name,
    EDITABLE: editable,
    isCurrentlyEditable: () => editable,
    getVariable: variable ? () => variable : undefined
});
const block = (id, type, fields = [], inputs = []) => ({
    id,
    type,
    inputList: [{fieldRow: fields}, ...inputs],
    isShadow: () => false
});
const input = (name, child) => ({name, fieldRow: [], connection: {targetBlock: () => child}});
const workspace = blocks => ({getBlockById: id => blocks.find(candidate => candidate.id === id)});
const ScratchBlocks = {
    BROADCAST_MESSAGE_VARIABLE_TYPE: 'broadcast_msg',
    PROCEDURES_CALL_BLOCK_TYPE: 'procedures_call',
    PROCEDURES_DEFINITION_BLOCK_TYPE: 'procedures_definition',
    PROCEDURES_PROTOTYPE_BLOCK_TYPE: 'procedures_prototype'
};

test('F2 keeps ordinary text fields in their native editor', () => {
    const text = field('TEXT');
    const owner = block('text', 'text', [text]);
    expect(f2Target(workspace([owner]), ScratchBlocks,
        {kind: 'field', blockId: 'text', fieldName: 'TEXT'})).toEqual({kind: 'field', block: owner, field: text});
});

test.each(['', 'list'])('F2 resolves a %s variable field or reporter by native identity', type => {
    const variable = {name: 'score', type, getId: () => 'variable-id'};
    const variableField = field('VARIABLE', variable, false);
    const reporter = block('reporter', 'data_variable', [variableField]);
    expect(f2Target(workspace([reporter]), ScratchBlocks,
        {kind: 'block', blockId: 'reporter'})).toMatchObject({kind: 'variable', variable, field: variableField});
});

test('F2 resolves the directly owned broadcast menu shadow but not arbitrary nested variables', () => {
    const broadcast = {name: 'party', type: 'broadcast_msg', getId: () => 'broadcast-id'};
    const menuField = field('BROADCAST_OPTION', broadcast);
    const menu = block('menu', 'event_broadcast_menu', [menuField]);
    menu.isShadow = () => true;
    const send = block('send', 'event_broadcast', [], [input('BROADCAST_INPUT', menu)]);
    const target = f2Target(workspace([send, menu]), ScratchBlocks, {kind: 'block', blockId: 'send'});
    expect(target).toMatchObject({kind: 'variable', variable: broadcast, field: menuField});
    const scalar = {name: 'score', type: '', getId: () => 'score-id'};
    const nestedField = field('VARIABLE', scalar, false);
    const nested = block('nested', 'data_variable', [nestedField]);
    nested.isShadow = () => false;
    const say = block('say', 'looks_say', [], [input('MESSAGE', nested)]);
    expect(f2Target(workspace([say, nested]), ScratchBlocks, {kind: 'block', blockId: 'say'})).toBeNull();
});

test.each(['procedures_call', 'procedures_definition', 'procedures_prototype'])(
    'F2 opens the native custom-block editor for %s', type => {
        const custom = block('custom', type);
        expect(f2Target(workspace([custom]), ScratchBlocks,
            {kind: 'block', blockId: 'custom'})).toEqual({kind: 'procedure', block: custom});
    });
