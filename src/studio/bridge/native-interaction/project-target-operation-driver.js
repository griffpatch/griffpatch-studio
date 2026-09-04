import {resolveWorkspaceBlockId} from '../workspace-block-reference';
import {combinePointerTravels, dispatchMouseSelection} from './dom-interaction';
import {activateThroughPointer} from './pointer-activation';
import {createElementPointerTarget} from './pointer-target';

const SPRITE_NAME_ATTRIBUTE = 'data-studio-sprite-name';

const escapedAttributeValue = value => String(value)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"');

const targetName = target => target && (target.getName ? target.getName() :
    target.sprite && target.sprite.name);

const runtimeTargetFor = (vm, reference) => (vm.runtime.targets || []).find(target => (
    target.isOriginal && Boolean(target.isStage) === Boolean(reference && reference.isStage) &&
    targetName(target) === (reference && reference.name)
)) || null;

const spriteElement = (documentObject, reference) => documentObject.querySelector(
    `[${SPRITE_NAME_ATTRIBUTE}="${escapedAttributeValue(reference.name)}"]`
);

const visibleBounds = element => {
    const rect = element && element.getBoundingClientRect && element.getBoundingClientRect();
    return Boolean(rect && rect.width > 0 && rect.height > 0);
};

const blockCount = target => (
    target && target.blocks && target.blocks._blocks ? Object.keys(target.blocks._blocks).length : null
);

const waitFor = async (locate, documentObject, signal, frameLimit = 240) => {
    for (let frame = 0; frame < frameLimit; frame += 1) {
        const value = locate();
        if (value) return value;
        if (signal && signal.aborted) return null;
        await new Promise(resolve => documentObject.defaultView.requestAnimationFrame(resolve));
    }
    return null;
};

const mouseEvent = (documentObject, type, point, buttons = 1) => new documentObject.defaultView.MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    view: documentObject.defaultView,
    button: 0,
    buttons,
    clientX: point.x,
    clientY: point.y
});

const blocklyEvent = (type, point, target) => ({
    type,
    button: 0,
    clientX: point.x,
    clientY: point.y,
    target,
    preventDefault: () => {},
    stopPropagation: () => {}
});

const hoverAt = (documentObject, element, point) => {
    element.dispatchEvent(mouseEvent(documentObject, 'mouseover', point));
    element.dispatchEvent(mouseEvent(documentObject, 'mousemove', point));
};

const rememberTravel = (travels, key, travel) => {
    travels[key] = travel;
    return travel;
};

const selectReferencedTarget = async ({
    vm,
    reference,
    documentObject,
    pointer,
    clock,
    scope,
    signal,
    travels,
    travelKey = 'target'
}) => {
    const selectedTarget = runtimeTargetFor(vm, reference);
    if (!selectedTarget) throw new Error(`Sprite is unavailable: ${reference.name}`);
    if (vm.editingTarget && vm.editingTarget.id === selectedTarget.id) return selectedTarget;
    const locate = () => spriteElement(documentObject, reference);
    const element = await waitFor(locate, documentObject, signal);
    if (!element) throw new Error(`Sprite selector is unavailable: ${reference.name}`);
    const travel = await pointer.travelTo(createElementPointerTarget({
        id: `sprite:${reference.name}`,
        kind: 'sprite-selector',
        locate
    }), {clock, signal});
    travels[travelKey] = travel;
    if (!travel.completed) return null;
    const clicked = await activateThroughPointer({
        pointer,
        clock,
        signal,
        targetKind: 'sprite-selector',
        activate: () => scope.runWithoutUndo(() => dispatchMouseSelection(element, travel.target.point))
    });
    if (!clicked) return null;
    return waitFor(
        () => vm.editingTarget && vm.editingTarget.id === selectedTarget.id && selectedTarget,
        documentObject,
        signal
    );
};

const studioTargetElement = (documentObject, id) => documentObject.querySelector(
    `[data-studio-target="${escapedAttributeValue(id)}"]`
);

const workspacePoint = (workspace, coordinate) => {
    const canvas = workspace.getCanvas && workspace.getCanvas();
    const matrix = canvas && canvas.getScreenCTM && canvas.getScreenCTM();
    if (!matrix || !coordinate || !Number.isFinite(coordinate.x) || !Number.isFinite(coordinate.y)) return null;
    return {
        x: (matrix.a * coordinate.x) + (matrix.c * coordinate.y) + matrix.e,
        y: (matrix.b * coordinate.x) + (matrix.d * coordinate.y) + matrix.f
    };
};

const createProjectTargetOperationDriver = ({workspace, vm, documentObject, clock, pointer, scope}) => ({
    cleanup: () => false,
    play: async (plan, signal = null) => {
        const travels = {};
        if (plan.kind === 'sprite-reorder-drag') {
            const movedTarget = runtimeTargetFor(vm, plan.movedTargetRef);
            const destinationTarget = vm.runtime.targets && vm.runtime.targets[plan.newIndex];
            if (!movedTarget || !destinationTarget || destinationTarget === movedTarget) {
                throw new Error('Sprite reorder targets are unavailable');
            }
            const sourceLocator = () => spriteElement(documentObject, plan.movedTargetRef);
            const destinationReference = {name: targetName(destinationTarget), isStage: false};
            const destinationLocator = () => spriteElement(documentObject, destinationReference);
            const source = await waitFor(sourceLocator, documentObject, signal);
            const destination = await waitFor(destinationLocator, documentObject, signal);
            if (!visibleBounds(source) || !visibleBounds(destination)) {
                throw new Error('Sprite reorder controls are not visible');
            }
            const sourceTravel = await pointer.travelTo(createElementPointerTarget({
                id: `sprite:${plan.movedTargetRef.name}`,
                kind: 'sprite-selector',
                locate: sourceLocator
            }), {clock, signal});
            rememberTravel(travels, 'source', sourceTravel);
            if (!sourceTravel.completed) {
                return {cancelled: true, pointerTravel: combinePointerTravels(travels)};
            }
            scope.runWithoutUndo(() => source.dispatchEvent(mouseEvent(
                documentObject, 'mousedown', sourceTravel.target.point
            )));
            if (typeof pointer.press === 'function') pointer.press();
            let pointerPressed = true;
            try {
                const destinationTravel = await pointer.travelTo(createElementPointerTarget({
                    id: `sprite:${destinationReference.name}`,
                    kind: 'sprite-reorder-destination',
                    locate: destinationLocator
                }), {
                    clock,
                    signal,
                    onFrame: point => scope.runWithoutUndo(() => documentObject.dispatchEvent(
                        mouseEvent(documentObject, 'mousemove', point)
                    ))
                });
                rememberTravel(travels, 'destination', destinationTravel);
                if (!destinationTravel.completed) {
                    return {cancelled: true, pointerTravel: combinePointerTravels(travels)};
                }
                scope.runWithoutUndo(() => {
                    hoverAt(documentObject, destination, destinationTravel.target.point);
                    documentObject.dispatchEvent(mouseEvent(
                        documentObject, 'mouseup', destinationTravel.target.point, 0
                    ));
                });
                if (typeof pointer.release === 'function') pointer.release();
                pointerPressed = false;
                const settled = await waitFor(
                    () => vm.runtime.targets[plan.newIndex] === movedTarget,
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

        if (plan.kind === 'backpack-script-drag') {
            const selectedTarget = await selectReferencedTarget({
                vm,
                reference: plan.targetRef,
                documentObject,
                pointer,
                clock,
                scope,
                signal,
                travels,
                travelKey: 'target'
            });
            if (!selectedTarget) return {cancelled: true, pointerTravel: combinePointerTravels(travels)};
            const itemTargetId = `backpack-item:script:${plan.backpackItem.id}`;
            const existingItem = studioTargetElement(documentObject, itemTargetId);
            const item = visibleBounds(existingItem) ? existingItem : await (async () => {
                const toggleLocator = () => studioTargetElement(documentObject, 'backpack-toggle');
                const toggle = await waitFor(toggleLocator, documentObject, signal);
                if (!visibleBounds(toggle)) {
                    return null;
                }
                const backpackTravel = rememberTravel(travels, 'backpack', await pointer.travelTo(
                    createElementPointerTarget({
                        id: 'backpack-toggle',
                        kind: 'backpack-toggle',
                        locate: toggleLocator
                    }), {clock, signal}
                ));
                if (!backpackTravel.completed) return null;
                const clicked = await activateThroughPointer({
                    pointer,
                    clock,
                    signal,
                    activate: () => scope.runWithoutUndo(() => dispatchMouseSelection(
                        toggle, backpackTravel.target.point
                    ))
                });
                if (!clicked) return null;
                return waitFor(
                    () => studioTargetElement(documentObject, itemTargetId),
                    documentObject,
                    signal,
                    120
                );
            })();
            if (!visibleBounds(item)) {
                return {unsupported: true, reason: 'Recorded Backpack script is unavailable'};
            }
            const destinationElement = workspace.getInjectionDiv && workspace.getInjectionDiv();
            const destinationPoint = workspacePoint(workspace, plan.destination.coordinate);
            if (!visibleBounds(destinationElement) || !destinationPoint) {
                throw new Error('Backpack script destination is unavailable');
            }
            const destinationBounds = destinationElement.getBoundingClientRect();
            const beforeTargetCount = blockCount(selectedTarget);
            const sourceTravel = rememberTravel(travels, 'source', await pointer.travelTo(createElementPointerTarget({
                id: itemTargetId,
                kind: 'backpack-script',
                locate: () => studioTargetElement(documentObject, itemTargetId)
            }), {clock, signal}));
            if (!sourceTravel.completed) {
                return {cancelled: true, pointerTravel: combinePointerTravels(travels)};
            }
            scope.runWithoutUndo(() => item.dispatchEvent(mouseEvent(
                documentObject, 'mousedown', sourceTravel.target.point
            )));
            if (typeof pointer.press === 'function') pointer.press();
            let pointerPressed = true;
            try {
                const destinationTravel = rememberTravel(
                    travels,
                    'destination',
                    await pointer.travelTo(createElementPointerTarget({
                        id: 'block-workspace-import',
                        kind: 'block-workspace',
                        locate: () => workspace.getInjectionDiv(),
                        anchorX: destinationPoint.x - destinationBounds.left,
                        anchorY: destinationPoint.y - destinationBounds.top
                    }), {
                        clock,
                        signal,
                        onFrame: point => scope.runWithoutUndo(() => documentObject.defaultView.dispatchEvent(
                            mouseEvent(documentObject, 'mousemove', point)
                        ))
                    })
                );
                if (!destinationTravel.completed) {
                    return {cancelled: true, pointerTravel: combinePointerTravels(travels)};
                }
                scope.runWithoutUndo(() => {
                    hoverAt(documentObject, destinationElement, destinationTravel.target.point);
                    documentObject.defaultView.dispatchEvent(mouseEvent(
                        documentObject, 'mousemove', destinationTravel.target.point
                    ));
                    documentObject.defaultView.dispatchEvent(mouseEvent(
                        documentObject, 'mouseup', destinationTravel.target.point, 0
                    ));
                });
                if (typeof pointer.release === 'function') pointer.release();
                pointerPressed = false;
                const settled = await waitFor(() => (
                    blockCount(selectedTarget) === beforeTargetCount + plan.copiedBlockCount
                ), documentObject, signal, 360);
                return {
                    frames: [],
                    pointerTravel: combinePointerTravels(travels),
                    controlsVisible: true,
                    targetBlockCount: blockCount(selectedTarget),
                    projectMatches: Boolean(settled)
                };
            } finally {
                if (pointerPressed && typeof pointer.release === 'function') pointer.release();
            }
        }

        if (plan.kind !== 'cross-sprite-script-drag') {
            throw new Error(`Unsupported project target operation: ${plan.kind}`);
        }
        const sourceTarget = await selectReferencedTarget({
            vm,
            reference: plan.sourceTargetRef,
            documentObject,
            pointer,
            clock,
            scope,
            signal,
            travels,
            travelKey: 'sourceTarget'
        });
        if (!sourceTarget) return {cancelled: true, pointerTravel: combinePointerTravels(travels)};
        const target = runtimeTargetFor(vm, plan.targetRef);
        if (!target) throw new Error(`Destination sprite is unavailable: ${plan.targetRef.name}`);
        const destinationLocator = () => spriteElement(documentObject, plan.targetRef);
        const destination = await waitFor(destinationLocator, documentObject, signal);
        if (!visibleBounds(destination)) throw new Error('Destination sprite selector is not visible');
        const sourceBlockId = resolveWorkspaceBlockId(workspace, plan.sourceBlockRef, null);
        const sourceBlock = sourceBlockId && workspace.getBlockById(sourceBlockId);
        if (!sourceBlock || !sourceBlock.getSvgRoot) throw new Error('Source script is unavailable');
        const grab = plan.presentation.grabOffset;
        const sourceLocator = () => sourceBlock.getSvgRoot();
        const sourceTravel = await pointer.travelTo(createElementPointerTarget({
            id: `workspace-block:${sourceBlock.id}`,
            kind: 'workspace-block',
            locate: sourceLocator,
            anchorX: grab.x,
            anchorY: grab.y
        }), {clock, signal});
        rememberTravel(travels, 'source', sourceTravel);
        if (!sourceTravel.completed) {
            return {cancelled: true, pointerTravel: combinePointerTravels(travels)};
        }
        if (workspace.currentGesture_) throw new Error('Cannot copy a script during an active Blockly gesture');
        const injectionDiv = workspace.getInjectionDiv();
        const startEvent = blocklyEvent('mousedown', sourceTravel.target.point, injectionDiv);
        const gesture = workspace.getGesture(startEvent);
        if (!gesture) throw new Error('Scratch Blocks refused the script-copy gesture');
        const beforeSourceCount = blockCount(sourceTarget);
        const beforeTargetCount = blockCount(target);
        const frames = [];
        scope.runWithoutUndo(() => gesture.forceStartBlockDrag(startEvent, sourceBlock));
        sourceBlock.getSvgRoot().setAttribute('data-studio-share-actor', 'true');
        if (typeof pointer.press === 'function') pointer.press();
        let pointerPressed = true;
        let finished = false;
        let hoveredPoint = null;
        try {
            const destinationTravel = await pointer.travelTo(createElementPointerTarget({
                id: `sprite:${plan.targetRef.name}`,
                kind: 'script-copy-destination',
                locate: destinationLocator
            }), {
                clock,
                signal,
                onFrame: point => scope.runWithoutUndo(() => {
                    gesture.handleMove(blocklyEvent('mousemove', point, injectionDiv));
                    const root = sourceBlock.getSvgRoot();
                    const bounds = root.getBoundingClientRect();
                    frames.push({x: bounds.left,
                        y: bounds.top,
                        width: bounds.width,
                        height: bounds.height,
                        pointer: point});
                })
            });
            rememberTravel(travels, 'destination', destinationTravel);
            if (!destinationTravel.completed) {
                return {cancelled: true, pointerTravel: combinePointerTravels(travels)};
            }
            // Let the real sprite-card hover feedback paint while the stack is
            // still held. A mouseover and mouseup in the same turn makes the
            // actual copy destination invisible, especially at faster speeds.
            hoveredPoint = destinationTravel.target.point;
            scope.runWithoutUndo(() => hoverAt(documentObject, destination, hoveredPoint));
            const held = await clock.play({
                points: [destinationTravel.target.point],
                holdFrames: 8,
                signal,
                onFrame: () => {}
            });
            if (!held) return {cancelled: true, pointerTravel: combinePointerTravels(travels)};
            scope.runWithoutUndo(() => {
                gesture.handleMove(blocklyEvent('mousemove', destinationTravel.target.point, injectionDiv));
                gesture.handleUp(blocklyEvent('mouseup', destinationTravel.target.point, injectionDiv));
            });
            if (typeof pointer.release === 'function') pointer.release();
            pointerPressed = false;
            finished = true;
            const settled = await waitFor(() => (
                blockCount(sourceTarget) === beforeSourceCount &&
                blockCount(target) === beforeTargetCount + plan.copiedBlockCount
            ), documentObject, signal, 360);
            return {
                frames,
                pointerTravel: combinePointerTravels(travels),
                controlsVisible: true,
                sourceBlockId,
                sourceBlockCount: blockCount(sourceTarget),
                targetBlockCount: blockCount(target),
                projectMatches: Boolean(settled)
            };
        } finally {
            if (hoveredPoint) {
                scope.runWithoutUndo(() => destination.dispatchEvent(mouseEvent(
                    documentObject, 'mouseout', hoveredPoint, 0
                )));
            }
            sourceBlock.getSvgRoot()?.removeAttribute('data-studio-share-actor');
            if (pointerPressed && typeof pointer.release === 'function') pointer.release();
            if (!finished && workspace.currentGesture_ === gesture) scope.runWithoutUndo(() => gesture.cancel());
        }
    }
});

export {createProjectTargetOperationDriver};
