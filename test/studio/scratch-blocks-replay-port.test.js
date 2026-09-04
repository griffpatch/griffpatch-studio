import {
    createScratchBlocksReplayPort,
    createScratchBlocksTargetPort,
    resolveVmBlockId
} from '../../src/studio/bridge/scratch-blocks-replay-port';
import {replayTransaction} from '../../src/studio/replay/replay-engine';

const createHarness = () => {
    const calls = [];
    const event = {
        run: forward => calls.push(['run', forward])
    };
    const ScratchBlocks = {
        Events: {
            recordUndo: true,
            fromJson: (json, workspace) => {
                calls.push(['fromJson', json, workspace]);
                return event;
            },
            disable: () => calls.push(['disable']),
            enable: () => calls.push(['enable'])
        }
    };
    const vm = {
        editingTarget: {id: 'sprite-a'},
        setEditingTarget (id) {
            calls.push(['target', id]);
            this.editingTarget = {id};
        },
        blockListener: replayed => calls.push(['vm', replayed])
    };
    return {ScratchBlocks, calls, event, vm, workspace: {id: 'workspace-1'}};
};

test('selects the target, runs without recursive events and mirrors to the VM', async () => {
    const harness = createHarness();
    const apply = createScratchBlocksReplayPort({
        ...harness,
        beforeAction: action => harness.calls.push(['before', action.eventJson.blockId])
    });
    const action = {
        targetId: 'sprite-b',
        eventJson: {type: 'move', blockId: 'block-1', newCoordinate: '10,20'},
        previousLocation: {parentId: 'parent-1', inputName: 'SUBSTACK'}
    };

    await apply(action);

    expect(harness.event).toMatchObject({
        oldParentId: 'parent-1',
        oldInputName: 'SUBSTACK',
        recordUndo: false
    });
    expect(harness.calls.map(call => call[0])).toEqual([
        'target', 'before', 'fromJson', 'disable', 'run', 'enable', 'vm'
    ]);
});

test('always restores Scratch Blocks events when applying an action fails', async () => {
    const harness = createHarness();
    harness.event.run = () => {
        throw new Error('apply failed');
    };
    const apply = createScratchBlocksReplayPort(harness);

    await expect(apply({
        targetId: 'sprite-a',
        eventJson: {type: 'delete', blockId: 'block-1', ids: ['block-1']},
        previousLocation: null
    })).rejects.toThrow('apply failed');
    expect(harness.calls.map(call => call[0])).toEqual(['fromJson', 'disable', 'enable']);
    expect(harness.ScratchBlocks.Events.recordUndo).toBe(true);
});

test('reports regenerated workspace IDs while preserving recorded VM IDs', async () => {
    const harness = createHarness();
    const recordedRoot = 'recorded-root';
    const recordedShadow = 'recorded-shadow';
    const liveShadow = {
        id: 'live-shadow',
        getParent: () => liveRoot,
        getDescendants: () => [liveShadow]
    };
    const liveRoot = {
        id: 'live-root',
        getParent: () => null,
        getDescendants: () => [liveRoot, liveShadow]
    };
    let blocks = [{id: 'existing'}];
    harness.workspace = {
        id: 'workspace-1',
        getAllBlocks: () => blocks,
        getBlockById: id => blocks.find(block => block.id === id) || null
    };
    harness.vm.editingTarget.blocks = {
        getBlock: id => id === recordedRoot ? {id} : null
    };
    harness.event.run = () => {
        blocks = [...blocks, liveRoot, liveShadow];
    };
    const apply = createScratchBlocksReplayPort(harness);

    await expect(apply({
        targetId: 'sprite-a',
        eventJson: {
            type: 'create',
            blockId: recordedRoot,
            xml: '<block />',
            ids: [recordedRoot, recordedShadow]
        }
    })).resolves.toEqual({
        blockAliases: {
            [recordedRoot]: liveRoot.id,
            [recordedShadow]: liveShadow.id
        },
        vmBlockAliases: {
            [recordedRoot]: recordedRoot
        }
    });
    const vmEvent = harness.calls.find(call => call[0] === 'vm')[1];
    expect(vmEvent.blockId).toBe(recordedRoot);
});

test('replays a later semantic move through the live ID created earlier in the Play sequence', async () => {
    const harness = createHarness();
    const liveBlock = {
        id: 'live-created',
        type: 'motion_movesteps',
        getParent: () => null,
        getRelativeToSurfaceXY: () => ({x: 90, y: 110})
    };
    harness.workspace = {
        id: 'workspace-1',
        getBlockById: id => (id === liveBlock.id ? liveBlock : null),
        // Deliberately make the recorded coordinate unusable. The sequence
        // alias must be authoritative for this fallback transaction.
        getTopBlocks: () => [liveBlock]
    };
    const replay = createScratchBlocksReplayPort(harness);
    const result = await replay.replayMoveTransaction({
        targetId: 'sprite-a',
        events: [{
            type: 'move',
            targetId: 'sprite-a',
            blockId: 'recorded-created',
            blockType: 'motion_movesteps',
            blockRef: {
                ancestorId: 'recorded-created',
                ancestorType: 'motion_movesteps',
                ancestorCoordinate: {x: 5, y: 5},
                path: []
            },
            details: {
                oldLocation: {parentId: null, inputName: null, coordinate: {x: 5, y: 5}},
                newLocation: {parentId: null, inputName: null, coordinate: {x: 40, y: 60}}
            }
        }]
    }, 'forward', {
        blockAliases: {'recorded-created': 'live-created'}
    });

    expect(result).toEqual({
        appliedEventCount: 2,
        blockAliases: {'recorded-created': 'live-created'}
    });
    expect(harness.calls.filter(call => call[0] === 'fromJson').map(call => call[1].blockId))
        .toEqual(['live-created', 'live-created']);
});

test('moves a regenerated workspace block through its recorded VM ID', async () => {
    const harness = createHarness();
    harness.workspace = {
        id: 'workspace-1',
        getBlockById: id => (id === 'live-block' ? {id} : null)
    };
    harness.vm.editingTarget.blocks = {
        getBlock: id => (id === 'recorded-block' ? {id} : null)
    };
    const apply = createScratchBlocksReplayPort(harness);

    await apply({
        targetId: 'sprite-a',
        resolvedBlockId: 'live-block',
        eventJson: {type: 'move', blockId: 'recorded-block', newCoordinate: '20,30'}
    });

    const fromJson = harness.calls.find(call => call[0] === 'fromJson')[1];
    const vmEvent = harness.calls.find(call => call[0] === 'vm')[1];
    expect(fromJson.blockId).toBe('live-block');
    expect(vmEvent.blockId).toBe('recorded-block');
});

test.each([
    ['forward', false], ['backward', false], ['forward', true], ['backward', true]
])('semantic fallback carries parent identities (%s, separate VM parents: %s)', async (direction, separateVm) => {
    const harness = createHarness();
    const blocks = {
        'live-old': {id: 'live-old'},
        'live-new': {id: 'live-new'},
        'live-child': {id: 'live-child', type: 'motion_turnright', getParent: () => blocks['live-old']}
    };
    harness.workspace.getBlockById = id => blocks[id] || null;
    const vmOld = separateVm ? 'vm-old' : 'live-old';
    const vmNew = separateVm ? 'vm-new' : 'live-new';
    const vmBlocks = {[vmOld]: {id: vmOld}, [vmNew]: {id: vmNew}, 'live-child': blocks['live-child']};
    harness.vm.editingTarget.blocks = {getBlock: id => vmBlocks[id] || null};
    const fromJson = harness.ScratchBlocks.Events.fromJson;
    harness.ScratchBlocks.Events.fromJson = (json, workspace) => Object.assign(fromJson(json, workspace), json);
    harness.vm.blockListener = event => {
        expect(vmBlocks[event.oldParentId]).toBeDefined();
        expect(vmBlocks[event.newParentId]).toBeDefined();
        harness.calls.push(['vm', event]);
    };
    const apply = createScratchBlocksReplayPort(harness);
    const transaction = {
        targetId: 'sprite-a',
        events: [{
            type: 'move',
            targetId: 'sprite-a',
            blockId: 'recorded-child',
            blockType: 'motion_turnright',
            forwardJson: {type: 'move', blockId: 'recorded-child', newParentId: 'recorded-new'},
            details: {
                oldLocation: {parentId: 'recorded-old', inputName: null, coordinate: null},
                newLocation: {parentId: 'recorded-new', inputName: null, coordinate: null}
            }
        }]
    };
    const recorded = JSON.stringify(transaction);
    await replayTransaction(transaction, apply, direction, {
        blockAliases: {'recorded-old': 'live-old', 'recorded-new': 'live-new', 'recorded-child': 'live-child'},
        vmBlockAliases: {'recorded-old': vmOld, 'recorded-new': vmNew}
    });
    expect(harness.calls.find(call => call[0] === 'fromJson')[1].newParentId)
        .toBe(direction === 'forward' ? 'live-new' : 'live-old');
    expect(harness.calls.find(call => call[0] === 'vm')[1]).toMatchObject({
        blockId: 'live-child',
        oldParentId: direction === 'forward' ? vmOld : vmNew,
        newParentId: direction === 'forward' ? vmNew : vmOld
    });
    expect(JSON.stringify(transaction)).toBe(recorded);
});

test('prepares aliases for surviving semantic moves before any event runs', async () => {
    const harness = createHarness();
    const root = {
        id: 'recorded-root',
        inputList: [],
        getInput: name => (name === 'VALUE' ? {
            connection: {targetBlock: () => liveReporter}
        } : null)
    };
    const liveReporter = {id: 'live-reporter', getParent: () => root};
    root.inputList = [{name: 'VALUE', connection: {targetBlock: () => liveReporter}}];
    harness.workspace = {
        id: 'workspace-1',
        getBlockById: id => (id === root.id ? root : (id === liveReporter.id ? liveReporter : null))
    };
    harness.vm.editingTarget.blocks = {
        getBlock: id => ({
            [root.id]: {id: root.id, inputs: {VALUE: {block: 'vm-reporter'}}},
            'vm-reporter': {id: 'vm-reporter'}
        }[id] || null)
    };
    const apply = createScratchBlocksReplayPort(harness);
    const reporterRef = {ancestorId: 'recorded-root', path: [{kind: 'input', name: 'VALUE'}]};
    const coordinate = {parentId: null, inputName: null, coordinate: {x: 10, y: 20}};

    await expect(apply.prepareTransaction({
        targetId: 'sprite-a',
        events: [{
            type: 'move',
            targetId: 'sprite-a',
            blockId: 'recorded-reporter',
            blockRef: reporterRef,
            details: {oldLocation: coordinate, newLocation: coordinate}
        }]
    }, 'forward')).resolves.toEqual({
        blockAliases: {'recorded-reporter': liveReporter.id},
        vmBlockAliases: {'recorded-reporter': 'vm-reporter'}
    });
});

test('captures an exiting shadow from its source input before it is detached', async () => {
    const harness = createHarness();
    const liveShadow = {id: 'live-shadow', type: 'math_number'};
    const root = {
        id: 'root',
        getInput: name => (name === 'VALUE' ? {
            connection: {targetBlock: () => liveShadow}
        } : null)
    };
    liveShadow.getParent = () => root;
    root.inputList = [{name: 'VALUE', connection: {targetBlock: () => liveShadow}}];
    harness.workspace = {
        id: 'workspace-1',
        getBlockById: id => ({root, 'live-shadow': liveShadow}[id] || null)
    };
    harness.vm.editingTarget.blocks = {
        getBlock: id => ({
            root: {id: 'root', inputs: {VALUE: {block: 'vm-shadow'}}},
            'vm-shadow': {id: 'vm-shadow'}
        }[id] || null)
    };
    const apply = createScratchBlocksReplayPort(harness);
    const nested = {parentId: 'root', inputName: 'VALUE', coordinate: null};
    const top = {parentId: null, inputName: null, coordinate: {x: 50, y: 60}};

    await expect(apply.prepareTransaction({
        targetId: 'sprite-a',
        events: [{
            type: 'move', targetId: 'sprite-a', blockId: 'recorded-shadow', blockType: 'math_number',
            details: {oldLocation: nested, newLocation: top}
        }, {
            type: 'delete', targetId: 'sprite-a', blockId: 'recorded-shadow',
            details: {oldXml: '<shadow type="math_number"/>', ids: ['recorded-shadow']}
        }]
    }, 'forward')).resolves.toEqual({
        blockAliases: {'recorded-shadow': liveShadow.id},
        vmBlockAliases: {'recorded-shadow': 'vm-shadow'}
    });
});

test('replays variable deletion through the silent internal route', async () => {
    const harness = createHarness();
    const variable = {id: 'cake', name: 'cake'};
    const uses = [{id: 'use-1'}, {id: 'use-2'}];
    harness.event.varId = 'cake';
    harness.event.run = jest.fn();
    harness.workspace = {
        getVariableById: id => (id === 'cake' ? variable : null),
        getVariableUsesById: jest.fn(() => uses),
        deleteVariableInternal_: jest.fn(),
        refreshToolboxSelection_: jest.fn()
    };
    const apply = createScratchBlocksReplayPort(harness);

    await apply({
        targetId: 'sprite-a',
        eventJson: {type: 'var_delete', varId: 'cake', varName: 'cake', varType: ''}
    });

    expect(harness.workspace.deleteVariableInternal_).toHaveBeenCalledWith(variable, uses);
    expect(harness.workspace.refreshToolboxSelection_).toHaveBeenCalledTimes(1);
    expect(harness.event.run).not.toHaveBeenCalled();
    expect(harness.ScratchBlocks.Events.recordUndo).toBe(true);
});

test('restores complete block-comment state before mirroring a recreated comment to the VM', async () => {
    const harness = createHarness();
    const comment = {
        setText: jest.fn(),
        setSize: jest.fn(),
        setMinimized: jest.fn()
    };
    harness.workspace = {
        id: 'workspace-1',
        getBlockById: id => (id === 'block-1' ? {id} : null),
        getCommentById: id => (id === 'comment-1' ? comment : null)
    };
    harness.event.type = 'comment_create';
    harness.event.commentId = 'comment-1';
    const apply = createScratchBlocksReplayPort(harness);
    const state = {
        text: 'Explain this',
        coordinate: {x: 12, y: 18},
        width: 140,
        height: 90,
        minimized: true
    };

    await apply({
        targetId: 'sprite-a',
        eventJson: {
            type: 'comment_create',
            commentId: 'comment-1',
            blockId: 'block-1',
            xml: '<comment id="comment-1" />'
        },
        commentState: state
    });

    expect(harness.event).toMatchObject({
        text: 'Explain this',
        xy: {x: 12, y: 18},
        width: 140,
        height: 90,
        minimized: true
    });
    expect(comment.setText).toHaveBeenCalledWith('Explain this');
    expect(comment.setSize).toHaveBeenCalledWith(140, 90);
    expect(comment.setMinimized).toHaveBeenCalledWith(true);
    expect(harness.calls.map(call => call[0])).toEqual([
        'fromJson', 'disable', 'run', 'enable', 'vm'
    ]);
});

test('restores comment change and RTL move state omitted by Scratch Blocks JSON decoding', async () => {
    const harness = createHarness();
    harness.workspace = {
        id: 'workspace-1',
        getWidth: jest.fn(() => 960)
    };
    const apply = createScratchBlocksReplayPort(harness);

    await apply({
        targetId: 'sprite-a',
        eventJson: {type: 'comment_change', commentId: 'comment-1'},
        commentState: {newContents: {width: 180, height: 120}}
    });
    expect(harness.event.newContents_).toEqual({width: 180, height: 120});

    await apply({
        targetId: 'sprite-a',
        eventJson: {type: 'comment_move', commentId: 'comment-1', newCoordinate: '40,80'},
        commentState: {newCoordinate: {x: 40, y: 80}}
    });
    expect(harness.event.newCoordinate_).toEqual({x: 40, y: 80});
    expect(harness.event.workspaceWidth_).toBe(960);
});

test('translates durable null move locations to the VM undefined convention', async () => {
    const harness = createHarness();
    const apply = createScratchBlocksReplayPort(harness);

    await apply({
        targetId: 'sprite-a',
        eventJson: {type: 'move', blockId: 'block-1', newCoordinate: '10,20'},
        previousLocation: {parentId: null, inputName: null}
    });

    expect(harness.event.oldParentId).toBeUndefined();
    expect(harness.event.oldInputName).toBeUndefined();
});

test('resolves regenerated old and new parents for a generic create-plus-move replay', async () => {
    const harness = createHarness();
    const block = (id, type, coordinate) => ({
        id,
        type,
        getRelativeToSurfaceXY: () => coordinate
    });
    const liveOld = block('live-old-parent', 'motion_movesteps', {x: 100, y: 120});
    const liveNew = block('live-new-parent', 'motion_turnright', {x: 200, y: 220});
    const moving = block('moving', 'motion_gotoxy', {x: 300, y: 320});
    harness.workspace = {
        getBlockById: id => ({
            'live-old-parent': liveOld,
            'live-new-parent': liveNew,
            moving
        }[id] || null),
        getTopBlocks: () => [liveOld, liveNew, moving]
    };
    const reference = (ancestorId, ancestorType, ancestorCoordinate) => ({
        ancestorId,
        ancestorType,
        ancestorCoordinate,
        path: []
    });
    const apply = createScratchBlocksReplayPort(harness);

    await apply({
        targetId: 'sprite-a',
        blockRef: null,
        eventJson: {type: 'move', blockId: 'moving', newParentId: 'recorded-new-parent'},
        previousLocation: {
            parentId: 'recorded-old-parent',
            inputName: null,
            parentRef: reference('recorded-old-parent', 'motion_movesteps', {x: 100, y: 120})
        },
        destinationLocation: {
            parentId: 'recorded-new-parent',
            inputName: null,
            parentRef: reference('recorded-new-parent', 'motion_turnright', {x: 200, y: 220})
        }
    });

    const fromJson = harness.calls.find(call => call[0] === 'fromJson');
    expect(fromJson[1]).toMatchObject({blockId: 'moving', newParentId: 'live-new-parent'});
    expect(harness.event.oldParentId).toBe('live-old-parent');
});

test('deletes a regenerated block through the live root ID in the descendant list', async () => {
    const harness = createHarness();
    const liveBlock = {
        id: 'live-root',
        type: 'motion_movesteps',
        getRelativeToSurfaceXY: () => ({x: 120, y: 180})
    };
    harness.workspace = {
        getBlockById: id => (id === liveBlock.id ? liveBlock : null),
        getTopBlocks: () => [liveBlock]
    };
    const apply = createScratchBlocksReplayPort(harness);

    await apply({
        targetId: 'sprite-a',
        blockRef: {
            ancestorId: 'recorded-root',
            ancestorType: liveBlock.type,
            ancestorCoordinate: {x: 120, y: 180},
            path: []
        },
        eventJson: {
            type: 'delete',
            blockId: 'recorded-root',
            ids: ['recorded-root', 'recorded-shadow']
        }
    });

    const fromJson = harness.calls.find(call => call[0] === 'fromJson');
    expect(fromJson[1]).toMatchObject({
        blockId: 'live-root',
        ids: ['live-root', 'recorded-shadow']
    });
});

test('round-trips a nested reporter insertion without confusing it with the replaced shadow', async () => {
    const blocks = new Map();
    let replacementNumber = 0;
    const makeBlock = (id, type, shadow = false) => {
        const block = {
            id,
            type,
            shadow,
            parent: null,
            inputName: null,
            coordinate: {x: 0, y: 0},
            inputs: {},
            getParent () {
                return this.parent;
            },
            getRelativeToSurfaceXY () {
                return this.coordinate;
            },
            getInput (name) {
                if (!Object.prototype.hasOwnProperty.call(this.inputs, name)) return null;
                return {connection: {targetBlock: () => this.inputs[name]}};
            }
        };
        Object.defineProperty(block, 'inputList', {
            get: () => Object.keys(block.inputs).map(name => ({
                name,
                connection: {targetBlock: () => block.inputs[name]}
            }))
        });
        blocks.set(id, block);
        return block;
    };
    const connect = (parent, inputName, child) => {
        const previous = parent.inputs[inputName];
        if (previous && previous !== child) {
            previous.parent = null;
            previous.inputName = null;
            if (previous.shadow) blocks.delete(previous.id);
        }
        parent.inputs[inputName] = child;
        child.parent = parent;
        child.inputName = inputName;
    };
    const detach = block => {
        const parent = block.parent;
        const inputName = block.inputName;
        if (!parent || parent.inputs[inputName] !== block) return;
        parent.inputs[inputName] = null;
        block.parent = null;
        block.inputName = null;
        if (block.shadow && ScratchBlocks.Events.recordUndo) {
            const replacement = makeBlock(`generated-shadow-${++replacementNumber}`, 'math_number', true);
            connect(parent, inputName, replacement);
        }
    };
    const remove = block => {
        Object.values(block.inputs).filter(Boolean).forEach(remove);
        detach(block);
        blocks.delete(block.id);
    };

    const outer = makeBlock('outer-add', 'operator_add');
    outer.coordinate = {x: 100, y: 100};
    outer.inputs = {NUM1: null, NUM2: null};
    const originalShadow = makeBlock('outer-shadow', 'math_number', true);
    connect(outer, 'NUM1', originalShadow);

    const applied = [];
    const workspace = {
        getBlockById: id => blocks.get(id) || null,
        getTopBlocks: () => [...blocks.values()].filter(block => !block.parent)
    };
    const vm = {
        editingTarget: {id: 'sprite-a'},
        blockListener: () => {}
    };
    const ScratchBlocks = {
        Events: {
            recordUndo: true,
            fromJson: json => ({
                ...json,
                run: () => {
                    applied.push({type: json.type, blockId: json.blockId});
                    if (json.type === 'create') {
                        if (json.blockId !== 'inner-add' && ScratchBlocks.Events.recordUndo) return;
                        const created = makeBlock(json.blockId, json.blockId === 'inner-add' ?
                            'operator_add' : 'math_number', json.blockId !== 'inner-add');
                        if (json.blockId === 'inner-add') {
                            created.inputs = {NUM1: null, NUM2: null};
                            connect(created, 'NUM1', makeBlock('inner-shadow-1', 'math_number', true));
                            connect(created, 'NUM2', makeBlock('inner-shadow-2', 'math_number', true));
                        }
                    } else if (json.type === 'move') {
                        const block = blocks.get(json.blockId);
                        detach(block);
                        if (json.newParentId) {
                            connect(blocks.get(json.newParentId), json.newInputName, block);
                        } else if (json.newCoordinate) {
                            const [x, y] = json.newCoordinate.split(',').map(Number);
                            block.coordinate = {x, y};
                        }
                    } else if (json.type === 'delete') {
                        const block = blocks.get(json.blockId);
                        if (block) remove(block);
                    }
                }
            }),
            disable: () => {},
            enable: () => {}
        }
    };
    const ref = {
        ancestorId: 'outer-add',
        ancestorType: 'operator_add',
        ancestorCoordinate: {x: 100, y: 100},
        path: [{kind: 'input', name: 'NUM1'}]
    };
    const location = (parentId, inputName, coordinate, parentRef = null) => ({
        parentId, inputName, coordinate, parentRef
    });
    const top = coordinate => location(null, null, coordinate);
    const nested = location('outer-add', 'NUM1', null, {
        ancestorId: 'outer-add',
        ancestorType: 'operator_add',
        ancestorCoordinate: {x: 100, y: 100},
        path: []
    });
    const transaction = {targetId: 'sprite-a', events: [{
        type: 'create', targetId: 'sprite-a', blockId: 'inner-add', blockRef: ref,
        details: {xml: '<block type="operator_add"/>', ids: ['inner-add', 'inner-shadow-1', 'inner-shadow-2']}
    }, {
        type: 'move', targetId: 'sprite-a', blockId: 'inner-add', blockRef: ref,
        details: {oldLocation: top({x: -1000, y: 55}), newLocation: top({x: 120, y: 150})}
    }, {
        type: 'move', targetId: 'sprite-a', blockId: 'outer-shadow',
        details: {oldLocation: nested, newLocation: top({x: 110, y: 110})}
    }, {
        type: 'delete', targetId: 'sprite-a', blockId: 'outer-shadow',
        details: {oldXml: '<shadow type="math_number"/>', ids: ['outer-shadow']}
    }, {
        type: 'move', targetId: 'sprite-a', blockId: 'inner-add', blockRef: ref,
        details: {oldLocation: top({x: 120, y: 150}), newLocation: nested}
    }]};
    const replay = createScratchBlocksReplayPort({workspace, vm, ScratchBlocks});

    expect(await replayTransaction(transaction, replay, 'forward')).toBe(4);
    expect(outer.inputs.NUM1.id).toBe('inner-add');
    expect(outer.inputs.NUM1.inputs.NUM1.id).toBe('inner-shadow-1');
    expect(applied.map(item => item.blockId)).toEqual([
        'inner-add', 'inner-add', 'outer-shadow', 'inner-add'
    ]);

    const regeneratedInner = blocks.get('inner-add');
    blocks.delete('inner-add');
    regeneratedInner.id = 'live-inner-add';
    blocks.set(regeneratedInner.id, regeneratedInner);

    expect(await replayTransaction(transaction, replay, 'backward')).toBe(3);
    expect(outer.inputs.NUM1.id).toBe('outer-shadow');
    expect(blocks.has('inner-add')).toBe(false);
    expect(blocks.has('live-inner-add')).toBe(false);
    expect(applied[applied.length - 1]).toEqual({type: 'delete', blockId: 'live-inner-add'});

    applied.length = 0;
    expect(await replayTransaction(transaction, replay, 'forward')).toBe(4);
    expect(outer.inputs.NUM1.id).toBe('inner-add');
    expect(outer.inputs.NUM1.inputs.NUM2.id).toBe('inner-shadow-2');
    expect(applied.map(item => item.blockId)).toEqual([
        'inner-add', 'inner-add', 'outer-shadow', 'inner-add'
    ]);
});

test('rebuilds a reverse middle-stack topology by detaching affected blocks before reconnecting them', async () => {
    const insertionParent = {id: 'insertion-parent', parent: null, coordinate: {x: 100, y: 100}};
    const moving = {id: 'moving', parent: insertionParent, coordinate: {x: 100, y: 140}};
    const displaced = {id: 'displaced', parent: moving, coordinate: {x: 100, y: 180}};
    const blocks = new Map([
        [insertionParent.id, insertionParent],
        [moving.id, moving],
        [displaced.id, displaced]
    ]);
    blocks.forEach(block => {
        block.getParent = () => block.parent;
        block.getRelativeToSurfaceXY = () => block.coordinate;
        block.inputList = [];
        block.getNextBlock = () => [...blocks.values()].find(candidate => candidate.parent === block) || null;
    });
    const applied = [];
    const workspace = {
        getBlockById: id => blocks.get(id) || null,
        getTopBlocks: () => [...blocks.values()].filter(block => !block.parent)
    };
    const vmParents = {moving: 'insertion-parent', displaced: 'moving'};
    const vm = {
        editingTarget: {id: 'sprite-a'},
        blockListener: event => {
            vmParents[event.blockId] = event.newParentId || null;
        }
    };
    const ScratchBlocks = {
        Events: {
            fromJson: json => {
                const event = {...json};
                event.run = () => {
                    const block = blocks.get(event.blockId);
                    block.parent = event.newParentId ? blocks.get(event.newParentId) : null;
                    if (event.newCoordinate) {
                        const [x, y] = event.newCoordinate.split(',').map(Number);
                        block.coordinate = {x, y};
                    }
                    applied.push({blockId: event.blockId, parentId: event.newParentId || null});
                };
                return event;
            },
            disable: () => {},
            enable: () => {}
        }
    };
    const replay = createScratchBlocksReplayPort({workspace, vm, ScratchBlocks});
    const location = (parentId, coordinate = null) => ({parentId, inputName: null, coordinate});
    const transaction = {
        targetId: 'sprite-a',
        events: [{
            type: 'move',
            targetId: 'sprite-a',
            blockId: 'moving',
            details: {
                oldLocation: location('displaced'),
                newLocation: location(null, {x: 242, y: 364})
            }
        }, {
            type: 'move',
            targetId: 'sprite-a',
            blockId: 'moving',
            details: {
                oldLocation: location(null, {x: 242, y: 364}),
                newLocation: location(null, {x: 248, y: 304})
            }
        }, {
            type: 'move',
            targetId: 'sprite-a',
            blockId: 'displaced',
            details: {
                oldLocation: location('insertion-parent'),
                newLocation: location('moving')
            }
        }, {
            type: 'move',
            targetId: 'sprite-a',
            blockId: 'moving',
            details: {
                oldLocation: location(null, {x: 248, y: 304}),
                newLocation: location('insertion-parent')
            }
        }]
    };

    const result = await replay.replayMoveTransaction(transaction, 'backward');

    expect(applied).toEqual([
        {blockId: 'moving', parentId: null},
        {blockId: 'displaced', parentId: null},
        {blockId: 'displaced', parentId: 'insertion-parent'},
        {blockId: 'moving', parentId: 'displaced'}
    ]);
    expect(moving.parent).toBe(displaced);
    expect(displaced.parent).toBe(insertionParent);
    expect(vmParents).toEqual({moving: 'displaced', displaced: 'insertion-parent'});
    expect(result).toEqual({
        appliedEventCount: 4,
        blockAliases: {
            moving: 'moving',
            displaced: 'displaced',
            'insertion-parent': 'insertion-parent'
        }
    });
});

test('replays a queued forward substack insertion from regenerated inverse-topology IDs', async () => {
    const root = {id: 'live-root', type: 'motion_changexby', parent: null, coordinate: {x: 591, y: 175}};
    const moving = {id: 'live-moving', type: 'motion_movesteps', parent: null, coordinate: {x: 205, y: 285}};
    const glide = {id: 'live-glide', type: 'motion_glideto', parent: moving, coordinate: {x: 205, y: 333}};
    const point = {id: 'live-point', type: 'motion_pointindirection', parent: glide, coordinate: {x: 205, y: 381}};
    const tail = {id: 'live-tail', type: 'motion_changexby', parent: root, coordinate: {x: 591, y: 223}};
    const blocks = new Map([root, moving, glide, point, tail].map(block => [block.id, block]));
    blocks.forEach(block => {
        block.getParent = () => block.parent;
        block.getRelativeToSurfaceXY = () => block.coordinate;
        block.inputList = [];
        block.getNextBlock = () => [...blocks.values()].find(candidate => candidate.parent === block) || null;
    });
    const workspace = {
        getBlockById: id => blocks.get(id) || null,
        getTopBlocks: () => [...blocks.values()].filter(block => !block.parent)
    };
    const vmParents = {
        [root.id]: null,
        [moving.id]: null,
        [glide.id]: moving.id,
        [point.id]: glide.id,
        [tail.id]: root.id
    };
    const vm = {
        editingTarget: {id: 'sprite-a'},
        blockListener: event => {
            vmParents[event.blockId] = event.newParentId || null;
        }
    };
    const applied = [];
    const ScratchBlocks = {
        Events: {
            fromJson: json => {
                const event = {...json};
                event.run = () => {
                    const block = blocks.get(event.blockId);
                    block.parent = event.newParentId ? blocks.get(event.newParentId) : null;
                    if (event.newCoordinate) {
                        const [x, y] = event.newCoordinate.split(',').map(Number);
                        block.coordinate = {x, y};
                    }
                    applied.push({blockId: event.blockId, parentId: event.newParentId || null});
                };
                return event;
            },
            disable: () => {},
            enable: () => {}
        }
    };
    const rootRef = {
        ancestorId: 'recorded-root',
        ancestorType: root.type,
        ancestorCoordinate: root.coordinate,
        path: []
    };
    const location = (parentId, coordinate = null, parentRef = null) => ({
        parentId,
        inputName: null,
        coordinate,
        ...(parentRef ? {parentRef} : {})
    });
    const transaction = {
        targetId: 'sprite-a',
        events: [{
            type: 'move',
            targetId: 'sprite-a',
            blockId: 'recorded-moving',
            blockType: moving.type,
            blockRef: {...rootRef, path: [{kind: 'next'}]},
            details: {
                oldLocation: location(null, {x: 205, y: 285}),
                newLocation: location(null, {x: 591, y: 223})
            }
        }, {
            type: 'move',
            targetId: 'sprite-a',
            blockId: 'recorded-tail',
            blockType: tail.type,
            blockRef: {
                ...rootRef,
                path: [{kind: 'next'}, {kind: 'next'}, {kind: 'next'}, {kind: 'next'}]
            },
            details: {
                oldLocation: location('recorded-root', null, rootRef),
                newLocation: location('recorded-point', null, {
                    ...rootRef,
                    path: [{kind: 'next'}, {kind: 'next'}, {kind: 'next'}]
                })
            }
        }, {
            type: 'move',
            targetId: 'sprite-a',
            blockId: 'recorded-moving',
            blockType: moving.type,
            blockRef: {...rootRef, path: [{kind: 'next'}]},
            details: {
                oldLocation: location(null, {x: 591, y: 223}),
                newLocation: location('recorded-root', null, rootRef)
            }
        }]
    };

    const replay = createScratchBlocksReplayPort({workspace, vm, ScratchBlocks});
    const result = await replay.replayMoveTransaction(transaction, 'forward');

    expect(applied).toEqual([
        {blockId: moving.id, parentId: null},
        {blockId: tail.id, parentId: null},
        {blockId: moving.id, parentId: root.id},
        {blockId: tail.id, parentId: point.id}
    ]);
    expect(moving.parent).toBe(root);
    expect(tail.parent).toBe(point);
    expect(vmParents[moving.id]).toBe(root.id);
    expect(vmParents[tail.id]).toBe(point.id);
    expect(result.blockAliases).toEqual({
        'recorded-moving': moving.id,
        'recorded-tail': tail.id,
        'recorded-root': root.id
    });
});

test('resolves a healed-source C-slot destination beyond the moving statement', async () => {
    const root = {id: 'live-root', type: 'motion_goto', parent: null, inputName: null, coordinate: {x: 1120, y: 120}};
    const moving = {
        id: 'live-moving', type: 'motion_goto', parent: root, inputName: null, coordinate: {x: 1120, y: 168}
    };
    const glide = {
        id: 'live-glide', type: 'motion_glideto', parent: moving, inputName: null, coordinate: {x: 1120, y: 216}
    };
    const ifElse = {
        id: 'live-if', type: 'control_if_else', parent: glide, inputName: null, coordinate: {x: 1120, y: 264}
    };
    const blocks = new Map([root, moving, glide, ifElse].map(block => [block.id, block]));
    blocks.forEach(block => {
        block.getParent = () => block.parent;
        block.getRelativeToSurfaceXY = () => block.coordinate;
        block.getNextBlock = () => [...blocks.values()].find(candidate =>
            candidate.parent === block && candidate.inputName === null) || null;
        block.inputList = [];
    });
    ifElse.inputList = [{
        name: 'SUBSTACK',
        connection: {targetBlock: () => [...blocks.values()].find(candidate =>
            candidate.parent === ifElse && candidate.inputName === 'SUBSTACK') || null}
    }];
    const workspace = {
        getBlockById: id => blocks.get(id) || null,
        getTopBlocks: () => [...blocks.values()].filter(block => !block.parent)
    };
    const vmParents = Object.fromEntries([...blocks].map(([id, block]) => [id, block.parent?.id || null]));
    const vm = {
        editingTarget: {id: 'sprite-a'},
        blockListener: event => {
            vmParents[event.blockId] = event.newParentId || null;
        }
    };
    const applied = [];
    const ScratchBlocks = {
        Events: {
            fromJson: json => {
                const event = {...json};
                event.run = () => {
                    const block = blocks.get(event.blockId);
                    block.parent = event.newParentId ? blocks.get(event.newParentId) : null;
                    block.inputName = event.newInputName || null;
                    if (event.newCoordinate) {
                        const [x, y] = event.newCoordinate.split(',').map(Number);
                        block.coordinate = {x, y};
                    }
                    applied.push({
                        blockId: event.blockId,
                        parentId: event.newParentId || null,
                        inputName: event.newInputName || null
                    });
                };
                return event;
            },
            disable: () => {},
            enable: () => {}
        }
    };
    const rootRef = {
        ancestorId: 'recorded-root',
        ancestorType: root.type,
        ancestorCoordinate: root.coordinate,
        path: []
    };
    const location = (parentId, coordinate = null, parentRef = null, inputName = null) => ({
        parentId,
        inputName,
        coordinate,
        ...(parentRef ? {parentRef} : {})
    });
    const transaction = {
        targetId: 'sprite-a',
        events: [{
            type: 'move',
            targetId: 'sprite-a',
            blockId: 'recorded-moving',
            blockType: moving.type,
            details: {
                oldLocation: location('recorded-root', null, rootRef),
                newLocation: location(null, {x: 1120, y: 168})
            }
        }, {
            type: 'move',
            targetId: 'sprite-a',
            blockId: 'recorded-glide',
            blockType: glide.type,
            details: {
                oldLocation: location('recorded-moving'),
                newLocation: location('recorded-root', null, rootRef)
            }
        }, {
            type: 'move',
            targetId: 'sprite-a',
            blockId: 'recorded-moving',
            blockType: moving.type,
            details: {
                oldLocation: location(null, {x: 1120, y: 168}),
                newLocation: location('recorded-if', null, {
                    ...rootRef,
                    path: [{kind: 'next'}, {kind: 'next'}]
                }, 'SUBSTACK')
            }
        }]
    };

    const replay = createScratchBlocksReplayPort({workspace, vm, ScratchBlocks});
    const result = await replay.replayMoveTransaction(transaction, 'forward');

    expect(applied).toEqual([
        {blockId: moving.id, parentId: null, inputName: null},
        {blockId: glide.id, parentId: null, inputName: null},
        {blockId: moving.id, parentId: ifElse.id, inputName: 'SUBSTACK'},
        {blockId: glide.id, parentId: root.id, inputName: null}
    ]);
    expect(moving.parent).toBe(ifElse);
    expect(moving.inputName).toBe('SUBSTACK');
    expect(glide.parent).toBe(root);
    expect(result.blockAliases).toMatchObject({
        'recorded-moving': moving.id,
        'recorded-glide': glide.id,
        'recorded-root': root.id,
        'recorded-if': ifElse.id
    });
});

test('resolves a compound prepend from source roots before post-gesture references', async () => {
    const root = {id: 'live-move', type: 'motion_movesteps', parent: null, coordinate: {x: 1420, y: 120}};
    const moving = {id: 'live-goto', type: 'motion_goto', parent: root, coordinate: {x: 1420, y: 168}};
    const turnRight = {id: 'live-right', type: 'motion_turnright', parent: moving, coordinate: {x: 1420, y: 216}};
    const tail = {id: 'live-left', type: 'motion_turnleft', parent: turnRight, coordinate: {x: 1420, y: 264}};
    const blocks = new Map([root, moving, turnRight, tail].map(block => [block.id, block]));
    blocks.forEach(block => {
        block.getParent = () => block.parent;
        block.getRelativeToSurfaceXY = () => block.coordinate;
        block.inputList = [];
        block.getNextBlock = () => [...blocks.values()].find(candidate => candidate.parent === block) || null;
    });
    const workspace = {
        getBlockById: id => blocks.get(id) || null,
        getTopBlocks: () => [...blocks.values()].filter(block => !block.parent)
    };
    const vmParents = Object.fromEntries([...blocks.keys()].map(id => [id, blocks.get(id).parent?.id || null]));
    const vm = {
        editingTarget: {id: 'sprite-a'},
        blockListener: event => {
            vmParents[event.blockId] = event.newParentId || null;
        }
    };
    const applied = [];
    const ScratchBlocks = {
        Events: {
            fromJson: json => {
                const event = {...json};
                event.run = () => {
                    const block = blocks.get(event.blockId);
                    block.parent = event.newParentId ? blocks.get(event.newParentId) : null;
                    if (event.newCoordinate) {
                        const [x, y] = event.newCoordinate.split(',').map(Number);
                        block.coordinate = {x, y};
                    }
                    applied.push({blockId: event.blockId, parentId: event.newParentId || null});
                };
                return event;
            },
            disable: () => {},
            enable: () => {}
        }
    };
    const postRootRef = {
        ancestorId: 'recorded-goto',
        ancestorType: moving.type,
        ancestorCoordinate: {x: 1420, y: -24},
        path: []
    };
    const transaction = {
        targetId: 'sprite-a',
        events: [{
            type: 'move',
            targetId: 'sprite-a',
            blockId: 'recorded-goto',
            blockType: moving.type,
            blockRef: postRootRef,
            details: {
                oldLocation: {
                    parentId: 'recorded-move',
                    inputName: null,
                    coordinate: null,
                    parentRef: {...postRootRef, path: [{kind: 'next'}, {kind: 'next'}, {kind: 'next'}]}
                },
                newLocation: {parentId: null, inputName: null, coordinate: {x: 1420, y: -24}}
            }
        }, {
            type: 'move',
            targetId: 'sprite-a',
            blockId: 'recorded-move',
            blockType: root.type,
            blockRef: {...postRootRef, path: [{kind: 'next'}, {kind: 'next'}, {kind: 'next'}]},
            details: {
                oldLocation: {parentId: null, inputName: null, coordinate: {x: 1420, y: 120}},
                newLocation: {
                    parentId: 'recorded-left',
                    inputName: null,
                    coordinate: null,
                    parentRef: {...postRootRef, path: [{kind: 'next'}, {kind: 'next'}]}
                }
            }
        }]
    };

    const replay = createScratchBlocksReplayPort({workspace, vm, ScratchBlocks});
    const result = await replay.replayMoveTransaction(transaction, 'forward');

    expect(applied).toEqual([
        {blockId: root.id, parentId: null},
        {blockId: moving.id, parentId: null},
        {blockId: root.id, parentId: tail.id},
        {blockId: moving.id, parentId: null}
    ]);
    expect(result.blockAliases).toMatchObject({
        'recorded-move': root.id,
        'recorded-goto': moving.id,
        'recorded-left': tail.id
    });
    expect(moving.parent).toBeNull();
    expect(root.parent).toBe(tail);
    expect(vmParents[root.id]).toBe(tail.id);
});

test('resolves a portable sprite reference after checkpoint target IDs change', async () => {
    const harness = createHarness();
    harness.vm.runtime = {
        getTargetById: () => null,
        targets: [{
            id: 'restored-sprite-id',
            isOriginal: true,
            isStage: false,
            getName: () => 'Sprite1'
        }]
    };
    const apply = createScratchBlocksReplayPort(harness);

    await apply({
        targetId: 'recording-sprite-id',
        targetRef: {runtimeId: 'recording-sprite-id', name: 'Sprite1', isStage: false},
        eventJson: {type: 'create', blockId: 'block-1', xml: '<block />', ids: ['block-1']},
        previousLocation: null
    });

    expect(harness.vm.editingTarget.id).toBe('restored-sprite-id');
});

test('uses the portable event reference when preparing a transaction target', async () => {
    const harness = createHarness();
    harness.vm.runtime = {
        getTargetById: () => null,
        targets: [{
            id: 'restored-sprite-id',
            isOriginal: true,
            isStage: false,
            getName: () => 'Sprite1'
        }]
    };
    const target = createScratchBlocksTargetPort(harness);
    const transaction = {
        id: 'transaction-1',
        targetId: 'recording-sprite-id',
        events: [{
            targetId: 'recording-sprite-id',
            targetRef: {runtimeId: 'recording-sprite-id', name: 'Sprite1', isStage: false}
        }]
    };

    expect(target.isSelected(transaction)).toBe(false);
    await target.select(transaction);
    expect(target.isSelected(transaction)).toBe(true);
    expect(harness.vm.editingTarget.id).toBe('restored-sprite-id');
});

test('rejects a recycled runtime ID in favor of the portable Stage reference', async () => {
    const harness = createHarness();
    const restoredSprite = {
        id: 'recording-stage-id',
        isOriginal: true,
        isStage: false,
        getName: () => 'Sprite1'
    };
    const restoredStage = {
        id: 'restored-stage-id',
        isOriginal: true,
        isStage: true,
        getName: () => 'Stage'
    };
    harness.vm.editingTarget = restoredSprite;
    harness.vm.runtime = {
        getTargetById: id => (id === restoredSprite.id ? restoredSprite : null),
        targets: [restoredSprite, restoredStage]
    };
    const target = createScratchBlocksTargetPort(harness);
    const recordedStage = {
        targetId: 'recording-stage-id',
        targetRef: {runtimeId: 'recording-stage-id', name: 'Stage', isStage: true}
    };

    expect(target.isSelected(recordedStage)).toBe(false);
    await target.select(recordedStage);
    expect(harness.vm.editingTarget.id).toBe(restoredStage.id);
    expect(target.isSelected(recordedStage)).toBe(true);
});

test('waits for the visible workspace before applying an event to another target', async () => {
    const harness = createHarness();
    let publishWorkspaceUpdate;
    harness.vm.once = (event, listener) => {
        expect(event).toBe('workspaceUpdate');
        publishWorkspaceUpdate = listener;
    };
    const apply = createScratchBlocksReplayPort(harness);
    const pending = apply({
        targetId: 'sprite-b',
        eventJson: {type: 'create', blockId: 'block-1', xml: '<block />', ids: ['block-1']},
        previousLocation: null
    });

    expect(harness.calls.map(call => call[0])).toEqual(['target']);
    publishWorkspaceUpdate();
    await pending;
    expect(harness.calls.map(call => call[0])).toEqual([
        'target', 'fromJson', 'disable', 'run', 'enable', 'vm'
    ]);
});

test('rejects a missing target before waiting for a workspace update', async () => {
    const harness = createHarness();
    harness.vm.runtime = {getTargetById: () => null, targets: []};
    harness.vm.once = jest.fn();
    const apply = createScratchBlocksReplayPort(harness);

    await expect(apply({
        targetId: 'deleted-sprite',
        targetRef: {runtimeId: 'deleted-sprite', name: 'Deleted', isStage: false},
        eventJson: {type: 'delete', blockId: 'block-1', ids: ['block-1']},
        previousLocation: null
    })).rejects.toThrow('Cannot replay event for missing target: Deleted');
    expect(harness.vm.once).not.toHaveBeenCalled();
});

test('maps a regenerated workspace shadow to the VM through its parent input', async () => {
    const shadow = {id: 'recorded-shadow'};
    const parent = {
        id: 'stable-parent',
        inputList: [{name: 'VALUE', connection: {targetBlock: () => shadow}}]
    };
    shadow.getParent = () => parent;
    const vmBlocks = {
        'stable-parent': {id: 'stable-parent', inputs: {VALUE: {block: 'restored-shadow'}}},
        'restored-shadow': {id: 'restored-shadow', inputs: {}}
    };
    const vm = {
        editingTarget: {blocks: {getBlock: id => vmBlocks[id] || null}}
    };
    const workspace = {getBlockById: id => (id === 'recorded-shadow' ? shadow : null)};

    expect(resolveVmBlockId(vm, workspace, 'recorded-shadow')).toBe('restored-shadow');
    expect(resolveVmBlockId(vm, workspace, 'stable-parent')).toBe('stable-parent');
});

test('resolves a portable shadow reference before applying to the workspace and VM', async () => {
    const calls = [];
    const currentShadow = {id: 'workspace-shadow'};
    const parent = {
        id: 'stable-parent',
        type: 'data_setvariableto',
        inputList: [{name: 'VALUE', connection: {targetBlock: () => currentShadow}}],
        getInput: name => (name === 'VALUE' ? {connection: {targetBlock: () => currentShadow}} : null)
    };
    currentShadow.getParent = () => parent;
    const vmBlocks = {
        'stable-parent': {id: 'stable-parent', inputs: {VALUE: {block: 'vm-shadow'}}},
        'vm-shadow': {id: 'vm-shadow', inputs: {}}
    };
    const workspace = {
        getBlockById: id => ({
            'stable-parent': parent,
            'workspace-shadow': currentShadow
        }[id] || null)
    };
    const vm = {
        editingTarget: {
            id: 'sprite-a',
            blocks: {getBlock: id => vmBlocks[id] || null}
        },
        blockListener: event => calls.push(['vm', event.blockId])
    };
    const ScratchBlocks = {
        Events: {
            fromJson: json => {
                calls.push(['workspace', json.blockId]);
                return {...json, run: () => {}};
            },
            disable: () => {},
            enable: () => {}
        }
    };
    const apply = createScratchBlocksReplayPort({workspace, vm, ScratchBlocks});

    await apply({
        targetId: 'sprite-a',
        blockRef: {ancestorId: 'stable-parent', inputPath: ['VALUE']},
        eventJson: {type: 'change', blockId: 'recorded-shadow', newValue: '90'}
    });

    expect(calls).toEqual([
        ['workspace', 'workspace-shadow'],
        ['vm', 'vm-shadow']
    ]);
});

test('restores a deleted list value and monitor when replay recreates its definition', async () => {
    const harness = createHarness();
    const monitorBlocks = new Map();
    const stage = {
        id: 'stage-id',
        isOriginal: true,
        isStage: true,
        getName: () => 'Stage',
        variables: {}
    };
    let restoredMonitor = null;
    harness.vm.editingTarget = stage;
    harness.vm.runtime = {
        getTargetById: id => (id === stage.id ? stage : null),
        targets: [stage],
        monitorBlocks: {
            createBlock: block => monitorBlocks.set(block.id, block),
            getBlock: id => monitorBlocks.get(id) || null
        },
        requestAddMonitor: monitor => {
            restoredMonitor = monitor;
        }
    };
    harness.vm.blockListener = () => {
        stage.variables.list = {name: 'items', type: 'list', value: []};
    };
    const apply = createScratchBlocksReplayPort(harness);

    await apply({
        targetId: 'stage-id',
        targetRef: {isStage: true, name: 'Stage'},
        eventJson: {
            type: 'var_create',
            varId: 'list',
            varType: 'list',
            varName: 'items',
            isLocal: false,
            isCloud: false
        },
        listDefinition: {
            present: true,
            id: 'list',
            targetRef: {isStage: true, name: 'Stage'},
            name: 'items',
            value: ['one', 'two'],
            monitorBlock: {id: 'list', opcode: 'data_listcontents'},
            monitor: {id: 'list', opcode: 'data_listcontents', mode: 'list', visible: true}
        }
    });

    expect(stage.variables.list.value).toEqual(['one', 'two']);
    expect(monitorBlocks.get('list')).toMatchObject({opcode: 'data_listcontents'});
    expect(restoredMonitor.get('visible')).toBe(true);
});

test('restores a scalar variable monitor when replay recreates a local definition', async () => {
    const harness = createHarness();
    const monitorBlocks = new Map();
    const sprite = {
        id: 'sprite-id',
        isOriginal: true,
        isStage: false,
        getName: () => 'Sprite1',
        variables: {}
    };
    let restoredMonitor = null;
    harness.vm.editingTarget = sprite;
    harness.vm.runtime = {
        getTargetById: id => (id === sprite.id ? sprite : null),
        targets: [sprite],
        monitorBlocks: {
            createBlock: block => monitorBlocks.set(block.id, block),
            getBlock: id => monitorBlocks.get(id) || null
        },
        requestAddMonitor: monitor => {
            restoredMonitor = monitor;
        }
    };
    harness.vm.blockListener = () => {
        sprite.variables.cake = {name: 'cake', type: '', value: 0};
    };
    const apply = createScratchBlocksReplayPort(harness);

    await apply({
        targetId: 'sprite-id',
        targetRef: {isStage: false, name: 'Sprite1'},
        eventJson: {
            type: 'var_create',
            varId: 'cake',
            varType: '',
            varName: 'cake',
            isLocal: true,
            isCloud: false
        },
        listDefinition: {
            present: true,
            id: 'cake',
            targetRef: {isStage: false, name: 'Sprite1'},
            name: 'cake',
            type: '',
            value: 0,
            monitorBlock: {id: 'cake', opcode: 'data_variable'},
            monitor: {id: 'cake', opcode: 'data_variable', mode: 'default', visible: true}
        }
    });

    expect(sprite.variables.cake.value).toBe(0);
    expect(monitorBlocks.get('cake')).toMatchObject({opcode: 'data_variable'});
    expect(restoredMonitor.get('visible')).toBe(true);
});
