import {createAuthoredStatePort} from '../../src/studio/bridge/authored-state-port';

const makeEmitter = () => {
    const listeners = new Map();
    return {
        emit: event => (listeners.get(event) || []).slice().forEach(listener => listener()),
        on: (event, listener) => listeners.set(event, [...(listeners.get(event) || []), listener]),
        removeListener: (event, listener) => listeners.set(
            event,
            (listeners.get(event) || []).filter(candidate => candidate !== listener)
        )
    };
};

const makeHarness = () => {
    const emitter = makeEmitter();
    const stage = {
        isOriginal: true,
        isStage: true,
        name: 'Stage',
        variables: {
            score: {type: '', value: 10},
            cloud: {type: '', value: 20},
            level: {type: 'list', value: ['a', 'b', 'c']}
        },
        currentCostume: 0,
        volume: 100,
        layerOrder: 0,
        tempo: 60,
        videoTransparency: 50,
        videoState: 'on',
        textToSpeechLanguage: null,
        setCostume: value => {
            stage.currentCostume = value;
        }
    };
    const sprite = {
        isOriginal: true,
        isStage: false,
        sprite: {name: 'Sprite1'},
        variables: {},
        currentCostume: 0,
        volume: 100,
        layerOrder: 1,
        visible: true,
        x: 10,
        y: 20,
        size: 100,
        direction: 90,
        draggable: false,
        rotationStyle: 'all around',
        goToFront: () => {
            sprite.layerOrder = 1;
        },
        setCostume: value => {
            sprite.currentCostume = value;
        },
        setDirection: value => {
            sprite.direction = value;
        },
        setDraggable: value => {
            sprite.draggable = value;
        },
        setRotationStyle: value => {
            sprite.rotationStyle = value;
        },
        setSize: value => {
            sprite.size = value;
        },
        setVisible: value => {
            sprite.visible = value;
        },
        setXY: (x, y) => {
            sprite.x = x;
            sprite.y = y;
        }
    };
    const serializedTarget = target => target.isStage ? {
        isStage: true,
        name: 'Stage',
        variables: {
            score: ['score', target.variables.score.value],
            cloud: ['cloud score', target.variables.cloud.value, true]
        },
        lists: {level: ['level', target.variables.level.value]},
        currentCostume: target.currentCostume,
        volume: target.volume,
        layerOrder: target.layerOrder,
        tempo: target.tempo,
        videoTransparency: target.videoTransparency,
        videoState: target.videoState,
        textToSpeechLanguage: target.textToSpeechLanguage
    } : {
        isStage: false,
        name: target.sprite.name,
        variables: {},
        lists: {},
        currentCostume: target.currentCostume,
        volume: target.volume,
        layerOrder: target.layerOrder,
        visible: target.visible,
        x: target.x,
        y: target.y,
        size: target.size,
        direction: target.direction,
        draggable: target.draggable,
        rotationStyle: target.rotationStyle
    };
    let stopCalls = 0;
    const monitorUpdates = [];
    const monitorEvents = [];
    const monitorState = {
        dirty: false,
        shallowClone: () => ({snapshot: true})
    };
    const vm = {
        ...emitter,
        runtime: {
            targets: [stage, sprite],
            _monitorState: monitorState,
            emit: (event, value) => monitorEvents.push([event, value]),
            requestUpdateMonitor: update => {
                monitorUpdates.push(update);
                monitorState.dirty = true;
                return true;
            }
        },
        stopAll: () => {
            stopCalls++;
        },
        toJSON: () => JSON.stringify({targets: [serializedTarget(stage), serializedTarget(sprite)]})
    };
    return {
        getStopCalls: () => stopCalls,
        monitorEvents,
        monitorUpdates,
        port: createAuthoredStatePort({vm}),
        sprite,
        stage,
        vm
    };
};

test('restores the clean authored shadow before history after runtime execution', () => {
    const harness = makeHarness();
    harness.port.adoptCurrent();

    harness.vm.emit('PROJECT_RUN_START');
    harness.stage.variables.score.value = 99;
    harness.stage.variables.cloud.value = 88;
    harness.stage.variables.level.value.splice(1, 1);
    harness.sprite.x = -120;
    harness.sprite.visible = false;
    harness.sprite.layerOrder = 9;

    expect(harness.port.isDirty()).toBe(true);
    expect(harness.port.prepare()).toEqual({restored: true});
    expect(harness.getStopCalls()).toBe(1);
    expect(harness.stage.variables.score.value).toBe(10);
    expect(harness.stage.variables.cloud.value).toBe(88);
    expect(harness.stage.variables.level.value).toEqual(['a', 'b', 'c']);
    expect(harness.sprite).toMatchObject({x: 10, visible: true, layerOrder: 1});
    expect(harness.port.isDirty()).toBe(false);
});

test('explicit adoption replaces the authored baseline', () => {
    const harness = makeHarness();
    harness.port.adoptCurrent();

    harness.stage.variables.score.value = 15;
    harness.port.adoptCurrent();
    harness.vm.emit('PROJECT_START');
    harness.stage.variables.score.value = 200;

    harness.port.restore();
    expect(harness.stage.variables.score.value).toBe(15);
});

test('can stop execution before adopting a deliberate live state', () => {
    const harness = makeHarness();
    harness.stage.variables.score.value = 25;
    harness.port.adoptCurrent({stopRuntime: true});
    expect(harness.getStopCalls()).toBe(1);

    harness.vm.emit('PROJECT_RUN_START');
    harness.stage.variables.score.value = 90;
    harness.port.restore();
    expect(harness.stage.variables.score.value).toBe(25);
});

test('detaching removes runtime listeners', () => {
    const harness = makeHarness();
    harness.port.adoptCurrent();
    harness.port.detach();
    harness.vm.emit('PROJECT_RUN_START');
    expect(harness.port.isDirty()).toBe(false);
});

test('a clicked script marks authored state dirty even without a green flag', () => {
    const harness = makeHarness();
    harness.port.adoptCurrent();
    harness.vm.emit('SCRIPT_GLOW_ON');
    expect(harness.port.isDirty()).toBe(true);
});

test('seals runtime data as a reversible delta without restoring it', () => {
    const harness = makeHarness();
    harness.port.adoptCurrent();
    harness.vm.emit('SCRIPT_GLOW_ON');
    harness.stage.variables.score.value = 30;
    harness.stage.variables.level.value.splice(1, 1);

    const delta = harness.port.sealDataChanges();

    expect(delta.targets[0]).toMatchObject({
        targetRef: {isStage: true, name: 'Stage'},
        variables: {score: {before: 10, after: 30}},
        lists: {level: {index: 1, removed: ['b'], inserted: []}}
    });
    expect(harness.port.isDirty()).toBe(false);
    expect(harness.stage.variables.score.value).toBe(30);

    harness.port.applyDataDelta(delta, 'backward');
    expect(harness.stage.variables.score.value).toBe(10);
    expect(harness.stage.variables.level.value).toEqual(['a', 'b', 'c']);
    harness.port.applyDataDelta(delta, 'forward');
    expect(harness.stage.variables.score.value).toBe(30);
    expect(harness.stage.variables.level.value).toEqual(['a', 'c']);
    expect(harness.monitorUpdates).toContainEqual({id: 'level', value: ['a', 'b', 'c']});
    expect(harness.monitorUpdates).toContainEqual({id: 'level', value: ['a', 'c']});
    expect(harness.monitorEvents).toContainEqual(['MONITORS_UPDATE', {snapshot: true}]);
});

test('seals authored target properties and remains dirty only while execution is running', () => {
    const harness = makeHarness();
    harness.port.adoptCurrent();
    harness.vm.emit('PROJECT_RUN_START');
    harness.stage.variables.score.value = 30;
    harness.sprite.x = 50;

    expect(harness.port.sealDataChanges()).toMatchObject({
        targets: expect.arrayContaining([
            expect.objectContaining({
                targetRef: {isStage: false, name: 'Sprite1'},
                properties: {x: {before: 10, after: 50}}
            })
        ])
    });
    expect(harness.port.isDirty()).toBe(true);

    harness.vm.emit('PROJECT_RUN_STOP');
    expect(harness.port.sealDataChanges()).toBeNull();
    expect(harness.port.isDirty()).toBe(false);
});

test('does not misclassify broadcast definitions as authored lists', () => {
    const harness = makeHarness();
    harness.port.adoptCurrent();

    harness.port.adoptListDefinition({
        present: true,
        id: 'broadcast-id',
        targetRef: {isStage: true, name: 'Stage'},
        name: 'start game',
        type: 'broadcast_msg',
        value: 'start game'
    });

    expect(harness.port.isDirty()).toBe(false);
    expect(harness.port.sealDataChanges()).toBeNull();
});
