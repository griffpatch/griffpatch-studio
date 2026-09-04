import {
    combinePointerTravels,
    dispatchMouseSelection,
    replaceInputValue,
    typeInputText
} from './dom-interaction';
import {activateThroughPointer} from './pointer-activation';
import {createElementPointerTarget} from './pointer-target';
import {selectScratchTargetThroughPointer} from './scratch-target-selection-driver';
import {normalizePaintBrushStyle, samePaintBrushStyle} from '../paint-brush-style';

const TARGET_ATTRIBUTE = 'data-studio-target';
const FRAME_MS = 1000 / 60;

const escapedAttributeValue = value => String(value)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"');
const studioTarget = (documentObject, value) => documentObject.querySelector(
    `[${TARGET_ATTRIBUTE}="${escapedAttributeValue(value)}"]`
);
const parsedBrushStyle = (documentObject, editFormat) => {
    const root = studioTarget(documentObject, 'costume-editor');
    const value = root && root.getAttribute('data-studio-brush-style');
    if (!value) return null;
    try {
        return normalizePaintBrushStyle(JSON.parse(value), editFormat);
    } catch (error) {
        return null;
    }
};
const targetName = target => target && (target.getName ? target.getName() :
    target.sprite && target.sprite.name);
const costumeReference = costume => costume && ({
    assetId: costume.assetId,
    dataFormat: costume.dataFormat,
    name: costume.name
});
const sameCostume = (actual, expected) => Boolean(actual && expected &&
    actual.assetId === expected.assetId && actual.dataFormat === expected.dataFormat &&
    actual.name === expected.name);
const byteView = value => {
    if (value instanceof Uint8Array) return value;
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (value && value.buffer instanceof ArrayBuffer) {
        return new Uint8Array(value.buffer, value.byteOffset || 0, value.byteLength);
    }
    return null;
};
const sameBytes = (left, right) => {
    const leftBytes = byteView(left);
    const rightBytes = byteView(right);
    if (!leftBytes || !rightBytes || leftBytes.byteLength !== rightBytes.byteLength) return false;
    for (let index = 0; index < leftBytes.byteLength; index += 1) {
        if (leftBytes[index] !== rightBytes[index]) return false;
    }
    return true;
};
const decodedBitmap = (documentObject, bytes) => new Promise((resolve, reject) => {
    const view = documentObject.defaultView;
    const source = byteView(bytes);
    if (!source || !view.Blob || !view.URL || !view.Image || !documentObject.createElement) {
        reject(new Error('Bitmap decoding is unavailable'));
        return;
    }
    const url = view.URL.createObjectURL(new view.Blob([source], {type: 'image/png'}));
    const image = new view.Image();
    image.onload = () => {
        try {
            const canvas = documentObject.createElement('canvas');
            canvas.width = image.naturalWidth || image.width;
            canvas.height = image.naturalHeight || image.height;
            const context = canvas.getContext('2d');
            context.drawImage(image, 0, 0);
            resolve({
                width: canvas.width,
                height: canvas.height,
                pixels: context.getImageData(0, 0, canvas.width, canvas.height).data
            });
        } catch (error) {
            reject(error);
        } finally {
            view.URL.revokeObjectURL(url);
        }
    };
    image.onerror = () => {
        view.URL.revokeObjectURL(url);
        reject(new Error('Bitmap decoding failed'));
    };
    image.src = url;
});
const sameBitmapPixels = async (documentObject, actualBytes, expectedBytes) => {
    if (sameBytes(actualBytes, expectedBytes)) return true;
    try {
        const [actual, expected] = await Promise.all([
            decodedBitmap(documentObject, actualBytes),
            decodedBitmap(documentObject, expectedBytes)
        ]);
        return actual.width === expected.width && actual.height === expected.height &&
            sameBytes(actual.pixels, expected.pixels);
    } catch (error) {
        return false;
    }
};
const visibleBounds = element => {
    const rect = element && element.getBoundingClientRect && element.getBoundingClientRect();
    return Boolean(rect && rect.width > 0 && rect.height > 0);
};
const waitFor = async (locate, documentObject, signal, frameLimit = 360) => {
    for (let frame = 0; frame < frameLimit; frame += 1) {
        const value = locate();
        if (value) return value;
        if (signal && signal.aborted) return null;
        await new Promise(resolve => documentObject.defaultView.requestAnimationFrame(resolve));
    }
    return null;
};
const observeVmInvocation = (vm, methodName) => {
    const previous = vm[methodName];
    if (typeof previous !== 'function') throw new Error(`VM paint method is unavailable: ${methodName}`);
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
const mouseEvent = (documentObject, type, point, buttons) => new documentObject.defaultView.MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    view: documentObject.defaultView,
    button: 0,
    buttons,
    clientX: point.x,
    clientY: point.y
});
const timedGestureFrames = points => {
    if (!points.length) return [];
    const frames = [{x: points[0].x, y: points[0].y, dispatchMouse: false}];
    for (let pointIndex = 1; pointIndex < points.length; pointIndex += 1) {
        const from = points[pointIndex - 1];
        const to = points[pointIndex];
        const frameCount = Math.max(1, Math.round((to.t - from.t) / FRAME_MS));
        for (let frame = 1; frame <= frameCount; frame += 1) {
            const progress = frame / frameCount;
            frames.push({
                x: from.x + ((to.x - from.x) * progress),
                y: from.y + ((to.y - from.y) * progress),
                // Interpolated frames animate the overlay only. Sending them
                // into Paper.js would alter the authored vector geometry.
                dispatchMouse: frame === frameCount && pointIndex < points.length - 1
            });
        }
    }
    return frames;
};
const clickThroughPointer = async ({pointer, clock, signal, scope, id, kind, locate}) => {
    const travel = await pointer.travelTo(createElementPointerTarget({id, kind, locate}), {clock, signal});
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

const inputPoint = input => {
    const rect = input.getBoundingClientRect();
    return {x: rect.left + (rect.width / 2), y: rect.top + (rect.height / 2)};
};

const typePaintInput = async ({
    documentObject,
    clock,
    pointer,
    scope,
    signal,
    target,
    value
}) => {
    const point = inputPoint(target);
    const activated = await activateThroughPointer({
        pointer,
        clock,
        signal,
        activate: () => scope.runWithoutUndo(() => dispatchMouseSelection(target, point))
    });
    if (!activated) return false;
    // Synthetic pointer events do not perform the browser's default focus
    // action, but Scratch Paint's buffered fields only flush on a real blur.
    if (typeof target.focus === 'function') target.focus();
    const typed = await typeInputText({
        input: target,
        value: String(value),
        clock,
        signal,
        point,
        pointer,
        framesPerCharacter: 3,
        replaceValue: (input, nextValue, character) => scope.runWithoutUndo(() => (
            replaceInputValue(input, nextValue, character)
        ))
    });
    if (!typed.completed) return false;
    // Buffered Scratch Paint inputs commit their React state on blur. Give
    // the final synthetic input event one paint before asking that buffer to
    // flush, otherwise the last typed value can still be stale.
    await new Promise(resolve => documentObject.defaultView.requestAnimationFrame(resolve));
    scope.runWithoutUndo(() => target.blur());
    await new Promise(resolve => documentObject.defaultView.requestAnimationFrame(resolve));
    return true;
};

const setNumberControl = async ({
    documentObject,
    clock,
    pointer,
    scope,
    signal,
    travels,
    targetId,
    value,
    matches
}) => {
    if (matches()) return true;
    const locate = () => studioTarget(documentObject, targetId);
    const input = await waitFor(locate, documentObject, signal);
    if (!visibleBounds(input)) return false;
    const travel = await pointer.travelTo(createElementPointerTarget({
        id: targetId,
        kind: 'paint-setting',
        locate
    }), {clock, signal});
    travels[targetId] = travel;
    if (!travel.completed) return false;
    if (!await typePaintInput({
        documentObject,
        clock,
        pointer,
        scope,
        signal,
        target: input,
        value
    })) return false;
    return Boolean(await waitFor(matches, documentObject, signal, 120));
};

const setColorControl = async ({
    documentObject,
    clock,
    pointer,
    scope,
    signal,
    travels,
    targetId,
    value,
    matches
}) => {
    if (matches()) return true;
    const buttonLocator = () => studioTarget(documentObject, targetId);
    const button = await waitFor(buttonLocator, documentObject, signal);
    if (!visibleBounds(button)) return false;
    const opened = await clickThroughPointer({
        pointer,
        clock,
        signal,
        scope,
        id: targetId,
        kind: 'paint-color',
        locate: buttonLocator
    });
    travels[targetId] = opened;
    if (!opened.completed) return false;

    const hexLocator = () => studioTarget(documentObject, 'paint-color-hex-input');
    const input = await waitFor(hexLocator, documentObject, signal);
    if (!visibleBounds(input)) return false;
    const travel = await pointer.travelTo(createElementPointerTarget({
        id: `${targetId}:hex`,
        kind: 'paint-color-input',
        locate: hexLocator
    }), {clock, signal});
    travels[`${targetId}:value`] = travel;
    if (!travel.completed) return false;
    if (!await typePaintInput({
        documentObject,
        clock,
        pointer,
        scope,
        signal,
        target: input,
        value
    })) return false;
    return Boolean(await waitFor(matches, documentObject, signal, 120));
};

const applyBrushStyle = async ({
    plan,
    documentObject,
    clock,
    pointer,
    scope,
    signal,
    travels
}) => {
    if (!plan.paintGesture.brushStyle) return true;
    const expected = normalizePaintBrushStyle(plan.paintGesture.brushStyle, plan.editFormat);
    if (!expected) return false;
    const current = () => parsedBrushStyle(documentObject, plan.editFormat);
    const fieldMatches = (field, value) => () => {
        const actual = current();
        if (!actual) return false;
        if (typeof value === 'string') return String(actual[field]).toLowerCase() === value.toLowerCase();
        return actual[field] === value;
    };
    if (samePaintBrushStyle(current(), expected, plan.editFormat)) return true;
    if (!await setNumberControl({
        documentObject,
        clock,
        pointer,
        scope,
        signal,
        travels,
        targetId: 'paint-brush-size',
        value: expected.brushSize,
        matches: fieldMatches('brushSize', expected.brushSize)
    })) return false;
    if (!await setColorControl({
        documentObject,
        clock,
        pointer,
        scope,
        signal,
        travels,
        targetId: 'paint-fill-color',
        value: expected.fillColor,
        matches: fieldMatches('fillColor', expected.fillColor)
    })) return false;
    return samePaintBrushStyle(current(), expected, plan.editFormat);
};

const projectEvidence = async ({
    plan,
    expectedTarget,
    checkpointPort,
    documentObject
}) => {
    const actualCostumeObject = expectedTarget.getCostumes()[plan.costumeIndex];
    const actualCostume = costumeReference(actualCostumeObject);
    let bitmapVisualMatches = false;
    if (plan.editFormat === 'bitmap' && checkpointPort && plan.editedCheckpointId &&
        actualCostumeObject && actualCostumeObject.asset && actualCostumeObject.asset.data) {
        const md5ext = `${plan.editedCostume.assetId}.${plan.editedCostume.dataFormat}`;
        try {
            const expectedBytes = await checkpointPort.readAsset(plan.editedCheckpointId, md5ext);
            bitmapVisualMatches = await sameBitmapPixels(
                documentObject,
                actualCostumeObject.asset.data,
                expectedBytes
            );
        } catch (error) { // eslint-disable-line no-empty
            // Exact asset identity below remains the conservative fallback.
        }
    }
    return {
        actualCostume,
        bitmapVisualMatches,
        projectMatches: bitmapVisualMatches || sameCostume(actualCostume, plan.editedCostume)
    };
};

const createPaintGestureDriver = ({
    vm, documentObject, clock, pointer, scope, checkpointPort = null, afterTargetSelection = null
}) => ({
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
        if (tab.getAttribute('aria-selected') !== 'true') {
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

        const costumes = expectedTarget.getCostumes();
        const sourceCostume = costumes && costumes[plan.costumeIndex];
        if (!sameCostume(costumeReference(sourceCostume), plan.previousCostume)) {
            throw new Error(`Recorded ${plan.assetKind} is unavailable at index ${plan.costumeIndex}`);
        }
        if (expectedTarget.currentCostume !== plan.costumeIndex) {
            const assetId = `${plan.assetKind}-item:${plan.costumeIndex}:${plan.previousCostume.assetId}`;
            const assetLocator = () => studioTarget(documentObject, assetId);
            const asset = await waitFor(assetLocator, documentObject, signal);
            if (!visibleBounds(asset)) throw new Error(`Recorded asset control is unavailable: ${assetId}`);
            travels.asset = await clickThroughPointer({
                pointer,
                clock,
                signal,
                scope,
                id: assetId,
                kind: `${plan.assetKind}-item`,
                locate: assetLocator
            });
            if (!travels.asset.completed) {
                return {cancelled: true, pointerTravel: combinePointerTravels(travels)};
            }
            const selected = await waitFor(
                () => expectedTarget.currentCostume === plan.costumeIndex,
                documentObject,
                signal
            );
            if (!selected) throw new Error(`Recorded ${plan.assetKind} selection did not settle`);
        }

        const conversion = /^(?:costume|backdrop)-convert-to-(bitmap|vector)$/.exec(plan.kind);
        if (conversion) {
            const destination = conversion[1];
            const expectedEditFormat = destination === 'bitmap' ? 'bitmap' : 'svg';
            if (expectedEditFormat !== plan.editFormat) {
                throw new Error('Paint conversion plan has inconsistent destination format');
            }
            const targetId = `paint-convert-to-${destination}`;
            const controlLocator = () => studioTarget(documentObject, targetId);
            const control = await waitFor(controlLocator, documentObject, signal);
            if (!visibleBounds(control)) throw new Error(`Paint conversion control is unavailable: ${targetId}`);
            const methodName = destination === 'bitmap' ? 'updateBitmap' : 'updateSvg';
            const invocation = observeVmInvocation(vm, methodName);
            try {
                travels.conversion = await clickThroughPointer({
                    pointer,
                    clock,
                    signal,
                    scope,
                    id: targetId,
                    kind: 'paint-conversion',
                    locate: controlLocator
                });
                if (!travels.conversion.completed) {
                    return {cancelled: true, pointerTravel: combinePointerTravels(travels)};
                }
                const observation = await waitFor(invocation.observation, documentObject, signal);
                if (!observation || observation.args[0] !== plan.costumeIndex) {
                    throw new Error(`Paint conversion did not invoke the expected ${methodName}`);
                }
                await observation.completion;
                const settled = await waitFor(() => {
                    const current = expectedTarget.getCostumes()[plan.costumeIndex];
                    return current && current.dataFormat === plan.editedCostume.dataFormat &&
                        current.assetId !== plan.previousCostume.assetId ? current : null;
                }, documentObject, signal, 360);
                if (!settled) throw new Error(`Paint conversion to ${destination} did not settle`);
            } finally {
                invocation.restore();
            }
            const evidence = await projectEvidence({
                plan,
                expectedTarget,
                checkpointPort,
                documentObject
            });
            return {
                frames: [],
                pointerTravel: combinePointerTravels(travels),
                controlsVisible: true,
                brushStyleMatches: true,
                ...evidence
            };
        }

        const brushLocator = () => studioTarget(documentObject, 'paint-brush-tool');
        const brush = await waitFor(brushLocator, documentObject, signal);
        if (!visibleBounds(brush)) throw new Error('Paint brush control is unavailable');
        if (brush.getAttribute('data-studio-selected') !== 'true') {
            travels.brush = await clickThroughPointer({
                pointer,
                clock,
                signal,
                scope,
                id: 'paint-brush-tool',
                kind: 'paint-tool',
                locate: brushLocator
            });
            if (!travels.brush.completed) {
                return {cancelled: true, pointerTravel: combinePointerTravels(travels)};
            }
            const selected = await waitFor(
                () => brushLocator() && brushLocator().getAttribute('data-studio-selected') === 'true',
                documentObject,
                signal
            );
            if (!selected) throw new Error('Paint brush tool did not become active');
        }

        if (!await applyBrushStyle({
            plan,
            documentObject,
            clock,
            pointer,
            scope,
            signal,
            travels
        })) {
            throw new Error('Recorded paint brush style could not be reproduced through Scratch Paint');
        }

        const canvasLocator = () => studioTarget(documentObject, 'paint-canvas');
        const canvas = await waitFor(canvasLocator, documentObject, signal);
        if (!visibleBounds(canvas)) throw new Error('Paint canvas is unavailable');
        const rect = canvas.getBoundingClientRect();
        const normalizedFrames = timedGestureFrames(plan.paintGesture.points);
        const frames = normalizedFrames.map(point => ({
            x: rect.left + (point.x * rect.width),
            y: rect.top + (point.y * rect.height),
            dispatchMouse: point.dispatchMouse
        }));
        if (frames.length < 2) throw new Error('Recorded paint stroke has no drawable path');
        const first = frames[0];
        travels.canvas = await pointer.travelTo(createElementPointerTarget({
            id: 'paint-canvas:start',
            kind: 'paint-canvas-point',
            locate: canvasLocator,
            anchorX: first.x - rect.left,
            anchorY: first.y - rect.top
        }), {clock, signal});
        if (!travels.canvas.completed) {
            return {cancelled: true, pointerTravel: combinePointerTravels(travels)};
        }

        const methodName = plan.editFormat === 'bitmap' ? 'updateBitmap' : 'updateSvg';
        const invocation = observeVmInvocation(vm, methodName);
        let pointerPressed = false;
        let released = false;
        let lastPoint = first;
        try {
            if (typeof pointer.press === 'function') pointer.press();
            pointerPressed = true;
            scope.runWithoutUndo(() => canvas.dispatchEvent(mouseEvent(documentObject, 'mousedown', first, 1)));
            const completed = await clock.play({
                points: frames.slice(1),
                signal,
                onFrame: point => {
                    lastPoint = point;
                    pointer.moveTo(point);
                    if (point.dispatchMouse) {
                        scope.runWithoutUndo(() => canvas.dispatchEvent(
                            mouseEvent(documentObject, 'mousemove', point, 1)
                        ));
                    }
                }
            });
            scope.runWithoutUndo(() => canvas.dispatchEvent(mouseEvent(documentObject, 'mouseup', lastPoint, 0)));
            released = true;
            if (typeof pointer.release === 'function') pointer.release();
            pointerPressed = false;
            if (!completed) {
                return {cancelled: true, pointerTravel: combinePointerTravels(travels)};
            }
            const observation = await waitFor(invocation.observation, documentObject, signal);
            if (!observation || observation.args[0] !== plan.costumeIndex) {
                throw new Error(`Paint stroke did not invoke the expected ${plan.editFormat} update`);
            }
            await observation.completion;
            if (plan.editFormat === 'bitmap') {
                const settled = await waitFor(() => {
                    const current = expectedTarget.getCostumes()[plan.costumeIndex];
                    return current && current.assetId !== plan.previousCostume.assetId ? current : null;
                }, documentObject, signal, 360);
                if (!settled) throw new Error('Bitmap paint stroke did not settle its asset update');
            }
        } finally {
            if (!released) {
                scope.runWithoutUndo(() => canvas.dispatchEvent(
                    mouseEvent(documentObject, 'mouseup', lastPoint, 0)
                ));
            }
            if (pointerPressed && typeof pointer.release === 'function') pointer.release();
            invocation.restore();
        }
        travels.stroke = {
            completed: true,
            model: 'recorded-paint-gesture',
            target: travels.canvas.target,
            frames
        };
        const evidence = await projectEvidence({
            plan,
            expectedTarget,
            checkpointPort,
            documentObject
        });
        return {
            frames: [],
            pointerTravel: combinePointerTravels(travels),
            controlsVisible: true,
            brushStyleMatches: !plan.paintGesture.brushStyle || samePaintBrushStyle(
                parsedBrushStyle(documentObject, plan.editFormat),
                plan.paintGesture.brushStyle,
                plan.editFormat
            ),
            ...evidence
        };
    }
});

export {createPaintGestureDriver, timedGestureFrames};
