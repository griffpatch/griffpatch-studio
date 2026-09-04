import {createPaintGestureDriver, timedGestureFrames} from
    '../../src/studio/bridge/native-interaction/paint-gesture-driver';

const rect = (left, top, width, height) => ({left, top, width, height, right: left + width, bottom: top + height});
const fakeElement = (target, bounds) => {
    const attributes = new Map([['data-studio-target', target]]);
    const listeners = new Map();
    return {
        value: '',
        getAttribute: name => attributes.has(name) ? attributes.get(name) : null,
        setAttribute: (name, value) => attributes.set(name, String(value)),
        getBoundingClientRect: () => bounds,
        addEventListener: (type, listener) => listeners.set(type, listener),
        dispatchEvent: event => {
            if (listeners.has(event.type)) listeners.get(event.type)(event);
            return true;
        },
        blur () {
            this.dispatchEvent({type: 'blur', target: this});
        }
    };
};
const fakeDocument = elements => {
    const documentObject = {
        querySelector: selector => {
            const match = selector.match(/data-studio-target="([^"]+)"/);
            return match ? elements.get(match[1]) || null : null;
        },
        defaultView: {
            requestAnimationFrame: callback => callback(),
            HTMLInputElement: class HTMLInputElement {},
            Event: class Event {
                constructor (type, options) {
                    this.type = type;
                    Object.assign(this, options);
                }
            },
            InputEvent: class InputEvent {
                constructor (type, options) {
                    this.type = type;
                    Object.assign(this, options);
                }
            },
            MouseEvent: class MouseEvent {
                constructor (type, options) {
                    this.type = type;
                    Object.assign(this, options);
                }
            }
        }
    };
    for (const element of elements.values()) element.ownerDocument = documentObject;
    return documentObject;
};

test('interpolates recorded brush timing into animation frames', () => {
    const frames = timedGestureFrames([
        {x: 0, y: 0, t: 0},
        {x: 0.5, y: 0.25, t: 50},
        {x: 1, y: 1, t: 100}
    ]).map(point => ({
        x: Number(point.x.toFixed(5)),
        y: Number(point.y.toFixed(5)),
        dispatchMouse: point.dispatchMouse
    }));
    expect(frames).toEqual([
        {x: 0, y: 0, dispatchMouse: false},
        {x: 0.16667, y: 0.08333, dispatchMouse: false},
        {x: 0.33333, y: 0.16667, dispatchMouse: false},
        {x: 0.5, y: 0.25, dispatchMouse: true},
        {x: 0.66667, y: 0.5, dispatchMouse: false},
        {x: 0.83333, y: 0.75, dispatchMouse: false},
        {x: 1, y: 1, dispatchMouse: false}
    ]);
});

test('replays a real canvas mouse stroke against the durable costume', async () => {
    const elements = new Map();
    const tab = fakeElement('tab-costumes', rect(0, 0, 80, 30));
    tab.setAttribute('aria-selected', 'true');
    elements.set('tab-costumes', tab);
    const brush = fakeElement('paint-brush-tool', rect(10, 40, 30, 30));
    brush.setAttribute('data-studio-selected', 'true');
    elements.set('paint-brush-tool', brush);
    const canvas = fakeElement('paint-canvas', rect(100, 100, 200, 100));
    elements.set('paint-canvas', canvas);
    const documentObject = fakeDocument(elements);
    const costume = {assetId: 'before', dataFormat: 'svg', name: 'costume1'};
    const target = {
        id: 'sprite-a',
        isStage: false,
        currentCostume: 0,
        getName: () => 'Sprite1',
        getCostumes: () => [costume]
    };
    const vm = {
        editingTarget: target,
        runtime: {targets: [target]},
        updateSvg: jest.fn(() => {
            costume.assetId = 'after';
        })
    };
    canvas.addEventListener('mouseup', () => vm.updateSvg(0, '<svg/>', 0, 0));
    const pointer = {
        travelTo: jest.fn(async pointerTarget => {
            const live = pointerTarget.locate();
            const bounds = live.getBoundingClientRect();
            return {
                completed: true,
                model: 'natural',
                target: {
                    id: pointerTarget.id,
                    point: {
                        x: bounds.left + pointerTarget.anchorX,
                        y: bounds.top + pointerTarget.anchorY
                    },
                    element: live
                },
                frames: []
            };
        }),
        moveTo: jest.fn(),
        press: jest.fn(),
        release: jest.fn()
    };
    const clock = {
        play: async ({points, onFrame}) => {
            for (let index = 0; index < points.length; index++) await onFrame(points[index], index);
            return true;
        }
    };
    const driver = createPaintGestureDriver({
        vm,
        documentObject,
        clock,
        pointer,
        scope: {runWithoutUndo: action => action()}
    });

    const result = await driver.play({
        kind: 'costume-brush-stroke',
        targetRef: {name: 'Sprite1', isStage: false},
        assetKind: 'costume',
        costumeIndex: 0,
        editFormat: 'svg',
        previousCostume: {...costume},
        editedCostume: {...costume, assetId: 'after'},
        paintGesture: {
            tool: 'brush',
            points: [{x: 0.25, y: 0.25, t: 0}, {x: 0.75, y: 0.75, t: 100}]
        }
    });

    expect(result).toMatchObject({controlsVisible: true, projectMatches: true});
    expect(pointer.travelTo).toHaveBeenCalledTimes(1);
    expect(pointer.press).toHaveBeenCalledTimes(1);
    expect(pointer.release).toHaveBeenCalledTimes(1);
    expect(pointer.moveTo).toHaveBeenCalledWith({x: 250, y: 175, dispatchMouse: false});
    expect(vm.updateSvg).toHaveBeenCalledWith(0, '<svg/>', 0, 0);
});

test('reproduces recorded bitmap brush settings through visible controls before drawing', async () => {
    const elements = new Map();
    const tab = fakeElement('tab-costumes', rect(0, 0, 80, 30));
    tab.setAttribute('aria-selected', 'true');
    elements.set('tab-costumes', tab);
    const root = fakeElement('costume-editor', rect(0, 0, 500, 500));
    let style = {brushSize: 10, fillColor: '#9966FF'};
    const syncStyle = () => root.setAttribute('data-studio-brush-style', JSON.stringify(style));
    syncStyle();
    elements.set('costume-editor', root);
    const brush = fakeElement('paint-brush-tool', rect(10, 40, 30, 30));
    brush.setAttribute('data-studio-selected', 'true');
    elements.set('paint-brush-tool', brush);
    const brushSize = fakeElement('paint-brush-size', rect(50, 40, 60, 30));
    brushSize.value = '10';
    brushSize.addEventListener('input', () => {
        style = {...style, brushSize: Number(brushSize.value)};
        syncStyle();
    });
    elements.set('paint-brush-size', brushSize);
    const fillColor = fakeElement('paint-fill-color', rect(120, 40, 40, 30));
    elements.set('paint-fill-color', fillColor);
    const colorInput = fakeElement('paint-color-hex-input', rect(170, 40, 90, 30));
    colorInput.value = '#9966FF';
    colorInput.addEventListener('blur', () => {
        style = {...style, fillColor: colorInput.value};
        syncStyle();
    });
    elements.set('paint-color-hex-input', colorInput);
    const canvas = fakeElement('paint-canvas', rect(100, 100, 200, 100));
    elements.set('paint-canvas', canvas);
    const documentObject = fakeDocument(elements);
    const costume = {
        assetId: 'before',
        dataFormat: 'png',
        name: 'costume1',
        asset: {data: new Uint8Array([1, 2, 3])}
    };
    const target = {
        id: 'sprite-a',
        isStage: false,
        currentCostume: 0,
        getName: () => 'Sprite1',
        getCostumes: () => [costume]
    };
    const vm = {
        editingTarget: target,
        runtime: {targets: [target]},
        updateBitmap: jest.fn(() => {
            costume.assetId = 'encoded-differently';
        })
    };
    canvas.addEventListener('mouseup', () => vm.updateBitmap(0, {}, 0, 0, 2));
    const pointer = {
        travelTo: jest.fn(async pointerTarget => {
            const live = pointerTarget.locate();
            const bounds = live.getBoundingClientRect();
            return {
                completed: true,
                model: 'natural',
                target: {
                    id: pointerTarget.id,
                    point: {
                        x: bounds.left + pointerTarget.anchorX,
                        y: bounds.top + pointerTarget.anchorY
                    },
                    element: live
                },
                frames: []
            };
        }),
        moveTo: jest.fn(),
        press: jest.fn(),
        release: jest.fn(),
        hideUntilMove: jest.fn()
    };
    const clock = {
        play: async ({points, onFrame}) => {
            for (let index = 0; index < points.length; index++) await onFrame(points[index], index);
            return true;
        }
    };
    const driver = createPaintGestureDriver({
        vm,
        documentObject,
        clock,
        pointer,
        scope: {runWithoutUndo: action => action()},
        checkpointPort: {readAsset: jest.fn(async () => new Uint8Array([1, 2, 3]))}
    });

    const result = await driver.play({
        kind: 'costume-brush-stroke',
        targetRef: {name: 'Sprite1', isStage: false},
        assetKind: 'costume',
        costumeIndex: 0,
        editFormat: 'bitmap',
        editedCheckpointId: 7,
        previousCostume: {...costume},
        editedCostume: {...costume, assetId: 'after'},
        paintGesture: {
            tool: 'brush',
            brushStyle: {brushSize: 24, fillColor: '#12ab34'},
            points: [{x: 0.25, y: 0.25, t: 0}, {x: 0.75, y: 0.75, t: 100}]
        }
    });

    expect(result).toMatchObject({
        controlsVisible: true,
        brushStyleMatches: true,
        bitmapVisualMatches: true,
        projectMatches: true
    });
    expect(style).toEqual({brushSize: 24, fillColor: '#12ab34'});
    expect(pointer.travelTo.mock.calls.map(call => call[0].id)).toEqual([
        'paint-brush-size',
        'paint-fill-color',
        'paint-fill-color:hex',
        'paint-canvas:start'
    ]);
    expect(vm.updateBitmap).toHaveBeenCalledWith(0, {}, 0, 0, 2);
});

test.each([
    {
        kind: 'costume-convert-to-bitmap',
        editFormat: 'bitmap',
        controlId: 'paint-convert-to-bitmap',
        methodName: 'updateBitmap',
        previous: {assetId: 'vector', dataFormat: 'svg', name: 'costume1'},
        edited: {assetId: 'bitmap', dataFormat: 'png', name: 'costume1'}
    },
    {
        kind: 'costume-convert-to-vector',
        editFormat: 'svg',
        controlId: 'paint-convert-to-vector',
        methodName: 'updateSvg',
        previous: {assetId: 'bitmap', dataFormat: 'png', name: 'costume1'},
        edited: {assetId: 'vector', dataFormat: 'svg', name: 'costume1'}
    }
])('replays $kind through the visible Scratch Paint control', async ({
    kind,
    editFormat,
    controlId,
    methodName,
    previous,
    edited
}) => {
    const elements = new Map();
    const tab = fakeElement('tab-costumes', rect(0, 0, 80, 30));
    tab.setAttribute('aria-selected', 'true');
    elements.set('tab-costumes', tab);
    const control = fakeElement(controlId, rect(250, 420, 130, 32));
    elements.set(controlId, control);
    const documentObject = fakeDocument(elements);
    const costume = {
        ...previous,
        asset: {data: new Uint8Array([1, 2, 3])}
    };
    const target = {
        id: 'sprite-a',
        isStage: false,
        currentCostume: 0,
        getName: () => 'Sprite1',
        getCostumes: () => [costume]
    };
    const convert = jest.fn(() => {
        Object.assign(costume, edited);
    });
    const vm = {
        editingTarget: target,
        runtime: {targets: [target]},
        [methodName]: convert
    };
    control.addEventListener('click', () => {
        if (methodName === 'updateBitmap') vm.updateBitmap(0, {}, 0, 0, 2);
        else vm.updateSvg(0, '<svg/>', 0, 0);
    });
    const pointer = {
        travelTo: jest.fn(async pointerTarget => ({
            completed: true,
            model: 'natural',
            target: {
                id: pointerTarget.id,
                point: {x: 315, y: 436},
                element: pointerTarget.locate()
            },
            frames: []
        }))
    };
    const driver = createPaintGestureDriver({
        vm,
        documentObject,
        clock: {},
        pointer,
        scope: {runWithoutUndo: action => action()},
        checkpointPort: {readAsset: jest.fn(async () => new Uint8Array([1, 2, 3]))}
    });

    const result = await driver.play({
        kind,
        targetRef: {name: 'Sprite1', isStage: false},
        assetKind: 'costume',
        costumeIndex: 0,
        editFormat,
        editedCheckpointId: 4,
        previousCostume: previous,
        editedCostume: edited
    });

    expect(result).toMatchObject({
        controlsVisible: true,
        brushStyleMatches: true,
        projectMatches: true
    });
    expect(pointer.travelTo.mock.calls.map(call => call[0].id)).toEqual([controlId]);
    expect(convert).toHaveBeenCalledTimes(1);
});
