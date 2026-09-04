import {
    MAX_TRANSACTION_PAUSE_MS,
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
} from '../../src/studio/journal/journal';
import {createJournalRecorder} from '../../src/studio/journal/journal-recorder';
import {createJournalStore} from '../../src/studio/journal/journal-store';
import {makeChangeSnapshot} from './helpers/block-snapshots';

const newJournal = () => createJournal({
    id: 'take-1',
    createdAtMs: 50,
    baseCheckpointId: 'checkpoint-1'
});

test('sprite selection timing is portable, bounded metadata with a legacy default', () => {
    expect(targetSelectionPause(null)).toBe(500);
    const journal = appendSnapshot(newJournal(), makeChangeSnapshot());
    journal.endProjectHash = 'unchanged';
    const updated = setTargetSelectionPause(journal, 850);
    expect(updated.transactions).toEqual(journal.transactions);
    expect(updated.endProjectHash).toBe('unchanged');
    expect(targetSelectionPause(parseJournal(serializeJournal(updated)))).toBe(850);
    expect(targetSelectionPause(journal)).toBe(500);
    delete journal.presentation;
    expect(targetSelectionPause(parseJournal(serializeJournal(journal)))).toBe(500);
    for (const value of [-1, 30001, NaN, Infinity, null, '500']) {
        expect(() => setTargetSelectionPause(journal, value)).toThrow('Studio sprite pause');
        expect(() => parseJournal(JSON.stringify({
            ...journal, presentation: {targetSelectionPauseMs: value}
        }))).toThrow('Invalid Studio sprite pause');
    }
    expect(targetSelectionPause(setTargetSelectionPause(journal, 0))).toBe(0);
});

test('groups only adjacent Scratch events from the same target and source group', () => {
    let journal = newJournal();
    journal = appendSnapshot(journal, makeChangeSnapshot({recordedAtMs: 100}));
    journal = appendSnapshot(journal, makeChangeSnapshot({recordedAtMs: 110, blockId: 'block-2'}));
    journal = appendSnapshot(journal, makeChangeSnapshot({
        recordedAtMs: 120,
        targetId: 'sprite-b'
    }));
    journal = appendSnapshot(journal, makeChangeSnapshot({
        recordedAtMs: 130,
        group: null
    }));
    journal = appendSnapshot(journal, makeChangeSnapshot({
        recordedAtMs: 140,
        group: null
    }));

    expect(journal.transactions.map(transaction => transaction.events.length)).toEqual([2, 1, 1, 1]);
    expect(journal.transactions[0]).toMatchObject({
        id: 'transaction-1',
        targetId: 'sprite-a',
        sourceGroup: 'group-1',
        startedAtMs: 100,
        endedAtMs: 110
    });
});

test('identifies the first snapshot in each visible transaction', () => {
    let journal = newJournal();
    const first = makeChangeSnapshot({recordedAtMs: 100});
    const grouped = makeChangeSnapshot({recordedAtMs: 110, blockId: 'block-2'});
    const next = makeChangeSnapshot({recordedAtMs: 120, group: 'group-2'});

    expect(snapshotStartsTransaction(journal, first)).toBe(true);
    journal = appendSnapshot(journal, first);
    expect(snapshotStartsTransaction(journal, grouped)).toBe(false);
    expect(snapshotStartsTransaction(journal, next)).toBe(true);
});

test('persists bounded transaction pauses without changing semantic head state', () => {
    let journal = appendSnapshot(newJournal(), makeChangeSnapshot({recordedAtMs: 100}));
    journal.endProjectHash = 'head-hash';
    journal.endProject = {value: 20};

    journal = setTransactionPause(journal, 0, 1250);
    expect(journal.transactions[0].presentation).toEqual({pauseAfterMs: 1250});
    expect(journal).toMatchObject({endProjectHash: 'head-hash', endProject: {value: 20}});
    expect(parseJournal(serializeJournal(journal)).transactions[0].presentation)
        .toEqual({pauseAfterMs: 1250});

    journal = setTransactionPause(journal, 0, null);
    expect(journal.transactions[0].presentation).toBeUndefined();
    expect(() => setTransactionPause(journal, 0, MAX_TRANSACTION_PAUSE_MS + 1))
        .toThrow(`Studio transaction pause must be between 0 and ${MAX_TRANSACTION_PAUSE_MS} ms`);
    expect(() => setTransactionPause(journal, 1, 100)).toThrow('Invalid Studio transaction index: 1');
});

const commentSnapshot = ({type, recordedAtMs, details}) => makeChangeSnapshot({
    type,
    recordedAtMs,
    group: null,
    blockId: 'block-1',
    commentId: 'comment-1',
    details
});

test('orders a delayed block-comment text commit before the delete that triggered its blur', () => {
    const created = commentSnapshot({
        type: 'comment_create',
        recordedAtMs: 100,
        details: {state: {text: ''}, xml: '<comment></comment>'}
    });
    const deleted = commentSnapshot({
        type: 'comment_delete',
        recordedAtMs: 300,
        details: {
            state: {text: 'Explain this'},
            oldXml: '<comment></comment>'
        }
    });
    const changed = commentSnapshot({
        type: 'comment_change',
        recordedAtMs: 310,
        details: {oldContents: {text: ''}, newContents: {text: 'Explain this'}}
    });
    let journal = appendSnapshot(newJournal(), created);
    journal = appendSnapshot(journal, deleted, {viewport: {viewLeft: 10, viewTop: 20}});
    journal = appendSnapshot(journal, changed, {viewport: {viewLeft: 11, viewTop: 21}});

    expect(journal.transactions.map(transaction => transaction.events[0].type)).toEqual([
        'comment_create',
        'comment_change',
        'comment_delete'
    ]);
    expect(journal.transactions.map(transaction => transaction.id)).toEqual([
        'transaction-1',
        'transaction-2',
        'transaction-3'
    ]);
    expect(journal.transactions[1].viewport).toEqual({viewLeft: 11, viewTop: 21});
    expect(journal.transactions[2]).toMatchObject({
        viewport: {viewLeft: 10, viewTop: 20},
        events: [{details: {state: {text: 'Explain this'}}}]
    });
});

test('repairs a persisted delete-before-comment-change journal on load normalization', () => {
    const deleted = commentSnapshot({
        type: 'comment_delete',
        recordedAtMs: 300,
        details: {state: {text: 'Explain this'}, oldXml: '<comment></comment>'}
    });
    const changed = commentSnapshot({
        type: 'comment_change',
        recordedAtMs: 310,
        details: {oldContents: {text: ''}, newContents: {text: 'Explain this'}}
    });
    const journal = newJournal();
    journal.transactions = [deleted, changed].map((event, index) => ({
        id: `transaction-${index + 1}`,
        targetId: event.targetId,
        sourceGroup: null,
        startedAtMs: event.recordedAtMs,
        endedAtMs: event.recordedAtMs,
        events: [event]
    }));

    const normalized = coalesceUngroupedCreates(journal);

    expect(normalized.transactions.map(transaction => transaction.events[0].type))
        .toEqual(['comment_change', 'comment_delete']);
    expect(normalized.transactions.map(transaction => transaction.id))
        .toEqual(['transaction-1', 'transaction-2']);
});

test('drops semantically null comment refreshes from new and persisted history', () => {
    const refresh = commentSnapshot({
        type: 'comment_change',
        recordedAtMs: 100,
        details: {
            oldContents: {height: 200, width: 200},
            newContents: {width: 200, height: 200}
        }
    });

    expect(appendSnapshot(newJournal(), refresh).transactions).toEqual([]);

    const journal = newJournal();
    journal.transactions = [{
        id: 'transaction-1',
        targetId: refresh.targetId,
        sourceGroup: null,
        startedAtMs: refresh.recordedAtMs,
        endedAtMs: refresh.recordedAtMs,
        events: [refresh]
    }];
    expect(coalesceUngroupedCreates(journal).transactions).toEqual([]);
});

test('adopts an ungrouped reporter create into its immediately following drag', () => {
    const created = makeChangeSnapshot({
        recordedAtMs: 100,
        type: 'create',
        group: null,
        blockId: 'copied-reporter',
        blockType: 'argument_reporter_string_number',
        details: {xml: '<block type="argument_reporter_string_number"/>', ids: ['copied-reporter']}
    });
    const moved = makeChangeSnapshot({
        recordedAtMs: 620,
        type: 'move',
        group: 'drag-1',
        blockId: 'copied-reporter',
        blockType: 'argument_reporter_string_number',
        details: {
            oldLocation: {parentId: null, inputName: null, coordinate: {x: 648, y: 293}},
            newLocation: {parentId: 'wait', inputName: 'DURATION', coordinate: null}
        }
    });
    let journal = appendSnapshot(newJournal(), created);

    expect(snapshotStartsTransaction(journal, moved)).toBe(false);
    journal = appendSnapshot(journal, moved);

    expect(journal.transactions).toHaveLength(1);
    expect(journal.transactions[0]).toMatchObject({
        sourceGroup: 'drag-1',
        startedAtMs: 100,
        endedAtMs: 620
    });
    expect(journal.transactions[0].events).toHaveLength(2);
});

test('adopts Blockly\'s non-undoable post-placement move after duplicating a stack', () => {
    const created = makeChangeSnapshot({
        recordedAtMs: 100,
        type: 'create',
        group: 'duplicate-create',
        blockId: 'duplicated-child',
        blockType: 'pen_penDown',
        details: {
            xml: '<block type="pen_penDown" id="duplicated-child"/>',
            ids: ['duplicated-child']
        }
    });
    const moved = makeChangeSnapshot({
        recordedAtMs: 120,
        type: 'move',
        group: null,
        recordUndo: false,
        blockId: 'duplicated-root',
        blockType: 'pen_clear'
    });
    let journal = appendSnapshot(newJournal(), created);
    journal = appendSnapshot(journal, makeChangeSnapshot({
        recordedAtMs: 110,
        type: 'move',
        group: 'duplicate-create',
        blockId: 'duplicated-child',
        blockType: 'pen_penDown'
    }));

    expect(snapshotStartsTransaction(journal, moved)).toBe(false);
    journal = appendSnapshot(journal, moved);

    expect(journal.transactions).toHaveLength(1);
    expect(journal.transactions[0]).toMatchObject({sourceGroup: 'duplicate-create'});
    expect(journal.transactions[0].events.map(event => event.blockId)).toEqual([
        'duplicated-child',
        'duplicated-child',
        'duplicated-root'
    ]);
});

test('does not absorb a later undoable user move into a duplicated stack creation', () => {
    const created = makeChangeSnapshot({
        recordedAtMs: 100,
        type: 'create',
        group: 'duplicate-create',
        blockId: 'duplicated-root',
        blockType: 'pen_clear',
        details: {
            xml: '<block type="pen_clear" id="duplicated-root"/>',
            ids: ['duplicated-root']
        }
    });
    const placed = makeChangeSnapshot({
        recordedAtMs: 110,
        type: 'move',
        group: 'duplicate-create',
        blockId: 'duplicated-root',
        blockType: 'pen_clear'
    });
    const movedLater = makeChangeSnapshot({
        recordedAtMs: 900,
        type: 'move',
        group: 'later-user-drag',
        recordUndo: true,
        blockId: 'duplicated-root',
        blockType: 'pen_clear'
    });
    let journal = appendSnapshot(newJournal(), created);
    journal = appendSnapshot(journal, placed);

    expect(snapshotStartsTransaction(journal, movedLater)).toBe(true);
    journal = appendSnapshot(journal, movedLater);

    expect(journal.transactions).toHaveLength(2);
    expect(journal.transactions.map(transaction => transaction.sourceGroup)).toEqual([
        'duplicate-create',
        'later-user-drag'
    ]);
});

test('repairs a persisted split duplicate placement without erasing its source group', () => {
    const created = makeChangeSnapshot({
        recordedAtMs: 100,
        type: 'create',
        group: 'duplicate-create',
        blockId: 'duplicated-child',
        blockType: 'pen_penDown',
        details: {
            xml: '<block type="pen_penDown" id="duplicated-child"/>',
            ids: ['duplicated-child']
        }
    });
    const placed = makeChangeSnapshot({
        recordedAtMs: 110,
        type: 'move',
        group: 'duplicate-create',
        blockId: 'duplicated-child',
        blockType: 'pen_penDown'
    });
    const settled = makeChangeSnapshot({
        recordedAtMs: 120,
        type: 'move',
        group: null,
        recordUndo: false,
        blockId: 'duplicated-root',
        blockType: 'pen_clear'
    });
    const journal = newJournal();
    journal.transactions = [{
        id: 'transaction-1',
        targetId: created.targetId,
        sourceGroup: 'duplicate-create',
        startedAtMs: 100,
        endedAtMs: 110,
        events: [created, placed]
    }, {
        id: 'transaction-2',
        targetId: settled.targetId,
        sourceGroup: null,
        startedAtMs: 120,
        endedAtMs: 120,
        events: [settled]
    }];

    const normalized = coalesceUngroupedCreates(journal);

    expect(normalized.transactions).toHaveLength(1);
    expect(normalized.transactions[0]).toMatchObject({
        sourceGroup: 'duplicate-create',
        endedAtMs: 120
    });
    expect(normalized.transactions[0].events).toHaveLength(3);
});

const topLevelMove = ({
    recordedAtMs,
    group,
    recordUndo,
    oldCoordinate,
    newCoordinate
}) => makeChangeSnapshot({
    recordedAtMs,
    type: 'move',
    group,
    recordUndo,
    blockId: 'dragged-root',
    blockType: 'motion_movesteps',
    details: {
        oldLocation: {parentId: null, inputName: null, coordinate: oldCoordinate},
        newLocation: {parentId: null, inputName: null, coordinate: newCoordinate}
    }
});

test('discards Blockly\'s non-undoable inverse settle after a cancelled outside drag', () => {
    const movedOutside = topLevelMove({
        recordedAtMs: 100,
        group: 'outside-drag',
        recordUndo: true,
        oldCoordinate: {x: 124.59259259259255, y: 203.25925925925924},
        newCoordinate: {x: 503.8518518518518, y: 1647.7037037037035}
    });
    const settledBack = topLevelMove({
        recordedAtMs: 120,
        group: null,
        recordUndo: false,
        oldCoordinate: {x: 503.8518518518518, y: 1647.7037037037035},
        newCoordinate: {x: 124.59259259259255, y: 203.25925925925912}
    });
    let journal = appendSnapshot(newJournal(), movedOutside);

    expect(snapshotStartsTransaction(journal, settledBack)).toBe(false);
    journal = appendSnapshot(journal, settledBack);

    expect(journal.transactions).toEqual([]);
});

test('keeps a non-undoable settle that does not restore the original location', () => {
    const movedOutside = topLevelMove({
        recordedAtMs: 100,
        group: 'outside-drag',
        recordUndo: true,
        oldCoordinate: {x: 125, y: 203},
        newCoordinate: {x: 504, y: 1648}
    });
    const settledElsewhere = topLevelMove({
        recordedAtMs: 120,
        group: null,
        recordUndo: false,
        oldCoordinate: {x: 504, y: 1648},
        newCoordinate: {x: 126, y: 203}
    });
    let journal = appendSnapshot(newJournal(), movedOutside);
    journal = appendSnapshot(journal, settledElsewhere);

    expect(journal.transactions).toHaveLength(2);
});

test('discards an inverse settle which reconnects the same nested input', () => {
    const movedOutside = makeChangeSnapshot({
        recordedAtMs: 100,
        type: 'move',
        group: 'outside-reporter-drag',
        recordUndo: true,
        blockId: 'reporter',
        details: {
            oldLocation: {parentId: 'wait', inputName: 'DURATION', coordinate: null},
            newLocation: {parentId: null, inputName: null, coordinate: {x: 500, y: 1600}}
        }
    });
    const settledBack = makeChangeSnapshot({
        recordedAtMs: 120,
        type: 'move',
        group: null,
        recordUndo: false,
        blockId: 'reporter',
        details: {
            oldLocation: {parentId: null, inputName: null, coordinate: {x: 500, y: 1600}},
            newLocation: {parentId: 'wait', inputName: 'DURATION', coordinate: null}
        }
    });
    let journal = appendSnapshot(newJournal(), movedOutside);
    journal = appendSnapshot(journal, settledBack);

    expect(journal.transactions).toEqual([]);
});

test('does not discard a multi-event rearrangement before an inverse-looking settle', () => {
    const firstMove = topLevelMove({
        recordedAtMs: 100,
        group: 'compound-drag',
        recordUndo: true,
        oldCoordinate: {x: 125, y: 203},
        newCoordinate: {x: 200, y: 300}
    });
    const movedOutside = topLevelMove({
        recordedAtMs: 110,
        group: 'compound-drag',
        recordUndo: true,
        oldCoordinate: {x: 200, y: 300},
        newCoordinate: {x: 504, y: 1648}
    });
    const settledBack = topLevelMove({
        recordedAtMs: 120,
        group: null,
        recordUndo: false,
        oldCoordinate: {x: 504, y: 1648},
        newCoordinate: {x: 200, y: 300}
    });
    let journal = appendSnapshot(newJournal(), firstMove);
    journal = appendSnapshot(journal, movedOutside);
    journal = appendSnapshot(journal, settledBack);

    expect(journal.transactions.map(transaction => transaction.events.length)).toEqual([2, 1]);
});

test('repairs a persisted cancelled outside drag pair on journal load', () => {
    const movedOutside = topLevelMove({
        recordedAtMs: 100,
        group: 'outside-drag',
        recordUndo: true,
        oldCoordinate: {x: 125, y: 203},
        newCoordinate: {x: 504, y: 1648}
    });
    const settledBack = topLevelMove({
        recordedAtMs: 120,
        group: null,
        recordUndo: false,
        oldCoordinate: {x: 504, y: 1648},
        newCoordinate: {x: 125, y: 203}
    });
    const journal = newJournal();
    journal.transactions = [{
        id: 'transaction-1',
        targetId: movedOutside.targetId,
        sourceGroup: movedOutside.group,
        startedAtMs: 100,
        endedAtMs: 100,
        events: [movedOutside]
    }, {
        id: 'transaction-2',
        targetId: settledBack.targetId,
        sourceGroup: null,
        startedAtMs: 120,
        endedAtMs: 120,
        events: [settledBack]
    }];

    expect(coalesceUngroupedCreates(journal).transactions).toEqual([]);
});

test('coalesces the same reporter gesture in an existing split journal', () => {
    const created = makeChangeSnapshot({
        recordedAtMs: 100,
        type: 'create',
        group: null,
        blockId: 'copied-reporter'
    });
    const moved = makeChangeSnapshot({
        recordedAtMs: 620,
        type: 'move',
        group: 'drag-1',
        blockId: 'copied-reporter'
    });
    const journal = newJournal();
    journal.transactions = [{
        id: 'transaction-1',
        targetId: created.targetId,
        sourceGroup: null,
        startedAtMs: 100,
        endedAtMs: 100,
        events: [created]
    }, {
        id: 'transaction-2',
        targetId: moved.targetId,
        sourceGroup: 'drag-1',
        startedAtMs: 620,
        endedAtMs: 620,
        events: [moved],
        viewport: {viewLeft: 10, viewTop: 20}
    }];

    const normalized = coalesceUngroupedCreates(journal);

    expect(normalized.transactions).toHaveLength(1);
    expect(normalized.transactions[0]).toMatchObject({
        id: 'transaction-1',
        sourceGroup: 'drag-1',
        endedAtMs: 620,
        viewport: {viewLeft: 10, viewTop: 20}
    });
    expect(normalized.transactions[0].events).toHaveLength(2);
});

const broadcastCreateSnapshot = () => makeChangeSnapshot({
    recordedAtMs: 100,
    type: 'var_create',
    group: null,
    blockId: null,
    details: {
        varId: 'message-id',
        varType: 'broadcast_msg',
        varName: 'start game',
        isLocal: false,
        isCloud: false,
        definition: null
    }
});

const broadcastSelectionSnapshot = () => makeChangeSnapshot({
    recordedAtMs: 110,
    type: 'change',
    group: null,
    blockId: 'broadcast-menu',
    blockType: 'event_broadcast_menu',
    details: {
        element: 'field',
        name: 'BROADCAST_OPTION',
        oldValue: {kind: 'value', value: 'old-message'},
        newValue: {kind: 'value', value: 'message-id'}
    }
});

test('groups broadcast creation with its dropdown field selection', () => {
    let journal = appendSnapshot(newJournal(), broadcastCreateSnapshot());
    const selection = broadcastSelectionSnapshot();

    expect(snapshotStartsTransaction(journal, selection)).toBe(false);
    journal = appendSnapshot(journal, selection);

    expect(journal.transactions).toHaveLength(1);
    expect(journal.transactions[0].events.map(event => event.type)).toEqual(['var_create', 'change']);
});

test('repairs the legacy deferred broadcast capture order on journal load', () => {
    const selection = broadcastSelectionSnapshot();
    const created = broadcastCreateSnapshot();
    const journal = newJournal();
    journal.transactions = [
        {
            id: 'transaction-1',
            targetId: selection.targetId,
            sourceGroup: null,
            startedAtMs: selection.recordedAtMs,
            endedAtMs: selection.recordedAtMs,
            events: [selection]
        },
        {
            id: 'transaction-2',
            targetId: created.targetId,
            sourceGroup: null,
            startedAtMs: created.recordedAtMs,
            endedAtMs: created.recordedAtMs,
            events: [created]
        }
    ];

    const normalized = coalesceUngroupedCreates(journal);

    expect(normalized.transactions).toHaveLength(1);
    expect(normalized.transactions[0].events.map(event => event.type)).toEqual(['var_create', 'change']);
});

test('stores hidden data deltas on a visible transaction', () => {
    let journal = appendSnapshot(newJournal(), makeChangeSnapshot());
    const delta = {schemaVersion: 1, targets: []};
    journal.endProjectHash = 'old-head';

    journal = appendTransactionDataDelta(journal, 0, 'before', delta);
    journal = appendTransactionDataDelta(journal, 0, 'after', delta);

    expect(journal.transactions[0]).toMatchObject({
        beforeDataDeltas: [delta],
        afterDataDeltas: [delta]
    });
    expect(journal.endProjectHash).toBeNull();
    expect(() => appendTransactionDataDelta(journal, 1, 'after', delta))
        .toThrow('Invalid Studio transaction index: 1');
    expect(() => appendTransactionDataDelta(journal, 0, 'during', delta))
        .toThrow('Invalid Studio data delta phase: during');
});

test('stores a checkpoint-backed project operation as one visible transaction', () => {
    const journal = appendProjectOperation(newJournal(), {
        type: 'costume-share',
        targetId: 'sprite-b',
        targetRef: {isStage: false, name: 'Sprite2'},
        beforeCheckpointId: 12,
        afterCheckpointId: 13,
        beforeProjectHash: 'before',
        afterProjectHash: 'after',
        recordedAtMs: 100
    });

    expect(journal.transactions[0]).toMatchObject({
        kind: 'project-operation',
        targetId: 'sprite-b',
        events: [],
        operation: {
            type: 'costume-share',
            beforeCheckpointId: 12,
            afterCheckpointId: 13
        }
    });
    expect(parseJournal(serializeJournal(journal))).toEqual(journal);
});

test('preserves semantic transactions while normalizing a persisted journal', () => {
    const projectOperation = appendProjectOperation(newJournal(), {
        type: 'costume-upload',
        targetId: 'sprite-a',
        targetRef: {isStage: false, name: 'Sprite1'},
        beforeCheckpointId: 12,
        afterCheckpointId: 13,
        beforeProjectHash: 'before',
        afterProjectHash: 'after',
        recordedAtMs: 100
    }).transactions[0];
    const dataEdit = {
        id: 'transaction-2',
        kind: 'data-edit',
        targetId: 'sprite-a',
        targetRef: {isStage: false, name: 'Sprite1'},
        sourceGroup: 'list-edit-1',
        dataEditLabel: 'edit list',
        startedAtMs: 110,
        endedAtMs: 110,
        events: [],
        afterDataDeltas: [{schemaVersion: 1, targets: []}]
    };
    const journal = newJournal();
    journal.transactions = [projectOperation, dataEdit];

    expect(coalesceUngroupedCreates(journal).transactions).toEqual([projectOperation, dataEdit]);
});

test('round-trips a versioned journal without sharing mutable state', () => {
    const original = appendSnapshot(newJournal(), makeChangeSnapshot({recordedAtMs: 100}));
    const restored = parseJournal(serializeJournal(original));

    restored.transactions[0].events[0].targetId = 'changed';
    expect(original.transactions[0].events[0].targetId).toBe('sprite-a');
    expect(() => parseJournal('{"schemaVersion":2,"id":"future","transactions":[]}'))
        .toThrow('Unsupported Studio journal schema: 2');
    expect(() => parseJournal(JSON.stringify({
        ...original,
        transactions: [{...original.transactions[0], afterDataDeltas: {}}]
    }))).toThrow('Invalid Studio journal transaction');
});

test('keeps the latest recorded viewport on a grouped transaction', () => {
    let journal = appendSnapshot(
        newJournal(),
        makeChangeSnapshot({recordedAtMs: 100}),
        {viewport: {viewLeft: 10, viewTop: 20}}
    );
    journal = appendSnapshot(
        journal,
        makeChangeSnapshot({recordedAtMs: 110, blockId: 'block-2'}),
        {viewport: {viewLeft: 30, viewTop: 40}}
    );

    expect(journal.transactions[0].viewport).toEqual({viewLeft: 30, viewTop: 40});
});

test('truncates the redo branch without mutating recorded history', () => {
    let original = appendSnapshot(newJournal(), makeChangeSnapshot({group: 'group-1'}));
    original = appendSnapshot(original, makeChangeSnapshot({group: 'group-2'}));
    original.endProjectHash = 'old-head';

    const branch = truncateTransactions(original, 1);

    expect(branch.transactions).toHaveLength(1);
    expect(branch.endProjectHash).toBeNull();
    expect(original.transactions).toHaveLength(2);
    expect(() => truncateTransactions(original, 3)).toThrow('Invalid Studio transaction count: 3');
});

test('recorder persists after every snapshot and resumes the stored journal', () => {
    const values = new Map();
    const storage = {
        getItem: key => (values.has(key) ? values.get(key) : null),
        setItem: (key, value) => values.set(key, value),
        removeItem: key => values.delete(key)
    };
    const store = createJournalStore({storage, key: 'test-journal'});
    const recorder = createJournalRecorder({
        store,
        id: 'take-1',
        startedAtMs: 50,
        baseCheckpointId: 'checkpoint-1'
    });

    recorder.record(
        makeChangeSnapshot({recordedAtMs: 100}),
        {viewport: {viewLeft: 10, viewTop: 20}}
    );
    recorder.setEndProjectHash('hash-at-head');
    expect(store.load().endProjectHash).toBe('hash-at-head');
    recorder.setEndProjectState({
        hash: 'hash-at-head',
        project: {targets: [{name: 'Sprite1'}]},
        compatibility: {hash: 'compatibility-hash', project: {targets: []}}
    });
    expect(store.load()).toMatchObject({
        endProjectHash: 'hash-at-head',
        endProject: {targets: [{name: 'Sprite1'}]},
        endProjectCompatibility: {hash: 'compatibility-hash', project: {targets: []}}
    });
    const resumed = createJournalRecorder({store, id: 'ignored', startedAtMs: 999});
    resumed.record(makeChangeSnapshot({recordedAtMs: 110, blockId: 'block-2'}));

    expect(store.load().id).toBe('take-1');
    expect(store.load().endProjectHash).toBeNull();
    expect(store.load().endProject).toBeNull();
    expect(store.load().endProjectCompatibility).toBeNull();
    expect(store.load().transactions[0].events).toHaveLength(2);
    expect(store.load().transactions[0].viewport).toEqual({viewLeft: 10, viewTop: 20});
    expect(resumed.getJournal()).toEqual(store.load());

    resumed.truncate(0);
    expect(store.load().transactions).toEqual([]);
});
