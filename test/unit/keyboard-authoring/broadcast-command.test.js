import {BlockInputEnum, BlockInputString, BlockInstance, BlockShape} from
    '../../../src/addons/addons/middle-click-popup/BlockTypeInfo';
import {createBroadcastCommandParser, bindBroadcastCommand} from
    '../../../src/experiments/keyboard-authoring/broadcast-command';

class FieldVariable {
    constructor (type = 'broadcast_msg', bound = true) {
        this.variableType = type;
        this.defaultType_ = type;
        this.bound = bound;
    }
    getVariable () { return this.bound ? {type: this.variableType} : null; }
}

const fixture = (prefix = 'broadcast', suffix = '', shape = BlockShape.Stack, isRound = false) => {
    const message = new BlockInputEnum([['message1', 'old-id']], 0, 0, isRound);
    const trailing = suffix ? new BlockInputString(1, -1, '0') : null;
    const inputs = trailing ? [message, trailing] : [message];
    const parts = trailing ? [prefix, message, suffix, trailing] : [prefix, message];
    const type = {id: 'event_broadcast', shape, inputs, parts,
        workspaceForm: {type: 'event_broadcast', inputList: [{fieldRow: [new FieldVariable()]}]},
        createBlock (...values) { return new BlockInstance(this, ...values); }};
    return {parse: createBroadcastCommandParser([type], {
        BROADCAST_MESSAGE_VARIABLE_TYPE: 'broadcast_msg',
        FieldVariable
    }), type, message};
};

test.each([
    ['broadcast party time', 'party time'],
    ['broadcast "party and wait"', 'party and wait']
])('native grammar proposes a new broadcast identity in %s', (query, name) => {
    const f = fixture();
    const choice = f.parse(query)[0];
    expect(choice.broadcastName).toBe(name);
    expect(choice.broadcastInput).toBe(0);
    expect(choice.instance.typeInfo).toBe(f.type);
    expect(choice.instance.inputs[0]).toBe(f.message.defaultValue);
});

test('uses localized labels and supports broadcast hats as native roots', () => {
    const hat = fixture('quand je reçois', '', BlockShape.Hat);
    expect(hat.parse('quand je reçois fête')[0].broadcastName).toBe('fête');
    expect(hat.parse('when I receive fête')).toEqual([]);
});

test('accepts the native round broadcast-menu shadow used by stack commands', () => {
    const roundMenu = fixture('broadcast', '', BlockShape.Stack, true);
    expect(roundMenu.parse('broadcast party time')[0].broadcastName).toBe('party time');
});

test('uses the native field type before a private broadcast template binds a model', () => {
    const f = fixture();
    f.type.workspaceForm.inputList[0].fieldRow[0] = new FieldVariable('broadcast_msg', false);
    const parse = createBroadcastCommandParser([f.type], {
        BROADCAST_MESSAGE_VARIABLE_TYPE: 'broadcast_msg',
        FieldVariable
    });
    expect(parse('broadcast party time')[0].broadcastName).toBe('party time');
});

test('does not reinterpret scalar variables or loose text without an explicit command prefix', () => {
    expect(fixture().parse('party time')).toEqual([]);
    const wrong = fixture();
    wrong.type.workspaceForm.inputList[0].fieldRow[0] = new FieldVariable('');
    expect(createBroadcastCommandParser([wrong.type], {
        BROADCAST_MESSAGE_VARIABLE_TYPE: 'broadcast_msg',
        FieldVariable
    })('broadcast party time')).toEqual([]);
});

test('binds the proposed command to one native broadcast identity', () => {
    const f = fixture();
    const choice = f.parse('broadcast party time')[0];
    const instance = bindBroadcastCommand(choice, {name: 'party time', getId: () => 'broadcast-id'});
    expect(instance.typeInfo).toBe(f.type);
    expect(instance.inputs[0]).toEqual({value: 'broadcast-id', string: 'party time'});
    expect(choice.instance.inputs[0]).toBe(f.message.defaultValue);
});
