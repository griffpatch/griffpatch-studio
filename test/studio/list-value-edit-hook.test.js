import {beginVariableValueEdit, setVariableValue} from '../../src/lib/variable-utils';
import {attachStudioDataValueListener} from '../../src/studio/bridge/data-value-edit-hook';

const makeVm = () => {
    const stage = {
        id: 'stage-id',
        isStage: true,
        getName: () => 'Stage',
        variables: {
            items: {name: 'items', type: 'list', value: ['one'], isCloud: false},
            score: {name: 'score', type: '', value: 0, isCloud: false},
            cloud: {name: '\u2601 cloud', type: '', value: 0, isCloud: true}
        }
    };
    return {
        runtime: {
            getTargetForStage: () => stage,
            getTargetById: () => null
        }
    };
};

test('surrounds the normal GUI list mutation with one optional Studio callback', () => {
    const vm = makeVm();
    const calls = [];
    const detach = attachStudioDataValueListener(vm, edit => {
        calls.push(['begin', edit, vm.runtime.getTargetForStage().variables.items.value.slice()]);
        return after => calls.push(['finish', after, vm.runtime.getTargetForStage().variables.items.value.slice()]);
    });

    setVariableValue(vm, null, 'items', ['one', 'two']);

    expect(calls).toEqual([
        ['begin', expect.objectContaining({
            targetId: 'stage-id',
            variableId: 'items',
            dataTargetRef: {isStage: true, name: 'Stage'},
            before: ['one'],
            valueType: 'list'
        }), ['one']],
        ['finish', ['one', 'two'], ['one', 'two']]
    ]);
    detach();
    expect(() => setVariableValue(vm, null, 'items', [])).not.toThrow();
});

test('captures a whole scalar slider gesture instead of each intermediate value', () => {
    const vm = makeVm();
    const calls = [];
    attachStudioDataValueListener(vm, edit => {
        calls.push(['begin', edit]);
        return after => calls.push(['finish', after]);
    });

    const finish = beginVariableValueEdit(vm, null, 'score');
    setVariableValue(vm, null, 'score', 10);
    setVariableValue(vm, null, 'score', 20);
    finish();

    expect(calls).toEqual([
        ['begin', expect.objectContaining({
            variableId: 'score',
            variableName: 'score',
            valueType: 'scalar',
            before: 0
        })],
        ['finish', 20]
    ]);
});

test('does not record cloud-variable slider gestures', () => {
    const vm = makeVm();
    const listener = jest.fn();
    attachStudioDataValueListener(vm, listener);

    expect(beginVariableValueEdit(vm, null, 'cloud')).toBeNull();
    expect(listener).not.toHaveBeenCalled();
});
