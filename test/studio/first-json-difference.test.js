import {firstJsonDifference} from '../../src/studio/validation/first-json-difference';

test('reports a stable path and compact values for the first JSON difference', () => {
    const expected = {targets: [{blocks: {a: {parent: null}}}]};
    const actual = {targets: [{blocks: {a: {parent: 'block-b'}}}]};

    expect(firstJsonDifference(expected, actual)).toEqual({
        path: '$.targets[0].blocks.a.parent',
        expected: null,
        actual: 'block-b'
    });
});

test('reports missing properties without returning their complete objects', () => {
    expect(firstJsonDifference({block: {id: 'a'}}, {})).toEqual({
        path: '$.block',
        expected: '{object}',
        actual: '[missing]'
    });
});

test('returns null for equivalent JSON values', () => {
    expect(firstJsonDifference({b: [1, 2], a: true}, {a: true, b: [1, 2]})).toBeNull();
});
