import {attachStudioBlockCapture} from './block-workspace-port';
import {createAuthoredStatePort} from './authored-state-port';
import {createListDefinitionPort} from './list-definition-port';
import {attachStudioDataValueListener} from './data-value-edit-hook';
import {attachStudioTargetPropertyListener} from './target-property-edit-hook';
import {createProjectStatePort} from './project-state-port';
import {createRestorePointCheckpointPort} from './restore-point-checkpoint-port';
import {
    createScratchBlocksReplayPort,
    createScratchBlocksTargetPort
} from './scratch-blocks-replay-port';
import {
    VIEWPORT_PRESENTATION_MODES,
    createScratchBlocksViewportPort
} from './scratch-blocks-viewport-port';
import {
    attachProjectOperationCapture,
    costumeReference,
    targetReference
} from './project-operation-capture';
import {
    attachStudioProjectEditSessionController,
    createStudioProjectEditSessionController
} from './project-edit-session';
import {attachStudioHistoryCommands} from './studio-history-command-port';
import {createHistoryCommandQueue} from './history-command-queue';
import {createHistoryTransactionExecutor} from './history-transaction-executor';
import {historyTargetBeforeApply} from './history-target-reference';
import {createStudioSessionPanel} from './studio-session-panel';
import {createStudioBuildFreshness} from './studio-build-freshness';
import {seedLongCameraFixture} from './studio-camera-fixture';
import {seedConnectionMatrixFixture} from './studio-connection-matrix-fixture';
import {createBlockTransitionPresentationPort} from './block-transition-presentation-port';
import {createHistoryPointerPresentation} from './history-pointer-presentation';
import {HISTORY_POINTER_QUERY, readHistoryPointerPreference, saveHistoryPointerPreference}
    from './history-pointer-settings';
import {createInteractionPlaybackPort} from './native-interaction/interaction-playback-port';
import {verifyTransactionTopology} from './transaction-topology-verifier';
import {reconcileVmBlockGraph} from './vm-block-graph-reconciler';
import {createJournalRecorder} from '../journal/journal-recorder';
import {describeTransaction} from '../timeline/transaction-descriptor';
import {createJournalStore} from '../journal/journal-store';
import {snapshotStartsTransaction, targetSelectionPause} from '../journal/journal';
import {replayTransactionWithResult} from '../replay/replay-engine';
import {
    createListValueDelta,
    createTargetPropertyDelta,
    createTargetPropertiesDelta,
    createVariableValueDelta
} from '../state/data-state-delta';

const SESSION_GLOBAL = '__TURBOWARP_TUTORIAL_STUDIO_SESSION__';
const SESSION_QUERY = 'studio-session';
const SESSION_TAKE_QUERY = 'studio-take';
const PLAY_POINTER_QUERY = 'studio-play-pointer';
const POINTER_MODEL_QUERY = 'studio-pointer-model';
const CAMERA_FIXTURE_QUERY = 'studio-camera-fixture';
const CONNECTION_MATRIX_FIXTURE_QUERY = 'studio-connection-matrix-fixture';
const JOURNAL_KEY_PREFIX = 'turbowarp-tutorial-studio/journal/v1/';
const BLOCKLY_STATIONARY_STACK_OPTION = 'snapDraggedBlockToConnection';

const isSessionRequested = () => {
    if (typeof window === 'undefined') return false;
    return new URLSearchParams(window.location.search).get(SESSION_QUERY) === '1';
};

const requestedTakeId = () => {
    if (typeof window === 'undefined') return 'default';
    return new URLSearchParams(window.location.search).get(SESSION_TAKE_QUERY) || 'default';
};

const requestedPlayPointerEnabled = () => {
    if (typeof window === 'undefined') return true;
    return new URLSearchParams(window.location.search).get(PLAY_POINTER_QUERY) !== '0';
};

const requestedPointerModelName = () => {
    if (typeof window === 'undefined') return 'natural';
    const requested = new URLSearchParams(window.location.search).get(POINTER_MODEL_QUERY);
    return requested === 'deterministic' ? requested : 'natural';
};

const requestedCameraFixtureEnabled = () => {
    if (typeof window === 'undefined') return false;
    return new URLSearchParams(window.location.search).get(CAMERA_FIXTURE_QUERY) === 'long-script';
};

const requestedConnectionMatrixFixtureEnabled = () => {
    if (typeof window === 'undefined') return false;
    return new URLSearchParams(window.location.search).get(CONNECTION_MATRIX_FIXTURE_QUERY) === '1';
};

const sleep = (ms, signal = null) => new Promise(resolve => {
    if (signal && signal.aborted) return resolve();
    let timer = null;
    const finish = () => {
        clearTimeout(timer);
        if (signal) signal.removeEventListener('abort', finish);
        resolve();
    };
    timer = setTimeout(finish, ms);
    if (signal) signal.addEventListener('abort', finish, {once: true});
});
const deferWork = callback => setTimeout(callback, 0);

const settleEditorTasks = async documentObject => {
    await new Promise(resolve => setTimeout(resolve, 0));
    const view = documentObject && documentObject.defaultView;
    if (view && typeof view.requestAnimationFrame === 'function') {
        await new Promise(resolve => view.requestAnimationFrame(resolve));
    }
    await new Promise(resolve => setTimeout(resolve, 0));
};

const waitForProjectReady = vm => {
    if (vm.runtime.targets.length > 0 && vm.assets.length > 0) return Promise.resolve();
    return new Promise(resolve => vm.runtime.once('PROJECT_LOADED', resolve));
};

const journalCounts = journal => ({
    eventCount: journal ?
        journal.transactions.reduce((total, transaction) =>
            total + transaction.events.length +
                (transaction.kind === 'data-edit' || transaction.kind === 'project-operation' ? 1 : 0), 0) : 0,
    stepCount: journal ? journal.transactions.length : 0
});

const historyViewportPresentation = transaction => (
    transaction.events && transaction.events.some(event =>
        ['move', 'create', 'delete', 'change'].includes(event.type)) ?
        VIEWPORT_PRESENTATION_MODES.REVEAL : VIEWPORT_PRESENTATION_MODES.PRESERVE
);

const transactionPauseDelay = (transaction, defaultDelayMs, speed) => {
    const authored = transaction && transaction.presentation && transaction.presentation.pauseAfterMs;
    const delay = Number.isFinite(authored) ? authored : defaultDelayMs;
    return delay / speed;
};

const absentVariableDefinition = change => {
    const previous = change.before || change.after;
    return {
        present: false,
        id: previous.id,
        targetRef: previous.targetRef,
        type: previous.type
    };
};

const createReplayActionPort = ({replayBlockAction, authoredStatePort, listDefinitionPort}) => {
    const replayAction = async action => {
        if (action.kind === 'data-state') {
            const result = authoredStatePort.applyDataDelta(action.delta, action.direction);
            listDefinitionPort.adoptDataDelta(action.delta, action.direction);
            return result;
        }
        const result = await replayBlockAction(action);
        if (action.listDefinition) {
            authoredStatePort.adoptListDefinition(action.listDefinition);
            listDefinitionPort.adoptDefinition(action.listDefinition);
        }
        return result;
    };
    replayAction.prepareTransaction = (...args) => replayBlockAction.prepareTransaction(...args);
    return replayAction;
};

const createSession = ({
    workspace,
    vm,
    ScratchBlocks,
    storage,
    checkpointPort,
    projectStatePort,
    authoredStatePort,
    listDefinitionPort,
    createPanel,
    createHistoryCommands,
    documentObject,
    now,
    wait,
    defer,
    projectReady,
    journalKey,
    preCreateMode,
    createViewport,
    historyPointerEnabled = true,
    playPointerEnabled = true,
    pointerModelName,
    nativeInteractionEnabled,
    createNativeInteraction,
    createLifecycleAnimation,
    createHistoryPointer,
    createProjectOperationCapture,
    verifyTopology,
    buildFreshness,
    cameraFixtureEnabled,
    connectionMatrixFixtureEnabled,
    settleHistory
}) => {
    const workspaceOptions = workspace.options || (workspace.options = {});
    const hadStationaryStackOption = Object.prototype.hasOwnProperty.call(
        workspaceOptions,
        BLOCKLY_STATIONARY_STACK_OPTION
    );
    const previousStationaryStackOption = workspaceOptions[BLOCKLY_STATIONARY_STACK_OPTION];
    workspaceOptions[BLOCKLY_STATIONARY_STACK_OPTION] = true;

    const store = createJournalStore({storage, key: journalKey});
    const viewport = createViewport({
        workspace,
        preCreateMode,
        expandScrollRegion: true
    });
    const target = createScratchBlocksTargetPort({vm});
    const replayBlockAction = createScratchBlocksReplayPort({
        workspace,
        vm,
        ScratchBlocks,
        targetPort: target,
        beforeAction: async action => {
            await viewport.prepareBeforeAction(action);
            viewport.observeBeforeAction(action);
        }
    });
    const replayAction = createReplayActionPort({replayBlockAction, authoredStatePort, listDefinitionPort});
    const replayFocus = (presentationMode, playbackSpeed = 1) => ({
        beforeTransaction: (transaction, direction) => viewport.beginTransaction(
            transaction,
            direction,
            {presentationMode, speed: playbackSpeed}
        ),
        afterTransaction: viewport.focusTransaction
    });
    const replaySemanticTransaction = async (
        transaction,
        direction,
        presentationMode,
        playbackSpeed = 1,
        blockAliases = null
    ) => {
        const focus = replayFocus(presentationMode, playbackSpeed);
        const moveOnly = transaction.events && transaction.events.length &&
            transaction.events.every(event => event.type === 'move') &&
            !(transaction.beforeDataDeltas || []).length && !(transaction.afterDataDeltas || []).length;
        if (moveOnly && typeof replayBlockAction.replayMoveTransaction === 'function') {
            await focus.beforeTransaction(transaction, direction);
            const applied = await replayBlockAction.replayMoveTransaction(transaction, direction, {blockAliases});
            await focus.afterTransaction(transaction, direction);
            return applied;
        }
        return replayTransactionWithResult(transaction, replayAction, direction, {...focus, blockAliases});
    };
    const subscribers = new Set();
    const projectEditIdleWaiters = new Set();
    let capture = null;
    let recorder = null;
    let panel = null;
    let historyCommands = null;
    let historyCommandQueue = null;
    let projectOperationCapture = null;
    let projectEditSessionPort = null;
    let detachDataValueListener = null;
    let detachTargetPropertyListener = null;
    let detachBuildFreshness = null;
    let initializationPromise = null;
    let detached = false;
    let projectLoadListenerAttached = false;
    let expectedProjectLoads = 0;
    let projectResetPromise = null;
    let resetAfterProjectLoaded = null;
    let workspacePaused = false;
    let recordingPaused = false;
    let canonicalBaseProject = null;
    let canonicalHeadProject = null;
    let canonicalBaseCompatibility = null;
    let canonicalHeadCompatibility = null;
    let projectHashKind = projectStatePort.preferredHashKind || 'full-project-v1';
    let activeDataValueEditGroup = null;
    let nextDataValueEditGroup = 1;
    let nextTargetPropertyEditGroup = 1;
    let pausedPlaybackTarget = null;
    const pauseAfterTargetSelection = async ({speed = 1, signal = null} = {}) => {
        const delay = targetSelectionPause(recorder.getJournal()) / speed;
        if (delay > 0 && !(signal && signal.aborted)) await wait(delay, signal);
        pausedPlaybackTarget = target.current();
    };
    const nativeInteraction = nativeInteractionEnabled ? createNativeInteraction({
        workspace,
        vm,
        ScratchBlocks,
        documentObject,
        showPointer: playPointerEnabled,
        pointerModelName,
        checkpointPort,
        ensureInteractionVisible: viewport.ensureInteractionVisible,
        afterTargetSelection: pauseAfterTargetSelection,
        journalCounts: () => journalCounts(recorder && recorder.getJournal())
    }) : null;
    const historyPointer = createHistoryPointer({
        workspace,
        vm,
        ScratchBlocks,
        documentObject,
        enabled: historyPointerEnabled,
        pointerModelName,
        journalCounts: () => journalCounts(recorder && recorder.getJournal())
    });
    const lifecycleAnimation = createLifecycleAnimation({
        workspace,
        ScratchBlocks,
        documentObject,
        blockAliases: () => nativeInteraction && nativeInteraction.getSequenceBlockAliases(),
        historyPointer
    });
    const playback = {
        position: 'head',
        endProjectHash: null
    };
    const history = {cursor: 0};
    let historyPresentationInterrupted = false;
    let activePlayController = null;
    let playbackStopRequested = false;
    const debugProjectValidation = typeof window !== 'undefined' &&
        new URLSearchParams(window.location.search).get('studio-debug') === '1';
    const setPlaybackPosition = position => {
        playback.position = position;
    };
    const setEndProjectHash = hash => {
        playback.endProjectHash = hash;
    };
    const truncateRecorder = (transactionCount, source) => {
        if (debugProjectValidation && typeof window !== 'undefined') {
            const trace = window.__TURBOWARP_TUTORIAL_STUDIO_TRUNCATION_TRACE__ || [];
            trace.push({source, transactionCount, cursor: history.cursor});
            window.__TURBOWARP_TUTORIAL_STUDIO_TRUNCATION_TRACE__ = trace;
        }
        recorder.truncate(transactionCount);
    };
    let state = {
        status: 'initializing',
        busy: true,
        eventCount: 0,
        stepCount: 0,
        cursor: 0,
        transactionCount: 0,
        canUndo: false,
        canRedo: false,
        projectReplaced: false,
        validation: null,
        nativeInteraction: null,
        diagnostic: null,
        buildFreshness: null,
        historyPointerEnabled,
        historyCommandActive: false
    };

    const projectEditCaptureIsIdle = () => !detached && !state.busy && !state.projectReplaced &&
        playback.position !== 'unknown' && !recordingPaused && !workspacePaused;

    const rejectProjectEditIdleWaiters = error => {
        const waiters = Array.from(projectEditIdleWaiters);
        projectEditIdleWaiters.clear();
        waiters.forEach(waiter => waiter.reject(error));
    };

    const scheduleProjectEditIdleWaiters = () => {
        if (!projectEditCaptureIsIdle() || !projectEditIdleWaiters.size) return;
        // History commands publish their idle boundary before the command
        // queue advances. Defer editor capture by one task so queued Undo/Redo
        // requests retain the boundary instead of racing a remounted Paint
        // editor for Studio's busy lock.
        defer(() => {
            if (!projectEditCaptureIsIdle()) return;
            const waiters = Array.from(projectEditIdleWaiters);
            projectEditIdleWaiters.clear();
            waiters.forEach(waiter => waiter.resolve());
        });
    };

    const waitForProjectEditCapture = async () => {
        if (initializationPromise) await initializationPromise;
        if (detached) throw new Error('Tutorial Studio session is detached');
        if (state.projectReplaced || playback.position === 'unknown') {
            throw new Error('Tutorial Studio project history is unavailable');
        }
        if (projectEditCaptureIsIdle()) return;
        await new Promise((resolve, reject) => {
            projectEditIdleWaiters.add({resolve, reject});
        });
    };

    const publish = changes => {
        const next = {...state, ...changes};
        const journal = recorder && recorder.getJournal();
        const transactionCount = journal ? journal.transactions.length : 0;
        const buildCurrent = !next.buildFreshness || next.buildFreshness.status === 'current';
        const historyAvailable = !next.busy && !next.projectReplaced &&
            playback.position !== 'unknown' && buildCurrent;
        state = {
            ...next,
            cursor: history.cursor,
            transactionCount,
            targetSelectionPauseMs: targetSelectionPause(journal),
            canUndo: historyAvailable && history.cursor > 0,
            canRedo: historyAvailable && history.cursor < transactionCount
        };
        subscribers.forEach(subscriber => subscriber({...state}));
        scheduleProjectEditIdleWaiters();
    };

    const assertBuildCurrent = async () => {
        if (!buildFreshness) return null;
        const result = await buildFreshness.check();
        publish({buildFreshness: result});
        if (result.status !== 'current') {
            const error = new Error(
                result.status === 'stale' ?
                    `Studio build is stale: loaded ${result.loadedBuildId}, current ${result.currentBuildId}` :
                    'Studio build freshness could not be verified'
            );
            error.buildFreshness = result;
            throw error;
        }
        return result;
    };

    const updatePlaybackPosition = transactionCount => {
        if (history.cursor === 0) setPlaybackPosition('base');
        else if (history.cursor === transactionCount) setPlaybackPosition('head');
        else setPlaybackPosition('partial');
    };

    const syncCapture = () => {
        if (!capture) return;
        if (workspacePaused || recordingPaused) capture.pause();
        else capture.resume();
    };

    const pageView = documentObject && documentObject.defaultView;
    const pauseCaptureForPageExit = () => {
        recordingPaused = true;
        syncCapture();
        if (capture) capture.clear();
    };
    if (pageView && typeof pageView.addEventListener === 'function') {
        pageView.addEventListener('beforeunload', pauseCaptureForPageExit, true);
        pageView.addEventListener('pagehide', pauseCaptureForPageExit, true);
    }

    const restoreCheckpoint = async (checkpointId, editingTarget = null) => {
        if (nativeInteraction && typeof nativeInteraction.resetSequenceBlockAliases === 'function') {
            nativeInteraction.resetSequenceBlockAliases();
        }
        expectedProjectLoads++;
        try {
            await checkpointPort.restore(checkpointId);
            // Project loading chooses the first sprite. Reapply the intended
            // view in this microtask, before yielding a frame to the GUI, so
            // restoring data never presents an unrelated sprite to the viewer.
            if (editingTarget && target.resolve(editingTarget) && !target.isSelected(editingTarget)) {
                await target.select(editingTarget);
            }
            // Some VM restore paths resolve before their PROJECT_LOADED event
            // has crossed the GUI task queue. Keep that event classified as
            // part of this expected restore until the editor has painted the
            // restored project; otherwise a reload can mistake it for File ->
            // New and replace the persisted take with an empty journal.
            await settleEditorTasks(documentObject);
        } finally {
            expectedProjectLoads--;
        }
    };

    const handleProjectLoaded = () => {
        if (detached || expectedProjectLoads > 0 || projectResetPromise) return;
        if (capture) capture.flush();
        recordingPaused = true;
        syncCapture();
        const previousStatus = state.status;
        publish({busy: true, validation: null});
        projectResetPromise = resetAfterProjectLoaded(previousStatus);
    };

    const attachProjectLoadListener = () => {
        const runtime = vm.runtime;
        if (!runtime || typeof runtime.on !== 'function' || projectLoadListenerAttached) return;
        runtime.on('PROJECT_LOADED', handleProjectLoaded);
        projectLoadListenerAttached = true;
    };

    const detachProjectLoadListener = () => {
        const runtime = vm.runtime;
        if (!runtime || !projectLoadListenerAttached) return;
        const remove = runtime.removeListener || runtime.off;
        if (typeof remove === 'function') remove.call(runtime, 'PROJECT_LOADED', handleProjectLoaded);
        projectLoadListenerAttached = false;
    };

    const flushCapture = () => {
        if (capture) capture.flush();
    };

    const appendDataDelta = (transactionIndex, phase, delta) => {
        if (!delta) return;
        recorder.appendDataDelta(transactionIndex, phase, delta);
        listDefinitionPort.adoptDataDelta(delta, 'forward');
        setEndProjectHash(null);
        canonicalHeadProject = null;
        canonicalHeadCompatibility = null;
    };

    const adoptRecordedListDefinition = snapshot => {
        const change = snapshot.details && snapshot.details.definition;
        if (!change) return;
        authoredStatePort.adoptListDefinition(change.after || absentVariableDefinition(change));
    };

    const beginDataValueEdit = edit => {
        if (recordingPaused || workspacePaused || state.busy || state.projectReplaced) return null;
        flushCapture();
        if (!activeDataValueEditGroup) {
            let leadingDataDelta = null;
            if (authoredStatePort.isDirty()) {
                const delta = authoredStatePort.sealDataChanges();
                if (delta && history.cursor > 0) appendDataDelta(history.cursor - 1, 'after', delta);
                else leadingDataDelta = delta;
            }
            activeDataValueEditGroup = {
                id: `data-value-edit-${nextDataValueEditGroup++}`,
                leadingDataDelta,
                transactionIndex: null
            };
        }
        const group = activeDataValueEditGroup;
        return after => {
            const delta = edit.valueType === 'list' ?
                createListValueDelta(edit.dataTargetRef, edit.variableId, edit.before, after) :
                createVariableValueDelta(edit.dataTargetRef, edit.variableId, edit.before, after);
            if (delta) {
                if (group.transactionIndex === null) {
                    const journal = recorder.getJournal();
                    if (history.cursor < journal.transactions.length) {
                        truncateRecorder(history.cursor, 'data-value-edit');
                    }
                    group.transactionIndex = recorder.getJournal().transactions.length;
                }
                recorder.recordDataEdit({
                    targetId: edit.targetId,
                    targetRef: edit.targetRef,
                    group: group.id,
                    label: edit.variableName ? `Set ${edit.variableName}` : 'Set variable',
                    recordedAtMs: now(),
                    delta
                });
                if (group.leadingDataDelta) {
                    appendDataDelta(group.transactionIndex, 'before', group.leadingDataDelta);
                    group.leadingDataDelta = null;
                }
                authoredStatePort.adoptDataDelta(delta);
                if (edit.valueType === 'list') listDefinitionPort.adoptValue(edit.variableId, after);
                history.cursor = recorder.getJournal().transactions.length;
                setPlaybackPosition('head');
                setEndProjectHash(null);
                canonicalHeadProject = null;
                canonicalHeadCompatibility = null;
                publish({status: 'recording', ...journalCounts(recorder.getJournal())});
            }
            defer(() => {
                if (activeDataValueEditGroup === group) activeDataValueEditGroup = null;
            });
        };
    };

    const beginTargetPropertyEdit = edit => {
        if (recordingPaused || workspacePaused || state.busy || state.projectReplaced) return null;
        flushCapture();
        let leadingDataDelta = null;
        if (authoredStatePort.isDirty()) {
            const delta = authoredStatePort.sealDataChanges();
            if (delta && history.cursor > 0) appendDataDelta(history.cursor - 1, 'after', delta);
            else leadingDataDelta = delta;
        }
        const group = {
            id: `target-property-edit-${nextTargetPropertyEditGroup++}`,
            leadingDataDelta
        };
        return after => {
            const delta = edit.targets ? createTargetPropertiesDelta(edit.targets.map((snapshot, index) => ({
                targetRef: snapshot.targetRef,
                before: snapshot.before,
                after: after[index]
            }))) : createTargetPropertyDelta(edit.targetRef, edit.before, after);
            if (!delta) return;
            const journal = recorder.getJournal();
            if (history.cursor < journal.transactions.length) {
                truncateRecorder(history.cursor, 'target-property-edit');
            }
            const transactionIndex = recorder.getJournal().transactions.length;
            recorder.recordDataEdit({
                targetId: edit.targetId,
                targetRef: edit.targetRef,
                group: group.id,
                recordedAtMs: now(),
                delta
            });
            if (group.leadingDataDelta) appendDataDelta(transactionIndex, 'before', group.leadingDataDelta);
            authoredStatePort.adoptDataDelta(delta);
            history.cursor = recorder.getJournal().transactions.length;
            setPlaybackPosition('head');
            setEndProjectHash(null);
            canonicalHeadProject = null;
            canonicalHeadCompatibility = null;
            publish({status: 'recording', ...journalCounts(recorder.getJournal())});
        };
    };

    const sealHeadData = ({stopRuntime = false} = {}) => {
        if (!authoredStatePort.isDirty() || playback.position !== 'head' || history.cursor === 0) {
            return null;
        }
        const delta = authoredStatePort.sealDataChanges({stopRuntime});
        if (delta) appendDataDelta(history.cursor - 1, 'after', delta);
        return delta;
    };

    const selectHistoryTarget = async (item, speed) => {
        if (target.isSelected(item)) return false;
        const presentation = historyPresentationInterrupted ? null : await historyPointer.selectTarget(item, {speed});
        if (!presentation || presentation.status === 'unsupported' || presentation.status === 'cancelled') {
            // Catch-up skips the pointer, never the semantic target selection.
            await target.select(item);
        } else if (presentation.status !== 'verified') {
            throw new Error('Visible Studio history target selection did not settle');
        }
        return true;
    };

    const prepareHistoryOperation = async (
        transaction,
        direction,
        presentationMode = VIEWPORT_PRESENTATION_MODES.REVEAL,
        {
            deferViewportFocus = false,
            presentTargetSelection = false,
            historyTargetSelection = null,
            playbackSpeed = 1,
            signal = null
        } = {}
    ) => {
        const restoreAuthoredState = authoredStatePort.isDirty();
        if (transaction.kind === 'project-operation') {
            if (restoreAuthoredState) await authoredStatePort.prepare();
            return {restoredAuthoredState: restoreAuthoredState, selectedTarget: false};
        }
        const selectTarget = !target.isSelected(transaction);
        if (restoreAuthoredState) await authoredStatePort.prepare();
        if (selectTarget && historyTargetSelection) {
            await historyTargetSelection(transaction);
        } else if (selectTarget) {
            let targetPresentation = null;
            if (presentTargetSelection && nativeInteraction &&
                typeof nativeInteraction.selectTarget === 'function') {
                targetPresentation = await nativeInteraction.selectTarget({
                    item: transaction,
                    speed: playbackSpeed,
                    ...(signal ? {signal} : {})
                });
                publish({
                    nativeInteraction: {
                        status: targetPresentation.status,
                        plan: {
                            kind: 'target-selection',
                            transactionId: transaction.id,
                            targetRef: transaction.targetRef ||
                                (transaction.events && transaction.events[0] && transaction.events[0].targetRef) || null
                        },
                        evidence: targetPresentation
                    }
                });
            }
            if (presentTargetSelection && targetPresentation && targetPresentation.status === 'unsupported') {
                throw new Error(`Cannot visibly select the Studio target: ${targetPresentation.reason}`);
            } else if (!targetPresentation) {
                await target.select(transaction);
                if (presentTargetSelection) await pauseAfterTargetSelection({speed: playbackSpeed, signal});
            } else if (targetPresentation.status !== 'verified') {
                const error = new Error('Visible Studio target selection did not settle');
                error.nativeInteraction = targetPresentation;
                throw error;
            }
        }
        // Sprite selection can restore a different workspace camera. Compose
        // from that view, not from the sprite we just left.
        viewport.beginTransaction(transaction, direction, {presentationMode, speed: playbackSpeed});
        if (!deferViewportFocus) await viewport.focusTransaction();
        return {restoredAuthoredState: restoreAuthoredState, selectedTarget: selectTarget};
    };

    const captureProjectState = async () => {
        // Scratch VM can transiently retain an obscured shadow as a top-level
        // script even though its owning input still references it. Canonicalize
        // that graph before *every* boundary capture so the recorded head and
        // replayed head are measured against the same ownership invariant.
        // Doing this here also covers ordinary recording, where no replay
        // transaction executor runs before Rewind seals the endpoint.
        reconcileVmBlockGraph(vm);
        const captured = typeof projectStatePort.capture === 'function' ?
            await projectStatePort.capture({hashKind: projectHashKind}) :
            {hash: await projectStatePort.hash(), project: null};
        const primary = projectHashKind.startsWith('structural-') && captured.structural ?
            captured.structural : {hash: captured.hash, project: captured.project};
        if (projectHashKind !== 'structural-v4' || typeof projectStatePort.capture !== 'function') {
            return primary;
        }
        const compatibilityCapture = await projectStatePort.capture({hashKind: 'structural-v5'});
        return {
            ...primary,
            compatibility: compatibilityCapture.structural || compatibilityCapture
        };
    };

    const projectValidation = (expectedHash, expectedProject, captured, expectedCompatibility = null) => {
        const matches = expectedHash === null || captured.hash === expectedHash;
        if (!matches && expectedCompatibility && captured.compatibility) {
            const compatibilityMatches = expectedCompatibility.hash === captured.compatibility.hash;
            return {
                matches: compatibilityMatches,
                expectedHash: expectedCompatibility.hash,
                actualHash: captured.compatibility.hash,
                difference: !compatibilityMatches && expectedCompatibility.project &&
                    captured.compatibility.project && typeof projectStatePort.difference === 'function' ?
                    projectStatePort.difference(expectedCompatibility.project, captured.compatibility.project) : null,
                compatibilityHashKind: 'structural-v5',
                ...(debugProjectValidation ? {
                    expectedProject: expectedCompatibility.project,
                    actualProject: captured.compatibility.project
                } : {})
            };
        }
        const difference = !matches && expectedProject && captured.project &&
            typeof projectStatePort.difference === 'function' ?
            projectStatePort.difference(expectedProject, captured.project) : null;
        return {
            matches,
            expectedHash,
            actualHash: captured.hash,
            difference,
            ...(debugProjectValidation ? {
                expectedProject,
                actualProject: captured.project
            } : {})
        };
    };

    const failPlayback = error => {
        historyPointer.finishActive();
        historyPointer.dismiss();
        if (error.studioRestored) {
            const journal = recorder.getJournal();
            if (history.cursor === journal.transactions.length) {
                // A checkpoint restore may regenerate otherwise equivalent
                // live IDs. Re-establish the retryable head hash from that
                // restored boundary instead of comparing it with the failed
                // pre-gesture serialization on the next Undo.
                setEndProjectHash(null);
                recorder.setEndProjectHash(null);
                canonicalHeadProject = null;
                canonicalHeadCompatibility = null;
            }
            // The safety checkpoint is captured immediately before the failed
            // transaction, so the restored project is still at the current
            // cursor. This matters when Play fails partway through a take.
            updatePlaybackPosition(history.cursor);
            recordingPaused = false;
            syncCapture();
            publish({
                status: `${error.message} — restored`,
                busy: false,
                validation: error.topology || error.validation || null,
                nativeInteraction: error.nativeInteraction || state.nativeInteraction,
                diagnostic: {
                    message: error.message,
                    stack: error.stack || null,
                    transaction: error.studioTransaction || null,
                    topology: error.topology || null,
                    validation: error.validation || null
                }
            });
            throw error;
        }
        setPlaybackPosition('unknown');
        publish({status: error.message, busy: false, validation: null});
        throw error;
    };

    const applyHistoryTransaction = createHistoryTransactionExecutor({
        workspace,
        vm,
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
        verifyTopology: options => verifyTopology({...options, ScratchBlocks}),
        settle: async () => {
            if (typeof workspace.whenBlockOperationsComplete === 'function') {
                await new Promise(resolve => workspace.whenBlockOperationsComplete(resolve));
            }
            await settleHistory(documentObject);
        },
        reconcileGraph: () => reconcileVmBlockGraph(vm),
        publish,
        presentationInterrupted: () => historyPresentationInterrupted
    }).apply;

    const validateCanonicalBase = async journal => {
        let captured;
        let repaired = false;
        const selectedTarget = vm.editingTarget && {
            targetId: vm.editingTarget.id,
            targetRef: targetReference(vm.editingTarget)
        };
        // Native Blockly gestures can leave rendered workspace state whose VM
        // hash is already equivalent to the base. Reaching cursor zero is a
        // hard boundary, so restore the canonical checkpoint even when that
        // hash comparison alone would have accepted the state.
        if (journal.baseCheckpointId === null) {
            captured = await captureProjectState();
        } else {
            await restoreCheckpoint(journal.baseCheckpointId);
            authoredStatePort.adoptCurrent();
            listDefinitionPort.reset();
            // Restore points regenerate every runtime target ID and select the
            // default sprite. Reaching the canonical base must repair project
            // state without discarding the durable editor context established
            // by the final inverse transaction.
            const restoredTargetId = selectedTarget && target.resolve(selectedTarget);
            if (restoredTargetId && !target.isSelected(selectedTarget)) {
                await target.select(selectedTarget);
            }
            captured = await captureProjectState();
            repaired = true;
        }
        return {
            ...projectValidation(
                journal.baseProjectHash,
                canonicalBaseProject,
                captured,
                canonicalBaseCompatibility
            ),
            repaired
        };
    };

    const replaceRecorder = ({baseCheckpointId, baseProjectHash}) => {
        store.clear();
        recorder = createJournalRecorder({
            store,
            id: `take-${now()}`,
            startedAtMs: now(),
            baseCheckpointId,
            baseProjectHash,
            projectHashKind
        });
    };

    const establishCurrentProjectAsBase = async status => {
        if (nativeInteraction && typeof nativeInteraction.resetSequenceBlockAliases === 'function') {
            nativeInteraction.resetSequenceBlockAliases();
        }
        projectHashKind = projectStatePort.preferredHashKind || 'full-project-v1';
        authoredStatePort.adoptCurrent({stopRuntime: true});
        listDefinitionPort.reset();
        const captured = await captureProjectState();
        const baseCheckpointId = await checkpointPort.create(`Tutorial Studio ${now()}`);
        replaceRecorder({baseCheckpointId, baseProjectHash: captured.hash});
        canonicalBaseProject = captured.project;
        canonicalBaseCompatibility = captured.compatibility || null;
        canonicalHeadProject = null;
        canonicalHeadCompatibility = null;
        // PROJECT_LOADED is emitted before every downstream GUI/Blockly
        // refresh has necessarily drained. Keep capture paused through that
        // refresh so the new base cannot immediately record its own render
        // events as authoring transactions.
        await settleEditorTasks(documentObject);
        if (capture) capture.clear();
        history.cursor = 0;
        setPlaybackPosition('head');
        setEndProjectHash(null);
        recordingPaused = false;
        syncCapture();
        publish({
            status,
            busy: false,
            projectReplaced: false,
            validation: null,
            nativeInteraction: null,
            ...journalCounts(null)
        });
    };

    resetAfterProjectLoaded = async previousStatus => {
        try {
            const journal = recorder.getJournal();
            const captured = await captureProjectState();
            const atKnownBase = history.cursor === 0 && journal.baseProjectHash &&
                captured.hash === journal.baseProjectHash;
            const atKnownHead = history.cursor === journal.transactions.length && playback.endProjectHash &&
                captured.hash === playback.endProjectHash;
            const lateHeadOverBase = history.cursor === 0 && playback.endProjectHash &&
                captured.hash === playback.endProjectHash && journal.baseCheckpointId !== null;
            if (lateHeadOverBase) {
                // Reload can finish restoring the Studio base before the GUI's
                // own pending project load reapplies the recorded head. Both
                // hashes are known, so repair the authoritative cursor-zero
                // boundary instead of treating the late head as File -> New.
                await restoreCheckpoint(journal.baseCheckpointId);
                authoredStatePort.adoptCurrent();
                listDefinitionPort.reset();
                const restored = await captureProjectState();
                if (restored.hash !== journal.baseProjectHash) {
                    throw new Error('Late project load repair did not restore the Studio base');
                }
                await settleEditorTasks(documentObject);
                if (capture) capture.clear();
                recordingPaused = false;
                syncCapture();
                publish({status: previousStatus, busy: false});
                return;
            }
            if (atKnownBase || atKnownHead) {
                // A delayed PROJECT_LOADED from an internal checkpoint restore
                // can arrive after its promise and renderer have settled. The
                // project hash is the authority: a known playback boundary is
                // not File -> New and must not replace the persisted take.
                await settleEditorTasks(documentObject);
                if (capture) capture.clear();
                recordingPaused = false;
                syncCapture();
                publish({status: previousStatus, busy: false});
                return;
            }
            publish({
                status: 'starting fresh project history',
                busy: true,
                projectReplaced: false,
                validation: null
            });
            await establishCurrentProjectAsBase('recording new project');
        } catch (error) {
            setPlaybackPosition('unknown');
            publish({
                status: `Could not start new project history: ${error.message}`,
                busy: false,
                projectReplaced: true,
                validation: null
            });
        } finally {
            projectResetPromise = null;
        }
    };

    const captureProjectOperation = async (operation, invoke, complete) => {
        if (operation.type === 'block-share' && typeof workspace.whenBlockOperationsComplete === 'function') {
            // The GUI receives BLOCK_DRAG_END before Scratch restores the source.
            // Wait for that rollback before recording either project boundary.
            publish({status: 'capturing project operation', busy: true, validation: null});
            await new Promise(resolve => workspace.whenBlockOperationsComplete(resolve));
        }
        flushCapture();
        const cursorAtStart = history.cursor;
        let journal = recorder.getJournal();
        publish({status: 'capturing project operation', busy: true, validation: null});
        recordingPaused = true;
        syncCapture();
        let beforeCheckpointId = null;
        let afterCheckpointId = null;
        const captureBoundary = async title => {
            // Both captures must begin in the same synchronous turn. Structural
            // hashing and IndexedDB persistence are asynchronous; awaiting one
            // before starting the other allows a drag's transient move frame
            // to leak into only half of the boundary.
            const checkpointPromise = checkpointPort.create(title);
            const projectPromise = captureProjectState();
            const checkpointId = await checkpointPromise;
            const captured = await projectPromise;
            return {checkpointId, captured};
        };
        try {
            sealHeadData({stopRuntime: true});
            authoredStatePort.adoptCurrent({stopRuntime: true});
            const beforeEditingTarget = vm.editingTarget;
            const beforeEditingTargetId = beforeEditingTarget && beforeEditingTarget.id;
            const beforeEditingTargetRef = beforeEditingTarget && targetReference(beforeEditingTarget);
            const beforeBoundary = await captureBoundary('Tutorial Studio before project operation');
            beforeCheckpointId = beforeBoundary.checkpointId;
            const before = beforeBoundary.captured;
            const result = await invoke();
            const metadata = await complete(result);
            authoredStatePort.adoptCurrent();
            listDefinitionPort.reset();
            const afterEditingTarget = vm.editingTarget;
            const afterEditingTargetId = afterEditingTarget && afterEditingTarget.id;
            const afterEditingTargetRef = afterEditingTarget && targetReference(afterEditingTarget);
            const afterBoundary = await captureBoundary('Tutorial Studio after project operation');
            afterCheckpointId = afterBoundary.checkpointId;
            const after = afterBoundary.captured;
            if (before.hash === after.hash) {
                if (typeof checkpointPort.remove === 'function') {
                    await checkpointPort.remove(beforeCheckpointId);
                    await checkpointPort.remove(afterCheckpointId);
                }
                beforeCheckpointId = null;
                afterCheckpointId = null;
                if (capture) capture.clear();
                recordingPaused = false;
                syncCapture();
                publish({status: 'recording', busy: false, ...journalCounts(recorder.getJournal())});
                return result;
            }
            if (cursorAtStart < journal.transactions.length) {
                truncateRecorder(cursorAtStart, `project-operation:${operation.type}`);
            }
            recorder.recordProjectOperation({
                ...operation,
                ...metadata,
                recordedAtMs: now(),
                beforeCheckpointId,
                afterCheckpointId,
                beforeProjectHash: before.hash,
                afterProjectHash: after.hash,
                beforeEditingTargetId,
                beforeEditingTargetRef,
                afterEditingTargetId,
                afterEditingTargetRef
            });
            journal = recorder.getJournal();
            // Async capture is serialized by the busy state; this is the same cursor checked at entry.
            // eslint-disable-next-line require-atomic-updates
            history.cursor = journal.transactions.length;
            setPlaybackPosition('head');
            setEndProjectHash(null);
            canonicalHeadProject = null;
            canonicalHeadCompatibility = null;
            if (capture) capture.clear();
            recordingPaused = false;
            syncCapture();
            publish({status: 'recording', busy: false, ...journalCounts(journal)});
            return result;
        } catch (error) {
            if (beforeCheckpointId !== null) {
                try {
                    await restoreCheckpoint(beforeCheckpointId);
                    authoredStatePort.adoptCurrent();
                    listDefinitionPort.reset();
                    error.studioRestored = true;
                } catch (restoreError) {
                    error.studioRestoreError = restoreError;
                }
            }
            for (const checkpointId of [beforeCheckpointId, afterCheckpointId]) {
                if (checkpointId !== null && typeof checkpointPort.remove === 'function') {
                    try {
                        await checkpointPort.remove(checkpointId);
                    } catch (removeError) { // eslint-disable-line no-empty
                        // A stale failed-operation checkpoint is harmless.
                    }
                }
            }
            // The failed operation was serialized from this cursor and has been rolled back exactly.
            // eslint-disable-next-line require-atomic-updates
            history.cursor = cursorAtStart;
            return failPlayback(error);
        }
    };

    const projectEditSessionController = createStudioProjectEditSessionController({
        beforeCapture: waitForProjectEditCapture,
        captureOperation: captureProjectOperation,
        completeOperation: operation => {
            const editedTarget = vm.runtime.getTargetById(operation.targetId);
            const costumes = editedTarget && editedTarget.getCostumes && editedTarget.getCostumes();
            return {
                editedCostumes: Array.isArray(costumes) ?
                    costumes.map(costume => costumeReference(costume)) : []
            };
        }
    });
    projectEditSessionPort = attachStudioProjectEditSessionController(vm, projectEditSessionController);

    const applyHistoryStep = async (
        direction,
        {
            lifecyclePresentation = true,
            interactionPresentation = 'history',
            playbackSpeed = 1,
            viewportPresentation = null,
            stopAfterTargetSelection = false
        } = {}
    ) => {
        const backward = direction === 'backward';
        const journal = recorder.getJournal();
        const canTraverse = backward ? history.cursor > 0 : history.cursor < journal.transactions.length;
        if (!canTraverse) return {applied: false, validation: null, nativeInteraction: null};
        const transactionIndex = backward ? history.cursor - 1 : history.cursor;
        const transaction = journal.transactions[transactionIndex];
        const selection = historyTargetBeforeApply(transaction, direction);
        if (stopAfterTargetSelection && target.resolve(selection) && !target.isSelected(selection)) {
            // Navigation consumes a command, not an edit. In particular, do
            // not prepare runtime state, frame a block or load a checkpoint
            // until the next command confirms the now-visible transaction.
            await selectHistoryTarget(selection, playbackSpeed);
            return {applied: false, prepared: true, target: target.current(), validation: null};
        }
        const resolvedViewportPresentation = viewportPresentation || historyViewportPresentation(transaction);
        const historyTargetSelection = lifecyclePresentation && historyPointer.isEnabled() ?
            item => selectHistoryTarget(item, playbackSpeed) : null;
        await prepareHistoryOperation(transaction, direction, resolvedViewportPresentation, {
            playbackSpeed, historyTargetSelection
        });
        if (backward && transactionIndex === journal.transactions.length - 1) {
            const captured = await captureProjectState();
            const currentHash = captured.hash;
            const compatibilityMatches = canonicalHeadCompatibility && captured.compatibility &&
                canonicalHeadCompatibility.hash === captured.compatibility.hash;
            if (playback.endProjectHash && playback.endProjectHash !== currentHash && !compatibilityMatches) {
                throw new Error('Current project does not match the recorded Studio head');
            }
            canonicalHeadProject = captured.project;
            canonicalHeadCompatibility = captured.compatibility || canonicalHeadCompatibility;
            if (!playback.endProjectHash) {
                setEndProjectHash(currentHash);
                recorder.setEndProjectState({
                    hash: currentHash,
                    project: captured.project,
                    compatibility: captured.compatibility || null
                });
            }
        }
        const nativeResult = await applyHistoryTransaction(transaction, direction, {
            // Ordinary Undo/Redo must never rely on an emulated drag to create
            // the authoritative editor state. Semantic replay is exact and
            // the lifecycle layer is a read-only presentation. Real native
            // interaction remains exclusive to full tutorial Play.
            nativeAllowed: false,
            lifecyclePresentation,
            interactionPresentation,
            playbackSpeed,
            ...(historyTargetSelection ? {presentTargetSelection: historyTargetSelection} : {}),
            ...(lifecyclePresentation && historyPointer.isEnabled() ? {
                presentProjectRestore: options => historyPointer.presentProjectRestore(options)
            } : {}),
            // Preparation has composed the shot. Do not reframe after mutating
            // the graph underneath an already captured presentation workspace.
            viewportPresentation: VIEWPORT_PRESENTATION_MODES.PRESERVE
        });
        const expectedCursor = backward ? transactionIndex + 1 : transactionIndex;
        if (history.cursor !== expectedCursor) {
            throw new Error(`Studio history changed while ${backward ? 'undoing' : 'redoing'}`);
        }
        history.cursor = backward ? transactionIndex : transactionIndex + 1;
        updatePlaybackPosition(journal.transactions.length);
        let validation = null;
        if (backward && history.cursor === 0) {
            validation = await validateCanonicalBase(journal);
            if (!validation.matches) setPlaybackPosition('unknown');
        } else if (!backward && history.cursor === journal.transactions.length && playback.endProjectHash) {
            const captured = await captureProjectState();
            validation = projectValidation(
                playback.endProjectHash,
                canonicalHeadProject,
                captured,
                canonicalHeadCompatibility
            );
            if (validation.matches) {
                canonicalHeadProject = captured.project;
                canonicalHeadCompatibility = captured.compatibility || canonicalHeadCompatibility;
            } else setPlaybackPosition('unknown');
        }
        return {applied: true, validation, nativeInteraction: nativeResult};
    };

    const traverseHistory = async (direction, {lifecyclePresentation = true, playbackSpeed = 1} = {}) => {
        await initializationPromise;
        await assertBuildCurrent();
        if (state.projectReplaced) return null;
        flushCapture();
        const backward = direction === 'backward';
        const journal = recorder.getJournal();
        if (backward ? history.cursor === 0 : history.cursor === journal.transactions.length) return null;
        historyPresentationInterrupted = false;
        historyPointer.begin({animate: lifecyclePresentation});
        if (nativeInteraction && typeof nativeInteraction.endSequence === 'function') {
            nativeInteraction.endSequence();
        }
        if (nativeInteraction && typeof nativeInteraction.dismissPointer === 'function') {
            nativeInteraction.dismissPointer();
        }

        try {
            if (backward) sealHeadData({stopRuntime: true});
            publish({status: backward ? 'undoing' : 'redoing', busy: true, validation: null});
            recordingPaused = true;
            syncCapture();
            const result = await applyHistoryStep(direction, {
                lifecyclePresentation, playbackSpeed, stopAfterTargetSelection: true
            });
            recordingPaused = false;
            syncCapture();
            publish({
                status: result.prepared ? `selected ${result.target.targetRef.name || 'sprite'} — press ${
                    backward ? 'Undo' : 'Redo'} again` : playback.position === 'unknown' ?
                    'state mismatch' : (backward ? 'undone' : 'redone'),
                busy: false,
                validation: result.validation,
                nativeInteraction: result.nativeInteraction
            });
            return result.prepared ? result : result.validation;
        } catch (error) {
            return failPlayback(error);
        }
    };

    const session = {
        tagEventGroup: (group, source) => capture && capture.tagEventGroup(group, source),
        subscribe: subscriber => {
            subscribers.add(subscriber);
            subscriber({...state});
            return () => subscribers.delete(subscriber);
        },
        getState: () => ({...state}),
        setHistoryPointerEnabled: enabled => {
            const value = Boolean(enabled);
            historyPointer.setEnabled(value);
            saveHistoryPointerPreference(storage, value);
            publish({historyPointerEnabled: value});
        },
        getJournal: () => recorder && recorder.getJournal(),
        setTargetSelectionPause: async pauseMs => {
            await session.ready;
            await assertBuildCurrent();
            if (state.projectReplaced) throw new Error('Studio project history is unavailable');
            if (state.busy) throw new Error('A Studio playback operation is already running');
            recorder.setTargetSelectionPause(pauseMs);
            publish({status: 'timing updated'});
        },
        getTimeline: () => {
            const journal = recorder && recorder.getJournal();
            return journal ? journal.transactions.map((transaction, index) => ({
                ...describeTransaction(transaction, index),
                pauseAfterMs: transaction.presentation &&
                    Number.isFinite(transaction.presentation.pauseAfterMs) ?
                    transaction.presentation.pauseAfterMs : null
            })) : [];
        },
        setTransactionPause: async (position, pauseAfterMs) => {
            await session.ready;
            await assertBuildCurrent();
            if (state.projectReplaced) throw new Error('Studio project history is unavailable');
            if (state.busy) throw new Error('A Studio playback operation is already running');
            flushCapture();
            const journal = recorder.getJournal();
            if (!Number.isInteger(position) || position < 1 || position > journal.transactions.length) {
                throw new RangeError(`Timeline transaction must be between 1 and ${journal.transactions.length}`);
            }
            recorder.setTransactionPause(position - 1, pauseAfterMs);
            publish({status: 'timing updated', busy: false, ...journalCounts(recorder.getJournal())});
            return session.getTimeline()[position - 1];
        },
        canUndo: () => state.canUndo,
        canRedo: () => state.canRedo,
        requestHistory: (direction, options) => historyCommandQueue.request(direction, options),
        canRequestHistory: direction => historyCommandQueue.canRequest(direction),
        hasPendingHistoryBoundary: () => projectEditSessionController.hasOpen(),
        prepareHistoryCommand: async () => {
            // Escape cancels presentation, but its rollback/cleanup still owns
            // the editor. Keep a following history request until that boundary
            // is idle; never race it or silently drop the user's next press.
            if (playbackStopRequested) await waitForProjectEditCapture();
            await projectEditSessionController.closeActive();
        },
        nativeHistoryOwns: direction => {
            const root = documentObject && documentObject.querySelector &&
                documentObject.querySelector('[data-studio-target="costume-editor"]');
            if (!root) return false;
            return root.getAttribute(`data-studio-paint-can-${direction}`) === 'true';
        },
        finishHistoryPresentation: () => {
            historyPresentationInterrupted = true;
            historyPointer.finishActive();
            if (typeof lifecycleAnimation.finishActive === 'function') lifecycleAnimation.finishActive();
            if (nativeInteraction && typeof nativeInteraction.finishActive === 'function') {
                nativeInteraction.finishActive();
            }
        },
        stopPlayback: () => {
            if (!activePlayController) return false;
            playbackStopRequested = true;
            activePlayController.abort();
            historyPointer.finishActive();
            if (typeof viewport.cancel === 'function') viewport.cancel();
            else viewport.stop();
            if (nativeInteraction && typeof nativeInteraction.cancelActive === 'function') {
                nativeInteraction.cancelActive();
            }
            return true;
        },
        seedCameraFixture: cameraFixtureEnabled ? async () => {
            await session.ready;
            await assertBuildCurrent();
            if (state.busy) throw new Error('A Studio playback operation is already running');
            if (state.projectReplaced) throw new Error('Studio project history is unavailable');
            flushCapture();
            if (recorder.getJournal().transactions.length || workspace.getAllBlocks(false).length) {
                throw new Error('The long camera fixture requires a fresh empty take');
            }
            publish({status: 'seeding camera fixture', busy: true, validation: null});
            try {
                const result = await seedLongCameraFixture({workspace, ScratchBlocks, wait});
                flushCapture();
                const journal = recorder.getJournal();
                history.cursor = journal.transactions.length;
                setPlaybackPosition('head');
                setEndProjectHash(null);
                canonicalHeadProject = null;
                canonicalHeadCompatibility = null;
                publish({status: 'recording', busy: false, ...journalCounts(journal)});
                return result;
            } catch (error) {
                publish({status: error.message, busy: false, validation: null});
                throw error;
            }
        } : null,
        seedConnectionMatrixFixture: connectionMatrixFixtureEnabled ? async () => {
            await session.ready;
            await assertBuildCurrent();
            if (state.busy) throw new Error('A Studio playback operation is already running');
            if (state.projectReplaced) throw new Error('Studio project history is unavailable');
            flushCapture();
            if (recorder.getJournal().transactions.length || workspace.getAllBlocks(false).length) {
                throw new Error('The connection matrix requires a fresh empty take');
            }
            publish({status: 'seeding connection matrix', busy: true, validation: null});
            try {
                const result = await seedConnectionMatrixFixture({workspace, ScratchBlocks, wait});
                flushCapture();
                const journal = recorder.getJournal();
                history.cursor = journal.transactions.length;
                setPlaybackPosition('head');
                setEndProjectHash(null);
                canonicalHeadProject = null;
                canonicalHeadCompatibility = null;
                publish({status: 'recording', busy: false, ...journalCounts(journal)});
                return result;
            } catch (error) {
                publish({status: error.message, busy: false, validation: null});
                throw error;
            }
        } : null,
        startNewTake: async () => {
            await session.ready;
            await assertBuildCurrent();
            if (state.busy) throw new Error('A Studio playback operation is already running');
            flushCapture();

            publish({status: 'setting base', busy: true, validation: null});
            recordingPaused = true;
            syncCapture();
            try {
                await establishCurrentProjectAsBase('recording');
            } catch (error) {
                return failPlayback(error);
            }
        },
        rewind: async () => {
            await session.ready;
            await assertBuildCurrent();
            if (state.projectReplaced) throw new Error('Studio project history is unavailable');
            if (state.busy) throw new Error('A Studio playback operation is already running');
            flushCapture();
            if (playback.position === 'base') return state.validation;

            historyPointer.dismiss();
            if (nativeInteraction && typeof nativeInteraction.dismissPointer === 'function') {
                nativeInteraction.dismissPointer();
            }

            publish({status: 'rewinding', busy: true, validation: null});
            recordingPaused = true;
            syncCapture();
            try {
                sealHeadData({stopRuntime: true});
                await authoredStatePort.prepare();
                const journal = recorder.getJournal();
                const transactionCountToRewind = history.cursor;
                if (transactionCountToRewind === journal.transactions.length) {
                    const captured = await captureProjectState();
                    setEndProjectHash(captured.hash);
                    recorder.setEndProjectState({
                        hash: captured.hash,
                        project: captured.project,
                        compatibility: captured.compatibility || null
                    });
                    canonicalHeadProject = captured.project;
                    canonicalHeadCompatibility = captured.compatibility || null;
                }
                let nativeResult = null;
                for (let index = transactionCountToRewind - 1; index >= 0; index--) {
                    if (history.cursor !== index + 1) {
                        throw new Error('Studio history changed while rewinding');
                    }
                    const transaction = journal.transactions[index];
                    await prepareHistoryOperation(
                        transaction,
                        'backward',
                        VIEWPORT_PRESENTATION_MODES.PRESERVE
                    );
                    nativeResult = await applyHistoryTransaction(transaction, 'backward', {
                        nativeAllowed: false,
                        viewportPresentation: VIEWPORT_PRESENTATION_MODES.PRESERVE
                    });
                    // Rewind owns the busy session for the duration of this loop.
                    // eslint-disable-next-line require-atomic-updates
                    history.cursor = index;
                    updatePlaybackPosition(journal.transactions.length);
                }
                const validation = await validateCanonicalBase(journal);
                const matches = validation.matches;
                setPlaybackPosition(matches ? 'base' : 'unknown');
                recordingPaused = false;
                syncCapture();
                publish({
                    status: matches ? 'rewound' : 'state mismatch',
                    busy: false,
                    validation,
                    nativeInteraction: nativeResult
                });
                return validation;
            } catch (error) {
                return failPlayback(error);
            }
        },
        seek: async targetIndex => {
            await session.ready;
            await assertBuildCurrent();
            if (state.projectReplaced) throw new Error('Studio project history is unavailable');
            if (state.busy) throw new Error('A Studio playback operation is already running');
            if (playback.position === 'unknown') throw new Error('Cannot seek from an invalid project state');
            flushCapture();
            const journal = recorder.getJournal();
            if (!Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex > journal.transactions.length) {
                throw new RangeError(`Timeline position must be between 0 and ${journal.transactions.length}`);
            }
            if (targetIndex === history.cursor) {
                return {
                    cursor: history.cursor,
                    transactionCount: journal.transactions.length,
                    validation: state.validation
                };
            }

            const direction = targetIndex < history.cursor ? 'backward' : 'forward';
            if (direction === 'backward') sealHeadData({stopRuntime: true});
            historyPresentationInterrupted = true;
            historyPointer.finishActive();
            historyPointer.dismiss();
            if (typeof lifecycleAnimation.finishActive === 'function') lifecycleAnimation.finishActive();
            if (nativeInteraction && typeof nativeInteraction.endSequence === 'function') {
                nativeInteraction.endSequence();
            }
            if (nativeInteraction && typeof nativeInteraction.dismissPointer === 'function') {
                nativeInteraction.dismissPointer();
            }
            publish({status: 'seeking', busy: true, validation: null});
            recordingPaused = true;
            syncCapture();
            try {
                let result = {validation: null, nativeInteraction: null};
                while (history.cursor !== targetIndex) {
                    result = await applyHistoryStep(direction, {
                        lifecyclePresentation: false,
                        viewportPresentation: VIEWPORT_PRESENTATION_MODES.PRESERVE
                    });
                    if (!result.applied) throw new Error('Timeline boundary changed while seeking');
                    publish({status: 'seeking', busy: true, nativeInteraction: result.nativeInteraction});
                }
                recordingPaused = false;
                syncCapture();
                publish({
                    status: playback.position === 'unknown' ? 'state mismatch' : 'positioned',
                    busy: false,
                    validation: result.validation,
                    nativeInteraction: result.nativeInteraction
                });
                return {
                    cursor: history.cursor,
                    transactionCount: journal.transactions.length,
                    validation: result.validation
                };
            } catch (error) {
                return failPlayback(error);
            } finally {
                historyPresentationInterrupted = false;
            }
        },
        playHistory: async ({direction = 'forward', targetIndex = null, speed = 1, stepDelayMs = 220} = {}) => {
            await session.ready;
            await assertBuildCurrent();
            if (state.projectReplaced) throw new Error('Studio project history is unavailable');
            if (state.busy) throw new Error('A Studio playback operation is already running');
            if (playback.position === 'unknown') {
                throw new Error('Cannot play timeline from an invalid project state');
            }
            if (direction !== 'forward' && direction !== 'backward') {
                throw new Error('Timeline playback direction must be forward or backward');
            }
            if (!Number.isFinite(speed) || speed <= 0) throw new Error('Playback speed must be positive');
            flushCapture();
            const journal = recorder.getJournal();
            const boundary = direction === 'forward' ? journal.transactions.length : 0;
            const destination = targetIndex === null ? boundary : targetIndex;
            if (!Number.isInteger(destination) || destination < 0 || destination > journal.transactions.length) {
                throw new RangeError(`Timeline position must be between 0 and ${journal.transactions.length}`);
            }
            if ((direction === 'forward' && destination < history.cursor) ||
                (direction === 'backward' && destination > history.cursor)) {
                throw new Error(`Timeline target is not ${direction} of the current position`);
            }
            if (destination === history.cursor) {
                return {
                    cursor: history.cursor,
                    transactionCount: journal.transactions.length
                };
            }
            if (direction === 'backward') sealHeadData({stopRuntime: true});

            historyPresentationInterrupted = false;
            historyPointer.begin();
            if (nativeInteraction && typeof nativeInteraction.dismissPointer === 'function') {
                nativeInteraction.dismissPointer();
            }
            const controller = new AbortController();
            activePlayController = controller;
            playbackStopRequested = false;
            const stopped = () => playbackStopRequested || controller.signal.aborted;
            publish({status: `playing ${direction}`, busy: true, validation: null});
            recordingPaused = true;
            syncCapture();
            if (nativeInteraction && typeof nativeInteraction.beginSequence === 'function') {
                nativeInteraction.beginSequence({resume: true});
            }
            try {
                let result = {validation: null, nativeInteraction: null};
                while (history.cursor !== destination) {
                    if (stopped()) break;
                    const appliedTransaction = direction === 'forward' ?
                        journal.transactions[history.cursor] : journal.transactions[history.cursor - 1];
                    const previousTarget = target.current();
                    result = await applyHistoryStep(direction, {
                        lifecyclePresentation: true,
                        interactionPresentation: 'history',
                        playbackSpeed: speed,
                        stopAfterTargetSelection: true
                    });
                    if (result.prepared) {
                        publish({status: `selected ${result.target.targetRef.name || 'sprite'}`, busy: true});
                        if (!stopped()) await pauseAfterTargetSelection({speed, signal: controller.signal});
                        continue;
                    }
                    if (!result.applied) throw new Error('Timeline boundary changed while playing');
                    publish({
                        status: `playing ${direction}`,
                        busy: true,
                        validation: result.validation,
                        nativeInteraction: result.nativeInteraction
                    });
                    if (!stopped() && history.cursor !== destination) {
                        let delay = stepDelayMs > 0 ? transactionPauseDelay(appliedTransaction, stepDelayMs, speed) : 0;
                        if (previousTarget && !target.isSelected(previousTarget)) {
                            delay = Math.max(delay, targetSelectionPause(journal) / speed);
                        }
                        if (delay > 0) await wait(delay, controller.signal);
                    }
                }
                recordingPaused = false;
                syncCapture();
                publish({
                    status: stopped() ? 'stopped' : 'positioned',
                    busy: false,
                    validation: result.validation,
                    nativeInteraction: result.nativeInteraction
                });
                return {
                    cancelled: stopped(),
                    cursor: history.cursor,
                    transactionCount: journal.transactions.length,
                    validation: result.validation
                };
            } catch (error) {
                return failPlayback(error);
            } finally {
                if (nativeInteraction && typeof nativeInteraction.endSequence === 'function') {
                    nativeInteraction.endSequence({preserveAliases: stopped()});
                }
                if (activePlayController === controller) activePlayController = null;
                playbackStopRequested = false;
            }
        },
        play: async ({stepDelayMs = null, speed = 1} = {}) => {
            await session.ready;
            await assertBuildCurrent();
            if (state.projectReplaced) throw new Error('Studio project history is unavailable');
            if (state.busy) throw new Error('A Studio playback operation is already running');
            if (!Number.isFinite(speed) || speed <= 0) throw new Error('Playback speed must be positive');
            flushCapture();
            if (playback.position === 'unknown') {
                throw new Error('Cannot play from an invalid project state');
            }
            if (playback.position === 'head') {
                const rewindValidation = await session.rewind();
                if (playback.position !== 'base' || history.cursor !== 0 ||
                    !rewindValidation || !rewindValidation.matches) {
                    setPlaybackPosition('unknown');
                    return failPlayback(new Error('Cannot play: rewind did not reach the recorded base'));
                }
            }
            if (playback.position === 'unknown') {
                throw new Error('Cannot play from an invalid project state');
            }

            if (authoredStatePort.isDirty()) await authoredStatePort.prepare();

            // A rapid history command may leave the previous presentation
            // marked as interrupted after its queue has drained. Full Play is
            // a new presentation sequence and must be allowed to use the
            // native interaction driver (and its shared pointer) again.
            historyPresentationInterrupted = false;
            historyPointer.dismiss();
            const playController = new AbortController();
            activePlayController = playController;
            playbackStopRequested = false;
            const playbackStopped = () => playbackStopRequested || playController.signal.aborted;
            const throwIfPlaybackStopped = () => {
                if (!playbackStopped()) return;
                const error = new Error('Studio playback stopped');
                error.studioPlaybackStopped = true;
                throw error;
            };
            publish({status: 'playing', busy: true, validation: null});
            recordingPaused = true;
            syncCapture();
            const journal = recorder.getJournal();
            const transactionIndex = history.cursor;
            if (nativeInteraction && typeof nativeInteraction.beginSequence === 'function') {
                nativeInteraction.beginSequence({resume: transactionIndex > 0});
            }
            try {
                let nativeResult = null;
                for (let index = transactionIndex; index < journal.transactions.length; index++) {
                    throwIfPlaybackStopped();
                    if (history.cursor !== index) {
                        throw new Error('Studio history changed while playing');
                    }
                    const transaction = journal.transactions[index];
                    const previousTarget = target.current();
                    pausedPlaybackTarget = null;
                    const interactionPlan = nativeInteraction && typeof nativeInteraction.plan === 'function' ?
                        nativeInteraction.plan({
                            transaction,
                            direction: 'forward',
                            presentationMode: 'realistic'
                        }) : null;
                    // Native block drags frame their predicted destination just
                    // before pointer travel. Do not first visit the recorded
                    // authoring viewport and then immediately pan away again.
                    const nativeOwnsViewport = Boolean(interactionPlan && interactionPlan.destination);
                    await prepareHistoryOperation(
                        transaction,
                        'forward',
                        VIEWPORT_PRESENTATION_MODES.RECORDED,
                        {
                            deferViewportFocus: nativeOwnsViewport,
                            presentTargetSelection: true,
                            playbackSpeed: speed,
                            signal: playController.signal
                        }
                    );
                    throwIfPlaybackStopped();
                    nativeResult = await applyHistoryTransaction(transaction, 'forward', {
                        viewportPresentation: VIEWPORT_PRESENTATION_MODES.RECORDED,
                        playbackSpeed: speed,
                        signal: playController.signal
                    });
                    if (transaction.kind !== 'project-operation' && nativeResult &&
                        nativeResult.status === 'verified') {
                        await viewport.focusTransaction({phase: 'after'});
                    }
                    if (history.cursor !== index) {
                        throw new Error('Studio history changed while playing');
                    }
                    history.cursor = index + 1;
                    updatePlaybackPosition(journal.transactions.length);
                    publish({status: 'playing', busy: true, nativeInteraction: nativeResult});
                    throwIfPlaybackStopped();
                    if (index < journal.transactions.length - 1) {
                        let delay = stepDelayMs === null ?
                            transactionPauseDelay(transaction, 300, speed) : stepDelayMs;
                        // Creating/deleting a sprite may itself select a new
                        // context. Hold at that boundary as well; ordinary
                        // selector clicks already paused before the edit.
                        if (previousTarget && !target.isSelected(previousTarget) &&
                            !(pausedPlaybackTarget && target.isSelected(pausedPlaybackTarget))) {
                            delay = Math.max(delay, targetSelectionPause(journal) / speed);
                        }
                        if (delay > 0) await wait(delay, playController.signal);
                        throwIfPlaybackStopped();
                    }
                }
                const captured = await captureProjectState();
                const validation = projectValidation(
                    playback.endProjectHash,
                    canonicalHeadProject,
                    captured,
                    canonicalHeadCompatibility
                );
                const matches = validation.matches;
                setPlaybackPosition(matches ? 'head' : 'unknown');
                if (matches) {
                    canonicalHeadProject = captured.project;
                    canonicalHeadCompatibility = captured.compatibility || canonicalHeadCompatibility;
                    setEndProjectHash(captured.hash);
                    recorder.setEndProjectState({
                        hash: captured.hash,
                        project: captured.project,
                        compatibility: captured.compatibility || null
                    });
                    recordingPaused = false;
                    syncCapture();
                }
                publish({
                    status: matches ? 'played' : 'state mismatch',
                    busy: false,
                    validation,
                    nativeInteraction: nativeResult
                });
                return validation;
            } catch (error) {
                if (playbackStopped() || error.studioPlaybackStopped) {
                    // The transaction executor may have restored a checkpoint
                    // after the synchronous Escape handler stopped the camera.
                    // Reapply the pre-transaction frame after that restore so
                    // resuming cannot start from Blockly's reset viewport.
                    if (typeof viewport.cancel === 'function') viewport.cancel();
                    updatePlaybackPosition(history.cursor);
                    recordingPaused = false;
                    syncCapture();
                    publish({
                        status: 'stopped',
                        busy: false,
                        validation: null,
                        nativeInteraction: error.nativeInteraction || state.nativeInteraction,
                        diagnostic: null
                    });
                    return {cancelled: true, cursor: history.cursor};
                }
                return failPlayback(error);
            } finally {
                if (nativeInteraction && typeof nativeInteraction.endSequence === 'function') {
                    nativeInteraction.endSequence({preserveAliases: playbackStopped()});
                }
                if (activePlayController === playController) activePlayController = null;
                playbackStopRequested = false;
            }
        },
        undo: options => traverseHistory('backward', options),
        redo: options => traverseHistory('forward', options)
    };

    historyCommandQueue = createHistoryCommandQueue({
        session,
        isAvailable: () => !detached && !state.projectReplaced && playback.position !== 'unknown' &&
            state.status !== 'initializing' &&
            (!state.buildFreshness || state.buildFreshness.status === 'current'),
        canWait: () => playbackStopRequested,
        onActiveChange: active => {
            if (!detached) publish({historyCommandActive: active});
        }
    });

    const initialize = async () => {
        await projectReady();
        await assertBuildCurrent();
        const existing = store.load();
        let baseProjectHash;
        let baseCheckpointId;
        if (existing && existing.baseCheckpointId !== null) {
            projectHashKind = existing.projectHashKind || 'full-project-v1';
            recordingPaused = true;
            await restoreCheckpoint(existing.baseCheckpointId);
            authoredStatePort.adoptCurrent();
            listDefinitionPort.reset();
            baseCheckpointId = existing.baseCheckpointId;
            const captured = await captureProjectState();
            baseProjectHash = captured.hash;
            canonicalBaseProject = captured.project;
            canonicalBaseCompatibility = captured.compatibility || null;
            if (existing.baseProjectHash && existing.baseProjectHash !== baseProjectHash) {
                throw new Error('Restored project does not match the Studio checkpoint hash');
            }
            setPlaybackPosition('base');
        } else {
            const captured = await captureProjectState();
            baseProjectHash = captured.hash;
            canonicalBaseProject = captured.project;
            canonicalBaseCompatibility = captured.compatibility || null;
            baseCheckpointId = await checkpointPort.create(`Tutorial Studio ${now()}`);
            authoredStatePort.adoptCurrent();
            listDefinitionPort.reset();
        }

        if (existing) {
            recorder = createJournalRecorder({
                store,
                id: `take-${now()}`,
                startedAtMs: now(),
                baseCheckpointId,
                baseProjectHash,
                projectHashKind
            });
        } else {
            replaceRecorder({baseCheckpointId, baseProjectHash});
        }
        const loadedJournal = recorder.getJournal();
        history.cursor = existing ? 0 : loadedJournal.transactions.length;
        setEndProjectHash(loadedJournal.endProjectHash || null);
        canonicalHeadProject = loadedJournal.endProject || null;
        canonicalHeadCompatibility = loadedJournal.endProjectCompatibility || null;
        if (detached) return;

        capture = attachStudioBlockCapture({
            workspace,
            vm,
            ScratchBlocks,
            enabled: true,
            exposeDebug: debugProjectValidation,
            defer,
            documentObject,
            captureVariableDefinition: listDefinitionPort.captureEvent,
            onSnapshot: snapshot => {
                if (snapshot.type === 'create' && nativeInteraction &&
                    typeof nativeInteraction.adoptSequenceBlockAliases === 'function') {
                    // New authoring can reuse IDs from an abandoned future.
                    // Its newly created live identities supersede old aliases.
                    const ids = snapshot.details.ids || [snapshot.blockId];
                    nativeInteraction.adoptSequenceBlockAliases(Object.fromEntries(ids.map(id => [id, id])));
                }
                let journal = recorder.getJournal();
                if (history.cursor < journal.transactions.length) {
                    truncateRecorder(history.cursor, 'block-event');
                }
                journal = recorder.getJournal();
                adoptRecordedListDefinition(snapshot);
                const startsTransaction = snapshotStartsTransaction(journal, snapshot);
                let leadingDataDelta = null;
                if (startsTransaction && authoredStatePort.isDirty()) {
                    const delta = authoredStatePort.sealDataChanges();
                    if (delta && history.cursor > 0) appendDataDelta(history.cursor - 1, 'after', delta);
                    else leadingDataDelta = delta;
                }
                recorder.record(snapshot, {viewport: viewport.capture()});
                if (leadingDataDelta) appendDataDelta(0, 'before', leadingDataDelta);
                history.cursor = recorder.getJournal().transactions.length;
                setPlaybackPosition('head');
                setEndProjectHash(null);
                canonicalHeadProject = null;
                canonicalHeadCompatibility = null;
                publish({
                    status: 'recording',
                    ...journalCounts(recorder.getJournal())
                });
            }
        });
        projectOperationCapture = createProjectOperationCapture({
            vm,
            dragSourceReference: blockId => capture && capture.getDragSourceReference?.(blockId),
            shouldCapture: () => !recordingPaused && !workspacePaused && !state.busy &&
                !state.projectReplaced,
            captureOperation: captureProjectOperation
        });
        detachDataValueListener = attachStudioDataValueListener(vm, beginDataValueEdit);
        detachTargetPropertyListener = attachStudioTargetPropertyListener(vm, beginTargetPropertyEdit);
        syncCapture();
        publish({
            status: playback.position === 'base' ? 'ready to play' : 'recording',
            busy: false,
            ...journalCounts(recorder.getJournal())
        });
        attachProjectLoadListener();
    };

    initializationPromise = initialize().catch(error => {
        publish({status: error.message, busy: false});
        throw error;
    });
    session.ready = initializationPromise;
    if (buildFreshness) {
        detachBuildFreshness = buildFreshness.watch(result => publish({buildFreshness: result}));
    }
    historyCommands = createHistoryCommands({documentObject, ScratchBlocks, session});
    if (typeof document !== 'undefined') panel = createPanel(session);

    return {
        enabled: true,
        pause: () => {
            workspacePaused = true;
            syncCapture();
        },
        resume: () => {
            workspacePaused = false;
            syncCapture();
        },
        clear: () => capture && capture.clear(),
        getSnapshots: () => (capture ? capture.getSnapshots() : []),
        getErrors: () => (capture ? capture.getErrors() : []),
        detach: () => {
            detached = true;
            historyCommandQueue.detach();
            rejectProjectEditIdleWaiters(new Error('Tutorial Studio session is detached'));
            if (pageView && typeof pageView.removeEventListener === 'function') {
                pageView.removeEventListener('beforeunload', pauseCaptureForPageExit, true);
                pageView.removeEventListener('pagehide', pauseCaptureForPageExit, true);
            }
            if (hadStationaryStackOption) {
                workspaceOptions[BLOCKLY_STATIONARY_STACK_OPTION] = previousStationaryStackOption;
            } else {
                delete workspaceOptions[BLOCKLY_STATIONARY_STACK_OPTION];
            }
            detachProjectLoadListener();
            projectEditSessionController.detach().catch(() => {});
            if (projectEditSessionPort) projectEditSessionPort.detach();
            if (projectOperationCapture) projectOperationCapture.detach();
            if (detachDataValueListener) detachDataValueListener();
            if (detachTargetPropertyListener) detachTargetPropertyListener();
            if (detachBuildFreshness) detachBuildFreshness();
            viewport.detach();
            authoredStatePort.detach();
            lifecycleAnimation.detach();
            historyPointer.detach();
            if (nativeInteraction && typeof nativeInteraction.detach === 'function') nativeInteraction.detach();
            if (capture) capture.detach();
            if (historyCommands) historyCommands.detach();
            if (panel) panel.detach();
            if (typeof window !== 'undefined' && window[SESSION_GLOBAL] === session) {
                delete window[SESSION_GLOBAL];
            }
        },
        session
    };
};

/**
 * Select the persisted Studio session only for its explicit query flag. The
 * original capture-only spike and normal TurboWarp paths remain unchanged.
 *
 * @param {object} options session dependencies
 * @returns {object} block-session lifecycle port
 */
const attachStudioBlockSession = options => {
    const enabled = typeof options.sessionEnabled === 'boolean' ?
        options.sessionEnabled : isSessionRequested();
    if (!enabled) return attachStudioBlockCapture(options);

    const storage = options.storage || window.localStorage;
    const sessionPort = createSession({
        ...options,
        storage,
        checkpointPort: options.checkpointPort || createRestorePointCheckpointPort(options),
        projectStatePort: options.projectStatePort || createProjectStatePort(options),
        authoredStatePort: options.authoredStatePort || createAuthoredStatePort(options),
        listDefinitionPort: options.listDefinitionPort || createListDefinitionPort(options),
        createPanel: options.createPanel || createStudioSessionPanel,
        createHistoryCommands: options.createHistoryCommands || attachStudioHistoryCommands,
        documentObject: options.documentObject || (typeof document === 'undefined' ? null : document),
        now: options.now || Date.now,
        wait: options.wait || sleep,
        defer: options.defer || deferWork,
        projectReady: options.projectReady || (() => waitForProjectReady(options.vm)),
        journalKey: options.journalKey || `${JOURNAL_KEY_PREFIX}${requestedTakeId()}`,
        preCreateMode: options.preCreateMode || 'wait',
        createViewport: options.createViewport || createScratchBlocksViewportPort,
        historyPointerEnabled: typeof options.historyPointerEnabled === 'boolean' ?
            options.historyPointerEnabled : readHistoryPointerPreference(
                storage, typeof window === 'undefined' ? '' : window.location.search
            ),
        playPointerEnabled: typeof options.playPointerEnabled === 'boolean' ?
            options.playPointerEnabled : requestedPlayPointerEnabled(),
        pointerModelName: options.pointerModelName || requestedPointerModelName(),
        nativeInteractionEnabled: typeof options.nativeInteractionEnabled === 'boolean' ?
            options.nativeInteractionEnabled : isSessionRequested(),
        createNativeInteraction: options.createNativeInteraction || createInteractionPlaybackPort,
        createLifecycleAnimation: options.createLifecycleAnimation || createBlockTransitionPresentationPort,
        createHistoryPointer: options.createHistoryPointer || createHistoryPointerPresentation,
        createProjectOperationCapture: options.createProjectOperationCapture || attachProjectOperationCapture,
        verifyTopology: options.verifyTopology || verifyTransactionTopology,
        buildFreshness: options.buildFreshness || (
            typeof window === 'undefined' || typeof document === 'undefined' ? null :
                createStudioBuildFreshness({windowObject: window, documentObject: document})
        ),
        cameraFixtureEnabled: typeof options.cameraFixtureEnabled === 'boolean' ?
            options.cameraFixtureEnabled : requestedCameraFixtureEnabled(),
        connectionMatrixFixtureEnabled: typeof options.connectionMatrixFixtureEnabled === 'boolean' ?
            options.connectionMatrixFixtureEnabled : requestedConnectionMatrixFixtureEnabled(),
        settleHistory: options.settleHistory || settleEditorTasks
    });
    if (typeof window !== 'undefined') window[SESSION_GLOBAL] = sessionPort.session;
    return sessionPort;
};

export {
    CAMERA_FIXTURE_QUERY,
    CONNECTION_MATRIX_FIXTURE_QUERY,
    HISTORY_POINTER_QUERY,
    POINTER_MODEL_QUERY,
    SESSION_GLOBAL,
    SESSION_QUERY,
    SESSION_TAKE_QUERY,
    absentVariableDefinition,
    attachStudioBlockSession,
    createReplayActionPort,
    historyViewportPresentation
};
