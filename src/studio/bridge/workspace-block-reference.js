const connectedInputName = (parent, child) => {
    const input = parent.inputList && parent.inputList.find(candidate =>
        candidate.connection && typeof candidate.connection.targetBlock === 'function' &&
        candidate.connection.targetBlock() === child
    );
    return input && input.name;
};

const roundedCoordinate = block => {
    const coordinate = block.getRelativeToSurfaceXY && block.getRelativeToSurfaceXY();
    return coordinate ? {x: Math.round(coordinate.x), y: Math.round(coordinate.y)} : null;
};

// Older Blockly XML loads truncated fractional VM coordinates, whereas SB3
// checkpoints round them. A regenerated ID may therefore differ by one unit on
// either axis. Consider the whole bounded candidate set, never the nearest block:
// two plausible roots must fail closed even if one has the exact coordinate.
const sameSerializedCoordinate = (left, right) => Boolean(left && right &&
    Math.abs(left.x - right.x) <= 1 && Math.abs(left.y - right.y) <= 1);

const aliasFor = (aliases, blockId) => aliases && (
    typeof aliases.get === 'function' ? aliases.get(blockId) : aliases[blockId]
);

/**
 * Describe a block by its root identity, semantic root location and connection
 * path. Scratch may regenerate all IDs after loading a checkpoint, while the
 * type/coordinate/path locator remains stable at the replay boundary.
 *
 * @param {object} workspace Scratch Blocks workspace
 * @param {string} blockId current block ID
 * @returns {?object} portable workspace block reference
 */
const createWorkspaceBlockReference = (workspace, blockId) => {
    let block = workspace.getBlockById && workspace.getBlockById(blockId);
    if (!block) return null;
    const path = [];
    while (block.getParent && block.getParent()) {
        const parent = block.getParent();
        const inputName = connectedInputName(parent, block);
        if (inputName) {
            path.unshift({kind: 'input', name: inputName});
        } else if (parent.getNextBlock && parent.getNextBlock() === block) {
            path.unshift({kind: 'next'});
        } else {
            return null;
        }
        block = parent;
    }
    return {
        ancestorId: block.id,
        ancestorType: block.type,
        ancestorCoordinate: roundedCoordinate(block),
        path
    };
};

const resolveWorkspaceBlockId = (
    workspace,
    reference,
    fallbackId,
    {excludedBlockIds = null, aliases = null} = {}
) => {
    if (!reference) return fallbackId;
    const aliasedAncestorId = aliasFor(aliases, reference.ancestorId) || reference.ancestorId;
    let block = workspace.getBlockById && workspace.getBlockById(aliasedAncestorId);
    // IDs can be reused after checkpoint restoration or after authoring a new
    // branch. A matching string is not sufficient evidence that this is still
    // the recorded ancestor.
    if (block && reference.ancestorType && block.type !== reference.ancestorType) block = null;
    if (!block && workspace.getTopBlocks) {
        const candidates = workspace.getTopBlocks(false).filter(candidate =>
            candidate.type === reference.ancestorType &&
            sameSerializedCoordinate(roundedCoordinate(candidate), reference.ancestorCoordinate)
        );
        if (candidates.length === 1) block = candidates[0];
    }
    if (!block) return fallbackId;
    const path = reference.path || (reference.inputPath || []).map(name => ({kind: 'input', name}));
    const excludeFromStatementPath = candidate => {
        while (candidate) {
            if (!excludedBlockIds || !excludedBlockIds.has(candidate.id)) return candidate;
            candidate = candidate.getNextBlock && candidate.getNextBlock();
        }
        return candidate;
    };
    for (const step of path) {
        if (step.kind === 'next') {
            block = excludeFromStatementPath(block.getNextBlock && block.getNextBlock());
        } else {
            const input = block.getInput && block.getInput(step.name);
            block = excludeFromStatementPath(input && input.connection && input.connection.targetBlock());
        }
        if (!block) return fallbackId;
    }
    return block.id;
};

/**
 * Resolve the block occupying a recorded directional location. Unlike a
 * blockRef captured after the gesture, this remains valid when replay starts
 * from the inverse topology.
 *
 * @param {object} workspace Scratch Blocks workspace
 * @param {?object} location recorded parent/input or top-level coordinate
 * @param {Map|object} [aliases] recorded-to-live IDs already resolved in this transaction
 * @returns {?object} live workspace block at that location
 */
const blockAtWorkspaceLocation = (workspace, location, aliases = new Map()) => {
    if (!location) return null;
    if (location.parentId) {
        const parentId = aliasFor(aliases, location.parentId) ||
            resolveWorkspaceBlockId(workspace, location.parentRef, null, {aliases}) ||
            (workspace.getBlockById(location.parentId) ? location.parentId : null);
        const parent = workspace.getBlockById(parentId);
        if (!parent) return null;
        if (location.inputName) {
            const input = parent.getInput && parent.getInput(location.inputName);
            return (input && input.connection && input.connection.targetBlock()) || null;
        }
        return parent.getNextBlock && parent.getNextBlock();
    }
    if (!location.coordinate || !workspace.getTopBlocks) return null;
    const candidates = workspace.getTopBlocks(false).filter(candidate => {
        const point = candidate.getRelativeToSurfaceXY && candidate.getRelativeToSurfaceXY();
        return point && Math.abs(point.x - location.coordinate.x) < 1 &&
            Math.abs(point.y - location.coordinate.y) < 1;
    });
    return candidates.length === 1 ? candidates[0] : null;
};

export {
    blockAtWorkspaceLocation,
    connectedInputName,
    createWorkspaceBlockReference,
    resolveWorkspaceBlockId
};
