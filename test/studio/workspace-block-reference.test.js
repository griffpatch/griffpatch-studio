import {
    blockAtWorkspaceLocation,
    createWorkspaceBlockReference,
    resolveWorkspaceBlockId
} from '../../src/studio/bridge/workspace-block-reference';

test('finds regenerated blocks from the directional source topology', () => {
    const tail = {id: 'live-tail', type: 'motion_changexby'};
    const root = {
        id: 'live-root',
        type: 'motion_changexby',
        getNextBlock: () => tail,
        getRelativeToSurfaceXY: () => ({x: 591, y: 175})
    };
    const moving = {
        id: 'live-moving',
        type: 'motion_movesteps',
        getRelativeToSurfaceXY: () => ({x: 205, y: 285})
    };
    const blocks = new Map([[root.id, root], [moving.id, moving], [tail.id, tail]]);
    const workspace = {
        getBlockById: id => blocks.get(id) || null,
        getTopBlocks: () => [root, moving]
    };
    const rootRef = {
        ancestorId: 'recorded-root',
        ancestorType: 'motion_changexby',
        ancestorCoordinate: {x: 591, y: 175},
        path: []
    };

    expect(blockAtWorkspaceLocation(workspace, {
        parentId: null,
        coordinate: {x: 205, y: 285}
    })).toBe(moving);
    expect(blockAtWorkspaceLocation(workspace, {
        parentId: 'recorded-root',
        parentRef: rootRef
    })).toBe(tail);
});

test('round-trips a regenerated nested shadow through ancestor input names', () => {
    const shadow = {id: 'shadow-old'};
    const reporter = {id: 'reporter'};
    const root = {id: 'root'};
    shadow.getParent = () => reporter;
    reporter.getParent = () => root;
    root.getParent = () => null;
    root.type = 'data_setvariableto';
    root.getRelativeToSurfaceXY = () => ({x: 120.4, y: 99.6});
    reporter.inputList = [{name: 'NUM', connection: {targetBlock: () => shadow}}];
    root.inputList = [{name: 'VALUE', connection: {targetBlock: () => reporter}}];

    const reference = createWorkspaceBlockReference({
        getBlockById: id => (id === shadow.id ? shadow : null)
    }, shadow.id);
    expect(reference).toEqual({
        ancestorId: 'root',
        ancestorType: 'data_setvariableto',
        ancestorCoordinate: {x: 120, y: 100},
        path: [{kind: 'input', name: 'VALUE'}, {kind: 'input', name: 'NUM'}]
    });

    const restoredShadow = {id: 'shadow-new'};
    const restoredReporter = {
        id: 'reporter-new',
        getInput: name => (name === 'NUM' ? {connection: {targetBlock: () => restoredShadow}} : null)
    };
    const restoredRoot = {
        id: 'root-new',
        type: 'data_setvariableto',
        getRelativeToSurfaceXY: () => ({x: 120, y: 100}),
        getInput: name => (name === 'VALUE' ? {connection: {targetBlock: () => restoredReporter}} : null)
    };
    expect(resolveWorkspaceBlockId({
        getBlockById: () => null,
        getTopBlocks: () => [restoredRoot]
    }, reference, shadow.id)).toBe('shadow-new');
});

test('does not trust a reused ancestor ID with the wrong block type', () => {
    const recycled = {id: 'recorded-root', type: 'argument_reporter_string_number'};
    const live = {
        id: 'live-root',
        type: 'motion_changexby',
        getRelativeToSurfaceXY: () => ({x: 120, y: 80})
    };
    const workspace = {
        getBlockById: id => (id === recycled.id ? recycled : (id === live.id ? live : null)),
        getTopBlocks: () => [live]
    };

    expect(resolveWorkspaceBlockId(workspace, {
        ancestorId: 'recorded-root',
        ancestorType: 'motion_changexby',
        ancestorCoordinate: {x: 120, y: 80},
        path: []
    }, null)).toBe('live-root');
});

test.each([[247, 146, 248, 147], [-247, -146, -248, -147]])(
    'resolves the bounded XML/SB3 rounding difference (%s, %s)', (x, y, liveX, liveY) => {
        const root = {id: 'live',
            type: 'event_whenflagclicked',
            getRelativeToSurfaceXY: () => ({x: liveX, y: liveY})};
        const workspace = {getBlockById: () => null, getTopBlocks: () => [root]};
        expect(resolveWorkspaceBlockId(workspace, {ancestorId: 'old',
            ancestorType: root.type,
            ancestorCoordinate: {x, y},
            path: []}, null)).toBe('live');
    });

test('rejects ambiguous and out-of-bounds coordinate compatibility matches', () => {
    const reference = {ancestorId: 'old',
        ancestorType: 'event_whenflagclicked',
        ancestorCoordinate: {x: 247, y: 146},
        path: []};
    const root = (id, x) => ({id,
        type: reference.ancestorType,
        getRelativeToSurfaceXY: () => ({x, y: 146})});
    const workspace = roots => ({getBlockById: () => null, getTopBlocks: () => roots});
    expect(resolveWorkspaceBlockId(workspace([root('exact', 247), root('near', 248)]), reference, null)).toBeNull();
    expect(resolveWorkspaceBlockId(workspace([root('distant', 249)]), reference, null)).toBeNull();
});
