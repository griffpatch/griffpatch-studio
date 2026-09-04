import {createInteractionPlaybackPort} from '../../src/studio/bridge/native-interaction/interaction-playback-port';

const transaction = {
    id: 'transaction-1',
    targetId: 'sprite-a',
    events: [{
        type: 'move',
        blockId: 'moving',
        blockType: 'motion_turnleft',
        details: {
            oldLocation: {parentId: 'old-parent', inputName: null, coordinate: null},
            newLocation: {parentId: 'new-parent', inputName: null, coordinate: null}
        }
    }]
};

const makeHarness = driverEvidence => {
    const clock = {cancel: jest.fn(), finish: jest.fn(), setSpeed: jest.fn()};
    const pointer = {remove: jest.fn()};
    const scope = {detach: jest.fn(), flushPendingEvents: jest.fn()};
    const createClock = jest.fn(() => clock);
    const createPointer = jest.fn(() => pointer);
    const createScope = jest.fn(() => scope);
    const createDriver = jest.fn(() => ({
        cleanup: jest.fn(),
        play: jest.fn(() => Promise.resolve(driverEvidence))
    }));
    const verify = jest.fn(() => Promise.resolve({matches: false, evidence: {difference: 'topology'}}));
    const ensureInteractionVisible = jest.fn(() => Promise.resolve(false));
    const port = createInteractionPlaybackPort({
        workspace: {},
        vm: {},
        ScratchBlocks: {
            WidgetDiv: {isVisible: () => false},
            DropDownDiv: {isVisible: () => false}
        },
        documentObject: {},
        journalCounts: () => ({eventCount: 1, stepCount: 1}),
        createClock,
        createPointer,
        createScope,
        createDriver,
        ensureInteractionVisible,
        verify
    });
    return {
        clock,
        pointer,
        scope,
        createClock,
        createPointer,
        createScope,
        createDriver,
        ensureInteractionVisible,
        verify,
        port
    };
};

test('a snapshot creation travels to the Add icon and awaits the click update on the shared pointer', async () => {
    const sequence = [];
    const clock = {setSpeed: jest.fn(), cancel: jest.fn()};
    const scope = {detach: jest.fn()};
    const pointer = {
        travelTo: jest.fn(target => {
            sequence.push(target.id);
            return Promise.resolve({completed: true, target: {id: target.id}});
        }),
        click: jest.fn(async (activate, options) => {
            expect(options.timing).toMatchObject({beforePressFrames: 12, afterReleaseFrames: 12});
            sequence.push('press');
            await activate();
            sequence.push('after');
            return true;
        }),
        idle: jest.fn(),
        remove: jest.fn()
    };
    const createPointerControl = jest.fn(() => pointer);
    const port = createInteractionPlaybackPort({
        workspace: {},
        vm: {},
        ScratchBlocks: {},
        documentObject: {},
        createClock: () => clock,
        createPointer: () => ({}),
        createPointerControl,
        createScope: () => scope
    });
    port.beginSequence();
    const creation = {id: 'new-sprite', kind: 'project-operation', operation: {type: 'sprite-create'}};
    const result = await port.presentProjectRestore({
        transaction: creation,
        direction: 'forward',
        speed: 2,
        restore: () => {
            sequence.push('restore');
            return Promise.resolve();
        }
    });
    expect(result).toMatchObject({status: 'presented', plan: {kind: 'snapshot-sprite-create'}});
    expect(sequence).toEqual(['sprite-library-open', 'press', 'restore', 'after']);
    expect(clock.setSpeed).toHaveBeenCalledWith(2);
    expect(scope.detach).toHaveBeenCalledTimes(1);
    expect(pointer.idle).not.toHaveBeenCalled();
    await port.presentProjectRestore({transaction: creation, direction: 'forward', restore: () => {}});
    expect(createPointerControl).toHaveBeenCalledTimes(1);
    port.endSequence();
    expect(pointer.idle).toHaveBeenCalledTimes(1);
});

test.each(['backward', 'forward'])('snapshot presentation refuses unrelated operations (%s)', async direction => {
    const createClock = jest.fn();
    const port = createInteractionPlaybackPort({createClock, documentObject: {}});
    const restore = jest.fn();
    await expect(port.presentProjectRestore({
        transaction: {operation: {type: direction === 'backward' ? 'sprite-create' : 'sprite-delete'}},
        direction,
        restore
    })).resolves.toEqual({status: 'unsupported'});
    expect(createClock).not.toHaveBeenCalled();
    expect(restore).not.toHaveBeenCalled();
});

test('detaches every playback resource after a verified-shape mismatch', async () => {
    const harness = makeHarness({cancelled: false, frames: []});
    await expect(harness.port.play({transaction, direction: 'forward'})).resolves.toMatchObject({
        status: 'mismatch',
        evidence: {difference: 'topology'}
    });
    expect(harness.verify).toHaveBeenCalledTimes(1);
    expect(harness.clock.cancel).toHaveBeenCalledTimes(1);
    expect(harness.scope.detach).toHaveBeenCalledTimes(1);
    expect(harness.scope.flushPendingEvents).toHaveBeenCalledTimes(2);
    expect(harness.pointer.remove).toHaveBeenCalledTimes(1);
    expect(harness.createDriver.mock.results[0].value.cleanup).toHaveBeenCalledTimes(1);
});

test('reports a serializable missing native capability before starting playback', async () => {
    const createClock = jest.fn();
    const port = createInteractionPlaybackPort({workspace: {}, documentObject: {}, createClock});
    const result = await port.play({transaction, direction: 'forward'});
    expect(JSON.parse(JSON.stringify(result))).toMatchObject({
        status: 'mismatch',
        evidence: {
            missingCapability: 'whenBlockOperationsComplete',
            message: expect.stringContaining('reload the editor')
        }
    });
    expect(createClock).not.toHaveBeenCalled();
});

test.each([false, true])('waits for native completion before verification or cleanup (failure=%s)', async fails => {
    const harness = makeHarness({cancelled: false, frames: []});
    let complete;
    harness.scope.waitForBlockOperations = jest.fn(() => new Promise(resolve => { complete = resolve; }));
    if (fails) harness.createDriver.mockReturnValue({play: () => Promise.reject(new Error('drag failed'))});
    const playback = harness.port.play({transaction, direction: 'forward'});
    for (let tick = 0; tick < 8 && !complete; tick++) await Promise.resolve();
    expect(complete).toEqual(expect.any(Function));
    expect(harness.verify).not.toHaveBeenCalled();
    expect(harness.scope.detach).not.toHaveBeenCalled();
    complete();
    await playback;
    expect(harness.verify).toHaveBeenCalledTimes(fails ? 0 : 1);
    expect(harness.scope.detach).toHaveBeenCalledTimes(1);
});

test('passes the requested history speed into the compiled drag plan', async () => {
    const harness = makeHarness({cancelled: false, frames: []});
    const result = await harness.port.play({
        transaction,
        direction: 'forward',
        presentationMode: 'history',
        speed: 2
    });

    expect(result.plan.presentation).toMatchObject({frameCount: 7, markerHoldFrames: 1});
    expect(harness.clock.setSpeed).toHaveBeenCalledWith(2);
    expect(harness.ensureInteractionVisible).toHaveBeenCalledWith(
        expect.objectContaining({kind: 'existing-block-drag'}),
        expect.any(Map),
        {speed: 2}
    );
    expect(harness.createPointer).not.toHaveBeenCalled();
    const driver = harness.createDriver.mock.results[0].value;
    expect(driver.play).toHaveBeenCalledWith(expect.objectContaining({
        presentation: expect.objectContaining({frameCount: 7, markerHoldFrames: 1})
    }), null);
});

test('cleans up cancellation and never verifies the partial gesture', async () => {
    const harness = makeHarness({cancelled: true, frames: [{index: 0}]});
    await expect(harness.port.play({transaction, direction: 'forward'})).resolves.toMatchObject({
        status: 'cancelled'
    });
    expect(harness.verify).not.toHaveBeenCalled();
    expect(harness.clock.cancel).toHaveBeenCalledTimes(1);
    expect(harness.scope.detach).toHaveBeenCalledTimes(1);
    expect(harness.scope.flushPendingEvents).toHaveBeenCalledTimes(2);
    expect(harness.pointer.remove).toHaveBeenCalledTimes(1);
});

test('allows a driver to decline an optional external presentation before mutation', async () => {
    const harness = makeHarness({unsupported: true, reason: 'Backpack item is unavailable'});
    await expect(harness.port.play({transaction, direction: 'forward'})).resolves.toMatchObject({
        status: 'unsupported',
        reason: 'Backpack item is unavailable'
    });
    expect(harness.verify).not.toHaveBeenCalled();
    expect(harness.scope.detach).toHaveBeenCalledTimes(1);
    expect(harness.pointer.remove).toHaveBeenCalledTimes(1);
});

test('rejects unsupported transactions before allocating playback resources', async () => {
    const harness = makeHarness({cancelled: false, frames: []});
    await expect(harness.port.play({
        transaction: {...transaction, events: [{...transaction.events[0], type: 'change'}]},
        direction: 'forward'
    })).resolves.toMatchObject({status: 'unsupported'});
    expect(harness.createClock).not.toHaveBeenCalled();
    expect(harness.createPointer).not.toHaveBeenCalled();
    expect(harness.createScope).not.toHaveBeenCalled();
    expect(harness.createDriver).not.toHaveBeenCalled();
});

test('exposes the same compiled plan used by playback for camera coordination', () => {
    const harness = makeHarness({cancelled: false, frames: []});
    expect(harness.port.plan({transaction, direction: 'forward'})).toMatchObject({
        kind: 'existing-block-drag',
        destination: {parentId: 'new-parent'}
    });
});

test('can suppress the native pointer without disabling the verified drag', async () => {
    const harness = makeHarness({cancelled: false, frames: []});
    const port = createInteractionPlaybackPort({
        workspace: {},
        vm: {},
        ScratchBlocks: {
            WidgetDiv: {isVisible: () => false},
            DropDownDiv: {isVisible: () => false}
        },
        documentObject: {},
        journalCounts: () => ({eventCount: 1, stepCount: 1}),
        createClock: harness.createClock,
        createPointer: harness.createPointer,
        createScope: harness.createScope,
        createDriver: harness.createDriver,
        verify: harness.verify,
        showPointer: false
    });

    await port.play({transaction, direction: 'forward'});

    expect(harness.createPointer).not.toHaveBeenCalled();
    const driverOptions = harness.createDriver.mock.calls[0][0];
    expect(() => driverOptions.pointer.moveTo({x: 1, y: 2})).not.toThrow();
});

test('fast-forwards the active native gesture without cancelling its semantic drop', async () => {
    let finishDriver;
    const harness = makeHarness({cancelled: false, frames: []});
    harness.createDriver.mockImplementation(() => ({
        play: jest.fn(() => new Promise(resolve => {
            finishDriver = () => resolve({cancelled: false, frames: []});
        }))
    }));

    const playback = harness.port.play({transaction, direction: 'forward'});
    harness.port.finishActive();
    expect(harness.clock.finish).toHaveBeenCalledTimes(1);
    while (!finishDriver) await Promise.resolve();
    finishDriver();
    await playback;
    harness.port.finishActive();
    expect(harness.clock.finish).toHaveBeenCalledTimes(1);
});

test('retains one pointer controller across a realistic Play sequence', async () => {
    const harness = makeHarness({cancelled: false, frames: []});
    harness.port.beginSequence();
    await harness.port.play({transaction, direction: 'forward'});
    await harness.port.play({transaction, direction: 'forward'});

    expect(harness.createPointer).toHaveBeenCalledTimes(1);
    expect(harness.pointer.remove).not.toHaveBeenCalled();
    harness.port.endSequence();
    expect(harness.pointer.remove).toHaveBeenCalledTimes(1);
});

test('idles the completed sequence pointer and reuses it if playback resumes before removal', async () => {
    const harness = makeHarness({cancelled: false, frames: []});
    harness.pointer.idle = jest.fn();
    harness.pointer.show = jest.fn();

    harness.port.beginSequence();
    await harness.port.play({transaction, direction: 'forward'});
    harness.port.endSequence({preserveAliases: true});

    expect(harness.pointer.idle).toHaveBeenCalledTimes(1);
    expect(harness.pointer.remove).not.toHaveBeenCalled();

    harness.port.beginSequence({resume: true});
    await harness.port.play({transaction, direction: 'forward'});
    expect(harness.createPointer).toHaveBeenCalledTimes(1);
    expect(harness.pointer.show).toHaveBeenCalledTimes(1);

    harness.port.detach();
    expect(harness.pointer.remove).toHaveBeenCalledTimes(1);
});

test('does not reveal a typing-hidden pointer when a Play sequence resumes before moving', async () => {
    const harness = makeHarness({cancelled: false, frames: []});
    harness.pointer.idle = jest.fn();
    harness.pointer.show = jest.fn();
    harness.createDriver.mockImplementation(({pointer}) => ({
        cleanup: jest.fn(),
        play: jest.fn(async () => {
            pointer.hideUntilMove();
            return {cancelled: false, frames: []};
        })
    }));

    harness.port.beginSequence();
    await harness.port.play({transaction, direction: 'forward'});
    harness.port.endSequence({preserveAliases: true});
    harness.port.beginSequence({resume: true});
    await harness.port.play({transaction, direction: 'forward'});

    expect(harness.createPointer).toHaveBeenCalledTimes(1);
    expect(harness.pointer.show).not.toHaveBeenCalled();
    expect(harness.pointer.idle).toHaveBeenCalledTimes(1);
});

test('dismisses the lingering Play pointer before pointer-free history', async () => {
    const harness = makeHarness({cancelled: false, frames: []});
    harness.pointer.idle = jest.fn();

    harness.port.beginSequence();
    await harness.port.play({transaction, direction: 'forward'});
    harness.port.endSequence();
    expect(harness.pointer.idle).toHaveBeenCalledTimes(1);
    expect(harness.pointer.remove).not.toHaveBeenCalled();

    harness.port.dismissPointer();
    expect(harness.pointer.remove).toHaveBeenCalledTimes(1);
    harness.port.dismissPointer();
    expect(harness.pointer.remove).toHaveBeenCalledTimes(1);
});

test('publishes a verified variable ID alias to later interactions in the same Play sequence', async () => {
    const harness = makeHarness({
        cancelled: false,
        frames: [],
        resolvedPlan: {blockAliases: null},
        idAliases: {'recorded-cake': 'live-cake'}
    });
    harness.verify.mockResolvedValue({matches: true, evidence: {verified: true}});
    harness.port.beginSequence();

    const first = await harness.port.play({transaction, direction: 'forward'});
    await harness.port.play({transaction, direction: 'forward'});

    expect(first.blockAliases).toEqual({'recorded-cake': 'live-cake'});
    expect(harness.createDriver.mock.calls[0][0].aliases.has('recorded-cake')).toBe(true);
    expect(harness.createDriver.mock.calls[1][0].aliases.get('recorded-cake')).toBe('live-cake');
    harness.port.endSequence();
});

test('preserves verified aliases only when a stopped Play sequence resumes', async () => {
    const driverEvidence = {
        cancelled: false,
        frames: [],
        resolvedPlan: {blockAliases: {'recorded-block': 'live-block'}}
    };
    const harness = makeHarness(driverEvidence);
    const aliasesAtDriverCreation = [];
    harness.createDriver.mockImplementation(options => {
        aliasesAtDriverCreation.push(new Map(options.aliases));
        return {
            cleanup: jest.fn(),
            play: jest.fn(() => Promise.resolve(driverEvidence))
        };
    });
    harness.verify.mockResolvedValue({matches: true, evidence: {verified: true}});

    harness.port.beginSequence();
    await harness.port.play({transaction, direction: 'forward'});
    harness.port.endSequence({preserveAliases: true});
    harness.port.beginSequence({resume: true});
    await harness.port.play({transaction, direction: 'forward'});
    expect(aliasesAtDriverCreation[1].get('recorded-block')).toBe('live-block');

    harness.port.endSequence();
    harness.port.beginSequence({resume: true});
    await harness.port.play({transaction, direction: 'forward'});
    expect(aliasesAtDriverCreation[2].get('recorded-block')).toBe('live-block');
    harness.port.resetSequenceBlockAliases();
    await harness.port.play({transaction, direction: 'forward'});
    expect(aliasesAtDriverCreation[3].has('recorded-block')).toBe(false);
    harness.port.endSequence();
});

test('shares verified aliases with semantic fallback and can invalidate them after checkpoint replacement', async () => {
    const harness = makeHarness({cancelled: false, frames: []});
    harness.port.beginSequence();

    expect(harness.port.getSequenceBlockAliases()).toBeNull();
    harness.port.adoptSequenceBlockAliases({'recorded-block': 'live-block'});
    harness.port.endSequence();
    expect(harness.port.getSequenceBlockAliases()).toEqual({'recorded-block': 'live-block'});

    const snapshot = harness.port.getSequenceBlockAliases();
    snapshot['recorded-block'] = 'mutated-outside';
    expect(harness.port.getSequenceBlockAliases()).toEqual({'recorded-block': 'live-block'});

    harness.port.resetSequenceBlockAliases();
    expect(harness.port.getSequenceBlockAliases()).toBeNull();
    harness.port.endSequence();
});

test('allocates the configured swappable pointer model', async () => {
    const harness = makeHarness({cancelled: false, frames: []});
    const createPointerModel = jest.fn(() => ({name: 'deterministic'}));
    const createPointerControl = jest.fn(({overlay}) => ({...overlay, remove: overlay.remove}));
    const port = createInteractionPlaybackPort({
        workspace: {},
        vm: {},
        ScratchBlocks: {
            WidgetDiv: {isVisible: () => false},
            DropDownDiv: {isVisible: () => false}
        },
        documentObject: {},
        journalCounts: () => ({eventCount: 1, stepCount: 1}),
        createClock: harness.createClock,
        createPointer: harness.createPointer,
        createPointerControl,
        createPointerModel,
        pointerModelName: 'deterministic',
        createScope: harness.createScope,
        createDriver: harness.createDriver,
        verify: harness.verify
    });

    await port.play({transaction, direction: 'forward'});

    expect(createPointerModel).toHaveBeenCalledWith('deterministic');
    expect(createPointerControl).toHaveBeenCalledWith(expect.objectContaining({
        model: {name: 'deterministic'}
    }));
});
