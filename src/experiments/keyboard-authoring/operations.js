import {blockXml} from './catalogue';
import {fieldAtPosition, resolveConnection} from './navigation';
import {placementDeltaY} from './block-row-geometry';

const inEventGroup = (ScratchBlocks, action, onGroup = null) => {
    const previous = ScratchBlocks.Events.getGroup();
    ScratchBlocks.Events.setGroup(true);
    try {
        const finish = onGroup && onGroup(ScratchBlocks.Events.getGroup());
        const result = action();
        if (typeof finish === 'function') finish();
        return result;
    } finally {
        ScratchBlocks.Events.setGroup(previous);
    }
};

const accepts = (workspace, position, instance, replacementBlockId = null) => {
    const {shape, workspaceForm} = instance.typeInfo;
    if (position.kind === 'workspace') return true;
    const anchor = workspace.getBlockById(position.blockId);
    if (!anchor) return false;
    const connection = resolveConnection(workspace, position);
    if (position.kind === 'before' && !connection) {
        return Boolean(anchor.previousConnection && shape.canStackDown && !shape.canBeRound);
    }
    if (!connection) return false;
    const child = connection.targetBlock();
    if (connection.type === 1) {
        // Replacement is explicit: the editor must carry the selected child's
        // identity from the caret into both preview and commit. A stale or
        // neighbouring selection can never evict the current expression.
        const replaceSelected = child && !child.isShadow() && child.id === replacementBlockId;
        return shape.canBeRound && (!child || child.isShadow() || replaceSelected) &&
            connection.checkType_(workspaceForm.outputConnection);
    }
    return shape.canStackUp && (!child || shape.canStackDown);
};

const placeBlock = (workspace, position, block, replacementBlockId = null) => {
    const connection = resolveConnection(workspace, position);
    if (connection) {
        const child = connection.targetBlock();
        if (connection.type === 1 && child && !child.isShadow()) {
            if (child.id !== replacementBlockId) {
                throw new Error('The selected expression no longer owns this input.');
            }
            // Native disposal restores any stored default shadow. Connecting
            // the new reporter then obscures that shadow in Blockly's normal
            // way. All create/delete/move events remain in the caller's group.
            child.dispose(false);
        }
        connection.connect(connection.type === 1 ? block.outputConnection : block.previousConnection);
    } else if (position.kind === 'before') {
        const anchor = workspace.getBlockById(position.blockId);
        // Align the native connection before attaching, keeping the existing
        // stack stationary. The disposable draft uses this same placement.
        block.moveBy(anchor.previousConnection.x_ - block.nextConnection.x_,
            anchor.previousConnection.y_ - block.nextConnection.y_);
        block.nextConnection.connect(anchor.previousConnection);
    } else {
        block.moveBy(position.x, placementDeltaY(block, position));
    }
    return block;
};

const insertBlock = ({ScratchBlocks, workspace, position, instance, onGroup, replacementBlockId = null}) => {
    if (!accepts(workspace, position, instance, replacementBlockId)) {
        throw new Error('This block does not fit at the caret.');
    }
    const xml = blockXml(instance); // Fail malformed drafts before any live mutation.
    return inEventGroup(ScratchBlocks, () =>
        placeBlock(workspace, position, ScratchBlocks.Xml.domToBlock(xml, workspace), replacementBlockId), onGroup);
};

const setInputValue = ({ScratchBlocks, workspace, position, value, onGroup}) => {
    const target = fieldAtPosition(workspace, position);
    if (!target || !(target.field instanceof ScratchBlocks.FieldTextInput)) {
        throw new Error('This slot no longer accepts a literal value.');
    }
    inEventGroup(ScratchBlocks, () => target.field.setValue(value), onGroup);
};

const splitStack = ({ScratchBlocks, workspace, position}) => {
    const connection = resolveConnection(workspace, position);
    const tail = connection && connection.targetBlock();
    if (!tail || !tail.previousConnection || connection.type !== 3) return null;
    inEventGroup(ScratchBlocks, () => {
        connection.disconnect();
        tail.moveBy(32, 48);
    });
    return tail;
};

const detachedStackPosition = (workspace, position, verticalGap = 50) => {
    if (position && position.kind === 'workspace' &&
        Number.isFinite(position.x) && Number.isFinite(position.y)) {
        return {...position};
    }
    if (!position || position.kind !== 'gap') return null;
    const connection = resolveConnection(workspace, position);
    const anchor = position.blockId && workspace.getBlockById(position.blockId);
    // An occupied statement gap belongs to splitStack. This fallback exists
    // only for the insertion point after a real stack tail.
    if (!anchor || !connection || connection.type !== 3 || connection.targetBlock()) return null;
    // A detached script belongs to the complete script which owns this tail,
    // not to the tail's local indentation inside a C mouth. Use the native
    // top-level root for both axes so the new script starts below and flush
    // left with the script the user has just finished.
    const root = anchor.getRootBlock();
    const xy = root.getRelativeToSurfaceXY();
    const size = root.getHeightWidth();
    if (!xy || !size || !Number.isFinite(xy.x) || !Number.isFinite(xy.y) ||
        !Number.isFinite(size.height)) return null;
    return {kind: 'workspace', x: xy.x, y: xy.y + size.height + verticalGap};
};

const removeBlock = ({ScratchBlocks, workspace, position}) => {
    const block = workspace.getBlockById(position.blockId);
    if (!block || block.isShadow() || !block.isDeletable()) return false;
    inEventGroup(ScratchBlocks, () => block.dispose(true));
    return true;
};

export {accepts, detachedStackPosition, inEventGroup, insertBlock, placeBlock, removeBlock, setInputValue, splitStack};
