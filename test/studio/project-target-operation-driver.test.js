import {createProjectTargetOperationDriver} from
    '../../src/studio/bridge/native-interaction/project-target-operation-driver';

const makeHarness = () => {
    class MouseEvent {
        constructor (type, options) {
            this.type = type;
            Object.assign(this, options);
        }
    }
    const elements = new Map();
    const studioElements = new Map();
    const state = {draggedSprite: null, backpackDragging: false};
    const documentObject = {
        defaultView: {
            MouseEvent,
            requestAnimationFrame: callback => callback(),
            dispatchEvent: jest.fn(event => {
                if (event.type === 'mouseup' && state.backpackDragging) {
                    sprite1.blocks._blocks.importedRoot = {id: 'importedRoot'};
                    sprite1.blocks._blocks.importedChild = {id: 'importedChild'};
                    state.backpackDragging = false;
                }
                return true;
            })
        },
        querySelector: selector => {
            const match = selector.match(/data-studio-sprite-name="([^"]+)"/);
            if (match) return elements.get(match[1]) || null;
            const studioMatch = selector.match(/data-studio-target="([^"]+)"/);
            return studioMatch ? studioElements.get(studioMatch[1]) || null : null;
        },
        dispatchEvent: jest.fn(event => {
            if (event.type === 'mouseup' && state.draggedSprite) {
                const index = vm.runtime.targets.indexOf(state.draggedSprite);
                vm.runtime.targets.splice(index, 1);
                vm.runtime.targets.splice(1, 0, state.draggedSprite);
                state.draggedSprite = null;
            }
            return true;
        })
    };
    const blocks = value => ({_blocks: Object.fromEntries(value.map(id => [id, {id}]))});
    const stage = {id: 'stage', isOriginal: true, isStage: true, getName: () => 'Stage', blocks: blocks([])};
    const sprite1 = {
        id: 'sprite-1', isOriginal: true, isStage: false, getName: () => 'Sprite1', blocks: blocks(['root'])
    };
    const apple = {id: 'apple', isOriginal: true, isStage: false, getName: () => 'Apple', blocks: blocks([])};
    const vm = {runtime: {targets: [stage, sprite1, apple]}, editingTarget: sprite1};
    const element = (name, left) => ({
        ownerDocument: documentObject,
        getBoundingClientRect: () => ({left, top: 100, width: 80, height: 90, right: left + 80, bottom: 190}),
        dispatchEvent: jest.fn(event => {
            if (event.type === 'mousedown') state.draggedSprite = vm.runtime.targets.find(target =>
                target.isOriginal && target.getName() === name
            );
            return true;
        })
    });
    elements.set('Sprite1', element('Sprite1', 300));
    elements.set('Apple', element('Apple', 400));
    const rootElement = {
        setAttribute: jest.fn(),
        removeAttribute: jest.fn(),
        getBoundingClientRect: () => ({left: 500, top: 200, width: 120, height: 40, right: 620, bottom: 240})
    };
    const rootBlock = {id: 'root', type: 'motion_movesteps', getSvgRoot: () => rootElement};
    const injectionDiv = {
        ownerDocument: documentObject,
        getBoundingClientRect: () => ({left: 200, top: 50, width: 600, height: 500, right: 800, bottom: 550}),
        dispatchEvent: jest.fn()
    };
    const gesture = {
        forceStartBlockDrag: jest.fn(),
        handleMove: jest.fn(),
        handleUp: jest.fn(() => {
            apple.blocks._blocks = {copied: {id: 'copied'}};
        }),
        cancel: jest.fn()
    };
    const workspace = {
        currentGesture_: null,
        getBlockById: id => id === 'root' ? rootBlock : null,
        getInjectionDiv: () => injectionDiv,
        getCanvas: () => ({getScreenCTM: () => ({a: 1, b: 0, c: 0, d: 1, e: 0, f: 0})}),
        getGesture: jest.fn(() => gesture)
    };
    const pointer = {
        travelTo: jest.fn(async (target, options = {}) => {
            const targetElement = target.locate();
            const rect = targetElement.getBoundingClientRect();
            const point = {x: rect.left + (rect.width / 2), y: rect.top + (rect.height / 2)};
            const frames = [{x: point.x - 4, y: point.y - 3}, point];
            if (options.onFrame) frames.forEach((frame, index) => options.onFrame(frame, index));
            return {
                completed: true,
                model: 'natural',
                target: {id: target.id, kind: target.kind, point, element: targetElement},
                frames,
                initialPlacement: false
            };
        }),
        press: jest.fn(),
        release: jest.fn()
    };
    const scope = {runWithoutUndo: jest.fn(callback => callback())};
    const clock = {play: jest.fn(async ({onFrame}) => {
        await onFrame();
        return true;
    })};
    const driver = createProjectTargetOperationDriver({
        workspace,
        vm,
        documentObject,
        clock,
        pointer,
        scope
    });
    return {driver, documentObject, gesture, workspace, pointer, clock, scope, vm, apple, sprite1, studioElements, state};
};

test('reorders sprite cards by forwarding every pointer frame through the DOM drag', async () => {
    const harness = makeHarness();
    const result = await harness.driver.play({
        kind: 'sprite-reorder-drag',
        movedTargetRef: {name: 'Apple', isStage: false},
        targetIndex: 2,
        newIndex: 1
    });

    expect(harness.vm.runtime.targets.map(target => target.getName())).toEqual(['Stage', 'Apple', 'Sprite1']);
    expect(harness.documentObject.dispatchEvent.mock.calls.map(([event]) => event.type)).toEqual([
        'mousemove', 'mousemove', 'mouseup'
    ]);
    expect(harness.pointer.press).toHaveBeenCalledTimes(1);
    expect(harness.pointer.release).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({controlsVisible: true, projectMatches: true, pointerTravel: {completed: true}});
});

test('copies a script with a genuine Blockly gesture while preserving the source', async () => {
    const harness = makeHarness();
    const result = await harness.driver.play({
        kind: 'cross-sprite-script-drag',
        sourceTargetRef: {name: 'Sprite1', isStage: false},
        targetRef: {name: 'Apple', isStage: false},
        sourceBlockRef: {
            ancestorId: 'root',
            ancestorType: 'motion_movesteps',
            ancestorCoordinate: null,
            path: []
        },
        copiedBlockCount: 1,
        presentation: {grabOffset: {x: 0.5, y: 0.5}}
    });

    expect(harness.gesture.forceStartBlockDrag).toHaveBeenCalledTimes(1);
    expect(harness.gesture.handleMove).toHaveBeenCalledTimes(3);
    expect(harness.gesture.handleUp).toHaveBeenCalledTimes(1);
    expect(harness.gesture.cancel).not.toHaveBeenCalled();
    expect(harness.clock.play).toHaveBeenCalledWith(expect.objectContaining({holdFrames: 8}));
    expect(harness.clock.play.mock.invocationCallOrder[0])
        .toBeLessThan(harness.gesture.handleUp.mock.invocationCallOrder[0]);
    expect(harness.vm.editingTarget).toBe(harness.sprite1);
    expect(Object.keys(harness.sprite1.blocks._blocks)).toEqual(['root']);
    expect(Object.keys(harness.apple.blocks._blocks)).toEqual(['copied']);
    expect(result).toMatchObject({
        controlsVisible: true,
        projectMatches: true,
        sourceBlockCount: 1,
        targetBlockCount: 1,
        pointerTravel: {completed: true}
    });
});

test('cancels a copy during its held-drop beat without releasing onto the sprite', async () => {
    const harness = makeHarness();
    harness.gesture.forceStartBlockDrag.mockImplementation(() => {
        harness.workspace.currentGesture_ = harness.gesture;
    });
    harness.clock.play.mockResolvedValue(false);
    const result = await harness.driver.play({
        kind: 'cross-sprite-script-drag',
        sourceTargetRef: {name: 'Sprite1', isStage: false},
        targetRef: {name: 'Apple', isStage: false},
        sourceBlockRef: {ancestorId: 'root', ancestorType: 'motion_movesteps', path: []},
        copiedBlockCount: 1,
        presentation: {grabOffset: {x: 16, y: 18}}
    });
    expect(result.cancelled).toBe(true);
    expect(harness.gesture.handleUp).not.toHaveBeenCalled();
    expect(harness.gesture.cancel).toHaveBeenCalledTimes(1);
    expect(harness.pointer.release).toHaveBeenCalledTimes(1);
    expect(Object.keys(harness.apple.blocks._blocks)).toEqual([]);
    expect(harness.vm.editingTarget).toBe(harness.sprite1);
});

test('imports a retained Backpack script through the real DOM drag boundary', async () => {
    const harness = makeHarness();
    const item = {
        ownerDocument: harness.documentObject,
        getBoundingClientRect: () => ({left: 100, top: 600, width: 90, height: 70, right: 190, bottom: 670}),
        dispatchEvent: jest.fn(event => {
            if (event.type === 'mousedown') harness.state.backpackDragging = true;
        })
    };
    harness.studioElements.set('backpack-item:script:17', item);

    const result = await harness.driver.play({
        kind: 'backpack-script-drag',
        targetRef: {name: 'Sprite1', isStage: false},
        backpackItem: {kind: 'backpack', id: '17', type: 'script', name: 'code'},
        copiedBlockCount: 2,
        destination: {parentId: null, inputName: null, coordinate: {x: 300, y: 180}}
    });

    expect(item.dispatchEvent).toHaveBeenCalledWith(expect.objectContaining({type: 'mousedown'}));
    expect(harness.documentObject.defaultView.dispatchEvent.mock.calls.map(([event]) => event.type))
        .toEqual(['mousemove', 'mousemove', 'mousemove', 'mouseup']);
    expect(Object.keys(harness.sprite1.blocks._blocks)).toEqual(['root', 'importedRoot', 'importedChild']);
    expect(result).toMatchObject({
        controlsVisible: true,
        projectMatches: true,
        targetBlockCount: 3,
        pointerTravel: {completed: true}
    });
});

test('declines Backpack presentation when the external item is no longer present', async () => {
    const harness = makeHarness();
    const toggle = {
        ownerDocument: harness.documentObject,
        getBoundingClientRect: () => ({left: 0, top: 700, width: 200, height: 30, right: 200, bottom: 730}),
        dispatchEvent: jest.fn()
    };
    harness.studioElements.set('backpack-toggle', toggle);

    await expect(harness.driver.play({
        kind: 'backpack-script-drag',
        targetRef: {name: 'Sprite1', isStage: false},
        backpackItem: {kind: 'backpack', id: 'missing', type: 'script', name: 'code'},
        copiedBlockCount: 2,
        destination: {parentId: null, inputName: null, coordinate: {x: 300, y: 180}}
    })).resolves.toEqual({
        unsupported: true,
        reason: 'Recorded Backpack script is unavailable'
    });
    expect(toggle.dispatchEvent).toHaveBeenCalledWith(expect.objectContaining({type: 'click'}));
});
