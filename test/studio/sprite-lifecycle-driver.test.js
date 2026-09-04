import {createSpriteLifecycleDriver} from
    '../../src/studio/bridge/native-interaction/sprite-lifecycle-driver';

const makeHarness = ({selectedName = 'Sprite1'} = {}) => {
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

    let nextId = 2;
    const makeSprite = (id, name) => {
        const sprite = {name};
        return {
            id,
            isOriginal: true,
            isStage: false,
            sprite,
            getName: () => sprite.name
        };
    };
    const stage = {id: 'stage', isOriginal: true, isStage: true, getName: () => 'Stage'};
    const sprite1 = makeSprite('sprite-1', 'Sprite1');
    const sprite2 = makeSprite('sprite-2', 'Sprite2');
    const targets = [stage, sprite1, sprite2];
    const state = {menuName: null};
    const documentObject = {
        activeElement: null,
        defaultView: {
            MouseEvent,
            InputEvent,
            HTMLInputElement,
            requestAnimationFrame: callback => callback()
        },
        querySelector: jest.fn()
    };
    const rect = {left: 80, top: 100, width: 120, height: 64, right: 200, bottom: 164};
    const element = ({click = null, context = null} = {}) => ({
        ownerDocument: documentObject,
        getBoundingClientRect: () => rect,
        dispatchEvent: jest.fn(event => {
            if (event.type === 'click' && click) click();
            if (event.type === 'contextmenu' && context) context();
            return true;
        })
    });

    const vm = {
        runtime: {
            targets,
            getTargetById: id => targets.find(target => target.id === id) || null
        },
        editingTarget: null,
        setEditingTarget: jest.fn(id => {
            vm.editingTarget = vm.runtime.getTargetById(id);
        }),
        duplicateSprite: jest.fn(async id => {
            const source = vm.runtime.getTargetById(id);
            const copy = makeSprite(`copy-${nextId}`, `Sprite${nextId + 1}`);
            nextId += 1;
            copy.sprite.sourceName = source.getName();
            targets.push(copy);
            return copy.id;
        }),
        renameSprite: jest.fn((id, name) => {
            const target = vm.runtime.getTargetById(id);
            if (target) target.sprite.name = name;
        }),
        deleteSprite: jest.fn(id => {
            const index = targets.findIndex(target => target.id === id);
            if (index !== -1) targets.splice(index, 1);
            if (vm.editingTarget && vm.editingTarget.id === id) vm.editingTarget = sprite1;
            return () => {};
        })
    };
    vm.editingTarget = targets.find(target => target.getName() === selectedName);

    const input = new HTMLInputElement();
    Object.assign(input, {
        ownerDocument: documentObject,
        getBoundingClientRect: () => ({left: 300, top: 80, width: 120, height: 32, right: 420, bottom: 112}),
        dispatchEvent: jest.fn(() => true),
        focus: jest.fn(() => {
            documentObject.activeElement = input;
        }),
        blur: jest.fn(() => vm.renameSprite(vm.editingTarget.id, input.value))
    });

    documentObject.querySelector.mockImplementation(selector => {
        const nameMatch = selector.match(/data-studio-sprite-name="([^"]+)"/);
        if (nameMatch) {
            const target = targets.find(candidate => candidate.getName() === nameMatch[1]);
            return target ? element({
                click: () => vm.setEditingTarget(target.id),
                context: () => {
                    state.menuName = target.getName();
                }
            }) : null;
        }
        const targetMatch = selector.match(/data-studio-target="([^"]+)"/);
        if (!targetMatch) return null;
        const id = targetMatch[1];
        if (id === 'sprite-name-input') return input;
        const actionMatch = id.match(/^sprite:(.+):(duplicate|delete)$/);
        if (!actionMatch) return null;
        const [, name, action] = actionMatch;
        const target = targets.find(candidate => candidate.getName() === name);
        if (!target || (action === 'duplicate' && state.menuName !== name) ||
            (action === 'delete' && vm.editingTarget !== target)) return null;
        return element({
            click: action === 'duplicate' ?
                () => vm.duplicateSprite(target.id) : () => vm.deleteSprite(target.id)
        });
    });

    const pointer = {
        travelTo: jest.fn(async target => {
            const targetElement = target.locate();
            const bounds = targetElement.getBoundingClientRect();
            return {
                completed: true,
                model: 'natural',
                target: {
                    id: target.id,
                    kind: target.kind,
                    point: {x: bounds.left + (bounds.width / 2), y: bounds.top + (bounds.height / 2)},
                    element: targetElement
                },
                frames: []
            };
        }),
        click: jest.fn(activate => {
            activate();
            return true;
        }),
        hide: jest.fn(),
        show: jest.fn()
    };
    const driver = createSpriteLifecycleDriver({
        vm,
        documentObject,
        clock: {
            play: async ({points, onFrame}) => {
                points.forEach((point, index) => onFrame && onFrame(point, index));
                return true;
            }
        },
        pointer,
        scope: {runWithoutUndo: action => action()}
    });
    return {driver, pointer, targets, vm};
};

test('duplicates a sprite through its real context-menu action', async () => {
    const harness = makeHarness();
    const result = await harness.driver.play({
        kind: 'sprite-duplicate-click',
        sourceTargetRef: {name: 'Sprite1', isStage: false},
        createdTargetRef: {name: 'Sprite3', isStage: false}
    });

    expect(result).toMatchObject({controlsVisible: true, projectMatches: true});
    expect(harness.vm.duplicateSprite).toHaveBeenCalledWith('sprite-1');
    expect(harness.pointer.travelTo.mock.calls.map(call => call[0].id)).toEqual([
        'sprite:Sprite1', 'sprite:Sprite1:duplicate'
    ]);
});

test('renames a sprite through the selected sprite-name input with paced text', async () => {
    const harness = makeHarness({selectedName: 'Sprite1'});
    const result = await harness.driver.play({
        kind: 'sprite-rename-input',
        targetRef: {name: 'Sprite1', isStage: false},
        requestedName: 'Guide',
        renamedTargetRef: {name: 'Guide', isStage: false}
    });

    expect(result).toMatchObject({controlsVisible: true, projectMatches: true});
    expect(result.typedValues[result.typedValues.length - 1]).toBe('Guide');
    expect(harness.vm.renameSprite).toHaveBeenCalledWith('sprite-1', 'Guide');
    expect(harness.pointer.travelTo.mock.calls.map(call => call[0].id)).toEqual(['sprite-name-input']);
});

test('selects and deletes the intended sprite through its visible delete button', async () => {
    const harness = makeHarness({selectedName: 'Sprite1'});
    const result = await harness.driver.play({
        kind: 'sprite-delete-click',
        targetRef: {name: 'Sprite2', isStage: false}
    });

    expect(result).toMatchObject({controlsVisible: true, projectMatches: true});
    expect(harness.vm.setEditingTarget).toHaveBeenCalledWith('sprite-2');
    expect(harness.vm.deleteSprite).toHaveBeenCalledWith('sprite-2');
    expect(harness.targets.map(target => target.getName())).toEqual(['Stage', 'Sprite1']);
    expect(harness.pointer.travelTo.mock.calls.map(call => call[0].id)).toEqual([
        'target:sprite:Sprite2', 'sprite:Sprite2:delete'
    ]);
});
