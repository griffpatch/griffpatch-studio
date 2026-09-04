import {createScratchBlocksClipboardDriver} from
    '../../src/studio/bridge/native-interaction/scratch-blocks-clipboard-driver';

const makeHarness = (placed = true) => {
    class MouseEvent {
        constructor (type, options) {
            this.type = type;
            Object.assign(this, options);
        }
    }
    const documentObject = {
        defaultView: {
            MouseEvent,
            requestAnimationFrame: callback => callback()
        }
    };
    const rootElement = {
        ownerDocument: documentObject,
        getBoundingClientRect: () => ({left: 100, top: 80, width: 120, height: 50, right: 220, bottom: 130}),
        dispatchEvent: jest.fn()
    };
    const sourceBlock = {
        id: 'source-root',
        type: 'control_repeat',
        getSvgRoot: () => rootElement
    };
    const blocks = [sourceBlock];
    const workspace = {
        getBlockById: id => blocks.find(block => block.id === id),
        getTopBlocks: () => [sourceBlock],
        getAllBlocks: () => blocks,
        paste: jest.fn(() => blocks.push({id: 'live-root'}, {id: 'live-child'}))
    };
    const clipboardAttributes = {};
    const ScratchBlocks = {
        clipboardXml_: {
            tagName: 'block',
            setAttribute: (name, value) => {
                clipboardAttributes[name] = value;
            }
        },
        copy_: jest.fn()
    };
    const pointer = {
        travelTo: jest.fn(target => {
            const element = target.locate();
            return Promise.resolve({
                completed: true,
                model: 'natural',
                frames: [{x: 116, y: 98}],
                target: {element, point: {x: 116, y: 98}}
            });
        })
    };
    const scope = {
        runWithoutUndo: callback => callback(),
        flushPendingEvents: jest.fn(),
        observed: [{type: 'create', ids: ['live-root', 'live-child']}]
    };
    const target = {id: 'sprite-a', isOriginal: true, isStage: false, getName: () => 'Sprite1'};
    const blockDriver = {play: jest.fn(plan => Promise.resolve({
        frames: [{pointer: {x: 420, y: 300}}],
        resolvedPlan: plan,
        pointerTravel: {completed: true, frames: []}
    }))};
    const driver = createScratchBlocksClipboardDriver({
        workspace,
        vm: {editingTarget: target,
            runtime: {
                targets: [target], getTargetById: id => (id === target.id ? target : null)
            }},
        ScratchBlocks,
        documentObject,
        clock: {play: jest.fn(() => Promise.resolve(true))},
        pointer,
        scope,
        blockDriver
    });

    const plan = {
        kind: 'clipboard-block-paste',
        targetId: 'sprite-a',
        targetRef: {name: 'Sprite1', isStage: false},
        sourceBlockType: 'control_repeat',
        sourceBlockRef: {
            ancestorId: 'source-root',
            ancestorType: 'control_repeat',
            ancestorCoordinate: null,
            path: []
        },
        blockIds: ['recorded-root', 'recorded-child'],
        copiedBlockCount: 2,
        destination: {parentId: null, inputName: null, coordinate: {x: 208, y: 216}},
        ...(placed ? {placement: {
            kind: 'block-drag',
            blockId: 'recorded-root',
            destination: {coordinate: {x: 420, y: 300}},
            affectedBlocks: [{blockId: 'recorded-root'}]
        }} : {})
    };
    return {driver, plan, sourceBlock, workspace, ScratchBlocks, clipboardAttributes, pointer, scope, blockDriver};
};

test.each([false, true])('delegates clipboard creation and optional native placement (%s)', async placed => {
    const {driver, plan, sourceBlock, workspace, ScratchBlocks, clipboardAttributes, scope, blockDriver} =
        makeHarness(placed);
    const result = await driver.play(plan);

    expect(ScratchBlocks.copy_).toHaveBeenCalledWith(sourceBlock);
    expect(workspace.paste).toHaveBeenCalledWith(ScratchBlocks.clipboardXml_);
    expect(clipboardAttributes).toEqual({x: '208', y: '216'});
    expect(scope.flushPendingEvents).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
        idAliases: {
            'recorded-root': 'live-root',
            'recorded-child': 'live-child'
        },
        pointerTravel: {completed: true}
    });
    if (placed) {
        expect(blockDriver.play).toHaveBeenCalledWith(expect.objectContaining({
            blockId: 'live-root', affectedBlocks: [{blockId: 'live-root'}]
        }), null);
        expect(result.resolvedPlan.kind).toBe('block-drag');
        expect(result.frames).toHaveLength(1);
    } else {
        expect(blockDriver.play).not.toHaveBeenCalled();
        expect(result).toMatchObject({
            controlsVisible: true, projectMatches: true, sourceBlockId: 'source-root', targetBlockCount: 3
        });
    }
});

test('uses the paste coordinate before moving to the final destination', async () => {
    const {driver, plan, clipboardAttributes, blockDriver} = makeHarness();
    plan.pasteCoordinate = {x: 208, y: 216};
    plan.destination.coordinate = {x: 420, y: 300};
    await driver.play(plan);
    expect(clipboardAttributes).toEqual({x: '208', y: '216'});
    expect(blockDriver.play.mock.calls[0][0].destination.coordinate).toEqual({x: 420, y: 300});
});

test('fails closed rather than dragging a guessed root when copied identities are missing', async () => {
    const {driver, plan, scope, blockDriver} = makeHarness();
    scope.observed = [];
    await expect(driver.play(plan)).rejects.toThrow('native copied-root identity');
    expect(blockDriver.play).not.toHaveBeenCalled();
});

test('propagates native placement cancellation and its abort signal', async () => {
    const {driver, plan, blockDriver} = makeHarness();
    const signal = {aborted: false};
    blockDriver.play.mockResolvedValue({cancelled: true, pointerTravel: {completed: false, frames: []}});
    const result = await driver.play(plan, signal);
    expect(blockDriver.play).toHaveBeenCalledWith(expect.any(Object), signal);
    expect(result).toMatchObject({cancelled: true, pointerTravel: {completed: false}});
});

test('does not create a copy when source pointer travel is cancelled', async () => {
    const {driver, plan, pointer, workspace, blockDriver} = makeHarness();
    pointer.travelTo.mockResolvedValue({completed: false});
    expect(await driver.play(plan)).toMatchObject({cancelled: true});
    expect(workspace.paste).not.toHaveBeenCalled();
    expect(blockDriver.play).not.toHaveBeenCalled();
});
