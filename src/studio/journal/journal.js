import {cloneJson} from '../lib/clone-json';
import {isSemanticallyNullCommentChange} from './snapshot-block-event';

const JOURNAL_SCHEMA_VERSION = 1;
const MAX_TRANSACTION_PAUSE_MS = 30000;
const DEFAULT_TARGET_SELECTION_PAUSE_MS = 500;

const validPause = value => Number.isFinite(value) && value >= 0 && value <= MAX_TRANSACTION_PAUSE_MS;

const targetSelectionPause = journal => {
    const value = journal?.presentation?.targetSelectionPauseMs;
    return typeof value === 'undefined' ? DEFAULT_TARGET_SELECTION_PAUSE_MS : value;
};

const setTargetSelectionPause = (journal, pauseMs) => {
    if (!validPause(pauseMs)) {
        throw new RangeError(`Studio sprite pause must be between 0 and ${MAX_TRANSACTION_PAUSE_MS} ms`);
    }
    return {...cloneJson(journal), presentation: {...journal.presentation, targetSelectionPauseMs: pauseMs}};
};

const createJournal = ({
    id,
    createdAtMs,
    baseCheckpointId = null,
    baseProjectHash = null,
    endProjectHash = null,
    endProject = null,
    endProjectCompatibility = null,
    projectHashKind = null
}) => {
    const journal = {
        schemaVersion: JOURNAL_SCHEMA_VERSION,
        id,
        createdAtMs,
        baseCheckpointId,
        baseProjectHash,
        endProjectHash,
        endProject,
        endProjectCompatibility,
        presentation: {targetSelectionPauseMs: DEFAULT_TARGET_SELECTION_PAUSE_MS},
        transactions: []
    };
    if (projectHashKind) journal.projectHashKind = projectHashKind;
    return journal;
};

const belongsToTransaction = (transaction, snapshot) => Boolean(
    snapshot.group &&
    transaction.sourceGroup === snapshot.group &&
    transaction.targetId === snapshot.targetId
);

const createdBlockIds = event => new Set([
    event && event.blockId,
    ...((event && event.details && event.details.ids) || [])
].filter(Boolean));

const createsMultipleBlocks = event => {
    const xml = event && event.details && event.details.xml;
    return Boolean(xml && (xml.match(/<block(?:\s|>)/gi) || []).length > 1);
};

const adoptsUngroupedCreate = (transaction, snapshot) => {
    if (!transaction || transaction.kind || transaction.targetId !== snapshot.targetId) return false;
    const inducedPlacement = !snapshot.group && snapshot.recordUndo === false;
    if (transaction.events.length !== 1 && !inducedPlacement) return false;
    const created = transaction.events.find(event => event.type === 'create');
    if (!created) return false;
    const ownedIds = createdBlockIds(created);
    const multiBlockCreate = ownedIds.size > 1 || createsMultipleBlocks(created);
    const splitMultiBlockPlacement = transaction.sourceGroup && multiBlockCreate;
    if (!snapshot.group && !inducedPlacement) return false;
    return (!transaction.sourceGroup || splitMultiBlockPlacement || inducedPlacement) &&
        created.type === 'create' && snapshot.type === 'move' &&
        (ownedIds.has(snapshot.blockId) || inducedPlacement);
};

const coordinatesMatch = (first, second) => {
    if (!first || !second) return first === second;
    return Math.abs(first.x - second.x) < 1e-6 && Math.abs(first.y - second.y) < 1e-6;
};

const locationsMatch = (first, second) => Boolean(first && second &&
    first.parentId === second.parentId &&
    first.inputName === second.inputName &&
    coordinatesMatch(first.coordinate, second.coordinate));

const cancelsSettledMove = (transaction, snapshot) => {
    if (!transaction || transaction.kind || transaction.targetId !== snapshot.targetId ||
        snapshot.type !== 'move' || snapshot.group || snapshot.recordUndo !== false ||
        transaction.events.length !== 1) return false;
    const moved = transaction.events[0];
    return moved.type === 'move' && moved.blockId === snapshot.blockId &&
        locationsMatch(moved.details.oldLocation, snapshot.details.newLocation) &&
        locationsMatch(moved.details.newLocation, snapshot.details.oldLocation);
};

const capturedValue = captured => (captured && captured.kind === 'value' ? captured.value : void 0);

const isBroadcastCreate = event => Boolean(event && event.type === 'var_create' && event.details &&
    event.details.varType === 'broadcast_msg' && event.details.varId);

const isBroadcastSelection = (event, varId) => Boolean(event && event.type === 'change' && event.details &&
    event.details.element === 'field' && event.details.name === 'BROADCAST_OPTION' &&
    capturedValue(event.details.newValue) === varId);

const adoptsBroadcastSelection = (transaction, snapshot) => {
    if (!transaction || transaction.kind || transaction.targetId !== snapshot.targetId ||
        transaction.events.length !== 1) return false;
    const created = transaction.events[0];
    return isBroadcastCreate(created) && isBroadcastSelection(snapshot, created.details.varId);
};

const lateCommentChangeAfterDelete = (transaction, snapshot) => {
    if (!transaction || transaction.kind || transaction.targetId !== snapshot.targetId ||
        snapshot.type !== 'comment_change' || transaction.events.length !== 1) return false;
    const deleted = transaction.events[0];
    return deleted.type === 'comment_delete' && deleted.commentId === snapshot.commentId &&
        deleted.blockId === snapshot.blockId;
};

const continuesTransaction = (transaction, snapshot) => (
    belongsToTransaction(transaction, snapshot) || adoptsUngroupedCreate(transaction, snapshot) ||
    adoptsBroadcastSelection(transaction, snapshot) || cancelsSettledMove(transaction, snapshot)
);

const snapshotStartsTransaction = (journal, snapshot) => {
    const last = journal.transactions[journal.transactions.length - 1];
    return !last || !continuesTransaction(last, snapshot);
};

/**
 * Append one captured event, preserving order and Scratch Blocks action groups.
 * Ungrouped events remain separate user actions.
 *
 * @param {object} journal Studio journal
 * @param {object} snapshot durable block-event snapshot
 * @param {object} [presentation] optional transaction presentation state
 * @param {?object} [presentation.viewport] scale-independent workspace origin
 * @returns {object} a new journal
 */
const appendSnapshot = (journal, snapshot, {viewport = null} = {}) => {
    const next = cloneJson(journal);
    const event = cloneJson(snapshot);
    if (isSemanticallyNullCommentChange(event)) return next;
    const last = next.transactions[next.transactions.length - 1];

    if (last && cancelsSettledMove(last, event)) {
        next.transactions.pop();
        return next;
    }

    if (last && lateCommentChangeAfterDelete(last, event)) {
        // Scratch commits a focused comment textarea while the Remove Comment
        // click is already being handled. Its event queue can consequently
        // deliver delete before the logically earlier text change. Store the
        // edit first so every intermediate timeline cursor is replayable.
        next.transactions.pop();
        next.transactions.push({
            id: `transaction-${next.transactions.length + 1}`,
            targetId: event.targetId,
            sourceGroup: event.group || null,
            startedAtMs: event.recordedAtMs,
            endedAtMs: event.recordedAtMs,
            events: [event],
            ...(viewport ? {viewport: cloneJson(viewport)} : {})
        });
        next.transactions.push({
            ...last,
            id: `transaction-${next.transactions.length + 1}`
        });
        return next;
    }

    if (last && continuesTransaction(last, event)) {
        if (adoptsUngroupedCreate(last, event) && event.group) last.sourceGroup = event.group;
        last.events.push(event);
        last.endedAtMs = event.recordedAtMs;
        if (viewport) last.viewport = cloneJson(viewport);
        return next;
    }

    const transaction = {
        id: `transaction-${next.transactions.length + 1}`,
        targetId: event.targetId,
        sourceGroup: event.group || null,
        startedAtMs: event.recordedAtMs,
        endedAtMs: event.recordedAtMs,
        events: [event]
    };
    if (viewport) transaction.viewport = cloneJson(viewport);
    next.transactions.push(transaction);
    return next;
};

/**
 * Repair journals recorded before adjacent event-order normalization. This
 * includes reporter pickup followed by a drag, the historical broadcast
 * capture order and a comment edit delivered after its delete event.
 *
 * @param {object} journal Studio journal
 * @returns {object} journal with adjacent split gestures coalesced
 */
const coalesceUngroupedCreates = journal => {
    const next = cloneJson(journal);
    const transactions = [];
    next.transactions.forEach(transaction => {
        // This migration repairs legacy Blockly event ordering only. Semantic
        // transactions deliberately have no Blockly events, so they must pass
        // through unchanged when a persisted journal is resumed.
        if (transaction.kind) {
            transactions.push(transaction);
            return;
        }
        transaction.events = transaction.events.filter(event => !isSemanticallyNullCommentChange(event));
        if (!transaction.events.length) return;
        const previous = transactions[transactions.length - 1];
        const first = transaction.events && transaction.events[0];
        if (previous && transaction.events.length === 1 && cancelsSettledMove(previous, first)) {
            transactions.pop();
            return;
        }
        const previousEvent = previous && previous.events && previous.events.length === 1 &&
            previous.events[0];
        const currentEvent = transaction.events && transaction.events.length === 1 &&
            transaction.events[0];
        if (previous && currentEvent && lateCommentChangeAfterDelete(previous, currentEvent)) {
            transactions[transactions.length - 1] = transaction;
            transactions.push(previous);
            return;
        }
        const orderedBroadcast = previousEvent && currentEvent && isBroadcastCreate(previousEvent) &&
            isBroadcastSelection(currentEvent, previousEvent.details.varId);
        const invertedBroadcast = previousEvent && currentEvent && isBroadcastCreate(currentEvent) &&
            isBroadcastSelection(previousEvent, currentEvent.details.varId);
        if (previous && previous.targetId === transaction.targetId && (orderedBroadcast || invertedBroadcast)) {
            previous.events = orderedBroadcast ? [previousEvent, currentEvent] : [currentEvent, previousEvent];
            previous.endedAtMs = Math.max(previous.endedAtMs, transaction.endedAtMs);
            if (transaction.viewport) previous.viewport = transaction.viewport;
            if (transaction.afterDataDeltas) {
                previous.afterDataDeltas = [
                    ...(previous.afterDataDeltas || []),
                    ...transaction.afterDataDeltas
                ];
            }
            return;
        }
        if (!previous || !first || !adoptsUngroupedCreate(previous, first) ||
            transaction.sourceGroup !== first.group) {
            transactions.push(transaction);
            return;
        }
        if (transaction.sourceGroup) previous.sourceGroup = transaction.sourceGroup;
        previous.events.push(...transaction.events);
        previous.endedAtMs = transaction.endedAtMs;
        if (transaction.viewport) previous.viewport = transaction.viewport;
        if (transaction.afterDataDeltas) {
            previous.afterDataDeltas = [
                ...(previous.afterDataDeltas || []),
                ...transaction.afterDataDeltas
            ];
        }
    });
    next.transactions = transactions.map((transaction, index) => ({
        ...transaction,
        id: `transaction-${index + 1}`
    }));
    return next;
};

/**
 * Append one direct list-editor gesture as a visible history transaction.
 * Consecutive mutations with the same short-lived gesture group (for example,
 * Enter committing an item and inserting the next row) remain one step.
 *
 * @param {object} journal Studio journal
 * @param {object} edit semantic list edit
 * @returns {object} a new journal
 */
const appendDataEdit = (journal, edit) => {
    const next = cloneJson(journal);
    const last = next.transactions[next.transactions.length - 1];
    if (last && last.kind === 'data-edit' && last.sourceGroup === edit.group &&
        last.targetId === edit.targetId) {
        last.afterDataDeltas.push(cloneJson(edit.delta));
        last.endedAtMs = edit.recordedAtMs;
        return next;
    }
    next.transactions.push({
        id: `transaction-${next.transactions.length + 1}`,
        kind: 'data-edit',
        targetId: edit.targetId,
        targetRef: cloneJson(edit.targetRef),
        sourceGroup: edit.group,
        dataEditLabel: edit.label || null,
        startedAtMs: edit.recordedAtMs,
        endedAtMs: edit.recordedAtMs,
        events: [],
        afterDataDeltas: [cloneJson(edit.delta)]
    });
    return next;
};

/**
 * Append one project-lifecycle operation backed by exact before/after
 * checkpoints. Asset bytes and generated target IDs remain checkpoint-owned;
 * the journal stores only durable references and the restore boundary IDs.
 *
 * @param {object} journal Studio journal
 * @param {object} operation captured project operation
 * @returns {object} a new journal
 */
const appendProjectOperation = (journal, operation) => {
    const next = cloneJson(journal);
    next.transactions.push({
        id: `transaction-${next.transactions.length + 1}`,
        kind: 'project-operation',
        targetId: operation.targetId || null,
        targetRef: cloneJson(operation.targetRef || null),
        sourceGroup: null,
        startedAtMs: operation.recordedAtMs,
        endedAtMs: operation.recordedAtMs,
        events: [],
        operation: cloneJson(operation)
    });
    next.endProjectHash = null;
    next.endProject = null;
    next.endProjectCompatibility = null;
    return next;
};

const DATA_DELTA_FIELDS = {
    before: 'beforeDataDeltas',
    after: 'afterDataDeltas'
};

/**
 * Add a data delta inside an existing visible transaction. Multiple dirty
 * intervals remain separate internally but replay as one user step.
 *
 * @param {object} journal Studio journal
 * @param {number} transactionIndex target transaction index
 * @param {'before'|'after'} phase apply before or after block events
 * @param {object} delta authored data delta
 * @returns {object} a new journal
 */
const appendTransactionDataDelta = (journal, transactionIndex, phase, delta) => {
    const field = DATA_DELTA_FIELDS[phase];
    if (!field) throw new Error(`Invalid Studio data delta phase: ${phase}`);
    if (!journal.transactions[transactionIndex]) {
        throw new RangeError(`Invalid Studio transaction index: ${transactionIndex}`);
    }
    const next = cloneJson(journal);
    const transaction = next.transactions[transactionIndex];
    transaction[field] = [...(transaction[field] || []), cloneJson(delta)];
    next.endProjectHash = null;
    next.endProject = null;
    next.endProjectCompatibility = null;
    return next;
};

/**
 * Keep the applied transaction prefix when authoring branches after undo.
 * The previous end hash no longer describes the edited head.
 *
 * @param {object} journal Studio journal
 * @param {number} transactionCount number of transactions to retain
 * @returns {object} a new journal
 */
const truncateTransactions = (journal, transactionCount) => {
    const next = cloneJson(journal);
    if (!Number.isInteger(transactionCount) || transactionCount < 0 ||
        transactionCount > next.transactions.length) {
        throw new RangeError(`Invalid Studio transaction count: ${transactionCount}`);
    }
    next.transactions = next.transactions.slice(0, transactionCount);
    next.endProjectHash = null;
    next.endProject = null;
    next.endProjectCompatibility = null;
    return next;
};

/**
 * Store optional presentation timing without changing authored project state
 * or invalidating the journal's semantic head.
 *
 * @param {object} journal Studio journal
 * @param {number} transactionIndex zero-based transaction index
 * @param {?number} pauseAfterMs authored pause after this transaction, or null for automatic pacing
 * @returns {object} a new journal
 */
const setTransactionPause = (journal, transactionIndex, pauseAfterMs) => {
    if (!Number.isInteger(transactionIndex) || transactionIndex < 0 ||
        transactionIndex >= journal.transactions.length) {
        throw new RangeError(`Invalid Studio transaction index: ${transactionIndex}`);
    }
    if (pauseAfterMs !== null && (!Number.isFinite(pauseAfterMs) || pauseAfterMs < 0 ||
        pauseAfterMs > MAX_TRANSACTION_PAUSE_MS)) {
        throw new RangeError(`Studio transaction pause must be between 0 and ${MAX_TRANSACTION_PAUSE_MS} ms`);
    }
    const next = cloneJson(journal);
    const transaction = next.transactions[transactionIndex];
    const presentation = {...(transaction.presentation || {})};
    if (pauseAfterMs === null) delete presentation.pauseAfterMs;
    else presentation.pauseAfterMs = pauseAfterMs;
    if (Object.keys(presentation).length) transaction.presentation = presentation;
    else delete transaction.presentation;
    return next;
};

const assertJournal = journal => {
    if (!journal || journal.schemaVersion !== JOURNAL_SCHEMA_VERSION) {
        throw new Error(`Unsupported Studio journal schema: ${journal && journal.schemaVersion}`);
    }
    if (typeof journal.id !== 'string' || !Array.isArray(journal.transactions)) {
        throw new Error('Invalid Studio journal');
    }
    if (!validPause(targetSelectionPause(journal))) throw new Error('Invalid Studio sprite pause');
    if (journal.transactions.some(transaction => {
        if (!Array.isArray(transaction.events)) return true;
        const pauseAfterMs = transaction.presentation && transaction.presentation.pauseAfterMs;
        if (typeof pauseAfterMs !== 'undefined' && (!Number.isFinite(pauseAfterMs) || pauseAfterMs < 0 ||
            pauseAfterMs > MAX_TRANSACTION_PAUSE_MS)) return true;
        return ['beforeDataDeltas', 'afterDataDeltas'].some(field =>
            field in transaction && (!Array.isArray(transaction[field]) ||
                transaction[field].some(delta => !delta || delta.schemaVersion !== 1))
        );
    })) {
        throw new Error('Invalid Studio journal transaction');
    }
    return journal;
};

const serializeJournal = journal => JSON.stringify(assertJournal(journal), null, 2);

const parseJournal = text => assertJournal(JSON.parse(text));

export {
    JOURNAL_SCHEMA_VERSION,
    MAX_TRANSACTION_PAUSE_MS,
    DEFAULT_TARGET_SELECTION_PAUSE_MS,
    appendDataEdit,
    appendProjectOperation,
    appendSnapshot,
    appendTransactionDataDelta,
    coalesceUngroupedCreates,
    createJournal,
    parseJournal,
    serializeJournal,
    setTransactionPause,
    setTargetSelectionPause,
    targetSelectionPause,
    snapshotStartsTransaction,
    truncateTransactions
};
