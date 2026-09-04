import {cloneJson} from '../lib/clone-json';
import {directionalSplice} from '../state/data-state-delta';

const targetReference = target => ({
    isStage: Boolean(target.isStage),
    name: target.getName ? target.getName() : target.sprite.name
});

const monitorRecord = (runtime, id) => {
    const monitor = runtime._monitorState && runtime._monitorState.get(id);
    return monitor ? cloneJson(monitor) : null;
};

const captureDefinition = (vm, id) => {
    const runtime = vm.runtime;
    const target = runtime.targets.find(candidate => candidate.isOriginal &&
        Object.prototype.hasOwnProperty.call(candidate.variables, id));
    if (!target) return null;
    const variable = target.variables[id];
    const block = runtime.monitorBlocks && runtime.monitorBlocks.getBlock(id);
    return {
        present: true,
        id,
        targetRef: targetReference(target),
        name: variable.name,
        type: variable.type,
        isCloud: Boolean(variable.isCloud),
        value: cloneJson(variable.value),
        monitorBlock: block ? cloneJson(block) : null,
        monitor: monitorRecord(runtime, id)
    };
};

/**
 * Retain compact variable definitions so create/delete events preserve the
 * value and monitor metadata which Blockly events alone cannot round-trip.
 * Lists additionally depend on this port to retain their full contents.
 *
 * @param {object} options port dependencies
 * @param {object} options.vm TurboWarp VM
 * @returns {object} list-definition capture port
 */
const createListDefinitionPort = ({vm}) => {
    const definitions = new Map();

    const reset = () => {
        definitions.clear();
        (vm.runtime.targets || []).filter(target => target.isOriginal).forEach(target => {
            Object.keys(target.variables || {}).forEach(id => {
                const definition = captureDefinition(vm, id);
                if (definition) definitions.set(id, definition);
            });
        });
    };

    const captureEvent = event => {
        if (!event) return null;
        if (!['var_create', 'var_delete', 'var_rename'].includes(event.type)) {
            const live = event.blockId && captureDefinition(vm, event.blockId);
            if (live) definitions.set(event.blockId, live);
            return null;
        }
        const before = definitions.get(event.varId) || null;
        const after = captureDefinition(vm, event.varId);
        if (!before && !after) return null;
        if (after) definitions.set(event.varId, after);
        else definitions.delete(event.varId);
        return {
            before: cloneJson(before),
            after: cloneJson(after)
        };
    };

    const adoptValue = (id, value) => {
        const definition = definitions.get(id);
        if (definition) definition.value = cloneJson(value);
    };

    const adoptDefinition = definition => {
        if (definition.present) definitions.set(definition.id, cloneJson(definition));
        else definitions.delete(definition.id);
    };

    const adoptDataDelta = (delta, direction) => {
        delta.targets.forEach(targetDelta => {
            Object.keys(targetDelta.lists).forEach(id => {
                const definition = definitions.get(id);
                if (!definition) return;
                const {index, expected, replacement} = directionalSplice(targetDelta.lists[id], direction);
                definition.value.splice(index, expected.length, ...cloneJson(replacement));
            });
        });
    };

    reset();
    return {
        adoptDefinition,
        adoptDataDelta,
        adoptValue,
        captureEvent,
        reset
    };
};

export {createListDefinitionPort};
