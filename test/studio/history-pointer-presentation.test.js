import {createHistoryPointerPresentation, HISTORY_POINTER_SPEED}
    from '../../src/studio/bridge/history-pointer-presentation';

const makeHarness = (enabled = true) => {
    const clock = {setSpeed: jest.fn(), cancel: jest.fn()};
    const pointer = {
        element: {parentNode: {}},
        travelTo: jest.fn(() => Promise.resolve({completed: true})),
        moveTo: jest.fn(),
        press: jest.fn(),
        release: jest.fn(),
        idle: jest.fn(),
        hide: jest.fn(),
        show: jest.fn(),
        settle: jest.fn(),
        remove: jest.fn()
    };
    const scope = {detach: jest.fn()};
    const selectTarget = jest.fn(() => Promise.resolve({status: 'verified'}));
    const presentCreation = jest.fn(() => Promise.resolve({status: 'presented'}));
    const port = createHistoryPointerPresentation({
        enabled,
        documentObject: {createElement: jest.fn()},
        createClock: () => clock,
        createOverlay: jest.fn(),
        createControl: () => pointer,
        createScope: () => scope,
        selectTarget,
        presentCreation
    });
    const block = {id: 'actor',
        getSvgRoot: () => ({
            getBoundingClientRect: () => ({left: 100, top: 200, width: 80, height: 40})
        })};
    return {port, pointer, clock, scope, selectTarget, presentCreation, block};
};

test('history follows the animated block without changing it, and retains the idle cursor', async () => {
    const {port, pointer, clock, block} = makeHarness();
    await port.beginBlock(block, 2);
    expect(clock.setSpeed).toHaveBeenCalledWith(HISTORY_POINTER_SPEED * 2);
    expect(pointer.press).toHaveBeenCalledTimes(1);
    port.followBlock(block);
    expect(pointer.moveTo).toHaveBeenCalledWith({x: 116, y: 218});
    port.endBlock();
    expect(pointer.release).toHaveBeenCalledTimes(1);
    expect(pointer.idle).toHaveBeenCalledTimes(1);
    expect(pointer.settle).toHaveBeenCalledTimes(1);
    expect(pointer.remove).not.toHaveBeenCalled();
    await port.beginBlock(block);
    expect(pointer.show).toHaveBeenCalledTimes(2);
});

test('a queued command cancels travel before the press and cannot touch a disposed actor', async () => {
    const {port, pointer, clock, block} = makeHarness();
    pointer.travelTo.mockImplementation((target, {signal}) => new Promise(resolve => {
        signal.addEventListener('abort', () => resolve({completed: false}), {once: true});
    }));
    const pending = port.beginBlock(block);
    port.finishActive();
    await pending;
    expect(clock.cancel).toHaveBeenCalledTimes(1);
    expect(pointer.press).not.toHaveBeenCalled();
    port.followBlock({getSvgRoot: () => {
        throw new Error('disposed actor');
    }});
    expect(pointer.moveTo).not.toHaveBeenCalled();
    port.begin();
    pointer.travelTo.mockResolvedValue({completed: true});
    await port.beginBlock(block);
    expect(pointer.press).toHaveBeenCalledTimes(1);
});

test('cancelling sprite travel detaches event suppression and returns control to semantic history', async () => {
    const {port, selectTarget, scope} = makeHarness();
    selectTarget.mockImplementation(({signal}) => new Promise(resolve => {
        signal.addEventListener('abort', () => resolve({status: 'cancelled'}), {once: true});
    }));
    const pending = port.selectTarget({targetId: 'sprite2'});
    port.finishActive();
    await expect(pending).resolves.toEqual({status: 'cancelled'});
    expect(scope.detach).toHaveBeenCalledTimes(1);
});

test('sprite travel is accelerated but the arrival click uses the requested presentation speed', async () => {
    const {port, clock, selectTarget} = makeHarness();
    await port.selectTarget({targetId: 'sprite2'}, {speed: 2});
    expect(clock.setSpeed).toHaveBeenCalledWith(HISTORY_POINTER_SPEED * 2);
    expect(selectTarget).toHaveBeenCalledWith(expect.objectContaining({clickSpeed: 2}));
});

test('history shares the Add gesture and translates interrupted presentation into semantic catch-up', async () => {
    const {port, clock, scope, presentCreation} = makeHarness();
    const transaction = {operation: {type: 'sprite-create'}};
    await port.presentProjectRestore({transaction, direction: 'forward', restore: jest.fn(), speed: 2});
    expect(clock.setSpeed).toHaveBeenCalledWith(HISTORY_POINTER_SPEED * 2);
    expect(presentCreation).toHaveBeenCalledWith(expect.objectContaining({clickSpeed: 2}));
    expect(scope.detach).toHaveBeenCalledTimes(1);
    presentCreation.mockImplementation(({signal}) => new Promise(resolve => {
        signal.addEventListener('abort', () => resolve({status: 'cancelled'}), {once: true});
    }));
    const pending = port.presentProjectRestore({transaction, direction: 'forward', restore: jest.fn()});
    port.finishActive();
    await expect(pending).resolves.toMatchObject({status: 'skipped'});
    expect(scope.detach).toHaveBeenCalledTimes(2);
});

test('disabled and catch-up navigation never allocate or animate a pointer', async () => {
    const {port, pointer, selectTarget, block} = makeHarness(false);
    await port.beginBlock(block);
    await expect(port.selectTarget({})).resolves.toEqual({status: 'unsupported'});
    expect(pointer.travelTo).not.toHaveBeenCalled();
    expect(selectTarget).not.toHaveBeenCalled();
    port.setEnabled(true);
    port.begin({animate: false});
    await port.beginBlock(block);
    expect(pointer.travelTo).not.toHaveBeenCalled();
    port.begin();
    await port.beginBlock(block);
    port.setEnabled(false);
    expect(pointer.remove).toHaveBeenCalled();
});
