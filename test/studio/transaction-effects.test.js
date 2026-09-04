import {
    analyzeTransactionEffects,
    compactAdjacentMoves
} from '../../src/studio/replay/transaction-effects';

const location = (parentId, inputName = null, coordinate = null) => ({parentId, inputName, coordinate});

const move = (blockId, oldLocation, newLocation, extra = {}) => ({
    type: 'move',
    blockId,
    blockType: extra.blockType || 'motion_movesteps',
    blockRef: extra.blockRef || {ancestorId: blockId, path: []},
    details: {oldLocation, newLocation}
});

test('models a flyout create and connection as one reversible lifecycle effect', () => {
    const transaction = {events: [{
        type: 'create',
        blockId: 'created',
        details: {xml: '<block type="motion_movesteps"/>', ids: ['created', 'shadow']}
    }, move('created', location(null, null, {x: 600, y: 300}), location('hat'))]};

    const forward = analyzeTransactionEffects(transaction, 'forward');
    expect(forward.lifecycles).toEqual([expect.objectContaining({
        blockId: 'created',
        blockIds: ['created', 'shadow'],
        kind: 'enter'
    })]);
    expect(forward.survivingMoves).toEqual([expect.objectContaining({
        blockId: 'created',
        destination: location('hat')
    })]);

    const backward = analyzeTransactionEffects(transaction, 'backward');
    expect(backward.lifecycles).toEqual([expect.objectContaining({blockId: 'created', kind: 'exit'})]);
    expect(backward.presence.get('shadow')).toBe(false);
    expect(backward.survivingMoves).toEqual([]);
    expect(backward.replayEvents.map(event => event.type)).toEqual(['create']);
});

test('resolves a backward flyout exit from the final forward move reference', () => {
    const pickupReference = {
        ancestorId: 'created',
        ancestorType: 'sensing_touchingobject',
        ancestorCoordinate: {x: 500, y: 300},
        path: []
    };
    const connectedReference = {
        ancestorId: 'wait-until',
        ancestorType: 'control_wait_until',
        ancestorCoordinate: {x: 300, y: 200},
        path: [{kind: 'input', name: 'CONDITION'}]
    };
    const pickup = location(null, null, {x: 500, y: 300});
    const approach = location(null, null, {x: 340, y: 240});
    const transaction = {events: [{
        type: 'create',
        blockId: 'created',
        details: {xml: '<block type="sensing_touchingobject"/>', ids: ['created', 'menu-shadow']}
    }, move('created', pickup, approach, {blockRef: pickupReference}), move(
        'created',
        approach,
        location('wait-until', 'CONDITION'),
        {blockRef: connectedReference}
    )]};

    const backward = analyzeTransactionEffects(transaction, 'backward');

    expect(backward.lifecycles).toEqual([expect.objectContaining({
        blockId: 'created',
        kind: 'exit',
        blockRef: connectedReference
    })]);
});

test('identifies the dragged command separately from an induced healed neighbour', () => {
    const topLevel = location(null, null, {x: 420, y: 180});
    const transaction = {events: [
        move('third', location('second'), topLevel),
        move('fourth', location('third'), location('second')),
        move('third', topLevel, location('first'))
    ]};

    const forward = analyzeTransactionEffects(transaction, 'forward');
    expect(forward.primaryMove).toMatchObject({
        blockId: 'third',
        source: location('second'),
        destination: location('first'),
        eventCount: 2
    });
    expect(forward.primaryAmbiguous).toBe(false);
    expect(forward.moves[1]).toMatchObject({
        blockId: 'fourth',
        source: location('third'),
        destination: location('second')
    });

    const backward = analyzeTransactionEffects(transaction, 'backward');
    expect(backward.primaryMove).toMatchObject({
        blockId: 'third',
        source: location('first'),
        destination: location('second')
    });
});

test('uses the gesture detach phase to identify an equal-count two-block reorder', () => {
    const topLevel = location(null, null, {x: 260, y: 180});
    const transaction = {events: [
        move('bottom', location('top'), topLevel),
        move('top', topLevel, location('bottom'))
    ]};

    const effects = analyzeTransactionEffects(transaction, 'forward');
    expect(effects.primaryMove).toMatchObject({
        blockId: 'bottom',
        source: location('top'),
        destination: topLevel,
        destinationCoordinateIsGesturePickup: true
    });
    expect(effects.primaryAmbiguous).toBe(false);
});

test('authoritative native pickup identity overrides induced-move event order in both directions', () => {
    const transaction = {events: [
        move('neighbour', location('picked-up'), location(null, null, {x: 200, y: 200})),
        move('picked-up', location(null, null, {x: 200, y: 150}), location('neighbour'))
    ]};
    transaction.events[0].gesture = {
        source: 'scratch-blocks-drag', blockId: 'picked-up', blockIds: ['picked-up', 'neighbour']
    };
    for (const direction of ['forward', 'backward']) {
        const effects = analyzeTransactionEffects(transaction, direction);
        expect(effects.primaryMove.blockId).toBe('picked-up');
        expect(effects.primaryAmbiguous).toBe(false);
        expect(effects.recordedGesture.blockId).toBe('picked-up');
    }
});

test('keeps the final top-level coordinate durable when drag noise includes a later free move', () => {
    const pickup = location(null, null, {x: 260, y: 276});
    const destination = location(null, null, {x: 260, y: 180});
    const transaction = {events: [
        move('bottom', location('top'), pickup),
        move('bottom', pickup, destination),
        move('top', location(null, null, {x: 260, y: 228}), location('bottom'))
    ]};

    const effects = analyzeTransactionEffects(transaction, 'forward');
    expect(effects.primaryMove).toMatchObject({
        blockId: 'bottom',
        source: location('top'),
        destination,
        eventCount: 2,
        topLevelPrepend: true,
        destinationCoordinateIsGesturePickup: false
    });
    expect(effects.primaryAmbiguous).toBe(false);
});

test('identifies a former root inserted into its own tail instead of the induced top-level remainder', () => {
    const oldRoot = location(null, null, {x: 308, y: 175});
    const stationaryRemainder = location(null, null, {x: 308, y: 223});
    const transaction = {events: [
        move('point', location('turn-left'), stationaryRemainder, {blockType: 'motion_pointindirection'}),
        move('turn-left', oldRoot, location('go-to'), {blockType: 'motion_turnleft'}),
        move('glide', location('go-to'), location('turn-left'), {blockType: 'motion_glidesecstoxy'})
    ]};

    const forward = analyzeTransactionEffects(transaction, 'forward');
    expect(forward.primaryMove).toMatchObject({
        blockId: 'turn-left',
        source: oldRoot,
        destination: location('go-to'),
        topLevelPrepend: false,
        destinationCoordinateIsGesturePickup: false
    });
    expect(forward.moves.find(candidate => candidate.blockId === 'point')).toMatchObject({
        destination: stationaryRemainder,
        topLevelPrepend: false,
        destinationCoordinateIsGesturePickup: false
    });
    expect(forward.primaryAmbiguous).toBe(false);

    expect(analyzeTransactionEffects(transaction, 'backward').primaryMove).toMatchObject({
        blockId: 'turn-left',
        source: location('go-to'),
        destination: oldRoot
    });
});

test('prefers an explicit pickup-and-drop pair over an apparent induced insertion', () => {
    const transaction = {events: [
        move('dragged', location('top'), location(null)),
        move('remainder', location('dragged'), location('top')),
        move('dragged', location(null), location('remainder'))
    ]};

    expect(analyzeTransactionEffects(transaction, 'forward').primaryMove).toMatchObject({
        blockId: 'dragged',
        eventCount: 2,
        destination: location('remainder')
    });
    expect(analyzeTransactionEffects(transaction, 'backward').primaryMove).toMatchObject({
        blockId: 'dragged',
        eventCount: 2,
        destination: location('top')
    });
});

test('keeps a nested reporter and owned shadows together but marks replaced shadows as induced', () => {
    const transaction = {events: [{
        type: 'create',
        blockId: 'inner-add',
        details: {
            xml: '<block type="operator_add"/>',
            ids: ['inner-add', 'inner-left-shadow', 'inner-right-shadow']
        }
    }, {
        type: 'delete',
        blockId: 'outer-shadow',
        details: {oldXml: '<shadow type="math_number"/>', ids: ['outer-shadow']}
    }, move(
        'inner-add',
        location(null, null, {x: 700, y: 300}),
        location('outer-add', 'NUM1')
    )]};

    const effects = analyzeTransactionEffects(transaction, 'forward');
    expect(effects.lifecycles).toEqual([
        expect.objectContaining({
            blockId: 'inner-add',
            blockIds: ['inner-add', 'inner-left-shadow', 'inner-right-shadow'],
            kind: 'enter',
            isShadow: false
        }),
        expect.objectContaining({blockId: 'outer-shadow', kind: 'exit', isShadow: true})
    ]);
    expect(effects.primaryMove).toMatchObject({
        blockId: 'inner-add',
        destination: location('outer-add', 'NUM1')
    });
});

test('compacts split drag queues before selecting durable source and destination', () => {
    const topLevel = location(null, null, {x: 600, y: 300});
    const events = [
        move('duplicate', location('source-parent'), topLevel),
        move('duplicate', topLevel, location('destination-parent'), {
            blockRef: {ancestorId: 'stack', path: [{kind: 'next'}, {kind: 'next'}]}
        })
    ];

    expect(compactAdjacentMoves(events)).toHaveLength(1);
    expect(analyzeTransactionEffects({events}, 'forward').primaryMove).toMatchObject({
        blockId: 'duplicate',
        source: location('source-parent'),
        destination: location('destination-parent'),
        blockRef: {ancestorId: 'stack', path: [{kind: 'next'}, {kind: 'next'}]}
    });
});

test('rejects an invalid traversal direction before any consumer can mutate state', () => {
    expect(() => analyzeTransactionEffects({events: []}, 'sideways'))
        .toThrow('Unknown transaction direction: sideways');
});
