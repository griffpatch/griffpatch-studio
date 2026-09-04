import {
    combinePointerTravels,
    dispatchMouseSelection,
    typeInputText,
    withGeneratedIds
} from './dom-interaction';
import {createElementPointerTarget} from './pointer-target';
import {activateThroughPointer} from './pointer-activation';
import {createScratchBlocksDropdownDriver} from './scratch-blocks-dropdown-driver';
import {TEXT_FRAMES_PER_CHARACTER} from './scratch-blocks-variable-driver';
import {inputIsFocused, inputPoint} from './ui-state';

const TARGET_ATTRIBUTE = 'data-studio-target';

const promptTarget = (documentObject, id) => (
    documentObject.querySelector(`[${TARGET_ATTRIBUTE}="${id}"]`)
);

const waitFor = async (locate, documentObject, signal, frameLimit = 60) => {
    for (let frame = 0; frame < frameLimit; frame += 1) {
        const value = locate();
        if (value) return value;
        if (signal && signal.aborted) return null;
        await new Promise(resolve => documentObject.defaultView.requestAnimationFrame(resolve));
    }
    return null;
};

const waitPaintFrames = async (documentObject, count = 2) => {
    for (let frame = 0; frame < count; frame += 1) {
        await new Promise(resolve => documentObject.defaultView.requestAnimationFrame(resolve));
    }
};

const clickThroughPointer = async ({pointer, clock, signal, scope, id, kind, locate, activate}) => {
    const travel = await pointer.travelTo(createElementPointerTarget({id, kind, locate}), {clock, signal});
    if (travel.completed) {
        const completed = await activateThroughPointer({
            pointer,
            clock,
            signal,
            activate: () => scope.runWithoutUndo(() => (activate || dispatchMouseSelection)(
                travel.target.element,
                travel.target.point
            ))
        });
        return {...travel, completed};
    }
    return travel;
};

const closeOpenPrompt = (documentObject, scope) => {
    const cancel = promptTarget(documentObject, 'prompt-cancel');
    if (!cancel) return false;
    const bounds = cancel.getBoundingClientRect();
    scope.runWithoutUndo(() => dispatchMouseSelection(cancel, {
        x: bounds.left + (bounds.width / 2),
        y: bounds.top + (bounds.height / 2)
    }));
    return true;
};

const createScratchBlocksBroadcastDriver = ({
    workspace,
    ScratchBlocks,
    documentObject,
    clock,
    pointer,
    scope,
    aliases = new Map(),
    createDropdownDriver = createScratchBlocksDropdownDriver
}) => {
    const dropdownDriver = createDropdownDriver({
        workspace,
        ScratchBlocks,
        documentObject,
        clock,
        pointer,
        scope,
        aliases
    });
    return {
        cleanup: () => {
            const closedPrompt = closeOpenPrompt(documentObject, scope);
            if (ScratchBlocks.DropDownDiv && ScratchBlocks.DropDownDiv.isVisible()) {
                ScratchBlocks.DropDownDiv.hideWithoutAnimation();
                return true;
            }
            return closedPrompt;
        },
        play: async (plan, signal = null) => {
            const dropdownEvidence = await dropdownDriver.play({
                ...plan,
                kind: 'dropdown-field-select',
                value: ScratchBlocks.NEW_BROADCAST_MESSAGE_ID
            }, signal);
            if (dropdownEvidence.cancelled) return dropdownEvidence;

            const input = await waitFor(
                () => promptTarget(documentObject, 'prompt-variable-name'), documentObject, signal
            );
            if (!input) throw new Error('Broadcast creation dialog did not open');
            const bounds = input.getBoundingClientRect();
            const dialogVisibleBeforeSubmit = bounds.width > 0 && bounds.height > 0;
            let inputTravel = null;
            if (!inputIsFocused(documentObject, input)) {
                inputTravel = await clickThroughPointer({
                    pointer,
                    clock,
                    signal,
                    scope,
                    id: 'prompt-variable-name',
                    kind: 'text-input',
                    locate: () => promptTarget(documentObject, 'prompt-variable-name')
                });
                if (!inputTravel.completed) {
                    return {
                        cancelled: true,
                        frames: [],
                        pointerTravel: combinePointerTravels({
                            dropdown: dropdownEvidence.pointerTravel,
                            input: inputTravel
                        })
                    };
                }
                input.focus();
            }
            const typed = await typeInputText({
                input,
                value: plan.varName,
                clock,
                signal,
                point: inputTravel ? inputTravel.target.point : inputPoint(pointer, input),
                pointer,
                framesPerCharacter: TEXT_FRAMES_PER_CHARACTER
            });
            if (!typed.completed) {
                return {
                    cancelled: true,
                    frames: [],
                    intermediateValues: typed.intermediateValues,
                    pointerTravel: combinePointerTravels({dropdown: dropdownEvidence.pointerTravel, input: inputTravel})
                };
            }

            const okTravel = await clickThroughPointer({
                pointer,
                clock,
                signal,
                scope,
                id: 'prompt-ok',
                kind: 'dialog-confirm',
                locate: () => promptTarget(documentObject, 'prompt-ok'),
                activate: (element, point) => withGeneratedIds(
                    ScratchBlocks,
                    [plan.varId],
                    () => dispatchMouseSelection(element, point)
                )
            });
            const pointerTravel = combinePointerTravels({
                dropdown: dropdownEvidence.pointerTravel,
                input: inputTravel,
                ok: okTravel
            });
            if (!okTravel.completed) {
                return {cancelled: true, frames: [], pointerTravel, intermediateValues: typed.intermediateValues};
            }

            const variable = await waitFor(() => (
                workspace.getVariableById && workspace.getVariableById(plan.varId)
            ), documentObject, signal);
            if (!variable) throw new Error(`Broadcast dialog did not create: ${plan.varName}`);
            await waitPaintFrames(documentObject);
            return {
                cancelled: false,
                frames: [],
                resolvedPlan: {
                    ...plan,
                    blockId: dropdownEvidence.resolvedPlan.blockId,
                    sourceValue: dropdownEvidence.resolvedPlan.sourceValue,
                    value: plan.varId
                },
                idAliases: {[plan.varId]: plan.varId},
                pointerTravel,
                menuVisibleBeforeClick: dropdownEvidence.menuVisibleBeforeClick,
                optionValue: dropdownEvidence.optionValue,
                dialogVisibleBeforeSubmit,
                intermediateValues: typed.intermediateValues
            };
        }
    };
};

export {createScratchBlocksBroadcastDriver};
