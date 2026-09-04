import {createCostumeLifecycleDriver} from
    '../../src/studio/bridge/native-interaction/costume-lifecycle-driver';

const makeCostume = (name, assetId) => ({name, assetId, dataFormat: 'svg'});

const makeHarness = ({isStage = false, tabSelected = false} = {}) => {
    class MouseEvent {
        constructor (type, options) {
            this.type = type;
            Object.assign(this, options);
        }
    }
    class InputEvent {
        constructor (type, options) {
            this.type = type;
            Object.assign(this, options);
        }
    }
    class HTMLInputElement {
        constructor () {
            this._value = '';
        }
    }
    Object.defineProperty(HTMLInputElement.prototype, 'value', {
        get () {
            return this._value;
        },
        set (value) {
            this._value = value;
        }
    });

    const costumes = [makeCostume('costume1', 'one'), makeCostume('costume2', 'two')];
    const target = {
        id: isStage ? 'stage' : 'sprite-1',
        isStage,
        currentCostume: 0,
        getName: () => (isStage ? 'Stage' : 'Sprite1'),
        getCostumes: () => costumes,
        setCostume: jest.fn(index => {
            target.currentCostume = index;
        })
    };
    const assetKind = isStage ? 'backdrop' : 'costume';
    const state = {menu: null, dragSource: null, dragDestination: null};
    const documentObject = {
        activeElement: null,
        defaultView: {
            MouseEvent,
            InputEvent,
            HTMLInputElement,
            requestAnimationFrame: callback => callback()
        },
        querySelector: jest.fn(),
        dispatchEvent: jest.fn(event => {
            if (event.type === 'mousemove') {
                state.dragDestination = Math.max(0, Math.min(costumes.length - 1,
                    Math.floor((event.clientY - 100) / 70)));
            }
            if (event.type === 'mouseup' && state.dragSource !== null) {
                vm.reorderCostume(target.id, state.dragSource, state.dragDestination);
                state.dragSource = null;
            }
            return true;
        })
    };
    const rect = index => ({
        left: 80,
        top: 100 + (index * 70),
        width: 180,
        height: 60,
        right: 260,
        bottom: 160 + (index * 70)
    });
    const element = ({index = 0, click = null, context = null, down = null, selected = null} = {}) => ({
        ownerDocument: documentObject,
        getAttribute: attribute => (attribute === 'aria-selected' && selected ? 'true' : null),
        getBoundingClientRect: () => rect(index),
        dispatchEvent: jest.fn(event => {
            if (event.type === 'click' && click) click();
            if (event.type === 'contextmenu' && context) context();
            if (event.type === 'mousedown' && down) down();
            return true;
        })
    });
    const input = new HTMLInputElement();
    Object.assign(input, {
        ownerDocument: documentObject,
        getBoundingClientRect: () => ({left: 400, top: 80, width: 160, height: 32, right: 560, bottom: 112}),
        dispatchEvent: jest.fn(() => true),
        focus: jest.fn(() => {
            documentObject.activeElement = input;
        }),
        blur: jest.fn(() => vm.renameCostume(target.currentCostume, input.value))
    });
    const editorRoot = {querySelector: jest.fn(() => input)};
    const vm = {
        runtime: {
            targets: [target],
            getTargetById: id => (id === target.id ? target : null)
        },
        editingTarget: target,
        duplicateCostume: jest.fn(async index => {
            costumes.splice(index + 1, 0, makeCostume(`${costumes[index].name}2`, costumes[index].assetId));
        }),
        renameCostume: jest.fn((index, name) => {
            costumes[index] = {...costumes[index], name};
        }),
        deleteCostume: jest.fn(index => {
            costumes.splice(index, 1);
            target.currentCostume = Math.min(target.currentCostume, costumes.length - 1);
        }),
        reorderCostume: jest.fn((targetId, index, newIndex) => {
            if (targetId !== target.id) return false;
            const [moved] = costumes.splice(index, 1);
            costumes.splice(newIndex, 0, moved);
            target.currentCostume = newIndex;
            return true;
        })
    };
    documentObject.querySelector.mockImplementation(selector => {
        const match = selector.match(/data-studio-target="([^"]+)"/);
        if (!match) return null;
        const id = match[1];
        if (id === 'tab-costumes') return element({selected: tabSelected});
        if (id === 'costume-editor') return editorRoot;
        const itemMatch = id.match(new RegExp(`^${assetKind}-item:(\\d+):([^:]+)$`));
        if (itemMatch) {
            const index = Number(itemMatch[1]);
            const costume = costumes[index];
            if (!costume || costume.assetId !== itemMatch[2]) return null;
            return element({
                index,
                click: () => target.setCostume(index),
                context: () => {
                    state.menu = id;
                },
                down: () => {
                    state.dragSource = index;
                }
            });
        }
        const actionMatch = id.match(new RegExp(
            `^(${assetKind}-item:(\\d+):([^:]+)):(duplicate|delete)$`
        ));
        if (!actionMatch || (actionMatch[4] === 'duplicate' && state.menu !== actionMatch[1])) return null;
        const index = Number(actionMatch[2]);
        if (!costumes[index] || costumes[index].assetId !== actionMatch[3]) return null;
        return element({
            index,
            click: actionMatch[4] === 'duplicate' ?
                () => vm.duplicateCostume(index) : () => vm.deleteCostume(index)
        });
    });
    const pointer = {
        travelTo: jest.fn(async (pointerTarget, options = {}) => {
            const targetElement = pointerTarget.locate();
            const bounds = targetElement.getBoundingClientRect();
            const point = {x: bounds.left + (bounds.width / 2), y: bounds.top + (bounds.height / 2)};
            if (options.onFrame) options.onFrame(point);
            return {
                completed: true,
                model: 'natural',
                target: {id: pointerTarget.id, kind: pointerTarget.kind, point, element: targetElement},
                frames: [point]
            };
        }),
        click: jest.fn(activate => {
            activate();
            return true;
        }),
        press: jest.fn(),
        release: jest.fn(),
        hide: jest.fn(),
        show: jest.fn()
    };
    const driver = createCostumeLifecycleDriver({
        vm,
        documentObject,
        clock: {play: async ({points, onFrame}) => {
            points.forEach(onFrame);
            return true;
        }},
        pointer,
        scope: {runWithoutUndo: action => action()}
    });
    return {assetKind, costumes, driver, pointer, target, vm};
};

const basePlan = (harness, source) => ({
    targetRef: {name: harness.target.getName(), isStage: harness.target.isStage},
    assetKind: harness.assetKind,
    costumeIndex: 0,
    sourceCostume: source
});

test('duplicates a costume through its real context-menu action', async () => {
    const harness = makeHarness();
    const source = {...harness.costumes[0]};
    const result = await harness.driver.play({
        ...basePlan(harness, source),
        kind: 'costume-duplicate-click',
        addedCostume: {...source, name: 'costume12'}
    });

    expect(result).toMatchObject({controlsVisible: true, projectMatches: true});
    expect(harness.vm.duplicateCostume).toHaveBeenCalledWith(0);
    expect(harness.pointer.travelTo.mock.calls.map(call => call[0].id)).toEqual([
        'tab-costumes', 'costume-item:0:one', 'costume-item:0:one:duplicate'
    ]);
});

test('renames a backdrop through the visible paint-editor input', async () => {
    const harness = makeHarness({isStage: true, tabSelected: true});
    const source = {...harness.costumes[0]};
    const result = await harness.driver.play({
        ...basePlan(harness, source),
        kind: 'backdrop-rename-input',
        requestedName: 'Night',
        renamedCostume: {...source, name: 'Night'}
    });

    expect(result).toMatchObject({controlsVisible: true, projectMatches: true});
    expect(result.typedValues[result.typedValues.length - 1]).toBe('Night');
    expect(harness.vm.renameCostume).toHaveBeenCalledWith(0, 'Night');
    expect(harness.pointer.travelTo.mock.calls.map(call => call[0].id)).toEqual([
        'backdrop-item:0:one', 'costume-name-input'
    ]);
});

test('selects and deletes the intended costume with the visible delete button', async () => {
    const harness = makeHarness();
    const source = {...harness.costumes[1]};
    const result = await harness.driver.play({
        ...basePlan(harness, source),
        kind: 'costume-delete-click',
        costumeIndex: 1
    });

    expect(result).toMatchObject({controlsVisible: true, projectMatches: true});
    expect(harness.target.setCostume).toHaveBeenCalledWith(1);
    expect(harness.vm.deleteCostume).toHaveBeenCalledWith(1);
    expect(harness.costumes.map(costume => costume.name)).toEqual(['costume1']);
});

test('reorders backdrops by forwarding the pointer drag through the asset list', async () => {
    const harness = makeHarness({isStage: true});
    const source = {...harness.costumes[0]};
    const result = await harness.driver.play({
        ...basePlan(harness, source),
        kind: 'backdrop-reorder-drag',
        newIndex: 1
    });

    expect(result).toMatchObject({controlsVisible: true, projectMatches: true});
    expect(harness.vm.reorderCostume).toHaveBeenCalledWith('stage', 0, 1);
    expect(harness.costumes.map(costume => costume.name)).toEqual(['costume2', 'costume1']);
    expect(harness.pointer.press).toHaveBeenCalled();
    expect(harness.pointer.release).toHaveBeenCalled();
});
