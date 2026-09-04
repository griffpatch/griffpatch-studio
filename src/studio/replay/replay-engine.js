import {createBlockEventAction} from './block-event-action';
import {createDataStateAction} from './data-state-action';
import {analyzeTransactionEffects, compactAdjacentMoves} from './transaction-effects';

const ordered = (items, direction) => (direction === 'forward' ? items : [...items].reverse());

const resolveLocationIdentity = (location, blockAliases, vmBlockAliases) => {
    if (!location || !location.parentId) return location;
    return {
        ...location,
        parentId: blockAliases[location.parentId] || location.parentId,
        ...(vmBlockAliases[location.parentId] ? {vmParentId: vmBlockAliases[location.parentId]} : {})
    };
};

const replayDataDeltas = async (deltas, applyAction, direction) => {
    const orderedDeltas = ordered(deltas || [], direction);
    for (const delta of orderedDeltas) {
        await applyAction(createDataStateAction(delta, direction));
    }
    return orderedDeltas.length;
};

/**
 * Replay one user transaction sequentially. The injected executor owns editor
 * integration; this module owns only ordering and direction.
 *
 * @param {object} transaction journal transaction
 * @param {Function} applyAction async action executor
 * @param {'forward'|'backward'} [direction] replay direction
 * @param {object} [options] transaction lifecycle hooks
 * @param {Function} [options.beforeTransaction] called before its first event
 * @param {Function} [options.afterTransaction] called after its final event
 * @returns {Promise<object>} applied event count and prepared live block aliases
 */
const replayTransactionWithResult = async (
    transaction,
    applyAction,
    direction = 'forward',
    {
        beforeTransaction = null,
        afterTransaction = null,
        blockAliases = null,
        vmBlockAliases = null
    } = {}
) => {
    if (beforeTransaction) await beforeTransaction(transaction, direction);
    const seedAliases = {
        blockAliases: {...(blockAliases || {})},
        vmBlockAliases: {...(vmBlockAliases || {})}
    };
    const hasSeedAliases = Object.keys(seedAliases.blockAliases).length ||
        Object.keys(seedAliases.vmBlockAliases).length;
    const preparedAliases = typeof applyAction.prepareTransaction === 'function' ?
        await applyAction.prepareTransaction(
            transaction,
            direction,
            ...(hasSeedAliases ? [seedAliases] : [])
        ) : null;
    const preparedBlockAliases = preparedAliases && preparedAliases.blockAliases ?
        preparedAliases.blockAliases : preparedAliases;
    const preparedVmBlockAliases = preparedAliases && preparedAliases.vmBlockAliases;
    const transactionBlockAliases = {
        ...seedAliases.blockAliases,
        ...(preparedBlockAliases || {})
    };
    const transactionVmBlockAliases = {
        ...seedAliases.vmBlockAliases,
        ...(preparedVmBlockAliases || {})
    };
    let applied = 0;
    if (direction === 'forward') {
        applied += await replayDataDeltas(transaction.beforeDataDeltas, applyAction, direction);
    } else {
        applied += await replayDataDeltas(transaction.afterDataDeltas, applyAction, direction);
    }
    const effects = analyzeTransactionEffects(transaction, direction);
    const events = effects.replayEvents;
    const lifecycleReferences = new Map(effects.lifecycles.map(lifecycle => [
        lifecycle.blockId,
        lifecycle.blockRef
    ]));
    for (const snapshot of events) {
        const action = createBlockEventAction(snapshot, direction);
        if (transactionBlockAliases && transactionBlockAliases[snapshot.blockId]) {
            action.resolvedBlockId = transactionBlockAliases[snapshot.blockId];
        }
        if (transactionVmBlockAliases[snapshot.blockId]) {
            action.resolvedVmBlockId = transactionVmBlockAliases[snapshot.blockId];
        }
        // Native Play can regenerate the entire family. The actor AND both
        // connection endpoints must share that identity mapping when the next
        // transaction uses semantic replay. Resolve before any topology changes.
        action.previousLocation = resolveLocationIdentity(
            action.previousLocation, transactionBlockAliases, transactionVmBlockAliases);
        action.destinationLocation = resolveLocationIdentity(
            action.destinationLocation, transactionBlockAliases, transactionVmBlockAliases);
        // A flyout creation records its create event before Blockly has moved
        // the block into its final stack. On inverse replay the matching move
        // therefore owns the durable live location; the create event's own
        // reference can still point at its transient pickup coordinate.
        if (action.eventJson.type === 'delete') {
            action.blockRef = lifecycleReferences.get(snapshot.blockId) || action.blockRef;
        }
        const actionResult = await applyAction(action);
        if (actionResult && actionResult.blockAliases) {
            Object.assign(transactionBlockAliases, actionResult.blockAliases);
        }
        if (actionResult && actionResult.vmBlockAliases) {
            Object.assign(transactionVmBlockAliases, actionResult.vmBlockAliases);
        }
    }
    applied += events.length;
    if (direction === 'forward') {
        applied += await replayDataDeltas(transaction.afterDataDeltas, applyAction, direction);
    } else {
        applied += await replayDataDeltas(transaction.beforeDataDeltas, applyAction, direction);
    }
    if (afterTransaction) await afterTransaction(transaction, direction);
    return {
        appliedEventCount: applied,
        blockAliases: Object.keys(transactionBlockAliases).length ? transactionBlockAliases : null
    };
};

const replayTransaction = async (...args) => (
    await replayTransactionWithResult(...args)
).appliedEventCount;

/**
 * Replay user transactions in order. Events within one Scratch undo group are
 * applied without presentation delays; callers may pace the gaps between
 * complete user actions through `betweenTransactions`.
 *
 * @param {object} journal Studio journal
 * @param {Function} applyAction async action executor
 * @param {'forward'|'backward'} [direction] replay direction
 * @param {object} [options] journal playback options
 * @param {Function} [options.beforeTransaction] called before each transaction
 * @param {Function} [options.afterTransaction] called after each transaction
 * @param {Function} [options.betweenTransactions] presentation pacing callback
 * @returns {Promise<number>} applied event count
 */
const replayJournal = async (
    journal,
    applyAction,
    direction = 'forward',
    {beforeTransaction = null, afterTransaction = null, betweenTransactions = null} = {}
) => {
    let applied = 0;
    const transactions = ordered(journal.transactions, direction);
    for (let index = 0; index < transactions.length; index++) {
        applied += await replayTransaction(transactions[index], applyAction, direction, {
            beforeTransaction,
            afterTransaction
        });
        if (betweenTransactions && index < transactions.length - 1) {
            await betweenTransactions();
        }
    }
    return applied;
};

export {
    compactAdjacentMoves,
    replayJournal,
    replayTransaction,
    replayTransactionWithResult
};
