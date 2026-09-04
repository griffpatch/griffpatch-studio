import {createListDefinitionPort} from '../../src/studio/bridge/list-definition-port';

const makeVm = () => {
    const list = {name: 'items', type: 'list', value: ['one', 'two'], isCloud: false};
    const stage = {
        id: 'stage-id',
        isOriginal: true,
        isStage: true,
        getName: () => 'Stage',
        variables: {list}
    };
    const monitorBlock = {id: 'list', opcode: 'data_listcontents', isMonitored: true};
    const monitor = {id: 'list', opcode: 'data_listcontents', mode: 'list', visible: true};
    const vm = {
        runtime: {
            targets: [stage],
            monitorBlocks: {getBlock: id => (id === 'list' ? monitorBlock : null)},
            _monitorState: new Map([['list', monitor]])
        }
    };
    return {list, monitor, monitorBlock, stage, vm};
};

test('retains a deleted list value and monitor after the VM has removed them', () => {
    const {stage, vm} = makeVm();
    const port = createListDefinitionPort({vm});
    delete stage.variables.list;
    vm.runtime._monitorState.delete('list');

    const change = port.captureEvent({
        type: 'var_delete',
        varId: 'list',
        varType: 'list',
        varName: 'items'
    });

    expect(change.after).toBeNull();
    expect(change.before).toMatchObject({
        present: true,
        id: 'list',
        value: ['one', 'two'],
        monitor: {visible: true},
        monitorBlock: {opcode: 'data_listcontents'}
    });
});

test('captures the final definition of a newly-created list', () => {
    const {stage, vm} = makeVm();
    stage.variables = {};
    vm.runtime._monitorState.clear();
    const port = createListDefinitionPort({vm});
    stage.variables.list = {name: 'items', type: 'list', value: [], isCloud: false};
    vm.runtime._monitorState.set('list', {
        id: 'list', opcode: 'data_listcontents', mode: 'list', visible: true
    });

    const change = port.captureEvent({
        type: 'var_create',
        varId: 'list',
        varType: 'list',
        varName: 'items'
    });

    expect(change.before).toBeNull();
    expect(change.after).toMatchObject({id: 'list', value: [], monitor: {visible: true}});
});

test('captures a newly-created scalar variable and its automatic monitor', () => {
    const {stage, vm} = makeVm();
    stage.variables = {};
    vm.runtime._monitorState.clear();
    vm.runtime.monitorBlocks.getBlock = id => (id === 'cake' ? {
        id: 'cake', opcode: 'data_variable', isMonitored: true
    } : null);
    const port = createListDefinitionPort({vm});
    stage.variables.cake = {name: 'cake', type: '', value: 0, isCloud: false};
    vm.runtime._monitorState.set('cake', {
        id: 'cake', opcode: 'data_variable', mode: 'default', visible: true
    });

    const change = port.captureEvent({type: 'var_create', varId: 'cake'});

    expect(change.before).toBeNull();
    expect(change.after).toMatchObject({
        id: 'cake', type: '', value: 0,
        monitor: {opcode: 'data_variable', visible: true},
        monitorBlock: {opcode: 'data_variable'}
    });
});

test('keeps the retained definition current while list deltas replay', () => {
    const {stage, vm} = makeVm();
    const port = createListDefinitionPort({vm});
    port.adoptDataDelta({
        schemaVersion: 1,
        targets: [{
            targetRef: {isStage: true, name: 'Stage'},
            variables: {},
            lists: {
                list: {index: 1, removed: ['two'], inserted: ['changed']}
            }
        }]
    }, 'forward');
    delete stage.variables.list;

    const change = port.captureEvent({type: 'var_delete', varId: 'list'});
    expect(change.before.value).toEqual(['one', 'changed']);
});
