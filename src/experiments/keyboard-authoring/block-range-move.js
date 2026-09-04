import {blocksInRange, rangeFor, siblingChain, statementBlock} from './block-range';
import {inEventGroup} from './operations';

const selectedStatements = (workspace, blockId, range) => {
    if (range) return blocksInRange(workspace, range);
    const block = workspace.getBlockById(blockId);
    return statementBlock(block) ? [block] : [];
};

const selectionPlan = (workspace, blockId, range) => {
    const blocks = selectedStatements(workspace, blockId, range);
    if (!blocks.length) return null;
    const chain = siblingChain(blocks[0]);
    const start = chain.findIndex(block => block.id === blocks[0].id);
    if (start < 0 || chain.slice(start, start + blocks.length)
        .some((block, index) => block.id !== blocks[index].id)) return null;
    return {blocks, chain, start, end: start + blocks.length - 1};
};

const moveRootTo = (block, xy) => {
    const current = block.getRelativeToSurfaceXY();
    const dx = xy.x - current.x;
    const dy = xy.y - current.y;
    if (dx || dy) block.moveBy(dx, dy);
};

const moveStatementRange = ({ScratchBlocks, workspace, blockId, range = null, direction, onGroup = null}) => {
    const plan = selectionPlan(workspace, blockId, range);
    if (!plan || ![-1, 1].includes(direction)) return null;
    const {blocks, chain, start, end} = plan;
    const first = blocks[0];
    const last = blocks[blocks.length - 1];
    const focusBlockId = range ? range.focusBlockId : first.id;
    const anchorBlockId = range && range.anchorBlockId;

    if (direction < 0) {
        const neighbour = chain[start - 1];
        // A hat has no upper connection and a cap has no lower connection;
        // neither can participate in a valid swap in this direction.
        if (!neighbour || !neighbour.previousConnection || !first.previousConnection || !last.nextConnection) {
            return null;
        }
        const rootXY = neighbour.getRelativeToSurfaceXY();
        const incoming = neighbour.previousConnection.targetConnection;
        const tailConnection = last.nextConnection.targetConnection;
        inEventGroup(ScratchBlocks, () => {
            if (tailConnection) last.nextConnection.disconnect();
            first.previousConnection.disconnect();
            if (incoming) neighbour.previousConnection.disconnect();
            if (tailConnection) neighbour.nextConnection.connect(tailConnection);
            last.nextConnection.connect(neighbour.previousConnection);
            if (incoming) incoming.connect(first.previousConnection);
            else moveRootTo(first, rootXY);
        }, onGroup);
    } else {
        const neighbour = chain[end + 1];
        if (!neighbour || !neighbour.nextConnection || !first.previousConnection || !last.nextConnection) {
            return null;
        }
        const rootXY = first.getRelativeToSurfaceXY();
        const incoming = first.previousConnection.targetConnection;
        const tailConnection = neighbour.nextConnection.targetConnection;
        inEventGroup(ScratchBlocks, () => {
            if (tailConnection) neighbour.nextConnection.disconnect();
            last.nextConnection.disconnect();
            if (incoming) first.previousConnection.disconnect();
            if (tailConnection) last.nextConnection.connect(tailConnection);
            neighbour.nextConnection.connect(first.previousConnection);
            if (incoming) incoming.connect(neighbour.previousConnection);
            else moveRootTo(neighbour, rootXY);
        }, onGroup);
    }

    return {
        blockIds: blocks.map(block => block.id),
        focusBlockId,
        range: range ? rangeFor(workspace, anchorBlockId, focusBlockId) : null
    };
};

export {moveStatementRange, selectedStatements, selectionPlan};
