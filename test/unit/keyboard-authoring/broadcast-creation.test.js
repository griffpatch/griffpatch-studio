import {broadcastFieldAt, canCreateBroadcast, createBroadcastCompletion, isBroadcastCreation} from
    '../../../src/experiments/keyboard-authoring/broadcast-creation';

const model = (name, id = name) => ({name, type: 'broadcast_msg', getId: () => id});

const fixture = () => {
    const messages = [model('message1', 'one'), model('party', 'party')];
    let current = messages[0];
    const field = {
        EDITABLE: true,
        name: 'BROADCAST_OPTION',
        isCurrentlyEditable: () => true,
        getVariable: () => current,
        getValue: () => current.getId(),
        setValue: jest.fn(id => { current = messages.find(item => item.getId() === id); })
    };
    class FieldVariable {}
    Object.setPrototypeOf(field, FieldVariable.prototype);
    const child = {isShadow: () => true, inputList: [{fieldRow: [field]}]};
    const connection = {targetBlock: () => child};
    const block = {getInput: () => ({connection})};
    const workspace = {
        getBlockById: jest.fn(() => block),
        getVariablesOfType: jest.fn(() => messages),
        getVariable: jest.fn(name => messages.find(item => item.name === name) || null),
        getVariableById: jest.fn(id => messages.find(item => item.getId() === id)),
        createVariable: jest.fn((name, type, id) => {
            const created = model(name, id || `new:${name}`);
            messages.push(created);
            return created;
        }),
        deleteVariableById: jest.fn()
    };
    const ScratchBlocks = {
        BROADCAST_MESSAGE_VARIABLE_TYPE: 'broadcast_msg',
        FieldVariable,
        Events: {getGroup: () => '', setGroup: jest.fn()}
    };
    const vm = {editingTarget: {id: 'sprite'}};
    return {messages, field, workspace, ScratchBlocks, vm,
        completion: createBroadcastCompletion({workspace, ScratchBlocks, vm})};
};

const position = {kind: 'input', blockId: 'send', inputName: 'BROADCAST_INPUT'};

test('a native broadcast field offers matching identities and an explicit unselected creation', () => {
    const f = fixture();
    expect(broadcastFieldAt(f.workspace, position, f.ScratchBlocks).field).toBe(f.field);
    expect(f.completion.choices(position, 'part').map(choice => [choice.kind, choice.text]))
        .toEqual([['broadcast', 'party'], ['create-broadcast', 'part']]);
    expect(isBroadcastCreation(f.completion.choices(position, 'part')[1])).toBe(true);
    expect(canCreateBroadcast(f.workspace, f.ScratchBlocks, 'party')).toBe(false);
});

test('acceptance changes the selected native identity, with creation in the same event group', () => {
    const f = fixture();
    f.completion.apply(position, {kind: 'broadcast', text: 'party', broadcastId: 'party'}, 'sprite');
    expect(f.field.setValue).toHaveBeenLastCalledWith('party');
    const created = f.completion.apply(position, {kind: 'create-broadcast', text: 'celebrate'}, 'sprite');
    expect(created).toMatchObject({name: 'celebrate', type: 'broadcast_msg'});
    expect(f.workspace.createVariable).toHaveBeenCalledWith('celebrate', 'broadcast_msg', null, false, false);
    expect(f.field.setValue).toHaveBeenLastCalledWith('new:celebrate');
    expect(f.ScratchBlocks.Events.setGroup).toHaveBeenCalled();
});

test('a changed target or duplicate name is rejected before native mutation', () => {
    const f = fixture();
    expect(() => f.completion.apply(position, {kind: 'create-broadcast', text: 'new'}, 'other'))
        .toThrow('destination has changed');
    expect(() => f.completion.apply(position, {kind: 'create-broadcast', text: 'party'}, 'sprite'))
        .toThrow('choices have changed');
    expect(f.workspace.createVariable).not.toHaveBeenCalled();
});
