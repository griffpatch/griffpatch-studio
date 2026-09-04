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

const waitFor = async (locate, documentObject, signal, frameLimit = 30) => {
    const view = documentObject.defaultView;
    for (let frame = 0; frame < frameLimit; frame += 1) {
        const value = locate();
        if (value) return value;
        if (signal && signal.aborted) return null;
        await new Promise(resolve => view.requestAnimationFrame(resolve));
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

const promptTarget = (documentObject, id) => (
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

const waitPaintFrames = async (documentObject, count = 2) => {
    for (let frame = 0; frame < count; frame += 1) {
        await new Promise(resolve => documentObject.defaultView.requestAnimationFrame(resolve));
    }
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

const closeOpenConfirmation = (documentObject, scope) => {
    const cancel = promptTarget(documentObject, 'blocks-confirm-cancel');
    if (!cancel) return false;
    const bounds = cancel.getBoundingClientRect();
    scope.runWithoutUndo(() => dispatchMouseSelection(cancel, {
        x: bounds.left + (bounds.width / 2),
        y: bounds.top + (bounds.height / 2)
    }));
    return true;
};

const eventAt = (type, point, target) => ({
    type,
    button: 0,
    clientX: point.x,
    clientY: point.y,
    target,
    preventDefault: () => {},
    stopPropagation: () => {}
});

const openFieldThroughGesture = ({field, point, scope}) => {
    const block = field.sourceBlock_;
    const fieldWorkspace = block && block.workspace;
    const target = field.getSvgRoot();
    if (!block || !fieldWorkspace || !target) throw new Error('Variable field gesture target is unavailable');
    const downEvent = eventAt('mousedown', point, target);
    const gesture = fieldWorkspace.getGesture(downEvent);
    if (!gesture) throw new Error('Scratch Blocks refused the variable field click gesture');
    scope.runWithoutUndo(() => {
        gesture.setStartField(field);
        gesture.handleBlockStart(downEvent, block);
        gesture.handleWsStart(downEvent, fieldWorkspace);
        gesture.handleUp(eventAt('mouseup', point, target));
    });
};

const flyoutWorkspaceFor = workspace => {
    const flyout = workspace.getFlyout ? workspace.getFlyout() : workspace.toolbox_ && workspace.toolbox_.flyout_;
    return flyout && (flyout.getWorkspace ? flyout.getWorkspace() : flyout.workspace_);
};

const variableFieldsOn = block => (block.inputList || []).flatMap(input => input.fieldRow || []);

const findFlyoutVariableField = (workspace, ScratchBlocks, varId) => {
    const flyoutWorkspace = flyoutWorkspaceFor(workspace);
    const blocks = flyoutWorkspace && flyoutWorkspace.getAllBlocks ? flyoutWorkspace.getAllBlocks(false) : [];
    for (const block of blocks) {
        const field = variableFieldsOn(block).find(candidate => (
            candidate instanceof ScratchBlocks.FieldVariable && candidate.getValue() === varId &&
            candidate.getSvgRoot && candidate.getSvgRoot()
        ));
        if (field) return field;
    }
    return null;
};

const openVariableActionMenu = async ({
    workspace,
    ScratchBlocks,
    documentObject,
    pointer,
    clock,
    signal,
    scope,
    varId,
    actionValue
}) => {
    const stableField = await waitForStableVisible(() => {
        const field = findFlyoutVariableField(workspace, ScratchBlocks, varId);
        return field ? {field, svgGroup_: field.getSvgRoot()} : null;
    }, documentObject, signal);
    const field = stableField && stableField.field;
    if (!field) throw new Error(`Variable field target is unavailable: ${varId}`);
    const fieldTravel = await pointer.travelTo(createElementPointerTarget({
        id: `variable-field:${varId}`,
        kind: 'block-field',
        locate: () => field.getSvgRoot()
    }), {clock, signal});
    if (!fieldTravel.completed) return {cancelled: true, fieldTravel};
    const fieldClickCompleted = await activateThroughPointer({
        pointer,
        clock,
        signal,
        activate: () => openFieldThroughGesture({
            field,
            point: fieldTravel.target.point,
            scope
        })
    });
    if (!fieldClickCompleted) return {cancelled: true, fieldTravel};
    if (!ScratchBlocks.DropDownDiv.isVisible()) throw new Error('Variable dropdown did not open');
    const options = field.getOptions();
    const optionIndex = options.findIndex(option => option[1] === actionValue);
    if (optionIndex < 0) throw new Error(`Variable dropdown action is unavailable: ${actionValue}`);
    const menuItems = ScratchBlocks.DropDownDiv.getContentDiv().querySelectorAll('.goog-menuitem');
    const optionElement = menuItems[optionIndex];
    if (!optionElement) throw new Error(`Variable dropdown action did not render: ${actionValue}`);
    const optionTravel = await pointer.travelTo(createElementPointerTarget({
        id: `variable-action:${varId}:${actionValue}`,
        kind: 'dropdown-option',
        locate: () => optionElement
    }), {clock, signal});
    const pointerTravel = combinePointerTravels({field: fieldTravel, option: optionTravel});
    if (!optionTravel.completed) {
        ScratchBlocks.DropDownDiv.hideWithoutAnimation();
        return {cancelled: true, fieldTravel, optionTravel, pointerTravel};
    }
    const optionClickCompleted = await activateThroughPointer({
        pointer,
        clock,
        signal,
        activate: () => scope.runWithoutUndo(() => dispatchMouseSelection(
            optionElement,
            optionTravel.target.point
        ))
    });
    if (!optionClickCompleted) {
        ScratchBlocks.DropDownDiv.hideWithoutAnimation();
        return {cancelled: true, fieldTravel, optionTravel, pointerTravel};
    }
    return {
        cancelled: false,
        field,
        fieldTravel,
        optionTravel,
        pointerTravel,
        menuVisibleBeforeClick: true,
        optionIndex
    };
};

const playVariableLifecycle = async ({
    plan,
    signal,
    workspace,
    ScratchBlocks,
    documentObject,
    clock,
    pointer,
    scope,
    aliases
}) => {
    const liveId = aliases.get(plan.varId) || plan.varId;
    const variable = workspace.getVariableById && workspace.getVariableById(liveId);
    if (!variable) throw new Error(`Variable playback target is missing: ${plan.varId}`);
    const expectedName = plan.kind === 'variable-rename-dialog' ? plan.oldName : plan.varName;
    if (variable.name !== expectedName || (variable.type || '') !== plan.varType) {
        throw new Error(`Variable playback source differs: ${expectedName}`);
    }

    const category = categoryForId(workspace, 'variables');
    if (!category || !category.item_) throw new Error('Variables category target is unavailable');
    let categoryTravel = null;
    if (!categoryIsSelected(workspace, 'variables')) {
        categoryTravel = await clickThroughPointer({
            pointer,
            clock,
            signal,
            scope,
            id: 'toolbox-category:variables',
            kind: 'toolbox-category',
            locate: () => category.item_
        });
        if (!categoryTravel.completed) {
            return {cancelled: true, pointerTravel: combinePointerTravels({category: categoryTravel}), frames: []};
        }
    }

    const actionValue = plan.kind === 'variable-rename-dialog' ?
        ScratchBlocks.RENAME_VARIABLE_ID : ScratchBlocks.DELETE_VARIABLE_ID;
    const menu = await openVariableActionMenu({
        workspace,
        ScratchBlocks,
        documentObject,
        pointer,
        clock,
        signal,
        scope,
        varId: liveId,
        actionValue
    });
    if (menu.cancelled) {
        return {
            cancelled: true,
            frames: [],
            resolvedPlan: {...plan, recordedVarId: plan.varId, varId: liveId},
            pointerTravel: combinePointerTravels({
                category: categoryTravel,
                menu: menu.pointerTravel || menu.fieldTravel
            })
        };
    }

    if (plan.kind === 'variable-rename-dialog') {
        const input = await waitFor(
            () => promptTarget(documentObject, 'prompt-variable-name'), documentObject, signal
        );
        if (!input) throw new Error('Variable rename dialog did not open');
        const dialogVisibleBeforeSubmit = input.getBoundingClientRect().width > 0;
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
            if (!inputTravel.completed) return {cancelled: true, frames: []};
            input.focus();
        }
        const typed = await typeInputText({
            input,
            value: plan.newName,
            clock,
            signal,
            point: inputTravel ? inputTravel.target.point : inputPoint(pointer, input),
            pointer,
            framesPerCharacter: TEXT_FRAMES_PER_CHARACTER
        });
        if (!typed.completed) return {cancelled: true, frames: [], intermediateValues: typed.intermediateValues};
        const okTravel = await clickThroughPointer({
            pointer,
            clock,
            signal,
            scope,
            id: 'prompt-ok',
            kind: 'dialog-confirm',
            locate: () => promptTarget(documentObject, 'prompt-ok')
        });
        const pointerTravel = combinePointerTravels({
            category: categoryTravel,
            field: menu.fieldTravel,
            option: menu.optionTravel,
            input: inputTravel,
            ok: okTravel
        });
        if (!okTravel.completed) return {cancelled: true, frames: [], pointerTravel};
        await waitPaintFrames(documentObject);
        return {
            cancelled: false,
            frames: [],
            resolvedPlan: {...plan, recordedVarId: plan.varId, varId: liveId},
            pointerTravel,
            menuVisibleBeforeClick: menu.menuVisibleBeforeClick,
            dialogVisibleBeforeSubmit,
            intermediateValues: typed.intermediateValues
        };
    }

    const useCount = workspace.getVariableUsesById ? workspace.getVariableUsesById(liveId).length : 0;
    const confirmationRequired = useCount > 1;
    let confirmationTravel = null;
    let confirmationVisibleBeforeSubmit = false;
    if (confirmationRequired) {
        const confirmation = await waitFor(
            () => promptTarget(documentObject, 'blocks-confirm-ok'), documentObject, signal
        );
        if (!confirmation) throw new Error('Variable deletion confirmation did not open');
        confirmationVisibleBeforeSubmit = confirmation.getBoundingClientRect().width > 0;
        confirmationTravel = await clickThroughPointer({
            pointer,
            clock,
            signal,
            scope,
            id: 'blocks-confirm-ok',
            kind: 'dialog-confirm',
            locate: () => promptTarget(documentObject, 'blocks-confirm-ok')
        });
        if (!confirmationTravel.completed) return {cancelled: true, frames: []};
    }
    const removed = await waitFor(
        () => !(workspace.getVariableById && workspace.getVariableById(liveId)), documentObject, signal
    );
    if (!removed) throw new Error(`Variable dropdown did not delete: ${expectedName}`);
    await waitPaintFrames(documentObject);
    return {
        cancelled: false,
        frames: [],
        resolvedPlan: {
            ...plan,
            recordedVarId: plan.varId,
            varId: liveId,
            deletedBlocks: (plan.deletedBlocks || []).map(deleted => ({
                ...deleted,
                recordedBlockId: deleted.blockId,
                blockId: aliases.get(deleted.blockId) || deleted.blockId,
                blockIds: deleted.blockIds.map(id => aliases.get(id) || id)
            }))
        },
        pointerTravel: combinePointerTravels({
            category: categoryTravel,
            field: menu.fieldTravel,
            option: menu.optionTravel,
            confirmation: confirmationTravel
        }),
        menuVisibleBeforeClick: menu.menuVisibleBeforeClick,
        useCount,
        confirmationRequired,
        confirmationVisibleBeforeSubmit
    };
};

const createScratchBlocksVariableDriver = ({
    workspace,
    ScratchBlocks,
    documentObject,
    clock,
    pointer,
    scope,
    aliases = new Map()
}) => ({
    cleanup: () => closeOpenPrompt(documentObject, scope) || closeOpenConfirmation(documentObject, scope),
    play: async (plan, signal = null) => {
        if (plan.kind === 'variable-rename-dialog' || plan.kind === 'variable-delete-dropdown') {
            return playVariableLifecycle({
                plan,
                signal,
                workspace,
                ScratchBlocks,
                documentObject,
                clock,
                pointer,
                scope,
                aliases
            });
        }
        const category = categoryForId(workspace, 'variables');
        if (!category || !category.item_) throw new Error('Variables category target is unavailable');
        let categoryTravel = null;
        if (!categoryIsSelected(workspace, 'variables')) {
            categoryTravel = await clickThroughPointer({
                pointer,
                clock,
                signal,
                scope,
                id: 'toolbox-category:variables',
                kind: 'toolbox-category',
                locate: () => category.item_
            });
            if (!categoryTravel.completed) {
                return {cancelled: true, pointerTravel: combinePointerTravels({category: categoryTravel}), frames: []};
            }
        }

        const callbackKey = plan.varType === ScratchBlocks.LIST_VARIABLE_TYPE ? 'CREATE_LIST' : 'CREATE_VARIABLE';
        const button = await waitForStableVisible(
            () => flyoutButtonFor(workspace, callbackKey), documentObject, signal
        );
        if (!button || !button.svgGroup_) throw new Error(`Flyout button target is unavailable: ${callbackKey}`);
        const buttonTravel = await clickThroughPointer({
            pointer,
            clock,
            signal,
            scope,
            id: `flyout-button:${callbackKey}`,
            kind: 'flyout-button',
            locate: () => button.svgGroup_
        });
        if (!buttonTravel.completed) {
            return {
                cancelled: true,
                pointerTravel: combinePointerTravels({category: categoryTravel, button: buttonTravel}),
                frames: []
            };
        }

        const input = await waitFor(
            () => promptTarget(documentObject, 'prompt-variable-name'), documentObject, signal
        );
        if (!input) throw new Error('Variable creation dialog did not open');
        const inputBounds = input.getBoundingClientRect();
        const dialogVisibleBeforeSubmit = inputBounds.width > 0 && inputBounds.height > 0;
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
                    pointerTravel: combinePointerTravels({
                        category: categoryTravel,
                        button: buttonTravel,
                        input: inputTravel
                    }),
                    frames: []
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
        const intermediateValues = typed.intermediateValues;
        if (!typed.completed) {
            return {
                cancelled: true,
                pointerTravel: combinePointerTravels({
                    category: categoryTravel,
                    button: buttonTravel,
                    input: inputTravel
                }),
                frames: [],
                intermediateValues
            };
        }

        const desiredScopeId = plan.isLocal ? 'prompt-scope-local' : 'prompt-scope-global';
        const desiredScope = promptTarget(documentObject, desiredScopeId);
        if (!desiredScope) throw new Error(`Recorded variable scope is unavailable: ${desiredScopeId}`);
        let scopeTravel = null;
        if (desiredScope && !desiredScope.checked) {
            scopeTravel = await clickThroughPointer({
                pointer,
                clock,
                signal,
                scope,
                id: desiredScopeId,
                kind: 'variable-scope',
                locate: () => promptTarget(documentObject, desiredScopeId)
            });
            if (!scopeTravel.completed) return {cancelled: true, frames: [], intermediateValues};
        }
        let cloudTravel = null;
        const cloud = promptTarget(documentObject, 'prompt-cloud');
        if (plan.isCloud && (!cloud || cloud.disabled)) {
            throw new Error('Recorded cloud variable option is unavailable');
        }
        if (cloud && Boolean(cloud.checked) !== plan.isCloud) {
            if (cloud.disabled) throw new Error('Recorded cloud variable state cannot be selected');
            cloudTravel = await clickThroughPointer({
                pointer,
                clock,
                signal,
                scope,
                id: 'prompt-cloud',
                kind: 'variable-cloud-option',
                locate: () => promptTarget(documentObject, 'prompt-cloud')
            });
            if (!cloudTravel.completed) return {cancelled: true, frames: [], intermediateValues};
        }

        const selectedBeforeSubmit = {
            local: Boolean(promptTarget(documentObject, 'prompt-scope-local') &&
                promptTarget(documentObject, 'prompt-scope-local').checked),
            global: Boolean(promptTarget(documentObject, 'prompt-scope-global') &&
                promptTarget(documentObject, 'prompt-scope-global').checked),
            cloud: Boolean(promptTarget(documentObject, 'prompt-cloud') &&
                promptTarget(documentObject, 'prompt-cloud').checked)
        };
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
            category: categoryTravel,
            button: buttonTravel,
            input: inputTravel,
            scope: scopeTravel,
            cloud: cloudTravel,
            ok: okTravel
        });
        if (!okTravel.completed) return {cancelled: true, frames: [], pointerTravel, intermediateValues};

        const variable = workspace.getVariable && workspace.getVariable(plan.varName, plan.varType);
        if (!variable) throw new Error(`Variable dialog did not create: ${plan.varName}`);
        const liveId = variable.getId ? variable.getId() : variable.id;
        await waitPaintFrames(documentObject);
        return {
            cancelled: false,
            frames: [],
            resolvedPlan: {...plan, recordedVarId: plan.varId, varId: liveId},
            idAliases: {[plan.varId]: liveId},
            pointerTravel,
            dialogVisibleBeforeSubmit,
            flyoutRefreshSettled: true,
            intermediateValues,
            selectedBeforeSubmit
        };
    }
});

export {TEXT_FRAMES_PER_CHARACTER, createScratchBlocksVariableDriver};
