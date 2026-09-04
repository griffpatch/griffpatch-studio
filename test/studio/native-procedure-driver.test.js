import {
    createScratchBlocksProcedureDriver,
    parseProcedureDefinition
} from '../../src/studio/bridge/native-interaction/scratch-blocks-procedure-driver';
import {createPointerTargetResolver} from '../../src/studio/bridge/native-interaction/pointer-target';

const procedurePlan = {
    kind: 'custom-procedure-dialog',
    targetId: 'sprite-a',
    blockId: 'recorded-definition',
    blockIds: ['recorded-definition', 'recorded-prototype', 'recorded-reporter'],
    blockType: 'procedures_definition',
    xml: '<recorded-procedure/>',
    destination: {parentId: null, inputName: null, coordinate: {x: 44, y: 44}}
};

const mutationNode = attributes => ({
    getAttribute: name => Object.prototype.hasOwnProperty.call(attributes, name) ? attributes[name] : null
});

test('parses labels, typed arguments and warp from the recorded procedure mutation', () => {
    const mutation = mutationNode({
        proccode: 'bake %s until %b',
        argumentids: '["height-id","ready-id"]',
        argumentnames: '["height","ready?"]',
        argumentdefaults: '["",false]',
        warp: 'true'
    });
    const ScratchBlocks = {Xml: {textToDom: () => ({getElementsByTagName: () => [mutation]})}};

    expect(parseProcedureDefinition(ScratchBlocks, {
        ...procedurePlan,
        blockIds: ['definition', 'prototype', 'height-reporter', 'ready-reporter']
    })).toEqual({
        proccode: 'bake %s until %b',
        argumentIds: ['height-id', 'ready-id'],
        argumentNames: ['height', 'ready?'],
        argumentDefaults: ['', false],
        warp: true,
        parts: [
            {kind: 'label', value: 'bake'},
            {kind: 'text-number', id: 'height-id', value: 'height', defaultValue: ''},
            {kind: 'label', value: 'until'},
            {kind: 'boolean', id: 'ready-id', value: 'ready?', defaultValue: false}
        ]
    });
});

test('uses the real modal controls, paces its editors and preserves recorded persistent IDs', async () => {
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
        focus () {}
    }
    const defaultView = {
        MouseEvent,
        Event,
        InputEvent,
        HTMLInputElement,
        requestAnimationFrame: callback => callback()
    };
    const targetElements = {};
    let modalOpen = false;
    let currentEditor = null;
    let scratchBlocks;
    const generated = {argumentId: null, addPlaceholder: null, groupId: null, finalIds: [], finalPlaceholder: null};
    const blocks = new Map();
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
        documentElement: {clientWidth: 1000, clientHeight: 700},
        querySelector: selector => {
            if (selector === '#customProceduresModal') return modalOpen ? targetElements.modal : null;
            if (selector === '.blocklyHtmlInput') return modalOpen ? currentEditor : null;
            const match = selector.match(/data-studio-target="([^"]+)"/);
            return modalOpen && match ? targetElements[match[1]] || null : null;
        }
    };
    const makeEditor = id => {
        const editor = Object.assign(new HTMLInputElement(), element(id));
        editor.ownerDocument = documentObject;
        editor.dispatchEvent = jest.fn(() => true);
        editor.getBoundingClientRect = () => ({left: 310, top: 155, width: 170, height: 34});
        editor.focus = jest.fn(() => { documentObject.activeElement = editor; });
        return editor;
    };
    const nameEditor = makeEditor('name-editor');
    const argumentEditor = makeEditor('argument-editor');
    targetElements.modal = element('customProceduresModal');
    targetElements['custom-procedure-add-text-number'] = element('add-text', event => {
        if (event.type !== 'click') return;
        generated.argumentId = scratchBlocks.utils.genUid();
        generated.addPlaceholder = scratchBlocks.utils.genUid();
        currentEditor = argumentEditor;
        documentObject.activeElement = argumentEditor;
    });
    targetElements['custom-procedure-cancel'] = element('cancel', event => {
        if (event.type === 'click') modalOpen = false;
    });
    targetElements['custom-procedure-warp'] = Object.assign(element('warp'), {checked: false});
    targetElements['custom-procedure-ok'] = element('ok', event => {
        if (event.type !== 'click') return;
        generated.groupId = scratchBlocks.utils.genUid();
        generated.finalIds = [
            scratchBlocks.utils.genUid(),
            scratchBlocks.utils.genUid(),
            scratchBlocks.utils.genUid()
        ];
        generated.finalPlaceholder = scratchBlocks.utils.genUid();
        generated.finalIds.forEach(id => blocks.set(id, {id}));
        let coordinate = {x: 31, y: 31};
        blocks.set(procedurePlan.blockId, {
            id: procedurePlan.blockId,
            getRelativeToSurfaceXY: () => ({...coordinate}),
            moveBy: (dx, dy) => {
                coordinate = {x: coordinate.x + dx, y: coordinate.y + dy};
            }
        });
        modalOpen = false;
    });

    const callback = jest.fn();
    const categoryElement = element('my-blocks-category');
    const buttonElement = element('make-block', event => {
        if (event.type === 'click') {
            modalOpen = true;
            currentEditor = nameEditor;
            documentObject.activeElement = nameEditor;
        }
    });
    const workspace = {
        toolbox_: {
            getSelectedCategoryId: () => 'myBlocks',
            categoryMenu_: {categories_: [{id_: 'myBlocks', item_: categoryElement}]}
        },
        getFlyout: () => ({buttons_: [{callback_: callback, svgGroup_: buttonElement}]}),
        getButtonCallback: key => key === 'CREATE_PROCEDURE' ? callback : null,
        getBlockById: id => blocks.get(id) || null
    };
    const mutation = mutationNode({
        proccode: 'bake %s',
        argumentids: '["recorded-argument-id"]',
        argumentnames: '["height"]',
        argumentdefaults: '[""]',
        warp: 'false'
    });
    const ordinaryIds = ['ordinary-add-placeholder', 'ordinary-group', 'ordinary-final-placeholder'];
    const ordinaryGenUid = jest.fn(() => ordinaryIds.shift());
    ordinaryGenUid.soup_ = 'normal-soup';
    scratchBlocks = {
        Xml: {textToDom: () => ({getElementsByTagName: () => [mutation]})},
        utils: {genUid: ordinaryGenUid}
    };
    const travels = [];
    const resolver = createPointerTargetResolver();
    const pointer = {
        travelTo: async pointerTarget => {
            const resolved = resolver.resolve(pointerTarget);
            const travel = {
                completed: true,
                model: 'natural',
                target: resolved,
                frames: [],
                initialPlacement: travels.length === 0
            };
            travels.push(travel);
            return travel;
        }
    };
    const driver = createScratchBlocksProcedureDriver({
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

    const result = await driver.play(procedurePlan);

    expect(result).toMatchObject({
        cancelled: false,
        dialogVisibleBeforeSubmit: true,
        flyoutRefreshSettled: true,
        typedValues: [
            {kind: 'label', value: 'bake', intermediateValues: ['b', 'ba', 'bak', 'bake']},
            {kind: 'text-number', value: 'height', intermediateValues: ['h', 'he', 'hei', 'heig', 'heigh', 'height']}
        ],
        pointerTravel: {
            completed: true,
            stages: {
                button: {target: {kind: 'flyout-button'}},
                part1Button: {target: {kind: 'dialog-option'}},
                ok: {target: {kind: 'dialog-confirm'}}
            }
        },
        placement: {
            before: {x: 31, y: 31},
            expected: {x: 44, y: 44},
            delta: {x: 13, y: 13},
            adjusted: true,
            after: {x: 44, y: 44}
        }
    });
    expect(generated).toEqual({
        argumentId: 'recorded-argument-id',
        addPlaceholder: 'ordinary-add-placeholder',
        groupId: 'ordinary-group',
        finalIds: procedurePlan.blockIds,
        finalPlaceholder: 'ordinary-final-placeholder'
    });
    expect(scratchBlocks.utils.genUid).toBe(ordinaryGenUid);
    expect(ordinaryGenUid).toHaveBeenCalledTimes(3);
    expect(travels).toHaveLength(3);

    modalOpen = true;
    expect(driver.cleanup()).toBe(true);
    expect(modalOpen).toBe(false);
});
