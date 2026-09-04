import {createScratchBlocksFieldDriver} from
    '../../src/studio/bridge/native-interaction/scratch-blocks-field-driver';

test('opens a real Blockly text editor, types visibly and commits with Enter', async () => {
    class FieldDropdown {}
    class FieldTextInput {}
    class Event {
        constructor (type, options) {
            this.type = type;
            Object.assign(this, options);
        }
    }
    class InputEvent extends Event {}
    class KeyboardEvent extends Event {}
    class HTMLInputElement {
        get value () {
            return this.value_ || '';
        }
        set value (value) {
            this.value_ = value;
        }
    }
    const defaultView = {
        Event,
        InputEvent,
        KeyboardEvent,
        HTMLInputElement,
        requestAnimationFrame: callback => callback()
    };
    let editorVisible = false;
    let value = '';
    const documentObject = {
        defaultView,
        activeElement: null,
        querySelector: selector => selector === '.blocklyHtmlInput' && editorVisible ? editor : null
    };
    const editor = new HTMLInputElement();
    Object.assign(editor, {
        ownerDocument: documentObject,
        getBoundingClientRect: () => ({left: 120, top: 90, width: 100, height: 28}),
        dispatchEvent: jest.fn(event => {
            if (event.type === 'keydown' && event.keyCode === 13) {
                value = editor.value;
            }
            return true;
        })
    });
    const fieldRoot = {getBoundingClientRect: () => ({left: 100, top: 80, width: 80, height: 32})};
    const field = new FieldTextInput();
    Object.assign(field, {getValue: () => value, getSvgRoot: () => fieldRoot});
    const block = {id: 'text-block', getField: () => field};
    const gesture = {
        setStartField: jest.fn(),
        handleBlockStart: jest.fn(),
        handleWsStart: jest.fn(),
        handleUp: jest.fn(() => {
            editorVisible = true;
            documentObject.activeElement = editor;
        })
    };
    const workspace = {
        currentGesture_: null,
        getBlockById: id => id === block.id ? block : null,
        getGesture: () => gesture
    };
    const pointer = {
        hide: jest.fn(),
        travelTo: async target => {
            const element = target.locate();
            const bounds = element.getBoundingClientRect();
            return {
                completed: true,
                model: 'natural',
                target: {
                    id: target.id,
                    kind: target.kind,
                    element,
                    bounds,
                    point: {x: bounds.left + (bounds.width / 2), y: bounds.top + (bounds.height / 2)}
                },
                frames: [],
                initialPlacement: true
            };
        }
    };
    const runWithoutUndo = jest.fn(callback => callback());
    const hideWidget = jest.fn(() => { editorVisible = false; });
    const driver = createScratchBlocksFieldDriver({
        workspace,
        ScratchBlocks: {
            FieldDropdown,
            FieldTextInput,
            WidgetDiv: {isVisible: () => editorVisible, hide: hideWidget},
            DropDownDiv: {isVisible: () => false}
        },
        documentObject,
        pointer,
        scope: {runWithoutUndo},
        clock: {play: async ({points, onFrame}) => { points.forEach(onFrame); return true; }}
    });

    const result = await driver.play({
        kind: 'block-field-edit',
        blockId: block.id,
        fieldName: 'TEXT',
        sourceValue: '',
        value: 'smoke'
    });

    expect(result).toMatchObject({
        cancelled: false,
        interactionKind: 'text-input',
        editorVisibleBeforeCommit: true,
        editorClosed: true,
        intermediateValues: ['s', 'sm', 'smo', 'smok', 'smoke'],
        resolvedPlan: {blockId: block.id},
        pointerTravel: {completed: true, target: {kind: 'block-field'}}
    });
    expect(value).toBe('smoke');
    expect(pointer.hide).toHaveBeenCalledTimes(1);
    expect(gesture.setStartField).toHaveBeenCalledWith(field);
    expect(runWithoutUndo).toHaveBeenCalledTimes(8);
    expect(hideWidget).toHaveBeenCalledTimes(1);
    expect(hideWidget).toHaveBeenCalledWith(true);
    expect(editor.dispatchEvent.mock.calls.some(([event]) => event.type === 'keydown' && event.keyCode === 13))
        .toBe(true);
});
