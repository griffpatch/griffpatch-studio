import {
    appendDataEdit,
    appendSnapshot,
    appendProjectOperation,
    appendTransactionDataDelta,
    coalesceUngroupedCreates,
    createJournal,
    parseJournal,
    serializeJournal,
    setTransactionPause,
    setTargetSelectionPause,
    truncateTransactions
} from './journal';

/**
 * Persist each accepted snapshot immediately so a browser reload does not lose
 * the source take. Storage policy remains outside the recorder.
 *
 * @param {object} options recorder configuration
 * @param {object} options.store journal store
 * @param {string} options.id recording identifier
 * @param {number} options.startedAtMs recording start time
 * @param {?(number|string)} [options.baseCheckpointId] opaque checkpoint identifier
 * @param {?string} [options.baseProjectHash] canonical starting project hash
 * @param {?string} [options.projectHashKind] project hash projection identifier
 * @returns {object} recorder
 */
const createJournalRecorder = ({
    store,
    id,
    startedAtMs,
    baseCheckpointId = null,
    baseProjectHash = null,
    projectHashKind = null
}) => {
    let journal = store.load();
    if (journal) {
        const normalized = coalesceUngroupedCreates(journal);
        if (serializeJournal(normalized) !== serializeJournal(journal)) {
            journal = normalized;
            store.save(journal);
        }
    } else {
        journal = createJournal({
            id,
            createdAtMs: startedAtMs,
            baseCheckpointId,
            baseProjectHash,
            projectHashKind
        });
        store.save(journal);
    }

    return {
        /**
         * Store a semantic event with optional presentation state captured at
         * the same authoring moment.
         *
         * @param {object} snapshot durable block-event snapshot
         * @param {object} [presentation] optional transaction presentation state
         * @returns {void}
         */
        record: (snapshot, presentation) => {
            journal = {
                ...appendSnapshot(journal, snapshot, presentation),
                endProjectHash: null,
                endProject: null,
                endProjectCompatibility: null
            };
            store.save(journal);
        },
        recordDataEdit: edit => {
            journal = {
                ...appendDataEdit(journal, edit),
                endProjectHash: null,
                endProject: null,
                endProjectCompatibility: null
            };
            store.save(journal);
        },
        recordProjectOperation: operation => {
            journal = appendProjectOperation(journal, operation);
            store.save(journal);
        },
        appendDataDelta: (transactionIndex, phase, delta) => {
            journal = appendTransactionDataDelta(journal, transactionIndex, phase, delta);
            store.save(journal);
        },
        setEndProjectHash: hash => {
            journal = {
                ...journal,
                endProjectHash: hash,
                ...(hash === null ? {endProject: null, endProjectCompatibility: null} : {})
            };
            store.save(journal);
        },
        setEndProjectState: ({hash, project = null, compatibility = null}) => {
            journal = {
                ...journal,
                endProjectHash: hash,
                endProject: project,
                endProjectCompatibility: compatibility
            };
            store.save(journal);
        },
        setTransactionPause: (transactionIndex, pauseAfterMs) => {
            journal = setTransactionPause(journal, transactionIndex, pauseAfterMs);
            store.save(journal);
        },
        setTargetSelectionPause: pauseMs => {
            journal = setTargetSelectionPause(journal, pauseMs);
            store.save(journal);
        },
        truncate: transactionCount => {
            journal = truncateTransactions(journal, transactionCount);
            store.save(journal);
        },
        getJournal: () => parseJournal(serializeJournal(journal))
    };
};

export {createJournalRecorder};
