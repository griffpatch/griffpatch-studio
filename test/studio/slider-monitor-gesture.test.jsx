import React from 'react';
import VM from 'scratch-vm';
import {shallow} from 'enzyme';

import {SliderMonitor} from '../../src/containers/slider-monitor';
import {attachStudioDataValueListener} from '../../src/studio/bridge/data-value-edit-hook';

const makeVm = () => {
    const stage = {
        id: 'stage-id',
        isStage: true,
        getName: () => 'Stage',
        variables: {
            score: {name: 'score', type: '', value: 0, isCloud: false}
        }
    };
    const vm = Object.create(VM.prototype);
    vm.runtime = {
        getTargetForStage: () => stage,
        getTargetById: () => null
    };
    return {stage, vm};
};

const monitorProps = vm => ({
    categoryColor: {background: '#ff8c1a', text: '#ffffff'},
    id: 'score',
    label: 'score',
    targetId: null,
    value: 0,
    vm
});

test('coalesces all range input frames between press and release', () => {
    const {stage, vm} = makeVm();
    const edits = [];
    attachStudioDataValueListener(vm, edit => {
        edits.push({phase: 'begin', edit});
        return after => edits.push({phase: 'finish', after});
    });
    const monitor = shallow(<SliderMonitor {...monitorProps(vm)} />).instance();

    monitor.handleSliderGestureStart();
    monitor.handleSliderUpdate({target: {value: '10'}});
    monitor.handleSliderUpdate({target: {value: '25'}});
    monitor.handleSliderGestureEnd();

    expect(stage.variables.score.value).toBe(25);
    expect(edits).toEqual([
        {phase: 'begin', edit: expect.objectContaining({before: 0, variableId: 'score'})},
        {phase: 'finish', after: 25}
    ]);
});

test('treats an accessibility change without pointer or key events as one gesture', () => {
    const {vm} = makeVm();
    const edits = [];
    attachStudioDataValueListener(vm, edit => {
        edits.push(['begin', edit.before]);
        return after => edits.push(['finish', after]);
    });
    const monitor = shallow(<SliderMonitor {...monitorProps(vm)} />).instance();

    monitor.handleSliderUpdate({target: {value: '8'}});

    expect(edits).toEqual([['begin', 0], ['finish', 8]]);
});
