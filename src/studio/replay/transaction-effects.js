const DIRECTIONS = new Set(['forward', 'backward']);

const ordered = (items, direction) => (direction === 'forward' ? items : [...items].reverse());

const variableDependencyPriority = (event, direction) => {
    if (event.type !== 'var_create' && event.type !== 'var_delete') return 1;
    const createsDefinition = (event.type === 'var_create') === (direction === 'forward');
    return createsDefinition ? 0 : 2;
};

const dependencyOrdered = (events, direction) => ordered(events, direction)
    .map((event, index) => ({event, index, priority: variableDependencyPriority(event, direction)}))
    .sort((left, right) => left.priority - right.priority || left.index - right.index)
    .map(({event}) => event);

const sameLocation = (left, right) => JSON.stringify(left) === JSON.stringify(right);

const hasGestureDetachOrAttach = move => move.events.some(event => {
    const oldLocation = event.details.oldLocation || {};
    const newLocation = event.details.newLocation || {};
    return Boolean(oldLocation.parentId && newLocation.coordinate) ||
        Boolean(oldLocation.coordinate && newLocation.parentId);
});

const lifecycleXml = event => event.details && (
    event.type === 'create' ? event.details.xml : event.details.oldXml
);

const isShadowLifecycle = event => /^\s*<shadow(?:\s|>)/i.test(lifecycleXml(event) || '');

/**
 * Scratch Blocks can deliver one logical drag as adjacent move events in
 * separate browser queues. Collapse that noise once so replay, verification,
 * native planning and presentation all reason about the same transaction.
 *
 * @param {Array<object>} events recorded transaction events
 * @returns {Array<object>} events with adjacent moves for one block compacted
 */
const compactAdjacentMoves = events => {
    const compacted = [];
    (events || []).forEach(event => {
        const previous = compacted[compacted.length - 1];
        const sameMove = previous && previous.type === 'move' && event.type === 'move' &&
            previous.blockId === event.blockId && previous.workspaceId === event.workspaceId;
        if (!sameMove) {
            compacted.push(event);
            return;
        }
        compacted[compacted.length - 1] = {
            ...previous,
            recordedAtMs: event.recordedAtMs,
            endedAtMs: event.endedAtMs,
            blockRef: event.blockRef || previous.blockRef || null,
            blockType: event.blockType || previous.blockType || null,
            forwardJson: event.forwardJson ? {
                ...previous.forwardJson,
                ...event.forwardJson
            } : previous.forwardJson,
            details: {
                ...previous.details,
                newLocation: event.details.newLocation
            }
        };
    });
    return compacted;
};

const finalPresence = (events, direction) => {
    const presence = new Map();
    ordered(events, direction).forEach(event => {
        if (!['create', 'delete'].includes(event.type)) return;
        const effectiveType = direction === 'forward' ? event.type :
            (event.type === 'create' ? 'delete' : 'create');
        const ids = event.details.ids || (event.blockId ? [event.blockId] : []);
        ids.forEach(id => presence.set(id, effectiveType === 'create'));
    });
    return presence;
};

const moveEffect = (blockId, events, direction) => {
    const destinationEvent = direction === 'forward' ? events[events.length - 1] : events[0];
    const sourceEvent = direction === 'forward' ? events[0] : events[events.length - 1];
    const destination = direction === 'forward' ?
        destinationEvent.details.newLocation : destinationEvent.details.oldLocation;
    const source = direction === 'forward' ?
        sourceEvent.details.oldLocation : sourceEvent.details.newLocation;
    return {
        blockId,
        blockType: destinationEvent.blockType || null,
        blockRef: destinationEvent.blockRef || null,
        source,
        destination,
        events,
        eventCount: events.length,
        changed: events.some(event => !sameLocation(event.details.oldLocation, event.details.newLocation))
    };
};

const inferredGestureBlockId = forwardMoves => {
    const changed = forwardMoves.filter(move => move.changed);
    if (!changed.length) return null;

    // Explicit pickup-and-drop events for the same block are stronger gesture
    // evidence than topology inferred from surrounding moves. In particular,
    // a two-command rotation can otherwise make the exposed remainder look
    // like an insertion candidate when the repeatedly moved block is known.
    const repeatedlyMoved = changed.find(move => move.eventCount > 1);
    if (repeatedlyMoved) return repeatedlyMoved.blockId;

    // Inserting one existing command into an occupied statement connection
    // produces two induced moves around the real drag: the displaced tail
    // leaves the destination parent and reconnects beneath the dragged block.
    // Blockly can report the newly top-level source remainder first, so event
    // order alone is not a gesture identity.
    const inserted = changed.find(move => move.destination && move.destination.parentId &&
        changed.some(displaced => displaced.blockId !== move.blockId &&
            displaced.source && displaced.source.parentId === move.destination.parentId &&
            displaced.destination && displaced.destination.parentId === move.blockId));
    if (inserted) return inserted.blockId;

    // Retain delivery order only for genuinely indistinguishable rotations
    // such as a two-command swap with one move event per affected block.
    return changed[0].blockId;
};

/**
 * Reduce one transaction to its directional semantic effects. This is the
 * shared source of truth for replay admission, native planning, topology
 * verification and fast-history presentation.
 *
 * @param {object} transaction Studio transaction
 * @param {'forward'|'backward'} direction traversal direction
 * @returns {object} directional transaction effects
 */
const analyzeTransactionEffects = (transaction, direction) => {
    if (!DIRECTIONS.has(direction)) throw new Error(`Unknown transaction direction: ${direction}`);
    const events = transaction.events || [];
    const compactedEvents = compactAdjacentMoves(events);
    const presence = finalPresence(events, direction);
    const moveEvents = events.filter(event => event.type === 'move' && event.blockId);
    const moveIds = [...new Set(moveEvents.map(event => event.blockId))];
    const rawMoves = moveIds.map(blockId => moveEffect(
        blockId,
        moveEvents.filter(event => event.blockId === blockId),
        direction
    ));
    const forwardMoves = direction === 'forward' ? rawMoves : moveIds.map(blockId => moveEffect(
        blockId,
        moveEvents.filter(event => event.blockId === blockId),
        'forward'
    ));
    const recordedGesture = events.map(event => event.gesture).find(gesture => (
        gesture && gesture.source === 'scratch-blocks-drag' &&
        forwardMoves.some(move => move.blockId === gesture.blockId)
    ));
    // New recordings carry the dragger's actual pickup identity. Inference is
    // retained only for older journals and non-gesture programmatic edits.
    const gestureBlockId = recordedGesture ? recordedGesture.blockId : inferredGestureBlockId(forwardMoves);
    const moves = rawMoves.map(move => {
        const topLevelPrepend = Boolean(
            direction === 'forward' &&
            move.blockId === gestureBlockId &&
            move.source && move.source.parentId &&
            move.destination && !move.destination.parentId && move.destination.coordinate &&
            rawMoves.some(other => other.blockId !== move.blockId &&
                other.destination && other.destination.parentId && (
                other.destination.parentId === move.blockId ||
                (other.source && !other.source.parentId && other.source.coordinate)
            ))
        );
        return {
            ...move,
            topLevelPrepend,
            destinationCoordinateIsGesturePickup: topLevelPrepend && Boolean(
                move.events[move.events.length - 1].details.oldLocation.parentId
            )
        };
    });
    const survivingMoves = moves.filter(move => presence.get(move.blockId) !== false);
    const changedMoves = moves.filter(move => move.changed);
    const primaryMove = changedMoves.find(move => move.blockId === gestureBlockId) || null;
    const primaryAmbiguous = !recordedGesture && Boolean(primaryMove) && !hasGestureDetachOrAttach(primaryMove) &&
        changedMoves.some(move => move.blockId !== primaryMove.blockId &&
            move.eventCount >= primaryMove.eventCount);

    const seenLifecycleRoots = new Set();
    const lifecycles = [];
    ordered(events, direction).forEach(event => {
        if (!['create', 'delete'].includes(event.type)) return;
        const effectiveType = direction === 'forward' ? event.type :
            (event.type === 'create' ? 'delete' : 'create');
        const blockId = event.blockId || (event.details.ids && event.details.ids[0]);
        if (!blockId || seenLifecycleRoots.has(blockId)) return;
        const present = effectiveType === 'create';
        if (presence.get(blockId) !== present) return;
        const move = moves.find(candidate => candidate.blockId === blockId);
        const finalForwardMove = move && move.events[move.events.length - 1];
        const blockRef = direction === 'backward' && !present && finalForwardMove ?
            finalForwardMove.blockRef : (move ? move.blockRef : event.blockRef || null);
        seenLifecycleRoots.add(blockId);
        lifecycles.push({
            blockId,
            blockIds: event.details.ids || [blockId],
            blockRef,
            kind: present ? 'enter' : 'exit',
            isShadow: isShadowLifecycle(event)
        });
    });

    // Blockly XML fields refer to variable IDs. A flyout gesture can record
    // the block create before the variable event which satisfied that field
    // in the live workspace. Replaying that literal delivery order makes
    // Scratch Blocks invent a replacement variable ID. Restore definitions
    // before dependent XML and remove them only after dependent blocks.
    const replayEvents = dependencyOrdered(compactedEvents, direction).filter(event => !(
        event.type === 'move' && presence.get(event.blockId) === false
    ));
    const hasDataDeltas = Boolean(
        (transaction.beforeDataDeltas || []).length || (transaction.afterDataDeltas || []).length
    );
    // Moving a reporter restores the old socket's shadow and removes the new
    // socket's shadow. These are owned input shapes, not independent actors.
    const shadowIds = new Set(events.filter(isShadowLifecycle)
        .reduce((ids, event) => ids.concat(event.details.ids || [event.blockId]), []));
    const motionMoves = changedMoves.filter(move => !shadowIds.has(move.blockId));
    return {
        direction,
        events,
        compactedEvents,
        replayEvents,
        presence,
        moves,
        survivingMoves,
        changedMoves,
        motionMoves,
        primaryMove,
        recordedGesture: recordedGesture || null,
        primaryAmbiguous,
        lifecycles,
        hasDataDeltas,
        // Presentation may still animate a block-only move transaction which
        // carries authored data deltas; native admission checks those separately.
        moveOnly: motionMoves.length > 0 && events.every(event => event.type === 'move' || isShadowLifecycle(event))
    };
};

export {analyzeTransactionEffects, compactAdjacentMoves};
