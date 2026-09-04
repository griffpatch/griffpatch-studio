import {connectedInputName} from '../workspace-block-reference';

const waitTask = () => new Promise(resolve => setTimeout(resolve, 0));
const waitFrame = () => new Promise(resolve => requestAnimationFrame(resolve));
const targetName = target => target && (target.getName ? target.getName() :
    target.sprite && target.sprite.name);

const coordinateFromEvent = coordinate => {
    if (!coordinate) return null;
    if (typeof coordinate === 'string') {
        const [x, y] = coordinate.split(',').map(Number);
        return Number.isFinite(x) && Number.isFinite(y) ? {x, y} : null;
    }
    return Number.isFinite(coordinate.x) && Number.isFinite(coordinate.y) ? coordinate : null;
};

const coordinatesMatch = (actual, expected) => Boolean(
    actual && expected &&
    Math.abs(actual.x - expected.x) < 1 &&
    Math.abs(actual.y - expected.y) < 1
);

const normalizedEvent = event => {
    const json = typeof event.toJson === 'function' ? event.toJson() : {
        type: event.type,
        blockId: event.blockId,
        commentId: event.commentId,
        newParentId: event.newParentId,
        newInputName: event.newInputName,
        newCoordinate: event.newCoordinate
    };
    delete json.group;
    return json;
};

const settleObserved = async (scope, matchesEvent, timeoutMs) => {
    const started = Date.now();
    while (!scope.observed.some(matchesEvent)) {
        if (Date.now() - started > timeoutMs) return false;
        await waitTask();
    }
    let revision = scope.getRevision();
    await waitTask();
    if (scope.getRevision() !== revision) {
        revision = scope.getRevision();
        await waitTask();
    }
    await waitFrame();
    return scope.observed.some(matchesEvent);
};

const closeNumber = (actual, expected) => Number.isFinite(actual) && Number.isFinite(expected) &&
    Math.abs(actual - expected) < 1;
const sizesMatch = (actual, expected) => Boolean(actual && expected &&
    closeNumber(actual.width, expected.width) && closeNumber(actual.height, expected.height));

const commentAction = plan => plan.kind.slice(plan.kind.lastIndexOf('-') + 1);
const workspaceCommentPlan = plan => plan.commentOwner === 'workspace' ||
    plan.kind.startsWith('workspace-comment-');

const observedCommentEvent = (event, plan) => {
    const action = commentAction(plan);
    const expectedType = action === 'create' ? 'comment_create' :
        action === 'delete' ? 'comment_delete' :
            action === 'move' ? 'comment_move' : 'comment_change';
    const json = typeof event.toJson === 'function' ? event.toJson() : event;
    const resolvedBlockId = workspaceCommentPlan(plan) ? null : plan.resolvedBlockId || plan.blockId;
    if (json.type !== expectedType || json.commentId !== plan.commentId ||
        (json.blockId || null) !== resolvedBlockId) return false;
    if (action === 'move') {
        return coordinatesMatch(
            coordinateFromEvent(event.newCoordinate_ || json.newCoordinate),
            plan.destination
        );
    }
    if (!['text', 'minimize', 'resize'].includes(action)) return true;
    const contents = event.newContents_ || json.newContents;
    if (!contents) return false;
    if (action === 'text') return contents.text === plan.text;
    if (action === 'minimize') return contents.minimized === plan.minimized;
    return closeNumber(contents.width, plan.size.width) && closeNumber(contents.height, plan.size.height);
};

const commentWorkspaceState = (comment, plan) => {
    if (!comment) return {matches: false, actual: null};
    const action = commentAction(plan);
    const minimized = typeof comment.isMinimized === 'function' ?
        comment.isMinimized() : Boolean(comment.isMinimized_);
    if (action === 'create' && workspaceCommentPlan(plan)) {
        const size = comment.getHeightWidth && comment.getHeightWidth();
        const coordinate = comment.getXY && comment.getXY();
        const actual = {
            text: comment.getText(),
            minimized,
            size: size ? {width: size.width, height: size.height} : null,
            coordinate: coordinate ? {x: coordinate.x, y: coordinate.y} : null
        };
        return {
            matches: actual.text === '' && actual.minimized === plan.minimized &&
                sizesMatch(actual.size, plan.size) && coordinatesMatch(actual.coordinate, plan.coordinate),
            actual
        };
    }
    if (action === 'text') {
        const actual = {text: comment.getText()};
        return {matches: actual.text === plan.text, actual};
    }
    if (action === 'minimize') {
        const actual = {minimized};
        return {matches: actual.minimized === plan.minimized, actual};
    }
    if (action === 'resize') {
        const size = comment.getHeightWidth && comment.getHeightWidth();
        const actual = size ? {width: size.width, height: size.height} : null;
        return {
            matches: Boolean(actual && closeNumber(actual.width, plan.size.width) &&
                closeNumber(actual.height, plan.size.height)),
            actual
        };
    }
    if (action === 'move') {
        const coordinate = comment.getXY && comment.getXY();
        const actual = coordinate ? {x: coordinate.x, y: coordinate.y} : null;
        return {matches: coordinatesMatch(actual, plan.destination), actual};
    }
    return {matches: true, actual: null};
};

const verifyCommentInteraction = async ({workspace, plan, scope, driverEvidence, timeoutMs}) => {
    const workspaceComment = workspaceCommentPlan(plan);
    const resolvedBlockId = workspaceComment ? null : driverEvidence.resolvedBlockId || plan.blockId;
    const resolvedPlan = {...plan, resolvedBlockId};
    const observed = await settleObserved(scope, event => observedCommentEvent(event, resolvedPlan), timeoutMs);
    const block = workspaceComment ? null : workspace.getBlockById && workspace.getBlockById(resolvedBlockId);
    const comment = workspace.getCommentById && workspace.getCommentById(plan.commentId);
    const commentState = commentWorkspaceState(comment, plan);
    const deleting = commentAction(plan) === 'delete';
    const workspaceMatches = workspaceComment ? (deleting ? !comment : Boolean(
        comment && !comment.blockId && commentState.matches
    )) : deleting ? Boolean(block && !block.comment && !comment) : Boolean(
        block && comment && block.comment === comment && comment.blockId === resolvedBlockId &&
        commentState.matches
    );
    const isolation = scope.verifyIsolation();
    const pointerTravel = driverEvidence.pointerTravel || null;
    const evidence = {
        plan,
        pointerTravel,
        controlsVisible: driverEvidence.controlsVisible,
        menuVisibleBeforeClick: driverEvidence.menuVisibleBeforeClick,
        intermediateValues: driverEvidence.intermediateValues || [],
        observedEvents: scope.observed.map(normalizedEvent),
        workspaceMatches,
        commentState: commentState.actual,
        resolvedBlockId,
        isolation
    };
    return {
        matches: Boolean(observed && workspaceMatches && driverEvidence.commentMatches &&
            driverEvidence.controlsVisible && pointerTravel && pointerTravel.completed &&
            isolation.journalUnchanged && isolation.undoUnchanged && isolation.redoUnchanged),
        evidence
    };
};

const observedDestination = (event, plan) => (
    event.type === 'move' &&
    event.blockId === plan.blockId &&
    (plan.destination.parentId ?
        event.newParentId === plan.destination.parentId &&
            (plan.destination.inputName || null) === (event.newInputName || null) :
        coordinatesMatch(coordinateFromEvent(event.newCoordinate), plan.destination.coordinate))
);

const workspaceTopology = (workspace, affected, {
    allowUnavailableCoordinate = false,
    allowConnectionCoordinate = false
} = {}) => {
    const block = workspace.getBlockById(affected.blockId);
    if (!block) return {matches: false, actual: null, reason: 'workspace block missing'};
    const parent = block.getParent && block.getParent();
    const actual = {
        parentId: parent ? parent.id : null,
        inputName: parent ? connectedInputName(parent, block) || null : null,
        coordinate: parent ? null : block.getRelativeToSurfaceXY()
    };
    const exactCoordinate = coordinatesMatch(actual.coordinate, affected.destination.coordinate);
    const coordinateSource = exactCoordinate ? 'workspace' :
        (allowConnectionCoordinate ? 'native-connection' :
            (!actual.coordinate && allowUnavailableCoordinate ? 'observed-event' : null));
    const matches = affected.destination.parentId ?
        actual.parentId === affected.destination.parentId &&
            actual.inputName === (affected.destination.inputName || null) :
        actual.parentId === null &&
            (exactCoordinate || allowConnectionCoordinate ||
                (!actual.coordinate && allowUnavailableCoordinate));
    return {matches, actual, coordinateSource, reason: matches ? null : 'workspace topology differs'};
};

const vmTopology = (vm, affected) => {
    const blocks = vm.editingTarget && vm.editingTarget.blocks;
    const block = blocks && blocks.getBlock(affected.blockId);
    if (!block) return {matches: false, actual: null, reason: 'VM block missing'};
    const actual = {parentId: block.parent || null};
    const matches = actual.parentId === (affected.destination.parentId || null);
    return {matches, actual, reason: matches ? null : 'VM topology differs'};
};

const sameFieldValue = (actual, expected) => actual === expected;

const workspaceVariableField = field => {
    if (!field || typeof field.getVariable !== 'function') return null;
    const variable = field.getVariable();
    return {
        id: variable && (typeof variable.getId === 'function' ? variable.getId() : variable.id),
        name: variable && variable.name,
        type: variable && (variable.type || '')
    };
};

const readVmFieldValue = field => (
    field && typeof field === 'object' && Object.prototype.hasOwnProperty.call(field, 'value') ?
        field.value : field
);

const readVmFieldId = field => (
    field && typeof field === 'object' && Object.prototype.hasOwnProperty.call(field, 'id') ?
        field.id : null
);

const observedFieldValue = (event, plan) => {
    const json = typeof event.toJson === 'function' ? event.toJson() : event;
    return json.type === 'change' && json.blockId === plan.blockId && json.element === 'field' &&
        json.name === plan.fieldName && sameFieldValue(json.newValue, plan.value);
};

const verifyFieldInteraction = async ({workspace, vm, plan, scope, driverEvidence, timeoutMs}) => {
    const observed = await settleObserved(scope, event => observedFieldValue(event, plan), timeoutMs);
    const workspaceBlock = workspace.getBlockById(plan.blockId);
    const workspaceField = workspaceBlock && workspaceBlock.getField && workspaceBlock.getField(plan.fieldName);
    const workspaceActual = workspaceField && workspaceField.getValue();
    const workspaceVariable = workspaceVariableField(workspaceField);
    const vmBlock = vm.editingTarget && vm.editingTarget.blocks &&
        vm.editingTarget.blocks.getBlock(plan.blockId);
    const vmField = vmBlock && vmBlock.fields && vmBlock.fields[plan.fieldName];
    const vmActual = readVmFieldValue(vmField);
    const vmId = readVmFieldId(vmField);
    // Blockly's variable/list/broadcast fields expose their stable variable ID,
    // while scratch-vm deliberately stores the human-readable name and ID as
    // separate values. Treat that as one identity contract instead of
    // comparing the VM display name to the Blockly ID.
    const variableField = Boolean(workspaceField && typeof workspaceField.getVariable === 'function');
    const workspaceMatches = sameFieldValue(workspaceActual, plan.value) && (!variableField || Boolean(
        workspaceVariable && sameFieldValue(workspaceVariable.id, plan.value)
    ));
    const vmMatches = variableField ? Boolean(
        workspaceVariable && sameFieldValue(vmId, plan.value) &&
        sameFieldValue(vmActual, workspaceVariable.name)
    ) : sameFieldValue(vmActual, plan.value);
    const isolation = scope.verifyIsolation();
    const evidence = {
        plan,
        pointerTravel: driverEvidence.pointerTravel || null,
        menuVisibleBeforeClick: driverEvidence.menuVisibleBeforeClick,
        optionIndex: driverEvidence.optionIndex,
        optionValue: driverEvidence.optionValue,
        interactionKind: driverEvidence.interactionKind || 'dropdown',
        editorVisibleBeforeCommit: driverEvidence.editorVisibleBeforeCommit,
        intermediateValues: driverEvidence.intermediateValues || [],
        observedEvents: scope.observed.map(normalizedEvent),
        workspace: {
            actual: workspaceActual,
            expected: plan.value,
            variable: workspaceVariable,
            matches: workspaceMatches
        },
        vm: {
            actual: vmActual,
            id: vmId,
            expected: variableField ? {
                value: workspaceVariable && workspaceVariable.name,
                id: plan.value
            } : plan.value,
            matches: vmMatches
        },
        isolation
    };
    const presentationMatches = evidence.interactionKind === 'text-input' ?
        evidence.editorVisibleBeforeCommit &&
            evidence.intermediateValues[evidence.intermediateValues.length - 1] === String(plan.value) :
        evidence.menuVisibleBeforeClick;
    const matches = observed && presentationMatches && evidence.pointerTravel &&
        evidence.pointerTravel.completed !== false && evidence.workspace.matches &&
        evidence.vm.matches && isolation.journalUnchanged && isolation.undoUnchanged && isolation.redoUnchanged;
    return {matches, evidence};
};

const observedVariableCreate = (event, plan) => {
    const json = typeof event.toJson === 'function' ? event.toJson() : event;
    return json.type === 'var_create' && json.varId === plan.varId && json.varName === plan.varName &&
        (json.varType || '') === plan.varType && Boolean(json.isLocal) === plan.isLocal &&
        Boolean(json.isCloud) === plan.isCloud;
};

const observedVariableRename = (event, plan) => {
    const json = typeof event.toJson === 'function' ? event.toJson() : event;
    return json.type === 'var_rename' && json.varId === plan.varId &&
        json.oldName === plan.oldName && json.newName === plan.newName;
};

const observedVariableDelete = (event, plan) => {
    const json = typeof event.toJson === 'function' ? event.toJson() : event;
    return json.type === 'var_delete' && json.varId === plan.varId &&
        json.varName === plan.varName && (json.varType || '') === plan.varType;
};

const vmVariableOwners = (vm, varId) => ((vm.runtime && vm.runtime.targets) || []).filter(target => (
    target.variables && Object.prototype.hasOwnProperty.call(target.variables, varId)
));

const variableEvidence = variable => (variable ? {
    id: typeof variable.getId === 'function' ? variable.getId() : variable.id,
    name: variable.name,
    type: variable.type || ''
} : null);

const verifyVariableLifecycle = async ({workspace, vm, plan, scope, driverEvidence, timeoutMs}) => {
    const rename = plan.kind === 'variable-rename-dialog';
    const observed = await settleObserved(
        scope,
        event => (rename ? observedVariableRename(event, plan) : observedVariableDelete(event, plan)),
        timeoutMs
    );
    const variable = workspace.getVariableById && workspace.getVariableById(plan.varId);
    const owners = vmVariableOwners(vm, plan.varId);
    let workspaceMatches;
    let vmMatches;
    if (rename) {
        workspaceMatches = Boolean(variable && variable.name === plan.newName &&
            (variable.type || '') === plan.varType);
        vmMatches = owners.length === 1 && owners[0].variables[plan.varId].name === plan.newName &&
            (owners[0].variables[plan.varId].type || '') === plan.varType;
    } else {
        workspaceMatches = !variable;
        vmMatches = owners.length === 0;
    }
    const deletedBlocks = (plan.deletedBlocks || []).flatMap(deleted => deleted.blockIds || []);
    const deletedWorkspaceBlocksAbsent = deletedBlocks.every(id => !workspace.getBlockById(id));
    const deletedVmBlocksAbsent = deletedBlocks.every(id => !((vm.runtime && vm.runtime.targets) || []).some(target => (
        target.blocks && target.blocks.getBlock && target.blocks.getBlock(id)
    )));
    const isolation = scope.verifyIsolation();
    const pointerTravel = driverEvidence.pointerTravel || null;
    const pointerMatches = Boolean(pointerTravel && pointerTravel.completed);
    const typedValues = driverEvidence.intermediateValues || [];
    const textMatches = !rename || typedValues[typedValues.length - 1] === plan.newName;
    const dialogMatches = !rename || Boolean(driverEvidence.dialogVisibleBeforeSubmit);
    const confirmationMatches = rename || (
        Boolean(driverEvidence.confirmationRequired) === (driverEvidence.useCount > 1) &&
        Boolean(driverEvidence.confirmationVisibleBeforeSubmit) === Boolean(driverEvidence.confirmationRequired)
    );
    const evidence = {
        plan,
        pointerTravel,
        menuVisibleBeforeClick: driverEvidence.menuVisibleBeforeClick,
        dialogVisibleBeforeSubmit: driverEvidence.dialogVisibleBeforeSubmit,
        intermediateValues: typedValues,
        useCount: driverEvidence.useCount,
        confirmationRequired: driverEvidence.confirmationRequired,
        confirmationVisibleBeforeSubmit: driverEvidence.confirmationVisibleBeforeSubmit,
        observedEvents: scope.observed.map(normalizedEvent),
        workspace: {variable: variableEvidence(variable), matches: workspaceMatches},
        vm: {ownerCount: owners.length, matches: vmMatches},
        deletedBlocks: {
            ids: deletedBlocks,
            workspaceAbsent: deletedWorkspaceBlocksAbsent,
            vmAbsent: deletedVmBlocksAbsent
        },
        isolation
    };
    const matches = observed && driverEvidence.menuVisibleBeforeClick && pointerMatches && textMatches &&
        dialogMatches && confirmationMatches && workspaceMatches && vmMatches && deletedWorkspaceBlocksAbsent &&
        deletedVmBlocksAbsent && isolation.journalUnchanged && isolation.undoUnchanged && isolation.redoUnchanged;
    return {matches, evidence};
};

const verifyVariableInteraction = async ({workspace, vm, plan, scope, driverEvidence, timeoutMs}) => {
    const observed = await settleObserved(scope, event => observedVariableCreate(event, plan), timeoutMs);
    const variable = workspace.getVariableById && workspace.getVariableById(plan.varId);
    const workspaceActual = variable ? {
        id: variable.getId ? variable.getId() : variable.id,
        name: variable.name,
        type: variable.type || '',
        isLocal: Boolean(variable.isLocal),
        isCloud: Boolean(variable.isCloud)
    } : null;
    const workspaceExpected = {
        id: plan.varId,
        name: plan.varName,
        type: plan.varType,
        isLocal: plan.isLocal,
        isCloud: plan.isCloud
    };
    const owners = ((vm.runtime && vm.runtime.targets) || []).filter(target => (
        target.variables && Object.prototype.hasOwnProperty.call(target.variables, plan.varId)
    ));
    const owner = owners[0] || null;
    const vmVariable = owner && owner.variables[plan.varId];
    const vmActual = vmVariable ? {
        id: vmVariable.id,
        name: vmVariable.name,
        type: vmVariable.type || '',
        isCloud: Boolean(vmVariable.isCloud),
        ownerId: owner.id,
        ownerIsStage: Boolean(owner.isStage)
    } : null;
    const ownerName = owner && (owner.getName ? owner.getName() : owner.sprite && owner.sprite.name);
    const targetRef = plan.targetRef || {};
    const durableLocalOwner = Boolean(owner) && !owner.isStage && targetRef.name && ownerName === targetRef.name;
    const ownerMatches = Boolean(owner) && (plan.isLocal ?
        owner.id === plan.targetId || durableLocalOwner : Boolean(owner.isStage));
    const vmMatches = Boolean(vmActual) && vmActual.name === plan.varName && vmActual.type === plan.varType &&
        vmActual.isCloud === plan.isCloud && ownerMatches;
    const workspaceMatches = JSON.stringify(workspaceActual) === JSON.stringify(workspaceExpected);
    const isolation = scope.verifyIsolation();
    const evidence = {
        plan,
        pointerTravel: driverEvidence.pointerTravel || null,
        dialogVisibleBeforeSubmit: driverEvidence.dialogVisibleBeforeSubmit,
        flyoutRefreshSettled: driverEvidence.flyoutRefreshSettled,
        intermediateValues: driverEvidence.intermediateValues || [],
        selectedBeforeSubmit: driverEvidence.selectedBeforeSubmit || null,
        observedEvents: scope.observed.map(normalizedEvent),
        workspace: {actual: workspaceActual, expected: workspaceExpected, matches: workspaceMatches},
        vm: {actual: vmActual, ownerName, ownerCount: owners.length, matches: vmMatches},
        isolation
    };
    const typedName = evidence.intermediateValues[evidence.intermediateValues.length - 1] === plan.varName;
    const scopeMatches = plan.isLocal ? evidence.selectedBeforeSubmit.local : evidence.selectedBeforeSubmit.global;
    const cloudMatches = evidence.selectedBeforeSubmit.cloud === plan.isCloud;
    const matches = observed && driverEvidence.dialogVisibleBeforeSubmit &&
        driverEvidence.flyoutRefreshSettled &&
        typedName && scopeMatches && cloudMatches &&
        workspaceMatches && vmMatches && isolation.journalUnchanged && isolation.undoUnchanged &&
        isolation.redoUnchanged;
    return {matches, evidence};
};

const verifyBroadcastInteraction = async ({workspace, vm, plan, scope, driverEvidence, timeoutMs}) => {
    const createObserved = await settleObserved(scope, event => observedVariableCreate(event, plan), timeoutMs);
    const fieldObserved = await settleObserved(scope, event => observedFieldValue(event, plan), timeoutMs);
    const variable = workspace.getVariableById && workspace.getVariableById(plan.varId);
    const workspaceVariable = variable ? {
        id: variable.getId ? variable.getId() : variable.id,
        name: variable.name,
        type: variable.type || ''
    } : null;
    const workspaceBlock = workspace.getBlockById(plan.blockId);
    const workspaceField = workspaceBlock && workspaceBlock.getField && workspaceBlock.getField(plan.fieldName);
    const workspaceFieldValue = workspaceField && workspaceField.getValue();
    const stage = vm.runtime && vm.runtime.getTargetForStage && vm.runtime.getTargetForStage();
    const vmVariable = stage && stage.variables && stage.variables[plan.varId];
    const vmBlock = vm.editingTarget && vm.editingTarget.blocks && vm.editingTarget.blocks.getBlock(plan.blockId);
    const vmField = vmBlock && vmBlock.fields && vmBlock.fields[plan.fieldName];
    const vmFieldValue = vmField && typeof vmField === 'object' &&
        Object.prototype.hasOwnProperty.call(vmField, 'value') ? vmField.value : vmField;
    const vmFieldId = vmField && typeof vmField === 'object' ? vmField.id : null;
    const variableMatches = Boolean(workspaceVariable && vmVariable &&
        workspaceVariable.id === plan.varId && workspaceVariable.name === plan.varName &&
        workspaceVariable.type === plan.varType && vmVariable.name === plan.varName &&
        vmVariable.type === plan.varType);
    // Scratch Blocks fields expose the variable ID. The VM's serialized
    // broadcast field deliberately stores both the display value and ID.
    const fieldMatches = sameFieldValue(workspaceFieldValue, plan.varId) &&
        sameFieldValue(vmFieldValue, plan.varName) && sameFieldValue(vmFieldId, plan.varId);
    const pointerTravel = driverEvidence.pointerTravel || null;
    const typedValues = driverEvidence.intermediateValues || [];
    const typedName = typedValues[typedValues.length - 1] === plan.varName;
    const isolation = scope.verifyIsolation();
    const evidence = {
        plan,
        pointerTravel,
        menuVisibleBeforeClick: driverEvidence.menuVisibleBeforeClick,
        dialogVisibleBeforeSubmit: driverEvidence.dialogVisibleBeforeSubmit,
        intermediateValues: typedValues,
        observedEvents: scope.observed.map(normalizedEvent),
        workspace: {
            variable: workspaceVariable,
            fieldValue: workspaceFieldValue,
            matches: variableMatches && sameFieldValue(workspaceFieldValue, plan.varId)
        },
        vm: {
            variable: vmVariable ? {id: vmVariable.id, name: vmVariable.name, type: vmVariable.type} : null,
            fieldValue: vmFieldValue,
            fieldId: vmFieldId,
            matches: variableMatches && sameFieldValue(vmFieldValue, plan.varName) &&
                sameFieldValue(vmFieldId, plan.varId)
        },
        isolation
    };
    const matches = createObserved && fieldObserved && driverEvidence.menuVisibleBeforeClick &&
        driverEvidence.dialogVisibleBeforeSubmit && typedName && variableMatches && fieldMatches &&
        pointerTravel && pointerTravel.completed && isolation.journalUnchanged && isolation.undoUnchanged &&
        isolation.redoUnchanged;
    return {matches, evidence};
};

const observedProcedureCreate = (event, plan) => {
    const json = typeof event.toJson === 'function' ? event.toJson() : event;
    return json.type === 'create' && json.blockId === plan.blockId &&
        Array.isArray(json.ids) && plan.blockIds.every(id => json.ids.includes(id));
};

const verifyProcedureInteraction = async ({workspace, vm, plan, scope, driverEvidence, timeoutMs}) => {
    const createObserved = await settleObserved(scope, event => observedProcedureCreate(event, plan), timeoutMs);
    const moveObserved = scope.observed.some(event => observedDestination(event, plan));
    const definitionBlock = workspace.getBlockById(plan.blockId);
    const workspaceIds = plan.blockIds.filter(id => workspace.getBlockById(id));
    const workspaceCoordinate = definitionBlock && definitionBlock.getRelativeToSurfaceXY &&
        definitionBlock.getRelativeToSurfaceXY();
    const prototype = definitionBlock && definitionBlock.getInputTargetBlock &&
        definitionBlock.getInputTargetBlock('custom_block');
    const mutation = prototype && prototype.mutationToDom && prototype.mutationToDom();
    const mutationActual = mutation ? {
        proccode: mutation.getAttribute('proccode'),
        argumentIds: JSON.parse(mutation.getAttribute('argumentids') || '[]'),
        argumentNames: JSON.parse(mutation.getAttribute('argumentnames') || '[]'),
        argumentDefaults: JSON.parse(mutation.getAttribute('argumentdefaults') || '[]'),
        warp: mutation.getAttribute('warp') === 'true'
    } : null;
    const definition = driverEvidence.definition;
    const mutationExpected = definition ? {
        proccode: definition.proccode,
        argumentIds: definition.argumentIds,
        argumentNames: definition.argumentNames,
        argumentDefaults: definition.argumentDefaults,
        warp: definition.warp
    } : null;
    const workspaceMatches = workspaceIds.length === plan.blockIds.length &&
        coordinatesMatch(workspaceCoordinate, plan.destination.coordinate) &&
        JSON.stringify(mutationActual) === JSON.stringify(mutationExpected);
    const vmBlocks = vm.editingTarget && vm.editingTarget.blocks;
    const vmIds = plan.blockIds.filter(id => vmBlocks && vmBlocks.getBlock(id));
    const vmMatches = vmIds.length === plan.blockIds.length;
    const typedValues = driverEvidence.typedValues || [];
    const typedMatches = Boolean(definition) && typedValues.length === definition.parts.length &&
        typedValues.every((typed, index) => typed.value === definition.parts[index].value &&
            typed.intermediateValues[typed.intermediateValues.length - 1] === typed.value);
    const isolation = scope.verifyIsolation();
    const evidence = {
        plan,
        pointerTravel: driverEvidence.pointerTravel || null,
        dialogVisibleBeforeSubmit: driverEvidence.dialogVisibleBeforeSubmit,
        flyoutRefreshSettled: driverEvidence.flyoutRefreshSettled,
        typedValues,
        definition,
        placement: driverEvidence.placement || null,
        observedEvents: scope.observed.map(normalizedEvent),
        workspace: {
            actual: {ids: workspaceIds, coordinate: workspaceCoordinate, mutation: mutationActual},
            expected: {ids: plan.blockIds, coordinate: plan.destination.coordinate, mutation: mutationExpected},
            matches: workspaceMatches
        },
        vm: {actualIds: vmIds, expectedIds: plan.blockIds, matches: vmMatches},
        isolation
    };
    const matches = createObserved && moveObserved && driverEvidence.dialogVisibleBeforeSubmit &&
        driverEvidence.flyoutRefreshSettled && typedMatches && workspaceMatches && vmMatches &&
        isolation.journalUnchanged && isolation.undoUnchanged && isolation.redoUnchanged;
    return {matches, evidence};
};

const verifyProjectLibraryInteraction = ({vm, plan, scope, driverEvidence}) => {
    const isolation = scope.verifyIsolation();
    const soundEffectPlan = plan.kind === 'sound-effect-click';
    const soundUploadPlan = plan.kind === 'sound-file-upload';
    const costumeUploadPlan = /^(?:costume|backdrop)-file-upload$/.test(plan.kind);
    const costumePaintPlan = /^(?:costume|backdrop)-paint-create$/.test(plan.kind);
    const selectedMatches = soundEffectPlan ? driverEvidence.selectedSoundMatches :
        (soundUploadPlan || costumeUploadPlan) ? driverEvidence.fileInputReady :
            costumePaintPlan ? true :
                JSON.stringify(driverEvidence.selectedLibraryItem) === JSON.stringify(plan.libraryItem);
    const pointerTravel = driverEvidence.pointerTravel || null;
    const pointerMatches = Boolean(pointerTravel && pointerTravel.completed);
    let projectMatches = false;
    if (plan.kind === 'sprite-library-select') {
        const created = driverEvidence.createdTarget;
        projectMatches = Boolean(created && !created.isStage && plan.targetRef &&
            created.name === plan.targetRef.name);
    } else if (plan.kind === 'sound-library-select' || plan.kind === 'sound-effect-click' || soundUploadPlan) {
        const editingTargetName = targetName(vm.editingTarget);
        const soundMatches = soundEffectPlan ?
            driverEvidence.editedSoundMatches : driverEvidence.addedSoundMatches;
        projectMatches = Boolean(soundMatches && plan.targetRef &&
            editingTargetName === plan.targetRef.name && vm.editingTarget &&
            Boolean(vm.editingTarget.isStage) === Boolean(plan.targetRef.isStage));
    } else {
        const editingTargetName = targetName(vm.editingTarget);
        projectMatches = Boolean(driverEvidence.addedCostumeMatches && plan.targetRef &&
            editingTargetName === plan.targetRef.name && vm.editingTarget &&
            Boolean(vm.editingTarget.isStage) === Boolean(plan.targetRef.isStage));
    }
    const evidence = {
        plan,
        pointerTravel,
        libraryVisibleBeforeSelect: driverEvidence.libraryVisibleBeforeSelect,
        selectedLibraryItem: driverEvidence.selectedLibraryItem || null,
        createdTarget: driverEvidence.createdTarget || null,
        addedCostume: driverEvidence.addedCostume || null,
        addedSound: driverEvidence.addedSound || null,
        selectedSound: driverEvidence.selectedSound || null,
        editedSound: driverEvidence.editedSound || null,
        soundVisibleBeforeSelect: driverEvidence.soundVisibleBeforeSelect,
        effectVisibleBeforeClick: driverEvidence.effectVisibleBeforeClick,
        uploadControlVisible: driverEvidence.uploadControlVisible,
        createControlVisible: driverEvidence.createControlVisible,
        fileInputReady: driverEvidence.fileInputReady,
        projectMatches,
        isolation
    };
    const controlsVisible = soundEffectPlan ?
        driverEvidence.soundVisibleBeforeSelect && driverEvidence.effectVisibleBeforeClick :
        (soundUploadPlan || costumeUploadPlan) ? driverEvidence.uploadControlVisible :
            costumePaintPlan ? driverEvidence.createControlVisible : driverEvidence.libraryVisibleBeforeSelect;
    const matches = controlsVisible && selectedMatches && pointerMatches &&
        projectMatches && isolation.journalUnchanged;
    return {matches, evidence};
};

const verifyProjectTargetOperation = ({plan, scope, driverEvidence}) => {
    const isolation = scope.verifyIsolation();
    const frames = driverEvidence.frames || [];
    const stackMoved = plan.kind !== 'cross-sprite-script-drag' || (frames.length > 1 &&
        frames.every(frame => frame.width > 0 && frame.height > 0) &&
        frames.some(frame => Math.hypot(frame.x - frames[0].x, frame.y - frames[0].y) > 8));
    const pointerTravel = driverEvidence.pointerTravel || null;
    const pointerMatches = Boolean(pointerTravel && pointerTravel.completed);
    const evidence = {
        plan,
        frames,
        stackMoved,
        pointerTravel,
        controlsVisible: driverEvidence.controlsVisible,
        sourceBlockId: driverEvidence.sourceBlockId || null,
        sourceBlockCount: driverEvidence.sourceBlockCount,
        targetBlockCount: driverEvidence.targetBlockCount,
        actualCostume: driverEvidence.actualCostume || null,
        bitmapVisualMatches: Boolean(driverEvidence.bitmapVisualMatches),
        brushStyleMatches: driverEvidence.brushStyleMatches,
        projectMatches: driverEvidence.projectMatches,
        isolation
    };
    return {
        matches: Boolean(driverEvidence.controlsVisible && pointerMatches && stackMoved &&
            driverEvidence.projectMatches &&
            driverEvidence.brushStyleMatches !== false &&
            isolation.journalUnchanged && isolation.undoUnchanged && isolation.redoUnchanged),
        evidence
    };
};

const verifyInteraction = async ({workspace, vm, plan, scope, driverEvidence, timeoutMs = 1500}) => {
    if (/^(?:block|workspace)-comment-(?:create|text|delete|minimize|resize|move)$/.test(plan.kind)) {
        return verifyCommentInteraction({workspace, plan, scope, driverEvidence, timeoutMs});
    }
    if (plan.kind === 'sprite-reorder-drag' || plan.kind === 'cross-sprite-script-drag' ||
        plan.kind === 'backpack-script-drag' || plan.kind === 'clipboard-block-paste' ||
        plan.kind === 'sound-duplicate-click' || plan.kind === 'sound-rename-input' ||
        plan.kind === 'sound-delete-click' || plan.kind === 'sound-reorder-drag' ||
        plan.kind === 'sprite-duplicate-click' || plan.kind === 'sprite-rename-input' ||
        plan.kind === 'sprite-delete-click' ||
        /^(costume|backdrop)-(?:brush-stroke|convert-to-(?:bitmap|vector))$/.test(plan.kind) ||
        /^(costume|backdrop)-(duplicate-click|rename-input|delete-click|reorder-drag)$/.test(plan.kind)) {
        return verifyProjectTargetOperation({plan, scope, driverEvidence});
    }
    if (plan.kind === 'sprite-library-select' || plan.kind === 'costume-library-select' ||
        plan.kind === 'backdrop-library-select' || plan.kind === 'sound-library-select' ||
        plan.kind === 'sound-effect-click' || plan.kind === 'sound-file-upload' ||
        /^(?:costume|backdrop)-(?:file-upload|paint-create)$/.test(plan.kind)) {
        return verifyProjectLibraryInteraction({vm, plan, scope, driverEvidence});
    }
    if (plan.kind === 'custom-procedure-dialog') {
        return verifyProcedureInteraction({workspace, vm, plan, scope, driverEvidence, timeoutMs});
    }
    if (plan.kind === 'variable-create-dialog') {
        return verifyVariableInteraction({workspace, vm, plan, scope, driverEvidence, timeoutMs});
    }
    if (plan.kind === 'variable-rename-dialog' || plan.kind === 'variable-delete-dropdown') {
        return verifyVariableLifecycle({workspace, vm, plan, scope, driverEvidence, timeoutMs});
    }
    if (plan.kind === 'broadcast-create-dialog') {
        return verifyBroadcastInteraction({workspace, vm, plan, scope, driverEvidence, timeoutMs});
    }
    if (plan.kind === 'block-field-edit') {
        return verifyFieldInteraction({workspace, vm, plan, scope, driverEvidence, timeoutMs});
    }
    const observed = await settleObserved(scope, event => observedDestination(event, plan), timeoutMs);
    const affectedBlocks = plan.affectedBlocks || [{blockId: plan.blockId, destination: plan.destination}];
    const workspaceResult = affectedBlocks.map(affected => ({
        blockId: affected.blockId,
        ...workspaceTopology(workspace, affected, {
            allowUnavailableCoordinate: observed && affected.blockId === plan.blockId &&
                !affected.destination.parentId,
            allowConnectionCoordinate: observed && affected.blockId === plan.blockId &&
                plan.destinationCoordinateIsGesturePickup
        })
    }));
    const vmResult = affectedBlocks.map(affected => ({
        blockId: affected.blockId,
        ...vmTopology(vm, affected)
    }));
    const isolation = scope.verifyIsolation();
    const synchronizedFrames = driverEvidence.frames.every(frame => (
        frame.pointer.x === frame.blockly.x && frame.pointer.y === frame.blockly.y
    ));
    const intendedPreviewOnly = driverEvidence.frames.every(frame => frame.previewTargetMatches !== false);
    const insertionMarkerRequired = Boolean(plan.destination.parentId);
    const stationaryRemainderIds = plan.splitSourceRoot ? affectedBlocks
        .filter(affected => affected.blockId !== plan.blockId && affected.source &&
            affected.source.parentId === plan.blockId && affected.destination &&
            !affected.destination.parentId)
        .map(affected => affected.blockId) : [];
    const draggedBlockIds = driverEvidence.draggedBlockIds || [];
    const isolatedPickup = !plan.splitSourceRoot || (
        draggedBlockIds.length > 0 &&
        stationaryRemainderIds.every(blockId => !draggedBlockIds.includes(blockId))
    );
    const evidence = {
        plan,
        pointerTravel: driverEvidence.pointerTravel || null,
        frames: driverEvidence.frames,
        draggedBlockIds,
        stationaryRemainderIds,
        isolatedPickup,
        synchronizedFrames,
        intendedPreviewOnly,
        insertionMarkerRequired,
        markerFrameCount: driverEvidence.frames.filter(frame => frame.markerVisible).length,
        observedEvents: scope.observed.map(normalizedEvent),
        workspace: workspaceResult,
        vm: vmResult,
        isolation
    };
    const matches = observed && workspaceResult.every(result => result.matches) &&
        vmResult.every(result => result.matches) && synchronizedFrames && intendedPreviewOnly &&
        isolatedPickup &&
        (!insertionMarkerRequired || evidence.markerFrameCount > 0) &&
        isolation.journalUnchanged && isolation.undoUnchanged &&
        isolation.redoUnchanged;
    return {matches, evidence};
};

export {verifyInteraction};
