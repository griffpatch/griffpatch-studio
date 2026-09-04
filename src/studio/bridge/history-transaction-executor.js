import {VIEWPORT_PRESENTATION_MODES} from './scratch-blocks-viewport-port';
import {listDefinitionState} from '../replay/block-event-action';
import {historyTargetBeforeApply, historyTargetReference, retainsEditingTarget} from './history-target-reference';

const adoptNativeDefinitions = ({transaction, direction, authoredStatePort, listDefinitionPort}) => {
    (transaction.events || []).forEach(event => {
        const definition = listDefinitionState(event, direction);
        if (!definition) return;
        authoredStatePort.adoptListDefinition(definition);
        listDefinitionPort.adoptDefinition(definition);
    });
};

/**
 * Own the safety boundary and one complete transaction mutation. Session
 * navigation decides which transaction to run and advances the cursor only
 * after this executor returns successfully.
 *
 * @param {object} dependencies editor integration ports
 * @returns {object} transaction executor
 */
const createHistoryTransactionExecutor = ({
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
    verifyTopology,
    publish,
    settle = () => Promise.resolve(),
    reconcileGraph = () => ({repaired: 0, shadows: []}),
    presentationInterrupted = () => false
}) => ({
    apply: async (
        transaction,
        direction,
        {
            nativeAllowed = true,
            lifecyclePresentation = false,
            interactionPresentation = 'realistic',
            playbackSpeed = 1,
            presentTargetSelection = null,
            presentProjectRestore = null,
            viewportPresentation = VIEWPORT_PRESENTATION_MODES.REVEAL,
            signal = null
        } = {}
    ) => {
        const rollbackCheckpointId = await checkpointPort.create('Tutorial Studio history safety boundary');
        let lifecycleBefore = null;
        try {
            if (transaction.kind === 'project-operation') {
                const operation = transaction.operation;
                let nativeResult = null;
                let presentedProject = null;
                if (direction === 'forward' && nativeInteraction && nativeAllowed &&
                    !presentationInterrupted()) {
                    nativeResult = await nativeInteraction.play({
                        transaction,
                        direction,
                        presentationMode: interactionPresentation,
                        ...(playbackSpeed === 1 ? {} : {speed: playbackSpeed}),
                        ...(signal ? {signal} : {})
                    });
                    if (nativeResult.status !== 'verified' && nativeResult.status !== 'unsupported') {
                        const error = new Error(
                            nativeResult.status === 'cancelled' ?
                                'Native project interaction was cancelled' :
                                'Native project interaction did not match the recorded operation'
                        );
                        error.nativeInteraction = nativeResult;
                        publish({nativeInteraction: nativeResult});
                        throw error;
                    }
                    if (nativeResult.status === 'verified') {
                        presentedProject = await captureProjectState();
                    }
                }
                const checkpointId = direction === 'forward' ?
                    operation.afterCheckpointId : operation.beforeCheckpointId;
                const expectedHash = direction === 'forward' ?
                    operation.afterProjectHash : operation.beforeProjectHash;
                const recordedTarget = historyTargetReference(transaction, direction);
                const incomingTarget = historyTargetBeforeApply(transaction, direction);
                const createsSprite = direction === 'forward' && operation.type === 'sprite-create';
                // Show history's context change before loading its checkpoint
                // where possible. A newly restored sprite can only be clicked
                // afterwards, while the previously visible context is retained.
                const historyTargetSelection = presentTargetSelection &&
                    (recordedTarget.targetId || recordedTarget.targetRef) ? presentTargetSelection : null;
                if (historyTargetSelection && !createsSprite && target.resolve(incomingTarget)) {
                    await historyTargetSelection(incomingTarget);
                }
                // A copy changes the destination's data, not the editor view.
                // Keep the context established by visible interaction through
                // checkpoint reconciliation. Creating a sprite is different:
                // its Add click also selects it, so restore that context on
                // the click, not by clicking its newly appeared tile later.
                const preservePresentedContext = Boolean(historyTargetSelection) ||
                    (direction === 'forward' && nativeAllowed && interactionPresentation === 'realistic');
                const sameContext = historyTargetSelection && retainsEditingTarget(transaction) &&
                    target.isSelected(incomingTarget);
                const editingTarget = ((createsSprite || sameContext) && recordedTarget) ||
                    (preservePresentedContext && target.current && target.current()) ||
                    recordedTarget;
                let restorePresentation = null;
                let restoredOnClick = false;
                const presentRestore = presentProjectRestore ||
                    (nativeResult?.status === 'unsupported' && interactionPresentation === 'realistic' &&
                        nativeInteraction.presentProjectRestore);
                if (createsSprite && !presentationInterrupted() && typeof presentRestore === 'function') {
                    restorePresentation = await presentRestore({
                        transaction,
                        direction,
                        speed: playbackSpeed,
                        signal,
                        restore: async () => {
                            await restoreCheckpoint(checkpointId, editingTarget);
                            restoredOnClick = true;
                        }
                    });
                    if (!['presented', 'unsupported', 'skipped'].includes(restorePresentation.status)) {
                        const error = new Error('Project update presentation was cancelled');
                        error.nativeInteraction = restorePresentation;
                        throw error;
                    }
                }
                if (restorePresentation?.status === 'presented') nativeResult = restorePresentation;
                if (!restoredOnClick) await restoreCheckpoint(checkpointId, editingTarget);
                if (historyTargetSelection && !target.isSelected(recordedTarget)) {
                    await historyTargetSelection(recordedTarget);
                }
                authoredStatePort.adoptCurrent();
                listDefinitionPort.reset();
                if (nativeInteraction && typeof nativeInteraction.resetSequenceBlockAliases === 'function') {
                    nativeInteraction.resetSequenceBlockAliases();
                }
                if (!preservePresentedContext && (editingTarget.targetId || editingTarget.targetRef) &&
                    !target.isSelected(editingTarget)) {
                    await target.select(editingTarget);
                }
                const captured = await captureProjectState();
                const validation = projectValidation(
                    expectedHash,
                    presentedProject && presentedProject.project,
                    captured
                );
                if (!validation.matches) {
                    const error = new Error('Restored project operation did not match its checkpoint');
                    error.validation = validation;
                    throw error;
                }
                return {status: 'verified', kind: 'project-operation', validation, nativeInteraction: nativeResult};
            }

            if (lifecyclePresentation && !presentationInterrupted()) {
                lifecycleBefore = lifecycleAnimation.captureBefore({transaction, direction});
            }

            let nativeResult = null;
            let semanticResult = null;
            if (nativeInteraction && nativeAllowed && !presentationInterrupted()) {
                nativeResult = await nativeInteraction.play({
                    transaction,
                    direction,
                    presentationMode: interactionPresentation,
                    ...(playbackSpeed === 1 ? {} : {speed: playbackSpeed}),
                    ...(signal ? {signal} : {})
                });
            }
            if (!nativeResult || nativeResult.status === 'unsupported') {
                const sequenceBlockAliases = nativeInteraction &&
                    typeof nativeInteraction.getSequenceBlockAliases === 'function' ?
                    nativeInteraction.getSequenceBlockAliases() : null;
                semanticResult = sequenceBlockAliases ? await replaySemanticTransaction(
                    transaction,
                    direction,
                    viewportPresentation,
                    playbackSpeed,
                    sequenceBlockAliases
                ) : await replaySemanticTransaction(
                    transaction,
                    direction,
                    viewportPresentation,
                    playbackSpeed
                );
            } else {
                if (nativeResult.status !== 'verified') {
                    const error = new Error(
                        nativeResult.status === 'cancelled' ?
                            'Native interaction was cancelled' :
                            'Native interaction did not match the recorded transaction'
                    );
                    error.nativeInteraction = nativeResult;
                    publish({nativeInteraction: nativeResult});
                    throw error;
                }
                // A verified native variable/list gesture replaces semantic
                // replay, so explicitly advance the two authored definition
                // shadows that semantic replay would otherwise maintain.
                adoptNativeDefinitions({transaction, direction, authoredStatePort, listDefinitionPort});
            }
            await settle();
            reconcileGraph({transaction, direction});
            const topology = verifyTopology({
                workspace,
                vm,
                transaction,
                direction,
                blockAliases: (semanticResult && semanticResult.blockAliases) ||
                    (nativeResult && nativeResult.blockAliases)
            });
            if (!topology.matches) {
                publish({
                    nativeInteraction: nativeResult ? {...nativeResult, topology} : {
                        status: 'topology-mismatch',
                        topology
                    }
                });
                const error = new Error('Block topology did not match the recorded connection');
                error.topology = topology;
                throw error;
            }
            if (semanticResult && semanticResult.blockAliases && nativeInteraction &&
                typeof nativeInteraction.adoptSequenceBlockAliases === 'function') {
                nativeInteraction.adoptSequenceBlockAliases(semanticResult.blockAliases);
            }
            const nativePresented = nativeResult && nativeResult.status === 'verified';
            if (lifecyclePresentation && !presentationInterrupted() && !nativePresented) {
                await lifecycleAnimation.playAfter({
                    transaction,
                    direction,
                    before: lifecycleBefore,
                    ...(playbackSpeed === 1 ? {} : {playbackSpeed})
                });
                lifecycleBefore = null;
            } else if (lifecycleBefore) {
                lifecycleAnimation.discard(lifecycleBefore);
                lifecycleBefore = null;
            }
            return nativeResult;
        } catch (caughtError) {
            const error = caughtError instanceof Error ? caughtError : new Error(String(caughtError));
            lifecycleAnimation.discard(lifecycleBefore);
            error.studioTransaction = transaction;
            try {
                await restoreCheckpoint(rollbackCheckpointId);
                authoredStatePort.adoptCurrent();
                listDefinitionPort.reset();
                if (nativeInteraction && typeof nativeInteraction.resetSequenceBlockAliases === 'function') {
                    nativeInteraction.resetSequenceBlockAliases();
                }
                error.studioRestored = true;
            } catch (restoreError) {
                error.studioRestoreError = restoreError;
            }
            throw error;
        } finally {
            if (typeof checkpointPort.remove === 'function') {
                try {
                    await checkpointPort.remove(rollbackCheckpointId);
                } catch (error) { // eslint-disable-line no-empty
                    // A stale safety point is harmless and preferable to failing history.
                }
            }
        }
    }
});

export {createHistoryTransactionExecutor};
