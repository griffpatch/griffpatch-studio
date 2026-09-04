import {selectScratchTargetThroughPointer} from
    '../../src/studio/bridge/native-interaction/scratch-target-selection-driver';

test('moves to and clicks the durable sprite selector target', async () => {
    class MouseEvent {
        constructor (type, options) {
            this.type = type;
            Object.assign(this, options);
        }
    }
    const sprite = {
        id: 'sprite-b',
        isOriginal: true,
        isStage: false,
        getName: () => 'Apple'
    };
    const vm = {
        editingTarget: {id: 'sprite-a'},
        runtime: {
            targets: [sprite],
            getTargetById: () => null
        }
    };
    const documentObject = {
        defaultView: {MouseEvent, requestAnimationFrame: callback => callback()},
        querySelector: selector => selector === '[data-studio-sprite-name="Apple"]' ? element : null
    };
    const element = {
        ownerDocument: documentObject,
        getBoundingClientRect: () => ({left: 300, top: 400, width: 80, height: 90}),
        dispatchEvent: jest.fn(event => {
            if (event.type === 'click') vm.editingTarget = sprite;
            return true;
        })
    };
    const pointer = {
        travelTo: jest.fn(async target => ({
            completed: true,
            target: {
                id: target.id,
                kind: target.kind,
                element: target.locate(),
                point: {x: 340, y: 445}
            },
            frames: []
        }))
    };
    const runWithoutUndo = jest.fn(callback => callback());

    await expect(selectScratchTargetThroughPointer({
        vm,
        item: {targetRef: {name: 'Apple', isStage: false}},
        documentObject,
        clock: {},
        pointer,
        scope: {runWithoutUndo}
    })).resolves.toMatchObject({
        status: 'verified',
        targetId: 'sprite-b',
        targetName: 'Apple',
        pointerTravel: {target: {kind: 'sprite-selector'}}
    });
    expect(pointer.travelTo).toHaveBeenCalledTimes(1);
    expect(element.dispatchEvent.mock.calls.map(([event]) => event.type)).toEqual([
        'mouseover', 'mousedown', 'mouseup', 'click'
    ]);
    expect(runWithoutUndo).toHaveBeenCalledTimes(1);
});

test('fails open to semantic selection when the target card is not rendered', async () => {
    const sprite = {id: 'sprite-b', isOriginal: true, isStage: false, getName: () => 'Apple'};
    await expect(selectScratchTargetThroughPointer({
        vm: {
            editingTarget: {id: 'sprite-a'},
            runtime: {targets: [sprite], getTargetById: () => null}
        },
        item: {targetRef: {name: 'Apple', isStage: false}},
        documentObject: {querySelector: () => null},
        clock: {},
        pointer: {},
        scope: {}
    })).resolves.toEqual({status: 'unsupported', reason: 'the target selector card is unavailable'});
});

test('the first sprite click starts at the current card, not at the destination', async () => {
    const source = {id: 'a', getName: () => 'Sprite1'};
    const destination = {id: 'b', getName: () => 'Apple'};
    const vm = {editingTarget: source, runtime: {getTargetById: () => destination}};
    const currentElement = {};
    const destinationElement = {};
    const travelTo = jest.fn(target => Promise.resolve({completed: true, target: {element: target.locate()}}));
    const pointer = {
        getPosition: () => null,
        travelTo,
        click: () => {
            vm.editingTarget = destination;
            return Promise.resolve(true);
        }
    };
    const result = await selectScratchTargetThroughPointer({
        vm,
        item: {targetId: 'b'},
        pointer,
        clock: {},
        scope: {},
        documentObject: {querySelector: selector => (selector.includes('Sprite1') ?
            currentElement : destinationElement)}
    });
    expect(result.status).toBe('verified');
    expect(travelTo.mock.calls.map(([target]) => target.locate())).toEqual([currentElement, destinationElement]);
});

test.each([false, true])('selection waits at its timing barrier before continuing (cancelled: %s)', async cancel => {
    const source = {id: 'a'};
    const destination = {id: 'b', getName: () => 'Apple'};
    const vm = {editingTarget: source, runtime: {getTargetById: () => destination}};
    const controller = new AbortController();
    let finishPause;
    let finished = false;
    const afterTargetSelection = jest.fn(() => new Promise(resolve => { finishPause = resolve; }));
    const pointer = {
        travelTo: jest.fn(() => Promise.resolve({completed: true})),
        click: () => { vm.editingTarget = destination; return Promise.resolve(true); }
    };
    const options = {
        vm, item: {targetId: 'b'}, pointer, clock: {}, scope: {},
        documentObject: {querySelector: () => ({})},
        afterTargetSelection, signal: controller.signal
    };
    const selection = selectScratchTargetThroughPointer(options).then(result => { finished = true; return result; });
    for (let step = 0; step < 10 && !finishPause; step++) await Promise.resolve();
    expect(vm.editingTarget).toBe(destination);
    expect(finished).toBe(false);
    expect(afterTargetSelection).toHaveBeenCalledWith({signal: controller.signal});
    if (cancel) controller.abort();
    finishPause();
    expect((await selection).status).toBe(cancel ? 'cancelled' : 'verified');
    if (!cancel) {
        const alreadySelected = await selectScratchTargetThroughPointer(options);
        expect(alreadySelected.alreadySelected).toBe(true);
        expect(afterTargetSelection).toHaveBeenCalledTimes(1);
    }
});
