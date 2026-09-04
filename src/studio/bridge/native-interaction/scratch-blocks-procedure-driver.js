import {
    combinePointerTravels,
    dispatchMouseSelection,
    typeInputText,
    withGeneratedIds
} from './dom-interaction';
import {createElementPointerTarget} from './pointer-target';
import {activateThroughPointer} from './pointer-activation';
import {categoryIsSelected, inputIsFocused, inputPoint} from './ui-state';

const TEXT_FRAMES_PER_CHARACTER = 5;
const TARGET_ATTRIBUTE = 'data-studio-target';

const waitFor = async (locate, documentObject, signal, frameLimit = 60) => {
    for (let frame = 0; frame < frameLimit; frame += 1) {
        const value = locate();
        if (value) return value;
        if (signal && signal.aborted) return null;
        await new Promise(resolve => documentObject.defaultView.requestAnimationFrame(resolve));
    }
    return null;
};

const waitForStableVisible = async (locate, documentObject, signal, frameLimit = 60) => {
    let previous = null;
    for (let frame = 0; frame < frameLimit; frame += 1) {
        const value = locate();
        const element = value && (value.svgGroup_ || value);
        const rect = element && element.getBoundingClientRect && element.getBoundingClientRect();
        const viewport = documentObject.documentElement || {};
        const right = rect && (typeof rect.right === 'number' ? rect.right : rect.left + rect.width);
        const bottom = rect && (typeof rect.bottom === 'number' ? rect.bottom : rect.top + rect.height);
        const visible = rect && rect.width > 0 && rect.height > 0 && right > 0 && bottom > 0 &&
            rect.left < (viewport.clientWidth || Infinity) && rect.top < (viewport.clientHeight || Infinity);
        const stable = visible && previous && Math.abs(rect.left - previous.left) < 0.5 &&
            Math.abs(rect.top - previous.top) < 0.5;
        if (stable) return value;
        previous = visible ? {left: rect.left, top: rect.top} : null;
        if (signal && signal.aborted) return null;
        await new Promise(resolve => documentObject.defaultView.requestAnimationFrame(resolve));
    }
    return null;
};

const target = (documentObject, id) => (
    documentObject.querySelector(`[${TARGET_ATTRIBUTE}="${id}"]`)
);

const categoryForId = (workspace, id) => {
    const toolbox = workspace.toolbox_;
    const categories = toolbox && toolbox.categoryMenu_ && toolbox.categoryMenu_.categories_;
    return categories && categories.find(category => category.id_ === id);
};

const flyoutButtonFor = (workspace, callbackKey) => {
    const flyout = workspace.getFlyout ? workspace.getFlyout() : workspace.toolbox_ && workspace.toolbox_.flyout_;
    const callback = workspace.getButtonCallback && workspace.getButtonCallback(callbackKey);
    return flyout && callback && flyout.buttons_.find(button => button.callback_ === callback);
};

const clickThroughPointer = async ({
    pointer,
    clock,
    signal,
    scope,
    id,
    kind,
    locate,
    activate = dispatchMouseSelection
}) => {
    const travel = await pointer.travelTo(createElementPointerTarget({id, kind, locate}), {clock, signal});
    if (travel.completed) {
        const completed = await activateThroughPointer({
            pointer,
            clock,
            signal,
            activate: () => scope.runWithoutUndo(() => activate(travel.target.element, travel.target.point))
        });
        return {...travel, completed};
    }
    return travel;
};

const jsonAttribute = (mutation, name) => {
    try {
        return JSON.parse(mutation.getAttribute(name) || '[]');
    } catch (error) {
        throw new Error(`Custom procedure mutation has invalid ${name}: ${error.message}`);
    }
};

const parseProcedureDefinition = (ScratchBlocks, plan) => {
    const root = ScratchBlocks.Xml.textToDom(plan.xml);
    const mutations = root.getElementsByTagName('mutation');
    const mutation = mutations && mutations[0];
    if (!mutation) throw new Error('Custom procedure definition has no mutation');
    const proccode = mutation.getAttribute('proccode') || '';
    const argumentIds = jsonAttribute(mutation, 'argumentids');
    const argumentNames = jsonAttribute(mutation, 'argumentnames');
    const argumentDefaults = jsonAttribute(mutation, 'argumentdefaults');
    const parts = [];
    const tokenPattern = /%([sb])/g;
    let cursor = 0;
    let argumentIndex = 0;
    let match;
    while ((match = tokenPattern.exec(proccode))) {
        const label = proccode.slice(cursor, match.index).trim();
        if (label) parts.push({kind: 'label', value: label});
        parts.push({
            kind: match[1] === 'b' ? 'boolean' : 'text-number',
            id: argumentIds[argumentIndex],
            value: argumentNames[argumentIndex],
            defaultValue: argumentDefaults[argumentIndex]
        });
        argumentIndex += 1;
        cursor = tokenPattern.lastIndex;
    }
    const finalLabel = proccode.slice(cursor).trim();
    if (finalLabel) parts.push({kind: 'label', value: finalLabel});
    if (!parts.length || parts[0].kind !== 'label' || argumentIndex !== argumentIds.length ||
        argumentIds.length !== argumentNames.length || argumentIds.length !== argumentDefaults.length ||
        parts.some(part => typeof part.value !== 'string' || (part.kind !== 'label' && !part.id)) ||
        plan.blockIds.length !== argumentIds.length + 2) {
        throw new Error('Custom procedure mutation shape is unsupported');
    }
    return {
        proccode,
        argumentIds,
        argumentNames,
        argumentDefaults,
        warp: mutation.getAttribute('warp') === 'true',
        parts
    };
};

const activeEditor = documentObject => {
    const editor = documentObject.querySelector('.blocklyHtmlInput');
    if (!editor || !editor.getBoundingClientRect) return null;
    const bounds = editor.getBoundingClientRect();
    return bounds.width > 0 && bounds.height > 0 ? editor : null;
};

const waitPaintFrames = async (documentObject, count = 2) => {
    for (let frame = 0; frame < count; frame += 1) {
        await new Promise(resolve => documentObject.defaultView.requestAnimationFrame(resolve));
    }
};

const settleDefinitionCoordinate = (workspace, plan) => {
    const expected = plan.destination && !plan.destination.parentId && plan.destination.coordinate;
    const block = expected && workspace.getBlockById(plan.blockId);
    if (!block) return null;
    if (typeof block.getRelativeToSurfaceXY !== 'function' || typeof block.moveBy !== 'function') {
        throw new Error('Custom procedure definition cannot be positioned in workspace coordinates');
    }
    const before = block.getRelativeToSurfaceXY();
    if (!before || !Number.isFinite(before.x) || !Number.isFinite(before.y)) {
        throw new Error('Custom procedure definition has no workspace coordinate');
    }
    const delta = {x: expected.x - before.x, y: expected.y - before.y};
    const adjusted = Math.abs(delta.x) >= 0.01 || Math.abs(delta.y) >= 0.01;
    if (adjusted) block.moveBy(delta.x, delta.y);
    const after = block.getRelativeToSurfaceXY();
    return {before, expected, delta, adjusted, after};
};

const createScratchBlocksProcedureDriver = ({
    workspace,
    ScratchBlocks,
    documentObject,
    clock,
    pointer,
    scope
}) => ({
    cleanup: () => {
        const cancel = target(documentObject, 'custom-procedure-cancel');
        if (!cancel) return false;
        const bounds = cancel.getBoundingClientRect();
        scope.runWithoutUndo(() => dispatchMouseSelection(cancel, {
            x: bounds.left + (bounds.width / 2),
            y: bounds.top + (bounds.height / 2)
        }));
        return true;
    },
    play: async (plan, signal = null) => {
        const definition = parseProcedureDefinition(ScratchBlocks, plan);
        const travels = {};
        const typedValues = [];
        let immediatePlacement = null;
        const category = categoryForId(workspace, 'myBlocks');
        if (!category || !category.item_) throw new Error('My Blocks category target is unavailable');
        if (!categoryIsSelected(workspace, 'myBlocks')) {
            travels.category = await clickThroughPointer({
                pointer,
                clock,
                signal,
                scope,
                id: 'toolbox-category:myBlocks',
                kind: 'toolbox-category',
                locate: () => category.item_
            });
            if (!travels.category.completed) {
                return {cancelled: true, frames: [], pointerTravel: combinePointerTravels(travels)};
            }
        }

        const button = await waitForStableVisible(
            () => flyoutButtonFor(workspace, 'CREATE_PROCEDURE'), documentObject, signal
        );
        if (!button || !button.svgGroup_) throw new Error('Make a Block flyout button is unavailable');
        travels.button = await clickThroughPointer({
            pointer,
            clock,
            signal,
            scope,
            id: 'flyout-button:CREATE_PROCEDURE',
            kind: 'flyout-button',
            locate: () => button.svgGroup_
        });
        if (!travels.button.completed) {
            return {cancelled: true, frames: [], pointerTravel: combinePointerTravels(travels)};
        }

        // ReactModal does not forward arbitrary IDs to its rendered content in
        // every supported GUI version. A Studio target on an actual modal
        // control is both a stronger readiness signal and the element we will
        // interact with later.
        const modalControl = await waitFor(
            () => target(documentObject, 'custom-procedure-ok'), documentObject, signal
        );
        const initialEditor = await waitFor(() => activeEditor(documentObject), documentObject, signal);
        if (!modalControl || !initialEditor) throw new Error('Custom procedure dialog did not open');
        const modalControlBounds = modalControl.getBoundingClientRect();
        const dialogVisibleBeforeSubmit = modalControlBounds.width > 0 && modalControlBounds.height > 0;
        const editors = [initialEditor];

        for (let index = 0; index < definition.parts.length; index += 1) {
            const part = definition.parts[index];
            if (index > 0) {
                const targetId = part.kind === 'label' ? 'custom-procedure-add-label' :
                    (part.kind === 'boolean' ? 'custom-procedure-add-boolean' :
                        'custom-procedure-add-text-number');
                const previousEditor = editors[index - 1];
                travels[`part${index}Button`] = await clickThroughPointer({
                    pointer,
                    clock,
                    signal,
                    scope,
                    id: targetId,
                    kind: 'dialog-option',
                    locate: () => target(documentObject, targetId),
                    activate: (element, point) => {
                        const activate = () => dispatchMouseSelection(element, point);
                        if (part.kind === 'label') return activate();
                        return withGeneratedIds(ScratchBlocks, [part.id], activate);
                    }
                });
                if (!travels[`part${index}Button`].completed) {
                    return {cancelled: true, frames: [], pointerTravel: combinePointerTravels(travels)};
                }
                const addedEditor = await waitFor(() => {
                    const current = activeEditor(documentObject);
                    return current && current !== previousEditor ? current : null;
                }, documentObject, signal);
                if (!addedEditor) throw new Error(`Custom procedure ${part.kind} editor did not open`);
                editors.push(addedEditor);
            }

            const partEditor = editors[index];
            if (!inputIsFocused(documentObject, partEditor)) {
                travels[`part${index}Input`] = await pointer.travelTo(createElementPointerTarget({
                    id: `custom-procedure-editor:${index}`,
                    kind: 'text-input',
                    locate: () => partEditor
                }), {clock, signal});
                if (!travels[`part${index}Input`].completed) {
                    return {cancelled: true, frames: [], pointerTravel: combinePointerTravels(travels)};
                }
                partEditor.focus();
            }
            const typed = await typeInputText({
                input: partEditor,
                value: part.value,
                clock,
                signal,
                point: travels[`part${index}Input`] ?
                    travels[`part${index}Input`].target.point : inputPoint(pointer, partEditor),
                pointer,
                framesPerCharacter: TEXT_FRAMES_PER_CHARACTER
            });
            typedValues.push({kind: part.kind, value: part.value, intermediateValues: typed.intermediateValues});
            if (!typed.completed) {
                return {cancelled: true, frames: [], pointerTravel: combinePointerTravels(travels), typedValues};
            }
        }

        const warpTarget = target(documentObject, 'custom-procedure-warp');
        if (!warpTarget) throw new Error('Custom procedure warp option is unavailable');
        if (Boolean(warpTarget.checked) !== definition.warp) {
            travels.warp = await clickThroughPointer({
                pointer,
                clock,
                signal,
                scope,
                id: 'custom-procedure-warp',
                kind: 'checkbox',
                locate: () => target(documentObject, 'custom-procedure-warp')
            });
            if (!travels.warp.completed) {
                return {cancelled: true, frames: [], pointerTravel: combinePointerTravels(travels), typedValues};
            }
        }

        travels.ok = await clickThroughPointer({
            pointer,
            clock,
            signal,
            scope,
            id: 'custom-procedure-ok',
            kind: 'dialog-confirm',
            locate: () => target(documentObject, 'custom-procedure-ok'),
            activate: (element, point) => withGeneratedIds(
                ScratchBlocks,
                plan.blockIds,
                () => {
                    dispatchMouseSelection(element, point);
                    immediatePlacement = settleDefinitionCoordinate(workspace, plan);
                },
                {skip: 1}
            )
        });
        const pointerTravel = combinePointerTravels(travels);
        if (!travels.ok.completed) return {cancelled: true, frames: [], pointerTravel, typedValues};

        const block = await waitFor(() => workspace.getBlockById(plan.blockId), documentObject, signal);
        if (!block) throw new Error(`Custom procedure definition was not created: ${definition.proccode}`);
        const confirmedPlacement = settleDefinitionCoordinate(workspace, plan);
        await waitPaintFrames(documentObject);
        return {
            cancelled: false,
            frames: [],
            resolvedPlan: plan,
            pointerTravel,
            dialogVisibleBeforeSubmit,
            definition,
            typedValues,
            placement: immediatePlacement || confirmedPlacement,
            flyoutRefreshSettled: true
        };
    }
});

export {
    TEXT_FRAMES_PER_CHARACTER,
    createScratchBlocksProcedureDriver,
    parseProcedureDefinition,
    settleDefinitionCoordinate
};
