import {
    combinePointerTravels,
    dispatchMouseSelection,
    typeInputText
} from './dom-interaction';
import {activateThroughPointer} from './pointer-activation';
import {createElementPointerTarget} from './pointer-target';
import {selectScratchTargetThroughPointer} from './scratch-target-selection-driver';

const TARGET_ATTRIBUTE = 'data-studio-target';
const TEXT_FRAMES_PER_CHARACTER = 5;

const escapedAttributeValue = value => String(value)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"');
const studioTarget = (documentObject, value) => documentObject.querySelector(
    `[${TARGET_ATTRIBUTE}="${escapedAttributeValue(value)}"]`
);

const targetName = target => target && (target.getName ? target.getName() :
    target.sprite && target.sprite.name);
const costumesOf = target => target && (target.getCostumes ? target.getCostumes() :
    target.sprite && target.sprite.costumes);
const costumeReference = costume => costume && ({
    assetId: costume.assetId,
    dataFormat: costume.dataFormat,
    name: costume.name
});
const sameCostume = (actual, expected) => Boolean(actual && expected &&
    actual.assetId === expected.assetId && actual.dataFormat === expected.dataFormat &&
    actual.name === expected.name);

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

const travelToElement = ({pointer, clock, signal, id, kind, locate, onFrame = null}) => pointer.travelTo(
    createElementPointerTarget({id, kind, locate}),
    {clock, signal, ...(onFrame ? {onFrame} : {})}
);

const clickThroughPointer = async ({pointer, clock, signal, scope, id, kind, locate}) => {
    const travel = await travelToElement({pointer, clock, signal, id, kind, locate});
    if (!travel.completed) return travel;
    const completed = await activateThroughPointer({
        pointer,
        clock,
        signal,
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
    if (typeof previous !== 'function') throw new Error(`VM costume method is unavailable: ${methodName}`);
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

const expectedInvocation = (observed, expectedArgs) => Boolean(observed && expectedArgs.every(
    (value, index) => observed.args[index] === value
));

const createCostumeLifecycleDriver = ({vm, documentObject, clock, pointer, scope, afterTargetSelection = null}) => ({
    cleanup: () => false,
    play: async (plan, signal = null) => {
        const travels = {};
        const expectedTarget = (vm.runtime.targets || []).find(target => (
            Boolean(target.isStage) === Boolean(plan.targetRef && plan.targetRef.isStage) &&
            targetName(target) === (plan.targetRef && plan.targetRef.name)
        ));
        if (!expectedTarget) {
            throw new Error(`Project target is unavailable: ${plan.targetRef && plan.targetRef.name}`);
        }

        if (!vm.editingTarget || vm.editingTarget.id !== expectedTarget.id) {
            const selection = await selectScratchTargetThroughPointer({
                vm,
                item: {targetRef: plan.targetRef},
                documentObject,
                clock,
                pointer,
                scope,
                afterTargetSelection,
                signal
            });
            if (selection.pointerTravel) travels.target = selection.pointerTravel;
            if (selection.status === 'cancelled') {
                return {cancelled: true, pointerTravel: combinePointerTravels(travels)};
            }
            if (selection.status !== 'verified') {
                throw new Error(`Project selector target is unavailable: ${plan.targetRef.name}`);
            }
        }

        const tabLocator = () => studioTarget(documentObject, 'tab-costumes');
        const tab = await waitFor(tabLocator, documentObject, signal);
        if (!visibleBounds(tab)) throw new Error('Costumes editor tab is unavailable');
        if (!tab.getAttribute || tab.getAttribute('aria-selected') !== 'true') {
            travels.tab = await clickThroughPointer({
                pointer,
                clock,
                signal,
                scope,
                id: 'tab-costumes',
                kind: 'editor-tab',
                locate: tabLocator
            });
            if (!travels.tab.completed) {
                return {cancelled: true, pointerTravel: combinePointerTravels(travels)};
            }
        }

        const costumesBefore = costumesOf(expectedTarget);
        if (!sameCostume(costumeReference(costumesBefore && costumesBefore[plan.costumeIndex]),
            plan.sourceCostume)) {
            throw new Error(`Recorded ${plan.assetKind} is unavailable at index ${plan.costumeIndex}`);
        }
        const sourceId = `${plan.assetKind}-item:${plan.costumeIndex}:${plan.sourceCostume.assetId}`;
        const sourceLocator = () => studioTarget(documentObject, sourceId);
        const sourceElement = await waitFor(sourceLocator, documentObject, signal);
        if (!visibleBounds(sourceElement)) throw new Error(`Recorded asset control is unavailable: ${sourceId}`);

        const assetTravel = await travelToElement({
            pointer,
            clock,
            signal,
            id: sourceId,
            kind: `${plan.assetKind}-item`,
            locate: sourceLocator
        });
        rememberTravel(travels, 'asset', assetTravel);
        if (!travels.asset.completed) {
            return {cancelled: true, pointerTravel: combinePointerTravels(travels)};
        }
        if (expectedTarget.currentCostume !== plan.costumeIndex) {
            const selected = await activateThroughPointer({
                pointer,
                clock,
                signal,
                activate: () => scope.runWithoutUndo(() => dispatchMouseSelection(
                    sourceElement,
                    travels.asset.target.point
                ))
            });
            if (!selected) return {cancelled: true, pointerTravel: combinePointerTravels(travels)};
            const selectionSettled = await waitFor(
                () => expectedTarget.currentCostume === plan.costumeIndex,
                documentObject,
                signal
            );
            if (!selectionSettled) throw new Error(`Recorded ${plan.assetKind} selection did not settle`);
        }

        if (plan.kind.endsWith('-rename-input')) {
            const inputLocator = () => {
                const editor = studioTarget(documentObject, 'costume-editor');
                return editor && editor.querySelector('input[type="text"]');
            };
            const input = await waitFor(inputLocator, documentObject, signal);
            if (!visibleBounds(input)) throw new Error('Costume name input is unavailable');
            const inputTravel = await clickThroughPointer({
                pointer,
                clock,
                signal,
                scope,
                id: 'costume-name-input',
                kind: 'text-input',
                locate: inputLocator
            });
            rememberTravel(travels, 'input', inputTravel);
            if (!travels.input.completed) {
                return {cancelled: true, pointerTravel: combinePointerTravels(travels)};
            }
            if (typeof input.focus === 'function') input.focus();
            const invocation = observeVmInvocation(vm, 'renameCostume');
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
                if (!expectedInvocation(observed, [plan.costumeIndex, plan.requestedName])) {
                    throw new Error('Costume rename did not invoke the expected VM operation');
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
                projectMatches: sameCostume(
                    costumeReference(costumesOf(expectedTarget)[plan.costumeIndex]),
                    plan.renamedCostume
                )
            };
        }

        if (plan.kind.endsWith('-duplicate-click')) {
            scope.runWithoutUndo(() => sourceElement.dispatchEvent(mouseEvent(
                documentObject,
                'contextmenu',
                travels.asset.target.point,
                {button: 2, buttons: 0}
            )));
            const duplicateId = `${sourceId}:duplicate`;
            const duplicateLocator = () => studioTarget(documentObject, duplicateId);
            const duplicate = await waitFor(duplicateLocator, documentObject, signal);
            if (!visibleBounds(duplicate)) throw new Error('Costume duplicate menu item is unavailable');
            const invocation = observeVmInvocation(vm, 'duplicateCostume');
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
                const observed = await waitFor(invocation.observation, documentObject, signal);
                if (!expectedInvocation(observed, [plan.costumeIndex])) {
                    throw new Error('Costume duplicate did not invoke the expected VM operation');
                }
                await observed.completion;
            } finally {
                invocation.restore();
            }
            return {
                frames: [],
                pointerTravel: combinePointerTravels(travels),
                controlsVisible: true,
                projectMatches: sameCostume(
                    costumeReference(costumesOf(expectedTarget)[plan.costumeIndex + 1]),
                    plan.addedCostume
                )
            };
        }

        if (plan.kind.endsWith('-delete-click')) {
            const deleteId = `${sourceId}:delete`;
            const deleteLocator = () => studioTarget(documentObject, deleteId);
            const deleteButton = await waitFor(deleteLocator, documentObject, signal);
            if (!visibleBounds(deleteButton)) throw new Error('Costume delete button is unavailable');
            const beforeCount = costumesBefore.length;
            const invocation = observeVmInvocation(vm, 'deleteCostume');
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
                const observed = await waitFor(invocation.observation, documentObject, signal);
                if (!expectedInvocation(observed, [plan.costumeIndex])) {
                    throw new Error('Costume delete did not invoke the expected VM operation');
                }
                await observed.completion;
            } finally {
                invocation.restore();
            }
            return {
                frames: [],
                pointerTravel: combinePointerTravels(travels),
                controlsVisible: true,
                projectMatches: costumesOf(expectedTarget).length === beforeCount - 1
            };
        }

        if (plan.kind.endsWith('-reorder-drag')) {
            const destinationCostume = costumesBefore[plan.newIndex];
            if (!destinationCostume) throw new Error(`Costume reorder destination is unavailable: ${plan.newIndex}`);
            const destinationId = `${plan.assetKind}-item:${plan.newIndex}:${destinationCostume.assetId}`;
            const destinationLocator = () => studioTarget(documentObject, destinationId);
            const destination = await waitFor(destinationLocator, documentObject, signal);
            if (!visibleBounds(destination)) {
                throw new Error(`Costume reorder control is unavailable: ${destinationId}`);
            }
            const invocation = observeVmInvocation(vm, 'reorderCostume');
            scope.runWithoutUndo(() => sourceElement.dispatchEvent(mouseEvent(
                documentObject,
                'mousedown',
                travels.asset.target.point
            )));
            if (typeof pointer.press === 'function') pointer.press();
            let pointerPressed = true;
            try {
                const destinationTravel = await travelToElement({
                    pointer,
                    clock,
                    signal,
                    id: destinationId,
                    kind: `${plan.assetKind}-reorder-destination`,
                    locate: destinationLocator,
                    onFrame: point => scope.runWithoutUndo(() => documentObject.dispatchEvent(
                        mouseEvent(documentObject, 'mousemove', point)
                    ))
                });
                rememberTravel(travels, 'destination', destinationTravel);
                if (!travels.destination.completed) {
                    return {cancelled: true, pointerTravel: combinePointerTravels(travels)};
                }
                scope.runWithoutUndo(() => documentObject.dispatchEvent(mouseEvent(
                    documentObject,
                    'mouseup',
                    travels.destination.target.point,
                    {buttons: 0}
                )));
                if (typeof pointer.release === 'function') pointer.release();
                pointerPressed = false;
                const observed = await waitFor(invocation.observation, documentObject, signal);
                if (!expectedInvocation(observed, [expectedTarget.id, plan.costumeIndex, plan.newIndex])) {
                    throw new Error('Costume reorder did not invoke the expected VM operation');
                }
                await observed.completion;
                const settled = await waitFor(
                    () => sameCostume(
                        costumeReference(costumesOf(expectedTarget)[plan.newIndex]),
                        plan.sourceCostume
                    ),
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
                invocation.restore();
                if (pointerPressed && typeof pointer.release === 'function') pointer.release();
            }
        }

        throw new Error(`Unsupported costume lifecycle interaction: ${plan.kind}`);
    }
});

export {createCostumeLifecycleDriver};
