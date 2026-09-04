import {blockRowMetrics, placementDeltaY} from '../../../src/experiments/keyboard-authoring/block-row-geometry';

const translate = (x, y) => ({a: 1, b: 0, c: 0, d: 1, e: x, f: y});
const node = (parentNode, attributes = {}, matrices = []) => ({parentNode,
    getAttribute: name => attributes[name] ?? null,
    transform: {baseVal: {numberOfItems: matrices.length, getItem: i => ({matrix: matrices[i]})}}});
const fixture = (centre = 24) => {
    const root = node(null, {}, [translate(999, 999)]);
    const fieldGroup = node(root, {}, [translate(12, centre - 16)]);
    const text = {...node(fieldGroup, {x: '8', y: '18', dy: '0'}), textContent: 'value'};
    const block = {constructor: {MIN_BLOCK_Y: 48, FIELD_TOP_PADDING: 2},
        getSvgRoot: () => root, getRelativeToSurfaceXY: () => ({x: 100, y: 80}),
        inputList: [{fieldRow: [{textElement_: text}]}]};
    return {block, text, root};
};

test.each([24, 48, 80])('reads the native middle baseline of a row centred at %s', centre => {
    const {block} = fixture(centre);
    expect(blockRowMetrics(block)).toEqual({baselineY: 80 + centre + 2, originY: 80 + centre - 24});
    expect(placementDeltaY(block, {y: 500, baselineY: 200})).toBe(200 - 80 - centre - 2);
});

test('uses renderer metrics rather than a fixed 48-unit row or hat offset', () => {
    const {block} = fixture();
    block.constructor = {MIN_BLOCK_Y: 64, FIELD_TOP_PADDING: 3};
    expect(blockRowMetrics(block)).toEqual({baselineY: 106, originY: 71});
});

test('reads only the block own first text row, ignoring image fields and nested reporter labels', () => {
    const {block} = fixture();
    block.inputList.unshift({fieldRow: [{}, {textElement_: {textContent: ''}}],
        connection: {targetBlock: () => { throw new Error('Must not walk nested children'); }}});
    expect(blockRowMetrics(block).baselineY).toBe(106);
});

test('textless, unrendered and detached fields fall back without guessing a baseline', () => {
    const {block, text} = fixture();
    expect(placementDeltaY(block, {y: 123})).toBe(123);
    text.parentNode = null;
    expect(blockRowMetrics(block)).toBeNull();
    expect(placementDeltaY(block, {y: 123, baselineY: 200})).toBe(123);
    expect(blockRowMetrics({})).toBeNull();
});
