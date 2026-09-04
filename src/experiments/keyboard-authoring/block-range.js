const statementBlock = block => block && !block.isShadow() && !block.outputConnection &&
    (block.previousConnection || block.nextConnection);

const siblingChain = block => {
    if (!statementBlock(block)) return [];
    let first = block;
    const visited = new Set();
    while (first.getPreviousBlock && first.getPreviousBlock()) {
        if (visited.has(first.id)) return [];
        visited.add(first.id);
        const previous = first.getPreviousBlock();
        // Blockly calls a C block the previous block of the first command in
        // its statement input. It is the structural parent, not a sibling:
        // only a block whose native `next` points back to us belongs here.
        if (!previous.getNextBlock || previous.getNextBlock() !== first) break;
        first = previous;
    }
    const blocks = [];
    visited.clear();
    for (let current = first; current; current = current.getNextBlock && current.getNextBlock()) {
        if (!statementBlock(current) || visited.has(current.id)) return [];
        visited.add(current.id);
        blocks.push(current);
    }
    return blocks;
};

const rangeFor = (workspace, anchorBlockId, focusBlockId) => {
    const anchor = workspace.getBlockById(anchorBlockId);
    const focus = workspace.getBlockById(focusBlockId);
    if (!statementBlock(anchor) || !statementBlock(focus)) return null;
    const chain = siblingChain(anchor);
    const anchorIndex = chain.findIndex(block => block.id === anchor.id);
    const focusIndex = chain.findIndex(block => block.id === focus.id);
    if (anchorIndex < 0 || focusIndex < 0) return null;
    return {
        anchorBlockId: anchor.id,
        focusBlockId: focus.id,
        blockIds: chain.slice(Math.min(anchorIndex, focusIndex), Math.max(anchorIndex, focusIndex) + 1)
            .map(block => block.id)
    };
};

const entireSiblingRange = (workspace, blockId) => {
    let block = workspace.getBlockById(blockId);
    while (block && !statementBlock(block)) block = block.getParent && block.getParent();
    const chain = siblingChain(block);
    if (!chain.length) return null;
    return {
        anchorBlockId: chain[0].id,
        focusBlockId: chain[chain.length - 1].id,
        blockIds: chain.map(item => item.id)
    };
};

const extendBlockRange = (workspace, currentRange, currentBlockId, direction) => {
    const anchorBlockId = currentRange ? currentRange.anchorBlockId : currentBlockId;
    const focusBlockId = currentRange ? currentRange.focusBlockId : currentBlockId;
    const focus = workspace.getBlockById(focusBlockId);
    const chain = siblingChain(focus);
    const focusIndex = chain.findIndex(block => block.id === focusBlockId);
    const next = chain[focusIndex + direction];
    if (!next) return currentRange;
    const range = rangeFor(workspace, anchorBlockId, next.id);
    return range && range.blockIds.length > 1 ? range : null;
};

const blocksInRange = (workspace, range) => {
    if (!range || !Array.isArray(range.blockIds) || range.blockIds.length < 2) return [];
    const canonical = rangeFor(workspace, range.anchorBlockId, range.focusBlockId);
    if (!canonical || canonical.blockIds.join('\u0000') !== range.blockIds.join('\u0000')) return [];
    return canonical.blockIds.map(id => workspace.getBlockById(id));
};

const rangeDeletionPosition = (workspace, range, {backwards = false} = {}) => {
    const blocks = blocksInRange(workspace, range);
    if (!blocks.length) return null;
    const first = blocks[0];
    const previousBlock = first.getPreviousBlock && first.getPreviousBlock();
    const previous = previousBlock && previousBlock.getNextBlock && previousBlock.getNextBlock() === first ?
        previousBlock : null;
    const incoming = first.previousConnection && first.previousConnection.targetConnection;
    const owner = incoming && incoming.getSourceBlock();
    if (previous) return backwards ? {kind: 'block', blockId: previous.id} : {kind: 'gap', blockId: previous.id};
    const tail = blocks[blocks.length - 1].getNextBlock && blocks[blocks.length - 1].getNextBlock();
    if (backwards && owner) return {kind: 'block', blockId: owner.id};
    if (tail) return {kind: 'before', blockId: tail.id};
    if (owner) {
        const input = owner.inputList.find(item => item.connection === incoming);
        if (input) return {kind: 'input', blockId: owner.id, inputName: input.name};
    }
    const xy = first.getRelativeToSurfaceXY();
    return {kind: 'workspace', x: xy.x, y: xy.y};
};

export {blocksInRange, entireSiblingRange, extendBlockRange, rangeDeletionPosition, rangeFor, siblingChain,
    statementBlock};
