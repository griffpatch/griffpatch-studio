import {createBroadcastRenamer, syncBroadcastVm} from
    '../../../src/experiments/keyboard-authoring/broadcast-rename';

const fixture = () => {
    const model = {name: 'party', value: 'party', type: 'broadcast_msg', getId: () => 'broadcast-id'};
    const reference = {fields: {BROADCAST_OPTION: {id: 'broadcast-id', value: 'party'}}};
    const blocks = {_blocks: {reference}, resetCache: jest.fn()};
    const stage = {variables: {'broadcast-id': model}, blocks};
    const sprite = {blocks};
    const vm = {runtime: {getTargetForStage: () => stage, targets: [stage, sprite]}};
    const workspaceModel = {name: 'party', type: 'broadcast_msg', getId: () => 'broadcast-id'};
    const workspace = {
        getVariableById: jest.fn(() => workspaceModel),
        getVariable: jest.fn(() => null),
        renameVariableById: jest.fn((id, name) => { workspaceModel.name = name; }),
        whenBlockOperationsComplete: jest.fn(callback => callback()),
        addChangeListener: jest.fn(listener => { runListener = listener; }),
        removeChangeListener: jest.fn()
    };
    let runListener;
    const ScratchBlocks = {
        BROADCAST_MESSAGE_VARIABLE_TYPE: 'broadcast_msg',
        Variables: {trimName_: value => value && value.trim()},
        prompt: jest.fn(),
        alert: jest.fn()
    };
    return {model, reference, blocks, vm, workspaceModel, workspace, ScratchBlocks, listener: () => runListener};
};

test('broadcast synchronization updates the stage model, every reference and each unique cache', () => {
    const f = fixture();
    expect(syncBroadcastVm(f.vm, 'broadcast-id', 'celebrate')).toBe(true);
    expect(f.model).toMatchObject({name: 'celebrate', value: 'celebrate'});
    expect(f.reference.fields.BROADCAST_OPTION.value).toBe('celebrate');
    expect(f.blocks.resetCache).toHaveBeenCalledTimes(1);
    expect(syncBroadcastVm(f.vm, 'missing', 'nothing')).toBe(false);
});

test('the native prompt renames one identity and its history listener restores VM state', () => {
    const f = fixture();
    const done = jest.fn();
    const renamer = createBroadcastRenamer(f);
    renamer.prompt(f.workspaceModel, done);
    const callback = f.ScratchBlocks.prompt.mock.calls[0][2];
    callback('  celebrate  ');
    expect(f.workspace.renameVariableById).toHaveBeenCalledWith('broadcast-id', 'celebrate');
    expect(f.model).toMatchObject({name: 'celebrate', value: 'celebrate'});
    expect(done).toHaveBeenCalledTimes(1);
    f.workspaceModel.name = 'party';
    f.listener()({type: 'var_rename', varId: 'broadcast-id'});
    expect(f.model).toMatchObject({name: 'party', value: 'party'});
    f.workspaceModel.name = 'celebrate';
    f.listener()({type: 'var_rename', varId: 'broadcast-id'});
    expect(f.model).toMatchObject({name: 'celebrate', value: 'celebrate'});
    renamer.detach();
    expect(f.workspace.removeChangeListener).toHaveBeenCalledWith(f.listener());
});

test('a conflicting broadcast is rejected without changing either identity', () => {
    const f = fixture();
    f.workspace.getVariable.mockReturnValue({getId: () => 'other-id'});
    createBroadcastRenamer(f).prompt(f.workspaceModel);
    f.ScratchBlocks.prompt.mock.calls[0][2]('other message');
    expect(f.ScratchBlocks.alert).toHaveBeenCalledWith('A message named “other message” already exists.');
    expect(f.workspace.renameVariableById).not.toHaveBeenCalled();
    expect(f.model.name).toBe('party');
});
