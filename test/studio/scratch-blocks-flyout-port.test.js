import {
    BLOCK_REVEAL_PADDING,
    PICKUP_DISTANCE_PX,
    categoryForBlock,
    createScratchBlocksFlyoutPort
} from '../../src/studio/bridge/native-interaction/scratch-blocks-flyout-port';

test('selects the category containing one type-unique flyout block', async () => {
    const block = {
        type: 'motion_movesteps',
        disabled: false,
        getRelativeToSurfaceXY: () => ({x: 20, y: 140}),
        getSvgRoot: () => ({getBoundingClientRect: () => ({width: 120, height: 40})})
    };
    const flyout = {
        horizontalLayout_: false,
        categoryScrollPositions: [
            {categoryId: 'motion', position: 0},
            {categoryId: 'looks', position: 300}
        ],
        scrollTarget: null,
        getWorkspace: () => ({getAllBlocks: () => [block]}),
        isScrollable: () => true,
        isDragTowardWorkspace: delta => delta.x > 0
    };
    const toolbox = {setSelectedCategoryById: jest.fn()};
    const workspace = {
        getFlyout: () => flyout,
        getToolbox: () => toolbox
    };
    const port = createScratchBlocksFlyoutPort({workspace});

    expect(categoryForBlock(flyout, block)).toMatchObject({categoryId: 'motion'});
    const prepared = await port.prepare({blockType: 'motion_movesteps'});

    expect(prepared).toMatchObject({flyout, block, category: {categoryId: 'motion'}});
    expect(toolbox.setSelectedCategoryById).toHaveBeenCalledWith('motion');
    expect(port.pickupPoint({flyout, start: {x: 70, y: 120}}))
        .toEqual({x: 70 + PICKUP_DISTANCE_PX, y: 120});
});

test('starts the target-workspace gesture through the contained flyout seam', () => {
    const gesture = {setStartBlock: jest.fn(), handleFlyoutStart: jest.fn()};
    const workspace = {getGesture: jest.fn(() => gesture)};
    const port = createScratchBlocksFlyoutPort({workspace});
    const block = {id: 'flyout-source'};
    const flyout = {};
    const event = {type: 'mousedown'};

    expect(port.beginGesture({flyout, block, event})).toBe(gesture);
    expect(gesture.setStartBlock).toHaveBeenCalledWith(block);
    expect(gesture.handleFlyoutStart).toHaveBeenCalledWith(event, flyout);
});

test('starts a recorded definition copy at its exact live source without visiting the palette', async () => {
    const copy = {id: 'copy'};
    let field = 'amount';
    const block = {id: 'live-argument',
        type: 'argument_reporter_string_number',
        isShadow: () => true,
        getField: () => ({getValue: () => field})};
    const gesture = {setStartBlock: jest.fn(), handleWsStart: jest.fn(), getDraggedBlock: () => copy};
    const workspace = {getBlockById: id => (id === block.id ? block : null), getGesture: () => gesture};
    const port = createScratchBlocksFlyoutPort({workspace,
        aliases: new Map([['recorded', block.id]]),
        ScratchBlocks: {Xml: {textToDom: () => ({childNodes: [{tagName: 'field',
            textContent: 'amount',
            getAttribute: name => (name === 'name' ? 'VALUE' : null)}]})}}});
    const plan = {origin: {kind: 'workspace-copy', blockId: 'recorded'},
        blockType: block.type,
        prototypeXml: '<block/>'};
    const prepared = await port.prepare(plan);
    expect(prepared).toEqual({block, sourceWorkspace: workspace, flyout: null, category: null});
    const event = {type: 'mousedown'};
    port.beginGesture({...prepared, event});
    expect(gesture.handleWsStart).toHaveBeenCalledWith(event, workspace);
    expect(port.createdBlock(gesture)).toBe(copy);
    field = 'other argument';
    await expect(port.prepare(plan)).rejects.toThrow('unavailable or changed');
});

test('waits for a naturally refreshing flyout before declaring a recorded block missing', async () => {
    const block = {
        type: 'data_setvariableto',
        disabled: false,
        getRelativeToSurfaceXY: () => ({x: 20, y: 140}),
        getSvgRoot: () => ({getBoundingClientRect: () => ({width: 150, height: 40})})
    };
    let reads = 0;
    const flyout = {
        horizontalLayout_: false,
        categoryScrollPositions: [{categoryId: 'variables', position: 100}],
        scrollTarget: null,
        getWorkspace: () => ({getAllBlocks: () => (++reads > 2 ? [block] : [])})
    };
    const toolbox = {setSelectedCategoryById: jest.fn()};
    const workspace = {
        getFlyout: () => flyout,
        getToolbox: () => toolbox
    };

    const prepared = await createScratchBlocksFlyoutPort({workspace}).prepare({blockType: 'data_setvariableto'});

    expect(prepared.block).toBe(block);
    expect(reads).toBeGreaterThan(2);
    expect(toolbox.setSelectedCategoryById).toHaveBeenCalledWith('variables');
});

test('scrolls a selected short flyout until its semantic block target is visible', async () => {
    let visible = false;
    const block = {
        type: 'operator_join',
        disabled: false,
        getRelativeToSurfaceXY: () => ({x: 20, y: 420}),
        getSvgRoot: () => ({
            getBoundingClientRect: () => ({width: visible ? 140 : 0, height: visible ? 48 : 0})
        })
    };
    const flyout = {
        horizontalLayout_: false,
        categoryScrollPositions: [{categoryId: 'operators', position: 200}],
        scrollTarget: null,
        getWorkspace: () => ({getAllBlocks: () => [block]}),
        scrollTo: jest.fn(position => {
            expect(position).toBe(420 - BLOCK_REVEAL_PADDING);
            visible = true;
        })
    };
    const toolbox = {setSelectedCategoryById: jest.fn()};
    const workspace = {
        getFlyout: () => flyout,
        getToolbox: () => toolbox
    };

    const prepared = await createScratchBlocksFlyoutPort({workspace}).prepare({blockType: 'operator_join'});

    expect(prepared.block).toBe(block);
    expect(flyout.scrollTo).toHaveBeenCalledTimes(1);
});

test('selects the variable reporter whose stable field ID matches the recorded prototype', async () => {
    const block = (id, variableId) => ({
        id,
        type: 'data_variable',
        disabled: false,
        getField: name => (name === 'VARIABLE' ? {getValue: () => variableId} : null),
        getRelativeToSurfaceXY: () => ({x: 20, y: 140}),
        getSvgRoot: () => ({getBoundingClientRect: () => ({width: 120, height: 32})})
    });
    const wrong = block('reporter-default', 'default-variable');
    const cake = block('reporter-cake', 'live-cake');
    const flyout = {
        horizontalLayout_: false,
        categoryScrollPositions: [{categoryId: 'variables', position: 100}],
        scrollTarget: null,
        getWorkspace: () => ({getAllBlocks: () => [wrong, cake]})
    };
    const workspace = {
        getFlyout: () => flyout,
        getToolbox: () => ({setSelectedCategoryById: jest.fn()})
    };
    const fieldXml = {
        tagName: 'field',
        textContent: 'cake',
        getAttribute: name => ({
            name: 'VARIABLE',
            id: 'recorded-cake',
            variabletype: ''
        })[name] || null
    };
    const ScratchBlocks = {Xml: {textToDom: jest.fn(() => ({childNodes: [fieldXml]}))}};
    const port = createScratchBlocksFlyoutPort({
        workspace,
        ScratchBlocks,
        aliases: new Map([['recorded-cake', 'live-cake']])
    });

    const prepared = await port.prepare({
        blockType: 'data_variable',
        prototypeXml: '<block type="data_variable"><field name="VARIABLE" id="recorded-cake">cake</field></block>'
    });

    expect(prepared.block).toBe(cake);
    expect(ScratchBlocks.Xml.textToDom).toHaveBeenCalledTimes(1);
});

test('does not guess when same-type flyout blocks have no recorded discriminator', async () => {
    const block = id => ({
        id,
        type: 'data_variable',
        disabled: false,
        getRelativeToSurfaceXY: () => ({x: 20, y: 140}),
        getSvgRoot: () => ({getBoundingClientRect: () => ({width: 120, height: 32})})
    });
    const flyout = {
        getWorkspace: () => ({getAllBlocks: () => [block('one'), block('two')]})
    };
    const workspace = {getFlyout: () => flyout};

    await expect(createScratchBlocksFlyoutPort({workspace}).prepare({blockType: 'data_variable'}))
        .rejects.toThrow('Native flyout block type is ambiguous: data_variable');
});
