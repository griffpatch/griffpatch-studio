import {
    applyDataStateDelta,
    createDataStateDelta,
    createTargetPropertiesDelta
} from '../../src/studio/state/data-state-delta';

const makeState = ({score = 0, items = ['a', 'b', 'c', 'd']} = {}) => ({
    schemaVersion: 1,
    targets: [{
        targetRef: {isStage: true, name: 'Stage'},
        variables: {score},
        lists: {items},
        properties: {tempo: 60}
    }]
});

test('round-trips scalar and list data without mutating either boundary', () => {
    const before = makeState();
    const after = makeState({score: 30, items: ['a', 'c', 'd']});
    const delta = createDataStateDelta(before, after);

    expect(delta).toEqual({
        schemaVersion: 1,
        targets: [{
            targetRef: {isStage: true, name: 'Stage'},
            variables: {score: {before: 0, after: 30}},
            lists: {items: {index: 1, removed: ['b'], inserted: []}},
            properties: {}
        }]
    });
    expect(applyDataStateDelta(before, delta, 'forward')).toEqual(after);
    expect(applyDataStateDelta(after, delta, 'backward')).toEqual(before);
    expect(before.targets[0].lists.items).toEqual(['a', 'b', 'c', 'd']);
});

test('round-trips authored target properties', () => {
    const before = makeState();
    const after = makeState();
    after.targets[0].properties.tempo = 120;
    const delta = createDataStateDelta(before, after);

    expect(delta.targets[0]).toMatchObject({
        variables: {},
        lists: {},
        properties: {tempo: {before: 60, after: 120}}
    });
    expect(applyDataStateDelta(before, delta, 'forward')).toEqual(after);
    expect(applyDataStateDelta(after, delta, 'backward')).toEqual(before);
});

test('combines related sprite layer changes into one property delta', () => {
    expect(createTargetPropertiesDelta([{
        targetRef: {isStage: false, name: 'Sprite1'},
        before: {x: 0, layerOrder: 0},
        after: {x: 20, layerOrder: 1}
    }, {
        targetRef: {isStage: false, name: 'Sprite2'},
        before: {x: 50, layerOrder: 1},
        after: {x: 50, layerOrder: 0}
    }])).toEqual({
        schemaVersion: 1,
        targets: [{
            targetRef: {isStage: false, name: 'Sprite1'},
            variables: {},
            lists: {},
            properties: {
                x: {before: 0, after: 20},
                layerOrder: {before: 0, after: 1}
            }
        }, {
            targetRef: {isStage: false, name: 'Sprite2'},
            variables: {},
            lists: {},
            properties: {layerOrder: {before: 1, after: 0}}
        }]
    });
});

test('stores only the changed middle of a large list', () => {
    const sharedTail = Array.from({length: 1000}, (unused, index) => `tail-${index}`);
    const before = makeState({items: ['header', 'remove-me', ...sharedTail]});
    const after = makeState({items: ['header', 'replacement', ...sharedTail]});

    expect(createDataStateDelta(before, after).targets[0].lists.items).toEqual({
        index: 1,
        removed: ['remove-me'],
        inserted: ['replacement']
    });
});

test('returns null when no authored data changed', () => {
    expect(createDataStateDelta(makeState(), makeState())).toBeNull();
});

test('rejects definition drift and list splices from the wrong state', () => {
    const changedDefinition = makeState();
    changedDefinition.targets[0].variables.other = 1;
    expect(() => createDataStateDelta(makeState(), changedDefinition))
        .toThrow('changed variable definitions');

    const delta = createDataStateDelta(makeState(), makeState({items: ['a', 'c', 'd']}));
    expect(() => applyDataStateDelta(makeState({items: ['a', 'wrong', 'c', 'd']}), delta, 'forward'))
        .toThrow('Cannot apply authored list splice at index 1');
});
