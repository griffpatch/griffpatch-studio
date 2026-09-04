import {createScratchBlocksBroadcastDriver} from
    '../../src/studio/bridge/native-interaction/scratch-blocks-broadcast-driver';

test('opens new-message dropdown option, types the prompt and creates the recorded broadcast ID', async () => {
    class MouseEvent {
        constructor (type, options) {
            this.type = type;
            Object.assign(this, options);
        }
    }
    class Event {
        constructor (type, options) {
            this.type = type;
            Object.assign(this, options);
        }
    }
    class InputEvent extends Event {}
    class HTMLInputElement {
        get value () {
            return this.value_ || '';
        }
        set value (value) {
            this.value_ = value;
        }
    }
    const defaultView = {
        MouseEvent,
        Event,
        InputEvent,
        HTMLInputElement,
        requestAnimationFrame: callback => callback()
    };
    let promptOpen = true;
    let variable = null;
    const targets = {};
    const documentObject = {
        defaultView,
        activeElement: null,
        querySelector: selector => {
            const match = selector.match(/data-studio-target="([^"]+)"/);
            return promptOpen && match ? targets[match[1]] || null : null;
        }
    };
    const element = (id, onClick = () => {}) => ({
        id,
        ownerDocument: documentObject,
        getBoundingClientRect: () => ({left: 100, top: 80, width: 160, height: 36}),
        dispatchEvent: event => {
            if (event.type === 'click') onClick();
            return true;
        },
        focus: jest.fn()
    });
    const input = Object.assign(new HTMLInputElement(), element('prompt-variable-name'));
    input.ownerDocument = documentObject;
    input.dispatchEvent = jest.fn(() => true);
    documentObject.activeElement = input;
    const scratchBlocks = {
        NEW_BROADCAST_MESSAGE_ID: 'NEW_BROADCAST_MESSAGE_ID',
        DropDownDiv: {isVisible: () => false},
        utils: {genUid: jest.fn(() => 'ordinary-id')}
    };
    const ok = element('prompt-ok', () => {
        variable = {
            id: scratchBlocks.utils.genUid(),
            name: 'start game',
            type: 'broadcast_msg',
            getId () {
                return this.id;
            }
        };
        promptOpen = false;
    });
    const cancel = element('prompt-cancel', () => {
        promptOpen = false;
    });
    Object.assign(targets, {
        'prompt-variable-name': input,
        'prompt-ok': ok,
        'prompt-cancel': cancel
    });
    const workspace = {getVariableById: id => variable && variable.id === id ? variable : null};
    const travels = [];
    const pointer = {
        travelTo: async target => {
            const targetElement = target.locate();
            const bounds = targetElement.getBoundingClientRect();
            const travel = {
                completed: true,
                model: 'natural',
                target: {
                    id: target.id,
                    kind: target.kind,
                    element: targetElement,
                    bounds,
                    point: {x: bounds.left + (bounds.width / 2), y: bounds.top + (bounds.height / 2)}
                },
                frames: [],
                initialPlacement: travels.length === 0
            };
            travels.push(travel);
            return travel;
        }
    };
    const dropdownTravel = {
        completed: true,
        model: 'natural',
        target: {id: 'new-message'},
        frames: [],
        initialPlacement: true
    };
    const dropdownPlay = jest.fn(async plan => ({
        cancelled: false,
        resolvedPlan: {...plan, blockId: 'live-menu', sourceValue: 'old-message'},
        pointerTravel: dropdownTravel,
        menuVisibleBeforeClick: true,
        optionValue: 'NEW_BROADCAST_MESSAGE_ID'
    }));
    const driver = createScratchBlocksBroadcastDriver({
        workspace,
        ScratchBlocks: scratchBlocks,
        documentObject,
        pointer,
        scope: {runWithoutUndo: callback => callback()},
        clock: {
            play: async ({points, onFrame}) => {
                points.forEach(onFrame);
                return true;
            }
        },
        createDropdownDriver: () => ({play: dropdownPlay})
    });

    const result = await driver.play({
        kind: 'broadcast-create-dialog',
        blockId: 'recorded-menu',
        fieldName: 'BROADCAST_OPTION',
        sourceValue: 'old-message',
        value: 'message-id',
        varId: 'message-id',
        varName: 'start game',
        varType: 'broadcast_msg'
    });

    expect(dropdownPlay).toHaveBeenCalledWith(expect.objectContaining({
        value: 'NEW_BROADCAST_MESSAGE_ID'
    }), null);
    expect(result).toMatchObject({
        cancelled: false,
        resolvedPlan: {blockId: 'live-menu', value: 'message-id'},
        idAliases: {'message-id': 'message-id'},
        menuVisibleBeforeClick: true,
        dialogVisibleBeforeSubmit: true,
        intermediateValues: ['s', 'st', 'sta', 'star', 'start', 'start ', 'start g', 'start ga', 'start gam',
            'start game'],
        pointerTravel: {
            completed: true,
            stages: {
                dropdown: {target: {id: 'new-message'}},
                ok: {target: {kind: 'dialog-confirm'}}
            }
        }
    });
    expect(input.focus).not.toHaveBeenCalled();
    expect(travels).toHaveLength(1);
    expect(scratchBlocks.utils.genUid).toHaveBeenCalledTimes(0);

    promptOpen = true;
    expect(driver.cleanup()).toBe(true);
    expect(promptOpen).toBe(false);
});
