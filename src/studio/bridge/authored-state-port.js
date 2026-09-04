import {cloneJson} from '../lib/clone-json';
import {
    applyDataStateDelta,
    createDataStateDelta,
    directionalSplice
} from '../state/data-state-delta';
import {firstJsonDifference} from '../validation/first-json-difference';
import {projectAuthoredState} from '../validation/project-state-projection';

const resolveTarget = (vm, reference) => vm.runtime.targets.find(target => target.isOriginal && (
    reference.isStage ? target.isStage : !target.isStage && target.sprite.name === reference.name
));

const setTargetProperties = (target, properties) => {
    if (!target.isStage) {
        if ('x' in properties || 'y' in properties) {
            target.setXY('x' in properties ? properties.x : target.x,
                'y' in properties ? properties.y : target.y, true);
        }
        if ('direction' in properties) target.setDirection(properties.direction);
        if ('size' in properties) target.setSize(properties.size);
        if ('visible' in properties) target.setVisible(properties.visible);
        if ('draggable' in properties) target.setDraggable(properties.draggable);
        if ('rotationStyle' in properties) target.setRotationStyle(properties.rotationStyle);
    }
    if ('currentCostume' in properties) target.setCostume(properties.currentCostume);
    if ('volume' in properties) target.volume = properties.volume;
    ['tempo', 'videoTransparency', 'videoState', 'textToSpeechLanguage'].forEach(property => {
        if (property in properties) target[property] = properties[property];
    });
};

const updateMonitorValue = (runtime, id, value) => {
    if (typeof runtime.requestUpdateMonitor !== 'function') return;
    const updated = runtime.requestUpdateMonitor({id, value: cloneJson(value)});
    const monitorState = runtime._monitorState;
    if (updated && monitorState && typeof monitorState.shallowClone === 'function' &&
        typeof runtime.emit === 'function') {
        runtime.emit('MONITORS_UPDATE', monitorState.shallowClone());
        monitorState.dirty = false;
    }
};

const restoreVariables = (runtime, target, snapshot) => {
    Object.keys(snapshot.variables).forEach(id => {
        const variable = target.variables[id];
        if (!variable || variable.type !== '') {
            throw new Error(`Cannot restore authored variable ${id}`);
        }
        variable.value = cloneJson(snapshot.variables[id]);
        updateMonitorValue(runtime, id, variable.value);
    });
    Object.keys(snapshot.lists).forEach(id => {
        const variable = target.variables[id];
        if (!variable || variable.type !== 'list') {
            throw new Error(`Cannot restore authored list ${id}`);
        }
        variable.value = cloneJson(snapshot.lists[id]);
        updateMonitorValue(runtime, id, variable.value);
    });
};

const restoreLayerOrder = targets => {
    targets
        .filter(({target, snapshot}) => !target.isStage && 'layerOrder' in snapshot.properties)
        .sort((left, right) => left.snapshot.properties.layerOrder - right.snapshot.properties.layerOrder)
        .forEach(({target}) => target.goToFront());
};

const targetPropertyValue = (target, property) => (
    property === 'layerOrder' && typeof target.getLayerOrder === 'function' ?
        target.getLayerOrder() : target[property]
);

const applyDataDeltaToTarget = (runtime, target, targetDelta, direction) => {
    Object.keys(targetDelta.variables || {}).forEach(id => {
        const variable = target.variables[id];
        if (!variable || variable.type !== '') throw new Error(`Cannot apply authored variable ${id}`);
        const change = targetDelta.variables[id];
        const expected = direction === 'forward' ? change.before : change.after;
        const difference = firstJsonDifference(expected, variable.value);
        if (difference) throw new Error(`Cannot apply authored variable ${id} at ${difference.path}`);
        variable.value = cloneJson(direction === 'forward' ? change.after : change.before);
        updateMonitorValue(runtime, id, variable.value);
    });
    Object.keys(targetDelta.lists || {}).forEach(id => {
        const variable = target.variables[id];
        if (!variable || variable.type !== 'list') throw new Error(`Cannot apply authored list ${id}`);
        const {index, expected, replacement} = directionalSplice(targetDelta.lists[id], direction);
        const actual = variable.value.slice(index, index + expected.length);
        const difference = firstJsonDifference(expected, actual);
        if (difference) throw new Error(`Cannot apply authored list ${id} at ${difference.path}`);
        variable.value.splice(index, expected.length, ...cloneJson(replacement));
        updateMonitorValue(runtime, id, variable.value);
    });
    const properties = Object.keys(targetDelta.properties || {}).reduce((values, property) => {
        const change = targetDelta.properties[property];
        const expected = direction === 'forward' ? change.before : change.after;
        const actual = targetPropertyValue(target, property);
        const difference = firstJsonDifference(expected, actual);
        if (difference) throw new Error(`Cannot apply authored target property ${property} at ${difference.path}`);
        values[property] = cloneJson(direction === 'forward' ? change.after : change.before);
        return values;
    }, {});
    setTargetProperties(target, properties);
    return {target, snapshot: {properties}};
};

/**
 * Keep the last clean, authored values separate from transient VM execution.
 * Execution signals mark the VM dirty until an explicit restore or adoption.
 * Authored editor changes will update this shadow through semantic data ports;
 * broad PROJECT_CHANGED snapshots are intentionally avoided on the hot path.
 *
 * @param {object} options port dependencies
 * @param {object} options.vm TurboWarp VM
 * @returns {object} authored-state lifecycle port
 */
const createAuthoredStatePort = ({vm}) => {
    let shadow = null;
    let dirty = false;
    let running = false;

    const capture = () => projectAuthoredState(JSON.parse(vm.toJSON()));
    const adoptCurrent = ({stopRuntime = false} = {}) => {
        if (stopRuntime) {
            vm.stopAll();
            running = false;
        }
        shadow = capture();
        dirty = false;
        return cloneJson(shadow);
    };
    const markRuntimeStarted = () => {
        running = true;
        dirty = true;
    };
    const markRuntimeStopped = () => {
        running = false;
    };
    const markRuntimeDirty = () => {
        dirty = true;
    };
    if (typeof vm.on === 'function') {
        vm.on('PROJECT_START', markRuntimeStarted);
        vm.on('PROJECT_RUN_START', markRuntimeStarted);
        vm.on('PROJECT_RUN_STOP', markRuntimeStopped);
        vm.on('SCRIPT_GLOW_ON', markRuntimeDirty);
    }

    const restore = () => {
        if (!shadow) throw new Error('No authored Studio state has been captured');
        vm.stopAll();
        running = false;
        const targets = shadow.targets.map(snapshot => {
            const target = resolveTarget(vm, snapshot.targetRef);
            if (!target) throw new Error(`Cannot restore authored target ${snapshot.targetRef.name}`);
            restoreVariables(vm.runtime, target, snapshot);
            setTargetProperties(target, snapshot.properties);
            return {target, snapshot};
        });
        restoreLayerOrder(targets);
        const actual = capture();
        const difference = firstJsonDifference(shadow, actual);
        if (difference) {
            throw new Error(`Authored Studio state restore failed at ${difference.path}`);
        }
        dirty = false;
        return {restored: true};
    };

    const sealDataChanges = ({stopRuntime = false} = {}) => {
        if (!dirty) return null;
        if (stopRuntime) {
            vm.stopAll();
            running = false;
        }
        const current = capture();
        const delta = createDataStateDelta(shadow, current);
        if (delta) shadow = applyDataStateDelta(shadow, delta, 'forward');
        dirty = running || Boolean(firstJsonDifference(shadow, current));
        return delta;
    };

    const applyDataDelta = (delta, direction) => {
        vm.stopAll();
        running = false;
        const appliedTargets = delta.targets.map(targetDelta => {
            const target = resolveTarget(vm, targetDelta.targetRef);
            if (!target) throw new Error(`Cannot apply data for target ${targetDelta.targetRef.name}`);
            return applyDataDeltaToTarget(vm.runtime, target, targetDelta, direction);
        });
        restoreLayerOrder(appliedTargets);
        shadow = applyDataStateDelta(shadow, delta, direction);
        const difference = firstJsonDifference(shadow, capture());
        if (difference) throw new Error(`Authored Studio data replay failed at ${difference.path}`);
        dirty = false;
        return {applied: true};
    };

    const adoptDataDelta = delta => {
        shadow = applyDataStateDelta(shadow, delta, 'forward');
        dirty = running || Boolean(firstJsonDifference(shadow, capture()));
    };

    const adoptListDefinition = definition => {
        if (!shadow) return;
        // Broadcast messages use Blockly's variable events but are structural
        // project state, not authored scalar/list values. Treating every
        // non-scalar type as a list poisons the shadow with a definition that
        // vm.toJSON() correctly serializes under `broadcasts` instead.
        if (definition.type !== '' && definition.type !== 'list') return;
        const target = shadow.targets.find(candidate => (
            candidate.targetRef.isStage === definition.targetRef.isStage &&
            candidate.targetRef.name === definition.targetRef.name
        ));
        if (!target) throw new Error(`Cannot adopt variable for target ${definition.targetRef.name}`);
        const collection = definition.type === '' ? target.variables : target.lists;
        if (definition.present) collection[definition.id] = cloneJson(definition.value);
        else delete collection[definition.id];
        dirty = running || Boolean(firstJsonDifference(shadow, capture()));
    };

    return {
        adoptCurrent,
        capture,
        detach: () => {
            if (typeof vm.removeListener !== 'function') return;
            vm.removeListener('PROJECT_START', markRuntimeStarted);
            vm.removeListener('PROJECT_RUN_START', markRuntimeStarted);
            vm.removeListener('PROJECT_RUN_STOP', markRuntimeStopped);
            vm.removeListener('SCRIPT_GLOW_ON', markRuntimeDirty);
        },
        applyDataDelta,
        adoptDataDelta,
        adoptListDefinition,
        isDirty: () => dirty,
        prepare: () => (dirty ? restore() : {restored: false}),
        restore,
        sealDataChanges
    };
};

export {createAuthoredStatePort};
