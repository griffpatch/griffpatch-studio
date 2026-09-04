import {createProjectStatePort} from '../../src/studio/bridge/project-state-port';

const digest = bytes => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

const projectWithBlocks = blocks => ({
    targets: [{
        isStage: true,
        name: 'Stage',
        variables: {},
        lists: {},
        broadcasts: {},
        blocks: {},
        comments: {},
        costumes: [],
        sounds: []
    }, {
        isStage: false,
        name: 'Sprite1',
        variables: {},
        lists: {},
        broadcasts: {},
        blocks,
        comments: {},
        costumes: [],
        sounds: []
    }],
    monitors: [],
    extensions: [],
    meta: {semver: '3.0.0'}
});

const block = ({opcode, parent = null, next = null, inputs = {}, fields = {}, topLevel = false, ...rest}) => ({
    opcode,
    next,
    parent,
    inputs,
    fields,
    shadow: false,
    topLevel,
    ...rest
});

const shadow = ({opcode, parent, fields = {}}) => ({
    opcode,
    next: null,
    parent,
    inputs: {},
    fields,
    shadow: true,
    topLevel: false
});

const renameBlockGraph = blocks => {
    const aliases = Object.keys(blocks).reduce((map, id, index) => {
        map[id] = `live-${index + 1}`;
        return map;
    }, {});
    const alias = id => aliases[id] || id;
    const renameInput = input => {
        if (Array.isArray(input)) {
            return input.map((value, index) => index > 0 && typeof value === 'string' && blocks[value] ?
                alias(value) : value);
        }
        return {
            ...input,
            block: alias(input.block),
            shadow: alias(input.shadow)
        };
    };
    return Object.keys(blocks).reduce((renamed, id) => {
        const source = blocks[id];
        const mutation = source.mutation && {...source.mutation};
        if (mutation && typeof mutation.argumentids === 'string') {
            mutation.argumentids = JSON.stringify(JSON.parse(mutation.argumentids).map(alias));
        }
        renamed[alias(id)] = {
            ...source,
            next: alias(source.next),
            parent: alias(source.parent),
            inputs: Object.keys(source.inputs || {}).reduce((inputs, name) => {
                inputs[blocks[name] ? alias(name) : name] = renameInput(source.inputs[name]);
                return inputs;
            }, {}),
            ...(mutation ? {mutation} : {})
        };
        return renamed;
    }, {});
};

const scenarios = [{
    name: 'statement stack append and numeric shadow',
    blocks: {
        hat: block({opcode: 'event_whenflagclicked', next: 'move', topLevel: true, x: 80, y: 90}),
        move: block({
            opcode: 'motion_movesteps',
            parent: 'hat',
            next: 'turn',
            inputs: {STEPS: [1, 'steps-shadow']}
        }),
        'steps-shadow': shadow({opcode: 'math_number', parent: 'move', fields: {NUM: {value: '10'}}}),
        turn: block({opcode: 'motion_turnright', parent: 'move'})
    },
    drift: blocks => {
        blocks['live-4'].parent = 'live-1';
        blocks['live-1'].next = 'live-4';
    }
}, {
    name: 'C-block statement input and following stack',
    blocks: {
        repeat: block({
            opcode: 'control_repeat',
            next: 'after',
            inputs: {TIMES: [1, [4, '10']], SUBSTACK: [2, 'say']},
            topLevel: true,
            x: 120,
            y: 100
        }),
        say: block({opcode: 'looks_say', parent: 'repeat', inputs: {MESSAGE: [1, 'message-shadow']}}),
        'message-shadow': shadow({opcode: 'text', parent: 'say', fields: {TEXT: {value: 'inside'}}}),
        after: block({opcode: 'motion_changexby', parent: 'repeat', inputs: {DX: [1, [4, '10']]}})
    },
    drift: blocks => {
        blocks['live-1'].inputs.SUBSTACK = [2, 'live-4'];
    }
}, {
    name: 'nested round reporters with obscured shadows',
    blocks: {
        say: block({
            opcode: 'looks_say',
            inputs: {MESSAGE: [3, 'add', 'message-shadow']},
            topLevel: true,
            x: 160,
            y: 120
        }),
        add: block({
            opcode: 'operator_add',
            parent: 'say',
            inputs: {NUM1: [3, 'multiply', 'left-shadow'], NUM2: [1, [4, '2']]}
        }),
        multiply: block({
            opcode: 'operator_multiply',
            parent: 'add',
            inputs: {NUM1: [1, [4, '3']], NUM2: [1, [4, '4']]}
        }),
        'message-shadow': shadow({opcode: 'text', parent: 'say', fields: {TEXT: {value: 'Hello!'}}}),
        'left-shadow': shadow({opcode: 'math_number', parent: 'add', fields: {NUM: {value: '1'}}})
    },
    drift: blocks => {
        blocks['live-1'].inputs.MESSAGE = [3, 'live-4', 'live-2'];
    }
}, {
    name: 'nested Boolean reporters and menu shadows',
    blocks: {
        wait: block({
            opcode: 'control_wait_until',
            inputs: {CONDITION: [2, 'and']},
            topLevel: true,
            x: 200,
            y: 140
        }),
        and: block({opcode: 'operator_and', parent: 'wait', inputs: {OPERAND1: [2, 'touching'], OPERAND2: [2, 'key']}}),
        touching: block({opcode: 'sensing_touchingobject', parent: 'and', inputs: {TOUCHINGOBJECTMENU: [1, 'touch-menu']}}),
        'touch-menu': shadow({
            opcode: 'sensing_touchingobjectmenu',
            parent: 'touching',
            fields: {TOUCHINGOBJECTMENU: {value: '_mouse_'}}
        }),
        key: block({opcode: 'sensing_keypressed', parent: 'and', inputs: {KEY_OPTION: [1, 'key-menu']}}),
        'key-menu': shadow({
            opcode: 'sensing_keyoptions',
            parent: 'key',
            fields: {KEY_OPTION: {value: 'space'}}
        })
    },
    drift: blocks => {
        blocks['live-2'].inputs.OPERAND2 = [2, 'live-3'];
    }
}, {
    name: 'custom procedure definition, prototype and argument reporters',
    blocks: {
        definition: block({
            opcode: 'procedures_definition',
            inputs: {custom_block: [1, 'prototype']},
            topLevel: true,
            x: 240,
            y: 160
        }),
        prototype: block({
            opcode: 'procedures_prototype',
            parent: 'definition',
            inputs: {
                'text-argument': [1, 'text-argument'],
                'boolean-argument': [1, 'boolean-argument']
            },
            mutation: {
                proccode: 'mix %s %b',
                argumentids: JSON.stringify(['text-argument', 'boolean-argument'])
            }
        }),
        'text-argument': block({opcode: 'argument_reporter_string_number', parent: 'prototype'}),
        'boolean-argument': block({opcode: 'argument_reporter_boolean', parent: 'prototype'})
    },
    drift: blocks => {
        blocks['live-2'].mutation.argumentids = JSON.stringify(['live-4', 'live-3']);
    }
}, {
    name: 'custom procedure call shares regenerated argument IDs with its prototype',
    blocks: {
        definition: block({
            opcode: 'procedures_definition',
            inputs: {custom_block: [1, 'prototype']},
            topLevel: true,
            x: 240,
            y: 160
        }),
        prototype: block({
            opcode: 'procedures_prototype',
            parent: 'definition',
            inputs: {
                'text-argument': [1, 'text-argument'],
                'boolean-argument': [1, 'boolean-argument']
            },
            mutation: {
                proccode: 'mix %s %b',
                argumentids: JSON.stringify(['text-argument', 'boolean-argument'])
            }
        }),
        'text-argument': block({opcode: 'argument_reporter_string_number', parent: 'prototype'}),
        'boolean-argument': block({opcode: 'argument_reporter_boolean', parent: 'prototype'}),
        call: block({
            opcode: 'procedures_call',
            inputs: {
                'text-argument': [1, 'call-text'],
                'boolean-argument': [2, 'touching']
            },
            mutation: {
                proccode: 'mix %s %b',
                argumentids: JSON.stringify(['text-argument', 'boolean-argument'])
            },
            topLevel: true,
            x: 520,
            y: 160
        }),
        'call-text': shadow({opcode: 'text', parent: 'call', fields: {TEXT: {value: 'cake'}}}),
        touching: block({
            opcode: 'sensing_touchingobject',
            parent: 'call',
            inputs: {TOUCHINGOBJECTMENU: [1, 'touch-menu']}
        }),
        'touch-menu': shadow({
            opcode: 'sensing_touchingobjectmenu',
            parent: 'touching',
            fields: {TOUCHINGOBJECTMENU: {value: '_edge_'}}
        })
    },
    drift: blocks => {
        blocks['live-5'].inputs['live-3'] = blocks['live-5'].inputs['live-4'];
        delete blocks['live-5'].inputs['live-4'];
    }
}, {
    name: 'data blocks retain variable fields while normalizing input shadows',
    blocks: {
        set: block({
            opcode: 'data_setvariableto',
            next: 'change-list',
            inputs: {VALUE: [3, 'variable-reporter', 'value-shadow']},
            fields: {VARIABLE: {value: 'score', id: 'variable-id'}},
            topLevel: true,
            x: 280,
            y: 180
        }),
        'variable-reporter': block({
            opcode: 'data_variable',
            parent: 'set',
            fields: {VARIABLE: {value: 'score', id: 'variable-id'}}
        }),
        'value-shadow': shadow({opcode: 'text', parent: 'set', fields: {TEXT: {value: '0'}}}),
        'change-list': block({
            opcode: 'data_addtolist',
            parent: 'set',
            inputs: {ITEM: [1, [10, 'item']]},
            fields: {LIST: {value: 'items', id: 'list-id'}}
        })
    },
    drift: blocks => {
        blocks['live-1'].fields.VARIABLE.id = 'different-variable-id';
    }
}];

test.each(scenarios)('$name survives regenerated block IDs and rejects its semantic drift', async scenario => {
    const project = projectWithBlocks(scenario.blocks);
    const vm = {toJSON: () => JSON.stringify(project)};
    const port = createProjectStatePort({vm, digest});
    const recorded = await port.capture({hashKind: 'structural-v6'});

    project.targets[1].blocks = renameBlockGraph(scenario.blocks);
    expect((await port.capture({hashKind: 'structural-v6'})).structural.hash).toBe(
        recorded.structural.hash
    );

    scenario.drift(project.targets[1].blocks);
    expect((await port.capture({hashKind: 'structural-v6'})).structural.hash).not.toBe(
        recorded.structural.hash
    );
});
