import {createScratchBlocksDropdownDriver} from '../../src/studio/bridge/native-interaction/scratch-blocks-dropdown-driver';

test('opens a real Blockly dropdown gesture and clicks the language-neutral option', async () => {
    class FieldDropdown {}
    let menuVisible = false;
    const MouseEvent = class {
        constructor (type, options) {
            this.type = type;
            Object.assign(this, options);
        }
    };
    const defaultView = {MouseEvent};
    const optionElements = [0, 1].map(index => ({
        ownerDocument: {defaultView},
        getBoundingClientRect: () => ({left: 400, top: 200 + (index * 30), width: 120, height: 30}),
        dispatchEvent: jest.fn()
    }));
    const field = new FieldDropdown();
    Object.assign(field, {
        getOptions: () => [['mouse-pointer', '_mouse_'], ['random position', '_random_']],
        getSvgRoot: () => ({
            getBoundingClientRect: () => ({left: 100, top: 80, width: 90, height: 30})
        }),
        getValue: () => '_mouse_',
        showEditor_: () => {
            menuVisible = true;
        }
    });
    const block = {id: 'point-block', type: 'motion_pointtowards', getField: () => field};
    const gesture = {
        setStartField: jest.fn(),
        handleBlockStart: jest.fn(),
        handleWsStart: jest.fn(),
        handleUp: jest.fn(() => {
            field.showEditor_();
            workspace.currentGesture_ = null;
        })
    };
    const workspace = {
        currentGesture_: null,
        getBlockById: id => (id === block.id ? block : null),
        getGesture: () => {
            workspace.currentGesture_ = gesture;
            return gesture;
        }
    };
    const ScratchBlocks = {
        FieldDropdown,
        DropDownDiv: {
            isVisible: () => menuVisible,
            getContentDiv: () => ({querySelectorAll: () => optionElements}),
            hideWithoutAnimation: () => {
                menuVisible = false;
            }
        }
    };
    const travels = [];
    const pointer = {
        travelTo: async target => {
            const element = target.locate();
            const rect = element.getBoundingClientRect();
            const resolved = {
                id: target.id,
                kind: target.kind,
                element,
                bounds: rect,
                point: {x: rect.left + (rect.width / 2), y: rect.top + (rect.height / 2)}
            };
            const travel = {
                completed: true,
                model: 'natural',
                target: resolved,
                frames: [resolved.point],
                initialPlacement: travels.length === 0
            };
            travels.push(travel);
            return travel;
        }
    };
    const scope = {runWithoutUndo: callback => callback()};
    const driver = createScratchBlocksDropdownDriver({
        workspace,
        ScratchBlocks,
        clock: {},
        pointer,
        scope,
        aliases: new Map([
            ['recorded-mouse', '_mouse_'],
            ['recorded-random', '_random_']
        ])
    });

    const result = await driver.play({
        kind: 'dropdown-field-select',
        blockId: block.id,
        blockType: block.type,
        blockRef: null,
        fieldName: 'TOWARDS',
        sourceValue: 'recorded-mouse',
        value: 'recorded-random'
    });

    expect(result).toMatchObject({
        cancelled: false,
        menuVisibleBeforeClick: true,
        optionIndex: 1,
        optionValue: '_random_',
        resolvedPlan: {sourceValue: '_mouse_', value: '_random_'},
        pointerTravel: {
            model: 'natural',
            target: {kind: 'dropdown-option'},
            stages: {
                field: {target: {kind: 'block-field'}},
                option: {target: {kind: 'dropdown-option'}}
            }
        }
    });
    expect(gesture.setStartField).toHaveBeenCalledWith(field);
    expect(gesture.handleUp).toHaveBeenCalledTimes(1);
    expect(optionElements[1].dispatchEvent.mock.calls.map(([event]) => event.type)).toEqual([
        'mouseover',
        'mousedown',
        'mouseup',
        'click'
    ]);
    expect(travels).toHaveLength(2);
});
