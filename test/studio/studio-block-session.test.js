import {
    absentVariableDefinition,
    attachStudioBlockSession,
    createReplayActionPort,
    historyViewportPresentation
} from '../../src/studio/bridge/studio-block-session';
import {VIEWPORT_PRESENTATION_MODES} from '../../src/studio/bridge/scratch-blocks-viewport-port';
import {beginStudioDataValueEdit} from '../../src/studio/bridge/data-value-edit-hook';
import {beginStudioListValueEdit} from '../../src/studio/bridge/list-value-edit-hook';
import {
    beginStudioProjectEditSession,
    endStudioProjectEditSession,
    runStudioProjectEditMutation
} from '../../src/studio/bridge/project-edit-session';
import {makeChangeEvent, makeWorkspace} from './helpers/block-workspace';

const makeStorage = () => {
    const values = new Map();
    return {
        getItem: key => (values.has(key) ? values.get(key) : null),
        setItem: (key, value) => values.set(key, value),
        removeItem: key => values.delete(key)
    };
};

const makeCreateEvent = () => ({
    type: 'create',
    group: 'create-group',
    recordUndo: true,
    workspaceId: 'workspace-1',
    blockId: 'block-1',
    xml: {text: '<block id="block-1" />'},
    ids: ['block-1'],
    toJson: () => ({type: 'create', blockId: 'block-1', ids: ['block-1']})
});

test('retains the variable type when projecting a deleted definition as absent', () => {
    expect(absentVariableDefinition({
        before: {
            present: true,
            id: 'list-1',
            targetRef: {isStage: true, name: 'Stage'},
            type: 'list',
            value: ['a', 'b']
        },
        after: null
    })).toEqual({
        present: false,
        id: 'list-1',
        targetRef: {isStage: true, name: 'Stage'},
        type: 'list'
    });
});

const makeViewportPort = () => ({
    beginTransaction: jest.fn(),
    cancel: jest.fn(),
    capture: jest.fn(() => null),
    detach: jest.fn(),
    ensureInteractionVisible: jest.fn(() => Promise.resolve(false)),
    focusTransaction: jest.fn(() => Promise.resolve(false)),
    observeBeforeAction: jest.fn(),
    prepareBeforeAction: jest.fn(() => Promise.resolve()),
    stop: jest.fn()
});

test('reveals block transitions and field edits', () => {
    expect(historyViewportPresentation({events: [{type: 'create'}, {type: 'move'}]}))
        .toBe(VIEWPORT_PRESENTATION_MODES.REVEAL);
    expect(historyViewportPresentation({events: [{type: 'change'}]}))
        .toBe(VIEWPORT_PRESENTATION_MODES.REVEAL);
    expect(historyViewportPresentation({events: [{type: 'move'}]}))
        .toBe(VIEWPORT_PRESENTATION_MODES.REVEAL);
});

test('propagates block aliases discovered while applying a semantic create', async () => {
    const result = {
        blockAliases: {'recorded-block': 'live-block'},
        vmBlockAliases: {'recorded-block': 'vm-block'}
    };
    const replayBlockAction = jest.fn(() => Promise.resolve(result));
    replayBlockAction.prepareTransaction = jest.fn(() => ({blockAliases: {}}));
    const authoredStatePort = {
        adoptListDefinition: jest.fn(),
        applyDataDelta: jest.fn()
    };
    const listDefinitionPort = {
        adoptDataDelta: jest.fn(),
        adoptDefinition: jest.fn()
    };
    const replay = createReplayActionPort({replayBlockAction, authoredStatePort, listDefinitionPort});
    const action = {eventJson: {type: 'create'}, listDefinition: {name: 'items'}};

    await expect(replay(action)).resolves.toBe(result);
    expect(authoredStatePort.adoptListDefinition).toHaveBeenCalledWith(action.listDefinition);
    expect(listDefinitionPort.adoptDefinition).toHaveBeenCalledWith(action.listDefinition);
    expect(replay.prepareTransaction('transaction', 'forward')).toEqual({blockAliases: {}});
});

test('enables stationary-stack connection alignment only for the Studio session lifetime', async () => {
    const harness = makeHarness(makeStorage());
    expect(harness.workspace.options.snapDraggedBlockToConnection).toBe(true);
    await harness.port.session.ready;
    harness.port.detach();
    expect(harness.workspace.options.snapDraggedBlockToConnection).toBeUndefined();
});

test('pauses every authoring capture path before browser page teardown begins', async () => {
    const listeners = new Map();
    const documentObject = {
        addEventListener: () => {},
        removeEventListener: () => {},
        defaultView: {
            addEventListener: (type, listener) => listeners.set(type, listener),
            removeEventListener: (type, listener) => {
                if (listeners.get(type) === listener) listeners.delete(type);
            }
        }
    };
    const harness = makeHarness(makeStorage(), {documentObject});
    await harness.port.session.ready;
    expect(harness.projectOperationShouldCapture()).toBe(true);

    listeners.get('beforeunload')();
    harness.setModelValue('20');
    harness.workspace.fire(makeChangeEvent());

    expect(harness.projectOperationShouldCapture()).toBe(false);
    expect(harness.port.session.getJournal().transactions).toEqual([]);
    harness.port.detach();
    expect(listeners.size).toBe(0);
});

const makeHarness = (storage, {
    driftAtBase = false,
    driftAtHead = false,
    failReplay = false,
    emitProjectLoadedOnRestore = false,
    defer = callback => callback(),
    nativePlaybackStatus = null,
    lifecycleAnimation = null,
    replayEventValue = null,
    safetyRestoreValue = null,
    verifyTopology,
    buildFreshness = null,
    pointerModelName = 'natural',
    projectCapture = null,
    preferredHashKind = null,
    viewportPort = null,
    vmTargets = [],
    checkpointRestore = null,
    documentObject = null,
    onWait = null,
    settleHistory = () => Promise.resolve()
} = {}) => {
    let modelValue = '10';
    let nextCheckpointId = 42;
    const checkpoints = new Map();
    const checkpointCalls = [];
    const replayValues = [];
    const waitCalls = [];
    let authoredStateDirty = false;
    let pendingDataDelta = null;
    let dataValue = 0;
    let listValue = [];
    const dataReplayValues = [];
    const nativePlaybackCalls = [];
    const nativeSequenceCalls = [];
    const nativePointerDismissCalls = [];
    let nativeInteractionOptions = null;
    const authoredStateCalls = [];
    let projectOperationOptions = null;
    const authoredStatePort = {
        adoptCurrent: () => {
            authoredStateDirty = false;
            authoredStateCalls.push('adopt');
        },
        adoptDataDelta: delta => {
            const targetDelta = delta.targets[0];
            const change = targetDelta.variables.score;
            if (change) dataValue = change.after;
            authoredStateDirty = false;
        },
        adoptListDefinition: () => {},
        detach: () => authoredStateCalls.push('detach'),
        isDirty: () => authoredStateDirty,
        applyDataDelta: (delta, direction) => {
            const targetDelta = delta.targets[0];
            const change = targetDelta.variables.score;
            if (change) {
                dataValue = direction === 'forward' ? change.after : change.before;
                dataReplayValues.push(dataValue);
            }
            const splice = targetDelta.lists.items;
            if (splice) {
                const removed = direction === 'forward' ? splice.removed : splice.inserted;
                const inserted = direction === 'forward' ? splice.inserted : splice.removed;
                listValue.splice(splice.index, removed.length, ...inserted);
            }
        },
        prepare: () => {
            if (!authoredStateDirty) return Promise.resolve({restored: false});
            authoredStateDirty = false;
            authoredStateCalls.push('restore');
            modelValue = 'authored';
            return Promise.resolve({restored: true});
        },
        sealDataChanges: () => {
            authoredStateCalls.push('seal-data');
            if (!pendingDataDelta) return null;
            const delta = pendingDataDelta;
            pendingDataDelta = null;
            authoredStateDirty = false;
            return delta;
        }
    };
    let vm;
    const checkpointPort = {
        create: title => {
            const id = nextCheckpointId++;
            checkpoints.set(id, modelValue);
            checkpointCalls.push(['create', title, id]);
            return Promise.resolve(id);
        },
        restore: id => {
            checkpointCalls.push(['restore', id]);
            modelValue = checkpoints.get(id) || '10';
            if (safetyRestoreValue !== null && id !== 42) modelValue = safetyRestoreValue;
            if (checkpointRestore) checkpointRestore({id, vm});
            if (emitProjectLoadedOnRestore === 'deferred') {
                setTimeout(() => vm.runtime.emit('PROJECT_LOADED'), 0);
            } else if (emitProjectLoadedOnRestore) {
                vm.runtime.emit('PROJECT_LOADED');
            }
            return Promise.resolve();
        }
    };
    const ScratchBlocks = {
        Xml: {domToText: xml => xml.text},
        Events: {
            fromJson: json => ({
                ...json,
                run: () => {
                    if (failReplay) throw new Error('replay failed');
                    replayValues.push(json.newValue);
                    const lifecycleValue = replayEventValue ? replayEventValue(json, modelValue) : void 0;
                    if (replayEventValue && typeof lifecycleValue !== 'undefined') modelValue = lifecycleValue;
                    else if (driftAtBase && json.newValue === '10') modelValue = 'drifted-base';
                    else if (driftAtHead && json.newValue === '20') modelValue = 'drifted-head';
                    else modelValue = json.newValue;
                }
            }),
            disable: () => {},
            enable: () => {}
        }
    };
    const runtimeListeners = new Map();
    const runtime = {
        emit: event => (runtimeListeners.get(event) || []).slice().forEach(listener => listener()),
        getTargetById: id => ({id}),
        on: (event, listener) => {
            runtimeListeners.set(event, [...(runtimeListeners.get(event) || []), listener]);
        },
        removeListener: (event, listener) => {
            runtimeListeners.set(event, (runtimeListeners.get(event) || []).filter(item => item !== listener));
        },
        targets: vmTargets
    };
    vm = {
        editingTarget: {id: 'sprite-a'},
        runtime,
        blockListener: () => {},
        setEditingTarget: id => {
            vm.editingTarget = {id};
        }
    };
    const workspace = makeWorkspace();
    const port = attachStudioBlockSession({
        workspace,
        vm,
        ScratchBlocks,
        sessionEnabled: true,
        storage,
        checkpointPort,
        authoredStatePort,
        listDefinitionPort: {
            adoptDataDelta: () => {},
            adoptDefinition: () => {},
            adoptValue: () => {},
            captureEvent: () => null,
            reset: () => {}
        },
        projectStatePort: {
            capture: ({hashKind} = {}) => Promise.resolve(projectCapture ?
                projectCapture({modelValue, hashKind}) : {
                hash: `hash-${modelValue}`,
                project: {value: modelValue}
                }),
            difference: (expected, actual) => (expected.value === actual.value ? null : {
                path: '$.value',
                expected: expected.value,
                actual: actual.value
            }),
            hash: () => Promise.resolve(`hash-${modelValue}`),
            ...(preferredHashKind ? {preferredHashKind} : {})
        },
        now: () => 1000,
        wait: delayMs => {
            waitCalls.push(delayMs);
            return onWait ? onWait(delayMs) : Promise.resolve();
        },
        defer,
        settleHistory,
        projectReady: () => Promise.resolve(),
        journalKey: 'test-journal',
        documentObject,
        ...(viewportPort ? {createViewport: () => viewportPort} : {}),
        pointerModelName,
        nativeInteractionEnabled: nativePlaybackStatus !== null,
        createNativeInteraction: options => {
            nativeInteractionOptions = options;
            return {
            beginSequence: () => nativeSequenceCalls.push('begin'),
            endSequence: () => nativeSequenceCalls.push('end'),
            dismissPointer: () => nativePointerDismissCalls.push('dismiss'),
            play: async ({transaction, direction, presentationMode, signal}) => {
                nativePlaybackCalls.push({transactionId: transaction.id, direction, presentationMode});
                const status = typeof nativePlaybackStatus === 'function' ?
                    await nativePlaybackStatus({transaction, direction, signal}) : nativePlaybackStatus;
                if (status === 'verified') {
                    const details = transaction.events[0].details;
                    modelValue = (direction === 'forward' ? details.newValue : details.oldValue).value;
                }
                return Promise.resolve({
                    status,
                    evidence: {gate: status}
                });
            },
            cancelActive: () => nativeSequenceCalls.push('cancel')
        };
        },
        createLifecycleAnimation: () => lifecycleAnimation || ({
            captureBefore: () => ({exiting: []}),
            playAfter: () => Promise.resolve({animated: 0}),
            discard: () => {},
            detach: () => {}
        }),
        createProjectOperationCapture: options => {
            projectOperationOptions = options;
            return {detach: () => {}};
        },
        verifyTopology: verifyTopology || (() => ({matches: true, checked: 0, results: []})),
        buildFreshness
    });
    return {
        authoredStateCalls,
        checkpointCalls,
        dataReplayValues,
        getDataValue: () => dataValue,
        getModelValue: () => modelValue,
        getListValue: () => listValue.slice(),
        nativePlaybackCalls,
        nativePointerDismissCalls,
        nativeSequenceCalls,
        getNativeInteractionOptions: () => nativeInteractionOptions,
        projectOperationShouldCapture: () => projectOperationOptions.shouldCapture(),
        port,
        replayValues,
        runProjectOperation: (operation, invoke, complete) =>
            projectOperationOptions.captureOperation(operation, invoke, complete),
        vm,
        waitCalls,
        workspace,
        markRuntimeDirty: () => {
            authoredStateDirty = true;
        },
        setRuntimeData: (before, after) => {
            dataValue = after;
            authoredStateDirty = true;
            pendingDataDelta = {
                schemaVersion: 1,
                targets: [{
                    targetRef: {isStage: true, name: 'Stage'},
                    variables: {score: {before, after}},
                    lists: {}
                }]
            };
        },
        recordScalarEdit: (before, after) => {
            dataValue = before;
            const finish = beginStudioDataValueEdit(vm, {
                targetId: 'sprite-a',
                targetRef: {isStage: false, name: 'Sprite1'},
                dataTargetRef: {isStage: false, name: 'Sprite1'},
                variableId: 'score',
                variableName: 'score',
                valueType: 'scalar',
                before
            });
            dataValue = after;
            if (finish) finish(after);
        },
        setModelValue: value => {
            modelValue = value;
        },
        recordListEdit: (before, after) => {
            listValue = before.slice();
            const finish = beginStudioListValueEdit(vm, {
                targetId: 'sprite-a',
                targetRef: {isStage: false, name: 'Sprite1'},
                dataTargetRef: {isStage: false, name: 'Sprite1'},
                variableId: 'items',
                before,
                after
            });
            listValue = after.slice();
            if (finish) finish();
        }
    };
};

test('canonicalizes obscured shadow ownership before project boundary capture', async () => {
    const shadow = {id: 'shadow', parent: null, topLevel: true, x: 40, y: 50, shadow: true};
    const blocks = {
        parent: {id: 'parent', inputs: {VALUE: {block: 'reporter', shadow: 'shadow'}}},
        reporter: {id: 'reporter', parent: 'parent', topLevel: false},
        shadow
    };
    const resetCache = jest.fn();
    const vmTargets = [{
        id: 'sprite-a',
        blocks: {_blocks: blocks, _scripts: ['shadow'], resetCache}
    }];
    const captures = [];
    const harness = makeHarness(makeStorage(), {
        vmTargets,
        projectCapture: () => {
            captures.push({...shadow});
            return {hash: 'canonical', project: {value: 'canonical'}};
        }
    });

    await harness.port.session.ready;

    expect(captures.length).toBeGreaterThan(0);
    expect(captures[0]).toMatchObject({parent: 'parent', topLevel: false});
    expect(captures[0]).not.toHaveProperty('x');
    expect(captures[0]).not.toHaveProperty('y');
    expect(vmTargets[0].blocks._scripts).toEqual([]);
    expect(resetCache).toHaveBeenCalled();
});

test('records, validates rewind, plays forward and survives a reload', async () => {
    const storage = makeStorage();
    const first = makeHarness(storage);
    await first.port.session.ready;
    expect(first.port.session.getState().status).toBe('recording');

    first.setModelValue('20');
    first.workspace.fire(makeChangeEvent());
    expect(first.port.session.getJournal()).toMatchObject({
        baseCheckpointId: 42,
        baseProjectHash: 'hash-10'
    });
    expect(first.port.session.getJournal().transactions).toHaveLength(1);

    expect(await first.port.session.rewind()).toMatchObject({matches: true});
    expect(first.getModelValue()).toBe('10');
    expect(await first.port.session.play({stepDelayMs: 0})).toMatchObject({matches: true});
    expect(first.getModelValue()).toBe('20');

    first.setModelValue('30');
    first.workspace.fire(makeChangeEvent('20', '30'));
    expect(first.port.session.getState()).toMatchObject({
        status: 'recording',
        eventCount: 2,
        stepCount: 1
    });
    expect(first.port.session.getJournal().endProjectHash).toBeNull();
    expect(await first.port.session.rewind()).toMatchObject({matches: true});
    expect(first.port.session.getJournal().endProjectHash).toBe('hash-30');
    expect(first.port.session.getJournal().endProject).toEqual({value: '30'});
    first.port.detach();

    const reloaded = makeHarness(storage);
    await reloaded.port.session.ready;
    expect(reloaded.checkpointCalls).toEqual([['restore', 42]]);
    expect(reloaded.port.session.getState().status).toBe('ready to play');
    expect(await reloaded.port.session.play({stepDelayMs: 0})).toMatchObject({
        matches: true,
        expectedHash: 'hash-30'
    });
    expect(reloaded.getModelValue()).toBe('30');
    reloaded.port.detach();
});

test('does not clear a reloaded take for a deferred restore PROJECT_LOADED event', async () => {
    const storage = makeStorage();
    const first = makeHarness(storage);
    await first.port.session.ready;
    first.setModelValue('20');
    first.workspace.fire(makeChangeEvent());
    first.port.detach();

    const reloaded = makeHarness(storage, {emitProjectLoadedOnRestore: 'deferred'});
    await reloaded.port.session.ready;

    expect(reloaded.port.session.getState()).toMatchObject({
        status: 'ready to play',
        stepCount: 1,
        eventCount: 1
    });
    expect(reloaded.port.session.getJournal().transactions).toHaveLength(1);
    reloaded.port.detach();
});

test('reports a canonical head difference after the take is reloaded', async () => {
    const storage = makeStorage();
    const recorded = makeHarness(storage);
    await recorded.port.session.ready;
    recorded.setModelValue('20');
    recorded.workspace.fire(makeChangeEvent('10', '20'));
    await recorded.port.session.rewind();
    recorded.port.detach();

    const reloaded = makeHarness(storage, {driftAtHead: true});
    await reloaded.port.session.ready;

    expect(await reloaded.port.session.play({stepDelayMs: 0})).toMatchObject({
        matches: false,
        difference: {
            path: '$.value',
            expected: '20',
            actual: 'drifted-head'
        }
    });
    reloaded.port.detach();
});

test('validates a legacy v4 take through its v5 tuple-identity compatibility projection', async () => {
    const projectCapture = ({modelValue, hashKind}) => {
        const semanticValue = modelValue.replace(/-[ab]$/, '');
        const value = hashKind === 'structural-v5' ? semanticValue : modelValue;
        return {structural: {hash: `hash-${value}`, project: {value}}};
    };
    const harness = makeHarness(makeStorage(), {
        preferredHashKind: 'structural-v4',
        projectCapture
    });
    await harness.port.session.ready;

    // The event is semantically the same after replay, but its v4 identity
    // token changes as Blockly recreates the nested input.
    harness.setModelValue('20-a');
    harness.workspace.fire(makeChangeEvent('10', '20-b'));
    await expect(harness.port.session.rewind()).resolves.toMatchObject({matches: true});
    expect(harness.getModelValue()).toBe('10');

    await expect(harness.port.session.play({stepDelayMs: 0})).resolves.toMatchObject({
        matches: true,
        compatibilityHashKind: 'structural-v5',
        expectedHash: 'hash-20',
        actualHash: 'hash-20'
    });
    expect(harness.getModelValue()).toBe('20-b');
    expect(harness.port.session.getState()).toMatchObject({status: 'played', cursor: 1});
});

test('fails closed when an open Studio tab no longer matches the server bundle', async () => {
    let freshnessState = {
        status: 'current',
        loadedBuildId: 'loaded-build',
        currentBuildId: 'loaded-build'
    };
    let freshnessListener;
    const buildFreshness = {
        check: jest.fn(() => Promise.resolve({...freshnessState})),
        watch: listener => {
            freshnessListener = listener;
            return jest.fn();
        }
    };
    const harness = makeHarness(makeStorage(), {buildFreshness});
    await harness.port.session.ready;
    harness.setModelValue('20');
    harness.workspace.fire(makeChangeEvent());

    freshnessState = {
        status: 'stale',
        loadedBuildId: 'loaded-build',
        currentBuildId: 'new-build'
    };
    freshnessListener({...freshnessState});

    expect(harness.port.session.getState()).toMatchObject({
        canUndo: false,
        buildFreshness: freshnessState
    });
    await expect(harness.port.session.undo()).rejects.toThrow(
        'Studio build is stale: loaded loaded-build, current new-build'
    );
    expect(harness.getModelValue()).toBe('20');
});

test('paces playback between user actions rather than internal grouped events', async () => {
    const harness = makeHarness(makeStorage());
    await harness.port.session.ready;

    harness.setModelValue('20');
    harness.workspace.fire(makeChangeEvent('10', '20', 'drag-group'));
    harness.setModelValue('30');
    harness.workspace.fire(makeChangeEvent('20', '30', 'drag-group'));
    harness.setModelValue('40');
    harness.workspace.fire(makeChangeEvent('30', '40', 'field-group'));
    expect(harness.port.session.getState()).toMatchObject({eventCount: 3, stepCount: 2});

    await harness.port.session.rewind();
    await harness.port.session.play({stepDelayMs: 250});
    expect(harness.waitCalls).toEqual([250]);
    harness.port.detach();
});

test('persists per-transaction pauses and scales them in both timeline directions', async () => {
    const harness = makeHarness(makeStorage());
    await harness.port.session.ready;

    for (const [oldValue, newValue, group] of [
        ['10', '20', 'group-1'],
        ['20', '30', 'group-2'],
        ['30', '40', 'group-3']
    ]) {
        harness.setModelValue(newValue);
        harness.workspace.fire(makeChangeEvent(oldValue, newValue, group));
    }

    await expect(harness.port.session.setTransactionPause(1, 800)).resolves.toMatchObject({
        index: 1,
        pauseAfterMs: 800
    });
    await harness.port.session.setTransactionPause(2, 0);
    await harness.port.session.setTransactionPause(3, 1200);
    expect(harness.port.session.getTimeline().map(item => item.pauseAfterMs)).toEqual([800, 0, 1200]);

    await harness.port.session.rewind();
    await harness.port.session.play({speed: 2});
    expect(harness.waitCalls).toEqual([400]);

    harness.waitCalls.length = 0;
    await harness.port.session.playHistory({direction: 'backward', speed: 4});
    expect(harness.waitCalls).toEqual([300]);
    expect(harness.port.session.getState()).toMatchObject({cursor: 0, status: 'positioned'});

    await expect(harness.port.session.setTransactionPause(0, 100))
        .rejects.toThrow('Timeline transaction must be between 1 and 3');
    harness.port.detach();
});

test('seeks one authoritative timeline cursor and plays bounded ranges in either direction', async () => {
    const viewport = makeViewportPort();
    const harness = makeHarness(makeStorage(), {viewportPort: viewport});
    await harness.port.session.ready;

    for (const [oldValue, newValue, group] of [
        ['10', '20', 'group-1'],
        ['20', '30', 'group-2'],
        ['30', '40', 'group-3']
    ]) {
        harness.setModelValue(newValue);
        harness.workspace.fire(makeChangeEvent(oldValue, newValue, group));
    }
    expect(harness.port.session.getState()).toMatchObject({
        cursor: 3,
        transactionCount: 3,
        canUndo: true,
        canRedo: false
    });

    await expect(harness.port.session.seek(1)).resolves.toMatchObject({cursor: 1, transactionCount: 3});
    expect(harness.getModelValue()).toBe('20');
    expect(harness.port.session.getState()).toMatchObject({
        status: 'positioned',
        cursor: 1,
        transactionCount: 3,
        canUndo: true,
        canRedo: true
    });
    viewport.beginTransaction.mockClear();

    await expect(harness.port.session.playHistory({
        direction: 'forward',
        targetIndex: 3,
        speed: 2,
        stepDelayMs: 220
    })).resolves.toMatchObject({cursor: 3, cancelled: false});
    expect(harness.getModelValue()).toBe('40');
    expect(harness.waitCalls).toEqual([110]);
    expect(viewport.beginTransaction).toHaveBeenCalledTimes(4);
    expect(viewport.beginTransaction.mock.calls.every(call => call[2].speed === 2)).toBe(true);
    expect(viewport.beginTransaction.mock.calls.map(call => call[2].presentationMode)).toEqual([
        VIEWPORT_PRESENTATION_MODES.REVEAL, VIEWPORT_PRESENTATION_MODES.PRESERVE,
        VIEWPORT_PRESENTATION_MODES.REVEAL, VIEWPORT_PRESENTATION_MODES.PRESERVE
    ]);
    viewport.beginTransaction.mockClear();

    await expect(harness.port.session.playHistory({
        direction: 'backward',
        speed: 4,
        stepDelayMs: 220
    })).resolves.toMatchObject({cursor: 0, cancelled: false});
    expect(harness.getModelValue()).toBe('10');
    expect(harness.waitCalls).toEqual([110, 55, 55]);
    expect(viewport.beginTransaction).toHaveBeenCalledTimes(6);
    expect(viewport.beginTransaction.mock.calls.every(call => call[2].speed === 4)).toBe(true);
    expect(harness.port.session.getState()).toMatchObject({
        status: 'positioned',
        cursor: 0,
        canUndo: false,
        canRedo: true
    });

    await expect(harness.port.session.seek(4)).rejects.toThrow('Timeline position must be between 0 and 3');
});

test('dismisses the realistic Play cursor before every history transport', async () => {
    const harness = makeHarness(makeStorage(), {nativePlaybackStatus: 'verified'});
    await harness.port.session.ready;

    for (const [oldValue, newValue, group] of [
        ['10', '20', 'group-1'],
        ['20', '30', 'group-2']
    ]) {
        harness.setModelValue(newValue);
        harness.workspace.fire(makeChangeEvent(oldValue, newValue, group));
    }

    await harness.port.session.undo();
    await harness.port.session.seek(0);
    await harness.port.session.playHistory({direction: 'forward', targetIndex: 2, stepDelayMs: 0});
    await harness.port.session.rewind();

    expect(harness.nativePointerDismissCalls).toEqual(['dismiss', 'dismiss', 'dismiss', 'dismiss']);
    harness.port.detach();
});

test('undoes and redoes recorded transactions and truncates a replaced branch', async () => {
    const harness = makeHarness(makeStorage());
    await harness.port.session.ready;

    harness.setModelValue('20');
    harness.workspace.fire(makeChangeEvent('10', '20', 'group-1'));
    harness.setModelValue('30');
    harness.workspace.fire(makeChangeEvent('20', '30', 'group-2'));
    expect(harness.port.session.getState()).toMatchObject({canUndo: true, canRedo: false});

    await harness.port.session.undo();
    expect(harness.getModelValue()).toBe('20');
    expect(harness.port.session.getState()).toMatchObject({
        status: 'undone',
        canUndo: true,
        canRedo: true
    });

    expect(await harness.port.session.undo()).toMatchObject({matches: true});
    expect(harness.getModelValue()).toBe('10');
    expect(harness.port.session.getState()).toMatchObject({canUndo: false, canRedo: true});

    await harness.port.session.redo();
    expect(harness.getModelValue()).toBe('20');
    harness.setModelValue('40');
    harness.workspace.fire(makeChangeEvent('20', '40', 'replacement-group'));

    expect(harness.port.session.getState()).toMatchObject({canUndo: true, canRedo: false});
    expect(harness.port.session.getJournal().transactions).toHaveLength(2);
    expect(harness.port.session.getJournal().transactions[1].events[0].details.newValue.value)
        .toBe('40');
    expect(await harness.port.session.redo()).toBeNull();
    harness.port.detach();
});

test('keeps ordinary history semantic even when realistic native playback is available', async () => {
    const order = [];
    const lifecycleAnimation = {
        captureBefore: ({direction}) => {
            order.push(`capture:${direction}`);
            return {direction, exiting: []};
        },
        playAfter: ({direction, before}) => {
            order.push(`present:${direction}:${before.direction}`);
            return Promise.resolve({animated: 1});
        },
        discard: () => order.push('discard'),
        detach: () => {}
    };
    const harness = makeHarness(makeStorage(), {
        nativePlaybackStatus: 'verified',
        lifecycleAnimation,
        replayEventValue: json => {
            order.push(`semantic:${json.type}`);
            return json.type === 'create' ? 'created' : '10';
        },
        verifyTopology: ({direction}) => {
            order.push(`topology:${direction}`);
            return {matches: true, checked: 1, results: []};
        }
    });
    await harness.port.session.ready;
    harness.setModelValue('created');
    harness.workspace.fire(makeCreateEvent());

    await harness.port.session.undo();
    expect(harness.getModelValue()).toBe('10');
    expect(order).toEqual([
        'capture:backward',
        'semantic:delete',
        'topology:backward',
        'present:backward:backward'
    ]);
    expect(harness.nativePlaybackCalls).toEqual([]);

    order.length = 0;
    await harness.port.session.redo();
    expect(harness.getModelValue()).toBe('created');
    expect(order).toEqual([
        'capture:forward',
        'semantic:create',
        'topology:forward',
        'present:forward:forward'
    ]);
    expect(harness.nativePlaybackCalls).toEqual([]);
    harness.port.detach();
});

test('keeps the fast lifecycle presentation out of rewind and panel Play', async () => {
    const lifecycleCalls = [];
    const harness = makeHarness(makeStorage(), {
        lifecycleAnimation: {
            captureBefore: () => {
                lifecycleCalls.push('capture');
                return {exiting: []};
            },
            playAfter: () => {
                lifecycleCalls.push('present');
                return Promise.resolve({animated: 0});
            },
            discard: () => {},
            detach: () => {}
        },
        replayEventValue: json => (json.type === 'create' ? 'created' : '10')
    });
    await harness.port.session.ready;
    harness.setModelValue('created');
    harness.workspace.fire(makeCreateEvent());

    await harness.port.session.rewind();
    await harness.port.session.play({stepDelayMs: 0});

    expect(harness.getModelValue()).toBe('created');
    expect(lifecycleCalls).toEqual([]);
    harness.port.detach();
});

test('ordinary history does not invoke a native interaction driver', async () => {
    const harness = makeHarness(makeStorage(), {nativePlaybackStatus: 'verified'});
    await harness.port.session.ready;
    harness.setModelValue('20');
    harness.workspace.fire(makeChangeEvent('10', '20', 'native-group'));

    await harness.port.session.undo();
    expect(harness.port.session.getState()).toMatchObject({canRedo: true});
    await harness.port.session.redo();

    expect(harness.getModelValue()).toBe('20');
    expect(harness.port.session.getState()).toMatchObject({
        status: 'redone',
        canUndo: true,
        canRedo: false,
        nativeInteraction: null
    });
    expect(harness.nativePlaybackCalls).toEqual([]);
    harness.port.detach();
});

test('traverses multiple ordinary history stages without native interaction', async () => {
    const harness = makeHarness(makeStorage(), {nativePlaybackStatus: 'verified'});
    await harness.port.session.ready;
    harness.setModelValue('20');
    harness.workspace.fire(makeChangeEvent('10', '20', 'native-group-1'));
    harness.setModelValue('30');
    harness.workspace.fire(makeChangeEvent('20', '30', 'native-group-2'));

    await harness.port.session.undo();
    expect(harness.getModelValue()).toBe('20');
    await harness.port.session.undo();
    expect(harness.getModelValue()).toBe('10');
    await harness.port.session.redo();
    expect(harness.getModelValue()).toBe('20');
    await harness.port.session.redo();
    expect(harness.getModelValue()).toBe('30');

    expect(harness.nativePlaybackCalls).toEqual([]);
    expect(harness.port.session.getState()).toMatchObject({
        status: 'redone',
        canUndo: true,
        canRedo: false,
        nativeInteraction: null
    });
    harness.port.detach();
});

test('plays every remaining history stage through native interaction playback', async () => {
    const harness = makeHarness(makeStorage(), {nativePlaybackStatus: 'verified'});
    await harness.port.session.ready;
    harness.setModelValue('20');
    harness.workspace.fire(makeChangeEvent('10', '20', 'native-group-1'));
    harness.setModelValue('30');
    harness.workspace.fire(makeChangeEvent('20', '30', 'native-group-2'));

    await harness.port.session.rewind();
    await harness.port.session.play({stepDelayMs: 125});

    expect(harness.getModelValue()).toBe('30');
    expect(harness.nativePlaybackCalls.map(call => call.direction)).toEqual(['forward', 'forward']);
    expect(harness.nativePlaybackCalls.map(call => call.presentationMode)).toEqual(['realistic', 'realistic']);
    expect(harness.waitCalls).toEqual([125]);
    expect(harness.nativeSequenceCalls).toEqual(['begin', 'end']);
    expect(harness.port.session.getState()).toMatchObject({
        status: 'played',
        canUndo: true,
        canRedo: false,
        nativeInteraction: {status: 'verified'}
    });
    harness.port.detach();
});

test('passes the selected pointer model into native interaction playback', async () => {
    const harness = makeHarness(makeStorage(), {
        nativePlaybackStatus: 'verified',
        pointerModelName: 'deterministic'
    });
    await harness.port.session.ready;

    expect(harness.getNativeInteractionOptions()).toMatchObject({pointerModelName: 'deterministic'});
});

test('changing history cursor preference never changes the recorded take and persists on restart', async () => {
    const storage = makeStorage();
    const harness = makeHarness(storage);
    await harness.port.session.ready;
    harness.setModelValue('20');
    harness.workspace.fire(makeChangeEvent('10', '20', 'pointer-preference'));
    const recorded = JSON.stringify(harness.port.session.getJournal());
    expect(harness.port.session.getState().historyPointerEnabled).toBe(true);
    harness.port.session.setHistoryPointerEnabled(false);
    expect(harness.port.session.getState().historyPointerEnabled).toBe(false);
    expect(JSON.stringify(harness.port.session.getJournal())).toBe(recorded);
    harness.port.detach();
    const restarted = makeHarness(storage);
    await restarted.port.session.ready;
    expect(restarted.port.session.getState().historyPointerEnabled).toBe(false);
    restarted.port.detach();
});

test('ordinary history remains available when realistic native playback would mismatch', async () => {
    const harness = makeHarness(makeStorage(), {
        nativePlaybackStatus: 'mismatch'
    });
    await harness.port.session.ready;
    harness.setModelValue('20');
    harness.workspace.fire(makeChangeEvent('10', '20', 'native-group'));
    await harness.port.session.undo();

    await expect(harness.port.session.redo()).resolves.toMatchObject({matches: true});
    expect(harness.getModelValue()).toBe('20');
    expect(harness.port.session.getState()).toMatchObject({
        canUndo: true,
        canRedo: false,
        status: 'redone',
        nativeInteraction: null
    });
    expect(harness.nativePlaybackCalls).toEqual([]);
    harness.port.detach();
});

test('restores the exact playback boundary when native verification fails partway through Play', async () => {
    let forwardAttempts = 0;
    const harness = makeHarness(makeStorage(), {
        nativePlaybackStatus: ({direction}) => {
            if (direction !== 'forward') return 'unsupported';
            return forwardAttempts++ === 1 ? 'mismatch' : 'unsupported';
        }
    });
    await harness.port.session.ready;
    harness.setModelValue('20');
    harness.workspace.fire(makeChangeEvent('10', '20', 'first-group'));
    harness.setModelValue('30');
    harness.workspace.fire(makeChangeEvent('20', '30', 'second-group'));
    await harness.port.session.rewind();

    await expect(harness.port.session.play({stepDelayMs: 0})).rejects.toThrow(
        'Native interaction did not match the recorded transaction'
    );

    expect(harness.getModelValue()).toBe('20');
    expect(harness.port.session.getState()).toMatchObject({
        status: 'Native interaction did not match the recorded transaction — restored',
        canUndo: true,
        canRedo: true
    });
    await expect(harness.port.session.redo()).resolves.toMatchObject({matches: true});
    expect(harness.getModelValue()).toBe('30');
    harness.port.detach();
});

test('records checkpoint-backed project operations and traverses them exactly', async () => {
    const harness = makeHarness(makeStorage());
    await harness.port.session.ready;

    const result = await harness.runProjectOperation(
        {type: 'sprite-create'},
        async () => {
            harness.setModelValue('sprite-added');
            harness.vm.setEditingTarget('sprite-b');
            return 'created-target';
        },
        () => ({targetId: 'sprite-b', targetRef: {isStage: false, name: 'Sprite2'}})
    );

    expect(result).toBe('created-target');
    expect(harness.port.session.getState()).toMatchObject({eventCount: 1, stepCount: 1});
    expect(harness.port.session.getJournal().transactions[0]).toMatchObject({
        kind: 'project-operation',
        operation: {
            type: 'sprite-create',
            beforeProjectHash: 'hash-10',
            afterProjectHash: 'hash-sprite-added'
        }
    });

    await expect(harness.port.session.undo()).resolves.toMatchObject({prepared: true});
    expect(harness.getModelValue()).toBe('sprite-added');
    expect(harness.port.session.getState().cursor).toBe(1);
    await harness.port.session.undo();
    expect(harness.getModelValue()).toBe('10');
    expect(harness.vm.editingTarget.id).toBe('sprite-a');
    // This lightweight harness retains both target IDs even at the base.
    await expect(harness.port.session.redo()).resolves.toMatchObject({prepared: true});
    expect(harness.getModelValue()).toBe('10');
    await harness.port.session.redo();
    expect(harness.getModelValue()).toBe('sprite-added');
    expect(harness.vm.editingTarget.id).toBe('sprite-b');
    harness.port.detach();
});

test('checkpoints a script share only after the source drag rollback settles', async () => {
    const harness = makeHarness(makeStorage());
    await harness.port.session.ready;
    let finishDrag;
    harness.workspace.whenBlockOperationsComplete = callback => {
        finishDrag = callback;
    };
    harness.setModelValue('temporary-copy');
    const invoke = jest.fn(() => {
        harness.setModelValue('shared');
        return Promise.resolve();
    });
    const pending = harness.runProjectOperation({type: 'block-share'}, invoke, () => ({}));
    expect(invoke).not.toHaveBeenCalled();
    expect(harness.port.session.getState().busy).toBe(true);
    harness.setModelValue('10');
    finishDrag();
    await pending;
    expect(harness.port.session.getJournal().transactions[0].operation).toMatchObject({
        beforeProjectHash: 'hash-10', afterProjectHash: 'hash-shared'
    });
    harness.port.detach();
});

test('defers a remounted project editor until history restoration is idle', async () => {
    let releaseSettle;
    let reportSettleStarted;
    const settleStarted = new Promise(resolve => {
        reportSettleStarted = resolve;
    });
    const settlePromise = new Promise(resolve => {
        releaseSettle = resolve;
    });
    const harness = makeHarness(makeStorage(), {
        settleHistory: () => {
            reportSettleStarted();
            return settlePromise;
        }
    });
    await harness.port.session.ready;
    harness.setModelValue('20');
    harness.workspace.fire(makeChangeEvent('10', '20', 'block-edit'));

    const undo = harness.port.session.undo();
    await settleStarted;
    expect(harness.port.session.getState().busy).toBe(true);

    const token = beginStudioProjectEditSession(harness.vm, {
        type: 'costume-edit-session',
        targetId: 'sprite-a'
    });
    let mutationRan = false;
    const mutation = runStudioProjectEditMutation(harness.vm, token, () => {
        mutationRan = true;
        harness.setModelValue('painted');
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(mutationRan).toBe(false);

    releaseSettle();
    await undo;
    await mutation;
    await endStudioProjectEditSession(harness.vm, token);

    expect(mutationRan).toBe(true);
    expect(harness.getModelValue()).toBe('painted');
    expect(harness.port.session.getJournal().transactions).toHaveLength(1);
    expect(harness.port.session.getJournal().transactions[0]).toMatchObject({
        kind: 'project-operation',
        operation: {type: 'costume-edit-session'}
    });
    harness.port.detach();
});

test('freezes project-operation target references before an in-place rename mutates the VM target', async () => {
    const harness = makeHarness(makeStorage());
    await harness.port.session.ready;
    const target = {
        id: 'sprite-b',
        isStage: false,
        sprite: {name: 'Sprite2'},
        getName () {
            return this.sprite.name;
        }
    };
    harness.vm.editingTarget = target;

    await harness.runProjectOperation(
        {type: 'sprite-rename', targetId: target.id, targetRef: {isStage: false, name: 'Sprite2'}},
        () => {
            target.sprite.name = 'Hero';
            harness.setModelValue('renamed');
        },
        () => ({newName: 'Hero', renamedTargetRef: {isStage: false, name: 'Hero'}})
    );

    expect(harness.port.session.getJournal().transactions[0].operation).toMatchObject({
        beforeEditingTargetId: 'sprite-b',
        beforeEditingTargetRef: {isStage: false, name: 'Sprite2'},
        afterEditingTargetId: 'sprite-b',
        afterEditingTargetRef: {isStage: false, name: 'Hero'}
    });
    harness.port.detach();
});

test('discards a checkpoint-backed operation which made no semantic project change', async () => {
    const harness = makeHarness(makeStorage());
    await harness.port.session.ready;

    await expect(harness.runProjectOperation(
        {type: 'sprite-rename'},
        () => 'unchanged',
        () => ({oldName: 'Sprite1', newName: 'Sprite1'})
    )).resolves.toBe('unchanged');

    expect(harness.port.session.getJournal().transactions).toEqual([]);
    expect(harness.port.session.getState()).toMatchObject({status: 'recording', busy: false, stepCount: 0});
    harness.port.detach();
});

test('does not truncate redo for a checkpoint-backed operation which made no semantic change', async () => {
    const harness = makeHarness(makeStorage());
    await harness.port.session.ready;
    harness.setModelValue('20');
    harness.workspace.fire(makeChangeEvent());
    await harness.port.session.undo();

    await harness.runProjectOperation(
        {type: 'costume-add'},
        () => 'unchanged',
        () => ({})
    );

    expect(harness.port.session.getJournal().transactions).toHaveLength(1);
    expect(harness.port.session.getState()).toMatchObject({
        status: 'recording',
        busy: false,
        stepCount: 1,
        canRedo: true
    });
    harness.port.detach();
});

test('rolls back a visually plausible but semantically invalid block connection', async () => {
    const harness = makeHarness(makeStorage(), {
        verifyTopology: ({direction}) => direction === 'forward' ? {
            matches: false,
            checked: 1,
            results: [{reason: 'VM topology differs'}]
        } : {matches: true, checked: 1, results: []}
    });
    await harness.port.session.ready;
    harness.setModelValue('20');
    harness.workspace.fire(makeChangeEvent('10', '20', 'move-group'));
    await harness.port.session.undo();

    await expect(harness.port.session.redo()).rejects.toThrow(
        'Block topology did not match the recorded connection'
    );
    expect(harness.getModelValue()).toBe('10');
    expect(harness.port.session.getState()).toMatchObject({
        status: 'Block topology did not match the recorded connection — restored',
        canUndo: false,
        canRedo: true,
        validation: {matches: false, checked: 1}
    });
    harness.port.detach();
});

test('normalizes a non-Error Blockly failure and still restores the safety checkpoint', async () => {
    const harness = makeHarness(makeStorage(), {
        replayEventValue: () => {
            throw 'Attempted to connect a block to itself.'; // eslint-disable-line no-throw-literal
        }
    });
    await harness.port.session.ready;
    harness.setModelValue('20');
    harness.workspace.fire(makeChangeEvent('10', '20', 'move-group'));

    await expect(harness.port.session.undo()).rejects.toThrow('Attempted to connect a block to itself.');

    expect(harness.getModelValue()).toBe('20');
    expect(harness.port.session.getState()).toMatchObject({
        status: 'Attempted to connect a block to itself. — restored',
        canUndo: true,
        canRedo: false
    });
    harness.port.detach();
});

test.each([true, false])('sprite selection consumes its own Undo/Redo command (cursor: %s)', async cursorEnabled => {
    const viewport = makeViewportPort();
    const harness = makeHarness(makeStorage(), {viewportPort: viewport});
    const framedTargets = [];
    viewport.beginTransaction.mockImplementation(() => framedTargets.push(harness.vm.editingTarget.id));
    await harness.port.session.ready;
    harness.port.session.setHistoryPointerEnabled(cursorEnabled);

    harness.setModelValue('20');
    harness.workspace.fire(makeChangeEvent('10', '20', 'sprite-a-edit'));
    harness.vm.setEditingTarget('sprite-b');
    harness.setModelValue('30');
    harness.workspace.fire(makeChangeEvent('20', '30', 'sprite-b-edit'));
    harness.vm.setEditingTarget('sprite-a');

    const transactions = harness.port.session.getJournal().transactions;
    const checkpoints = harness.checkpointCalls.slice();
    await expect(harness.port.session.undo()).resolves.toMatchObject({prepared: true});
    expect(harness.getModelValue()).toBe('30');
    expect(harness.vm.editingTarget.id).toBe('sprite-b');
    expect(harness.replayValues).toEqual([]);
    expect(framedTargets).toEqual([]);
    expect(harness.checkpointCalls).toEqual(checkpoints);
    expect(harness.port.session.getJournal().transactions).toEqual(transactions);
    expect(harness.port.session.getState()).toMatchObject({
        cursor: 2, status: 'selected sprite-b — press Undo again', canUndo: true, canRedo: false
    });
    await harness.port.session.undo();
    expect(harness.getModelValue()).toBe('20');
    expect(harness.replayValues).toEqual(['20']);
    expect(harness.vm.editingTarget.id).toBe('sprite-b');
    expect(framedTargets.every(id => id === 'sprite-b')).toBe(true);
    expect(harness.port.session.getState()).toMatchObject({
        status: 'undone',
        canUndo: true,
        canRedo: true
    });

    harness.vm.setEditingTarget('sprite-a');
    await expect(harness.port.session.redo()).resolves.toMatchObject({prepared: true});
    expect(harness.getModelValue()).toBe('20');
    expect(harness.port.session.getState().cursor).toBe(1);
    await harness.port.session.redo();
    expect(harness.getModelValue()).toBe('30');
    expect(harness.replayValues).toEqual(['20', '30']);
    expect(harness.vm.editingTarget.id).toBe('sprite-b');
    expect(harness.port.session.getState()).toMatchObject({
        status: 'redone',
        canUndo: true,
        canRedo: false
    });
    harness.port.detach();
});

const recordCrossSpriteEdits = async harness => {
    await harness.port.session.ready;
    harness.setModelValue('20');
    harness.workspace.fire(makeChangeEvent('10', '20', 'sprite-a-edit'));
    harness.vm.setEditingTarget('sprite-b');
    harness.setModelValue('30');
    harness.workspace.fire(makeChangeEvent('20', '30', 'sprite-b-edit'));
    harness.vm.setEditingTarget('sprite-a');
};

test('timeline playback pauses before cross-sprite edits; exact seeking does not', async () => {
    const observed = [];
    const harness = makeHarness(makeStorage(), {onWait: delay => {
        observed.push({delay, value: harness.getModelValue(), cursor: harness.port.session.getState().cursor});
        return Promise.resolve();
    }});
    await recordCrossSpriteEdits(harness);
    await harness.port.session.setTargetSelectionPause(700);
    await harness.port.session.playHistory({direction: 'backward', speed: 2});
    expect(observed).toEqual([
        {delay: 350, value: '30', cursor: 2},
        {delay: 110, value: '20', cursor: 1},
        {delay: 350, value: '20', cursor: 1}
    ]);
    await harness.port.session.playHistory({direction: 'forward', speed: 2});
    expect(harness.getModelValue()).toBe('30');
    expect(harness.waitCalls).toEqual([350, 110, 350, 110, 350]);
    observed.length = 0;
    await harness.port.session.seek(0);
    expect(observed).toEqual([]);
    expect(harness.getModelValue()).toBe('10');
    await harness.port.session.play({stepDelayMs: 0, speed: 2});
    expect(observed).toEqual([{delay: 350, value: '20', cursor: 1}]);
    expect(harness.getModelValue()).toBe('30');
    harness.port.detach();
});

test.each(['timeline', 'tutorial'])('Stop during a sprite pause leaves the next edit intact (%s)', async mode => {
    let stopAtPause = false;
    const harness = makeHarness(makeStorage(), {onWait: () => {
        if (stopAtPause) harness.port.session.stopPlayback();
        return Promise.resolve();
    }});
    await recordCrossSpriteEdits(harness);
    await harness.port.session.seek(1);
    harness.vm.setEditingTarget('sprite-a');
    stopAtPause = true;
    const play = () => mode === 'timeline' ? harness.port.session.playHistory({stepDelayMs: 0}) :
        harness.port.session.play({stepDelayMs: 0});
    await play();
    expect(harness.port.session.getState()).toMatchObject({cursor: 1, status: 'stopped', busy: false});
    expect(harness.getModelValue()).toBe('20');
    expect(harness.vm.editingTarget.id).toBe('sprite-b');
    stopAtPause = false;
    await play();
    expect(harness.port.session.getState().cursor).toBe(2);
    expect(harness.getModelValue()).toBe('30');
    harness.port.detach();
});

test('sprite pause persists in the take without changing its edits, and resets with a new take', async () => {
    const storage = makeStorage();
    const harness = makeHarness(storage);
    await recordCrossSpriteEdits(harness);
    const transactions = harness.port.session.getJournal().transactions;
    await harness.port.session.setTargetSelectionPause(850);
    expect(harness.port.session.getJournal().transactions).toEqual(transactions);
    await expect(harness.port.session.setTargetSelectionPause(-1)).rejects.toThrow('Studio sprite pause');
    expect(harness.port.session.getState().targetSelectionPauseMs).toBe(850);
    harness.port.detach();
    const restored = makeHarness(storage);
    await restored.port.session.ready;
    expect(restored.port.session.getState().targetSelectionPauseMs).toBe(850);
    expect(restored.port.session.getJournal().transactions).toEqual(transactions);
    await restored.port.session.startNewTake();
    expect(restored.port.session.getState().targetSelectionPauseMs).toBe(500);
    restored.port.detach();
});

test('restores dirty runtime state and undoes within the same history command', async () => {
    const harness = makeHarness(makeStorage());
    await harness.port.session.ready;

    harness.setModelValue('20');
    harness.workspace.fire(makeChangeEvent('10', '20', 'group-1'));
    harness.setModelValue('runtime-value');
    harness.markRuntimeDirty();

    await harness.port.session.undo();
    expect(harness.getModelValue()).toBe('10');
    expect(harness.replayValues).toEqual(['10']);
    expect(harness.authoredStateCalls).toContain('restore');
    expect(harness.port.session.getState()).toMatchObject({
        status: 'undone',
        canUndo: false,
        canRedo: true
    });
    harness.port.detach();
});

test('folds runtime data into visible steps and replays it with undo and redo', async () => {
    const harness = makeHarness(makeStorage());
    await harness.port.session.ready;

    harness.setModelValue('20');
    harness.workspace.fire(makeChangeEvent('10', '20', 'group-1'));
    harness.setRuntimeData(0, 30);
    harness.setModelValue('30');
    harness.workspace.fire(makeChangeEvent('20', '30', 'group-2'));
    harness.setRuntimeData(30, 45);

    expect(harness.port.session.getState()).toMatchObject({eventCount: 2, stepCount: 2});
    expect(await harness.port.session.undo()).not.toEqual({prepared: true});
    expect(harness.getModelValue()).toBe('20');
    expect(harness.getDataValue()).toBe(30);

    await harness.port.session.undo();
    expect(harness.getModelValue()).toBe('10');
    expect(harness.getDataValue()).toBe(0);
    expect(harness.dataReplayValues).toEqual([30, 0]);

    await harness.port.session.redo();
    expect(harness.getDataValue()).toBe(30);
    await harness.port.session.redo();
    expect(harness.getDataValue()).toBe(45);
    expect(harness.port.session.getState()).toMatchObject({eventCount: 2, stepCount: 2});
    harness.port.detach();
});

test('continues playback from the current Studio history position', async () => {
    const harness = makeHarness(makeStorage());
    await harness.port.session.ready;

    harness.setModelValue('20');
    harness.workspace.fire(makeChangeEvent('10', '20', 'group-1'));
    harness.setModelValue('30');
    harness.workspace.fire(makeChangeEvent('20', '30', 'group-2'));

    await harness.port.session.undo();
    expect(harness.replayValues).toEqual(['20']);

    await harness.port.session.play({stepDelayMs: 0});
    expect(harness.getModelValue()).toBe('30');
    expect(harness.replayValues).toEqual(['20', '30']);
    expect(harness.port.session.getState()).toMatchObject({
        status: 'played',
        canUndo: true,
        canRedo: false
    });
    harness.port.detach();
});

test('starts native Play after an interrupted history presentation', async () => {
    const harness = makeHarness(makeStorage(), {nativePlaybackStatus: 'verified'});
    await harness.port.session.ready;

    harness.setModelValue('20');
    harness.workspace.fire(makeChangeEvent('10', '20', 'group-1'));
    harness.port.session.finishHistoryPresentation();

    await expect(harness.port.session.play({stepDelayMs: 0})).resolves.toMatchObject({matches: true});
    expect(harness.nativePlaybackCalls).toEqual([{
        transactionId: expect.any(String),
        direction: 'forward',
        presentationMode: 'realistic'
    }]);
    expect(harness.nativeSequenceCalls).toEqual(['begin', 'end']);
    harness.port.detach();
});

test('refuses to replay over the head when rewind did not validate the base', async () => {
    const harness = makeHarness(makeStorage());
    await harness.port.session.ready;
    harness.setModelValue('20');
    harness.workspace.fire(makeChangeEvent('10', '20', 'group-1'));
    harness.port.session.rewind = jest.fn(() => Promise.resolve({matches: false}));

    await expect(harness.port.session.play({stepDelayMs: 0})).rejects.toThrow(
        'Cannot play: rewind did not reach the recorded base'
    );
    expect(harness.replayValues).toEqual([]);
    expect(harness.port.session.getState()).toMatchObject({status: 'Cannot play: rewind did not reach the recorded base'});
    harness.port.detach();
});

test('stops active Play with rollback and can resume from the same cursor', async () => {
    let forwardAttempts = 0;
    const harness = makeHarness(makeStorage(), {
        nativePlaybackStatus: ({direction, signal}) => {
            if (direction === 'backward') return 'unsupported';
            forwardAttempts++;
            if (forwardAttempts > 1) return 'verified';
            return new Promise(resolve => signal.addEventListener('abort', () => resolve('cancelled')));
        }
    });
    await harness.port.session.ready;
    harness.setModelValue('20');
    harness.workspace.fire(makeChangeEvent('10', '20', 'group-1'));
    await harness.port.session.undo();

    const playback = harness.port.session.play({stepDelayMs: 0});
    for (let attempt = 0; attempt < 20 && !harness.nativePlaybackCalls.some(call => (
        call.direction === 'forward'
    )); attempt++) await Promise.resolve();
    expect(harness.nativePlaybackCalls.some(call => call.direction === 'forward')).toBe(true);
    expect(harness.port.session.getState().status).toBe('playing');
    expect(harness.port.session.stopPlayback()).toBe(true);

    await expect(playback).resolves.toEqual({cancelled: true, cursor: 0});
    expect(harness.getModelValue()).toBe('10');
    expect(harness.port.session.getState()).toMatchObject({
        status: 'stopped',
        busy: false,
        canUndo: false,
        canRedo: true
    });
    expect(harness.port.session.stopPlayback()).toBe(false);

    await expect(harness.port.session.play({stepDelayMs: 0})).resolves.toMatchObject({matches: true});
    expect(harness.getModelValue()).toBe('20');
    harness.port.detach();
});

test('repairs a drifted final undo from the canonical base checkpoint', async () => {
    const harness = makeHarness(makeStorage(), {driftAtBase: true});
    await harness.port.session.ready;

    harness.setModelValue('20');
    harness.workspace.fire(makeChangeEvent('10', '20'));

    expect(await harness.port.session.undo()).toMatchObject({
        matches: true,
        repaired: true,
        actualHash: 'hash-10'
    });
    expect(harness.getModelValue()).toBe('10');
    expect(harness.port.session.getState()).toMatchObject({
        status: 'undone',
        canUndo: false,
        canRedo: true
    });

    expect(await harness.port.session.undo()).toBeNull();
    await harness.port.session.redo();
    expect(harness.getModelValue()).toBe('20');
    harness.port.detach();
});

test('restores the canonical checkpoint at cursor zero even when the project hash already matches', async () => {
    const harness = makeHarness(makeStorage());
    await harness.port.session.ready;

    harness.setModelValue('20');
    harness.workspace.fire(makeChangeEvent('10', '20'));

    expect(await harness.port.session.rewind()).toMatchObject({
        matches: true,
        repaired: true,
        actualHash: 'hash-10'
    });
    expect(harness.checkpointCalls).toContainEqual(['restore', 42]);
    expect(harness.getModelValue()).toBe('10');
    harness.port.detach();
});

test('retains the durable Stage selection when the base checkpoint regenerates target IDs', async () => {
    const initialStage = {id: 'stage-before', isOriginal: true, isStage: true, getName: () => 'Stage'};
    const initialSprite = {id: 'sprite-before', isOriginal: true, isStage: false, getName: () => 'Sprite1'};
    const restoredStage = {id: 'stage-after', isOriginal: true, isStage: true, getName: () => 'Stage'};
    const restoredSprite = {id: 'sprite-after', isOriginal: true, isStage: false, getName: () => 'Sprite1'};
    const harness = makeHarness(makeStorage(), {
        vmTargets: [initialStage, initialSprite],
        checkpointRestore: ({id, vm}) => {
            if (id !== 42) return;
            vm.runtime.targets = [restoredStage, restoredSprite];
            vm.runtime.getTargetById = targetId => vm.runtime.targets.find(target => target.id === targetId) || null;
            vm.editingTarget = restoredSprite;
        }
    });
    await harness.port.session.ready;
    harness.vm.runtime.getTargetById = id => harness.vm.runtime.targets.find(target => target.id === id) || null;
    harness.vm.setEditingTarget = id => {
        harness.vm.editingTarget = harness.vm.runtime.targets.find(target => target.id === id) || null;
    };
    harness.vm.editingTarget = initialStage;
    harness.setModelValue('20');
    harness.workspace.fire(makeChangeEvent('10', '20', 'stage-edit'));

    await expect(harness.port.session.undo()).resolves.toMatchObject({matches: true, repaired: true});
    expect(harness.vm.editingTarget).toBe(restoredStage);
    harness.port.detach();
});

test('repairs a drifted full rewind from the canonical base checkpoint', async () => {
    const harness = makeHarness(makeStorage(), {driftAtBase: true});
    await harness.port.session.ready;

    harness.setModelValue('20');
    harness.workspace.fire(makeChangeEvent('10', '20'));

    expect(await harness.port.session.rewind()).toMatchObject({
        matches: true,
        repaired: true,
        expectedHash: 'hash-10',
        actualHash: 'hash-10'
    });
    expect(harness.checkpointCalls).toContainEqual(['restore', 42]);
    expect(harness.port.session.getState()).toMatchObject({
        status: 'rewound',
        canUndo: false,
        canRedo: true
    });
    harness.port.detach();
});

test('reports the first project difference when redo drifts from the canonical head', async () => {
    const harness = makeHarness(makeStorage(), {driftAtHead: true});
    await harness.port.session.ready;

    harness.setModelValue('20');
    harness.workspace.fire(makeChangeEvent('10', '20'));
    await harness.port.session.undo();

    expect(await harness.port.session.redo()).toMatchObject({
        matches: false,
        difference: {
            path: '$.value',
            expected: '20',
            actual: 'drifted-head'
        }
    });
    expect(harness.port.session.getState()).toMatchObject({
        status: 'state mismatch',
        canUndo: false,
        canRedo: false
    });
    harness.port.detach();
});

test('publishes replay failures and releases the busy state', async () => {
    const harness = makeHarness(makeStorage(), {failReplay: true});
    await harness.port.session.ready;
    harness.setModelValue('20');
    harness.workspace.fire(makeChangeEvent());

    await expect(harness.port.session.rewind()).rejects.toThrow('replay failed');
    expect(harness.port.session.getState()).toMatchObject({
        status: 'replay failed — restored',
        busy: false,
        validation: null
    });
    harness.port.detach();
});

test('starts a clean take from the current project state', async () => {
    const harness = makeHarness(makeStorage());
    await harness.port.session.ready;
    harness.setModelValue('20');
    harness.workspace.fire(makeChangeEvent());

    await harness.port.session.startNewTake();
    expect(harness.port.session.getState()).toMatchObject({status: 'recording', eventCount: 0});
    expect(harness.port.session.getJournal()).toMatchObject({
        baseCheckpointId: 43,
        baseProjectHash: 'hash-20',
        transactions: []
    });
    harness.port.detach();
});

test('starts fresh history automatically after an external project replacement', async () => {
    const harness = makeHarness(makeStorage());
    await harness.port.session.ready;
    harness.setModelValue('20');
    harness.workspace.fire(makeChangeEvent());

    harness.setModelValue('new-project');
    harness.vm.runtime.emit('PROJECT_LOADED');
    while (harness.port.session.getState().busy) await new Promise(resolve => setTimeout(resolve, 0));

    expect(harness.port.session.getState()).toMatchObject({
        status: 'recording new project',
        projectReplaced: false,
        canUndo: false,
        canRedo: false
    });
    expect(harness.port.session.getJournal()).toMatchObject({
        baseProjectHash: 'hash-new-project',
        transactions: []
    });
    expect(await harness.port.session.undo()).toBeNull();

    harness.setModelValue('new-project-edit');
    harness.workspace.fire(makeChangeEvent('new-project', 'new-project-edit'));
    await harness.port.session.undo();
    expect(harness.getModelValue()).toBe('new-project');
    harness.port.detach();
});

test('does not invalidate a take when Studio restores its canonical checkpoint', async () => {
    const harness = makeHarness(makeStorage(), {
        driftAtBase: true,
        emitProjectLoadedOnRestore: true
    });
    await harness.port.session.ready;
    harness.setModelValue('20');
    harness.workspace.fire(makeChangeEvent());

    await harness.port.session.undo();

    expect(harness.port.session.getState()).toMatchObject({
        status: 'undone',
        projectReplaced: false,
        canRedo: true
    });
    harness.port.detach();
});

test('ignores a late project-loaded event when the project is still at a known take boundary', async () => {
    const harness = makeHarness(makeStorage());
    await harness.port.session.ready;
    harness.setModelValue('20');
    harness.workspace.fire(makeChangeEvent());
    await harness.port.session.rewind();

    harness.vm.runtime.emit('PROJECT_LOADED');
    while (harness.port.session.getState().busy) await new Promise(resolve => setTimeout(resolve, 0));

    expect(harness.port.session.getState()).toMatchObject({
        status: 'rewound',
        projectReplaced: false,
        stepCount: 1,
        canRedo: true
    });
    expect(harness.port.session.getJournal().transactions).toHaveLength(1);
    harness.port.detach();
});

test('repairs a late known-head project load over a reloaded base without clearing the take', async () => {
    const storage = makeStorage();
    const first = makeHarness(storage);
    await first.port.session.ready;
    first.setModelValue('20');
    first.workspace.fire(makeChangeEvent());
    await first.port.session.rewind();
    first.port.detach();

    const reloaded = makeHarness(storage);
    await reloaded.port.session.ready;
    reloaded.setModelValue('20');
    reloaded.vm.runtime.emit('PROJECT_LOADED');
    while (reloaded.port.session.getState().busy) await new Promise(resolve => setTimeout(resolve, 0));

    expect(reloaded.getModelValue()).toBe('10');
    expect(reloaded.port.session.getState()).toMatchObject({
        status: 'ready to play',
        stepCount: 1,
        canRedo: true
    });
    expect(reloaded.port.session.getJournal().transactions).toHaveLength(1);
    reloaded.port.detach();
});

test('records a direct list edit as one visible data transaction', async () => {
    const replacement = makeHarness(makeStorage());
    await replacement.port.session.ready;
    replacement.recordListEdit(['one'], ['one', 'two']);

    expect(replacement.port.session.getState()).toMatchObject({eventCount: 1, stepCount: 1});
    expect(replacement.port.session.getJournal().transactions[0]).toMatchObject({
        kind: 'data-edit',
        events: [],
        afterDataDeltas: [{
            targets: [{lists: {items: {index: 1, removed: [], inserted: ['two']}}}]
        }]
    });
    await replacement.port.session.undo();
    expect(replacement.getListValue()).toEqual(['one']);
    await replacement.port.session.redo();
    expect(replacement.getListValue()).toEqual(['one', 'two']);
    replacement.port.detach();
});

test('records a direct scalar gesture as one labelled reversible data transaction', async () => {
    const harness = makeHarness(makeStorage());
    await harness.port.session.ready;
    harness.recordScalarEdit(0, 37);

    expect(harness.port.session.getState()).toMatchObject({eventCount: 1, stepCount: 1});
    expect(harness.port.session.getTimeline()).toEqual([
        expect.objectContaining({index: 1, label: 'Set score', target: 'Sprite1'})
    ]);
    expect(harness.port.session.getJournal().transactions[0]).toMatchObject({
        kind: 'data-edit',
        dataEditLabel: 'Set score',
        afterDataDeltas: [{
            targets: [{variables: {score: {before: 0, after: 37}}}]
        }]
    });

    await harness.port.session.undo();
    expect(harness.getDataValue()).toBe(0);
    await harness.port.session.redo();
    expect(harness.getDataValue()).toBe(37);
    harness.port.detach();
});

test('does not truncate redo for a scalar gesture whose value did not change', async () => {
    const harness = makeHarness(makeStorage());
    await harness.port.session.ready;
    harness.setModelValue('20');
    harness.workspace.fire(makeChangeEvent());
    await harness.port.session.undo();

    harness.recordScalarEdit(0, 0);

    expect(harness.port.session.getJournal().transactions).toHaveLength(1);
    expect(harness.port.session.getState()).toMatchObject({canRedo: true, stepCount: 1});
    harness.port.detach();
});

test('groups an Enter list edit and its inserted row into one history step', async () => {
    const deferred = [];
    const harness = makeHarness(makeStorage(), {defer: callback => deferred.push(callback)});
    await harness.port.session.ready;
    deferred.shift()();

    harness.recordListEdit(['one'], ['edited']);
    harness.recordListEdit(['edited'], ['edited', '']);

    expect(harness.port.session.getState()).toMatchObject({eventCount: 1, stepCount: 1});
    expect(harness.port.session.getJournal().transactions[0].afterDataDeltas).toHaveLength(2);
    deferred.forEach(callback => callback());
    harness.port.detach();
});
