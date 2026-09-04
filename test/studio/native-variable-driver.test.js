import {createScratchBlocksVariableDriver} from '../../src/studio/bridge/native-interaction/scratch-blocks-variable-driver';

test('opens the real variable route, types visibly, selects local scope and returns an ID alias', async () => {
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
    let promptOpen = false;
    let variable = null;
    let placeholderId = null;
    const targetElements = {};
    const element = (id, onEvent = () => {}) => ({
        id,
        ownerDocument: documentObject,
        getBoundingClientRect: () => ({left: 100, top: 80, width: 120, height: 30}),
        dispatchEvent: event => {
            onEvent(event);
            return true;
        },
        focus: jest.fn()
    });
    const documentObject = {
        defaultView,
        activeElement: null,
        querySelector: selector => {
            if (selector === '#promptModal') return promptOpen ? {id: 'promptModal'} : null;
            const match = selector.match(/data-studio-target="([^"]+)"/);
            return promptOpen && match ? targetElements[match[1]] || null : null;
        }
    };
    const input = Object.assign(new HTMLInputElement(), element('prompt-variable-name'));
    input.ownerDocument = documentObject;
    input.getBoundingClientRect = () => ({left: 300, top: 150, width: 220, height: 36});
    input.dispatchEvent = jest.fn(() => true);
    input.focus = jest.fn(() => { documentObject.activeElement = input; });
    const globalRadio = Object.assign(element('prompt-scope-global'), {checked: true});
    const localRadio = Object.assign(element('prompt-scope-local', event => {
        if (event.type === 'click') {
            localRadio.checked = true;
            globalRadio.checked = false;
        }
    }), {checked: false});
    const cancel = element('prompt-cancel', event => {
        if (event.type === 'click') promptOpen = false;
    });
    let scratchBlocks;
    const ok = element('prompt-ok', event => {
        if (event.type === 'click') {
            variable = {
                id: scratchBlocks.utils.genUid(),
                name: 'cake',
                type: '',
                isLocal: true,
                isCloud: false
            };
            // Scratch refreshes the composite flyout synchronously and may
            // generate placeholder IDs during the same click callback.
            placeholderId = scratchBlocks.utils.genUid();
            promptOpen = false;
        }
    });
    Object.assign(targetElements, {
        'prompt-variable-name': input,
        'prompt-scope-global': globalRadio,
        'prompt-scope-local': localRadio,
        'prompt-cancel': cancel,
        'prompt-ok': ok
    });

    const callback = jest.fn();
    const categoryElement = element('variables-category');
    const buttonElement = element('create-variable', event => {
        if (event.type === 'click') {
            promptOpen = true;
            documentObject.activeElement = input;
        }
    });
    const flyoutWorkspace = {
        getAllBlocks: () => variable ? [{
            type: 'data_setvariableto',
            getField: name => name === 'VARIABLE' ? {getValue: () => variable.id} : null
        }] : []
    };
    const workspace = {
        toolbox_: {
            getSelectedCategoryId: () => 'variables',
            categoryMenu_: {categories_: [{id_: 'variables', item_: categoryElement}]}
        },
        getFlyout: () => ({
            buttons_: [{callback_: callback, svgGroup_: buttonElement}],
            getWorkspace: () => flyoutWorkspace
        }),
        getButtonCallback: key => (key === 'CREATE_VARIABLE' ? callback : null),
        getVariable: (name, type) => variable && variable.name === name && variable.type === type ? variable : null
    };
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
    // Blockly's generator reads its character soup through the function that
    // is currently installed on ScratchBlocks.utils, rather than through
    // `this`. Keep that shape in the test so the replay wrapper must preserve
    // the generator's static properties before delegating.
    const ordinaryGenUid = jest.fn(() => scratchBlocks.utils.genUid.soup_);
    ordinaryGenUid.soup_ = 'ordinary-random-id';
    scratchBlocks = {LIST_VARIABLE_TYPE: 'list', utils: {genUid: ordinaryGenUid}};
    const driver = createScratchBlocksVariableDriver({
        workspace,
        ScratchBlocks: scratchBlocks,
        documentObject,
        pointer,
        scope: {runWithoutUndo: callbackFunction => callbackFunction()},
        clock: {
            play: async ({points, onFrame}) => {
                points.forEach(onFrame);
                return true;
            }
        }
    });

    const result = await driver.play({
        kind: 'variable-create-dialog',
        targetId: 'sprite-a',
        varId: 'recorded-cake',
        varName: 'cake',
        varType: '',
        isLocal: true,
        isCloud: false
    });

    expect(result).toMatchObject({
        cancelled: false,
        dialogVisibleBeforeSubmit: true,
        flyoutRefreshSettled: true,
        intermediateValues: ['c', 'ca', 'cak', 'cake'],
        selectedBeforeSubmit: {local: true, global: false, cloud: false},
        idAliases: {'recorded-cake': 'recorded-cake'},
        resolvedPlan: {recordedVarId: 'recorded-cake', varId: 'recorded-cake'},
        pointerTravel: {
            completed: true,
            model: 'natural',
            stages: {
                button: {target: {kind: 'flyout-button'}},
                scope: {target: {kind: 'variable-scope'}},
                ok: {target: {kind: 'dialog-confirm'}}
            }
        }
    });
    expect(input.focus).not.toHaveBeenCalled();
    expect(input.dispatchEvent.mock.calls.filter(([event]) => event.type === 'input')).toHaveLength(4);
    expect(travels).toHaveLength(3);
    expect(scratchBlocks.utils.genUid).toBe(ordinaryGenUid);
    expect(placeholderId).toBe('ordinary-random-id');
    expect(ordinaryGenUid).toHaveBeenCalledTimes(1);

    promptOpen = true;
    expect(driver.cleanup()).toBe(true);
    expect(promptOpen).toBe(false);
});

const variableLifecycleHarness = ({useCount = 1} = {}) => {
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
    class FieldVariable {}
    const defaultView = {
        MouseEvent,
        Event,
        InputEvent,
        HTMLInputElement,
        requestAnimationFrame: callback => callback()
    };
    let variable = {id: 'live-cake', name: 'cake', type: ''};
    let uses = Array.from({length: useCount}, (_, index) => ({id: `use-${index + 1}`}));
    let promptOpen = false;
    let confirmOpen = false;
    let dropdownVisible = false;
    const targetElements = {};
    const element = (id, onEvent = () => {}) => ({
        id,
        ownerDocument: documentObject,
        getBoundingClientRect: () => ({left: 100, top: 80, width: 120, height: 30}),
        dispatchEvent: event => {
            onEvent(event);
            return true;
        },
        focus: jest.fn()
    });
    const documentObject = {
        defaultView,
        activeElement: null,
        documentElement: {clientWidth: 1280, clientHeight: 720},
        querySelector: selector => {
            const match = selector.match(/data-studio-target="([^"]+)"/);
            if (!match) return null;
            if (match[1].startsWith('prompt-')) return promptOpen ? targetElements[match[1]] || null : null;
            if (match[1].startsWith('blocks-confirm-')) {
                return confirmOpen ? targetElements[match[1]] || null : null;
            }
            return null;
        }
    };
    const input = Object.assign(new HTMLInputElement(), element('prompt-variable-name'));
    input.ownerDocument = documentObject;
    input.value = 'cake';
    input.dispatchEvent = jest.fn(() => true);
    input.focus = jest.fn(() => { documentObject.activeElement = input; });
    const promptCancel = element('prompt-cancel', event => {
        if (event.type === 'click') promptOpen = false;
    });
    const promptOk = element('prompt-ok', event => {
        if (event.type === 'click') {
            variable.name = input.value;
            promptOpen = false;
        }
    });
    const confirmCancel = element('blocks-confirm-cancel', event => {
        if (event.type === 'click') confirmOpen = false;
    });
    const confirmOk = element('blocks-confirm-ok', event => {
        if (event.type === 'click') {
            variable = null;
            uses = [];
            confirmOpen = false;
        }
    });
    Object.assign(targetElements, {
        'prompt-variable-name': input,
        'prompt-cancel': promptCancel,
        'prompt-ok': promptOk,
        'blocks-confirm-cancel': confirmCancel,
        'blocks-confirm-ok': confirmOk
    });

    const renameId = 'rename-variable';
    const deleteId = 'delete-variable';
    const renameOption = element('rename-option', event => {
        if (event.type === 'click') {
            dropdownVisible = false;
            promptOpen = true;
            documentObject.activeElement = input;
        }
    });
    const deleteOption = element('delete-option', event => {
        if (event.type === 'click') {
            dropdownVisible = false;
            if (uses.length > 1) confirmOpen = true;
            else {
                variable = null;
                uses = [];
            }
        }
    });
    const menuItems = [element('cake-option'), renameOption, deleteOption];
    const fieldRoot = element('variable-field');
    const flyoutWorkspace = {
        getGesture: () => ({
            setStartField: jest.fn(),
            handleBlockStart: jest.fn(),
            handleWsStart: jest.fn(),
            handleUp: jest.fn(() => { dropdownVisible = true; })
        })
    };
    const sourceBlock = {workspace: flyoutWorkspace};
    const field = Object.assign(new FieldVariable(), {
        sourceBlock_: sourceBlock,
        getValue: () => 'live-cake',
        getSvgRoot: () => fieldRoot,
        getOptions: () => [['cake', 'live-cake'], ['Rename', renameId], ['Delete', deleteId]]
    });
    const flyoutBlock = {inputList: [{fieldRow: [field]}]};
    flyoutWorkspace.getAllBlocks = () => [flyoutBlock];
    const workspace = {
        toolbox_: {
            getSelectedCategoryId: () => 'variables',
            categoryMenu_: {categories_: [{id_: 'variables', item_: element('variables-category')}]}
        },
        getFlyout: () => ({getWorkspace: () => flyoutWorkspace}),
        getVariableById: id => id === 'live-cake' ? variable : null,
        getVariableUsesById: () => uses
    };
    const travels = [];
    const pointer = {
        hideUntilMove: jest.fn(),
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
                frames: []
            };
            travels.push(travel);
            return travel;
        },
        click: activate => {
            activate();
            return true;
        }
    };
    const ScratchBlocks = {
        FieldVariable,
        LIST_VARIABLE_TYPE: 'list',
        RENAME_VARIABLE_ID: renameId,
        DELETE_VARIABLE_ID: deleteId,
        DropDownDiv: {
            isVisible: () => dropdownVisible,
            getContentDiv: () => ({querySelectorAll: () => menuItems}),
            hideWithoutAnimation: () => { dropdownVisible = false; }
        }
    };
    const driver = createScratchBlocksVariableDriver({
        workspace,
        ScratchBlocks,
        documentObject,
        pointer,
        aliases: new Map([['recorded-cake', 'live-cake']]),
        scope: {runWithoutUndo: callback => callback()},
        clock: {
            play: async ({points, onFrame}) => {
                points.forEach(onFrame);
                return true;
            }
        }
    });
    return {driver, input, pointer, travels};
};

test('renames an aliased variable through its real flyout dropdown and prompt', async () => {
    const harness = variableLifecycleHarness();
    const result = await harness.driver.play({
        kind: 'variable-rename-dialog',
        varId: 'recorded-cake',
        varType: '',
        oldName: 'cake',
        newName: 'cupcake'
    });

    expect(result).toMatchObject({
        cancelled: false,
        menuVisibleBeforeClick: true,
        dialogVisibleBeforeSubmit: true,
        intermediateValues: ['c', 'cu', 'cup', 'cupc', 'cupca', 'cupcak', 'cupcake'],
        resolvedPlan: {recordedVarId: 'recorded-cake', varId: 'live-cake'},
        pointerTravel: {
            completed: true,
            stages: {
                field: {target: {kind: 'block-field'}},
                option: {target: {kind: 'dropdown-option'}},
                ok: {target: {kind: 'dialog-confirm'}}
            }
        }
    });
    expect(harness.input.value).toBe('cupcake');
    expect(harness.pointer.hideUntilMove).toHaveBeenCalledTimes(1);
});

test('confirms deletion through the editor modal when a variable has multiple uses', async () => {
    const harness = variableLifecycleHarness({useCount: 2});
    const result = await harness.driver.play({
        kind: 'variable-delete-dropdown',
        varId: 'recorded-cake',
        varName: 'cake',
        varType: '',
        deletedBlocks: [{blockId: 'recorded-use', blockIds: ['recorded-use']}]
    });

    expect(result).toMatchObject({
        cancelled: false,
        useCount: 2,
        confirmationRequired: true,
        confirmationVisibleBeforeSubmit: true,
        resolvedPlan: {
            recordedVarId: 'recorded-cake',
            varId: 'live-cake',
            deletedBlocks: [{recordedBlockId: 'recorded-use', blockId: 'recorded-use'}]
        },
        pointerTravel: {
            completed: true,
            stages: {confirmation: {target: {kind: 'dialog-confirm'}}}
        }
    });
});
