import {createProjectLibraryDriver} from '../../src/studio/bridge/native-interaction/project-library-driver';

const makeHarness = ({checkpointPort = null} = {}) => {
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
    class File {
        constructor (parts, name, options) {
            this.parts = parts;
            this.name = name;
            this.type = options.type;
        }
    }
    const state = {library: null, tab: 'code', uploadVisible: false};
    const documentObject = {
        defaultView: {
            MouseEvent,
            Event,
            File,
            requestAnimationFrame: callback => callback()
        },
        documentElement: {clientWidth: 1200, clientHeight: 800},
        querySelector: jest.fn()
    };
    const element = (id, click = () => {}) => ({
        id,
        ownerDocument: documentObject,
        scrollIntoView: jest.fn(),
        getBoundingClientRect: () => ({left: 100, top: 80, width: 120, height: 60, right: 220, bottom: 140}),
        dispatchEvent: event => {
            if (event.type === 'mouseover' && /^(?:sound|costume|backdrop)-open$/.test(id)) {
                state.uploadVisible = true;
            }
            if (event.type === 'click') click();
            return true;
        }
    });
    const sprite1Costumes = [{assetId: 'costume1', dataFormat: 'svg', name: 'costume1'}];
    const sprite1Sounds = [{
        assetId: 'pop',
        dataFormat: 'wav',
        name: 'Pop',
        rate: 48000,
        sampleCount: 100
    }];
    const sprite1 = {
        id: 'sprite-1',
        isOriginal: true,
        isStage: false,
        getName: () => 'Sprite1',
        getCostumes: () => sprite1Costumes,
        getSounds: () => sprite1Sounds
    };
    const apple = {
        id: 'apple-existing',
        isOriginal: true,
        isStage: false,
        getName: () => 'Apple',
        getCostumes: () => [{assetId: 'apple', dataFormat: 'svg', name: 'apple'}]
    };
    const stageCostumes = [{assetId: 'backdrop1', dataFormat: 'svg', name: 'backdrop1'}];
    const stage = {
        id: 'stage',
        isOriginal: true,
        isStage: true,
        getName: () => 'Stage',
        getCostumes: () => stageCostumes
    };
    const vm = {
        runtime: {
            targets: [stage, sprite1, apple],
            storage: {get: id => (id === 'uploaded' ? {data: new Uint8Array([1, 2, 3])} : null)}
        },
        editingTarget: sprite1
    };
    vm.addSprite = jest.fn(async () => {
        vm.runtime.targets.push({
            id: 'apple-created',
            isOriginal: true,
            isStage: false,
            getName: () => 'Apple',
            getCostumes: () => [{assetId: 'apple', dataFormat: 'svg', name: 'apple'}]
        });
    });
    vm.addCostumeFromLibrary = jest.fn(async () => {
        sprite1Costumes.push({assetId: 'arrow', dataFormat: 'svg', name: 'Arrow1-a'});
    });
    vm.addCostume = jest.fn(async (md5ext, costume, targetId) => {
        const targetCostumes = targetId === stage.id ? stageCostumes : sprite1Costumes;
        targetCostumes.push({
            assetId: costume && costume.assetId || 'uploaded-costume',
            dataFormat: costume && costume.dataFormat || 'svg',
            name: costume && costume.name || 'Rocket'
        });
    });
    vm.addBackdrop = jest.fn(async (md5ext, backdrop) => {
        stageCostumes.push({
            assetId: backdrop && backdrop.assetId || 'blue-sky',
            dataFormat: backdrop && backdrop.dataFormat || 'svg',
            name: backdrop && backdrop.name || 'Blue Sky'
        });
    });
    vm.addSound = jest.fn(async sound => {
        sprite1Sounds.push(sound && sound.assetId ? sound : {
            assetId: 'meow',
            dataFormat: 'wav',
            name: 'Meow',
            rate: 48000,
            sampleCount: 96000
        });
    });
    vm.updateSoundBuffer = jest.fn(async () => {
        sprite1Sounds[0] = {
            assetId: 'pop-faster',
            dataFormat: 'wav',
            name: 'Pop',
            rate: 48000,
            sampleCount: 75
        };
    });
    const targets = {
        'sprite-library-open': element('sprite-open', () => {
            state.library = 'sprite';
        }),
        'costume-library-open': element('costume-open', () => {
            state.library = 'costume';
        }),
        'backdrop-library-open': element('backdrop-open', () => {
            state.library = 'backdrop';
        }),
        'backdrop-editor-menu-open': element('backdrop-open', () => {
            state.library = 'backdrop';
        }),
        'sound-library-open': element('sound-open', () => {
            state.library = 'sound';
        }),
        'tab-costumes': element('costumes-tab', () => {
            state.tab = 'costumes';
        }),
        'tab-sounds': element('sounds-tab', () => {
            state.tab = 'sounds';
        }),
        'sound-item:0:pop': element('pop-sound'),
        'sound-effect:faster': element('faster-effect', () => vm.updateSoundBuffer()),
        'stage-selector': element('stage-selector', () => {
            vm.editingTarget = stage;
        }),
        Sprite1: element('sprite-1-selector', () => {
            vm.editingTarget = sprite1;
        })
    };
    targets['sound-upload-open'] = element('sound-upload');
    targets['sound-upload-open'].getBoundingClientRect = () => (state.uploadVisible ?
        {left: 100, top: 80, width: 120, height: 60, right: 220, bottom: 140} :
        {left: 100, top: 80, width: 0, height: 0, right: 100, bottom: 80});
    targets['sound-upload-open-input'] = {
        dispatchEvent: event => {
            if (event.type === 'change') {
                vm.addSound({
                    assetId: 'uploaded',
                    dataFormat: 'wav',
                    name: 'Sneaker',
                    rate: 48000,
                    sampleCount: 400
                });
            }
            return true;
        }
    };
    for (const mediaType of ['costume', 'backdrop']) {
        targets[`${mediaType}-upload-open`] = element(`${mediaType}-upload`);
        targets[`${mediaType}-upload-open`].getBoundingClientRect = () => (state.uploadVisible ?
            {left: 100, top: 80, width: 120, height: 60, right: 220, bottom: 140} :
            {left: 100, top: 80, width: 0, height: 0, right: 100, bottom: 80});
        targets[`${mediaType}-upload-open-input`] = {
            dispatchEvent: event => {
                if (event.type === 'change') {
                    vm.addCostume('uploaded-costume.svg', {
                        assetId: 'uploaded-costume',
                        dataFormat: 'svg',
                        name: 'Rocket'
                    }, vm.editingTarget.id);
                }
                return true;
            }
        };
        targets[`${mediaType}-paint-create`] = element(`${mediaType}-paint`, () => vm.addCostume(
            'blank-costume.svg',
            {assetId: 'blank-costume', dataFormat: 'svg', name: mediaType === 'backdrop' ? 'backdrop2' : 'costume2'},
            vm.editingTarget.id
        ));
        targets[`${mediaType}-paint-create`].getBoundingClientRect = () => (state.uploadVisible ?
            {left: 100, top: 80, width: 120, height: 60, right: 220, bottom: 140} :
            {left: 100, top: 80, width: 0, height: 0, right: 100, bottom: 80});
    }
    targets['backdrop-stage-upload-open'] = element('backdrop-upload');
    targets['backdrop-stage-upload-open'].getBoundingClientRect = () => (state.uploadVisible ?
        {left: 100, top: 80, width: 120, height: 60, right: 220, bottom: 140} :
        {left: 100, top: 80, width: 0, height: 0, right: 100, bottom: 80});
    targets['backdrop-stage-upload-open-input'] = {
        dispatchEvent: event => {
            if (event.type === 'change') {
                vm.addBackdrop('uploaded-costume.svg', {
                    assetId: 'uploaded-costume',
                    dataFormat: 'svg',
                    name: 'Rocket'
                });
            }
            return true;
        }
    };
    targets['backdrop-stage-paint-create'] = element('backdrop-paint', () => vm.addBackdrop(
        'blank-costume.svg',
        {assetId: 'blank-costume', dataFormat: 'svg', name: 'backdrop2'}
    ));
    targets['backdrop-stage-paint-create'].getBoundingClientRect = () => (state.uploadVisible ?
        {left: 100, top: 80, width: 120, height: 60, right: 220, bottom: 140} :
        {left: 100, top: 80, width: 0, height: 0, right: 100, bottom: 80});
    const appleItem = element('apple-item', () => vm.addSprite());
    const arrowItem = element('arrow-item', () => vm.addCostumeFromLibrary());
    const backdropItem = element('backdrop-item', () => vm.addBackdrop());
    const soundItem = element('sound-item', () => vm.addSound());
    documentObject.querySelector.mockImplementation(selector => {
        const studio = selector.match(/data-studio-target="([^"]+)"/);
        if (studio) return targets[studio[1]] || null;
        const sprite = selector.match(/data-studio-sprite-name="([^"]+)"/);
        if (sprite) return targets[sprite[1]] || null;
        const library = selector.match(/data-studio-library-key="([^"]+)"/);
        if (!library) return null;
        if (state.library === 'sprite' && library[1] === 'apple.svg') return appleItem;
        if (state.library === 'costume' && library[1] === 'arrow.svg') return arrowItem;
        if (state.library === 'backdrop' && library[1] === 'blue-sky.svg') return backdropItem;
        if (state.library === 'sound' && library[1] === 'meow.wav') return soundItem;
        return null;
    });
    const pointer = {
        travelTo: jest.fn(async target => {
            const targetElement = target.locate();
            return {
                completed: true,
                model: 'natural',
                target: {id: target.id, element: targetElement, point: {x: 160, y: 110}},
                frames: [{x: 160, y: 110}]
            };
        })
    };
    const scope = {runWithoutUndo: action => action()};
    const driver = createProjectLibraryDriver({
        vm,
        documentObject,
        clock: {},
        pointer,
        scope,
        checkpointPort
    });
    return {
        driver,
        vm,
        stage,
        sprite1,
        apple,
        pointer,
        appleItem,
        arrowItem,
        backdropItem,
        soundItem,
        state
    };
};

test('chooses a built-in sprite through the real library controls', async () => {
    const harness = makeHarness();
    const result = await harness.driver.play({
        kind: 'sprite-library-select',
        libraryItem: {name: 'Apple', md5ext: 'apple.svg'},
        targetRef: {name: 'Apple', isStage: false}
    });

    expect(result).toMatchObject({
        libraryVisibleBeforeSelect: true,
        selectedLibraryItem: {name: 'Apple', md5ext: 'apple.svg'},
        createdTarget: {id: 'apple-created', name: 'Apple', isStage: false},
        pointerTravel: {completed: true}
    });
    expect(harness.pointer.travelTo.mock.calls.map(call => call[0].id)).toEqual([
        'sprite-library-open',
        'library-item:apple.svg'
    ]);
    expect(harness.appleItem.scrollIntoView).toHaveBeenCalled();
});

test('waits for the real asynchronous VM library operation before completing', async () => {
    const harness = makeHarness();
    let resolveAdd;
    harness.vm.addSprite = jest.fn(() => new Promise(resolve => {
        resolveAdd = () => {
            harness.vm.runtime.targets.push({
                id: 'apple-created',
                isOriginal: true,
                isStage: false,
                getName: () => 'Apple',
                getCostumes: () => []
            });
            resolve();
        };
    }));
    const addSprite = harness.vm.addSprite;
    const playing = harness.driver.play({
        kind: 'sprite-library-select',
        libraryItem: {name: 'Apple', md5ext: 'apple.svg'},
        targetRef: {name: 'Apple', isStage: false}
    });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(addSprite).toHaveBeenCalledTimes(1);
    await expect(Promise.race([playing.then(() => 'settled'), Promise.resolve('pending')]))
        .resolves.toBe('pending');

    resolveAdd();
    await expect(playing).resolves.toMatchObject({createdTarget: {id: 'apple-created'}});
});

test('moves between sprites, opens Costumes and chooses the recorded built-in costume', async () => {
    const harness = makeHarness();
    harness.vm.editingTarget = harness.apple;
    const result = await harness.driver.play({
        kind: 'costume-library-select',
        libraryItem: {name: 'Arrow1-a', md5ext: 'arrow.svg'},
        targetRef: {name: 'Sprite1', isStage: false},
        addedCostume: {name: 'Arrow1-a', assetId: 'arrow', dataFormat: 'svg'}
    });

    expect(result).toMatchObject({
        libraryVisibleBeforeSelect: true,
        addedCostume: {name: 'Arrow1-a', assetId: 'arrow', dataFormat: 'svg'},
        addedCostumeMatches: true,
        pointerTravel: {completed: true}
    });
    expect(harness.vm.editingTarget).toBe(harness.sprite1);
    expect(harness.state.tab).toBe('costumes');
    expect(harness.pointer.travelTo.mock.calls.map(call => call[0].id)).toEqual([
        'sprite:Sprite1',
        'tab-costumes',
        'costume-library-open',
        'library-item:arrow.svg'
    ]);
    expect(harness.arrowItem.scrollIntoView).toHaveBeenCalled();
});

test('moves to the Stage and chooses the recorded built-in backdrop', async () => {
    const harness = makeHarness();
    const result = await harness.driver.play({
        kind: 'backdrop-library-select',
        libraryItem: {name: 'Blue Sky', md5ext: 'blue-sky.svg'},
        targetRef: {name: 'Stage', isStage: true},
        addedCostume: {name: 'Blue Sky', assetId: 'blue-sky', dataFormat: 'svg'}
    });

    expect(result).toMatchObject({
        libraryVisibleBeforeSelect: true,
        addedCostume: {name: 'Blue Sky', assetId: 'blue-sky', dataFormat: 'svg'},
        addedCostumeMatches: true,
        pointerTravel: {completed: true}
    });
    expect(harness.vm.editingTarget).toBe(harness.stage);
    expect(harness.state.tab).toBe('costumes');
    expect(harness.pointer.travelTo.mock.calls.map(call => call[0].id)).toEqual([
        'stage-selector',
        'tab-costumes',
        'backdrop-library-open',
        'library-item:blue-sky.svg'
    ]);
    expect(harness.backdropItem.scrollIntoView).toHaveBeenCalled();
});

test('opens Sounds and chooses the recorded built-in sound', async () => {
    const harness = makeHarness();
    const result = await harness.driver.play({
        kind: 'sound-library-select',
        libraryItem: {name: 'Meow', md5ext: 'meow.wav'},
        targetRef: {name: 'Sprite1', isStage: false},
        addedSound: {
            name: 'Meow',
            assetId: 'meow',
            dataFormat: 'wav',
            rate: 48000,
            sampleCount: 96000
        }
    });

    expect(result).toMatchObject({
        libraryVisibleBeforeSelect: true,
        addedSound: {name: 'Meow', assetId: 'meow', dataFormat: 'wav'},
        addedSoundMatches: true,
        pointerTravel: {completed: true}
    });
    expect(harness.state.tab).toBe('sounds');
    expect(harness.pointer.travelTo.mock.calls.map(call => call[0].id)).toEqual([
        'tab-sounds',
        'sound-library-open',
        'library-item:meow.wav'
    ]);
    expect(harness.soundItem.scrollIntoView).toHaveBeenCalled();
});

test('selects a sound and clicks its recorded editor effect', async () => {
    const harness = makeHarness();
    const result = await harness.driver.play({
        kind: 'sound-effect-click',
        targetRef: {name: 'Sprite1', isStage: false},
        soundIndex: 0,
        previousSound: {
            name: 'Pop',
            assetId: 'pop',
            dataFormat: 'wav',
            rate: 48000,
            sampleCount: 100
        },
        editedSound: {
            name: 'Pop',
            assetId: 'pop-faster',
            dataFormat: 'wav',
            rate: 48000,
            sampleCount: 75
        },
        soundEffect: 'faster'
    });

    expect(result).toMatchObject({
        selectedSound: {assetId: 'pop', sampleCount: 100},
        selectedSoundMatches: true,
        soundVisibleBeforeSelect: true,
        effectVisibleBeforeClick: true,
        editedSound: {assetId: 'pop-faster', sampleCount: 75},
        editedSoundMatches: true,
        pointerTravel: {completed: true}
    });
    expect(harness.pointer.travelTo.mock.calls.map(call => call[0].id)).toEqual([
        'tab-sounds',
        'sound-item:0:pop',
        'sound-effect:faster'
    ]);
});

test('uploads a recorded sound asset through the real file input', async () => {
    const harness = makeHarness();
    const result = await harness.driver.play({
        kind: 'sound-file-upload',
        targetRef: {name: 'Sprite1', isStage: false},
        uploadFile: {name: 'Sneaker'},
        addedSound: {
            name: 'Sneaker',
            assetId: 'uploaded',
            dataFormat: 'wav',
            rate: 48000,
            sampleCount: 400
        }
    });

    expect(result).toMatchObject({
        uploadControlVisible: true,
        fileInputReady: true,
        addedSound: {name: 'Sneaker', assetId: 'uploaded'},
        addedSoundMatches: true,
        pointerTravel: {completed: true}
    });
    expect(harness.pointer.travelTo.mock.calls.map(call => call[0].id)).toEqual([
        'tab-sounds',
        'sound-library-open',
        'sound-upload-open'
    ]);
});

test('reads an upload source from its durable after-checkpoint when VM storage was rewound', async () => {
    const checkpointPort = {
        readAsset: jest.fn(async () => new Uint8Array([4, 5, 6]))
    };
    const harness = makeHarness({checkpointPort});
    harness.vm.runtime.storage.get = jest.fn(() => null);

    const result = await harness.driver.play({
        kind: 'sound-file-upload',
        targetRef: {name: 'Sprite1', isStage: false},
        uploadFile: {name: 'Sneaker'},
        addedSound: {
            name: 'Sneaker',
            assetId: 'uploaded',
            dataFormat: 'wav',
            rate: 48000,
            sampleCount: 400
        },
        sourceCheckpointId: 42,
        sourceAssetMd5: 'uploaded.wav'
    });

    expect(checkpointPort.readAsset).toHaveBeenCalledWith(42, 'uploaded.wav');
    expect(result).toMatchObject({fileInputReady: true, addedSoundMatches: true});
});

test('uploads a recorded costume asset through the real file input', async () => {
    const harness = makeHarness();
    harness.vm.runtime.storage.get = jest.fn(id => (
        id === 'uploaded-costume' ? {data: new Uint8Array([1, 2, 3])} : null
    ));

    const result = await harness.driver.play({
        kind: 'costume-file-upload',
        targetRef: {name: 'Sprite1', isStage: false},
        uploadFile: {name: 'Rocket'},
        addedCostume: {name: 'Rocket', assetId: 'uploaded-costume', dataFormat: 'svg'}
    });

    expect(result).toMatchObject({
        uploadControlVisible: true,
        fileInputReady: true,
        addedCostume: {name: 'Rocket', assetId: 'uploaded-costume'},
        addedCostumeMatches: true,
        pointerTravel: {completed: true}
    });
    expect(harness.pointer.travelTo.mock.calls.map(call => call[0].id)).toEqual([
        'tab-costumes',
        'costume-library-open',
        'costume-upload-open'
    ]);
});

test('uploads a recorded backdrop through the visible Stage file input', async () => {
    const harness = makeHarness();
    harness.vm.runtime.storage.get = jest.fn(id => (
        id === 'uploaded-costume' ? {data: new Uint8Array([1, 2, 3])} : null
    ));

    const result = await harness.driver.play({
        kind: 'backdrop-file-upload',
        targetRef: {name: 'Stage', isStage: true},
        uploadFile: {name: 'Rocket'},
        addedCostume: {name: 'Rocket', assetId: 'uploaded-costume', dataFormat: 'svg'}
    });

    expect(result).toMatchObject({
        uploadControlVisible: true,
        fileInputReady: true,
        addedCostume: {name: 'Rocket', assetId: 'uploaded-costume'},
        addedCostumeMatches: true,
        pointerTravel: {completed: true}
    });
    expect(harness.pointer.travelTo.mock.calls.map(call => call[0].id)).toEqual([
        'stage-selector',
        'tab-costumes',
        'backdrop-library-open',
        'backdrop-stage-upload-open'
    ]);
});

test('creates a blank backdrop through the real Paint control', async () => {
    const harness = makeHarness();

    const result = await harness.driver.play({
        kind: 'backdrop-paint-create',
        targetRef: {name: 'Stage', isStage: true},
        addedCostume: {name: 'backdrop2', assetId: 'blank-costume', dataFormat: 'svg'}
    });

    expect(result).toMatchObject({
        createControlVisible: true,
        addedCostume: {name: 'backdrop2', assetId: 'blank-costume'},
        addedCostumeMatches: true,
        pointerTravel: {completed: true}
    });
    expect(harness.pointer.travelTo.mock.calls.map(call => call[0].id)).toEqual([
        'stage-selector',
        'tab-costumes',
        'backdrop-library-open',
        'backdrop-stage-paint-create'
    ]);
});

test('rejects an unavailable upload asset before moving the pointer', async () => {
    const harness = makeHarness();
    harness.vm.runtime.storage.get = jest.fn(() => null);

    await expect(harness.driver.play({
        kind: 'sound-file-upload',
        targetRef: {name: 'Sprite1', isStage: false},
        uploadFile: {name: 'Missing'},
        addedSound: {
            name: 'Missing',
            assetId: 'missing',
            dataFormat: 'wav',
            rate: 48000,
            sampleCount: 400
        }
    })).rejects.toThrow('Recorded sound asset is unavailable: missing');

    expect(harness.pointer.travelTo).not.toHaveBeenCalled();
});

test('rejects a missing costume target before opening editor controls', async () => {
    const harness = makeHarness();

    await expect(harness.driver.play({
        kind: 'costume-library-select',
        libraryItem: {name: 'Arrow1-a', md5ext: 'arrow.svg'},
        targetRef: {name: 'Missing Sprite', isStage: false},
        addedCostume: {name: 'Arrow1-a', assetId: 'arrow', dataFormat: 'svg'}
    })).rejects.toThrow('Project target is unavailable: Missing Sprite');

    expect(harness.pointer.travelTo).not.toHaveBeenCalled();
});
