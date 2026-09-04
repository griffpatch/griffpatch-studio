const cloneStack = stack => (Array.isArray(stack) ? stack.slice() : []);
const sameStack = (before, after) => (
    before.length === after.length && before.every((entry, index) => entry === after[index])
);

const createInputShield = documentObject => {
    const shield = documentObject.createElement('div');
    shield.setAttribute('aria-hidden', 'true');
    Object.assign(shield.style, {
        position: 'fixed',
        inset: '0',
        zIndex: '10001',
        cursor: 'none',
        background: 'transparent'
    });
    documentObject.body.appendChild(shield);
    return shield;
};

/**
 * Isolate one native gesture without disabling Blockly event delivery.
 *
 * @param {object} options dependencies
 * @returns {object} event/Undo/input lifecycle
 */
const createPlaybackEventScope = ({workspace, ScratchBlocks, documentObject = document, journalCounts}) => {
    const observed = [];
    const undoBefore = cloneStack(workspace.undoStack_);
    const redoBefore = cloneStack(workspace.redoStack_);
    const journalBefore = journalCounts();
    if (typeof workspace.suspendUndoRecording !== 'function') {
        throw new Error('Native playback requires the Scratch Blocks Undo storage contract');
    }
    const shield = createInputShield(documentObject);
    const releaseUndoRecording = workspace.suspendUndoRecording();
    let detached = false;
    let revision = 0;

    // Keep storage isolated until queued events drain. Do not change the global
    // Events.recordUndo flag: Blockly uses it to disable shadow regeneration
    // during literal event replay, but this scope performs real native gestures.

    const listener = event => {
        observed.push(event);
        revision++;
    };
    const blockKeyboardInput = event => {
        event.preventDefault();
        event.stopPropagation();
        if (event.stopImmediatePropagation) event.stopImmediatePropagation();
    };
    workspace.addChangeListener(listener);
    if (documentObject.addEventListener) {
        for (const type of ['keydown', 'keypress', 'keyup']) {
            documentObject.addEventListener(type, blockKeyboardInput, true);
        }
    }

    return {
        observed,
        getRevision: () => revision,
        waitForBlockOperations: () => (typeof workspace.whenBlockOperationsComplete === 'function' ?
            new Promise(resolve => workspace.whenBlockOperationsComplete(resolve)) : Promise.resolve()),
        runWithoutUndo: callback => callback(),
        flushPendingEvents: () => {
            if (ScratchBlocks.Events.FIRE_QUEUE_ && ScratchBlocks.Events.FIRE_QUEUE_.length &&
                typeof ScratchBlocks.Events.fireNow_ === 'function') {
                ScratchBlocks.Events.fireNow_();
            }
        },
        verifyIsolation: () => {
            const journalAfter = journalCounts();
            return {
                journalUnchanged: JSON.stringify(journalBefore) === JSON.stringify(journalAfter),
                undoUnchanged: sameStack(undoBefore, cloneStack(workspace.undoStack_)),
                redoUnchanged: sameStack(redoBefore, cloneStack(workspace.redoStack_)),
                journalBefore,
                journalAfter,
                undoDepth: undoBefore.length,
                redoDepth: redoBefore.length
            };
        },
        detach: () => {
            if (detached) return;
            detached = true;
            releaseUndoRecording();
            workspace.removeChangeListener(listener);
            if (documentObject.removeEventListener) {
                for (const type of ['keydown', 'keypress', 'keyup']) {
                    documentObject.removeEventListener(type, blockKeyboardInput, true);
                }
            }
            shield.remove();
        }
    };
};

export {createPlaybackEventScope};
