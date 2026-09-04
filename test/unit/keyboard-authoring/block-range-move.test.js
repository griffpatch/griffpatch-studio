import {moveStatementRange, selectionPlan} from
    '../../../src/experiments/keyboard-authoring/block-range-move';
import {rangeFor} from '../../../src/experiments/keyboard-authoring/block-range';

const connection = source => ({
    source,
    targetConnection: null,
    getSourceBlock () {
        return this.source;
    },
    connect (other) {
        if (this.targetConnection || other.targetConnection) throw new Error('occupied connection');
        this.targetConnection = other;
        other.targetConnection = this;
    },
    disconnect () {
        const other = this.targetConnection;
        if (!other) throw new Error('disconnected connection');
        this.targetConnection = null;
        other.targetConnection = null;
    }
});

const block = (id, {up = true, down = true, x = 12, y = 24} = {}) => {
    const item = {
        id,
        outputConnection: null,
        previousConnection: null,
        nextConnection: null,
        xy: {x, y},
        isShadow: () => false,
        getRelativeToSurfaceXY () {
            return {...this.xy};
        },
        moveBy (dx, dy) {
            this.xy = {x: this.xy.x + dx, y: this.xy.y + dy};
        }
    };
    if (up) item.previousConnection = connection(item);
    if (down) item.nextConnection = connection(item);
    item.getPreviousBlock = () => item.previousConnection && item.previousConnection.targetConnection &&
        item.previousConnection.targetConnection.getSourceBlock();
    item.getNextBlock = () => item.nextConnection && item.nextConnection.targetConnection &&
        item.nextConnection.targetConnection.getSourceBlock();
    return item;
};

const graph = definitions => {
    const blocks = definitions.map((definition, index) => block(definition.id,
        {...definition, x: 20, y: 40 + (index * 32)}));
    blocks.slice(0, -1).forEach((item, index) => item.nextConnection.connect(blocks[index + 1].previousConnection));
    const workspace = {getBlockById: id => blocks.find(item => item.id === id)};
    return {blocks, workspace};
};

const ids = root => {
    const result = [];
    for (let current = root; current; current = current.getNextBlock()) result.push(current.id);
    return result;
};

const ScratchBlocks = () => {
    let group = 'outer';
    return {Events: {
        getGroup: () => group,
        setGroup: value => {
            group = value === true ? 'move-group' : value;
        }
    }};
};

test('moves a contiguous range one sibling down without replacing block identities', () => {
    const {blocks, workspace} = graph([{id: 'a'}, {id: 'b'}, {id: 'c'}, {id: 'd'}]);
    const range = rangeFor(workspace, 'b', 'c');
    const result = moveStatementRange({ScratchBlocks: ScratchBlocks(), workspace, blockId: 'c', range, direction: 1});
    expect(ids(blocks[0])).toEqual(['a', 'd', 'b', 'c']);
    expect(result.blockIds).toEqual(['b', 'c']);
    expect(result.range).toEqual({anchorBlockId: 'b', focusBlockId: 'c', blockIds: ['b', 'c']});
});

test('reuses the canonical moved range for repeated movement until its structural edge', () => {
    const {blocks, workspace} = graph([{id: 'a'}, {id: 'b'}, {id: 'c'}, {id: 'd'}, {id: 'e'}]);
    let result = moveStatementRange({
        ScratchBlocks: ScratchBlocks(),
        workspace,
        blockId: 'c',
        range: rangeFor(workspace, 'b', 'c'),
        direction: 1
    });
    expect(ids(blocks[0])).toEqual(['a', 'd', 'b', 'c', 'e']);
    expect(selectionPlan(workspace, result.focusBlockId, result.range).blocks).toEqual([blocks[1], blocks[2]]);

    result = moveStatementRange({
        ScratchBlocks: ScratchBlocks(),
        workspace,
        blockId: result.focusBlockId,
        range: result.range,
        direction: 1
    });
    expect(ids(blocks[0])).toEqual(['a', 'd', 'e', 'b', 'c']);
    expect(result.range.blockIds).toEqual(['b', 'c']);
    expect(moveStatementRange({
        ScratchBlocks: ScratchBlocks(),
        workspace,
        blockId: result.focusBlockId,
        range: result.range,
        direction: 1
    })).toBeNull();
    expect(ids(blocks[0])).toEqual(['a', 'd', 'e', 'b', 'c']);
});

test('moves a range up while keeping the top-level script at the same coordinate', () => {
    const {blocks, workspace} = graph([{id: 'a'}, {id: 'b'}, {id: 'c'}, {id: 'd'}]);
    const rootXY = blocks[0].getRelativeToSurfaceXY();
    const result = moveStatementRange({
        ScratchBlocks: ScratchBlocks(),
        workspace,
        blockId: 'c',
        range: rangeFor(workspace, 'b', 'c'),
        direction: -1
    });
    expect(ids(blocks[1])).toEqual(['b', 'c', 'a', 'd']);
    expect(blocks[1].getRelativeToSurfaceXY()).toEqual(rootXY);
    expect(result.focusBlockId).toBe('c');
});

test('moves a single selected command and refuses script ends or impossible hat/cap swaps', () => {
    const {blocks, workspace} = graph([{id: 'a'}, {id: 'b'}, {id: 'c'}, {id: 'd'}]);
    expect(moveStatementRange({ScratchBlocks: ScratchBlocks(), workspace, blockId: 'b', direction: 1}).blockIds)
        .toEqual(['b']);
    expect(ids(blocks[0])).toEqual(['a', 'c', 'b', 'd']);
    expect(moveStatementRange({ScratchBlocks: ScratchBlocks(), workspace, blockId: 'a', direction: -1}))
        .toBeNull();

    const hatGraph = graph([{id: 'hat', up: false}, {id: 'command'}, {id: 'cap', down: false}]);
    expect(moveStatementRange({ScratchBlocks: ScratchBlocks(), workspace: hatGraph.workspace,
        blockId: 'hat', direction: 1})).toBeNull();
    expect(moveStatementRange({ScratchBlocks: ScratchBlocks(), workspace: hatGraph.workspace,
        blockId: 'cap', direction: -1})).toBeNull();
    expect(ids(hatGraph.blocks[0])).toEqual(['hat', 'command', 'cap']);
});

test('a plan accepts only the exact current sibling slice', () => {
    const {workspace} = graph([{id: 'a'}, {id: 'b'}, {id: 'c'}]);
    expect(selectionPlan(workspace, 'b', null).blocks.map(item => item.id)).toEqual(['b']);
    expect(selectionPlan(workspace, 'b', {
        anchorBlockId: 'a', focusBlockId: 'c', blockIds: ['a', 'c', 'b']
    })).toBeNull();
});
