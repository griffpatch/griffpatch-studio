import {beginStudioDataValueEdit} from '../studio/bridge/data-value-edit-hook';

// Utility functions for updating variables in the VM
// TODO (VM#1145) these should be moved to top-level VM API
const getVariable = (vm, targetId, variableId) => {
    const target = targetId ?
        vm.runtime.getTargetById(targetId) :
        vm.runtime.getTargetForStage();
    return target.variables[variableId];
};

const getVariableValue = (vm, targetId, variableId) => {
    const variable = getVariable(vm, targetId, variableId);
    // If array, return a new copy for mutating, ensuring that updates stay immutable.
    if (variable.value instanceof Array) return variable.value.slice();
    return variable.value;
};

const targetReference = target => ({
    isStage: Boolean(target.isStage),
    name: target.getName ? target.getName() : target.sprite.name
});

/**
 * Begin one monitor-edit gesture and return a function which commits its final
 * value. Callers control gesture boundaries so a slider drag remains one
 * visible Studio step even when the browser emits many input events.
 *
 * @param {object} vm TurboWarp VM
 * @param {?string} targetId data owner, or null for the stage
 * @param {string} variableId Scratch variable ID
 * @returns {?Function} completes the gesture using the variable's current value
 */
const beginVariableValueEdit = (vm, targetId, variableId) => {
    const target = targetId ?
        vm.runtime.getTargetById(targetId) :
        vm.runtime.getTargetForStage();
    const variable = target.variables[variableId];
    if (!variable || variable.isCloud) return null;
    const historyTarget = vm.editingTarget || target;
    const isList = variable.type === 'list';
    const cloneValue = value => (isList ? value.slice() : value);
    const finish = beginStudioDataValueEdit(vm, {
        targetId: historyTarget.id,
        targetRef: targetReference(historyTarget),
        dataTargetRef: targetReference(target),
        variableId,
        variableName: variable.name || null,
        valueType: isList ? 'list' : 'scalar',
        before: cloneValue(variable.value)
    });
    return finish ? () => finish(cloneValue(variable.value)) : null;
};

const setVariableValue = (vm, targetId, variableId, value) => {
    const target = targetId ?
        vm.runtime.getTargetById(targetId) :
        vm.runtime.getTargetForStage();
    const variable = target.variables[variableId];
    const finishStudioEdit = variable.type === 'list' ? beginVariableValueEdit(vm, targetId, variableId) : null;
    variable.value = value;
    if (variable.isCloud) {
        vm.runtime.ioDevices.cloud.requestUpdateVariable(variable.name, variable.value);
    }
    if (finishStudioEdit) finishStudioEdit();
};

export {
    beginVariableValueEdit,
    getVariable,
    getVariableValue,
    setVariableValue
};
