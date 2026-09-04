import {createBlockTransitionPresentationPort} from '../../src/studio/bridge/block-transition-presentation-port';

const transaction = {events: [{
    type: 'move',
    blockId: 'recorded',
    blockType: 'motion_movesteps',
    details: {
        oldLocation: {coordinate: {x: 10, y: 20}},
        newLocation: {coordinate: {x: 100, y: 200}}
    }
}]};

const makeBlock = (x, y) => ({
    id: 'live',
    point: {x, y},
    root: {style: {}, setAttribute: jest.fn()},
    getRelativeToSurfaceXY () {
        return this.point;
    },
    moveBy (dx, dy) {
        this.point = {x: this.point.x + dx, y: this.point.y + dy};
    },
    getNextBlock: () => null,
    unplug: jest.fn(),
    bringToFront: jest.fn(),
    getSvgRoot () {
        return this.root;
    }
});

test.each([new Map([['recorded', 'live']]), {recorded: 'live'}])(
    'animates only the isolated copy using workspace aliases (%p)', async aliases => {
        const live = makeBlock(100, 200);
        const copy = makeBlock(10, 20);
        const reusedId = makeBlock(900, 900);
        const surface = {workspace: {getBlockById: id => (id === 'live' ? copy :
            (id === 'recorded' ? reusedId : null))},
        dispose: jest.fn()};
        const workspace = {
            scale: 1,
            getBlockById: id => (id === 'live' ? live : (id === 'recorded' ? reusedId : null)),
            getAllBlocks: () => [live],
            createTransitionWorkspace: () => surface
        };
        const events = {disable: jest.fn(), enable: jest.fn()};
        const historyPointer = {beginBlock: jest.fn(), followBlock: jest.fn(), endBlock: jest.fn()};
        const clock = {
            setSpeed: jest.fn(),
            finish: jest.fn(),
            play: async ({points, onFrame}) => {
                for (const [index, point] of points.entries()) await onFrame(point, index);
            }
        };
        const port = createBlockTransitionPresentationPort({
            workspace,
            ScratchBlocks: {Events: events},
            blockAliases: () => aliases,
            createClock: () => clock,
            historyPointer
        });
        const before = port.captureBefore({transaction, direction: 'forward'});
        const result = await port.playAfter({transaction, before, playbackSpeed: 2});
        expect(result).toMatchObject({engine: 'native-block-transition', animated: 1});
        expect(result.frames).toHaveLength(19);
        expect(copy.point).toEqual(live.point);
        expect(live.unplug).not.toHaveBeenCalled();
        expect(reusedId.unplug).not.toHaveBeenCalled();
        expect(clock.setSpeed).toHaveBeenCalledWith(2);
        expect(historyPointer.beginBlock).toHaveBeenCalledWith(copy, 2);
        expect(historyPointer.followBlock).toHaveBeenCalledTimes(19);
        expect(historyPointer.followBlock.mock.calls.every(([block]) => block === copy)).toBe(true);
        expect(historyPointer.endBlock).toHaveBeenCalledTimes(1);
        expect(surface.dispose).toHaveBeenCalledTimes(1);
        expect(events.enable).toHaveBeenCalledTimes(events.disable.mock.calls.length);
        port.discard(before);
        expect(surface.dispose).toHaveBeenCalledTimes(1);
    }
);

test('fields without block motion do not allocate a presentation workspace', () => {
    const createTransitionWorkspace = jest.fn();
    const port = createBlockTransitionPresentationPort({workspace: {createTransitionWorkspace}});
    const before = port.captureBefore({transaction: {events: []}, direction: 'forward'});
    expect(before).toBeNull();
    expect(createTransitionWorkspace).not.toHaveBeenCalled();
});

test.each(['forward', 'backward'])('lifecycle %s brakes on arrival and accelerates on departure', async direction => {
    const entering = direction === 'forward';
    const live = makeBlock(100, 200);
    const copy = makeBlock(100, 200);
    let rendered = !entering;
    const scene = {getBlockById: id => (rendered && id === 'live' ? copy : null)};
    const surface = {workspace: scene, dispose: jest.fn()};
    const frames = [];
    const port = createBlockTransitionPresentationPort({
        workspace: {
            scale: 1,
            getBlockById: id => (entering && id === 'live' ? live : null),
            getAllBlocks: () => (entering ? [] : [live]),
            createTransitionWorkspace: () => surface
        },
        ScratchBlocks: {
            Events: {disable: jest.fn(), enable: jest.fn()},
            Xml: {blockToDom: () => ({querySelectorAll: () => []}),
                domToBlock: () => {
                    rendered = true;
                    return copy;
                }}
        },
        createClock: () => ({finish: jest.fn(),
            setSpeed: jest.fn(),
            play: async ({points, onFrame}) => {
                for (const [index, point] of points.entries()) {
                    await onFrame(point, index);
                    frames.push(copy.point.x);
                }
            }})
    });
    const create = {events: [{type: 'create',
        blockId: 'live',
        details: {
            ids: ['live'], xml: '<block type="motion_movesteps" id="live" />'
        }}]};
    const before = port.captureBefore({transaction: create, direction});
    await port.playAfter({transaction: create, before});
    const firstTravel = Math.abs(frames[6] - frames[0]);
    const lastTravel = Math.abs(frames[18] - frames[12]);
    if (entering) expect(firstTravel).toBeGreaterThan(lastTravel * 5);
    else expect(lastTravel).toBeGreaterThan(firstTravel * 5);
});

test.each(['discard', 'finishActive', 'detach'])('%s releases a captured scene before playback', async method => {
    const surface = {workspace: {}, dispose: jest.fn()};
    const events = {disable: jest.fn(), enable: jest.fn()};
    const clock = {finish: jest.fn()};
    const port = createBlockTransitionPresentationPort({
        workspace: {createTransitionWorkspace: () => surface, getAllBlocks: () => []},
        ScratchBlocks: {Events: events},
        createClock: () => clock
    });
    const before = port.captureBefore({transaction, direction: 'forward'});
    port[method](before);
    await expect(port.playAfter({transaction, before})).resolves.toEqual({animated: 0});
    expect(surface.dispose).toHaveBeenCalledTimes(1);
    expect(events.enable).toHaveBeenCalledTimes(events.disable.mock.calls.length);
});

test('a missing actor still disposes the scene and balances event suppression', async () => {
    const surface = {workspace: {getBlockById: () => null}, dispose: jest.fn()};
    const events = {disable: jest.fn(), enable: jest.fn()};
    const port = createBlockTransitionPresentationPort({
        workspace: {createTransitionWorkspace: () => surface, getAllBlocks: () => [], getBlockById: () => null},
        ScratchBlocks: {Events: events},
        createClock: () => ({finish: jest.fn()})
    });
    const before = port.captureBefore({transaction, direction: 'forward'});
    await expect(port.playAfter({transaction, before})).rejects.toThrow('Transition actor could not be resolved');
    expect(surface.dispose).toHaveBeenCalledTimes(1);
    expect(events.enable).toHaveBeenCalledTimes(events.disable.mock.calls.length);
});

test('preview cleanup failure cannot leave the real editor hidden', () => {
    const surface = {workspace: {}, dispose: jest.fn()};
    const events = {disable: jest.fn(), enable: jest.fn()};
    const port = createBlockTransitionPresentationPort({
        workspace: {createTransitionWorkspace: () => surface, getAllBlocks: () => []},
        ScratchBlocks: {Events: events},
        createClock: () => ({finish: jest.fn()})
    });
    const before = port.captureBefore({transaction, direction: 'forward'});
    before.managers.push({previewConnection: () => {
        throw new Error('cleanup failed');
    }});
    expect(() => port.discard(before)).toThrow('cleanup failed');
    expect(surface.dispose).toHaveBeenCalledTimes(1);
    expect(events.enable).toHaveBeenCalledTimes(events.disable.mock.calls.length);
});

test.each([false, true])('a departing C-block retains only its owned substack (owned: %s)', async owned => {
    const makeConnectedBlock = id => {
        const block = {...makeBlock(10, 20), id, inputList: []};
        const connection = type => ({
            type,
            targetConnection: null,
            getSourceBlock: () => block,
            targetBlock () {
                return this.targetConnection?.getSourceBlock();
            },
            connect (other) {
                this.disconnect();
                other.disconnect();
                this.targetConnection = other;
                other.targetConnection = this;
            },
            disconnect () {
                if (this.targetConnection) this.targetConnection.targetConnection = null;
                this.targetConnection = null;
            }
        });
        block.previousConnection = connection(4);
        block.nextConnection = connection(3);
        block.inputList = [{name: 'SUBSTACK', connection: connection(3)}];
        block.getInput = name => block.inputList.find(input => input.name === name);
        block.getNextBlock = () => block.nextConnection.targetBlock();
        block.getHeightWidth = () => ({height: 70, width: 100});
        block.lastConnectionInStack = () => block.nextConnection;
        block.setStatementInputPreview = jest.fn();
        block.unplug = () => block.previousConnection.disconnect();
        return block;
    };
    const parent = makeConnectedBlock('parent');
    const wrapper = makeConnectedBlock('wrapper');
    const child = makeConnectedBlock('child');
    parent.nextConnection.connect(wrapper.previousConnection);
    wrapper.getInput('SUBSTACK').connection.connect(child.previousConnection);
    const afterParent = makeConnectedBlock('parent');
    const afterChild = makeConnectedBlock('child');
    if (!owned) afterParent.nextConnection.connect(afterChild.previousConnection);
    const scene = {getBlockById: id => [parent, wrapper, child].find(block => block.id === id)};
    const previewConnection = jest.fn();
    const dispose = jest.fn();
    const port = createBlockTransitionPresentationPort({
        workspace: {
            scale: 1,
            getAllBlocks: () => [parent, wrapper, child],
            getBlockById: id => [afterParent, ...(owned ? [] : [afterChild])].find(block => block.id === id),
            createTransitionWorkspace: () => ({workspace: scene, dispose})
        },
        ScratchBlocks: {
            NEXT_STATEMENT: 3,
            Events: {disable: jest.fn(), enable: jest.fn()},
            InsertionMarkerManager: jest.fn(() => ({
                previewConnection,
                getConnectionPreview: () => ({visible: true}),
                dispose: jest.fn()
            }))
        },
        createClock: () => ({
            finish: jest.fn(),
            setSpeed: jest.fn(),
            play: async ({points, onFrame}) => {
                for (const [index, point] of points.entries()) await onFrame(point, index);
            }
        })
    });
    const create = {events: [{
        type: 'create',
        blockId: 'wrapper',
        details: {
            ids: owned ? ['wrapper', 'child'] : ['wrapper'], xml: '<block id="wrapper" type="control_repeat" />'
        }
    }]};
    const before = port.captureBefore({transaction: create, direction: 'backward'});
    await port.playAfter({transaction: create, before});
    expect(previewConnection.mock.calls[0]).toEqual(owned ?
        [wrapper.previousConnection, parent.nextConnection] :
        [wrapper.getInput('SUBSTACK').connection, child.previousConnection]);
    if (owned) expect(wrapper.getInput('SUBSTACK').connection.targetBlock()).toBe(child);
    else expect(wrapper.getInput('SUBSTACK').connection.targetBlock()).toBeUndefined();
    if (owned) expect(wrapper.setStatementInputPreview).not.toHaveBeenCalled();
    else {
        expect(wrapper.setStatementInputPreview).toHaveBeenCalledWith('SUBSTACK',
            {height: 70, width: 100, hasNextConnection: true}, 1);
        expect(wrapper.setStatementInputPreview).toHaveBeenLastCalledWith('SUBSTACK',
            {height: 70, width: 100, hasNextConnection: true}, 0);
    }
    if (!owned) expect(parent.getNextBlock()).toBe(child);
    expect(dispose).toHaveBeenCalledTimes(1);
});
