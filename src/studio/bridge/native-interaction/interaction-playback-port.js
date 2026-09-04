import {compileInteractionPlan} from './interaction-plan';
import {createInteractionClock} from './interaction-clock';
import {createInteractionDriver} from './interaction-driver';
import {createPlaybackEventScope} from './playback-event-scope';
import {createPointerController} from './pointer-controller';
import {createPointerModelByName} from './pointer-models';
import {createPointerOverlay} from './pointer-overlay';
import {selectScratchTargetThroughPointer} from './scratch-target-selection-driver';
import {presentSpriteCreation} from './sprite-creation-presentation';
import {verifyInteraction} from './interaction-verifier';

const createInteractionPlaybackPort = ({
    workspace,
    vm,
    ScratchBlocks,
    documentObject = document,
    journalCounts,
    checkpointPort = null,
    createClock = createInteractionClock,
    createPointer = createPointerOverlay,
    createPointerControl = createPointerController,
    createPointerModel = createPointerModelByName,
    pointerModelName = 'natural',
    showPointer = true,
    ensureInteractionVisible = null,
    afterTargetSelection = null,
    createScope = createPlaybackEventScope,
    createDriver = createInteractionDriver,
    verify = verifyInteraction
}) => {
    let activeClock = null;
    let sequenceActive = false;
    let sequencePointer = null;
    let idlePointer = null;
    // Identity belongs to the live workspace generation, not the lifetime of
    // an animated Play sequence. Ordinary history consumes the same aliases.
    let workspaceAliases = new Map();

    const allocatePointer = ({visible = showPointer} = {}) => {
        if (!visible) {
            return createPointerControl({
                overlay: {
                    moveTo: () => {},
                    remove: () => {},
                    element: null
                },
                model: createPointerModel(pointerModelName)
            });
        }
        if (idlePointer) {
            const pointer = idlePointer;
            idlePointer = null;
            if (!pointer.element || pointer.element.parentNode) {
                const hiddenUntilMove = typeof pointer.isHiddenUntilMove === 'function' &&
                    pointer.isHiddenUntilMove();
                if (!hiddenUntilMove && typeof pointer.show === 'function') pointer.show();
                return pointer;
            }
        }
        const overlay = createPointer({documentObject});
        return createPointerControl({overlay, model: createPointerModel(pointerModelName)});
    };
    const retirePointer = pointer => {
        if (!pointer) return;
        if (idlePointer && idlePointer !== pointer) idlePointer.remove();
        if (typeof pointer.idle === 'function') {
            idlePointer = pointer;
            pointer.idle();
        } else {
            pointer.remove();
            if (idlePointer === pointer) idlePointer = null;
        }
    };
    const endSequence = () => {
        sequenceActive = false;
        retirePointer(sequencePointer);
        sequencePointer = null;
    };
    const detach = () => {
        sequenceActive = false;
        if (sequencePointer) sequencePointer.remove();
        if (idlePointer && idlePointer !== sequencePointer) idlePointer.remove();
        sequencePointer = null;
        idlePointer = null;
        workspaceAliases = new Map();
    };
    const dismissPointer = () => {
        if (sequencePointer) sequencePointer.remove();
        if (idlePointer && idlePointer !== sequencePointer) idlePointer.remove();
        sequencePointer = null;
        idlePointer = null;
    };

    return {
        plan: ({transaction, direction, presentationMode = 'realistic'}) =>
            compileInteractionPlan(transaction, direction, {presentationMode}),
        beginSequence: () => {
            endSequence();
            sequenceActive = true;
        },
        getSequenceBlockAliases: () => (
            workspaceAliases.size ? Object.fromEntries(workspaceAliases) : null
        ),
        adoptSequenceBlockAliases: aliases => {
            if (!aliases) return;
            const entries = typeof aliases.entries === 'function' ? aliases.entries() : Object.entries(aliases);
            for (const [recordedId, liveId] of entries) {
                if (recordedId && liveId) workspaceAliases.set(recordedId, liveId);
            }
        },
        resetSequenceBlockAliases: () => {
            workspaceAliases = new Map();
        },
        selectTarget: async ({item, signal = null, speed = 1}) => {
            const clock = createClock();
            if (typeof clock.setSpeed === 'function') clock.setSpeed(speed);
            activeClock = clock;
            let pointer = null;
            let ownsPointer = false;
            let scope = null;
            try {
                pointer = sequencePointer || allocatePointer();
                if (sequenceActive && !sequencePointer) sequencePointer = pointer;
                ownsPointer = !sequenceActive;
                scope = createScope({workspace, ScratchBlocks, documentObject, journalCounts});
                const result = await selectScratchTargetThroughPointer({
                    vm,
                    item,
                    documentObject,
                    clock,
                    pointer,
                    scope,
                    afterTargetSelection: afterTargetSelection && (() => afterTargetSelection({speed, signal})),
                    signal
                });
                if (pointer && typeof pointer.settle === 'function') pointer.settle();
                return result;
            } catch (error) {
                return {status: 'mismatch', error, reason: error.message};
            } finally {
                clock.cancel();
                if (activeClock === clock) activeClock = null;
                if (scope) scope.detach();
                if (pointer && ownsPointer) retirePointer(pointer);
            }
        },
        endSequence,
        // Older/non-library sprite recordings have no picker provenance.
        // Present their verified checkpoint update on a virtual Add click,
        // without opening an unrelated library or claiming a native replay.
        presentProjectRestore: async ({transaction, direction, restore, signal = null, speed = 1}) => {
            if (transaction.operation?.type !== 'sprite-create' || direction !== 'forward') {
                return {status: 'unsupported'};
            }
            const clock = createClock();
            clock.setSpeed(speed);
            activeClock = clock;
            let pointer = null;
            let scope = null;
            try {
                pointer = sequencePointer || allocatePointer();
                if (sequenceActive && !sequencePointer) sequencePointer = pointer;
                scope = createScope({workspace, ScratchBlocks, documentObject, journalCounts});
                return await presentSpriteCreation({
                    transaction, direction, vm, documentObject, pointer, clock, signal, restore
                });
            } finally {
                clock.cancel();
                if (activeClock === clock) activeClock = null;
                if (scope) scope.detach();
                if (pointer && !sequenceActive) retirePointer(pointer);
            }
        },
        // The cursor belongs to realistic Play. History navigation calls this
        // at its command boundary so Play's intentional idle hold cannot leak
        // into a subsequent Undo, Redo, or timeline seek.
        dismissPointer,
        play: async ({transaction, direction, signal = null, presentationMode = 'realistic', speed = 1}) => {
            const plan = compileInteractionPlan(transaction, direction, {presentationMode});
            if (plan.kind === 'semantic-only') return {status: 'unsupported', plan};
            if (createDriver === createInteractionDriver &&
                typeof workspace.whenBlockOperationsComplete !== 'function') {
                const message =
                    'Native playback requires the local Scratch Blocks integration patch; reload the editor';
                return {
                    status: 'mismatch',
                    plan,
                    error: new Error(message),
                    evidence: {message, missingCapability: 'whenBlockOperationsComplete'}
                };
            }
            if ((ScratchBlocks.WidgetDiv && ScratchBlocks.WidgetDiv.isVisible()) ||
                (ScratchBlocks.DropDownDiv && ScratchBlocks.DropDownDiv.isVisible())) {
                return {status: 'unsupported', plan, reason: 'a field editor is active'};
            }

            const clock = createClock();
            if (typeof clock.setSpeed === 'function') clock.setSpeed(speed);
            activeClock = clock;
            let pointer = null;
            let ownsPointer = false;
            let scope = null;
            let driver = null;
            try {
                // Ordinary history navigation may still use the verified
                // native gesture, but its presentation is intentionally
                // pointer-free. The richer pointer belongs to full Play.
                pointer = sequencePointer || allocatePointer({
                    visible: showPointer && presentationMode !== 'history'
                });
                if (sequenceActive && !sequencePointer) sequencePointer = pointer;
                ownsPointer = !sequenceActive;
                const aliases = workspaceAliases;
                if (ensureInteractionVisible) await ensureInteractionVisible(plan, aliases, {speed});
                scope = createScope({workspace, ScratchBlocks, documentObject, journalCounts});
                driver = createDriver({
                    workspace,
                    vm,
                    ScratchBlocks,
                    documentObject,
                    clock,
                    pointer,
                    scope,
                    aliases,
                    checkpointPort,
                    afterTargetSelection: afterTargetSelection && (() => afterTargetSelection({speed, signal}))
                });
                let driverEvidence;
                try {
                    driverEvidence = await driver.play(plan, signal);
                } finally {
                    // A failed/cancelled gesture can still schedule snap, bump
                    // or outside-drop rollback. Keep capture and Undo isolated
                    // until those operations and their events have drained.
                    if (typeof scope.waitForBlockOperations === 'function') await scope.waitForBlockOperations();
                }
                // A cancelled Blockly gesture may leave its create/move/delete
                // batch on the zero-delay event queue. Deliver it while the
                // temporary block and playback scope still exist; restoring a
                // checkpoint first would make the VM consume a stale move.
                if (typeof scope.flushPendingEvents === 'function') scope.flushPendingEvents();
                if (driverEvidence.unsupported) {
                    return {status: 'unsupported', plan, reason: driverEvidence.reason || null};
                }
                if (driverEvidence.cancelled) return {status: 'cancelled', plan, evidence: driverEvidence};
                const result = await verify({
                    workspace,
                    vm,
                    plan: driverEvidence.resolvedPlan || plan,
                    scope,
                    driverEvidence
                });
                if (pointer && typeof pointer.settle === 'function') pointer.settle();
                const blockAliases = {
                    ...((driverEvidence.resolvedPlan || plan).blockAliases || {}),
                    ...(driverEvidence.idAliases || {})
                };
                if (result.matches) {
                    Object.entries(blockAliases).forEach(([recordedId, liveId]) => {
                        aliases.set(recordedId, liveId);
                    });
                }
                return {
                    status: result.matches ? 'verified' : 'mismatch',
                    plan,
                    blockAliases: Object.keys(blockAliases).length ? blockAliases : null,
                    idAliases: driverEvidence.idAliases || null,
                    evidence: result.evidence
                };
            } catch (error) {
                return {
                    status: 'mismatch',
                    plan,
                    error,
                    evidence: {message: error.message, stack: error.stack || null}
                };
            } finally {
                clock.cancel();
                if (activeClock === clock) activeClock = null;
                if (driver && typeof driver.cleanup === 'function') driver.cleanup(plan);
                if (scope) {
                    try {
                        if (typeof scope.flushPendingEvents === 'function') scope.flushPendingEvents();
                    } finally {
                        scope.detach();
                    }
                }
                if (pointer && ownsPointer) retirePointer(pointer);
            }
        },
        finishActive: () => {
            if (activeClock && typeof activeClock.finish === 'function') activeClock.finish();
        },
        cancelActive: () => {
            if (activeClock && typeof activeClock.cancel === 'function') activeClock.cancel();
        },
        detach
    };
};

export {createInteractionPlaybackPort};
