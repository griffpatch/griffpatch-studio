import {analyzeTransactionEffects} from '../replay/transaction-effects';

const LIFECYCLE_OFFSET_X_PX = 40;
const LIFECYCLE_OFFSET_Y_PX = 24;

const lifecycleOffsetFromEffects = (effects, blockId) => {
    const move = effects.moves.find(candidate => candidate.blockId === blockId);
    const destination = move && move.destination;
    if (!destination) return {x: LIFECYCLE_OFFSET_X_PX, y: LIFECYCLE_OFFSET_Y_PX, kind: 'detached'};
    if (destination.inputName) {
        return {x: LIFECYCLE_OFFSET_X_PX, y: LIFECYCLE_OFFSET_Y_PX, kind: 'input'};
    }
    if (destination.parentId) {
        const displaced = effects.moves.some(candidate => candidate.blockId !== blockId &&
            candidate.destination && candidate.destination.parentId === blockId);
        return displaced ?
            {x: LIFECYCLE_OFFSET_X_PX, y: 0, kind: 'insert'} :
            {x: 0, y: LIFECYCLE_OFFSET_Y_PX, kind: 'append'};
    }
    return {x: LIFECYCLE_OFFSET_X_PX, y: LIFECYCLE_OFFSET_Y_PX, kind: 'detached'};
};

/**
 * Compile presentation intent without touching rendered Blockly state. Undo
 * uses the same recorded connection shape as Redo and simply reverses the
 * lifecycle kind and motion vector in the renderer.
 *
 * @param {object} transaction Studio transaction
 * @param {'forward'|'backward'} direction traversal direction
 * @returns {object} fast-history presentation plan
 */
const compileHistoryPresentationPlan = (transaction, direction) => {
    const effects = analyzeTransactionEffects(transaction, direction);
    const recordedEffects = direction === 'forward' ? effects : analyzeTransactionEffects(transaction, 'forward');
    const lifecycles = effects.lifecycles
        // A shadow-only lifecycle is induced by replacing an input. It belongs
        // to the rendered shape of the owning reporter, not a separate proxy.
        .filter(lifecycle => !lifecycle.isShadow)
        .map(lifecycle => {
            const recordedMove = recordedEffects.moves.find(move => move.blockId === lifecycle.blockId);
            return {
                blockId: lifecycle.blockId,
                blockIds: lifecycle.blockIds,
                blockRef: lifecycle.blockRef,
                blockType: recordedMove && recordedMove.blockType,
                kind: lifecycle.kind,
                offset: lifecycleOffsetFromEffects(recordedEffects, lifecycle.blockId),
                sourceCoordinate: recordedMove && recordedMove.source && recordedMove.source.coordinate
            };
        });
    return {
        direction,
        moveOnly: effects.moveOnly,
        primaryMoveBlockId: recordedEffects.primaryMove && recordedEffects.primaryMove.blockId,
        lifecycles,
        parallelLifecycle: lifecycles.some(lifecycle => lifecycle.offset.kind === 'input')
    };
};

export {
    LIFECYCLE_OFFSET_X_PX,
    LIFECYCLE_OFFSET_Y_PX,
    compileHistoryPresentationPlan
};
