import {snapshotBlockEvent} from '../journal/snapshot-block-event';
import {cloneJson} from '../lib/clone-json';
import {createWorkspaceBlockReference} from './workspace-block-reference';

const DEBUG_GLOBAL = '__TURBOWARP_TUTORIAL_STUDIO_CAPTURE__';
const DEBUG_ELEMENT_ID = 'tw-studio-capture-debug';
const MAX_SNAPSHOTS = 10000;

const emptyPort = Object.freeze({
    enabled: false,
    pause: () => {},
    resume: () => {},
    flush: () => {},
    detach: () => {},
    clear: () => {},
    getSnapshots: () => [],
    getErrors: () => []
});

const isCaptureRequested = () => {
    if (typeof window === 'undefined') return false;
    const query = new URLSearchParams(window.location.search);
    return query.get('studio-capture') === '1';
};

const defaultNow = () => {
    if (typeof performance !== 'undefined' && performance.now) return performance.now();
    return Date.now();
};

const defaultDefer = callback => setTimeout(callback, 0);

const isInlineFieldEditorActive = documentObject => {
    const activeElement = documentObject && documentObject.activeElement;
    return Boolean(
        activeElement &&
        activeElement.classList &&
        activeElement.classList.contains('blocklyHtmlInput')
    );
};

const isFieldChange = snapshot => Boolean(
    snapshot &&
    snapshot.type === 'change' &&
    snapshot.details &&
    snapshot.details.element === 'field'
);

const isSameField = (first, next) => Boolean(
    first.targetId === next.targetId &&
    first.blockId === next.blockId &&
    first.details.name === next.details.name
);

const mergeFieldChanges = (first, latest) => ({
    ...latest,
    group: first.group,
    details: {
        ...latest.details,
        oldValue: first.details.oldValue
    }
});

const isNoOpFieldChange = snapshot => (
    JSON.stringify(snapshot.details.oldValue) === JSON.stringify(snapshot.details.newValue)
);

/**
 * Attach the experimental Studio recorder beside TurboWarp's normal VM listener.
 * Capture is disabled unless explicitly requested by query parameter or test injection.
 *
 * @param {object} options port dependencies
 * @param {object} options.workspace visible Scratch Blocks workspace
 * @param {object} options.vm TurboWarp VM
 * @param {object} options.ScratchBlocks loaded Scratch Blocks namespace
 * @param {boolean} [options.enabled] override query-flag detection
 * @param {boolean} [options.exposeDebug] expose the in-memory journal on window
 * @param {Function} [options.now] source-take clock
 * @param {Function} [options.defer] schedule work after Scratch Blocks flushes queued events
 * @param {Function} [options.onSnapshot] durable snapshot sink
 * @param {?Document} [options.documentObject] browser document used to observe inline editor focus
 * @returns {object} capture lifecycle port
 */
const attachStudioBlockCapture = ({
    workspace,
    vm,
    ScratchBlocks,
    enabled = isCaptureRequested(),
    exposeDebug = enabled,
    now = defaultNow,
    defer = defaultDefer,
    onSnapshot = null,
    captureVariableDefinition = null,
    documentObject = typeof document === 'undefined' ? null : document
}) => {
    if (!enabled) return emptyPort;

    const snapshots = [];
    const errors = [];
    let paused = false;
    let detached = false;
    let pauseRevision = 0;
    let debugElement = null;
    let pendingFieldChange = null;
    const clipboardPasteSources = new Map();
    const eventGroupSources = new Map();
    const blockDrags = new Map();
    const pendingDragSnapshots = new Map();
    const dragListener = detail => {
        if (detail.phase === 'settled') {
            const pending = pendingDragSnapshots.get(detail.group) || [];
            pendingDragSnapshots.delete(detail.group);
            // Outside drops are rolled back after the GUI receives the payload.
            // Their temporary clone/detach/move is not an authored source edit.
            // Gesture.cancel() ends at the current position; it does not undo.
            // Paste-at-mouse uses that path when the next click ends its drag.
            if (!detail.isOutside) {
                // The observer is registered before the sink declaration, but
                // Blockly only calls it after this port has finished attaching.
                pending.forEach(acceptSnapshot); // eslint-disable-line no-use-before-define
            }
            blockDrags.delete(detail.group);
            return;
        }
        if (paused || detached || !detail.group) return;
        if (detail.phase === 'start') {
            blockDrags.set(detail.group, {
                blockId: detail.blockId,
                blockIds: [...detail.blockIds],
                source: 'scratch-blocks-drag',
                blockRef: createWorkspaceBlockReference(workspace, detail.blockId),
                ...(detail.origin ? {origin: {
                    ...detail.origin,
                    blockRef: createWorkspaceBlockReference(workspace, detail.origin.blockId)
                }} : {})
            });
        }
    };
    if (typeof workspace.addBlockDragListener === 'function') workspace.addBlockDragListener(dragListener);
    const originalWorkspacePaste = typeof workspace.paste === 'function' ? workspace.paste : null;
    const wrappedWorkspacePaste = originalWorkspacePaste && (xmlBlock => {
        const group = ScratchBlocks.Events.getGroup && ScratchBlocks.Events.getGroup();
        const sourceId = xmlBlock && xmlBlock.getAttribute && xmlBlock.getAttribute('id');
        const sourceBlock = sourceId && workspace.getBlockById && workspace.getBlockById(sourceId);
        const sourceBlockRef = sourceBlock && createWorkspaceBlockReference(workspace, sourceId);
        if (group && sourceBlock && sourceBlockRef &&
            String(xmlBlock.tagName || '').toLowerCase() !== 'comment') {
            clipboardPasteSources.set(group, {
                kind: 'workspace-clipboard',
                sourceBlockRef,
                sourceBlockType: sourceBlock.type || null
            });
        }
        try {
            return originalWorkspacePaste.call(workspace, xmlBlock);
        } finally {
            if (group) defer(() => clipboardPasteSources.delete(group));
        }
    });
    if (wrappedWorkspacePaste) workspace.paste = wrappedWorkspacePaste;

    const updateDebugElement = () => {
        if (!debugElement) return;
        debugElement.dataset.snapshotCount = snapshots.length.toString();
        debugElement.dataset.errorCount = errors.length.toString();
        debugElement.textContent = JSON.stringify({
            snapshotCount: snapshots.length,
            errorCount: errors.length,
            latestSnapshot: snapshots[snapshots.length - 1] || null,
            latestError: errors[errors.length - 1] || null
        });
    };

    const recordError = (error, type) => {
        errors.push({
            recordedAtMs: now(),
            type,
            message: error.message
        });
        updateDebugElement();
    };

    const commitSnapshot = snapshot => {
        snapshots.push(snapshot);
        if (snapshots.length > MAX_SNAPSHOTS) snapshots.shift();
        if (onSnapshot) onSnapshot(cloneJson(snapshot));
        updateDebugElement();
    };

    const flushPendingFieldChange = () => {
        if (!pendingFieldChange) return;
        const snapshot = pendingFieldChange;
        pendingFieldChange = null;
        if (!isNoOpFieldChange(snapshot)) commitSnapshot(snapshot);
    };

    const safelyFlushPendingFieldChange = () => {
        const type = pendingFieldChange && pendingFieldChange.type;
        try {
            flushPendingFieldChange();
        } catch (error) {
            recordError(error, type);
        }
    };

    const acceptSnapshot = snapshot => {
        if (isFieldChange(snapshot) && pendingFieldChange && isSameField(pendingFieldChange, snapshot)) {
            pendingFieldChange = mergeFieldChanges(pendingFieldChange, snapshot);
            if (!isInlineFieldEditorActive(documentObject)) flushPendingFieldChange();
            return;
        }

        flushPendingFieldChange();
        if (isFieldChange(snapshot) && isInlineFieldEditorActive(documentObject)) {
            pendingFieldChange = snapshot;
            return;
        }
        commitSnapshot(snapshot);
    };

    const focusOutListener = () => {
        defer(() => {
            if (!detached && !isInlineFieldEditorActive(documentObject)) safelyFlushPendingFieldChange();
        });
    };

    const recordEvent = event => {
        if (detached) return;
        const target = vm.editingTarget;
        if (!target || !target.id) return;

        try {
            const variableDefinition = captureVariableDefinition ? captureVariableDefinition(event) : null;
            const snapshot = snapshotBlockEvent(event, {
                targetId: target.id,
                targetName: target.getName ? target.getName() : target.sprite ? target.sprite.name : null,
                targetIsStage: Boolean(target.isStage),
                recordedAtMs: now(),
                xmlToText: ScratchBlocks.Xml.domToText,
                variableDefinition
            });
            if (!snapshot) return;
            if (blockDrags.has(event.group)) snapshot.gesture = cloneJson(blockDrags.get(event.group));
            const eventBlock = workspace.getBlockById && workspace.getBlockById(event.blockId);
            if (eventBlock && eventBlock.type) snapshot.blockType = eventBlock.type;
            const blockRef = createWorkspaceBlockReference(workspace, event.blockId);
            if (blockRef) snapshot.blockRef = blockRef;
            const clipboardPasteSource = event.type === 'create' && event.group &&
                clipboardPasteSources.get(event.group);
            if (clipboardPasteSource) snapshot.interactionSource = cloneJson(clipboardPasteSource);
            if (eventGroupSources.has(event.group)) {
                snapshot.interactionSource = cloneJson(eventGroupSources.get(event.group));
            }
            if (snapshot.type === 'move') {
                for (const locationName of ['oldLocation', 'newLocation']) {
                    const location = snapshot.details[locationName];
                    const parentRef = location.parentId &&
                        createWorkspaceBlockReference(workspace, location.parentId);
                    if (parentRef) location.parentRef = parentRef;
                }
            }
            if (blockDrags.has(event.group)) {
                if (!pendingDragSnapshots.has(event.group)) pendingDragSnapshots.set(event.group, []);
                pendingDragSnapshots.get(event.group).push(snapshot);
            } else acceptSnapshot(snapshot);
        } catch (error) {
            recordError(error, event && event.type);
        }
    };

    const listener = event => {
        if (paused || detached || event.recordUndo === false) return;
        // The list-creation dialog checks its new monitor in the flyout later
        // in the same Blockly event queue. Capture after that queue so the one
        // semantic create event also retains the visible monitor definition.
        const broadcastType = ScratchBlocks.BROADCAST_MESSAGE_VARIABLE_TYPE || 'broadcast_msg';
        if (event && event.type === 'var_create' && event.varType !== broadcastType) {
            defer(() => recordEvent(event));
        } else recordEvent(event);
    };

    const port = {
        enabled: true,
        // Tag before native asynchronous delivery. Deferred variable events
        // share the same provenance; the bounded map is cleared on reset.
        tagEventGroup: (group, source) => {
            if (detached || paused || !group || !source || !source.kind) return;
            eventGroupSources.set(group, cloneJson(source));
            if (eventGroupSources.size > MAX_SNAPSHOTS) eventGroupSources.delete(eventGroupSources.keys().next().value);
        },
        pause: () => {
            pauseRevision++;
            paused = true;
        },
        resume: () => {
            const expectedRevision = pauseRevision;
            defer(() => {
                if (!detached && expectedRevision === pauseRevision) paused = false;
            });
        },
        flush: safelyFlushPendingFieldChange,
        getDragSourceReference: blockId => {
            const drag = [...blockDrags.values()].find(candidate => candidate.blockId === blockId);
            return drag && (drag.origin?.blockRef || drag.blockRef);
        },
        clear: () => {
            eventGroupSources.clear();
            blockDrags.clear();
            pendingDragSnapshots.clear();
            pendingFieldChange = null;
            clipboardPasteSources.clear();
            snapshots.length = 0;
            errors.length = 0;
            updateDebugElement();
        },
        getSnapshots: () => cloneJson(snapshots),
        getErrors: () => cloneJson(errors),
        detach: () => {
            if (detached) return;
            safelyFlushPendingFieldChange();
            detached = true;
            pauseRevision++;
            workspace.removeChangeListener(listener);
            if (typeof workspace.removeBlockDragListener === 'function') {
                workspace.removeBlockDragListener(dragListener);
            }
            blockDrags.clear();
            pendingDragSnapshots.clear();
            if (documentObject && typeof documentObject.removeEventListener === 'function') {
                documentObject.removeEventListener('focusout', focusOutListener, true);
            }
            clipboardPasteSources.clear();
            eventGroupSources.clear();
            if (wrappedWorkspacePaste && workspace.paste === wrappedWorkspacePaste) {
                workspace.paste = originalWorkspacePaste;
            }
            if (typeof window !== 'undefined' && window[DEBUG_GLOBAL] === port) {
                delete window[DEBUG_GLOBAL];
            }
            if (debugElement) debugElement.remove();
            debugElement = null;
        }
    };

    workspace.addChangeListener(listener);
    if (documentObject && typeof documentObject.addEventListener === 'function') {
        documentObject.addEventListener('focusout', focusOutListener, true);
    }
    if (exposeDebug && typeof window !== 'undefined') {
        window[DEBUG_GLOBAL] = port;
        debugElement = document.createElement('output');
        debugElement.id = DEBUG_ELEMENT_ID;
        debugElement.hidden = true;
        document.body.appendChild(debugElement);
        updateDebugElement();
    }
    return port;
};

export {
    DEBUG_ELEMENT_ID,
    DEBUG_GLOBAL,
    attachStudioBlockCapture
};
