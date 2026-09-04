import {
    attachProjectOperationCapture,
    runStudioProjectOperationSource
} from '../../src/studio/bridge/project-operation-capture';
import {EventEmitter} from 'events';

const makeTarget = (id, name, costumes = []) => ({
    id,
    isOriginal: true,
    isStage: false,
    getName: () => name,
    getCostumes: () => costumes
});

test('captures sprite creation around the original VM operation', async () => {
    const source = makeTarget('sprite-a', 'Sprite1');
    const created = makeTarget('sprite-b', 'Sprite2');
    const vm = {
        runtime: {targets: [source]},
        addSprite: jest.fn(async () => {
            vm.runtime.targets.push(created);
            return created.id;
        })
    };
    const original = vm.addSprite;
    const captureOperation = jest.fn(async (operation, invoke, complete) => {
        const result = await invoke();
        return {result, metadata: complete()};
    });
    const port = attachProjectOperationCapture({
        vm,
        shouldCapture: () => true,
        captureOperation
    });

    await expect(vm.addSprite('sprite-json')).resolves.toEqual({
        result: 'sprite-b',
        metadata: {
            targetId: 'sprite-b',
            targetRef: {isStage: false, name: 'Sprite2'}
        }
    });
    expect(captureOperation.mock.calls[0][0]).toEqual({type: 'sprite-create'});
    port.detach();
    expect(vm.addSprite).toBe(original);
});

test('keeps addSprite asynchronous unique-name normalization inside its checkpoint', async () => {
    const source = makeTarget('sprite-a', 'Sprite1');
    let createdName = 'Sprite1';
    const created = makeTarget('sprite-b', createdName);
    created.getName = () => createdName;
    let busy = false;
    const vm = {
        runtime: {
            targets: [source],
            getTargetById: id => vm.runtime.targets.find(target => target.id === id) || null
        },
        renameSprite: jest.fn((targetId, name) => {
            if (targetId === created.id && name === 'Sprite1') createdName = 'Sprite2';
        }),
        addSprite: jest.fn(async function () {
            vm.runtime.targets.push(created);
            await Promise.resolve();
            this.renameSprite(created.id, createdName);
            return created.id;
        })
    };
    const captureOperation = jest.fn(async (operation, invoke, complete) => {
        busy = true;
        try {
            const result = await invoke();
            return {operation, result, metadata: complete()};
        } finally {
            busy = false;
        }
    });
    const renameSprite = vm.renameSprite;
    attachProjectOperationCapture({vm, shouldCapture: () => !busy, captureOperation});

    await expect(vm.addSprite('sprite-json')).resolves.toMatchObject({
        result: 'sprite-b',
        metadata: {
            targetId: 'sprite-b',
            targetRef: {isStage: false, name: 'Sprite2'}
        }
    });
    expect(renameSprite).toHaveBeenCalledWith('sprite-b', 'Sprite1');
    expect(captureOperation).toHaveBeenCalledTimes(1);
});

test('still serializes a rename of an existing sprite behind addSprite normalization', async () => {
    let sourceName = 'Sprite1';
    let createdName = 'Sprite1';
    const source = makeTarget('sprite-a', sourceName);
    source.getName = () => sourceName;
    const created = makeTarget('sprite-b', createdName);
    created.getName = () => createdName;
    let releaseInstall;
    let busy = false;
    const renameCalls = [];
    const vm = {
        runtime: {
            targets: [source],
            getTargetById: id => vm.runtime.targets.find(target => target.id === id) || null
        },
        renameSprite: jest.fn((targetId, name) => {
            renameCalls.push(targetId);
            if (targetId === created.id) createdName = 'Sprite2';
            if (targetId === source.id) sourceName = name;
        }),
        addSprite: jest.fn(async function () {
            vm.runtime.targets.push(created);
            await new Promise(resolve => {
                releaseInstall = resolve;
            });
            this.renameSprite(created.id, createdName);
            return created.id;
        })
    };
    const captureOperation = jest.fn(async (operation, invoke, complete) => {
        busy = true;
        try {
            const result = await invoke();
            return {operation, result, metadata: complete()};
        } finally {
            busy = false;
        }
    });
    attachProjectOperationCapture({vm, shouldCapture: () => !busy, captureOperation});

    const adding = vm.addSprite('sprite-json');
    await Promise.resolve();
    const renaming = vm.renameSprite(source.id, 'Hero');
    expect(renameCalls).toEqual([]);

    releaseInstall();
    await adding;
    await renaming;

    expect(renameCalls).toEqual(['sprite-b', 'sprite-a']);
    expect(sourceName).toBe('Hero');
    expect(captureOperation.mock.calls.map(call => call[0].type)).toEqual([
        'sprite-create',
        'sprite-rename'
    ]);
});

test('retains the durable built-in library item for sprite creation', async () => {
    const source = makeTarget('sprite-a', 'Sprite1');
    const created = makeTarget('sprite-b', 'Apple');
    const vm = {
        runtime: {targets: [source]},
        addSprite: jest.fn(async () => {
            vm.runtime.targets.push(created);
        })
    };
    const captureOperation = jest.fn(async (operation, invoke, complete) => {
        await invoke();
        return {operation, metadata: complete()};
    });
    attachProjectOperationCapture({vm, shouldCapture: () => true, captureOperation});

    const result = await vm.addSprite(JSON.stringify({
        name: 'Apple',
        costumes: [{md5ext: 'apple-asset.svg'}]
    }));

    expect(result).toMatchObject({
        operation: {
            type: 'sprite-create',
            libraryItem: {name: 'Apple', md5ext: 'apple-asset.svg'}
        },
        metadata: {targetRef: {name: 'Apple', isStage: false}}
    });
});

test('captures duplicate, rename and delete as checkpoint-backed sprite lifecycle operations', async () => {
    let sourceName = 'Sprite1';
    const source = makeTarget('sprite-a', sourceName);
    source.getName = () => sourceName;
    const vm = {
        editingTarget: source,
        runtime: {
            targets: [source],
            getTargetById: id => vm.runtime.targets.find(target => target.id === id) || null
        },
        duplicateSprite: jest.fn(async () => {
            vm.runtime.targets.push(makeTarget('sprite-b', 'Sprite2'));
        }),
        renameSprite: jest.fn((targetId, name) => {
            if (targetId === source.id) sourceName = name;
        }),
        deleteSprite: jest.fn(targetId => {
            vm.runtime.targets = vm.runtime.targets.filter(target => target.id !== targetId);
            return () => Promise.resolve();
        })
    };
    const captureOperation = async (operation, invoke, complete) => {
        const result = await invoke();
        return {operation, result, metadata: complete()};
    };
    attachProjectOperationCapture({vm, shouldCapture: () => true, captureOperation});

    await expect(vm.duplicateSprite('sprite-a')).resolves.toMatchObject({
        operation: {
            type: 'sprite-duplicate',
            sourceTargetId: 'sprite-a',
            sourceTargetRef: {name: 'Sprite1', isStage: false}
        },
        metadata: {targetId: 'sprite-b', targetRef: {name: 'Sprite2', isStage: false}}
    });
    await expect(vm.renameSprite('sprite-a', 'Hero')).resolves.toMatchObject({
        operation: {
            type: 'sprite-rename',
            targetId: 'sprite-a',
            targetRef: {name: 'Sprite1', isStage: false},
            oldName: 'Sprite1',
            requestedName: 'Hero'
        },
        metadata: {newName: 'Hero', renamedTargetRef: {name: 'Hero', isStage: false}}
    });
    await expect(vm.deleteSprite('sprite-b')).resolves.toMatchObject({
        operation: {
            type: 'sprite-delete',
            targetId: 'sprite-b',
            targetRef: {name: 'Sprite2', isStage: false}
        },
        metadata: {deletedTargetRef: {name: 'Sprite2', isStage: false}}
    });
});

test('captures sprite reordering by durable target identity and verifies the final index', async () => {
    const stage = {...makeTarget('stage', 'Stage'), isStage: true};
    const first = makeTarget('sprite-a', 'Sprite1');
    const second = makeTarget('sprite-b', 'Sprite2');
    const vm = {
        runtime: {targets: [stage, first, second]},
        reorderTarget: jest.fn((targetIndex, newIndex) => {
            const [target] = vm.runtime.targets.splice(targetIndex, 1);
            vm.runtime.targets.splice(newIndex, 0, target);
            return true;
        })
    };
    const captureOperation = async (operation, invoke, complete) => {
        const result = await invoke();
        return {operation, metadata: complete(result)};
    };
    attachProjectOperationCapture({vm, shouldCapture: () => true, captureOperation});

    await expect(vm.reorderTarget(2, 1)).resolves.toEqual({
        operation: {
            type: 'sprite-reorder',
            targetId: 'sprite-b',
            targetRef: {isStage: false, name: 'Sprite2'},
            targetIndex: 2,
            newIndex: 1
        },
        metadata: {movedTargetRef: {isStage: false, name: 'Sprite2'}}
    });
    expect(vm.runtime.targets).toEqual([stage, second, first]);
});

test('does not checkpoint a clamped no-op sprite reorder', () => {
    const stage = {...makeTarget('stage', 'Stage'), isStage: true};
    const sprite = makeTarget('sprite-a', 'Sprite1');
    const vm = {
        runtime: {targets: [stage, sprite]},
        reorderTarget: jest.fn(() => false)
    };
    const captureOperation = jest.fn();
    attachProjectOperationCapture({vm, shouldCapture: () => true, captureOperation});

    expect(vm.reorderTarget(99, 1)).toBe(false);
    expect(captureOperation).not.toHaveBeenCalled();
});

test('captures cross-sprite script copies and same-target script imports distinctly', async () => {
    const sourceBlock = {id: 'source-root', opcode: 'event_whenflagclicked', x: 120.2, y: 89.8};
    const makeBlocks = values => ({
        _blocks: values,
        getBlock: id => values[id] || null
    });
    const source = {
        ...makeTarget('sprite-a', 'Sprite1'),
        blocks: makeBlocks({'source-root': sourceBlock, child: {id: 'child', opcode: 'motion_movesteps'}})
    };
    let targetValues = {};
    const target = {
        ...makeTarget('sprite-b', 'Sprite2'),
        blocks: makeBlocks(targetValues)
    };
    const vm = {
        runtime: {
            getTargetById: id => ({'sprite-a': source, 'sprite-b': target}[id] || null)
        },
        shareBlocksToTarget: jest.fn(async blocks => {
            blocks.forEach((block, index) => {
                targetValues[`copy-${index}`] = {...block, id: `copy-${index}`};
            });
        })
    };
    const captureOperation = async (operation, invoke, complete) => {
        await invoke();
        return {operation, metadata: complete()};
    };
    attachProjectOperationCapture({vm, shouldCapture: () => true, captureOperation});
    const payload = [
        {...sourceBlock, id: 'copied-root', topLevel: true},
        {id: 'copied-child', opcode: 'motion_movesteps', topLevel: false}
    ];

    await expect(vm.shareBlocksToTarget(payload, 'sprite-b', 'sprite-a', 'source-root')).resolves.toEqual({
        operation: {
            type: 'block-share',
            targetId: 'sprite-b',
            targetRef: {isStage: false, name: 'Sprite2'},
            sourceTargetId: 'sprite-a',
            sourceTargetRef: {isStage: false, name: 'Sprite1'},
            sourceRoot: {
                opcode: 'event_whenflagclicked',
                blockCount: 2,
                blockRef: {
                    ancestorId: 'source-root',
                    ancestorType: 'event_whenflagclicked',
                    ancestorCoordinate: {x: 120, y: 90},
                    path: []
                }
            }
        },
        metadata: {copiedBlockCount: 2, copiedRootOpcode: 'event_whenflagclicked'}
    });

    targetValues = {};
    target.blocks = makeBlocks(targetValues);
    await expect(vm.shareBlocksToTarget(payload, 'sprite-b')).resolves.toMatchObject({
        operation: {type: 'block-import', targetRef: {name: 'Sprite2'}},
        metadata: {copiedBlockCount: 2}
    });

    targetValues = {};
    target.blocks = makeBlocks(targetValues);
    await expect(runStudioProjectOperationSource(vm, {
        kind: 'backpack-script',
        item: {id: '17', type: 'script', name: 'code', bodyMD5: 'abc123'}
    }, () => vm.shareBlocksToTarget(payload, 'sprite-b'))).resolves.toMatchObject({
        operation: {
            type: 'block-import',
            importSource: {
                kind: 'backpack',
                id: '17',
                type: 'script',
                name: 'code',
                bodyMD5: 'abc123'
            },
            destinationCoordinate: {x: 120.2, y: 89.8}
        },
        metadata: {copiedBlockCount: 2}
    });
});

test.each([false, true])('records a copied substack source (temporary: %s)', async temporary => {
    const values = {
        hat: {
            id: 'hat',
            opcode: 'event_whenflagclicked',
            parent: null,
            next: 'move',
            inputs: {},
            x: 70,
            y: 80
        },
        move: {
            id: 'move',
            opcode: 'motion_movesteps',
            parent: 'hat',
            next: 'say',
            inputs: {}
        },
        say: {
            id: 'say',
            opcode: 'looks_say',
            parent: 'move',
            next: null,
            inputs: {}
        }
    };
    const source = {
        ...makeTarget('source', 'Source'),
        blocks: {_blocks: values, getBlock: id => values[id] || null}
    };
    const copied = {};
    const target = {
        ...makeTarget('target', 'Target'),
        blocks: {_blocks: copied, getBlock: id => copied[id] || null}
    };
    const vm = {
        runtime: {getTargetById: id => ({source, target}[id] || null)},
        shareBlocksToTarget: jest.fn(async payload => {
            payload.forEach((block, index) => {
                copied[`copy-${index}`] = block;
            });
        })
    };
    const captureOperation = async (operation, invoke, complete) => {
        await invoke();
        return {operation, metadata: complete()};
    };
    attachProjectOperationCapture({
        vm,
        shouldCapture: () => true,
        captureOperation,
        dragSourceReference: id => (temporary && id === 'temporary-copy' ? {
            ancestorId: 'hat',
            ancestorType: 'event_whenflagclicked',
            ancestorCoordinate: {x: 70, y: 80},
            path: [{kind: 'next'}]
        } : null)
    });

    const result = await vm.shareBlocksToTarget([
        {...values.move, id: 'copied-move', topLevel: true},
        {...values.say, id: 'copied-say', topLevel: false}
    ], 'target', 'source', temporary ? 'temporary-copy' : 'move');

    expect(result.operation.sourceRoot).toEqual({
        opcode: 'motion_movesteps',
        blockCount: 2,
        blockRef: {
            ancestorId: 'hat',
            ancestorType: 'event_whenflagclicked',
            ancestorCoordinate: {x: 70, y: 80},
            path: [{kind: 'next'}]
        }
    });
});

test('rejects a copied-script checkpoint when the VM adds only part of the payload', async () => {
    const sourceValues = {root: {id: 'root', opcode: 'looks_say', topLevel: true}};
    const targetValues = {};
    const source = {
        ...makeTarget('source', 'Source'),
        blocks: {_blocks: sourceValues, getBlock: id => sourceValues[id] || null}
    };
    const target = {
        ...makeTarget('target', 'Target'),
        blocks: {_blocks: targetValues, getBlock: id => targetValues[id] || null}
    };
    const vm = {
        runtime: {getTargetById: id => ({source, target}[id] || null)},
        shareBlocksToTarget: jest.fn(async () => {
            targetValues.partial = {id: 'partial'};
        })
    };
    const captureOperation = async (operation, invoke, complete) => {
        await invoke();
        return complete();
    };
    attachProjectOperationCapture({vm, shouldCapture: () => true, captureOperation});

    await expect(vm.shareBlocksToTarget([
        sourceValues.root,
        {id: 'child', opcode: 'text', topLevel: false}
    ], 'target', 'source')).rejects.toThrow('identify every copied block');
});

test('captures a built-in costume library addition', async () => {
    const originalCostume = {assetId: 'original', dataFormat: 'svg', name: 'costume1'};
    const addedCostume = {assetId: 'arrow-asset', dataFormat: 'svg', name: 'Arrow1-a'};
    const target = makeTarget('sprite-a', 'Sprite1', [originalCostume]);
    const vm = {
        editingTarget: target,
        runtime: {getTargetById: id => (id === target.id ? target : null)},
        addCostumeFromLibrary: jest.fn(async () => {
            target.getCostumes().push(addedCostume);
        })
    };
    const original = vm.addCostumeFromLibrary;
    const captureOperation = jest.fn(async (operation, invoke, complete) => {
        await invoke();
        return {operation, metadata: complete()};
    });
    const port = attachProjectOperationCapture({vm, shouldCapture: () => true, captureOperation});

    await expect(vm.addCostumeFromLibrary('arrow-asset.svg', {name: 'Arrow1-a'})).resolves.toMatchObject({
        operation: {
            type: 'costume-library-add',
            targetId: 'sprite-a',
            targetRef: {isStage: false, name: 'Sprite1'},
            libraryItem: {name: 'Arrow1-a', md5ext: 'arrow-asset.svg'}
        },
        metadata: {addedCostume}
    });
    port.detach();
    expect(vm.addCostumeFromLibrary).toBe(original);
});

test('captures uploaded and freshly painted costumes through the generic add route', async () => {
    const costumes = [{assetId: 'original', dataFormat: 'svg', name: 'costume1'}];
    const target = makeTarget('sprite-a', 'Sprite1', costumes);
    const vm = {
        editingTarget: target,
        runtime: {getTargetById: id => (id === target.id ? target : null)},
        addCostume: jest.fn(async (md5ext, costume) => {
            costumes.push({...costume, assetId: md5ext.split('.')[0], dataFormat: 'svg'});
        })
    };
    const captureOperation = async (operation, invoke, complete) => {
        await invoke();
        return {operation, metadata: complete()};
    };
    attachProjectOperationCapture({vm, shouldCapture: () => true, captureOperation});

    await expect(runStudioProjectOperationSource(vm, {
        kind: 'costume-upload',
        fileName: 'rocket'
    }, () => vm.addCostume('blank-asset.svg', {name: 'costume2'}))).resolves.toMatchObject({
        operation: {
            type: 'costume-add',
            sourceItem: {name: 'costume2', md5ext: 'blank-asset.svg'},
            uploadFile: {name: 'rocket'}
        },
        metadata: {addedCostume: {assetId: 'blank-asset', name: 'costume2'}}
    });

    const stage = makeTarget('stage', 'Stage', costumes);
    stage.isStage = true;
    vm.editingTarget = stage;
    vm.runtime.getTargetById = id => (id === stage.id ? stage : null);
    await expect(runStudioProjectOperationSource(vm, {
        kind: 'costume-paint'
    }, () => vm.addCostume('sky.svg', {name: 'backdrop2'}))).resolves.toMatchObject({
        operation: {
            type: 'backdrop-add',
            targetRef: {isStage: true, name: 'Stage'},
            createdWith: 'paint'
        },
        metadata: {addedCostume: {assetId: 'sky', name: 'backdrop2'}}
    });
});

test('captures Stage-menu upload and Paint creation as generic backdrop additions', async () => {
    const costumes = [{assetId: 'original', dataFormat: 'svg', name: 'backdrop1'}];
    const stage = makeTarget('stage', 'Stage', costumes);
    stage.isStage = true;
    const vm = {
        editingTarget: stage,
        runtime: {
            getTargetForStage: () => stage,
            getTargetById: id => (id === stage.id ? stage : null)
        },
        addBackdrop: jest.fn(async (md5ext, backdrop) => {
            costumes.push({...backdrop, assetId: md5ext.split('.')[0], dataFormat: 'svg'});
        })
    };
    const captureOperation = async (operation, invoke, complete) => {
        await invoke();
        return {operation, metadata: complete()};
    };
    attachProjectOperationCapture({vm, shouldCapture: () => true, captureOperation});

    await expect(runStudioProjectOperationSource(vm, {
        kind: 'costume-upload',
        fileName: 'sky'
    }, () => vm.addBackdrop('sky.svg', {name: 'sky'}))).resolves.toMatchObject({
        operation: {
            type: 'backdrop-add',
            targetRef: {isStage: true, name: 'Stage'},
            uploadFile: {name: 'sky'}
        },
        metadata: {addedCostume: {assetId: 'sky', name: 'sky'}}
    });

    await expect(runStudioProjectOperationSource(vm, {
        kind: 'costume-paint'
    }, () => vm.addBackdrop('blank.svg', {name: 'backdrop3'}))).resolves.toMatchObject({
        operation: {
            type: 'backdrop-add',
            targetRef: {isStage: true, name: 'Stage'},
            createdWith: 'paint'
        },
        metadata: {addedCostume: {assetId: 'blank', name: 'backdrop3'}}
    });
});

test('keeps the specific library operation when it delegates to generic costume addition', async () => {
    const costumes = [{assetId: 'original', dataFormat: 'svg', name: 'costume1'}];
    const target = makeTarget('sprite-a', 'Sprite1', costumes);
    let busy = false;
    const vm = {
        editingTarget: target,
        runtime: {
            targets: [target],
            getTargetById: id => (id === target.id ? target : null)
        },
        addCostume: jest.fn(async (md5ext, costume) => {
            costumes.push({...costume, assetId: md5ext.split('.')[0], dataFormat: 'svg'});
        }),
        addCostumeFromLibrary: jest.fn(function (md5ext, costume) {
            return this.addCostume(md5ext, costume, target.id);
        })
    };
    const captureOperation = jest.fn(async (operation, invoke, complete) => {
        busy = true;
        try {
            await invoke();
            return {operation, metadata: complete()};
        } finally {
            busy = false;
        }
    });
    attachProjectOperationCapture({vm, shouldCapture: () => !busy, captureOperation});

    await expect(vm.addCostumeFromLibrary('arrow.svg', {name: 'Arrow'})).resolves.toMatchObject({
        operation: {type: 'costume-library-add'},
        metadata: {addedCostume: {assetId: 'arrow', name: 'Arrow'}}
    });
    expect(captureOperation).toHaveBeenCalledTimes(1);
});

test('serializes independent editor mutations behind an active checkpoint capture', async () => {
    const costumes = [{assetId: 'before', dataFormat: 'svg', name: 'costume1'}];
    const target = makeTarget('sprite-a', 'Sprite1', costumes);
    const gates = [];
    let busy = false;
    const vm = {
        editingTarget: target,
        runtime: {getTargetById: id => (id === target.id ? target : null)},
        updateSvg: jest.fn((index, svg) => {
            costumes[index] = {...costumes[index], assetId: svg};
            return svg;
        })
    };
    const captureOperation = jest.fn(async (operation, invoke, complete) => {
        busy = true;
        const result = await invoke();
        await new Promise(resolve => gates.push(resolve));
        busy = false;
        return {operation, result, metadata: complete()};
    });
    const updateSvg = vm.updateSvg;
    attachProjectOperationCapture({vm, shouldCapture: () => !busy, captureOperation});

    const first = vm.updateSvg(0, 'first', 0, 0);
    const second = vm.updateSvg(0, 'second', 0, 0);
    expect(updateSvg).toHaveBeenCalledTimes(1);
    expect(costumes[0].assetId).toBe('first');

    await Promise.resolve();
    gates.shift()();
    await first;
    await Promise.resolve();
    expect(updateSvg).toHaveBeenCalledTimes(2);
    expect(costumes[0].assetId).toBe('second');
    expect(captureOperation).toHaveBeenCalledTimes(2);

    gates.shift()();
    await expect(second).resolves.toMatchObject({result: 'second'});
});

test('captures a built-in backdrop library addition against the Stage', async () => {
    const originalBackdrop = {assetId: 'original', dataFormat: 'svg', name: 'backdrop1'};
    const addedBackdrop = {assetId: 'blue-sky', dataFormat: 'svg', name: 'Blue Sky'};
    const stage = makeTarget('stage', 'Stage', [originalBackdrop]);
    stage.isStage = true;
    const vm = {
        editingTarget: makeTarget('sprite-a', 'Sprite1'),
        runtime: {
            getTargetForStage: () => stage,
            getTargetById: id => (id === stage.id ? stage : null)
        },
        addBackdrop: jest.fn(async () => {
            stage.getCostumes().push(addedBackdrop);
        })
    };
    const captureOperation = async (operation, invoke, complete) => {
        await invoke();
        return {operation, metadata: complete()};
    };
    attachProjectOperationCapture({vm, shouldCapture: () => true, captureOperation});

    await expect(vm.addBackdrop('blue-sky.svg', {name: 'Blue Sky'})).resolves.toMatchObject({
        operation: {
            type: 'backdrop-library-add',
            targetId: 'stage',
            targetRef: {isStage: true, name: 'Stage'},
            libraryItem: {name: 'Blue Sky', md5ext: 'blue-sky.svg'}
        },
        metadata: {addedBackdrop}
    });
});

test('captures costume transfer references and preserves the original result', async () => {
    const sourceCostume = {assetId: 'source-asset', dataFormat: 'svg', name: 'source'};
    const sharedCostume = {assetId: 'shared-asset', dataFormat: 'svg', name: 'source2'};
    const source = makeTarget('sprite-a', 'Sprite1', [sourceCostume]);
    const target = makeTarget('sprite-b', 'Sprite2', []);
    const vm = {
        editingTarget: source,
        runtime: {
            targets: [source, target],
            getTargetById: id => (id === target.id ? target : null)
        },
        shareCostumeToTarget: jest.fn(async () => {
            target.getCostumes().push(sharedCostume);
            return 'shared';
        })
    };
    const original = vm.shareCostumeToTarget;
    const captureOperation = async (operation, invoke, complete) => {
        const result = await invoke();
        return {operation, result, metadata: complete()};
    };
    const port = attachProjectOperationCapture({vm, shouldCapture: () => true, captureOperation});

    await expect(vm.shareCostumeToTarget(0, 'sprite-b')).resolves.toMatchObject({
        result: 'shared',
        operation: {
            type: 'costume-share',
            sourceTargetRef: {isStage: false, name: 'Sprite1'},
            targetRef: {isStage: false, name: 'Sprite2'},
            sourceCostume
        },
        metadata: {sharedCostume}
    });
    port.detach();
    expect(vm.shareCostumeToTarget).toBe(original);
});

test('captures duplicate, rename, delete and reorder costume operations', async () => {
    const costumes = [
        {assetId: 'one', dataFormat: 'svg', name: 'costume1'},
        {assetId: 'two', dataFormat: 'svg', name: 'costume2'}
    ];
    const target = makeTarget('sprite-a', 'Sprite1', costumes);
    const vm = {
        editingTarget: target,
        runtime: {getTargetById: id => (id === target.id ? target : null)},
        duplicateCostume: jest.fn(async index => costumes.splice(index + 1, 0, {
            ...costumes[index],
            name: `${costumes[index].name}2`
        })),
        renameCostume: jest.fn((index, name) => {
            costumes[index].name = name;
        }),
        deleteCostume: jest.fn(index => {
            const [deleted] = costumes.splice(index, 1);
            return () => costumes.push(deleted);
        }),
        reorderCostume: jest.fn((targetId, index, newIndex) => {
            costumes.splice(newIndex, 0, costumes.splice(index, 1)[0]);
            return true;
        })
    };
    const captureOperation = async (operation, invoke, complete) => {
        const result = await invoke();
        return {operation, metadata: complete(result)};
    };
    attachProjectOperationCapture({vm, shouldCapture: () => true, captureOperation});

    await expect(vm.duplicateCostume(0)).resolves.toMatchObject({
        operation: {type: 'costume-duplicate', costumeIndex: 0, sourceCostume: {name: 'costume1'}},
        metadata: {addedCostume: {name: 'costume12'}}
    });
    await expect(vm.renameCostume(1, 'Hero')).resolves.toMatchObject({
        operation: {type: 'costume-rename', oldCostume: {name: 'costume12'}, requestedName: 'Hero'},
        metadata: {renamedCostume: {name: 'Hero'}}
    });
    await expect(vm.deleteCostume(1)).resolves.toMatchObject({
        operation: {type: 'costume-delete', deletedCostume: {name: 'Hero'}}
    });
    await expect(vm.reorderCostume('sprite-a', 1, 0)).resolves.toMatchObject({
        operation: {type: 'costume-reorder', costumeIndex: 1, newIndex: 0},
        metadata: {reordered: true}
    });
});

test('captures vector paint mutations for costumes and backdrops', async () => {
    const costumes = [{assetId: 'before', dataFormat: 'svg', name: 'costume1'}];
    const target = makeTarget('sprite-a', 'Sprite1', costumes);
    const vm = {
        editingTarget: target,
        runtime: {getTargetById: id => (id === target.id ? target : null)},
        updateSvg: jest.fn(index => {
            costumes[index] = {...costumes[index], assetId: 'after'};
        })
    };
    const captureOperation = async (operation, invoke, complete) => {
        const result = await invoke();
        return {operation, result, metadata: complete()};
    };
    attachProjectOperationCapture({vm, shouldCapture: () => true, captureOperation});

    await expect(vm.updateSvg(0, '<svg/>', 0, 0)).resolves.toMatchObject({
        operation: {
            type: 'costume-edit',
            editFormat: 'svg',
            previousCostume: {assetId: 'before'}
        },
        metadata: {editedCostume: {assetId: 'after'}}
    });

    costumes[0] = {...costumes[0], assetId: 'brush-before'};
    await expect(runStudioProjectOperationSource(vm, {
        kind: 'paint-brush-stroke',
        gesture: {
            tool: 'brush',
            durationMs: 100,
            brushStyle: {
                brushSize: 18,
                fillColor: '#12ab34'
            },
            points: [{x: 0.1, y: 0.2, t: 0}, {x: 0.8, y: 0.7, t: 100}]
        }
    }, () => vm.updateSvg(0, '<svg id="brush"/>', 0, 0))).resolves.toMatchObject({
        operation: {
            type: 'costume-edit',
            paintGesture: {
                tool: 'brush',
                durationMs: 100,
                brushStyle: {
                    brushSize: 18,
                    fillColor: '#12ab34'
                },
                points: [{x: 0.1, y: 0.2, t: 0}, {x: 0.8, y: 0.7, t: 100}]
            }
        }
    });

    const stage = makeTarget('stage', 'Stage', costumes);
    stage.isStage = true;
    vm.editingTarget = stage;
    vm.runtime.getTargetById = id => (id === stage.id ? stage : null);
    costumes[0] = {...costumes[0], assetId: 'stage-before'};
    await expect(vm.updateSvg(0, '<svg id="stage"/>', 0, 0)).resolves.toMatchObject({
        operation: {
            type: 'backdrop-edit',
            previousCostume: {assetId: 'stage-before'}
        },
        metadata: {editedCostume: {assetId: 'after'}}
    });
});

test('waits for asynchronous bitmap asset serialization before completing capture', async () => {
    const costumes = [{assetId: 'vector', dataFormat: 'svg', name: 'costume1'}];
    const target = makeTarget('sprite-a', 'Sprite1', costumes);
    const vm = Object.assign(new EventEmitter(), {
        editingTarget: target,
        runtime: {getTargetById: id => (id === target.id ? target : null)},
        updateBitmap: jest.fn(() => {
            Promise.resolve().then(() => {
                costumes[0] = {...costumes[0], assetId: 'bitmap', dataFormat: 'png'};
                vm.emit('targetsUpdate');
            });
            return 'queued';
        })
    });
    const captureOperation = jest.fn(async (operation, invoke, complete) => {
        const result = await invoke();
        return {operation, result, metadata: complete()};
    });
    attachProjectOperationCapture({vm, shouldCapture: () => true, captureOperation});

    await expect(runStudioProjectOperationSource(vm, {
        kind: 'paint-brush-stroke',
        gesture: {
            tool: 'brush',
            durationMs: 80,
            brushStyle: {brushSize: 24, fillColor: '#abcdef'},
            points: [{x: 0.2, y: 0.3, t: 0}, {x: 0.7, y: 0.6, t: 80}]
        }
    }, () => vm.updateBitmap(0, {}, 0, 0, 2))).resolves.toMatchObject({
        operation: {
            type: 'costume-edit',
            editFormat: 'bitmap',
            previousCostume: {assetId: 'vector', dataFormat: 'svg'},
            paintGesture: {
                brushStyle: {brushSize: 24, fillColor: '#abcdef'}
            }
        },
        result: 'queued',
        metadata: {editedCostume: {assetId: 'bitmap', dataFormat: 'png'}}
    });
    expect(vm.listenerCount('targetsUpdate')).toBe(0);

    const stage = makeTarget('stage', 'Stage', costumes);
    stage.isStage = true;
    costumes[0] = {...costumes[0], assetId: 'stage-vector', dataFormat: 'svg'};
    vm.editingTarget = stage;
    vm.runtime.getTargetById = id => (id === stage.id ? stage : null);
    await expect(vm.updateBitmap(0, {}, 0, 0, 2)).resolves.toMatchObject({
        operation: {
            type: 'backdrop-edit',
            editFormat: 'bitmap',
            previousCostume: {assetId: 'stage-vector', dataFormat: 'svg'}
        },
        metadata: {editedCostume: {assetId: 'bitmap', dataFormat: 'png'}}
    });
    expect(vm.listenerCount('targetsUpdate')).toBe(0);
});

test('lets an unchanged bitmap serialization reach the normal no-op checkpoint filter', async () => {
    const costumes = [{assetId: 'same', dataFormat: 'png', name: 'costume1'}];
    const target = makeTarget('sprite-a', 'Sprite1', costumes);
    const vm = Object.assign(new EventEmitter(), {
        editingTarget: target,
        runtime: {getTargetById: id => (id === target.id ? target : null)},
        updateBitmap: jest.fn(() => Promise.resolve().then(() => vm.emit('targetsUpdate')))
    });
    const captureOperation = jest.fn(async (operation, invoke, complete) => {
        await invoke();
        return {operation, metadata: complete()};
    });
    attachProjectOperationCapture({vm, shouldCapture: () => true, captureOperation});

    await expect(vm.updateBitmap(0, {}, 0, 0, 2)).resolves.toMatchObject({
        operation: {type: 'costume-edit', editFormat: 'bitmap'},
        metadata: {editedCostume: {assetId: 'same', dataFormat: 'png'}}
    });
    expect(vm.listenerCount('targetsUpdate')).toBe(0);
});

test('distinguishes Stage backdrop lifecycle operations from sprite costumes', async () => {
    const backdrops = [
        {assetId: 'one', dataFormat: 'svg', name: 'backdrop1'},
        {assetId: 'two', dataFormat: 'svg', name: 'Blue Sky'}
    ];
    const stage = makeTarget('stage', 'Stage', backdrops);
    stage.isStage = true;
    const vm = {
        editingTarget: stage,
        runtime: {getTargetById: id => (id === stage.id ? stage : null)},
        duplicateCostume: jest.fn(async index => backdrops.splice(index + 1, 0, {
            ...backdrops[index], name: `${backdrops[index].name}2`
        })),
        renameCostume: jest.fn((index, name) => {
            backdrops[index].name = name;
        }),
        deleteCostume: jest.fn(index => backdrops.splice(index, 1)),
        reorderCostume: jest.fn((targetId, index, newIndex) => {
            backdrops.splice(newIndex, 0, backdrops.splice(index, 1)[0]);
            return true;
        })
    };
    const captureOperation = async (operation, invoke, complete) => {
        const result = await invoke();
        return {operation, metadata: complete(result)};
    };
    attachProjectOperationCapture({vm, shouldCapture: () => true, captureOperation});

    await expect(vm.duplicateCostume(1)).resolves.toMatchObject({operation: {type: 'backdrop-duplicate'}});
    await expect(vm.renameCostume(2, 'Night')).resolves.toMatchObject({operation: {type: 'backdrop-rename'}});
    await expect(vm.deleteCostume(2)).resolves.toMatchObject({operation: {type: 'backdrop-delete'}});
    await expect(vm.reorderCostume('stage', 1, 0)).resolves.toMatchObject({
        operation: {type: 'backdrop-reorder'}
    });
});

test('captures add, duplicate, rename, delete and reorder sound operations', async () => {
    const sounds = [{assetId: 'pop', dataFormat: 'wav', name: 'Pop', rate: 48000, sampleCount: 100}];
    const target = makeTarget('sprite-a', 'Sprite1');
    target.getSounds = () => sounds;
    target.sprite = {name: 'Sprite1', sounds};
    const vm = {
        editingTarget: target,
        runtime: {getTargetById: id => (id === target.id ? target : null)},
        addSound: jest.fn(async sound => sounds.push(sound)),
        duplicateSound: jest.fn(async index => sounds.splice(index + 1, 0, {
            ...sounds[index], name: `${sounds[index].name}2`
        })),
        renameSound: jest.fn((index, name) => {
            sounds[index].name = name;
        }),
        deleteSound: jest.fn(index => {
            const [deleted] = sounds.splice(index, 1);
            return () => sounds.push(deleted);
        }),
        reorderSound: jest.fn((targetId, index, newIndex) => {
            sounds.splice(newIndex, 0, sounds.splice(index, 1)[0]);
            return true;
        })
    };
    const captureOperation = async (operation, invoke, complete) => {
        const result = await invoke();
        return {operation, metadata: complete(result)};
    };
    attachProjectOperationCapture({vm, shouldCapture: () => true, captureOperation});

    await expect(vm.addSound({assetId: 'meow', dataFormat: 'wav', name: 'Meow'})).resolves.toMatchObject({
        operation: {type: 'sound-add', sourceSound: {name: 'Meow'}},
        metadata: {addedSound: {name: 'Meow'}}
    });
    await expect(runStudioProjectOperationSource(vm, {
        kind: 'sound-library',
        libraryItem: {name: 'Guitar Chord', md5ext: 'guitar.wav'}
    }, () => vm.addSound({
        assetId: 'guitar',
        dataFormat: 'wav',
        name: 'Guitar Chord',
        rate: 48000,
        sampleCount: 200
    }))).resolves.toMatchObject({
        operation: {
            type: 'sound-add',
            libraryItem: {name: 'Guitar Chord', md5ext: 'guitar.wav'}
        },
        metadata: {addedSound: {name: 'Guitar Chord', assetId: 'guitar'}}
    });
    await expect(runStudioProjectOperationSource(vm, {
        kind: 'sound-upload',
        fileName: 'Sneaker'
    }, () => vm.addSound({
        assetId: 'sneaker',
        dataFormat: 'wav',
        name: 'Sneaker',
        rate: 48000,
        sampleCount: 400
    }))).resolves.toMatchObject({
        operation: {
            type: 'sound-add',
            uploadFile: {name: 'Sneaker'}
        },
        metadata: {addedSound: {name: 'Sneaker', assetId: 'sneaker'}}
    });
    await expect(vm.duplicateSound(0)).resolves.toMatchObject({
        operation: {type: 'sound-duplicate', sourceSound: {name: 'Pop'}},
        metadata: {addedSound: {name: 'Pop2'}}
    });
    await expect(vm.renameSound(1, 'Boom')).resolves.toMatchObject({
        operation: {type: 'sound-rename', oldSound: {name: 'Pop2'}},
        metadata: {renamedSound: {name: 'Boom'}}
    });
    await expect(vm.deleteSound(1)).resolves.toMatchObject({
        operation: {type: 'sound-delete', deletedSound: {name: 'Boom'}}
    });
    await expect(vm.reorderSound('sprite-a', 1, 0)).resolves.toMatchObject({
        operation: {type: 'sound-reorder', soundIndex: 1, newIndex: 0},
        metadata: {reordered: true}
    });
});

test('captures persisted sound-editor mutations but ignores failed encodes', async () => {
    const sounds = [{assetId: 'before', dataFormat: 'wav', name: 'Pop', rate: 48000, sampleCount: 100}];
    const target = makeTarget('sprite-a', 'Sprite1');
    target.getSounds = () => sounds;
    target.sprite = {name: 'Sprite1', sounds};
    const vm = {
        editingTarget: target,
        runtime: {getTargetById: id => (id === target.id ? target : null)},
        updateSoundBuffer: jest.fn((index, buffer, encoding) => {
            if (encoding) sounds[index] = {...sounds[index], assetId: 'after', sampleCount: buffer.length};
            return 'updated';
        })
    };
    const captureOperation = jest.fn(async (operation, invoke, complete) => {
        const result = await invoke();
        return {operation, result, metadata: complete()};
    });
    attachProjectOperationCapture({vm, shouldCapture: () => true, captureOperation});

    await expect(vm.updateSoundBuffer(0, {length: 250}, new Uint8Array([1]))).resolves.toMatchObject({
        operation: {type: 'sound-edit', previousSound: {assetId: 'before'}},
        metadata: {editedSound: {assetId: 'after', sampleCount: 250}}
    });
    await expect(runStudioProjectOperationSource(vm, {
        kind: 'sound-effect',
        effect: 'faster'
    }, () => vm.updateSoundBuffer(0, {length: 125}, new Uint8Array([2])))).resolves.toMatchObject({
        operation: {type: 'sound-edit', soundEffect: 'faster', previousSound: {assetId: 'after'}},
        metadata: {editedSound: {assetId: 'after', sampleCount: 125}}
    });
    expect(vm.updateSoundBuffer(0, {length: 500}, null)).toBe('updated');
    expect(captureOperation).toHaveBeenCalledTimes(2);
});

test('captures sound sharing against the destination target', async () => {
    const sourceSounds = [{assetId: 'pop', dataFormat: 'wav', name: 'Pop', rate: 48000, sampleCount: 100}];
    const destinationSounds = [];
    const source = makeTarget('sprite-a', 'Sprite1');
    const destination = makeTarget('sprite-b', 'Sprite2');
    source.getSounds = () => sourceSounds;
    source.sprite = {name: 'Sprite1', sounds: sourceSounds};
    destination.getSounds = () => destinationSounds;
    destination.sprite = {name: 'Sprite2', sounds: destinationSounds};
    const targets = new Map([[source.id, source], [destination.id, destination]]);
    const vm = {
        editingTarget: source,
        runtime: {getTargetById: id => targets.get(id) || null},
        shareSoundToTarget: jest.fn(async (index, targetId) => {
            destinationSounds.push({...sourceSounds[index]});
            return targetId;
        })
    };
    const captureOperation = async (operation, invoke, complete) => {
        const result = await invoke();
        return {operation, metadata: complete(result)};
    };
    attachProjectOperationCapture({vm, shouldCapture: () => true, captureOperation});

    await expect(vm.shareSoundToTarget(0, 'sprite-b')).resolves.toMatchObject({
        operation: {
            type: 'sound-share',
            sourceTargetRef: {name: 'Sprite1'},
            targetRef: {name: 'Sprite2'},
            sourceSound: {name: 'Pop'}
        },
        metadata: {addedSound: {name: 'Pop'}}
    });
});

test('bypasses capture while paused and does not clobber a later wrapper on detach', async () => {
    const original = jest.fn(async () => 'original');
    const vm = {runtime: {targets: []}, addSprite: original};
    const captureOperation = jest.fn();
    const port = attachProjectOperationCapture({
        vm,
        shouldCapture: () => false,
        captureOperation
    });

    await expect(vm.addSprite('sprite-json')).resolves.toBe('original');
    expect(captureOperation).not.toHaveBeenCalled();
    const laterWrapper = jest.fn();
    vm.addSprite = laterWrapper;
    port.detach();
    expect(vm.addSprite).toBe(laterWrapper);
});

test('does not create a project transaction for an unchanged sprite name', () => {
    const target = makeTarget('sprite-a', 'Sprite1');
    const original = jest.fn();
    const vm = {
        runtime: {getTargetById: () => target},
        renameSprite: original
    };
    const captureOperation = jest.fn();
    attachProjectOperationCapture({vm, shouldCapture: () => true, captureOperation});

    expect(vm.renameSprite('sprite-a', 'Sprite1')).toBeUndefined();
    expect(original).toHaveBeenCalledWith('sprite-a', 'Sprite1');
    expect(captureOperation).not.toHaveBeenCalled();
});
