import {replaceInputValue, typeInputText} from './dom-interaction';
import {createElementPointerTarget} from './pointer-target';
import {activateThroughPointer} from './pointer-activation';
import {resolvePlaybackBlockId} from './playback-block-resolver';
import {createScratchBlocksDropdownDriver} from './scratch-blocks-dropdown-driver';

const TEXT_FRAMES_PER_CHARACTER = 5;

const eventAt = (type, point, target) => ({
    type,
    button: 0,
    clientX: point.x,
    clientY: point.y,
    target,
    preventDefault: () => {},
    stopPropagation: () => {}
});

const openFieldThroughGesture = ({workspace, block, field, point, scope}) => {
    const target = field.getSvgRoot();
    const downEvent = eventAt('mousedown', point, target);
    const gesture = workspace.getGesture(downEvent);
    if (!gesture) throw new Error('Scratch Blocks refused the field click gesture');
    scope.runWithoutUndo(() => {
        gesture.setStartField(field);
        gesture.handleBlockStart(downEvent, block);
        gesture.handleWsStart(downEvent, workspace);
        gesture.handleUp(eventAt('mouseup', point, target));
    });
};

const waitForEditor = async (documentObject, signal, frameLimit = 60) => {
    for (let frame = 0; frame < frameLimit; frame += 1) {
        const editor = documentObject.querySelector('.blocklyHtmlInput');
        const bounds = editor && editor.getBoundingClientRect && editor.getBoundingClientRect();
        if (bounds && bounds.width > 0 && bounds.height > 0) return editor;
        if (signal && signal.aborted) return null;
        await new Promise(resolve => documentObject.defaultView.requestAnimationFrame(resolve));
    }
    return null;
};

const commitEditor = (editor, scope) => {
    const view = editor.ownerDocument.defaultView;
    const options = {
        bubbles: true,
        cancelable: true,
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        which: 13
    };
    const event = view.KeyboardEvent ? new view.KeyboardEvent('keydown', options) :
        Object.assign(new view.Event('keydown', options), options);
    scope.runWithoutUndo(() => editor.dispatchEvent(event));
};

const ensureEditorClosed = async ({ScratchBlocks, documentObject, scope, signal}) => {
    await new Promise(resolve => documentObject.defaultView.requestAnimationFrame(resolve));
    if (signal && signal.aborted) return false;
    if (ScratchBlocks.WidgetDiv && ScratchBlocks.WidgetDiv.isVisible()) {
        // Enter normally closes Blockly's editor, but some Scratch Blocks
        // fields defer disposal until a later browser task. Do not let that
        // transient widget leak into the next transaction: it can intercept a
        // palette click or redirect typing to a sibling input.
        // `true` skips Blockly's close animation and clears the owner now.
        // Without it, WidgetDiv.isVisible() remains true during the animation
        // and the following transaction is incorrectly rejected as overlapping.
        scope.runWithoutUndo(() => ScratchBlocks.WidgetDiv.hide(true));
        await new Promise(resolve => documentObject.defaultView.requestAnimationFrame(resolve));
    }
    return !ScratchBlocks.WidgetDiv || !ScratchBlocks.WidgetDiv.isVisible();
};

const createScratchBlocksFieldDriver = options => {
    const {workspace, ScratchBlocks, documentObject, clock, pointer, scope, aliases = new Map()} = options;
    const dropdownDriver = createScratchBlocksDropdownDriver(options);
    return {
        cleanup: () => {
            if (ScratchBlocks.WidgetDiv && ScratchBlocks.WidgetDiv.isVisible()) {
                ScratchBlocks.WidgetDiv.hide();
                return true;
            }
            if (ScratchBlocks.DropDownDiv && ScratchBlocks.DropDownDiv.isVisible()) {
                ScratchBlocks.DropDownDiv.hideWithoutAnimation();
                return true;
            }
            return false;
        },
        play: async (plan, signal = null) => {
            const blockId = resolvePlaybackBlockId(workspace, plan, aliases);
            const block = workspace.getBlockById(blockId);
            if (!block) throw new Error(`Field playback block is missing: ${plan.blockId}`);
            const field = block.getField && block.getField(plan.fieldName);
            if (!field) throw new Error(`Recorded field is missing: ${plan.fieldName}`);
            if (ScratchBlocks.FieldDropdown && field instanceof ScratchBlocks.FieldDropdown) {
                return dropdownDriver.play(plan, signal);
            }
            if (!ScratchBlocks.FieldTextInput || !(field instanceof ScratchBlocks.FieldTextInput)) {
                throw new Error(`Recorded field is not an editable text or dropdown field: ${plan.fieldName}`);
            }
            if (field.getValue() !== plan.sourceValue) {
                throw new Error(`Text field source value differs: ${plan.fieldName}`);
            }

            const fieldTravel = await pointer.travelTo(createElementPointerTarget({
                id: `field:${blockId}:${plan.fieldName}`,
                kind: 'block-field',
                locate: () => field.getSvgRoot()
            }), {clock, signal});
            if (!fieldTravel.completed) {
                return {cancelled: true, frames: [], resolvedPlan: plan, pointerTravel: fieldTravel};
            }
            const opened = await activateThroughPointer({
                pointer,
                clock,
                signal,
                activate: () => openFieldThroughGesture({
                    workspace,
                    block,
                    field,
                    point: fieldTravel.target.point,
                    scope
                })
            });
            if (!opened) {
                return {cancelled: true, frames: [], resolvedPlan: plan, pointerTravel: fieldTravel};
            }
            const editor = await waitForEditor(documentObject, signal);
            if (!editor) throw new Error(`Text field editor did not open: ${plan.fieldName}`);
            const editorVisibleBeforeCommit = true;
            const typed = await typeInputText({
                input: editor,
                value: String(plan.value),
                clock,
                signal,
                point: fieldTravel.target.point,
                pointer,
                framesPerCharacter: TEXT_FRAMES_PER_CHARACTER,
                replaceValue: (input, value, character) => scope.runWithoutUndo(() => (
                    replaceInputValue(input, value, character)
                ))
            });
            if (!typed.completed) {
                return {
                    cancelled: true,
                    frames: [],
                    resolvedPlan: plan,
                    pointerTravel: fieldTravel,
                    intermediateValues: typed.intermediateValues
                };
            }
            commitEditor(editor, scope);
            const editorClosed = await ensureEditorClosed({
                ScratchBlocks,
                documentObject,
                scope,
                signal
            });
            if (!editorClosed) throw new Error(`Text field editor did not close: ${plan.fieldName}`);
            return {
                cancelled: false,
                frames: [],
                resolvedPlan: {...plan, blockId},
                pointerTravel: fieldTravel,
                interactionKind: 'text-input',
                editorVisibleBeforeCommit,
                editorClosed,
                intermediateValues: typed.intermediateValues
            };
        }
    };
};

export {TEXT_FRAMES_PER_CHARACTER, createScratchBlocksFieldDriver};
