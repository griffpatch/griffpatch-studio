import {
    compileHistoryPresentationPlan
} from '../../src/studio/bridge/history-presentation-plan';

const location = (parentId, inputName = null, coordinate = null) => ({parentId, inputName, coordinate});

const lifecycleTransaction = destination => ({events: [{
    type: 'create',
    blockId: 'created',
    details: {xml: '<block type="motion_movesteps"/>', ids: ['created', 'owned-shadow']}
}, {
    type: 'move',
    blockId: 'created',
    details: {
        oldLocation: location(null, null, {x: 600, y: 300}),
        newLocation: destination
    }
}]});

test('deletion reverses to an arrival and retains the complete owned graph', () => {
    const transaction = {events: [{type: 'delete',
        blockId: 'root',
        details: {
            oldXml: '<block type="operator_add"/>', ids: ['root', 'nested', 'shadow']
        }}]};
    for (const [direction, kind] of [['forward', 'exit'], ['backward', 'enter']]) {
        expect(compileHistoryPresentationPlan(transaction, direction).lifecycles).toEqual([
            expect.objectContaining({blockId: 'root', blockIds: ['root', 'nested', 'shadow'], kind})
        ]);
    }
});

test('uses the final connected reference rather than the pickup reference for a regenerated creation', () => {
    const transaction = lifecycleTransaction(location('parent', 'NUM1'));
    transaction.events[0].blockRef = {ancestorId: 'created', path: []};
    transaction.events[1].blockRef = {ancestorId: 'parent', path: [{kind: 'input', name: 'NUM1'}]};
    for (const direction of ['forward', 'backward']) {
        expect(compileHistoryPresentationPlan(transaction, direction).lifecycles[0].blockRef)
            .toBe(transaction.events[1].blockRef);
    }
});

test.each([
    ['append', location('parent'), {x: 0, y: 24, kind: 'append'}],
    ['input', location('parent', 'NUM1'), {x: 40, y: 24, kind: 'input'}],
    ['detached', location(null, null, {x: 320, y: 180}), {x: 40, y: 24, kind: 'detached'}]
])('plans symmetric %s lifecycle motion for Redo and Undo', (name, destination, offset) => {
    const transaction = lifecycleTransaction(destination);
    expect(compileHistoryPresentationPlan(transaction, 'forward').lifecycles[0]).toMatchObject({
        blockId: 'created', kind: 'enter', offset, sourceCoordinate: {x: 600, y: 300}
    });
    expect(compileHistoryPresentationPlan(transaction, 'backward').lifecycles[0]).toMatchObject({
        blockId: 'created', kind: 'exit', offset
    });
});

test('classifies a middle-stack insertion from its induced lower-stack connection', () => {
    const transaction = lifecycleTransaction(location('parent'));
    transaction.events.push({
        type: 'move',
        blockId: 'lower-stack',
        details: {
            oldLocation: location('parent'),
            newLocation: location('created')
        }
    });

    expect(compileHistoryPresentationPlan(transaction, 'forward').lifecycles[0].offset)
        .toEqual({x: 40, y: 0, kind: 'insert'});
});

test('plans reporter replacement as one parallel lifecycle and ignores the induced shadow', () => {
    const transaction = lifecycleTransaction(location('outer-add', 'NUM1'));
    transaction.events.splice(1, 0, {
        type: 'delete',
        blockId: 'old-shadow',
        details: {oldXml: '<shadow type="math_number"/>', ids: ['old-shadow']}
    });

    const plan = compileHistoryPresentationPlan(transaction, 'forward');
    expect(plan.lifecycles.map(lifecycle => lifecycle.blockId)).toEqual(['created']);
    expect(plan.lifecycles[0].blockIds).toEqual(['created', 'owned-shadow']);
    expect(plan.parallelLifecycle).toBe(true);
});

test('uses the same dominant move identity for both presentation directions', () => {
    const topLevel = location(null, null, {x: 420, y: 180});
    const transaction = {events: [{
        type: 'move', blockId: 'third', details: {oldLocation: location('second'), newLocation: topLevel}
    }, {
        type: 'move', blockId: 'fourth', details: {oldLocation: location('third'), newLocation: location('second')}
    }, {
        type: 'move', blockId: 'third', details: {oldLocation: topLevel, newLocation: location('first')}
    }]};

    expect(compileHistoryPresentationPlan(transaction, 'forward')).toMatchObject({
        moveOnly: true,
        primaryMoveBlockId: 'third',
        lifecycles: []
    });
    expect(compileHistoryPresentationPlan(transaction, 'backward').primaryMoveBlockId).toBe('third');
});

test('moving a reporter between inputs animates the reporter, never its replacement shadows', () => {
    const transaction = {events: [{
        type: 'move',
        blockId: 'reporter',
        gesture: {blockId: 'reporter'},
        details: {oldLocation: location('outer', 'NUM1'), newLocation: location('outer', 'NUM2')}
    }, {
        type: 'create', blockId: 'old-slot', details: {xml: '<shadow type="math_number"/>', ids: ['old-slot']}
    }, {
        type: 'delete', blockId: 'new-slot', details: {oldXml: '<shadow type="math_number"/>', ids: ['new-slot']}
    }]};
    for (const direction of ['forward', 'backward']) {
        expect(compileHistoryPresentationPlan(transaction, direction)).toMatchObject({
            moveOnly: true, primaryMoveBlockId: 'reporter', lifecycles: []
        });
    }
});
