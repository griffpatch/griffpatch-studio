const emptyPort = {detach: () => {}};

const isEditableTarget = target => {
    if (!target) return false;
    const tagName = target.tagName && target.tagName.toLowerCase();
    return tagName === 'input' || tagName === 'textarea' || tagName === 'select' ||
        target.isContentEditable === true;
};

const historyDirection = event => {
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return null;
    const key = event.key ? event.key.toLowerCase() : String.fromCharCode(event.keyCode).toLowerCase();
    if (key === 'y' || (key === 'z' && event.shiftKey)) return 'redo';
    return key === 'z' ? 'undo' : null;
};

/**
 * Route explicit user undo/redo commands through Studio without replacing
 * `workspace.undo()`, which Scratch also uses for internal drag correction.
 *
 * @param {object} options history command dependencies
 * @param {Document} options.documentObject editor document
 * @param {object} options.ScratchBlocks loaded Scratch Blocks namespace
 * @param {object} options.session Studio session history controller
 * @returns {object} detachable command port
 */
const attachStudioHistoryCommands = ({documentObject, ScratchBlocks, session}) => {
    if (!documentObject) return emptyPort;

    let detached = false;
    const invoke = direction => {
        if (detached) return;
        session.requestHistory(direction).catch(() => {
            // The session publishes the actionable error and restores safety.
        });
    };

    const onKeyDown = event => {
        const key = event.key || String.fromCharCode(event.keyCode);
        if (key === 'Escape' && typeof session.stopPlayback === 'function' && session.stopPlayback()) {
            event.preventDefault();
            event.stopImmediatePropagation();
            if (ScratchBlocks.hideChaff) ScratchBlocks.hideChaff();
            return;
        }
        const direction = historyDirection(event);
        if (!direction || isEditableTarget(event.target)) return;
        if (typeof session.nativeHistoryOwns === 'function' && session.nativeHistoryOwns(direction)) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (ScratchBlocks.hideChaff) ScratchBlocks.hideChaff();
        invoke(direction);
    };
    documentObject.addEventListener('keydown', onKeyDown, true);

    const contextMenu = ScratchBlocks.ContextMenu;
    const originalUndoOption = contextMenu && contextMenu.wsUndoOption;
    const originalRedoOption = contextMenu && contextMenu.wsRedoOption;
    const undoOption = () => ({
        text: ScratchBlocks.Msg.UNDO,
        enabled: session.canRequestHistory('undo'),
        callback: () => invoke('undo')
    });
    const redoOption = () => ({
        text: ScratchBlocks.Msg.REDO,
        enabled: session.canRequestHistory('redo'),
        callback: () => invoke('redo')
    });
    if (contextMenu) {
        contextMenu.wsUndoOption = undoOption;
        contextMenu.wsRedoOption = redoOption;
    }

    return {
        detach: () => {
            detached = true;
            documentObject.removeEventListener('keydown', onKeyDown, true);
            if (contextMenu && contextMenu.wsUndoOption === undoOption) {
                contextMenu.wsUndoOption = originalUndoOption;
            }
            if (contextMenu && contextMenu.wsRedoOption === redoOption) {
                contextMenu.wsRedoOption = originalRedoOption;
            }
        }
    };
};

export {
    attachStudioHistoryCommands,
    historyDirection,
    isEditableTarget
};
