import {createSoundLifecycleDriver} from
    '../../src/studio/bridge/native-interaction/sound-lifecycle-driver';

const makeSound = (name, assetId) => ({
    name,
    assetId,
    dataFormat: 'wav',
    rate: 48000,
    sampleCount: 100
});

const makeHarness = () => {
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
    const sounds = [makeSound('Pop', 'pop'), makeSound('Meow', 'meow')];
    const sprite = {
        id: 'sprite-1',
        isStage: false,
        getName: () => 'Sprite1',
        getSounds: () => sounds
    };
    const state = {selected: 0, menu: null, dragSource: null, dragDestination: null};
    const documentObject = {
        defaultView: {
            MouseEvent,
            InputEvent,
            HTMLInputElement,
            requestAnimationFrame: callback => callback()
        },
        documentElement: {clientWidth: 1200, clientHeight: 800},
        querySelector: jest.fn(),
        dispatchEvent: jest.fn(event => {
            if (event.type === 'mousemove') {
                state.dragDestination = Math.max(0, Math.min(sounds.length - 1,
                    Math.floor((event.clientY - 100) / 70)));
            }
            if (event.type === 'mouseup' && state.dragSource !== null) {
                vm.reorderSound(sprite.id, state.dragSource, state.dragDestination);
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
    const element = ({index = 0, click = null, context = null, down = null} = {}) => ({
        ownerDocument: documentObject,
        getBoundingClientRect: () => rect(index),
        dispatchEvent: jest.fn(event => {
            if (event.type === 'click' && click) click();
            if (event.type === 'contextmenu' && context) context();
            if (event.type === 'mousedown' && down) down();
            return true;
        })
    });
    const tab = element();
    const input = new HTMLInputElement();
    Object.assign(input, {
        ownerDocument: documentObject,
        getBoundingClientRect: () => ({left: 400, top: 80, width: 160, height: 32, right: 560, bottom: 112}),
        dispatchEvent: jest.fn(() => true),
        focus: jest.fn(),
        blur: jest.fn(() => vm.renameSound(state.selected, input.value))
    });
    const vm = {
        runtime: {targets: [sprite]},
        editingTarget: sprite,
        duplicateSound: jest.fn(async index => {
            sounds.splice(index + 1, 0, makeSound(`${sounds[index].name}2`, sounds[index].assetId));
        }),
        renameSound: jest.fn((index, name) => {
            sounds[index] = {...sounds[index], name};
        }),
        deleteSound: jest.fn(index => {
            sounds.splice(index, 1);
        }),
        reorderSound: jest.fn((targetId, index, newIndex) => {
            if (targetId !== sprite.id) return false;
            const [moved] = sounds.splice(index, 1);
            sounds.splice(newIndex, 0, moved);
            return true;
        })
    };
    documentObject.querySelector.mockImplementation(selector => {
        const match = selector.match(/data-studio-target="([^"]+)"/);
        if (!match) return null;
        const id = match[1];
        if (id === 'tab-sounds') return tab;
        if (id === 'sound-name-input') return input;
        const itemMatch = id.match(/^sound-item:(\d+):([^:]+)$/);
        if (itemMatch) {
            const index = Number(itemMatch[1]);
            const sound = sounds[index];
            if (!sound || sound.assetId !== itemMatch[2]) return null;
            return element({
                index,
                click: () => {
                    state.selected = index;
                },
                context: () => {
                    state.menu = id;
                },
                down: () => {
                    state.dragSource = index;
                }
            });
        }
        const actionMatch = id.match(/^(sound-item:(\d+):([^:]+)):(duplicate|delete)$/);
        if (!actionMatch || (actionMatch[4] === 'duplicate' && state.menu !== actionMatch[1])) return null;
        const index = Number(actionMatch[2]);
        if (!sounds[index] || sounds[index].assetId !== actionMatch[3]) return null;
        return element({
            index,
            click: actionMatch[4] === 'duplicate' ?
                () => vm.duplicateSound(index) : () => vm.deleteSound(index)
        });
    });
    const pointer = {
        travelTo: jest.fn(async (target, options = {}) => {
            const targetElement = target.locate();
            const bounds = targetElement.getBoundingClientRect();
            const point = {x: bounds.left + (bounds.width / 2), y: bounds.top + (bounds.height / 2)};
            if (options.onFrame) options.onFrame(point);
            return {
                completed: true,
                model: 'natural',
                target: {id: target.id, kind: target.kind, point, element: targetElement},
                frames: [point]
            };
        }),
        press: jest.fn(),
        release: jest.fn(),
        hide: jest.fn()
    };
    const scope = {
        runWithoutUndo: action => action()
    };
    const driver = createSoundLifecycleDriver({
        vm,
        documentObject,
        clock: {play: async ({points, onFrame}) => {
            points.forEach(onFrame);
            return true;
        }},
        pointer,
        scope
    });
    return {driver, pointer, sounds, vm};
};

const basePlan = sound => ({
    targetRef: {name: 'Sprite1', isStage: false},
    soundIndex: 0,
    sourceSound: sound
});

test('duplicates a sound through its real context menu target', async () => {
    const harness = makeHarness();
    const source = {...harness.sounds[0]};
    const result = await harness.driver.play({
        ...basePlan(source),
        kind: 'sound-duplicate-click',
        addedSound: {...source, name: 'Pop2'}
    });

    expect(result).toMatchObject({controlsVisible: true, projectMatches: true});
    expect(harness.vm.duplicateSound).toHaveBeenCalledWith(0);
    expect(harness.pointer.travelTo.mock.calls.map(call => call[0].id)).toEqual([
        'tab-sounds', 'sound-item:0:pop', 'sound-item:0:pop:duplicate'
    ]);
});

test('renames a sound through the visible editor input with simulated typing', async () => {
    const harness = makeHarness();
    const source = {...harness.sounds[0]};
    const result = await harness.driver.play({
        kind: 'sound-rename-input',
        targetRef: {name: 'Sprite1', isStage: false},
        soundIndex: 0,
        oldSound: source,
        requestedName: 'Party Pop',
        renamedSound: {...source, name: 'Party Pop'}
    });

    expect(result).toMatchObject({controlsVisible: true, projectMatches: true});
    expect(result.typedValues[result.typedValues.length - 1]).toBe('Party Pop');
    expect(harness.vm.renameSound).toHaveBeenCalledWith(0, 'Party Pop');
    expect(harness.pointer.hide).toHaveBeenCalled();
});

test('deletes the selected sound through its visible delete button', async () => {
    const harness = makeHarness();
    const source = {...harness.sounds[0]};
    const result = await harness.driver.play({
        kind: 'sound-delete-click',
        targetRef: {name: 'Sprite1', isStage: false},
        soundIndex: 0,
        deletedSound: source
    });

    expect(result).toMatchObject({controlsVisible: true, projectMatches: true});
    expect(harness.vm.deleteSound).toHaveBeenCalledWith(0);
    expect(harness.sounds.map(sound => sound.name)).toEqual(['Meow']);
});

test('reorders sounds by forwarding the pointer drag through the asset list', async () => {
    const harness = makeHarness();
    const source = {...harness.sounds[0]};
    const result = await harness.driver.play({
        kind: 'sound-reorder-drag',
        targetRef: {name: 'Sprite1', isStage: false},
        soundIndex: 0,
        newIndex: 1,
        movedSound: source
    });

    expect(result).toMatchObject({controlsVisible: true, projectMatches: true});
    expect(harness.vm.reorderSound).toHaveBeenCalledWith('sprite-1', 0, 1);
    expect(harness.sounds.map(sound => sound.name)).toEqual(['Meow', 'Pop']);
    expect(harness.pointer.press).toHaveBeenCalled();
    expect(harness.pointer.release).toHaveBeenCalled();
});
