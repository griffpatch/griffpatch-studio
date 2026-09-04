import {
    combinePointerTravels,
    dispatchMouseSelection,
    typeInputText
} from './dom-interaction';
import {activateThroughPointer} from './pointer-activation';
import {createElementPointerTarget} from './pointer-target';
import {selectScratchTargetThroughPointer} from './scratch-target-selection-driver';

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
const spriteCard = (documentObject, name) => attributeTarget(documentObject, SPRITE_NAME_ATTRIBUTE, name);

const targetName = target => target && (target.getName ? target.getName() :
    target.sprite && target.sprite.name);
const sameTarget = (target, reference) => Boolean(target && reference && target.isOriginal &&
    !target.isStage && targetName(target) === reference.name);
const runtimeTarget = (vm, reference) => (vm.runtime.targets || []).find(target => sameTarget(target, reference));

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

const mouseEvent = (documentObject, type, point, {button = 0, buttons = 0} = {}) =>
    new documentObject.defaultView.MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        view: documentObject.defaultView,
        button,
        buttons,
        clientX: point.x,
        clientY: point.y
    });

const clickThroughPointer = async ({pointer, clock, signal, scope, id, kind, locate, activate = null}) => {
    const travel = await pointer.travelTo(createElementPointerTarget({id, kind, locate}), {clock, signal});
    if (!travel.completed) return travel;
    const completed = await activateThroughPointer({
        pointer,
        clock,
        signal,
        targetKind: kind,
        activate: () => scope.runWithoutUndo(() => (activate ? activate(travel) : dispatchMouseSelection(
            travel.target.element,
            travel.target.point
        )))
    });
    return {...travel, completed};
};

const observeVmInvocation = (vm, methodName) => {
    const previous = vm[methodName];
    if (typeof previous !== 'function') throw new Error(`VM sprite method is unavailable: ${methodName}`);
    let invocation = null;
    const wrapper = (...args) => {
        const result = previous.apply(vm, args);
        invocation = {args, completion: Promise.resolve(result)};
        return result;
    };
    vm[methodName] = wrapper;
    return {
        observation: () => invocation,
        restore: () => {
            if (vm[methodName] === wrapper) vm[methodName] = previous;
        }
    };
};

const selectTarget = async ({
    vm, reference, documentObject, clock, pointer, scope, signal, travels, afterTargetSelection
}) => {
    const selection = await selectScratchTargetThroughPointer({
        vm,
        item: {targetRef: reference},
        documentObject,
        clock,
        pointer,
        scope,
        afterTargetSelection,
        signal
    });
    if (selection.pointerTravel) travels.target = selection.pointerTravel;
    if (selection.status === 'cancelled') return false;
    if (selection.status !== 'verified') {
        throw new Error(`Sprite selection is unavailable: ${reference.name}`);
    }
    return true;
};

const createSpriteLifecycleDriver = ({vm, documentObject, clock, pointer, scope, afterTargetSelection = null}) => ({
    cleanup: () => false,
    play: async (plan, signal = null) => {
        const travels = {};

        if (plan.kind === 'sprite-duplicate-click') {
            const source = runtimeTarget(vm, plan.sourceTargetRef);
            if (!source) throw new Error(`Source sprite is unavailable: ${plan.sourceTargetRef.name}`);
            const cardLocator = () => spriteCard(documentObject, plan.sourceTargetRef.name);
            if (!visibleBounds(await waitFor(cardLocator, documentObject, signal))) {
                throw new Error(`Source sprite card is unavailable: ${plan.sourceTargetRef.name}`);
            }
            const beforeIds = new Set((vm.runtime.targets || []).map(target => target.id));
            travels.source = await clickThroughPointer({
                pointer,
                clock,
                signal,
                scope,
                id: `sprite:${plan.sourceTargetRef.name}`,
                kind: 'sprite-selector',
                locate: cardLocator,
                activate: travel => travel.target.element.dispatchEvent(mouseEvent(
                    documentObject,
                    'contextmenu',
                    travel.target.point,
                    {button: 2}
                ))
            });
            if (!travels.source.completed) {
                return {cancelled: true, pointerTravel: combinePointerTravels(travels)};
            }
            const duplicateId = `sprite:${plan.sourceTargetRef.name}:duplicate`;
            const duplicateLocator = () => studioTarget(documentObject, duplicateId);
            if (!visibleBounds(await waitFor(duplicateLocator, documentObject, signal))) {
                throw new Error('Sprite duplicate menu item is unavailable');
            }
            const invocation = observeVmInvocation(vm, 'duplicateSprite');
            try {
                travels.action = await clickThroughPointer({
                    pointer,
                    clock,
                    signal,
                    scope,
                    id: duplicateId,
                    kind: 'context-menu-item',
                    locate: duplicateLocator
                });
                if (!travels.action.completed) {
                    return {cancelled: true, pointerTravel: combinePointerTravels(travels)};
                }
                const observed = await waitFor(invocation.observation, documentObject, signal);
                if (!observed || observed.args[0] !== source.id) {
                    throw new Error('Sprite duplicate did not invoke the expected VM operation');
                }
                await observed.completion;
            } finally {
                invocation.restore();
            }
            const created = (vm.runtime.targets || []).filter(target => !beforeIds.has(target.id) &&
                target.isOriginal && !target.isStage);
            return {
                frames: [],
                pointerTravel: combinePointerTravels(travels),
                controlsVisible: true,
                projectMatches: created.length === 1 && sameTarget(created[0], plan.createdTargetRef)
            };
        }

        const target = runtimeTarget(vm, plan.targetRef);
        if (!target) throw new Error(`Sprite is unavailable: ${plan.targetRef.name}`);
        if (!await selectTarget({
            vm,
            reference: plan.targetRef,
            documentObject,
            clock,
            pointer,
            scope,
            signal,
            travels,
            afterTargetSelection
        })) {
            return {cancelled: true, pointerTravel: combinePointerTravels(travels)};
        }

        if (plan.kind === 'sprite-rename-input') {
            const inputLocator = () => studioTarget(documentObject, 'sprite-name-input');
            const input = await waitFor(inputLocator, documentObject, signal);
            if (!visibleBounds(input)) throw new Error('Sprite name input is unavailable');
            travels.input = await clickThroughPointer({
                pointer,
                clock,
                signal,
                scope,
                id: 'sprite-name-input',
                kind: 'text-input',
                locate: inputLocator
            });
            if (!travels.input.completed) {
                return {cancelled: true, pointerTravel: combinePointerTravels(travels)};
            }
            if (typeof input.focus === 'function') input.focus();
            const invocation = observeVmInvocation(vm, 'renameSprite');
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
                const observed = await waitFor(invocation.observation, documentObject, signal);
                if (!observed || observed.args[0] !== target.id || observed.args[1] !== plan.requestedName) {
                    throw new Error('Sprite rename did not invoke the expected VM operation');
                }
                await observed.completion;
            } finally {
                invocation.restore();
            }
            return {
                frames: [],
                pointerTravel: combinePointerTravels(travels),
                controlsVisible: true,
                typedValues: typed.intermediateValues,
                projectMatches: sameTarget(target, plan.renamedTargetRef)
            };
        }

        if (plan.kind === 'sprite-delete-click') {
            const deleteId = `sprite:${plan.targetRef.name}:delete`;
            const deleteLocator = () => studioTarget(documentObject, deleteId);
            if (!visibleBounds(await waitFor(deleteLocator, documentObject, signal))) {
                throw new Error('Sprite delete button is unavailable');
            }
            const invocation = observeVmInvocation(vm, 'deleteSprite');
            try {
                travels.action = await clickThroughPointer({
                    pointer,
                    clock,
                    signal,
                    scope,
                    id: deleteId,
                    kind: 'delete-button',
                    locate: deleteLocator
                });
                if (!travels.action.completed) {
                    return {cancelled: true, pointerTravel: combinePointerTravels(travels)};
                }
                const observed = await waitFor(invocation.observation, documentObject, signal);
                if (!observed || observed.args[0] !== target.id) {
                    throw new Error('Sprite delete did not invoke the expected VM operation');
                }
                await observed.completion;
            } finally {
                invocation.restore();
            }
            return {
                frames: [],
                pointerTravel: combinePointerTravels(travels),
                controlsVisible: true,
                projectMatches: !vm.runtime.getTargetById(target.id) &&
                    !runtimeTarget(vm, plan.targetRef)
            };
        }

        throw new Error(`Unsupported sprite lifecycle interaction: ${plan.kind}`);
    }
});

export {createSpriteLifecycleDriver};
