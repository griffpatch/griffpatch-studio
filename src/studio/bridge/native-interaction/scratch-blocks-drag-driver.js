import {resolveWorkspaceBlockId} from '../workspace-block-reference';
import {combinePointerTravels} from './dom-interaction';
import {createExtensionLibraryDriver} from './extension-library-driver';
import {CONNECTION_PREVIEW_PROGRESS, generatedPath, movementEaseInOut} from './interaction-clock';
import {resolvePlaybackBlockId} from './playback-block-resolver';
import {createElementPointerTarget} from './pointer-target';
import {createScratchBlocksFlyoutPort} from './scratch-blocks-flyout-port';

const TOP_LEVEL_CORRECTION_LIMIT = 6;
const TOP_LEVEL_CORRECTION_GAIN = 1.5;
const CONNECTED_APPROACH_CLEARANCE_PX = 72;
const TARGET_PREVIEW_APPROACH_PROGRESS = CONNECTION_PREVIEW_PROGRESS;
const NO_EXTENSION_DRIVER = {
    ensureForBlock: () => Promise.resolve({cancelled: false, loaded: false, pointerTravel: null})
};

const createSnapGate = (gesture, target) => {
    const setTarget = value => {
        if (typeof gesture.setConnectionPreviewTarget === 'function') gesture.setConnectionPreviewTarget(value);
    };
    let suppressed = false;
    return {
        suppress: () => {
            setTarget(null);
            suppressed = true;
        },
        restore: () => {
            if (!suppressed) return;
            setTarget(target);
            suppressed = false;
        },
        dispose: () => setTarget(void 0)
    };
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

const connectionForDestination = (workspace, destination) => {
    if (!destination.parentId) return null;
    const parent = workspace.getBlockById(destination.parentId);
    if (!parent) throw new Error(`Native drag destination parent is missing: ${destination.parentId}`);
    if (destination.inputName) {
        const input = parent.getInput(destination.inputName);
        if (!input || !input.connection) {
            throw new Error(`Native drag destination input is missing: ${destination.inputName}`);
        }
        return input.connection;
    }
    if (!parent.nextConnection) throw new Error('Native drag destination has no statement connection');
    return parent.nextConnection;
};

const resolveDestination = (
    workspace,
    destination,
    aliases = new Map(),
    {excludedBlockIds = null} = {}
) => {
    if (!destination || !destination.parentId) return destination;
    const aliasedParentId = typeof aliases.get === 'function' ?
        aliases.get(destination.parentId) : aliases[destination.parentId];
    if (aliasedParentId) {
        return {...destination, parentId: aliasedParentId};
    }
    const referencedParentId = resolveWorkspaceBlockId(
        workspace,
        destination.parentRef,
        null,
        {excludedBlockIds}
    );
    if (referencedParentId) return {...destination, parentId: referencedParentId};
    if (workspace.getBlockById(destination.parentId)) return destination;
    return {
        ...destination,
        parentId: resolveWorkspaceBlockId(
            workspace,
            destination.parentRef,
            destination.parentId,
            {excludedBlockIds}
        )
    };
};

const resolveAndAliasDestination = (workspace, destination, aliases, options = {}) => {
    const resolved = resolveDestination(workspace, destination, aliases, options);
    // The native driver resolves a durable recorded parent before the gesture
    // mutates its input topology. Retain that identity alongside created/moved
    // block aliases so the transaction-level verifier does not have to follow
    // a path which the insertion itself has just changed.
    if (destination && destination.parentId && resolved && resolved.parentId) {
        aliases.set(destination.parentId, resolved.parentId);
    }
    return resolved;
};

const resolvePlan = (workspace, plan, existingAliases = new Map()) => {
    const aliases = new Map(existingAliases);
    const primaryId = resolvePlaybackBlockId(workspace, plan, aliases);
    aliases.set(plan.blockId, primaryId);
    const affectedBlocks = (plan.affectedBlocks || []).map(affected => {
        const resolvedId = aliases.get(affected.blockId) || resolvePlaybackBlockId(
            workspace, affected, aliases
        );
        aliases.set(affected.blockId, resolvedId);
        return {...affected, blockId: resolvedId};
    });
    // A middle statement move records its durable destination path after
    // Blockly has healed the source stack. Before the gesture, that same path
    // contains the block about to be removed and can therefore land one step
    // early. Apply only the induced source-heal evidence from this transaction
    // while resolving the destination; a dragged compound stack has no such
    // induced tail move and is left untouched.
    const sourceHealed = (plan.affectedBlocks || []).some(affected => (
        affected.blockId !== plan.blockId &&
        affected.source && affected.source.parentId === plan.blockId &&
        affected.destination && plan.source &&
        affected.destination.parentId === plan.source.parentId &&
        affected.destination.inputName === plan.source.inputName
    ));
    const resolutionOptions = sourceHealed ? {excludedBlockIds: new Set([primaryId])} : {};
    const source = resolveAndAliasDestination(workspace, plan.source, aliases);
    const destination = resolveAndAliasDestination(
        workspace,
        plan.destination,
        aliases,
        resolutionOptions
    );
    const resolvedAffectedBlocks = affectedBlocks.map(affected => ({
        ...affected,
        source: resolveAndAliasDestination(workspace, affected.source, aliases),
        destination: resolveAndAliasDestination(
            workspace,
            affected.destination,
            aliases,
            resolutionOptions
        )
    }));
    return {
        ...plan,
        blockId: primaryId,
        source,
        destination,
        blockAliases: Object.fromEntries(aliases),
        affectedBlocks: resolvedAffectedBlocks
    };
};

const resolveSettledDestinations = (workspace, plan) => {
    const blockAliases = {...plan.blockAliases};
    // Native unplugging recreates empty input shadows with fresh IDs. Resolve
    // them only after the gesture, from their recorded owning socket. Never
    // resolve a not-yet-created shadow against the before-state graph.
    for (const shadow of plan.createdShadows || []) {
        const destination = resolveDestination(workspace, shadow.destination, blockAliases);
        const parent = destination && workspace.getBlockById(destination.parentId);
        const block = parent && parent.getInputTargetBlock(destination.inputName);
        if (!block || !block.isShadow()) throw new Error('Native restored input shadow is missing');
        blockAliases[shadow.blockId] = block.id;
    }
    return {
        ...plan,
        blockAliases,
        // The primary parent was resolved before the gesture. Preserve that live
        // ID after insertion: following its recorded path again can now land on
        // the newly inserted block itself because the path's topology changed.
        destination: plan.destination.parentId && workspace.getBlockById(plan.destination.parentId) ?
            plan.destination : resolveDestination(workspace, plan.destination, plan.blockAliases),
        affectedBlocks: (plan.affectedBlocks || []).map(affected => ({
            ...affected,
            destination: affected.destination.parentId && workspace.getBlockById(affected.destination.parentId) ?
                affected.destination : resolveDestination(workspace, affected.destination, plan.blockAliases)
        }))
    };
};

const resolveCreatedPlan = (workspace, plan, createdBlock, existingAliases = new Map()) => {
    const aliases = new Map(existingAliases);
    aliases.set(plan.blockId, createdBlock.id);
    const affectedBlocks = (plan.affectedBlocks || []).map(affected => {
        const resolvedId = aliases.get(affected.blockId) || resolvePlaybackBlockId(
            workspace, affected, aliases
        );
        aliases.set(affected.blockId, resolvedId);
        return {...affected, blockId: resolvedId};
    });
    const destination = resolveAndAliasDestination(workspace, plan.destination, aliases);
    const resolvedAffectedBlocks = affectedBlocks.map(affected => ({
        ...affected,
        source: resolveAndAliasDestination(workspace, affected.source, aliases),
        destination: resolveAndAliasDestination(workspace, affected.destination, aliases)
    }));
    return {
        ...plan,
        blockId: createdBlock.id,
        source: resolveAndAliasDestination(workspace, plan.source, aliases),
        blockAliases: Object.fromEntries(aliases),
        destination,
        affectedBlocks: resolvedAffectedBlocks
    };
};

const sourceConnectionFor = (block, destinationConnection) => {
    if (!destinationConnection) return null;
    if (block.outputConnection && block.outputConnection.checkType_(destinationConnection)) {
        return block.outputConnection;
    }
    if (block.previousConnection && block.previousConnection.checkType_(destinationConnection)) {
        return block.previousConnection;
    }
    throw new Error('Native drag source has no compatible destination connection');
};

// An insertion which adopts the old occupant into a statement input is a wrap,
// not an ordinary previous-to-next insertion. Aim the recorded receiving input
// at that occupant's previous connection, and gate the native preview there.
// This is inferred from topology rather than a list of C-block opcodes.
const enclosingConnections = (workspace, block, plan, aliases = new Map()) => {
    const occupant = (plan.affectedBlocks || []).find(affected => (
        affected.blockId !== plan.blockId && affected.destination &&
        affected.destination.parentId === plan.blockId && affected.destination.inputName &&
        affected.source && plan.destination &&
        affected.source.parentId === plan.destination.parentId &&
        affected.source.inputName === plan.destination.inputName
    ));
    if (!occupant) return null;
    const input = block.getInput && block.getInput(occupant.destination.inputName);
    const child = workspace.getBlockById(resolvePlaybackBlockId(workspace, occupant, aliases));
    const source = input && input.connection;
    const target = child && child.previousConnection;
    if (!source || !target || !source.checkType_(target)) return null;
    return {source, target};
};

const connectionClientPoint = (workspace, connection) => {
    const canvas = workspace && workspace.getCanvas && workspace.getCanvas();
    const matrix = canvas && canvas.getScreenCTM && canvas.getScreenCTM();
    if (!matrix || !Number.isFinite(connection.x_) || !Number.isFinite(connection.y_)) return null;
    return {
        x: (matrix.a * connection.x_) + (matrix.c * connection.y_) + matrix.e,
        y: (matrix.b * connection.x_) + (matrix.d * connection.y_) + matrix.f
    };
};

const blockConnections = block => [
    block.outputConnection,
    block.previousConnection,
    block.nextConnection,
    ...(block.inputList || []).map(input => input.connection)
].filter(Boolean);

const OPPOSITE_CONNECTION_TYPE = Object.freeze({1: 2, 2: 1, 3: 4, 4: 3});

const flyoutSnapCenters = ({workspace, prepared, start}) => {
    if (!workspace.getAllBlocks) return [];
    const flyoutWorkspace = prepared.sourceWorkspace ||
        (prepared.flyout && prepared.flyout.getWorkspace && prepared.flyout.getWorkspace());
    const sources = blockConnections(prepared.block)
        .map(connection => ({
            connection,
            point: connectionClientPoint(flyoutWorkspace, connection),
            targetType: OPPOSITE_CONNECTION_TYPE[connection.type]
        }))
        .filter(source => source.point && source.targetType);
    if (!sources.length) return [];
    const targets = workspace.getAllBlocks(false)
        .reduce((connections, block) => connections.concat(blockConnections(block)), []);
    return sources.reduce((centers, source) => centers.concat(targets
        .filter(connection => connection.type === source.targetType)
        .map(connection => connectionClientPoint(workspace, connection))
        .filter(Boolean)
        .map(point => ({
            x: point.x + start.x - source.point.x,
            y: point.y + start.y - source.point.y
        }))), []);
};

const flyoutConnectionEndpoint = ({workspace, prepared, plan, aliases, start}) => {
    const destination = resolveDestination(workspace, plan.destination, aliases);
    const enclosing = enclosingConnections(workspace, prepared.block, plan, aliases);
    const targetConnection = enclosing ? enclosing.target : connectionForDestination(workspace, destination);
    if (!targetConnection) return null;
    const sourceConnection = enclosing ? enclosing.source : sourceConnectionFor(prepared.block, targetConnection);
    const flyoutWorkspace = prepared.sourceWorkspace ||
        (prepared.flyout && prepared.flyout.getWorkspace && prepared.flyout.getWorkspace());
    const sourcePoint = connectionClientPoint(flyoutWorkspace, sourceConnection);
    const targetPoint = connectionClientPoint(workspace, targetConnection);
    if (!sourcePoint || !targetPoint) return null;
    return {
        x: targetPoint.x + start.x - sourcePoint.x,
        y: targetPoint.y + start.y - sourcePoint.y
    };
};

const connectedFlyoutPath = (workspace, start, end, frameCount, snapCenters = []) => {
    const distance = Math.hypot(end.x - start.x, end.y - start.y);
    if (distance < 0.01) return [{...end}];
    const unit = {x: (end.x - start.x) / distance, y: (end.y - start.y) / distance};
    const perpendicular = {x: -unit.y, y: unit.x};
    const bendMagnitude = Math.min(28, distance * 0.045);
    const clearance = Math.max(CONNECTED_APPROACH_CLEARANCE_PX, Math.min(120, workspace.scale * 32));
    const relevantCenters = snapCenters.filter(point => Math.hypot(point.x - end.x, point.y - end.y) > 2);
    const cubicPoint = (bend, progress, target) => {
        const first = {
            x: start.x + ((target.x - start.x) * 0.32) + (perpendicular.x * bend),
            y: start.y + ((target.y - start.y) * 0.32) + (perpendicular.y * bend)
        };
        const second = {
            x: start.x + ((target.x - start.x) * 0.78) - (perpendicular.x * bend * 0.2),
            y: start.y + ((target.y - start.y) * 0.78) - (perpendicular.y * bend * 0.2)
        };
        const inverse = 1 - progress;
        return {
            x: ((inverse ** 3) * start.x) + (3 * inverse * inverse * progress * first.x) +
                (3 * inverse * progress * progress * second.x) + ((progress ** 3) * target.x),
            y: ((inverse ** 3) * start.y) + (3 * inverse * inverse * progress * first.y) +
                (3 * inverse * progress * progress * second.y) + ((progress ** 3) * target.y)
        };
    };
    const scoreBend = bend => Array.from({length: 11}, (_, index) => (
        cubicPoint(bend, (index + 1) / 12, end)
    )).reduce((score, point) => score + relevantCenters.reduce((pointScore, center) => {
        const proximity = clearance - Math.hypot(point.x - center.x, point.y - center.y);
        return pointScore + (proximity > 0 ? proximity * proximity : 0);
    }, 0), 0);
    const preferredBend = workspace.RTL ? -bendMagnitude : bendMagnitude;
    const bend = [preferredBend, -preferredBend]
        .sort((left, right) => scoreBend(left) - scoreBend(right))[0];

    // Keep the actual drag visually consistent with the natural pointer model:
    // one compact diagonal S-curve, a tiny overshoot, then a short recoil onto
    // the exact Blockly connection before mouse-up.
    const recoilFrames = Math.min(4, Math.max(2, Math.round(frameCount * 0.16)));
    const travelFrames = Math.max(2, frameCount - recoilFrames);
    const overshootDistance = Math.min(6, distance * 0.02);
    const overshoot = {
        x: end.x + (unit.x * overshootDistance),
        y: end.y + (unit.y * overshootDistance)
    };
    const points = Array.from({length: travelFrames + 1}, (_, index) => (
        cubicPoint(bend, movementEaseInOut(index / travelFrames), overshoot)
    ));
    return points.concat(Array.from({length: recoilFrames}, (_, index) => {
        const progress = (index + 1) / recoilFrames;
        const eased = progress * progress * (3 - (2 * progress));
        return {
            x: overshoot.x + ((end.x - overshoot.x) * eased),
            y: overshoot.y + ((end.y - overshoot.y) * eased)
        };
    }));
};

const topLevelReorderConnections = (workspace, block, plan) => {
    const displaced = (plan.affectedBlocks || []).find(affected => (
        affected.blockId !== plan.blockId &&
        affected.source && !affected.source.parentId && affected.source.coordinate &&
        affected.destination && affected.destination.parentId
    ));
    const displacedBlock = displaced && workspace.getBlockById(displaced.blockId);
    const draggedTail = displaced && workspace.getBlockById(displaced.destination.parentId);
    const source = (draggedTail && draggedTail.nextConnection) || block.nextConnection;
    const target = displacedBlock && displacedBlock.previousConnection;
    if (!source || !target || (source.checkType_ && !source.checkType_(target))) return null;
    return {source, target};
};

const destinationDelta = (workspace, block, plan) => {
    const enclosing = enclosingConnections(workspace, block, plan);
    if (enclosing) {
        return {
            x: enclosing.target.x_ - enclosing.source.x_,
            y: enclosing.target.y_ - enclosing.source.y_
        };
    }
    const destination = plan.destination;
    if (destination.coordinate) {
        const reorder = plan.topLevelPrepend || plan.destinationCoordinateIsGesturePickup ?
            topLevelReorderConnections(workspace, block, plan) : null;
        if (reorder) {
            return {
                x: reorder.target.x_ - reorder.source.x_,
                y: reorder.target.y_ - reorder.source.y_
            };
        }
        const current = block.getRelativeToSurfaceXY();
        if (!current) throw new Error('Native drag source has no top-level coordinate after pickup');
        return {x: destination.coordinate.x - current.x, y: destination.coordinate.y - current.y};
    }
    const target = connectionForDestination(workspace, destination);
    const source = sourceConnectionFor(block, target);
    return {x: target.x_ - source.x_, y: target.y_ - source.y_};
};

const markerVisible = gesture => {
    if (typeof gesture.getConnectionPreview === 'function') {
        return Boolean((gesture.getConnectionPreview() || {}).visible);
    }
    return Boolean(gesture.blockDragger_ && gesture.blockDragger_.draggedConnectionManager_ &&
        (gesture.blockDragger_.draggedConnectionManager_.markerConnection_ ||
            gesture.blockDragger_.draggedConnectionManager_.highlightingBlock_));
};

const draggedBlockIds = block => {
    if (!block) return [];
    const descendants = typeof block.getDescendants === 'function' ? block.getDescendants(false) : [block];
    return descendants.map(descendant => descendant && descendant.id).filter(Boolean);
};

const previewTarget = (workspace, block, plan) => {
    const enclosing = enclosingConnections(workspace, block, plan);
    if (enclosing) return enclosing.target;
    if (plan.destination.parentId) return connectionForDestination(workspace, plan.destination);
    const reorder = plan.topLevelPrepend || plan.destinationCoordinateIsGesturePickup ?
        topLevelReorderConnections(workspace, block, plan) : null;
    return reorder ? reorder.target : null;
};

const previewEvidence = (gesture, target) => {
    if (typeof gesture.getConnectionPreview !== 'function') return {};
    const preview = gesture.getConnectionPreview();
    return {
        previewTargetMatches: !preview || !preview.visible || preview.targetConnection === target,
        previewTargetId: preview && preview.targetConnection ? preview.targetConnection.getSourceBlock().id : null
    };
};

const verifyDropPreview = (gesture, target) => {
    if (!target || typeof gesture.getConnectionPreview !== 'function') return;
    const preview = gesture.getConnectionPreview();
    if (!preview || !preview.visible || preview.targetConnection !== target) {
        throw new Error('The intended native drop preview was not acquired');
    }
};

const shouldHealSourceStack = (block, plan) => {
    const parent = block.getParent && block.getParent();
    const next = block.getNextBlock && block.getNextBlock();
    if (!parent || !next) return false;
    return (plan.affectedBlocks || []).some(affected =>
        affected.blockId === next.id && affected.destination && affected.destination.parentId === parent.id
    );
};

const shouldSplitSourceRoot = (block, plan) => {
    if (!plan.splitSourceRoot || (block.getParent && block.getParent())) return false;
    const next = block.getNextBlock && block.getNextBlock();
    if (!next) return false;
    return (plan.affectedBlocks || []).some(affected => (
        affected.blockId === next.id && affected.source && affected.source.parentId === block.id &&
        affected.destination && !affected.destination.parentId
    ));
};

const correctNearbyTopLevelDestination = ({workspace, block, plan, gesture, pointer, end, frames, scope}) => {
    const destination = plan.destination;
    if (!destination.coordinate || plan.topLevelPrepend || plan.destinationCoordinateIsGesturePickup) return end;
    let correctedEnd = end;
    for (let correction = 0; correction < TOP_LEVEL_CORRECTION_LIMIT; correction += 1) {
        const actual = block.getRelativeToSurfaceXY && block.getRelativeToSurfaceXY();
        if (!actual) break;
        const residual = {
            x: destination.coordinate.x - actual.x,
            y: destination.coordinate.y - actual.y
        };
        const nearby = Math.abs(residual.x) < 1 && Math.abs(residual.y) < 1;
        const serializedCoordinateMatches = (
            Math.round(actual.x) === Math.round(destination.coordinate.x) &&
            Math.round(actual.y) === Math.round(destination.coordinate.y)
        );
        const needsCorrection = Math.abs(residual.x) > 0.01 || Math.abs(residual.y) > 0.01;
        if (!nearby || !needsCorrection || serializedCoordinateMatches) break;
        correctedEnd = {
            x: correctedEnd.x + (residual.x * workspace.scale * TOP_LEVEL_CORRECTION_GAIN),
            y: correctedEnd.y + (residual.y * workspace.scale * TOP_LEVEL_CORRECTION_GAIN)
        };
        pointer.moveTo(correctedEnd);
        const moveEvent = eventAt('mousemove', correctedEnd, workspace.getInjectionDiv());
        scope.runWithoutUndo(() => gesture.handleMove(moveEvent));
        frames.push({
            index: frames.length,
            pointer: correctedEnd,
            blockly: {x: moveEvent.clientX, y: moveEvent.clientY},
            markerVisible: markerVisible(gesture),
            coordinateCorrection: true,
            correction: correction + 1
        });
    }
    return correctedEnd;
};

const correctSettledTopLevelDestination = ({workspace, block, plan, pointer, end, frames, scope}) => {
    const destination = plan.destination;
    if (!destination.coordinate || plan.topLevelPrepend || plan.destinationCoordinateIsGesturePickup ||
        !block.moveBy) return end;
    const parent = block.getParent && block.getParent();
    const actual = block.getRelativeToSurfaceXY && block.getRelativeToSurfaceXY();
    if (parent || !actual) return end;
    const residual = {
        x: destination.coordinate.x - actual.x,
        y: destination.coordinate.y - actual.y
    };
    const nearby = Math.abs(residual.x) < 1 && Math.abs(residual.y) < 1;
    const serializedCoordinateMatches = (
        Math.round(actual.x) === Math.round(destination.coordinate.x) &&
        Math.round(actual.y) === Math.round(destination.coordinate.y)
    );
    if (!nearby || serializedCoordinateMatches) return end;
    const correctedEnd = {
        x: end.x + (residual.x * workspace.scale),
        y: end.y + (residual.y * workspace.scale)
    };
    pointer.moveTo(correctedEnd);
    scope.runWithoutUndo(() => block.moveBy(residual.x, residual.y));
    frames.push({
        index: frames.length,
        pointer: correctedEnd,
        blockly: correctedEnd,
        markerVisible: false,
        coordinateCorrection: true,
        postDropCoordinateCorrection: true
    });
    return correctedEnd;
};

/**
 * Drive an existing block through the pinned Scratch Blocks gesture package.
 * All private inspection is contained here and is evidence-only.
 *
 * @param {object} options driver dependencies
 * @returns {object} native drag driver
 */
const createScratchBlocksDragDriver = ({
    workspace,
    vm,
    ScratchBlocks = null,
    documentObject = null,
    clock,
    pointer,
    scope,
    aliases = new Map(),
    flyoutPort = createScratchBlocksFlyoutPort({workspace, ScratchBlocks, aliases}),
    extensionDriver = vm && documentObject ?
        createExtensionLibraryDriver({vm, workspace, documentObject, clock, pointer, scope}) : NO_EXTENSION_DRIVER
}) => {
    const playFlyout = async (plan, signal = null) => {
        if (workspace.currentGesture_) throw new Error('Cannot start native playback during an active gesture');
        const extension = await extensionDriver.ensureForBlock(plan.blockType, signal);
        if (extension.cancelled) {
            return {cancelled: true, frames: [], resolvedPlan: plan, pointerTravel: extension.pointerTravel};
        }
        const prepared = await flyoutPort.prepare(plan);
        const rect = prepared.block.getSvgRoot().getBoundingClientRect();
        const grab = plan.presentation.grabOffset;
        const initialStart = {x: rect.left + grab.x, y: rect.top + grab.y};
        const pointerTravel = plan.presentation.pointerTravel && pointer.travelTo ? await pointer.travelTo(
            createElementPointerTarget({
                id: `flyout:${plan.blockType}`,
                kind: 'flyout-block',
                locate: () => prepared.block.getSvgRoot(),
                anchorX: grab.x,
                anchorY: grab.y
            }),
            {clock, signal}
        ) : null;
        if (pointerTravel && !pointerTravel.completed) {
            return {
                cancelled: true,
                frames: [],
                resolvedPlan: plan,
                pointerTravel: combinePointerTravels({
                    extension: extension.pointerTravel,
                    block: pointerTravel
                })
            };
        }
        const start = pointerTravel ? pointerTravel.target.point : initialStart;
        const startEvent = eventAt('mousedown', start, prepared.block.getSvgRoot());
        // A cloned connection keeps the flyout workspace's coordinates until
        // Blockly has processed an ordinary drag frame. Capture both source
        // and destination in client pixels before pickup so different flyout
        // and workspace scales cannot skew the eventual native drop.
        const connectedEnd = flyoutConnectionEndpoint({
            workspace,
            prepared,
            plan,
            aliases,
            start
        });
        const snapCenters = flyoutSnapCenters({workspace, prepared, start});
        if (!pointerTravel) pointer.moveTo(start);
        if (typeof pointer.press === 'function') pointer.press();
        let pointerPressed = true;
        const gesture = scope.runWithoutUndo(() => flyoutPort.beginGesture({
            ...prepared,
            event: startEvent
        }));
        const stationaryOptions = workspace.options || null;
        const disableStationaryAlignment = Boolean(
            stationaryOptions && !plan.destination.parentId &&
            stationaryOptions.snapDraggedBlockToConnection
        );
        const previousStationaryAlignment = disableStationaryAlignment ?
            stationaryOptions.snapDraggedBlockToConnection : null;
        if (disableStationaryAlignment) stationaryOptions.snapDraggedBlockToConnection = false;
        // Wrapping resolves its existing occupant from the recorded before
        // topology. Other drops use the already-resolved destination; never
        // re-walk a final path after source healing has changed that path.
        const enclosing = enclosingConnections(workspace, prepared.block, plan, aliases);
        const gateTarget = enclosing ? enclosing.target : previewTarget(workspace, prepared.block, {
            ...plan,
            destination: resolveDestination(workspace, plan.destination, aliases)
        });
        const snapGate = createSnapGate(gesture, gateTarget);
        snapGate.suppress();
        const frames = [];
        let finished = false;
        try {
            const pickup = flyoutPort.pickupPoint({...prepared, start});
            pointer.moveTo(pickup);
            const pickupEvent = eventAt('mousemove', pickup, workspace.getInjectionDiv());
            scope.runWithoutUndo(() => gesture.handleMove(pickupEvent));
            const block = flyoutPort.createdBlock(gesture);
            if (!block || !workspace.getBlockById(block.id)) {
                throw new Error('Scratch Blocks did not clone the flyout block');
            }
            let resolvedPlan = resolveCreatedPlan(workspace, plan, block, aliases);
            frames.push({
                index: 0,
                pointer: pickup,
                blockly: {x: pickupEvent.clientX, y: pickupEvent.clientY},
                markerVisible: markerVisible(gesture),
                flyoutPickup: true,
                ...previewEvidence(gesture, gateTarget)
            });
            const delta = destinationDelta(workspace, block, resolvedPlan);
            // A flyout clone's rendered block follows the hysteresis pickup,
            // but its connection coordinates still describe the original
            // flyout position until the first ordinary drag frame. For a
            // connected destination, basing the endpoint on `pickup` repeats
            // that hysteresis delta and leaves the visible block exactly one
            // pickup step to the right of its insertion marker before mouseup.
            const destinationOrigin = resolvedPlan.destination.parentId ? start : pickup;
            let end = connectedEnd || {
                x: destinationOrigin.x + (delta.x * workspace.scale),
                y: destinationOrigin.y + (delta.y * workspace.scale)
            };
            const points = resolvedPlan.destination.parentId || snapCenters.length ? connectedFlyoutPath(
                workspace,
                pickup,
                end,
                plan.presentation.frameCount,
                snapCenters
            ) : generatedPath(pickup, end, plan.presentation.frameCount);
            snapGate.suppress();
            const completed = await clock.play({
                points,
                holdFrames: plan.presentation.markerHoldFrames,
                signal,
                onFrame: (point, index) => {
                    if (index >= points.length * TARGET_PREVIEW_APPROACH_PROGRESS) snapGate.restore();
                    pointer.moveTo(point);
                    const moveEvent = eventAt('mousemove', point, workspace.getInjectionDiv());
                    scope.runWithoutUndo(() => gesture.handleMove(moveEvent));
                    frames.push({
                        index: index + 1,
                        pointer: {x: point.x, y: point.y},
                        blockly: {x: moveEvent.clientX, y: moveEvent.clientY},
                        markerVisible: markerVisible(gesture),
                        ...previewEvidence(gesture, gateTarget)
                    });
                }
            });
            if (!completed) return {cancelled: true, frames, resolvedPlan};
            verifyDropPreview(gesture, gateTarget);
            end = correctNearbyTopLevelDestination({
                workspace,
                block,
                plan: resolvedPlan,
                gesture,
                pointer,
                end,
                frames,
                scope
            });
            const upEvent = eventAt('mouseup', end, workspace.getInjectionDiv());
            scope.runWithoutUndo(() => gesture.handleUp(upEvent));
            if (typeof pointer.release === 'function') pointer.release();
            pointerPressed = false;
            end = correctSettledTopLevelDestination({
                workspace,
                block,
                plan: resolvedPlan,
                pointer,
                end,
                frames,
                scope
            });
            resolvedPlan = resolveSettledDestinations(workspace, resolvedPlan);
            finished = true;
            const combinedPointerTravel = extension.pointerTravel || pointerTravel ? combinePointerTravels({
                extension: extension.pointerTravel,
                block: pointerTravel
            }) : null;
            return {
                cancelled: false,
                frames,
                resolvedPlan,
                pointerTravel: combinedPointerTravel
            };
        } finally {
            snapGate.dispose();
            if (disableStationaryAlignment) {
                stationaryOptions.snapDraggedBlockToConnection = previousStationaryAlignment;
            }
            if (pointerPressed && typeof pointer.release === 'function') pointer.release();
            if (!finished && workspace.currentGesture_ === gesture) {
                scope.runWithoutUndo(() => gesture.cancel());
            }
        }
    };

    const existingDriver = {
        play: async (plan, signal = null) => {
            if (workspace.currentGesture_) throw new Error('Cannot start native playback during an active gesture');
            const resolvedPlan = resolvePlan(workspace, plan, aliases);
            const block = workspace.getBlockById(resolvedPlan.blockId);
            if (!block) throw new Error(`Native drag source block is missing: ${plan.blockId}`);

            const rect = block.getSvgRoot().getBoundingClientRect();
            const grab = plan.presentation.grabOffset;
            const initialStart = {x: rect.left + grab.x, y: rect.top + grab.y};
            const frames = [];
            const pointerTravel = plan.presentation.pointerTravel && pointer.travelTo ? await pointer.travelTo(
                createElementPointerTarget({
                    id: `workspace-block:${resolvedPlan.blockId}`,
                    kind: 'workspace-block',
                    locate: () => block.getSvgRoot(),
                    anchorX: grab.x,
                    anchorY: grab.y
                }),
                {clock, signal}
            ) : null;
            if (pointerTravel && !pointerTravel.completed) {
                return {cancelled: true, frames, resolvedPlan, pointerTravel};
            }
            const start = pointerTravel ? pointerTravel.target.point : initialStart;
            const startEvent = eventAt('mousedown', start, workspace.getInjectionDiv());
            const gesture = workspace.getGesture(startEvent);
            if (!gesture) throw new Error('Scratch Blocks refused the native gesture');
            if (!pointerTravel) pointer.moveTo(start);
            if (typeof pointer.press === 'function') pointer.press();
            let pointerPressed = true;
            const gateTarget = previewTarget(workspace, block, resolvedPlan);
            const snapGate = createSnapGate(gesture, gateTarget);
            snapGate.suppress();
            let healedDestinationDelta = null;
            if (shouldSplitSourceRoot(block, resolvedPlan)) {
                // Scratch can move the current root into its own remainder as
                // one gesture. Separate only that root at pickup so the former
                // second block stays visually fixed while the pointer carries
                // the root into the recorded descendant connection.
                scope.runWithoutUndo(() => block.unplug(true));
            } else if (shouldHealSourceStack(block, resolvedPlan)) {
                scope.runWithoutUndo(() => block.unplug(true));
                // Starting Blockly's drag creates an insertion marker at the old
                // gap. That marker temporarily pushes a healed destination down by
                // the dragged block's height, so preserve the genuine connection
                // geometry before forceStartBlockDrag mutates it.
                healedDestinationDelta = destinationDelta(workspace, block, resolvedPlan);
            }
            scope.runWithoutUndo(() => gesture.forceStartBlockDrag(startEvent, block));
            const pickedUpBlockIds = draggedBlockIds(block);

            let finished = false;
            try {
            // Connected blocks do not necessarily expose a surface coordinate
            // until Blockly has picked them up and detached them for dragging.
                const delta = healedDestinationDelta || destinationDelta(workspace, block, resolvedPlan);
                let end = {
                    x: start.x + (delta.x * workspace.scale),
                    y: start.y + (delta.y * workspace.scale)
                };
                const points = generatedPath(start, end, plan.presentation.frameCount);
                const completed = await clock.play({
                    points,
                    holdFrames: plan.presentation.markerHoldFrames,
                    signal,
                    onFrame: (point, index) => {
                        if (index >= points.length * TARGET_PREVIEW_APPROACH_PROGRESS) snapGate.restore();
                        pointer.moveTo(point);
                        const moveEvent = eventAt('mousemove', point, workspace.getInjectionDiv());
                        scope.runWithoutUndo(() => gesture.handleMove(moveEvent));
                        frames.push({
                            index,
                            pointer: {x: point.x, y: point.y},
                            blockly: {x: moveEvent.clientX, y: moveEvent.clientY},
                            markerVisible: markerVisible(gesture),
                            ...previewEvidence(gesture, gateTarget)
                        });
                    }
                });
                if (!completed) return {cancelled: true, frames, resolvedPlan};
                verifyDropPreview(gesture, gateTarget);
                end = correctNearbyTopLevelDestination({
                    workspace,
                    block,
                    plan: resolvedPlan,
                    gesture,
                    pointer,
                    end,
                    frames,
                    scope
                });
                const upEvent = eventAt('mouseup', end, workspace.getInjectionDiv());
                scope.runWithoutUndo(() => gesture.handleUp(upEvent));
                if (typeof pointer.release === 'function') pointer.release();
                pointerPressed = false;
                end = correctSettledTopLevelDestination({
                    workspace,
                    block,
                    plan: resolvedPlan,
                    pointer,
                    end,
                    frames,
                    scope
                });
                finished = true;
                return {
                    cancelled: false,
                    frames,
                    draggedBlockIds: pickedUpBlockIds,
                    pointerTravel,
                    resolvedPlan: resolveSettledDestinations(workspace, resolvedPlan)
                };
            } finally {
                snapGate.dispose();
                if (pointerPressed && typeof pointer.release === 'function') pointer.release();
                if (!finished && workspace.currentGesture_ === gesture) {
                    scope.runWithoutUndo(() => gesture.cancel());
                }
            }
        }
    };
    return {
        play: (plan, signal = null) => (
            ['flyout-block-drag', 'workspace-block-copy'].includes(plan.kind) ?
                playFlyout(plan, signal) : existingDriver.play(plan, signal)
        )
    };
};

export {
    createScratchBlocksDragDriver,
    enclosingConnections,
    resolveCreatedPlan,
    resolvePlan,
    resolveSettledDestinations
};
