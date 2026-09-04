import {
    combinePointerTravels,
    dispatchMouseSelection,
    typeInputText
} from './dom-interaction';
import {activateThroughPointer} from './pointer-activation';
import {createElementPointerTarget} from './pointer-target';

const TARGET_ATTRIBUTE = 'data-studio-target';
const SPRITE_NAME_ATTRIBUTE = 'data-studio-sprite-name';
const TEXT_FRAMES_PER_CHARACTER = 5;

const escapedAttributeValue = value => String(value)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"');
const attributeTarget = (documentObject, attribute, value) => documentObject.querySelector(
    `[${attribute}="${escapedAttributeValue(value)}"]`
);
const studioTarget = (documentObject, value) => attributeTarget(documentObject, TARGET_ATTRIBUTE, value);

const targetName = target => target && (target.getName ? target.getName() :
    target.sprite && target.sprite.name);
const soundsOf = target => target && (target.getSounds ? target.getSounds() :
    target.sprite && target.sprite.sounds);
const soundReference = sound => sound && ({
    assetId: sound.assetId,
    dataFormat: sound.dataFormat,
    name: sound.name,
    rate: sound.rate,
    sampleCount: sound.sampleCount
});
const sameSound = (actual, expected) => Boolean(actual && expected &&
    actual.assetId === expected.assetId && actual.dataFormat === expected.dataFormat &&
    actual.name === expected.name && actual.rate === expected.rate &&
    actual.sampleCount === expected.sampleCount);

const visibleBounds = element => {
    const rect = element && element.getBoundingClientRect && element.getBoundingClientRect();
    return Boolean(rect && rect.width > 0 && rect.height > 0);
};

const waitFor = async (locate, documentObject, signal, frameLimit = 240) => {
    for (let frame = 0; frame < frameLimit; frame += 1) {
        const value = locate();
        if (value) return value;
        if (signal && signal.aborted) return null;
        await new Promise(resolve => documentObject.defaultView.requestAnimationFrame(resolve));
    }
    return null;
};

const mouseEvent = (documentObject, type, point, {button = 0, buttons = 1} = {}) =>
    new documentObject.defaultView.MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        view: documentObject.defaultView,
        button,
        buttons,
        clientX: point.x,
        clientY: point.y
    });

const clickThroughPointer = async ({pointer, clock, signal, scope, id, kind, locate}) => {
    const travel = await pointer.travelTo(createElementPointerTarget({id, kind, locate}), {clock, signal});
    if (!travel.completed) return travel;
    const completed = await activateThroughPointer({
        pointer,
        clock,
        signal,
        targetKind: kind,
        activate: () => scope.runWithoutUndo(() => dispatchMouseSelection(
            travel.target.element,
            travel.target.point
        ))
    });
    return {...travel, completed};
};

const rememberTravel = (travels, key, travel) => {
    travels[key] = travel;
    return travel;
};

const observeVmInvocation = (vm, methodName) => {
    const previous = vm[methodName];
    if (typeof previous !== 'function') throw new Error(`VM sound method is unavailable: ${methodName}`);
    let completion = null;
    const wrapper = (...args) => {
        const result = previous.apply(vm, args);
        completion = Promise.resolve(result);
        return result;
    };
    vm[methodName] = wrapper;
    return {
        observation: () => (completion ? {completion} : null),
        restore: () => {
            if (vm[methodName] === wrapper) vm[methodName] = previous;
        }
    };
};

const createSoundLifecycleDriver = ({vm, documentObject, clock, pointer, scope}) => ({
    cleanup: () => false,
    play: async (plan, signal = null) => {
        const travels = {};
        const expectedTarget = plan.targetRef && (vm.runtime.targets || []).find(target => (
            Boolean(target.isStage) === Boolean(plan.targetRef.isStage) &&
            targetName(target) === plan.targetRef.name
        ));
        if (!expectedTarget) throw new Error(`Project target is unavailable: ${plan.targetRef && plan.targetRef.name}`);

        if (!vm.editingTarget || vm.editingTarget.id !== expectedTarget.id) {
            const selector = () => (plan.targetRef.isStage ? studioTarget(documentObject, 'stage-selector') :
                attributeTarget(documentObject, SPRITE_NAME_ATTRIBUTE, plan.targetRef.name));
            const targetElement = await waitFor(selector, documentObject, signal);
            if (!targetElement) throw new Error(`Project selector target is unavailable: ${plan.targetRef.name}`);
            travels.target = await clickThroughPointer({
                pointer,
                clock,
                signal,
                scope,
                id: plan.targetRef.isStage ? 'stage-selector' : `sprite:${plan.targetRef.name}`,
                kind: plan.targetRef.isStage ? 'stage-selector' : 'sprite-selector',
                locate: selector
            });
            if (!travels.target.completed) {
                return {cancelled: true, pointerTravel: combinePointerTravels(travels)};
            }
            const selected = await waitFor(
                () => vm.editingTarget && vm.editingTarget.id === expectedTarget.id,
                documentObject,
                signal
            );
            if (!selected) throw new Error(`Project selection did not settle: ${plan.targetRef.name}`);
        }

        const tab = await waitFor(() => studioTarget(documentObject, 'tab-sounds'), documentObject, signal);
        if (!tab) throw new Error('Sounds editor tab is unavailable');
        const tabTravel = await clickThroughPointer({
            pointer,
            clock,
            signal,
            scope,
            id: 'tab-sounds',
            kind: 'editor-tab',
            locate: () => studioTarget(documentObject, 'tab-sounds')
        });
        rememberTravel(travels, 'tab', tabTravel);
        if (!travels.tab.completed) {
            return {cancelled: true, pointerTravel: combinePointerTravels(travels)};
        }

        const sourceSound = plan.sourceSound || plan.oldSound || plan.deletedSound || plan.movedSound;
        const sourceId = `sound-item:${plan.soundIndex}:${sourceSound.assetId}`;
        const sourceLocator = () => studioTarget(documentObject, sourceId);
        const sourceElement = await waitFor(sourceLocator, documentObject, signal);
        if (!visibleBounds(sourceElement)) throw new Error(`Recorded sound control is unavailable: ${sourceId}`);
        const soundsBefore = soundsOf(expectedTarget);
        if (!sameSound(soundReference(soundsBefore && soundsBefore[plan.soundIndex]), sourceSound)) {
            throw new Error(`Recorded sound is unavailable at index ${plan.soundIndex}`);
        }

        const soundTravel = await clickThroughPointer({
            pointer,
            clock,
            signal,
            scope,
            id: sourceId,
            kind: 'sound-item',
            locate: sourceLocator
        });
        rememberTravel(travels, 'sound', soundTravel);
        if (!travels.sound.completed) {
            return {cancelled: true, pointerTravel: combinePointerTravels(travels)};
        }

        if (plan.kind === 'sound-rename-input') {
            const inputLocator = () => studioTarget(documentObject, 'sound-name-input');
            const input = await waitFor(inputLocator, documentObject, signal);
            if (!visibleBounds(input)) throw new Error('Sound name input is unavailable');
            const inputTravel = await clickThroughPointer({
                pointer,
                clock,
                signal,
                scope,
                id: 'sound-name-input',
                kind: 'text-input',
                locate: inputLocator
            });
            rememberTravel(travels, 'input', inputTravel);
            if (!travels.input.completed) {
                return {cancelled: true, pointerTravel: combinePointerTravels(travels)};
            }
            if (typeof input.focus === 'function') input.focus();
            const invocation = observeVmInvocation(vm, 'renameSound');
            let typed;
            try {
                typed = await typeInputText({
                    input,
                    value: plan.requestedName,
                    clock,
                    signal,
                    point: travels.input.target.point,
                    pointer,
                    framesPerCharacter: TEXT_FRAMES_PER_CHARACTER
                });
                if (!typed.completed) {
                    return {cancelled: true, pointerTravel: combinePointerTravels(travels)};
                }
                if (typeof input.blur === 'function') input.blur();
                const observation = await waitFor(invocation.observation, documentObject, signal);
                if (!observation) throw new Error('Sound rename did not invoke its VM operation');
                await observation.completion;
            } finally {
                invocation.restore();
            }
            const renamed = soundsOf(expectedTarget)[plan.soundIndex];
            return {
                frames: [],
                pointerTravel: combinePointerTravels(travels),
                controlsVisible: true,
                typedValues: typed.intermediateValues,
                projectMatches: sameSound(soundReference(renamed), plan.renamedSound)
            };
        }

        if (plan.kind === 'sound-duplicate-click') {
            scope.runWithoutUndo(() => sourceElement.dispatchEvent(mouseEvent(
                documentObject,
                'contextmenu',
                travels.sound.target.point,
                {button: 2, buttons: 0}
            )));
            const duplicateId = `${sourceId}:duplicate`;
            const duplicateLocator = () => studioTarget(documentObject, duplicateId);
            const duplicate = await waitFor(duplicateLocator, documentObject, signal);
            if (!visibleBounds(duplicate)) throw new Error('Sound duplicate menu item is unavailable');
            const invocation = observeVmInvocation(vm, 'duplicateSound');
            try {
                const actionTravel = await clickThroughPointer({
                    pointer,
                    clock,
                    signal,
                    scope,
                    id: duplicateId,
                    kind: 'context-menu-item',
                    locate: duplicateLocator
                });
                rememberTravel(travels, 'action', actionTravel);
                if (!travels.action.completed) {
                    return {cancelled: true, pointerTravel: combinePointerTravels(travels)};
                }
                const observation = await waitFor(invocation.observation, documentObject, signal);
                if (!observation) throw new Error('Sound duplicate did not invoke its VM operation');
                await observation.completion;
            } finally {
                invocation.restore();
            }
            const added = soundsOf(expectedTarget)[plan.soundIndex + 1];
            return {
                frames: [],
                pointerTravel: combinePointerTravels(travels),
                controlsVisible: true,
                projectMatches: sameSound(soundReference(added), plan.addedSound)
            };
        }

        if (plan.kind === 'sound-delete-click') {
            const deleteId = `${sourceId}:delete`;
            const deleteLocator = () => studioTarget(documentObject, deleteId);
            const deleteButton = await waitFor(deleteLocator, documentObject, signal);
            if (!visibleBounds(deleteButton)) throw new Error('Sound delete button is unavailable');
            const beforeCount = soundsBefore.length;
            const invocation = observeVmInvocation(vm, 'deleteSound');
            try {
                const actionTravel = await clickThroughPointer({
                    pointer,
                    clock,
                    signal,
                    scope,
                    id: deleteId,
                    kind: 'delete-button',
                    locate: deleteLocator
                });
                rememberTravel(travels, 'action', actionTravel);
                if (!travels.action.completed) {
                    return {cancelled: true, pointerTravel: combinePointerTravels(travels)};
                }
                const observation = await waitFor(invocation.observation, documentObject, signal);
                if (!observation) throw new Error('Sound delete did not invoke its VM operation');
                await observation.completion;
            } finally {
                invocation.restore();
            }
            const remaining = soundsOf(expectedTarget);
            return {
                frames: [],
                pointerTravel: combinePointerTravels(travels),
                controlsVisible: true,
                projectMatches: remaining.length === beforeCount - 1
            };
        }

        if (plan.kind === 'sound-reorder-drag') {
            const destinationSound = soundsBefore[plan.newIndex];
            if (!destinationSound) throw new Error(`Sound reorder destination is unavailable: ${plan.newIndex}`);
            const destinationId = `sound-item:${plan.newIndex}:${destinationSound.assetId}`;
            const destinationLocator = () => studioTarget(documentObject, destinationId);
            const destination = await waitFor(destinationLocator, documentObject, signal);
            if (!visibleBounds(destination)) throw new Error(`Sound reorder control is unavailable: ${destinationId}`);
            scope.runWithoutUndo(() => sourceElement.dispatchEvent(mouseEvent(
                documentObject, 'mousedown', travels.sound.target.point
            )));
            if (typeof pointer.press === 'function') pointer.press();
            let pointerPressed = true;
            try {
                const destinationTravel = await pointer.travelTo(createElementPointerTarget({
                    id: destinationId,
                    kind: 'sound-reorder-destination',
                    locate: destinationLocator
                }), {
                    clock,
                    signal,
                    onFrame: point => scope.runWithoutUndo(() => documentObject.dispatchEvent(
                        mouseEvent(documentObject, 'mousemove', point)
                    ))
                });
                rememberTravel(travels, 'destination', destinationTravel);
                if (!travels.destination.completed) {
                    return {cancelled: true, pointerTravel: combinePointerTravels(travels)};
                }
                scope.runWithoutUndo(() => documentObject.dispatchEvent(mouseEvent(
                    documentObject, 'mouseup', travels.destination.target.point, {buttons: 0}
                )));
                if (typeof pointer.release === 'function') pointer.release();
                pointerPressed = false;
                const settled = await waitFor(
                    () => sameSound(soundReference(soundsOf(expectedTarget)[plan.newIndex]), plan.movedSound),
                    documentObject,
                    signal
                );
                return {
                    frames: [],
                    pointerTravel: combinePointerTravels(travels),
                    controlsVisible: true,
                    projectMatches: Boolean(settled)
                };
            } finally {
                if (pointerPressed && typeof pointer.release === 'function') pointer.release();
            }
        }

        throw new Error(`Unsupported sound lifecycle interaction: ${plan.kind}`);
    }
});

export {createSoundLifecycleDriver};
