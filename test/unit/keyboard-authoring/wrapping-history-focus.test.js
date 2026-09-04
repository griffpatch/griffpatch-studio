import {wrappingHistoryFocus} from
    '../../../src/experiments/keyboard-authoring/wrapping-history-focus';

const statementChain = ids => {
    const blocks = ids.map(id => ({
        id,
        outputConnection: null,
        previousConnection: {},
        nextConnection: {},
        isShadow: () => false
    }));
    blocks.forEach((block, index) => {
        block.getPreviousBlock = () => blocks[index - 1] || null;
        block.getNextBlock = () => blocks[index + 1] || null;
    });
    return blocks;
};

const workspace = blocks => ({getBlockById: id => blocks.find(block => block.id === id)});
const record = {
    wrapperId: 'wrapper',
    range: {anchorBlockId: 'a', focusBlockId: 'b', blockIds: ['a', 'b']},
    state: 'wrapped'
};

test('restores the original exact range when native Undo removes its wrapper', () => {
    const blocks = statementChain(['a', 'b', 'after']);
    expect(wrappingHistoryFocus(workspace(blocks), record)).toEqual({
        state: 'unwrapped',
        position: {kind: 'block', blockId: 'b'},
        range: record.range
    });
});

test('restores the wrapper first input when native Redo recreates it', () => {
    const wrapper = {
        id: 'wrapper',
        inputList: [{
            name: 'CONDITION',
            fieldRow: [],
            connection: {type: 1, targetBlock: () => null}
        }]
    };
    expect(wrappingHistoryFocus(workspace([wrapper]), record)).toEqual({
        state: 'wrapped',
        position: {kind: 'input', blockId: 'wrapper', inputName: 'CONDITION'},
        range: null
    });
});

test('waits while a native event batch exposes neither complete topology', () => {
    const blocks = statementChain(['a', 'elsewhere']);
    expect(wrappingHistoryFocus(workspace(blocks), record)).toBeNull();
});

test('restores reporter and wrapper block focus around expression wrapping history', () => {
    const source = {id: 'source', outputConnection: {targetConnection: {}}};
    const expressionRecord = {wrapperId: 'wrapper', sourceBlockId: 'source', state: 'wrapped'};
    expect(wrappingHistoryFocus(workspace([source]), expressionRecord)).toEqual({
        state: 'unwrapped',
        position: {kind: 'block', blockId: 'source'},
        range: null
    });
    expect(wrappingHistoryFocus(workspace([{id: 'wrapper'}]), expressionRecord)).toEqual({
        state: 'wrapped',
        position: {kind: 'block', blockId: 'wrapper'},
        range: null
    });
});
