import MonitorRecord from 'scratch-vm/src/engine/monitor-record';

import {cloneJson} from '../lib/clone-json';
import {analyzeTransactionEffects} from '../replay/transaction-effects';
import {
    blockAtWorkspaceLocation,
    connectedInputName,
    resolveWorkspaceBlockId
} from './workspace-block-reference';
import {expectedMoves} from './transaction-topology-verifier';

const targetName = target => (target.getName ? target.getName() :
    (target.sprite && target.sprite.name) || target.id);

const targetReference = item => (item.events ? item.events[0] || item : item);

const targetMatchesReference = (target, reference) => Boolean(target && target.isOriginal !== false && (
    reference.isStage ? target.isStage :
        !target.isStage && (!reference.name || targetName(target) === reference.name)
));

const hasPortableTargetIdentity = target => Boolean(target && (
    typeof target.isStage === 'boolean' || typeof target.getName === 'function' || target.sprite
));

const resolveTargetId = (vm, item) => {
    const reference = targetReference(item);
    const runtimeTarget = vm.runtime && vm.runtime.getTargetById(reference.targetId);
    if (!vm.runtime || !reference.targetRef) return runtimeTarget ? runtimeTarget.id : reference.targetId;

    // A checkpoint restore may recycle a recorded runtime ID for another
    // original target. The portable stage/name identity is authoritative once
    // present; accept the fast ID only when it still denotes that same target.
    if (targetMatchesReference(runtimeTarget, reference.targetRef)) return runtimeTarget.id;
    // Lightweight embedding/test ports can expose only an opaque ID. In that
    // case no contradictory identity exists, so retain the exact-ID route.
    if (runtimeTarget && !hasPortableTargetIdentity(runtimeTarget)) return runtimeTarget.id;

    const match = vm.runtime.targets.find(target => targetMatchesReference(target, reference.targetRef));
    return match && match.id;
};

const selectTarget = (vm, targetId) => {
    if (vm.editingTarget && vm.editingTarget.id === targetId) return Promise.resolve();
    if (typeof vm.once !== 'function') {
        vm.setEditingTarget(targetId);
        return Promise.resolve();
    }

    return new Promise(resolve => {
        vm.once('workspaceUpdate', resolve);
        vm.setEditingTarget(targetId);
    });
};

const missingTargetError = item => {
    const reference = targetReference(item);
    const name = reference.targetRef && reference.targetRef.name;
    return new Error(`Cannot replay event for missing target: ${name || reference.targetId}`);
};

const definitionTarget = (vm, reference) => vm.runtime.targets.find(target => target.isOriginal && (
    reference.isStage ? target.isStage : !target.isStage && targetName(target) === reference.name
));

const restoreVariableDefinition = (vm, definition) => {
    if (!definition || !definition.present) return;
    const target = definitionTarget(vm, definition.targetRef);
    const variable = target && target.variables[definition.id];
    const expectedType = Object.prototype.hasOwnProperty.call(definition, 'type') ? definition.type : 'list';
    if (!variable || variable.type !== expectedType) {
        throw new Error(`Cannot restore Studio variable ${definition.name}`);
    }
    variable.value = cloneJson(definition.value);
    const monitorBlocks = vm.runtime.monitorBlocks;
    if (definition.monitorBlock && monitorBlocks && !monitorBlocks.getBlock(definition.id)) {
        monitorBlocks.createBlock(cloneJson(definition.monitorBlock));
    }
    if (definition.monitor) {
        vm.runtime.requestAddMonitor(new MonitorRecord(cloneJson(definition.monitor)));
    }
};

/**
 * Resolve a restored workspace shadow through stable parent input names when
 * Scratch has regenerated its transient block ID.
 *
 * @param {object} vm TurboWarp VM
 * @param {object} workspace visible Scratch Blocks workspace
 * @param {string} blockId recorded workspace block ID
 * @returns {string} corresponding VM block ID, or the original ID
 */
const resolveVmBlockId = (vm, workspace, blockId) => {
    const blocks = vm.editingTarget && vm.editingTarget.blocks;
    if (!blocks || typeof blocks.getBlock !== 'function' || blocks.getBlock(blockId)) return blockId;
    let workspaceBlock = workspace.getBlockById && workspace.getBlockById(blockId);
    const inputPath = [];
    while (workspaceBlock) {
        const parent = workspaceBlock.getParent && workspaceBlock.getParent();
        if (!parent) return blockId;
        const inputName = connectedInputName(parent, workspaceBlock);
        if (!inputName) return blockId;
        inputPath.unshift(inputName);
        workspaceBlock = parent;

        let vmBlock = blocks.getBlock(workspaceBlock.id);
        if (!vmBlock) continue;
        for (const name of inputPath) {
            const input = vmBlock.inputs && vmBlock.inputs[name];
            vmBlock = input && blocks.getBlock(input.block);
            if (!vmBlock) return blockId;
        }
        return vmBlock.id;
    }
    return blockId;
};

const eventForVm = (event, identities) => {
    if (Object.entries(identities).every(([key, value]) => event[key] === value)) return event;
    return Object.assign(Object.create(Object.getPrototypeOf(event)), event, identities);
};

const workspaceBlockIds = workspace => (
    typeof workspace.getAllBlocks === 'function' ?
        new Set(workspace.getAllBlocks(false).map(block => block.id)) : null
);

const createdBlockAliases = (workspace, recordedIds, beforeIds) => {
    if (!beforeIds || !Array.isArray(recordedIds) || !recordedIds.length) return null;
    const created = workspace.getAllBlocks(false).filter(block => !beforeIds.has(block.id));
    const createdIds = new Set(created.map(block => block.id));
    const roots = created.filter(block => {
        const parent = block.getParent && block.getParent();
        return !parent || !createdIds.has(parent.id);
    });
    if (roots.length !== 1 || typeof roots[0].getDescendants !== 'function') return null;
    const descendants = roots[0].getDescendants(false);
    if (descendants.length !== recordedIds.length) return null;
    return Object.fromEntries(recordedIds.map((recordedId, index) => [
        recordedId,
        descendants[index].id
    ]));
};

const recordedVmBlockAliases = (vm, recordedIds) => {
    const blocks = vm.editingTarget && vm.editingTarget.blocks;
    if (!blocks || typeof blocks.getBlock !== 'function' || !Array.isArray(recordedIds)) return null;
    return Object.fromEntries(recordedIds
        .filter(recordedId => blocks.getBlock(recordedId))
        .map(recordedId => [recordedId, recordedId]));
};

const runEventWithoutVariablePrompt = (workspace, event, actionType) => {
    if (actionType !== 'var_delete') {
        event.run(true);
        return;
    }
    const variable = workspace.getVariableById && workspace.getVariableById(event.varId);
    if (!variable || typeof workspace.deleteVariableInternal_ !== 'function' ||
        typeof workspace.getVariableUsesById !== 'function') {
        throw new Error(`Cannot silently replay variable deletion: ${event.varId}`);
    }
    workspace.deleteVariableInternal_(variable, workspace.getVariableUsesById(event.varId));
    if (typeof workspace.refreshToolboxSelection_ === 'function') {
        workspace.refreshToolboxSelection_();
    }
};

const prepareCommentEvent = (workspace, event, state) => {
    if (!state) return;
    if (state.newContents) event.newContents_ = cloneJson(state.newContents);
    if (state.newCoordinate) {
        event.newCoordinate_ = cloneJson(state.newCoordinate);
        if (typeof workspace.getWidth === 'function') event.workspaceWidth_ = workspace.getWidth();
    }
    if (Object.prototype.hasOwnProperty.call(state, 'text')) {
        event.text = state.text;
        event.xy = cloneJson(state.coordinate);
        event.width = state.width;
        event.height = state.height;
        event.minimized = state.minimized;
    }
};

const restoreCreatedCommentState = (workspace, event, state) => {
    if (event.type !== 'comment_create' || !state || !workspace.getCommentById) return;
    const comment = workspace.getCommentById(event.commentId);
    if (!comment) throw new Error(`Cannot restore created comment: ${event.commentId}`);
    if (typeof comment.setText === 'function') comment.setText(state.text);
    if (typeof comment.setSize === 'function') comment.setSize(state.width, state.height);
    if (typeof comment.setMinimized === 'function') comment.setMinimized(state.minimized);
};

/**
 * Resolve and select durable Studio target references. Replay and history
 * navigation share this port so a preparatory sprite switch cannot drift from
 * the target that will receive the transaction.
 *
 * @param {object} options target dependencies
 * @param {object} options.vm TurboWarp VM
 * @returns {object} target selection port
 */
const createScratchBlocksTargetPort = ({vm}) => ({
    current: () => (vm.editingTarget ? {
        targetId: vm.editingTarget.id,
        targetRef: {isStage: Boolean(vm.editingTarget.isStage), name: targetName(vm.editingTarget)}
    } : null),
    resolve: item => resolveTargetId(vm, item),
    isSelected: item => {
        const targetId = resolveTargetId(vm, item);
        return Boolean(targetId && vm.editingTarget && vm.editingTarget.id === targetId);
    },
    select: async item => {
        const targetId = resolveTargetId(vm, item);
        if (!targetId) throw missingTargetError(item);
        await selectTarget(vm, targetId);
        if (!vm.editingTarget || vm.editingTarget.id !== targetId) throw missingTargetError(item);
        return targetId;
    }
});

/**
 * Apply Studio replay actions through Scratch Blocks and mirror each action to
 * the VM. This is the only module that knows both APIs.
 *
 * @param {object} options bridge dependencies
 * @param {object} options.workspace visible Scratch Blocks workspace
 * @param {object} options.vm TurboWarp VM
 * @param {object} options.ScratchBlocks loaded Scratch Blocks namespace
 * @param {Function} [options.beforeAction] observer called after target selection and before mutation
 * @param {object} [options.targetPort] shared target selector
 * @returns {Function} action executor
 */
const createScratchBlocksReplayPort = ({
    workspace,
    vm,
    ScratchBlocks,
    beforeAction = null,
    targetPort = createScratchBlocksTargetPort({vm})
}) => {
    const resolveActionBlockId = (eventJson, blockRef) => (
        eventJson.type === 'create' ||
        (workspace.getBlockById && workspace.getBlockById(eventJson.blockId)) ? eventJson.blockId :
            resolveWorkspaceBlockId(workspace, blockRef, eventJson.blockId)
    );

    const resolveLocationParentId = location => {
        if (!location || !location.parentId) return null;
        return workspace.getBlockById && workspace.getBlockById(location.parentId) ? location.parentId :
            resolveWorkspaceBlockId(workspace, location.parentRef, location.parentId);
    };

    const apply = async action => {
        await targetPort.select(action);
        if (beforeAction) await beforeAction(action);

        // A final-location reference can temporarily point at the shadow that
        // the moving reporter is about to replace. Prefer the event's live ID
        // while it still exists; use the durable reference only after Scratch
        // has regenerated that ID across a checkpoint or inverse create.
        const workspaceBlockId = action.resolvedBlockId || resolveActionBlockId(action.eventJson, action.blockRef);
        const destinationParentId = resolveLocationParentId(action.destinationLocation);
        const eventIds = action.eventJson.type === 'delete' && Array.isArray(action.eventJson.ids) ?
            action.eventJson.ids.map(id => (
                id === action.eventJson.blockId ? workspaceBlockId : id
            )) : action.eventJson.ids;
        const event = ScratchBlocks.Events.fromJson({
            ...action.eventJson,
            blockId: workspaceBlockId,
            ...(eventIds ? {ids: eventIds} : {}),
            ...(destinationParentId ? {newParentId: destinationParentId} : {})
        }, workspace);
        prepareCommentEvent(workspace, event, action.commentState);
        if (action.previousLocation) {
            const previousParentId = resolveLocationParentId(action.previousLocation);
            event.oldParentId = action.previousLocation.parentId === null ? void 0 : previousParentId;
            event.oldInputName = action.previousLocation.inputName === null ?
                void 0 : action.previousLocation.inputName;
        }
        event.recordUndo = false;
        const recordedBlockId = action.eventJson.blockId;
        const vmBlocks = vm.editingTarget && vm.editingTarget.blocks;
        const vmBlockId = action.resolvedVmBlockId || (
            recordedBlockId && vmBlocks && vmBlocks.getBlock(recordedBlockId) ?
                recordedBlockId : resolveVmBlockId(vm, workspace, event.blockId)
        );
        // Resolve VM endpoints while the source graph still exists. A shadow
        // owner can itself have regenerated workspace/VM identities.
        const vmEvent = eventForVm(event, {
            blockId: vmBlockId,
            ...(event.oldParentId ? {oldParentId: (action.previousLocation && action.previousLocation.vmParentId) ||
                resolveVmBlockId(vm, workspace, event.oldParentId)} : {}),
            ...(event.newParentId ? {newParentId: (action.destinationLocation &&
                action.destinationLocation.vmParentId) || resolveVmBlockId(vm, workspace, event.newParentId)} : {})
        });
        const beforeBlockIds = action.eventJson.type === 'create' ? workspaceBlockIds(workspace) : null;

        // Workspace.undo toggles this global as well as each event's flag.
        // Scratch Blocks relies on it to permit transient top-level shadows
        // and to avoid respawning a shadow while replay replaces its input.
        const previousRecordUndo = ScratchBlocks.Events.recordUndo;
        ScratchBlocks.Events.recordUndo = false;
        ScratchBlocks.Events.disable();
        try {
            runEventWithoutVariablePrompt(workspace, event, action.eventJson.type);
            restoreCreatedCommentState(workspace, event, action.commentState);
        } finally {
            ScratchBlocks.Events.enable();
            ScratchBlocks.Events.recordUndo = previousRecordUndo;
        }
        vm.blockListener(vmEvent);
        restoreVariableDefinition(vm, action.listDefinition);
        return {
            blockAliases: action.eventJson.type === 'create' ?
                createdBlockAliases(workspace, action.eventJson.ids, beforeBlockIds) : null,
            vmBlockAliases: action.eventJson.type === 'create' ?
                recordedVmBlockAliases(vm, action.eventJson.ids) : null
        };
    };

    const targetFields = transaction => {
        const event = transaction.events[0] || transaction;
        return {targetId: event.targetId || transaction.targetId, targetRef: event.targetRef || null};
    };

    const destinationFields = destination => {
        if (destination.parentId) {
            return {
                newParentId: destination.parentId,
                ...(destination.inputName ? {newInputName: destination.inputName} : {})
            };
        }
        return {
            newCoordinate: `${destination.coordinate.x},${destination.coordinate.y}`
        };
    };

    const orderedByLocation = (moves, locationName) => {
        const byId = new Map(moves.map(move => [move.blockId, move]));
        const visiting = new Set();
        const visited = new Set();
        const result = [];
        const visit = move => {
            if (visited.has(move.blockId)) return;
            if (visiting.has(move.blockId)) throw new Error('Recorded block topology contains a cycle');
            visiting.add(move.blockId);
            const location = move[locationName] || {};
            const parent = location.parentId && byId.get(location.parentId);
            if (parent) visit(parent);
            visiting.delete(move.blockId);
            visited.add(move.blockId);
            result.push(move);
        };
        moves.forEach(visit);
        return result;
    };

    const orderedDestinations = moves => orderedByLocation(moves, 'destination');

    apply.replayMoveTransaction = async (transaction, direction, {blockAliases = null} = {}) => {
        const effects = analyzeTransactionEffects(transaction, direction);
        const moves = expectedMoves(transaction, direction);
        const target = targetFields(transaction);
        const aliases = new Map(blockAliases ? Object.entries(blockAliases) : []);
        const resolved = orderedByLocation(moves, 'source').map(move => {
            const aliasedBlock = aliases.has(move.blockId) ? workspace.getBlockById(aliases.get(move.blockId)) : null;
            const sourceBlock = blockAtWorkspaceLocation(workspace, move.source, aliases);
            const blockId = aliasedBlock && (!move.blockType || aliasedBlock.type === move.blockType) ?
                aliasedBlock.id : sourceBlock && (!move.blockType || sourceBlock.type === move.blockType) ?
                    sourceBlock.id : resolveActionBlockId({type: 'move', blockId: move.blockId}, move.blockRef);
            if (blockId) aliases.set(move.blockId, blockId);
            return {...move, liveBlockId: blockId};
        });
        const primary = effects.primaryMove;
        const sourceHealed = Boolean(primary && primary.source && primary.source.parentId &&
            moves.some(move => move.blockId !== primary.blockId && move.source &&
                move.source.parentId === primary.blockId && move.destination &&
                move.destination.parentId === primary.source.parentId &&
                move.destination.inputName === primary.source.inputName));
        const excludedBlockIds = sourceHealed ? new Set([aliases.get(primary.blockId)]) : null;

        // Resolve every destination parent while the complete source graph is
        // still intact. A post-gesture reference may be rooted at the moving
        // substack, so first substitute its recorded ancestor with the live
        // alias discovered from the directional source topology. When Blockly
        // healed the source gap, the recorded path is one statement shorter;
        // skip the still-connected moving root while resolving that path.
        resolved.forEach(move => {
            const destination = move.destination;
            if (!destination || !destination.parentId || aliases.has(destination.parentId)) return;
            const liveParentId = resolveWorkspaceBlockId(
                workspace,
                destination.parentRef,
                workspace.getBlockById(destination.parentId) ? destination.parentId : null,
                {aliases, excludedBlockIds}
            );
            if (liveParentId) aliases.set(destination.parentId, liveParentId);
        });

        // Detach every affected block first. This prevents a reverse middle-
        // stack insertion from briefly asking Blockly to connect a block below
        // one of its own descendants.
        for (const move of resolved) {
            const block = workspace.getBlockById(move.liveBlockId);
            if (!block) throw new Error(`Cannot replay move for missing block: ${move.blockId}`);
            const parent = block.getParent && block.getParent();
            const coordinate = block.getRelativeToSurfaceXY();
            await apply({
                ...target,
                blockRef: move.blockRef,
                eventJson: {
                    type: 'move',
                    blockId: move.liveBlockId,
                    newCoordinate: `${coordinate.x},${coordinate.y}`
                },
                previousLocation: {
                    parentId: parent ? parent.id : null,
                    inputName: parent ? connectedInputName(parent, block) || null : null
                }
            });
        }

        const finalMoves = orderedDestinations(resolved.map(move => {
            const destination = move.destination.parentId && aliases.has(move.destination.parentId) ? {
                ...move.destination,
                parentId: aliases.get(move.destination.parentId)
            } : move.destination;
            return {...move, blockId: move.liveBlockId, destination};
        }));
        for (const move of finalMoves) {
            await apply({
                ...target,
                blockRef: move.blockRef,
                eventJson: {
                    type: 'move',
                    blockId: move.liveBlockId,
                    ...destinationFields(move.destination)
                },
                destinationLocation: move.destination,
                previousLocation: {parentId: null, inputName: null}
            });
        }
        return {
            appliedEventCount: resolved.length * 2,
            // These aliases must be captured before detaching anything. A
            // recorded block reference describes the transaction's starting
            // topology and may point at a different block after the inverse
            // topology has been rebuilt.
            blockAliases: Object.fromEntries(aliases)
        };
    };

    apply.prepareTransaction = async (
        transaction,
        direction,
        {blockAliases = null, vmBlockAliases = null} = {}
    ) => {
        await targetPort.select(transaction);
        const aliases = {...(blockAliases || {})};
        const vmAliases = {...(vmBlockAliases || {})};
        const effects = analyzeTransactionEffects(transaction, direction);
        const enteringBlockIds = new Set(effects.lifecycles
            .filter(lifecycle => lifecycle.kind === 'enter')
            .map(lifecycle => lifecycle.blockId));
        effects.lifecycles
            .filter(lifecycle => lifecycle.kind === 'exit')
            .forEach(lifecycle => {
                const move = effects.moves.find(candidate => candidate.blockId === lifecycle.blockId);
                const aliasedBlock = aliases[lifecycle.blockId] ?
                    workspace.getBlockById(aliases[lifecycle.blockId]) : null;
                const sourceBlock = move && blockAtWorkspaceLocation(workspace, move.source, aliases);
                const resolvedId = aliasedBlock ? aliasedBlock.id :
                    sourceBlock && (!move.blockType || sourceBlock.type === move.blockType) ?
                        sourceBlock.id : resolveActionBlockId(
                            {type: 'delete', blockId: lifecycle.blockId},
                            lifecycle.blockRef
                        );
                if (resolvedId) {
                    aliases[lifecycle.blockId] = resolvedId;
                    vmAliases[lifecycle.blockId] = resolveVmBlockId(vm, workspace, resolvedId);
                }
            });
        effects.survivingMoves.filter(move => !enteringBlockIds.has(move.blockId)).forEach(move => {
            const aliasedBlock = aliases[move.blockId] ? workspace.getBlockById(aliases[move.blockId]) : null;
            const sourceBlock = blockAtWorkspaceLocation(workspace, move.source, aliases);
            const resolvedId = aliasedBlock && (!move.blockType || aliasedBlock.type === move.blockType) ?
                aliasedBlock.id : sourceBlock && (!move.blockType || sourceBlock.type === move.blockType) ?
                    sourceBlock.id : resolveActionBlockId(
                        {type: 'move', blockId: move.blockId},
                        move.blockRef
                    );
            if (resolvedId) {
                aliases[move.blockId] = resolvedId;
                vmAliases[move.blockId] = resolveVmBlockId(vm, workspace, resolvedId);
            }
        });
        return {blockAliases: aliases, vmBlockAliases: vmAliases};
    };

    return apply;
};

export {
    createScratchBlocksReplayPort,
    createScratchBlocksTargetPort,
    resolveVmBlockId
};
