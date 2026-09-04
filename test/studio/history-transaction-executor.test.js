import {createHistoryTransactionExecutor} from '../../src/studio/bridge/history-transaction-executor';

const transaction = {
    id: 'transaction-1',
    kind: 'block-events',
    events: [{type: 'move', blockId: 'moving'}]
};

test('a rename selects its incoming sprite and restores the outgoing name without changing context', async () => {
    const harness = makeHarness();
    const before = {targetId: 'a', targetRef: {name: 'Sprite2', isStage: false}};
    const after = {targetId: 'a', targetRef: {name: 'Guide', isStage: false}};
    let selected = {targetId: 'other', targetRef: {name: 'Other', isStage: false}};
    let available = after;
    harness.target.resolve = item => item.targetRef.name === available.targetRef.name ? 'a' : null;
    harness.target.current = () => selected;
    harness.target.isSelected.mockImplementation(item => item.targetRef.name === selected.targetRef.name);
    const presentTargetSelection = jest.fn(item => { selected = item; return Promise.resolve(); });
    harness.restoreCheckpoint.mockImplementation((id, editingTarget) => {
        expect(selected).toEqual(after);
        expect(editingTarget).toEqual(before);
        available = before;
        selected = editingTarget;
        return Promise.resolve();
    });
    await harness.executor.apply({
        id: 'rename', kind: 'project-operation', events: [],
        operation: {
            type: 'sprite-rename', beforeEditingTargetId: 'a', afterEditingTargetId: 'a',
            beforeEditingTargetRef: before.targetRef, afterEditingTargetRef: after.targetRef,
            beforeCheckpointId: 'before', beforeProjectHash: 'captured-hash'
        }
    }, 'backward', {nativeAllowed: false, presentTargetSelection});
    expect(presentTargetSelection).toHaveBeenCalledTimes(1);
    expect(presentTargetSelection).toHaveBeenCalledWith(after);
    expect(selected).toEqual(before);
});

const makeHarness = ({
    nativeResult = {status: 'unsupported'},
    topologyMatches = true,
    semanticResult = void 0
} = {}) => {
    const lifecycleBefore = {captured: true};
    const checkpointPort = {
        create: jest.fn(() => Promise.resolve('safety-checkpoint')),
        remove: jest.fn(() => Promise.resolve())
    };
    const restoreCheckpoint = jest.fn(() => Promise.resolve());
    const authoredStatePort = {adoptCurrent: jest.fn(), adoptListDefinition: jest.fn()};
    const listDefinitionPort = {reset: jest.fn(), adoptDefinition: jest.fn()};
    const target = {isSelected: jest.fn(() => true), select: jest.fn(() => Promise.resolve())};
    const captureProjectState = jest.fn(() => Promise.resolve({hash: 'captured-hash'}));
    const projectValidation = jest.fn((expectedHash, expectedProject, captured) => ({
        matches: expectedHash === captured.hash,
        expectedHash,
        expectedProject,
        actualHash: captured.hash
    }));
    const nativeInteraction = {
        play: jest.fn(() => Promise.resolve(nativeResult)),
        getSequenceBlockAliases: jest.fn(() => null),
        adoptSequenceBlockAliases: jest.fn(),
        resetSequenceBlockAliases: jest.fn()
    };
    const lifecycleAnimation = {
        captureBefore: jest.fn(() => lifecycleBefore),
        playAfter: jest.fn(() => Promise.resolve()),
        discard: jest.fn()
    };
    const replaySemanticTransaction = jest.fn(() => Promise.resolve(semanticResult));
    const verifyTopology = jest.fn(() => ({matches: topologyMatches}));
    const publish = jest.fn();
    const executor = createHistoryTransactionExecutor({
        workspace: {id: 'workspace'},
        vm: {id: 'vm'},
        checkpointPort,
        restoreCheckpoint,
        authoredStatePort,
        listDefinitionPort,
        target,
        captureProjectState,
        projectValidation,
        nativeInteraction,
        lifecycleAnimation,
        replaySemanticTransaction,
        verifyTopology,
        publish
    });
    return {
        executor,
        lifecycleBefore,
        checkpointPort,
        restoreCheckpoint,
        authoredStatePort,
        listDefinitionPort,
        target,
        captureProjectState,
        nativeInteraction,
        lifecycleAnimation,
        replaySemanticTransaction,
        verifyTopology,
        publish
    };
};

test('uses semantic replay and lifecycle presentation inside one verified safety boundary', async () => {
    const harness = makeHarness();
    await expect(harness.executor.apply(transaction, 'backward', {
        lifecyclePresentation: true,
        playbackSpeed: 2,
        viewportPresentation: 'preserve'
    })).resolves.toEqual({status: 'unsupported'});

    expect(harness.checkpointPort.create).toHaveBeenCalledTimes(1);
    expect(harness.nativeInteraction.play).toHaveBeenCalledWith(expect.objectContaining({
        transaction, direction: 'backward', speed: 2
    }));
    expect(harness.replaySemanticTransaction).toHaveBeenCalledWith(transaction, 'backward', 'preserve', 2);
    expect(harness.verifyTopology).toHaveBeenCalledWith(expect.objectContaining({
        transaction, direction: 'backward'
    }));
    expect(harness.lifecycleAnimation.playAfter).toHaveBeenCalledWith({
        transaction,
        direction: 'backward',
        before: harness.lifecycleBefore,
        playbackSpeed: 2
    });
    expect(harness.checkpointPort.remove).toHaveBeenCalledWith('safety-checkpoint');
});

test('verifies semantic move topology with aliases captured before the topology changes', async () => {
    const blockAliases = {'recorded-moving': 'live-moving', 'recorded-tail': 'live-tail'};
    const harness = makeHarness({semanticResult: {appliedEventCount: 4, blockAliases}});

    await harness.executor.apply(transaction, 'backward');

    expect(harness.verifyTopology).toHaveBeenCalledWith(expect.objectContaining({blockAliases}));
});

test('carries Play sequence aliases through semantic fallback and back into later native interactions', async () => {
    const harness = makeHarness({
        semanticResult: {
            appliedEventCount: 2,
            blockAliases: {
                'recorded-created': 'live-created',
                'recorded-child': 'live-child'
            }
        }
    });
    harness.nativeInteraction.getSequenceBlockAliases.mockReturnValue({
        'recorded-created': 'live-created'
    });

    await harness.executor.apply(transaction, 'forward', {interactionPresentation: 'realistic'});

    expect(harness.replaySemanticTransaction).toHaveBeenCalledWith(
        transaction,
        'forward',
        'reveal',
        1,
        {'recorded-created': 'live-created'}
    );
    expect(harness.nativeInteraction.adoptSequenceBlockAliases).toHaveBeenCalledWith({
        'recorded-created': 'live-created',
        'recorded-child': 'live-child'
    });
});

test('keeps verified native interaction authoritative and discards the unused semantic proxy', async () => {
    const blockAliases = {'recorded-moving': 'live-moving'};
    const harness = makeHarness({nativeResult: {status: 'verified', frames: 8, blockAliases}});
    await expect(harness.executor.apply(transaction, 'forward', {lifecyclePresentation: true}))
        .resolves.toEqual({status: 'verified', frames: 8, blockAliases});

    expect(harness.replaySemanticTransaction).not.toHaveBeenCalled();
    expect(harness.verifyTopology).toHaveBeenCalledWith(expect.objectContaining({blockAliases}));
    expect(harness.lifecycleAnimation.playAfter).not.toHaveBeenCalled();
    expect(harness.lifecycleAnimation.discard).toHaveBeenCalledWith(harness.lifecycleBefore);
});

test('advances authored definition shadows after a verified native variable lifecycle', async () => {
    const harness = makeHarness({nativeResult: {status: 'verified'}});
    const definition = {
        present: true,
        id: 'cake-id',
        targetRef: {isStage: true, name: 'Stage'},
        type: '',
        value: 0
    };
    const variableCreate = {
        id: 'variable-create',
        kind: 'block-events',
        events: [{
            type: 'var_create',
            details: {definition: {before: null, after: definition}}
        }]
    };

    await harness.executor.apply(variableCreate, 'forward');

    expect(harness.authoredStatePort.adoptListDefinition).toHaveBeenCalledWith(definition);
    expect(harness.listDefinitionPort.adoptDefinition).toHaveBeenCalledWith(definition);
});

test('restores the safety checkpoint and annotates a topology mismatch without hiding it', async () => {
    const harness = makeHarness({topologyMatches: false});
    const error = await harness.executor.apply(transaction, 'forward', {lifecyclePresentation: true})
        .catch(caught => caught);

    expect(error).toMatchObject({
        message: 'Block topology did not match the recorded connection',
        studioRestored: true,
        studioTransaction: transaction,
        topology: {matches: false}
    });
    expect(harness.restoreCheckpoint).toHaveBeenCalledWith('safety-checkpoint');
    expect(harness.authoredStatePort.adoptCurrent).toHaveBeenCalledTimes(1);
    expect(harness.listDefinitionPort.reset).toHaveBeenCalledTimes(1);
    expect(harness.nativeInteraction.resetSequenceBlockAliases).toHaveBeenCalledTimes(1);
    expect(harness.lifecycleAnimation.discard).toHaveBeenCalledWith(harness.lifecycleBefore);
    expect(harness.publish).toHaveBeenCalledWith({
        nativeInteraction: expect.objectContaining({
            status: 'unsupported',
            topology: {matches: false}
        })
    });
});

test('reports failed native evidence and rolls back rather than applying semantic replay on top', async () => {
    const nativeResult = {status: 'mismatch', evidence: {markerFrameCount: 0}};
    const harness = makeHarness({nativeResult});
    const error = await harness.executor.apply(transaction, 'forward').catch(caught => caught);

    expect(error).toMatchObject({
        message: 'Native interaction did not match the recorded transaction',
        nativeInteraction: nativeResult,
        studioRestored: true
    });
    expect(harness.publish).toHaveBeenCalledWith({nativeInteraction: nativeResult});
    expect(harness.replaySemanticTransaction).not.toHaveBeenCalled();
});

test('restores a project operation checkpoint, editing target and exact hash', async () => {
    const harness = makeHarness();
    harness.target.isSelected.mockReturnValue(false);
    harness.captureProjectState.mockResolvedValue({hash: 'after-hash'});
    const projectOperation = {
        kind: 'project-operation',
        operation: {
            beforeCheckpointId: 'before-checkpoint',
            afterCheckpointId: 'after-checkpoint',
            beforeProjectHash: 'before-hash',
            afterProjectHash: 'after-hash',
            beforeEditingTargetId: 'sprite-before',
            afterEditingTargetId: 'sprite-after'
        }
    };

    await expect(harness.executor.apply(projectOperation, 'forward', {nativeAllowed: false})).resolves.toMatchObject({
        status: 'verified', kind: 'project-operation', validation: {matches: true}
    });
    expect(harness.restoreCheckpoint).toHaveBeenCalledWith('after-checkpoint',
        expect.objectContaining({targetId: 'sprite-after'}));
    expect(harness.target.select).toHaveBeenCalledWith(expect.objectContaining({targetId: 'sprite-after'}));
    expect(harness.nativeInteraction.play).not.toHaveBeenCalled();
    expect(harness.nativeInteraction.resetSequenceBlockAliases).toHaveBeenCalledTimes(1);
    expect(harness.verifyTopology).not.toHaveBeenCalled();
});

test('presents a verified project-library interaction before restoring its exact checkpoint', async () => {
    const nativeResult = {status: 'verified', evidence: {libraryVisibleBeforeSelect: true}};
    const harness = makeHarness({nativeResult});
    const presentedProject = {targets: [{name: 'Apple'}]};
    harness.captureProjectState
        .mockResolvedValueOnce({hash: 'presented-hash', project: presentedProject})
        .mockResolvedValueOnce({hash: 'after-hash', project: presentedProject});
    const projectOperation = {
        id: 'sprite-library',
        kind: 'project-operation',
        operation: {
            type: 'sprite-create',
            beforeCheckpointId: 'before-checkpoint',
            afterCheckpointId: 'after-checkpoint',
            beforeProjectHash: 'before-hash',
            afterProjectHash: 'after-hash'
        }
    };

    await expect(harness.executor.apply(projectOperation, 'forward')).resolves.toMatchObject({
        status: 'verified',
        kind: 'project-operation',
        nativeInteraction: nativeResult
    });
    expect(harness.nativeInteraction.play).toHaveBeenCalledWith({
        transaction: projectOperation,
        direction: 'forward',
        presentationMode: 'realistic'
    });
    expect(harness.nativeInteraction.play.mock.invocationCallOrder[0])
        .toBeLessThan(harness.restoreCheckpoint.mock.invocationCallOrder[0]);
    expect(harness.restoreCheckpoint).toHaveBeenCalledWith('after-checkpoint',
        expect.objectContaining({targetId: void 0}));
    expect(harness.captureProjectState).toHaveBeenCalledTimes(2);
});

test('snapshot sprite creation restores exactly once, on its virtual click, then validates normally', async () => {
    const harness = makeHarness();
    const presentation = {status: 'presented', plan: {kind: 'snapshot-sprite-create'}};
    harness.nativeInteraction.presentProjectRestore = jest.fn(async ({restore}) => {
        expect(harness.restoreCheckpoint).not.toHaveBeenCalled();
        await restore();
        expect(harness.captureProjectState).not.toHaveBeenCalled();
        return presentation;
    });
    await expect(harness.executor.apply({
        id: 'sprite-create',
        kind: 'project-operation',
        operation: {type: 'sprite-create', afterCheckpointId: 'after', afterProjectHash: 'captured-hash'}
    }, 'forward')).resolves.toMatchObject({
        status: 'verified', validation: {matches: true}, nativeInteraction: presentation
    });
    expect(harness.restoreCheckpoint).toHaveBeenCalledTimes(1);
    expect(harness.restoreCheckpoint).toHaveBeenCalledWith('after', expect.any(Object));
    expect(harness.captureProjectState).toHaveBeenCalledTimes(1);
});

test.each([false, true])('cancelled sprite creation rolls back safely (already applied: %s)', async applied => {
    const harness = makeHarness();
    harness.nativeInteraction.presentProjectRestore = jest.fn(async ({restore}) => {
        if (applied) await restore();
        return {status: 'cancelled'};
    });
    await expect(harness.executor.apply({
        kind: 'project-operation', operation: {type: 'sprite-create', afterCheckpointId: 'after'}
    }, 'forward')).rejects.toMatchObject({studioRestored: true});
    expect(harness.restoreCheckpoint).toHaveBeenLastCalledWith('safety-checkpoint');
    expect(harness.restoreCheckpoint).toHaveBeenCalledTimes(applied ? 2 : 1);
});

test.each(['block-share', 'costume-library-add'])(
    'full Play preserves its presented context through %s checkpoint reconciliation', async type => {
        const harness = makeHarness();
        const source = {targetId: 'live-source', targetRef: {name: 'Sprite1', isStage: false}};
        harness.target.current = jest.fn(() => source);
        harness.target.isSelected.mockReturnValue(false);
        harness.captureProjectState.mockResolvedValue({hash: 'after-hash'});
        await harness.executor.apply({
            kind: 'project-operation',
            operation: {
                type,
                afterCheckpointId: 'after',
                afterProjectHash: 'after-hash',
                afterEditingTargetRef: {name: 'Sprite2', isStage: false}
            }
        }, 'forward');
        expect(harness.restoreCheckpoint).toHaveBeenCalledWith('after', source);
        expect(harness.target.select).not.toHaveBeenCalled();
    }
);

test.each([true, false])('creation selects on restore without a tile click (animated: %s)', async animated => {
    const harness = makeHarness();
    const source = {targetId: 'source', targetRef: {name: 'Sprite1', isStage: false}};
    const destination = {targetId: 'destination', targetRef: {name: 'Sprite2', isStage: false}};
    let selected = source;
    harness.target.resolve = jest.fn(() => null);
    harness.target.current = () => selected;
    harness.target.isSelected.mockImplementation(item => item.targetId === selected.targetId);
    const presentTargetSelection = jest.fn(item => {
        selected = item;
        return Promise.resolve();
    });
    harness.restoreCheckpoint.mockImplementation(async (id, editingTarget) => {
        selected = editingTarget;
        await Promise.resolve();
    });
    const presentProjectRestore = animated ? jest.fn(async ({restore}) => {
        expect(selected).toBe(source);
        await restore();
        expect(selected).toEqual(destination);
        return {status: 'presented'};
    }) : null;
    harness.captureProjectState.mockResolvedValue({hash: 'after-hash'});
    await harness.executor.apply({
        kind: 'project-operation',
        operation: {
            type: 'sprite-create',
            afterCheckpointId: 'after',
            afterProjectHash: 'after-hash',
            afterEditingTargetId: destination.targetId,
            afterEditingTargetRef: destination.targetRef
        }
    }, 'forward', {nativeAllowed: false, presentTargetSelection, presentProjectRestore});
    expect(presentTargetSelection).not.toHaveBeenCalled();
    expect(harness.restoreCheckpoint).toHaveBeenCalledWith('after', destination);
    expect(harness.restoreCheckpoint).toHaveBeenCalledTimes(1);
    expect(harness.nativeInteraction.play).not.toHaveBeenCalled();
    expect(harness.target.select).not.toHaveBeenCalled();
});

test.each([false, true])('skipped creation restores exactly once (already applied: %s)', async applied => {
    const harness = makeHarness();
    const presentProjectRestore = jest.fn(async ({restore}) => {
        if (applied) await restore();
        return {status: 'skipped'};
    });
    await expect(harness.executor.apply({
        kind: 'project-operation',
        operation: {type: 'sprite-create', afterCheckpointId: 'after', afterProjectHash: 'captured-hash'}
    }, 'forward', {nativeAllowed: false, presentProjectRestore})).resolves.toMatchObject({status: 'verified'});
    expect(harness.restoreCheckpoint).toHaveBeenCalledTimes(1);
    expect(harness.restoreCheckpoint).toHaveBeenCalledWith('after', expect.any(Object));
});
