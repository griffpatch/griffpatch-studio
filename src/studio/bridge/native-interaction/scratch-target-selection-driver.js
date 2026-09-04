import {dispatchMouseSelection} from './dom-interaction';
import {createElementPointerTarget} from './pointer-target';
import {activateThroughPointer} from './pointer-activation';

const TARGET_ATTRIBUTE = 'data-studio-target';
const SPRITE_NAME_ATTRIBUTE = 'data-studio-sprite-name';

const escapedAttributeValue = value => String(value)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"');

const targetName = target => target && (target.getName ? target.getName() :
    target.sprite && target.sprite.name);

const transactionReference = item => (item.events ? item.events[0] || item : item);

const runtimeTargetFor = (vm, item) => {
    const reference = transactionReference(item);
    const byId = reference.targetId && vm.runtime.getTargetById(reference.targetId);
    if (byId) return byId;
    const durable = reference.targetRef;
    if (!durable) return null;
    return (vm.runtime.targets || []).find(target => target.isOriginal && (
        durable.isStage ? target.isStage : !target.isStage && targetName(target) === durable.name
    )) || null;
};

const targetElement = (documentObject, target) => {
    if (target.isStage) return documentObject.querySelector(`[${TARGET_ATTRIBUTE}="stage-selector"]`);
    return documentObject.querySelector(
        `[${SPRITE_NAME_ATTRIBUTE}="${escapedAttributeValue(targetName(target))}"]`
    );
};

const placePointerAtCurrentTarget = ({vm, documentObject, pointer, clock, signal}) => {
    if (pointer.getPosition && !pointer.getPosition() && vm.editingTarget &&
        targetElement(documentObject, vm.editingTarget)) {
        const current = vm.editingTarget;
        return pointer.travelTo(createElementPointerTarget({
            id: `target:current:${current.id}`,
            kind: 'sprite-selector',
            locate: () => targetElement(documentObject, current)
        }), {clock, signal});
    }
    return {completed: !(signal && signal.aborted)};
};

const waitForSelection = async ({vm, targetId, documentObject, signal, frameLimit = 120}) => {
    for (let frame = 0; frame < frameLimit; frame += 1) {
        if (vm.editingTarget && vm.editingTarget.id === targetId) return true;
        if (signal && signal.aborted) return false;
        await new Promise(resolve => documentObject.defaultView.requestAnimationFrame(resolve));
    }
    return false;
};

/**
 * Select a Scratch sprite or the Stage through its real selector card while
 * keeping pointer motion on the shared Studio sequence.
 *
 * @param {object} options driver dependencies and requested transaction target
 * @returns {Promise<object>} target-selection evidence
 */
const selectScratchTargetThroughPointer = async ({
    vm,
    item,
    documentObject,
    clock,
    pointer,
    scope,
    afterTargetSelection = null,
    clickSpeed = null,
    signal = null
}) => {
    const target = runtimeTargetFor(vm, item);
    if (!target) return {status: 'unsupported', reason: 'the recorded target is unavailable'};
    if (vm.editingTarget && vm.editingTarget.id === target.id) {
        return {status: 'verified', targetId: target.id, alreadySelected: true, pointerTravel: null};
    }
    const locate = () => targetElement(documentObject, target);
    if (!locate()) return {status: 'unsupported', reason: 'the target selector card is unavailable'};
    // A fresh history sequence has no prior cursor position. Start at the
    // selected card so its first sprite change is a visible journey too.
    const placed = await placePointerAtCurrentTarget({vm, documentObject, pointer, clock, signal});
    if (!placed.completed) return {status: 'cancelled', targetId: target.id};
    const pointerTravel = await pointer.travelTo(createElementPointerTarget({
        id: target.isStage ? 'target:stage' : `target:sprite:${targetName(target)}`,
        kind: target.isStage ? 'stage-selector' : 'sprite-selector',
        locate
    }), {clock, signal});
    if (!pointerTravel.completed) return {status: 'cancelled', targetId: target.id, pointerTravel};
    const clicked = await activateThroughPointer({
        pointer,
        clock,
        signal,
        targetKind: target.isStage ? 'stage-selector' : 'sprite-selector',
        speed: clickSpeed,
        activate: () => scope.runWithoutUndo(() => dispatchMouseSelection(
            pointerTravel.target.element,
            pointerTravel.target.point
        ))
    });
    if (!clicked) return {status: 'cancelled', targetId: target.id, pointerTravel};
    const selected = await waitForSelection({vm, targetId: target.id, documentObject, signal});
    if (selected && afterTargetSelection) await afterTargetSelection({signal});
    return {
        status: signal && signal.aborted ? 'cancelled' : (selected ? 'verified' : 'mismatch'),
        targetId: target.id,
        targetName: targetName(target),
        pointerTravel
    };
};

export {selectScratchTargetThroughPointer, placePointerAtCurrentTarget};
