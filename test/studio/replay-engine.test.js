import {
    compactAdjacentMoves,
    replayJournal,
    replayTransaction,
    replayTransactionWithResult
} from '../../src/studio/replay/replay-engine';
import {appendSnapshot, createJournal} from '../../src/studio/journal/journal';
import {captured, makeChangeSnapshot} from './helpers/block-snapshots';

const makeTwoStepJournal = () => {
    let journal = createJournal({id: 'take-1', createdAtMs: 50});
    journal = appendSnapshot(journal, makeChangeSnapshot({recordedAtMs: 100}));
    journal = appendSnapshot(journal, makeChangeSnapshot({
        recordedAtMs: 110,
        details: {
            element: 'field',
            name: 'VALUE',
            oldValue: captured('20'),
            newValue: captured('30')
        }
    }));
    return journal;
};

test('replays backward events in reverse order', async () => {
    const journal = makeTwoStepJournal();
    const values = [];

    await replayTransaction(
        journal.transactions[0],
        action => values.push(action.eventJson.newValue),
        'backward'
    );

    expect(values).toEqual(['20', '10']);
});

test('round-trips the same journal 100 times through the executor contract', async () => {
    const journal = makeTwoStepJournal();
    let value = '10';
    const apply = action => {
        value = action.eventJson.newValue;
    };

    for (let iteration = 0; iteration < 100; iteration++) {
        expect(await replayJournal(journal, apply, 'forward')).toBe(2);
        expect(value).toBe('30');
        expect(await replayJournal(journal, apply, 'backward')).toBe(2);
        expect(value).toBe('10');
    }
});

test('paces between undo groups without exposing events inside a user action', async () => {
    let journal = makeTwoStepJournal();
    journal = appendSnapshot(journal, makeChangeSnapshot({
        recordedAtMs: 120,
        group: 'group-2',
        details: {
            element: 'field',
            name: 'VALUE',
            oldValue: captured('30'),
            newValue: captured('40')
        }
    }));
    const sequence = [];

    await replayJournal(
        journal,
        action => sequence.push(action.eventJson.newValue),
        'forward',
        {betweenTransactions: () => sequence.push('pause')}
    );

    expect(sequence).toEqual(['20', '30', 'pause', '40']);
});

test('runs presentation hooks outside the complete Scratch transaction', async () => {
    const journal = makeTwoStepJournal();
    const sequence = [];

    await replayTransaction(
        journal.transactions[0],
        action => sequence.push(action.eventJson.newValue),
        'forward',
        {
            beforeTransaction: () => sequence.push('before'),
            afterTransaction: () => sequence.push('after')
        }
    );

    expect(sequence).toEqual(['before', '20', '30', 'after']);
});

test('undoing a flyout creation skips its redundant move before deletion', async () => {
    const finalReference = {
        ancestorId: 'existing-stack',
        ancestorType: 'event_whenflagclicked',
        ancestorCoordinate: {x: 100, y: 120},
        path: [{kind: 'next'}]
    };
    const transaction = {
        events: [{
            type: 'create',
            blockId: 'created',
            blockRef: {
                ancestorId: 'created',
                ancestorType: 'motion_movesteps',
                ancestorCoordinate: {x: 10, y: 20},
                path: []
            },
            details: {xml: '<block/>', ids: ['created']}
        }, {
            type: 'move',
            blockId: 'created',
            blockRef: finalReference,
            details: {
                oldLocation: {parentId: null, inputName: null, coordinate: {x: 10, y: 20}},
                newLocation: {parentId: 'parent', inputName: 'SUBSTACK', coordinate: null}
            }
        }]
    };
    const actions = [];

    expect(await replayTransaction(
        transaction,
        action => actions.push(action),
        'backward'
    )).toBe(1);
    expect(actions.map(action => action.eventJson.type)).toEqual(['delete']);
    expect(actions[0].blockRef).toBe(finalReference);
});

test('retains an exiting block resolved before inverse input restoration displaces it', async () => {
    const transaction = {
        events: [{
            type: 'create',
            blockId: 'recorded-reporter',
            details: {xml: '<block/>', ids: ['recorded-reporter']}
        }]
    };
    const actions = [];
    const apply = action => actions.push(action);
    apply.prepareTransaction = jest.fn(() => ({'recorded-reporter': 'live-reporter'}));

    await replayTransaction(transaction, apply, 'backward');

    expect(apply.prepareTransaction).toHaveBeenCalledWith(transaction, 'backward');
    expect(actions[0]).toMatchObject({
        resolvedBlockId: 'live-reporter',
        eventJson: {type: 'delete', blockId: 'recorded-reporter'}
    });
});

test('returns prepared block aliases for post-transaction topology verification', async () => {
    const transaction = {
        events: [{
            type: 'create',
            blockId: 'recorded-shadow',
            details: {xml: '<shadow/>', ids: ['recorded-shadow']}
        }]
    };
    const apply = jest.fn();
    apply.prepareTransaction = jest.fn(() => ({'recorded-shadow': 'live-shadow'}));

    await expect(replayTransactionWithResult(transaction, apply, 'forward')).resolves.toEqual({
        appliedEventCount: 1,
        blockAliases: {'recorded-shadow': 'live-shadow'}
    });
});

test('seeds a semantic fallback with aliases established by earlier Play interactions', async () => {
    const transaction = {
        events: [{
            type: 'move',
            blockId: 'recorded-created',
            details: {
                oldLocation: {parentId: null, inputName: null, coordinate: {x: 10, y: 20}},
                newLocation: {parentId: null, inputName: null, coordinate: {x: 30, y: 40}}
            }
        }]
    };
    const actions = [];
    const apply = jest.fn(action => actions.push(action));
    apply.prepareTransaction = jest.fn(() => ({
        blockAliases: {'recorded-parent': 'live-parent'},
        vmBlockAliases: {}
    }));

    await expect(replayTransactionWithResult(transaction, apply, 'forward', {
        blockAliases: {'recorded-created': 'live-created'}
    })).resolves.toEqual({
        appliedEventCount: 1,
        blockAliases: {
            'recorded-created': 'live-created',
            'recorded-parent': 'live-parent'
        }
    });
    expect(apply.prepareTransaction).toHaveBeenCalledWith(transaction, 'forward', {
        blockAliases: {'recorded-created': 'live-created'},
        vmBlockAliases: {}
    });
    expect(actions[0].resolvedBlockId).toBe('live-created');
});

test('carries aliases discovered by a create into later actions and topology verification', async () => {
    const transaction = {
        events: [{
            type: 'create',
            blockId: 'recorded-shadow',
            details: {xml: '<shadow/>', ids: ['recorded-shadow']}
        }, {
            type: 'move',
            blockId: 'recorded-shadow',
            details: {
                oldLocation: {parentId: null, inputName: null, coordinate: {x: 10, y: 10}},
                newLocation: {parentId: 'parent', inputName: 'VALUE', coordinate: null}
            }
        }]
    };
    const actions = [];
    const apply = jest.fn(action => {
        actions.push(action);
        return action.eventJson.type === 'create' ? {
            blockAliases: {'recorded-shadow': 'live-shadow'},
            vmBlockAliases: {'recorded-shadow': 'vm-shadow'}
        } : null;
    });

    await expect(replayTransactionWithResult(transaction, apply, 'forward')).resolves.toEqual({
        appliedEventCount: 2,
        blockAliases: {'recorded-shadow': 'live-shadow'}
    });
    expect(actions[1]).toMatchObject({
        resolvedBlockId: 'live-shadow',
        resolvedVmBlockId: 'vm-shadow',
        eventJson: {type: 'move', blockId: 'recorded-shadow'}
    });
});

test('compacts split drag coordinates like Scratch Blocks before reversing a stack insertion', async () => {
    const move = (blockId, oldLocation, newLocation, recordedAtMs) => ({
        type: 'move',
        workspaceId: 'workspace-1',
        blockId,
        blockType: blockId === 'moving' ? 'motion_pointindirection' : 'motion_gotoxy',
        blockRef: {ancestorId: blockId, path: []},
        recordedAtMs,
        forwardJson: {type: 'move', blockId},
        details: {oldLocation, newLocation}
    });
    const below = {parentId: 'displaced', inputName: null, coordinate: null};
    const firstCoordinate = {parentId: null, inputName: null, coordinate: {x: 242, y: 364}};
    const dropCoordinate = {parentId: null, inputName: null, coordinate: {x: 248, y: 304}};
    const insertionParent = {parentId: 'insertion-parent', inputName: null, coordinate: null};
    const transaction = {events: [
        move('moving', below, firstCoordinate, 1),
        move('moving', firstCoordinate, dropCoordinate, 2),
        move('displaced', insertionParent, {
            parentId: 'moving', inputName: null, coordinate: null
        }, 3),
        move('moving', dropCoordinate, insertionParent, 4)
    ]};

    expect(compactAdjacentMoves(transaction.events)).toHaveLength(3);
    const actions = [];
    await replayTransaction(transaction, action => actions.push(action), 'backward');

    expect(actions.map(action => ({
        blockId: action.eventJson.blockId,
        parentId: action.eventJson.newParentId || null,
        coordinate: action.eventJson.newCoordinate || null
    }))).toEqual([
        {blockId: 'moving', parentId: null, coordinate: '248,304'},
        {blockId: 'displaced', parentId: 'insertion-parent', coordinate: null},
        {blockId: 'moving', parentId: 'displaced', coordinate: null}
    ]);
});

test('replays hidden data around block events in directional order', async () => {
    const transaction = makeTwoStepJournal().transactions[0];
    transaction.beforeDataDeltas = [{id: 'before-1'}, {id: 'before-2'}];
    transaction.afterDataDeltas = [{id: 'after-1'}, {id: 'after-2'}];
    const sequence = [];
    const apply = action => sequence.push(action.kind === 'data-state' ?
        `${action.direction}:${action.delta.id}` : action.eventJson.newValue);

    expect(await replayTransaction(transaction, apply, 'forward')).toBe(6);
    expect(sequence).toEqual([
        'forward:before-1',
        'forward:before-2',
        '20',
        '30',
        'forward:after-1',
        'forward:after-2'
    ]);

    sequence.length = 0;
    expect(await replayTransaction(transaction, apply, 'backward')).toBe(6);
    expect(sequence).toEqual([
        'backward:after-2',
        'backward:after-1',
        '20',
        '10',
        'backward:before-2',
        'backward:before-1'
    ]);
});

test('orders variable definitions around blocks that reference them', async () => {
    const createBlock = {
        type: 'create',
        blockId: 'broadcast-block',
        details: {xml: '<block/>', ids: ['broadcast-block']}
    };
    const createBroadcast = {
        type: 'var_create',
        blockId: null,
        details: {
            varId: 'message-id',
            varType: 'broadcast_msg',
            varName: 'message1',
            isLocal: false,
            isCloud: false,
            definition: null
        }
    };
    const transaction = {events: [createBlock, createBroadcast]};
    const actions = [];

    await replayTransaction(transaction, action => actions.push(action.eventJson), 'forward');
    expect(actions.map(action => action.type)).toEqual(['var_create', 'create']);

    actions.length = 0;
    await replayTransaction(transaction, action => actions.push(action.eventJson), 'backward');
    expect(actions.map(action => action.type)).toEqual(['delete', 'var_delete']);
});
