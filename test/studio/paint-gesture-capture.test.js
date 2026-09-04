import {createPaintGestureCapture} from '../../src/studio/bridge/paint-gesture-capture';

const eventHub = () => {
    const listeners = new Map();
    return {
        addEventListener: (type, listener) => {
            if (!listeners.has(type)) listeners.set(type, new Set());
            listeners.get(type).add(listener);
        },
        removeEventListener: (type, listener) => {
            if (listeners.has(type)) listeners.get(type).delete(listener);
        },
        emit: (type, event) => {
            for (const listener of listeners.get(type) || []) listener(event);
        }
    };
};

const fakeElement = tagName => {
    const attributes = new Map();
    return {
        tagName,
        getAttribute: name => attributes.has(name) ? attributes.get(name) : null,
        setAttribute: (name, value) => attributes.set(name, String(value)),
        closest (selector) {
            return selector.includes('button') && tagName === 'button' ? this : null;
        }
    };
};

const makeEditor = ({selected = true, canvasRect = {left: 100, top: 50, width: 200, height: 100}} = {}) => {
    const documentEvents = eventHub();
    const rootEvents = eventHub();
    let colorHex = null;
    const documentObject = {
        ...documentEvents,
        querySelector: selector => selector.includes('placeholder') ? colorHex : null,
        defaultView: {MutationObserver: null}
    };
    const brush = fakeElement('button');
    brush.setAttribute('title', 'Brush (B)');
    if (selected) brush.setAttribute('class', 'paint_is-selected_abc');
    const line = fakeElement('button');
    line.setAttribute('title', 'Line (L)');
    const canvas = fakeElement('canvas');
    canvas.setAttribute('resize', 'true');
    canvas.getBoundingClientRect = () => canvasRect;
    colorHex = fakeElement('input');
    const conversion = fakeElement('button');
    const rootAttributes = new Map([
        ['data-studio-brush-style', JSON.stringify({
            brushSize: 12,
            fillColor: '#12ab34'
        })],
        ['data-studio-edit-format', 'svg']
    ]);
    const root = {
        ...rootEvents,
        ownerDocument: documentObject,
        getAttribute: name => rootAttributes.has(name) ? rootAttributes.get(name) : null,
        setAttribute: (name, value) => rootAttributes.set(name, String(value)),
        querySelector: selector => {
            if (selector.includes('(B)')) return brush;
            if (selector.includes('bitmap-button') && selector.includes('[role="button"]')) return conversion;
            if (selector.includes('canvas')) return canvas;
            return null;
        },
        querySelectorAll: () => [],
        contains: element => [brush, line, canvas, conversion].includes(element)
    };
    const emit = (target, type, options) => {
        const event = {
            target,
            button: 0,
            buttons: 1,
            clientX: 0,
            clientY: 0,
            timeStamp: 100,
            ...options
        };
        if (['mousemove', 'mouseup'].includes(type)) documentObject.emit(type, event);
        else root.emit(type, event);
    };
    return {root, brush, line, canvas, colorHex, conversion, emit};
};

test('annotates and captures a normalized, one-shot vector brush gesture', () => {
    const editor = makeEditor();
    const capture = createPaintGestureCapture({root: editor.root});

    expect(editor.brush.getAttribute('data-studio-target')).toBe('paint-brush-tool');
    expect(editor.brush.getAttribute('data-studio-selected')).toBe('true');
    expect(editor.canvas.getAttribute('data-studio-target')).toBe('paint-canvas');
    expect(editor.colorHex.getAttribute('data-studio-target')).toBe('paint-color-hex-input');
    expect(editor.conversion.getAttribute('data-studio-target')).toBe('paint-convert-to-bitmap');

    editor.root.setAttribute('data-studio-edit-format', 'bitmap');
    capture.refresh();
    expect(editor.conversion.getAttribute('data-studio-target')).toBe('paint-convert-to-vector');

    editor.emit(editor.canvas, 'mousedown', {clientX: 120, clientY: 60, timeStamp: 100});
    editor.emit(editor.canvas, 'mousemove', {clientX: 200, clientY: 100, timeStamp: 150});
    editor.emit(editor.canvas, 'mouseup', {clientX: 280, clientY: 140, timeStamp: 200, buttons: 0});

    expect(capture.consume()).toEqual({
        tool: 'brush',
        durationMs: 100,
        brushStyle: {
            brushSize: 12,
            fillColor: '#12ab34'
        },
        points: [
            {x: 0.1, y: 0.1, t: 0},
            {x: 0.5, y: 0.5, t: 50},
            {x: 0.9, y: 0.9, t: 100}
        ]
    });
    expect(capture.consume()).toBeNull();
    capture.detach();
});

test('preserves enough normalized precision to reconstruct exact canvas coordinates', () => {
    const canvasRect = {
        left: 293,
        top: 236.33334350585935,
        width: 466.6666870117187,
        height: 396.6666870117187
    };
    const editor = makeEditor({canvasRect});
    const capture = createPaintGestureCapture({root: editor.root});

    editor.emit(editor.canvas, 'mousedown', {clientX: 470, clientY: 387, timeStamp: 100});
    editor.emit(editor.canvas, 'mouseup', {clientX: 582, clientY: 466, timeStamp: 110, buttons: 0});

    const gesture = capture.consume();
    expect(canvasRect.left + (gesture.points[0].x * canvasRect.width)).toBeCloseTo(470, 12);
    expect(canvasRect.top + (gesture.points[0].y * canvasRect.height)).toBeCloseTo(387, 12);
    expect(canvasRect.left + (gesture.points[1].x * canvasRect.width)).toBeCloseTo(582, 12);
    expect(canvasRect.top + (gesture.points[1].y * canvasRect.height)).toBeCloseTo(466, 12);
    capture.detach();
});

test('records only active brush gestures and retains a one-shot gesture for bitmap editing', () => {
    const editor = makeEditor({selected: false});
    const capture = createPaintGestureCapture({root: editor.root});

    editor.emit(editor.canvas, 'mousedown', {clientX: 120, clientY: 60});
    editor.emit(editor.canvas, 'mouseup', {clientX: 140, clientY: 70, buttons: 0});
    expect(capture.consume()).toBeNull();

    editor.emit(editor.brush, 'click', {buttons: 0});
    editor.emit(editor.canvas, 'mousedown', {clientX: 120, clientY: 60});
    editor.emit(editor.canvas, 'mouseup', {clientX: 140, clientY: 70, timeStamp: 150, buttons: 0});
    expect(capture.consume()).toMatchObject({
        tool: 'brush',
        points: [{x: 0.1, y: 0.1, t: 0}, {x: 0.2, y: 0.2, t: 50}]
    });
    expect(capture.consume()).toBeNull();

    editor.emit(editor.line, 'click', {buttons: 0});
    editor.emit(editor.canvas, 'mousedown', {clientX: 120, clientY: 60});
    editor.emit(editor.canvas, 'mouseup', {clientX: 140, clientY: 70, buttons: 0});
    expect(capture.consume()).toBeNull();
    capture.detach();
});
