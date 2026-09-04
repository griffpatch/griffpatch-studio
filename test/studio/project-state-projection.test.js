import {createProjectStatePort} from '../../src/studio/bridge/project-state-port';
import {
    projectAuthoredState,
    projectStructuralState
} from '../../src/studio/validation/project-state-projection';

const makeProject = () => ({
    targets: [{
        isStage: true,
        name: 'Stage',
        variables: {
            score: ['score', 10],
            cloud: ['cloud score', 20, true]
        },
        lists: {level: ['level', ['a', 'b', 'c']]},
        broadcasts: {},
        blocks: {block: {opcode: 'event_whenflagclicked'}},
        comments: {},
        currentCostume: 0,
        costumes: [{name: 'backdrop1', assetId: 'asset-1'}],
        sounds: [],
        volume: 100,
        layerOrder: 0,
        tempo: 60,
        videoTransparency: 50,
        videoState: 'on',
        textToSpeechLanguage: null
    }, {
        isStage: false,
        name: 'Sprite1',
        variables: {},
        lists: {},
        broadcasts: {},
        blocks: {},
        comments: {},
        currentCostume: 0,
        costumes: [{name: 'costume1', assetId: 'asset-2'}],
        sounds: [],
        volume: 100,
        layerOrder: 1,
        visible: true,
        x: 10,
        y: 20,
        size: 100,
        direction: 90,
        draggable: false,
        rotationStyle: 'all around'
    }],
    monitors: [{
        id: 'score',
        opcode: 'data_variable',
        params: {VARIABLE: 'score'},
        value: 10,
        visible: true
    }],
    extensions: [],
    meta: {semver: '3.0.0'}
});

const digest = bytes => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

test('structural state excludes runtime-mutated values but retains definitions', () => {
    const project = makeProject();
    const structural = projectStructuralState(project);

    expect(structural.targets[0].variables).toEqual({
        score: {name: 'score'},
        cloud: {name: 'cloud score', isCloud: true}
    });
    expect(structural.targets[0].lists).toEqual({level: {name: 'level'}});
    expect(structural.targets[0]).not.toHaveProperty('tempo');
    expect(structural.targets[1]).not.toHaveProperty('x');
    expect(structural.targets[1].blocks).toEqual(project.targets[1].blocks);
    expect(structural.monitors[0]).not.toHaveProperty('value');
    expect(structural.monitors[0]).toMatchObject({id: 'score', visible: true});
});

test('authored state captures values and persisted properties but not cloud values', () => {
    const authored = projectAuthoredState(makeProject());

    expect(authored.targets[0]).toMatchObject({
        targetRef: {isStage: true, name: 'Stage'},
        variables: {score: 10},
        lists: {level: ['a', 'b', 'c']},
        properties: {currentCostume: 0, tempo: 60}
    });
    expect(authored.targets[0].variables).not.toHaveProperty('cloud');
    expect(authored.targets[1].properties).toMatchObject({x: 10, y: 20, visible: true});
});

test('structural hash ignores live values but detects block changes', async () => {
    const project = makeProject();
    const vm = {toJSON: () => JSON.stringify(project)};
    const port = createProjectStatePort({vm, digest});
    const initial = await port.capture();

    project.targets[0].variables.score[1] = 999;
    project.targets[0].lists.level[1].splice(1, 1);
    project.monitors[0].value = 999;
    project.targets[1].x = -200;
    project.targets[1].visible = false;
    const runtimeChanged = await port.capture();
    expect(runtimeChanged.structural.hash).toBe(initial.structural.hash);
    expect(runtimeChanged.authored.hash).not.toBe(initial.authored.hash);

    project.targets[1].blocks.newBlock = {opcode: 'looks_say'};
    expect((await port.capture()).structural.hash).not.toBe(initial.structural.hash);
});

test('preserves the original structural-v1 monitor-value contract', async () => {
    const project = makeProject();
    const vm = {toJSON: () => JSON.stringify(project)};
    const port = createProjectStatePort({vm, digest});
    const initial = await port.capture({hashKind: 'structural-v1'});

    project.monitors[0].value = 999;

    expect((await port.capture({hashKind: 'structural-v1'})).structural.hash)
        .not.toBe(initial.structural.hash);
    expect((await port.capture({hashKind: 'structural-v2'})).structural.project.monitors[0])
        .not.toHaveProperty('value');
});

test('structural-v3 treats reconstructed md5ext fields as redundant asset metadata', async () => {
    const project = makeProject();
    project.targets[1].costumes[0].dataFormat = 'svg';
    const vm = {toJSON: () => JSON.stringify(project)};
    const port = createProjectStatePort({vm, digest});
    const beforeLoad = await port.capture({hashKind: 'structural-v3'});

    project.targets[1].costumes[0].md5ext = 'asset-2.svg';
    const afterLoad = await port.capture({hashKind: 'structural-v3'});

    expect(afterLoad.structural.hash).toBe(beforeLoad.structural.hash);
    expect(afterLoad.structural.project.targets[1].costumes[0]).not.toHaveProperty('md5ext');
    expect((await port.capture({hashKind: 'structural-v2'})).structural.project.targets[1].costumes[0])
        .toHaveProperty('md5ext', 'asset-2.svg');
});

test('structural-v4 canonicalizes regenerated block IDs without hiding topology changes', async () => {
    const project = makeProject();
    project.targets[1].blocks = {
        parent: {
            opcode: 'looks_say',
            next: null,
            parent: null,
            inputs: {MESSAGE: {block: 'reporter', shadow: 'text-shadow'}},
            fields: {},
            shadow: false,
            topLevel: true,
            x: 100,
            y: 120
        },
        reporter: {
            opcode: 'motion_xposition',
            next: null,
            parent: 'parent',
            inputs: {},
            fields: {},
            shadow: false,
            topLevel: false
        },
        'text-shadow': {
            opcode: 'text',
            next: null,
            parent: 'parent',
            inputs: {},
            fields: {TEXT: {value: 'Hello!'}},
            shadow: true,
            topLevel: false
        }
    };
    const vm = {toJSON: () => JSON.stringify(project)};
    const port = createProjectStatePort({vm, digest});
    const originalV3 = await port.capture({hashKind: 'structural-v3'});
    const originalV4 = await port.capture({hashKind: 'structural-v4'});

    const blocks = project.targets[1].blocks;
    project.targets[1].blocks = {
        liveSay: {...blocks.parent, inputs: {MESSAGE: {block: 'liveReporter', shadow: 'liveShadow'}}},
        liveReporter: {...blocks.reporter, parent: 'liveSay'},
        liveShadow: {...blocks['text-shadow'], parent: 'liveSay'}
    };

    expect((await port.capture({hashKind: 'structural-v3'})).structural.hash).not.toBe(
        originalV3.structural.hash
    );
    expect((await port.capture({hashKind: 'structural-v4'})).structural.hash).toBe(
        originalV4.structural.hash
    );

    project.targets[1].blocks.liveReporter.parent = null;
    expect((await port.capture({hashKind: 'structural-v4'})).structural.hash).not.toBe(
        originalV4.structural.hash
    );
});

test('structural-v5 canonicalizes real VM input tuples and preserves inline primitive shadows', async () => {
    const project = makeProject();
    project.targets[1].blocks = {
        say: {
            opcode: 'looks_sayforsecs',
            next: null,
            parent: null,
            inputs: {
                MESSAGE: [3, 'reporter', 'message-shadow'],
                SECS: [1, [4, '2']]
            },
            fields: {},
            shadow: false,
            topLevel: true,
            x: 100,
            y: 120
        },
        reporter: {
            opcode: 'operator_join',
            next: null,
            parent: 'say',
            inputs: {
                STRING1: [1, 'left-shadow'],
                STRING2: [1, [10, 'world']]
            },
            fields: {},
            shadow: false,
            topLevel: false
        },
        'message-shadow': {
            opcode: 'text',
            next: null,
            parent: 'say',
            inputs: {},
            fields: {TEXT: {value: 'Hello!'}},
            shadow: true,
            topLevel: false
        },
        'left-shadow': {
            opcode: 'text',
            next: null,
            parent: 'reporter',
            inputs: {},
            fields: {TEXT: {value: 'hello'}},
            shadow: true,
            topLevel: false
        }
    };
    const vm = {toJSON: () => JSON.stringify(project)};
    const port = createProjectStatePort({vm, digest});
    const legacyV4 = await port.capture({hashKind: 'structural-v4'});
    const original = await port.capture({hashKind: 'structural-v5'});
    const originalBlocks = project.targets[1].blocks;

    project.targets[1].blocks = {
        liveSay: {
            ...originalBlocks.say,
            inputs: {
                MESSAGE: [3, 'liveReporter', 'liveMessageShadow'],
                SECS: [1, [4, '2']]
            }
        },
        liveReporter: {
            ...originalBlocks.reporter,
            parent: 'liveSay',
            inputs: {
                STRING1: [1, 'liveLeftShadow'],
                STRING2: [1, [10, 'world']]
            }
        },
        liveMessageShadow: {...originalBlocks['message-shadow'], parent: 'liveSay'},
        liveLeftShadow: {...originalBlocks['left-shadow'], parent: 'liveReporter'}
    };

    expect((await port.capture({hashKind: 'structural-v4'})).structural.hash).not.toBe(
        legacyV4.structural.hash
    );
    const regenerated = await port.capture({hashKind: 'structural-v5'});
    expect(regenerated.structural.hash).toBe(original.structural.hash);
    expect(regenerated.structural.project.targets[1].blocks['block-1'].inputs.SECS)
        .toEqual([1, [4, '2']]);
    expect(regenerated.structural.project.targets[1].blocks['block-3'].inputs.STRING2)
        .toEqual([1, [10, 'world']]);

    project.targets[1].blocks.liveSay.inputs.MESSAGE = [3, 'liveMessageShadow', 'liveReporter'];
    expect((await port.capture({hashKind: 'structural-v5'})).structural.hash).not.toBe(
        original.structural.hash
    );
});

test('structural-v5 canonicalizes shadow-only tuple IDs across repeated command blocks', async () => {
    const project = makeProject();
    const command = (messageId, x) => ({
        opcode: 'looks_say',
        next: null,
        parent: null,
        inputs: {MESSAGE: [1, messageId]},
        fields: {},
        shadow: false,
        topLevel: true,
        x,
        y: 120
    });
    const shadow = (parent, value) => ({
        opcode: 'text',
        next: null,
        parent,
        inputs: {},
        fields: {TEXT: {value}},
        shadow: true,
        topLevel: false
    });
    project.targets[1].blocks = {
        first: command('first-message', 100),
        'first-message': shadow('first', 'first'),
        second: command('second-message', 260),
        'second-message': shadow('second', 'second')
    };
    const vm = {toJSON: () => JSON.stringify(project)};
    const port = createProjectStatePort({vm, digest});
    const original = await port.capture({hashKind: 'structural-v5'});
    const blocks = project.targets[1].blocks;

    project.targets[1].blocks = {
        zRoot: {...blocks.first, inputs: {MESSAGE: [1, 'zShadow']}},
        zShadow: {...blocks['first-message'], parent: 'zRoot'},
        aRoot: {...blocks.second, inputs: {MESSAGE: [1, 'aShadow']}},
        aShadow: {...blocks['second-message'], parent: 'aRoot'}
    };

    expect((await port.capture({hashKind: 'structural-v5'})).structural.hash).toBe(
        original.structural.hash
    );
});

test('structural-v6 canonicalizes procedure argument input IDs without changing v5', async () => {
    const project = makeProject();
    const makeBlocks = ({definition, prototype, argument, call, value}) => ({
        [definition]: {
            opcode: 'procedures_definition',
            next: null,
            parent: null,
            inputs: {custom_block: [1, prototype]},
            fields: {},
            shadow: false,
            topLevel: true,
            x: 100,
            y: 120
        },
        [prototype]: {
            opcode: 'procedures_prototype',
            next: null,
            parent: definition,
            inputs: {[argument]: [1, argument]},
            fields: {},
            mutation: {proccode: 'show %s', argumentids: JSON.stringify([argument])},
            shadow: false,
            topLevel: false
        },
        [argument]: {
            opcode: 'argument_reporter_string_number',
            next: null,
            parent: prototype,
            inputs: {},
            fields: {},
            shadow: false,
            topLevel: false
        },
        [call]: {
            opcode: 'procedures_call',
            next: null,
            parent: null,
            inputs: {[argument]: [1, value]},
            fields: {},
            mutation: {proccode: 'show %s', argumentids: JSON.stringify([argument])},
            shadow: false,
            topLevel: true,
            x: 300,
            y: 120
        },
        [value]: {
            opcode: 'text',
            next: null,
            parent: call,
            inputs: {},
            fields: {TEXT: {value: 'cake'}},
            shadow: true,
            topLevel: false
        }
    });
    project.targets[1].blocks = makeBlocks({
        definition: 'definition',
        prototype: 'prototype',
        argument: 'argument-id',
        call: 'call',
        value: 'value'
    });
    const vm = {toJSON: () => JSON.stringify(project)};
    const port = createProjectStatePort({vm, digest});
    const originalV5 = await port.capture({hashKind: 'structural-v5'});
    const originalV6 = await port.capture({hashKind: 'structural-v6'});

    project.targets[1].blocks = makeBlocks({
        definition: 'live-definition',
        prototype: 'live-prototype',
        argument: 'live-argument-id',
        call: 'live-call',
        value: 'live-value'
    });

    expect(port.preferredHashKind).toBe('structural-v10');
    expect((await port.capture({hashKind: 'structural-v5'})).structural.hash).not.toBe(
        originalV5.structural.hash
    );
    expect((await port.capture({hashKind: 'structural-v6'})).structural.hash).toBe(
        originalV6.structural.hash
    );
});

test('structural-v7 canonicalizes inert empty input tuples without hiding authored values', async () => {
    const project = makeProject();
    project.targets[1].blocks = {
        root: {
            opcode: 'operator_and',
            next: null,
            parent: null,
            inputs: {
                OPERAND1: [1, null],
                OPERAND2: [1, [10, '']]
            },
            fields: {},
            shadow: false,
            topLevel: true,
            x: 100,
            y: 120
        }
    };
    const vm = {toJSON: () => JSON.stringify(project)};
    const port = createProjectStatePort({vm, digest});
    const originalV6 = await port.capture({hashKind: 'structural-v6'});
    const originalV7 = await port.capture({hashKind: 'structural-v7'});

    delete project.targets[1].blocks.root.inputs.OPERAND1;

    expect((await port.capture({hashKind: 'structural-v6'})).structural.hash).not.toBe(
        originalV6.structural.hash
    );
    expect((await port.capture({hashKind: 'structural-v7'})).structural.hash).toBe(
        originalV7.structural.hash
    );

    project.targets[1].blocks.root.inputs.OPERAND2 = [1, [10, 'changed']];
    expect((await port.capture({hashKind: 'structural-v7'})).structural.hash).not.toBe(
        originalV7.structural.hash
    );
});

test('structural-v8 canonicalizes omitted null field IDs without hiding field identity or values', async () => {
    const project = makeProject();
    project.targets[1].blocks = {
        dropdown: {
            opcode: 'sensing_keyoptions',
            next: null,
            parent: null,
            inputs: {},
            fields: {KEY_OPTION: ['space', null]},
            shadow: true,
            topLevel: true,
            x: 100,
            y: 120
        }
    };
    const vm = {toJSON: () => JSON.stringify(project)};
    const port = createProjectStatePort({vm, digest});
    const originalV7 = await port.capture({hashKind: 'structural-v7'});
    const originalV8 = await port.capture({hashKind: 'structural-v8'});

    project.targets[1].blocks.dropdown.fields.KEY_OPTION = ['space'];

    expect((await port.capture({hashKind: 'structural-v7'})).structural.hash).not.toBe(
        originalV7.structural.hash
    );
    expect((await port.capture({hashKind: 'structural-v8'})).structural.hash).toBe(
        originalV8.structural.hash
    );

    project.targets[1].blocks.dropdown.fields.KEY_OPTION = ['changed'];
    expect((await port.capture({hashKind: 'structural-v8'})).structural.hash).not.toBe(
        originalV8.structural.hash
    );

    project.targets[1].blocks.dropdown.fields.KEY_OPTION = ['space', 'variable-id'];
    expect((await port.capture({hashKind: 'structural-v8'})).structural.hash).not.toBe(
        originalV8.structural.hash
    );
});

test('structural-v9 uses durable Scratch block-coordinate precision', async () => {
    const project = makeProject();
    project.targets[1].blocks = {
        root: {
            opcode: 'event_whenflagclicked',
            next: null,
            parent: null,
            inputs: {},
            fields: {},
            shadow: false,
            topLevel: true,
            x: 369.0483221831145,
            y: 256.4444444444443
        }
    };
    const vm = {toJSON: () => JSON.stringify(project)};
    const port = createProjectStatePort({vm, digest});
    const originalV8 = await port.capture({hashKind: 'structural-v8'});
    const originalV9 = await port.capture({hashKind: 'structural-v9'});

    project.targets[1].blocks.root.x = 369;
    project.targets[1].blocks.root.y = 256;

    expect((await port.capture({hashKind: 'structural-v8'})).structural.hash).not.toBe(
        originalV8.structural.hash
    );
    expect((await port.capture({hashKind: 'structural-v9'})).structural.hash).toBe(
        originalV9.structural.hash
    );

    project.targets[1].blocks.root.x = 370;
    expect((await port.capture({hashKind: 'structural-v9'})).structural.hash).not.toBe(
        originalV9.structural.hash
    );
});

test('structural-v10 canonicalizes an inert null shadow without hiding a real shadow or child', async () => {
    const project = makeProject();
    project.targets[1].blocks = {
        repeat: {
            opcode: 'control_repeat',
            next: null,
            parent: null,
            inputs: {SUBSTACK: [3, 'child', null]},
            fields: {},
            shadow: false,
            topLevel: true,
            x: 100,
            y: 120
        },
        child: {
            opcode: 'looks_say',
            next: null,
            parent: 'repeat',
            inputs: {},
            fields: {},
            shadow: false,
            topLevel: false
        },
        shadow: {
            opcode: 'looks_think',
            next: null,
            parent: 'repeat',
            inputs: {},
            fields: {},
            shadow: true,
            topLevel: false
        }
    };
    const vm = {toJSON: () => JSON.stringify(project)};
    const port = createProjectStatePort({vm, digest});
    const originalV9 = await port.capture({hashKind: 'structural-v9'});
    const originalV10 = await port.capture({hashKind: 'structural-v10'});

    project.targets[1].blocks.repeat.inputs.SUBSTACK = [2, 'child'];

    expect((await port.capture({hashKind: 'structural-v9'})).structural.hash).not.toBe(
        originalV9.structural.hash
    );
    expect((await port.capture({hashKind: 'structural-v10'})).structural.hash).toBe(
        originalV10.structural.hash
    );

    project.targets[1].blocks.repeat.inputs.SUBSTACK = [3, 'child', 'shadow'];
    expect((await port.capture({hashKind: 'structural-v10'})).structural.hash).not.toBe(
        originalV10.structural.hash
    );

    project.targets[1].blocks.repeat.inputs.SUBSTACK = [2, 'shadow'];
    expect((await port.capture({hashKind: 'structural-v10'})).structural.hash).not.toBe(
        originalV10.structural.hash
    );
});
