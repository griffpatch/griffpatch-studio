import {blocksInRange, entireSiblingRange, extendBlockRange, rangeDeletionPosition, rangeFor, siblingChain} from
    '../../../src/experiments/keyboard-authoring/block-range';

const statement = id => ({
    id,
    outputConnection: null,
    previousConnection: {},
    nextConnection: {},
    isShadow: () => false,
    isMovable: () => true,
    isDeletable: () => true,
    getRelativeToSurfaceXY: () => ({x: 10, y: 20})
});

const chain = ids => {
    const blocks = ids.map(statement);
    blocks.forEach((block, index) => {
        block.getPreviousBlock = () => blocks[index - 1] || null;
        block.getNextBlock = () => blocks[index + 1] || null;
    });
    return blocks;
};

const workspace = blocks => ({getBlockById: id => blocks.find(block => block.id === id)});

test('a range is the exact contiguous slice between two sibling statements', () => {
    const blocks = chain(['a', 'b', 'c', 'd']);
    const ws = workspace(blocks);
    expect(siblingChain(blocks[2]).map(block => block.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(rangeFor(ws, 'b', 'd')).toEqual({
        anchorBlockId: 'b', focusBlockId: 'd', blockIds: ['b', 'c', 'd']
    });
    expect(rangeFor(ws, 'd', 'b')).toEqual({
        anchorBlockId: 'd', focusBlockId: 'b', blockIds: ['b', 'c', 'd']
    });
});

test('shift navigation grows, shrinks, and reverses around a stable anchor', () => {
    const blocks = chain(['a', 'b', 'c', 'd']);
    const ws = workspace(blocks);
    let range = extendBlockRange(ws, null, 'b', 1);
    expect(range.blockIds).toEqual(['b', 'c']);
    range = extendBlockRange(ws, range, 'c', 1);
    expect(range.blockIds).toEqual(['b', 'c', 'd']);
    range = extendBlockRange(ws, range, 'd', -1);
    expect(range.blockIds).toEqual(['b', 'c']);
    range = extendBlockRange(ws, range, 'c', -1);
    expect(range).toBeNull();
    range = extendBlockRange(ws, range, 'b', -1);
    expect(range.blockIds).toEqual(['a', 'b']);
    expect(range.focusBlockId).toBe('a');
});

test('structural select all owns exactly the current sibling statement chain', () => {
    const outer = chain(['if', 'after']);
    const body = chain(['inside-1', 'inside-2', 'inside-3']);
    body[0].getPreviousBlock = () => outer[0];
    const ws = workspace([...outer, ...body]);
    expect(entireSiblingRange(ws, 'inside-2')).toEqual({
        anchorBlockId: 'inside-1', focusBlockId: 'inside-3', blockIds: ['inside-1', 'inside-2', 'inside-3']
    });
    expect(entireSiblingRange(ws, 'if')).toEqual({
        anchorBlockId: 'if', focusBlockId: 'after', blockIds: ['if', 'after']
    });
});

test('structural select all leaves a single statement selected and rejects reporters or shadows', () => {
    const single = chain(['only'])[0];
    const reporter = {...statement('round'), outputConnection: {}};
    const shadow = {...statement('shadow'), isShadow: () => true};
    reporter.getPreviousBlock = reporter.getNextBlock = () => null;
    shadow.getPreviousBlock = shadow.getNextBlock = () => null;
    const ws = workspace([single, reporter, shadow]);
    expect(entireSiblingRange(ws, 'only')).toEqual({
        anchorBlockId: 'only', focusBlockId: 'only', blockIds: ['only']
    });
    expect(entireSiblingRange(ws, 'round')).toBeNull();
    expect(entireSiblingRange(ws, 'shadow')).toBeNull();
});

test('ranges do not cross between an outer stack and a C-mouth body', () => {
    const outer = chain(['if', 'after']);
    const body = chain(['inside-1', 'inside-2']);
    body[0].getPreviousBlock = () => outer[0]; // Blockly exposes the C owner here.
    const all = [...outer, ...body];
    const ws = workspace(all);
    expect(rangeFor(ws, 'if', 'inside-1')).toBeNull();
    expect(extendBlockRange(ws, null, 'inside-2', 1)).toBeNull();
    expect(extendBlockRange(ws, null, 'if', 1).blockIds).toEqual(['if', 'after']);
});

test('reporters and shadows cannot become statement ranges', () => {
    const reporter = {...statement('round'), outputConnection: {}};
    const shadow = {...statement('shadow'), isShadow: () => true};
    reporter.getPreviousBlock = reporter.getNextBlock = () => null;
    shadow.getPreviousBlock = shadow.getNextBlock = () => null;
    const ws = workspace([reporter, shadow]);
    expect(rangeFor(ws, 'round', 'round')).toBeNull();
    expect(rangeFor(ws, 'shadow', 'shadow')).toBeNull();
});

test('range validation rejects a stale reordered selection', () => {
    const blocks = chain(['a', 'b', 'c']);
    const ws = workspace(blocks);
    expect(blocksInRange(ws, {
        anchorBlockId: 'a', focusBlockId: 'c', blockIds: ['a', 'c', 'b']
    })).toEqual([]);
});

test('deletion returns the exact healed insertion boundary', () => {
    const blocks = chain(['a', 'b', 'c', 'd']);
    const ws = workspace(blocks);
    expect(rangeDeletionPosition(ws, rangeFor(ws, 'b', 'c'))).toEqual({kind: 'gap', blockId: 'a'});
    expect(rangeDeletionPosition(ws, rangeFor(ws, 'b', 'c'), {backwards: true}))
        .toEqual({kind: 'block', blockId: 'a'});
    expect(rangeDeletionPosition(ws, rangeFor(ws, 'a', 'b'))).toEqual({kind: 'before', blockId: 'c'});
});

test('deletion at the start of a C mouth stays inside its incoming statement connection', () => {
    const owner = statement('repeat');
    const body = chain(['inside-a', 'inside-b', 'inside-c']);
    const incoming = {getSourceBlock: () => owner};
    body[0].previousConnection = {targetConnection: incoming};
    body[0].getPreviousBlock = () => owner;
    owner.getNextBlock = () => null;
    owner.inputList = [{name: 'SUBSTACK', connection: incoming}];
    const ws = workspace([owner, ...body]);
    const range = rangeFor(ws, 'inside-a', 'inside-b');
    expect(rangeDeletionPosition(ws, range)).toEqual({kind: 'before', blockId: 'inside-c'});
    expect(rangeDeletionPosition(ws, range, {backwards: true})).toEqual({kind: 'block', blockId: 'repeat'});

    body[1].getNextBlock = () => null;
    expect(rangeDeletionPosition(ws, rangeFor(ws, 'inside-a', 'inside-b')))
        .toEqual({kind: 'input', blockId: 'repeat', inputName: 'SUBSTACK'});
});
