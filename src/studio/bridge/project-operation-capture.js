import {normalizePaintBrushStyle} from './paint-brush-style';

const targetName = target => (target.getName ? target.getName() :
    (target.sprite && target.sprite.name) || target.id);

const projectOperationSources = new WeakMap();

const capturedPaintGesture = (source, editFormat) => {
    const gesture = source && source.kind === 'paint-brush-stroke' && source.gesture;
    if (!gesture || gesture.tool !== 'brush' || !Array.isArray(gesture.points) ||
        gesture.points.length < 2 || gesture.points.length > 600) return null;
    let previousTime = -1;
    const points = [];
    for (const point of gesture.points) {
        if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y) ||
            !Number.isFinite(point.t) || point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1 ||
            point.t < previousTime || point.t > 10000) return null;
        previousTime = point.t;
        points.push({x: point.x, y: point.y, t: point.t});
    }
    const brushStyle = normalizePaintBrushStyle(gesture.brushStyle, editFormat);
    return {
        tool: 'brush',
        durationMs: points[points.length - 1].t,
        points,
        ...(brushStyle ? {brushStyle} : {})
    };
};

const runStudioProjectOperationSource = (vm, source, mutate) => {
    if (!vm) return mutate();
    const previous = projectOperationSources.get(vm);
    projectOperationSources.set(vm, source);
    try {
        return mutate();
    } finally {
        if (previous) projectOperationSources.set(vm, previous);
        else projectOperationSources.delete(vm);
    }
};

const targetReference = target => ({
    isStage: Boolean(target.isStage),
    name: targetName(target)
});

const costumeReference = costume => costume && ({
    assetId: costume.assetId,
    dataFormat: costume.dataFormat,
    name: costume.name
});

const soundReference = sound => sound && ({
    assetId: sound.assetId,
    dataFormat: sound.dataFormat,
    name: sound.name,
    rate: sound.rate,
    sampleCount: sound.sampleCount
});

const soundsOf = target => target && (typeof target.getSounds === 'function' ?
    target.getSounds() : target.sprite && target.sprite.sounds);

const serializedBlocks = payload => (payload && Array.isArray(payload.blocks) ? payload.blocks : payload);

const sharedBlockRoot = payload => {
    const blocks = serializedBlocks(payload);
    return (Array.isArray(blocks) && blocks.find(block => block && block.topLevel)) || null;
};

const targetBlockCount = target => (
    target && target.blocks && target.blocks._blocks ? Object.keys(target.blocks._blocks).length : null
);

const sourceBlockReference = (target, root) => {
    const blocks = target && target.blocks;
    let source = blocks && typeof blocks.getBlock === 'function' && blocks.getBlock(root && root.id);
    if (!source) return null;
    const path = [];
    const visited = new Set();
    while (source.parent) {
        if (visited.has(source.id)) return null;
        visited.add(source.id);
        const parent = blocks.getBlock(source.parent);
        if (!parent) return null;
        if (parent.next === source.id) {
            path.unshift({kind: 'next'});
        } else {
            let inputName = null;
            for (const name of Object.keys(parent.inputs || {})) {
                const input = parent.inputs[name];
                if (input && (input.block === source.id || input === source.id)) {
                    inputName = name;
                    break;
                }
            }
            if (!inputName) return null;
            path.unshift({kind: 'input', name: inputName});
        }
        source = parent;
    }
    return {
        ancestorId: source.id,
        ancestorType: source.opcode,
        ancestorCoordinate: Number.isFinite(source.x) && Number.isFinite(source.y) ?
            {x: Math.round(source.x), y: Math.round(source.y)} : null,
        path
    };
};

const libraryItemReference = (name, md5ext) => (
    typeof name === 'string' && typeof md5ext === 'string' ? {name, md5ext} : null
);

const spriteLibraryItemReference = spriteJson => {
    if (typeof spriteJson !== 'string') return null;
    try {
        const sprite = JSON.parse(spriteJson);
        const costume = sprite && Array.isArray(sprite.costumes) && sprite.costumes[0];
        return libraryItemReference(
            sprite && sprite.name,
            costume && (costume.md5ext || costume.baseLayerMD5)
        );
    } catch (error) {
        return null;
    }
};

/**
 * Capture the VM operations which are not represented by Blockly events.
 * Wrappers retain each original method's return value and are restored on
 * detach. Checkpoint creation and journal ownership stay in the session.
 *
 * @param {object} options capture dependencies
 * @param {object} options.vm Scratch VM
 * @param {Function} options.shouldCapture whether author operations are accepted
 * @param {Function} options.captureOperation checkpoint-backed operation capture
 * @returns {object} detachable capture port
 */
const attachProjectOperationCapture = ({vm, shouldCapture, captureOperation, dragSourceReference = () => null}) => {
    const originals = new Map();
    const wrappers = new Map();
    let activeCapture = null;
    let activeCaptureAllowsNestedCall = null;
    let captureInvokeDepth = 0;

    const invokeAndWaitForTargetsUpdate = (invoke, isSettled, description) => {
        const addListener = vm.on || vm.addListener;
        const removeListener = vm.off || vm.removeListener;
        if (typeof addListener !== 'function' || typeof removeListener !== 'function') {
            throw new Error(`Studio cannot observe ${description} completion`);
        }
        return new Promise((resolve, reject) => {
            let invoked = false;
            let result;
            let timeout = null;
            let finished = false;
            let targetsUpdated = false;
            let handleTargetsUpdate = () => {};
            const cleanup = () => {
                removeListener.call(vm, 'targetsUpdate', handleTargetsUpdate);
                if (timeout !== null) clearTimeout(timeout);
            };
            const finish = () => {
                if (finished || !invoked) return;
                let settled;
                try {
                    settled = isSettled(targetsUpdated);
                } catch (error) {
                    finished = true;
                    cleanup();
                    reject(error);
                    return;
                }
                if (!settled) return;
                finished = true;
                cleanup();
                Promise.resolve(result).then(resolve, reject);
            };
            handleTargetsUpdate = () => {
                targetsUpdated = true;
                finish();
            };
            addListener.call(vm, 'targetsUpdate', handleTargetsUpdate);
            try {
                result = invoke();
                invoked = true;
                finish();
            } catch (error) {
                invoked = true;
                finished = true;
                cleanup();
                reject(error);
                return;
            }
            if (finished) return;
            Promise.resolve(result).catch(error => {
                if (finished) return;
                finished = true;
                cleanup();
                reject(error);
            });
            timeout = setTimeout(() => {
                if (finished) return;
                finished = true;
                cleanup();
                reject(new Error(`Studio timed out waiting for ${description}`));
            }, 5000);
        });
    };

    const wrap = (name, createCapture) => {
        if (typeof vm[name] !== 'function') return;
        const original = vm[name];
        originals.set(name, original);
        const wrapper = (...args) => {
            if (!shouldCapture()) {
                // Project-operation checkpoints are asynchronous, but paint and
                // sound editors do not await their VM callbacks. Serialize a
                // genuinely separate author action behind the active capture so
                // it cannot mutate the first operation's before/after boundary.
                // A VM method delegated synchronously by the captured operation
                // remains part of that one operation and must not deadlock on it.
                if (activeCapture && captureInvokeDepth === 0) {
                    if (activeCaptureAllowsNestedCall && activeCaptureAllowsNestedCall(name, args)) {
                        return original.apply(vm, args);
                    }
                    return activeCapture.then(() => (
                        vm[name] === wrapper ? wrapper(...args) : original.apply(vm, args)
                    ));
                }
                return original.apply(vm, args);
            }
            const capture = createCapture(args);
            if (!capture) return original.apply(vm, args);
            const invoke = () => {
                captureInvokeDepth++;
                try {
                    const invokeOriginal = () => original.apply(vm, args);
                    return capture.invoke ? capture.invoke(invokeOriginal) : invokeOriginal();
                } finally {
                    captureInvokeDepth--;
                }
            };
            activeCaptureAllowsNestedCall = capture.allowsNestedCall || null;
            let result;
            try {
                result = captureOperation(capture.operation, invoke, capture.complete);
            } catch (error) {
                activeCaptureAllowsNestedCall = null;
                throw error;
            }
            if (!result || typeof result.then !== 'function') {
                activeCaptureAllowsNestedCall = null;
                return result;
            }
            const tracked = Promise.resolve(result).finally(() => {
                if (activeCapture === tracked) {
                    activeCapture = null;
                    activeCaptureAllowsNestedCall = null;
                }
            });
            activeCapture = tracked;
            return tracked;
        };
        wrappers.set(name, wrapper);
        vm[name] = wrapper;
    };

    wrap('addSprite', args => {
        const beforeIds = new Set(vm.runtime.targets.map(target => target.id));
        const libraryItem = spriteLibraryItemReference(args[0]);
        return {
            operation: {
                type: 'sprite-create',
                ...(libraryItem ? {libraryItem} : {})
            },
            allowsNestedCall: (name, nestedArgs) => name === 'renameSprite' &&
                !beforeIds.has(nestedArgs[0]),
            complete: () => {
                const created = vm.runtime.targets.filter(target => target.isOriginal && !beforeIds.has(target.id));
                if (created.length !== 1) {
                    throw new Error(`Studio expected one created sprite, found ${created.length}`);
                }
                return {
                    targetId: created[0].id,
                    targetRef: targetReference(created[0])
                };
            }
        };
    });

    wrap('duplicateSprite', args => {
        const [sourceTargetId] = args;
        const source = vm.runtime.getTargetById(sourceTargetId);
        const beforeIds = new Set(vm.runtime.targets.map(target => target.id));
        return {
            operation: {
                type: 'sprite-duplicate',
                sourceTargetId,
                sourceTargetRef: source && targetReference(source)
            },
            complete: () => {
                const created = vm.runtime.targets.filter(target =>
                    target.isOriginal && !beforeIds.has(target.id));
                if (created.length !== 1) {
                    throw new Error(`Studio expected one duplicated sprite, found ${created.length}`);
                }
                return {
                    targetId: created[0].id,
                    targetRef: targetReference(created[0])
                };
            }
        };
    });

    wrap('renameSprite', args => {
        const [targetId, requestedName] = args;
        const target = vm.runtime.getTargetById(targetId);
        if (target && (!requestedName || targetName(target) === requestedName)) return null;
        return {
            operation: {
                type: 'sprite-rename',
                targetId,
                targetRef: target && targetReference(target),
                oldName: target && targetName(target),
                requestedName
            },
            complete: () => {
                const renamed = vm.runtime.getTargetById(targetId);
                if (!renamed) throw new Error('Studio could not identify the renamed sprite');
                return {
                    newName: targetName(renamed),
                    renamedTargetRef: targetReference(renamed)
                };
            }
        };
    });

    wrap('deleteSprite', args => {
        const [targetId] = args;
        const target = vm.runtime.getTargetById(targetId);
        return {
            operation: {
                type: 'sprite-delete',
                targetId,
                targetRef: target && targetReference(target)
            },
            complete: () => {
                if (vm.runtime.getTargetById(targetId)) {
                    throw new Error('Studio expected the deleted sprite to leave the runtime');
                }
                return {deletedTargetRef: target && targetReference(target)};
            }
        };
    });

    wrap('reorderTarget', args => {
        const [requestedIndex, requestedNewIndex] = args;
        const targets = vm.runtime.targets || [];
        if (!Number.isFinite(Number(requestedIndex)) || !Number.isFinite(Number(requestedNewIndex))) return null;
        const clampIndex = value => Math.max(0, Math.min(Number(value), targets.length - 1));
        const targetIndex = clampIndex(requestedIndex);
        const newIndex = clampIndex(requestedNewIndex);
        const target = Number.isFinite(targetIndex) && targets[targetIndex];
        if (!target || targetIndex === newIndex) return null;
        return {
            operation: {
                type: 'sprite-reorder',
                targetId: target.id,
                targetRef: targetReference(target),
                targetIndex,
                newIndex
            },
            complete: reordered => {
                if (!reordered || vm.runtime.targets[newIndex] !== target) {
                    throw new Error('Studio expected the sprite target to move to its requested index');
                }
                return {movedTargetRef: targetReference(target)};
            }
        };
    });

    wrap('shareBlocksToTarget', args => {
        const [payload, targetId, sourceTargetId, sourceBlockId] = args;
        const target = vm.runtime.getTargetById(targetId);
        const source = sourceTargetId && vm.runtime.getTargetById(sourceTargetId);
        const root = sharedBlockRoot(payload);
        const blocks = serializedBlocks(payload);
        if (!target || !root || !Array.isArray(blocks)) return null;
        const beforeBlockCount = targetBlockCount(target);
        const blockRef = dragSourceReference(sourceBlockId) ||
            sourceBlockReference(source, sourceBlockId ? {id: sourceBlockId} : root);
        const operationSource = projectOperationSources.get(vm);
        const importSource = operationSource && operationSource.kind === 'backpack-script' &&
            operationSource.item && operationSource.item.type === 'script' ? operationSource.item : null;
        return {
            operation: {
                type: source && source.id !== target.id ? 'block-share' : 'block-import',
                targetId,
                targetRef: targetReference(target),
                ...(source ? {
                    sourceTargetId: source.id,
                    sourceTargetRef: targetReference(source)
                } : {}),
                sourceRoot: {
                    opcode: root.opcode,
                    blockCount: blocks.length,
                    ...(blockRef ? {blockRef} : {})
                },
                ...(importSource ? {importSource: {kind: 'backpack', ...importSource}} : {}),
                ...(importSource && Number.isFinite(root.x) && Number.isFinite(root.y) ? {
                    destinationCoordinate: {x: root.x, y: root.y}
                } : {})
            },
            complete: () => {
                const currentTarget = vm.runtime.getTargetById(targetId);
                const afterBlockCount = targetBlockCount(currentTarget);
                if (beforeBlockCount !== null && afterBlockCount !== beforeBlockCount + blocks.length) {
                    throw new Error('Studio could not identify every copied block on the target');
                }
                return {
                    copiedBlockCount: blocks.length,
                    copiedRootOpcode: root.opcode
                };
            }
        };
    });

    wrap('addCostumeFromLibrary', args => {
        const [md5ext, costume, targetId] = args;
        const target = targetId ? vm.runtime.getTargetById(targetId) : vm.editingTarget;
        const targetCostumeCount = target ? target.getCostumes().length : 0;
        return {
            operation: {
                type: 'costume-library-add',
                targetId: target && target.id,
                targetRef: target && targetReference(target),
                libraryItem: libraryItemReference(costume && costume.name, md5ext)
            },
            complete: () => {
                const currentTarget = targetId ? vm.runtime.getTargetById(targetId) : vm.editingTarget;
                const added = currentTarget && currentTarget.getCostumes()[targetCostumeCount];
                if (!added) throw new Error('Studio could not identify the library costume');
                return {addedCostume: costumeReference(added)};
            }
        };
    });

    wrap('addCostume', args => {
        const [md5ext, costume, targetId] = args;
        const target = targetId ? vm.runtime.getTargetById(targetId) : vm.editingTarget;
        const costumes = target && target.getCostumes();
        const source = projectOperationSources.get(vm);
        const uploadFile = source && source.kind === 'costume-upload' &&
            typeof source.fileName === 'string' ? {name: source.fileName} : null;
        const createdWith = source && source.kind === 'costume-paint' ? 'paint' : null;
        if (!target || !costumes) return null;
        const beforeCount = costumes.length;
        return {
            operation: {
                type: target.isStage ? 'backdrop-add' : 'costume-add',
                targetId: target.id,
                targetRef: targetReference(target),
                sourceItem: libraryItemReference(costume && costume.name, md5ext),
                ...(uploadFile ? {uploadFile} : {}),
                ...(createdWith ? {createdWith} : {})
            },
            complete: () => {
                const current = vm.runtime.getTargetById(target.id);
                const currentCostumes = current && current.getCostumes();
                if (!currentCostumes || currentCostumes.length !== beforeCount + 1) {
                    throw new Error('Studio could not identify the added costume');
                }
                return {addedCostume: costumeReference(currentCostumes[beforeCount])};
            }
        };
    });

    wrap('addBackdrop', args => {
        const [md5ext, backdrop] = args;
        const stage = vm.runtime.getTargetForStage();
        const beforeCount = stage ? stage.getCostumes().length : 0;
        const source = projectOperationSources.get(vm);
        const uploadFile = source && source.kind === 'costume-upload' &&
            typeof source.fileName === 'string' ? {name: source.fileName} : null;
        const createdWith = source && source.kind === 'costume-paint' ? 'paint' : null;
        if (!stage) return null;
        return {
            operation: {
                type: uploadFile || createdWith ? 'backdrop-add' : 'backdrop-library-add',
                targetId: stage.id,
                targetRef: targetReference(stage),
                ...(uploadFile || createdWith ? {
                    sourceItem: libraryItemReference(backdrop && backdrop.name, md5ext),
                    ...(uploadFile ? {uploadFile} : {}),
                    ...(createdWith ? {createdWith} : {})
                } : {libraryItem: libraryItemReference(backdrop && backdrop.name, md5ext)})
            },
            complete: () => {
                const currentStage = vm.runtime.getTargetForStage();
                const added = currentStage && currentStage.getCostumes()[beforeCount];
                if (!added) throw new Error('Studio could not identify the library backdrop');
                return uploadFile || createdWith ?
                    {addedCostume: costumeReference(added)} : {addedBackdrop: costumeReference(added)};
            }
        };
    });

    wrap('shareCostumeToTarget', args => {
        const [costumeIndex, targetId] = args;
        const source = vm.editingTarget;
        const target = vm.runtime.getTargetById(targetId);
        const costume = source && source.getCostumes()[costumeIndex];
        const targetCostumeCount = target ? target.getCostumes().length : 0;
        return {
            operation: {
                type: target && target.isStage ? 'backdrop-share' : 'costume-share',
                sourceTargetRef: source && targetReference(source),
                targetId,
                targetRef: target && targetReference(target),
                sourceCostume: costumeReference(costume)
            },
            complete: () => {
                const currentTarget = vm.runtime.getTargetById(targetId);
                const shared = currentTarget && currentTarget.getCostumes()[targetCostumeCount];
                if (!shared) throw new Error('Studio could not identify the shared costume');
                return {sharedCostume: costumeReference(shared)};
            }
        };
    });

    wrap('duplicateCostume', args => {
        const [costumeIndex] = args;
        const target = vm.editingTarget;
        const costumes = target && target.getCostumes();
        const sourceCostume = costumes && costumes[costumeIndex];
        if (!target || !sourceCostume) return null;
        const beforeCount = costumes.length;
        return {
            operation: {
                type: target.isStage ? 'backdrop-duplicate' : 'costume-duplicate',
                targetId: target.id,
                targetRef: targetReference(target),
                costumeIndex,
                sourceCostume: costumeReference(sourceCostume)
            },
            complete: () => {
                const current = vm.runtime.getTargetById(target.id);
                const currentCostumes = current && current.getCostumes();
                if (!currentCostumes || currentCostumes.length !== beforeCount + 1) {
                    throw new Error('Studio could not identify the duplicated costume');
                }
                return {addedCostume: costumeReference(currentCostumes[costumeIndex + 1])};
            }
        };
    });

    wrap('renameCostume', args => {
        const [costumeIndex, requestedName] = args;
        const target = vm.editingTarget;
        const costume = target && target.getCostumes()[costumeIndex];
        if (!target || !costume || !requestedName || costume.name === requestedName) return null;
        return {
            operation: {
                type: target.isStage ? 'backdrop-rename' : 'costume-rename',
                targetId: target.id,
                targetRef: targetReference(target),
                costumeIndex,
                oldCostume: costumeReference(costume),
                requestedName
            },
            complete: () => {
                const current = vm.runtime.getTargetById(target.id);
                const renamed = current && current.getCostumes()[costumeIndex];
                if (!renamed) throw new Error('Studio could not identify the renamed costume');
                return {renamedCostume: costumeReference(renamed)};
            }
        };
    });

    wrap('deleteCostume', args => {
        const [costumeIndex] = args;
        const target = vm.editingTarget;
        const costumes = target && target.getCostumes();
        const costume = costumes && costumes[costumeIndex];
        if (!target || !costume || costumes.length <= 1) return null;
        const beforeCount = costumes.length;
        return {
            operation: {
                type: target.isStage ? 'backdrop-delete' : 'costume-delete',
                targetId: target.id,
                targetRef: targetReference(target),
                costumeIndex,
                deletedCostume: costumeReference(costume)
            },
            complete: () => {
                const current = vm.runtime.getTargetById(target.id);
                const currentCostumes = current && current.getCostumes();
                if (!currentCostumes || currentCostumes.length !== beforeCount - 1) {
                    throw new Error('Studio expected one deleted costume');
                }
                return {};
            }
        };
    });

    wrap('reorderCostume', args => {
        const [targetId, costumeIndex, newIndex] = args;
        const target = vm.runtime.getTargetById(targetId);
        const costumes = target && target.getCostumes();
        if (!target || !costumes || !costumes[costumeIndex] || costumeIndex === newIndex) return null;
        return {
            operation: {
                type: target.isStage ? 'backdrop-reorder' : 'costume-reorder',
                targetId,
                targetRef: targetReference(target),
                costumeIndex,
                newIndex,
                movedCostume: costumeReference(costumes[costumeIndex])
            },
            complete: result => ({reordered: Boolean(result)})
        };
    });

    wrap('updateSvg', args => {
        const [costumeIndex] = args;
        const target = vm.editingTarget;
        const costumes = target && target.getCostumes();
        const costume = costumes && costumes[costumeIndex];
        if (!target || !costume) return null;
        const paintGesture = capturedPaintGesture(projectOperationSources.get(vm), 'svg');
        return {
            operation: {
                type: target.isStage ? 'backdrop-edit' : 'costume-edit',
                targetId: target.id,
                targetRef: targetReference(target),
                costumeIndex,
                editFormat: 'svg',
                previousCostume: costumeReference(costume),
                ...(paintGesture ? {paintGesture} : {})
            },
            complete: () => {
                const current = vm.runtime.getTargetById(target.id);
                const edited = current && current.getCostumes()[costumeIndex];
                if (!edited) throw new Error('Studio could not identify the edited costume');
                return {editedCostume: costumeReference(edited)};
            }
        };
    });

    wrap('updateBitmap', args => {
        const [costumeIndex] = args;
        const target = vm.editingTarget;
        const costumes = target && target.getCostumes();
        const costume = costumes && costumes[costumeIndex];
        if (!target || !costume) return null;
        const previousCostume = costumeReference(costume);
        const paintGesture = capturedPaintGesture(projectOperationSources.get(vm), 'bitmap');
        return {
            operation: {
                type: target.isStage ? 'backdrop-edit' : 'costume-edit',
                targetId: target.id,
                targetRef: targetReference(target),
                costumeIndex,
                editFormat: 'bitmap',
                previousCostume,
                ...(paintGesture ? {paintGesture} : {})
            },
            invoke: invoke => invokeAndWaitForTargetsUpdate(invoke, targetsUpdated => {
                const current = vm.runtime.getTargetById(target.id);
                const edited = current && current.getCostumes()[costumeIndex];
                return targetsUpdated || Boolean(edited && (
                    edited.assetId !== previousCostume.assetId ||
                    edited.dataFormat !== previousCostume.dataFormat
                ));
            }, 'bitmap asset update'),
            complete: () => {
                const current = vm.runtime.getTargetById(target.id);
                const edited = current && current.getCostumes()[costumeIndex];
                if (!edited) throw new Error('Studio could not identify the edited bitmap costume');
                return {editedCostume: costumeReference(edited)};
            }
        };
    });

    wrap('addSound', args => {
        const [sound, targetId] = args;
        const target = targetId ? vm.runtime.getTargetById(targetId) : vm.editingTarget;
        const sounds = soundsOf(target);
        const source = projectOperationSources.get(vm);
        const libraryItem = source && source.kind === 'sound-library' ? source.libraryItem : null;
        const uploadFile = source && source.kind === 'sound-upload' &&
            typeof source.fileName === 'string' ? {name: source.fileName} : null;
        if (!target || !sounds) return null;
        const beforeCount = sounds.length;
        return {
            operation: {
                type: 'sound-add',
                targetId: target.id,
                targetRef: targetReference(target),
                sourceSound: soundReference(sound),
                ...(libraryItem ? {libraryItem} : {}),
                ...(uploadFile ? {uploadFile} : {})
            },
            complete: () => {
                const current = vm.runtime.getTargetById(target.id);
                const currentSounds = soundsOf(current);
                if (!currentSounds || currentSounds.length !== beforeCount + 1) {
                    throw new Error('Studio could not identify the added sound');
                }
                return {addedSound: soundReference(currentSounds[beforeCount])};
            }
        };
    });

    wrap('shareSoundToTarget', args => {
        const [soundIndex, targetId] = args;
        const source = vm.editingTarget;
        const target = vm.runtime.getTargetById(targetId);
        const sourceSound = soundsOf(source) && soundsOf(source)[soundIndex];
        const targetSounds = soundsOf(target);
        if (!source || !target || !sourceSound || !targetSounds) return null;
        const beforeCount = targetSounds.length;
        return {
            operation: {
                type: 'sound-share',
                sourceTargetRef: targetReference(source),
                targetId,
                targetRef: targetReference(target),
                sourceSound: soundReference(sourceSound)
            },
            complete: () => {
                const currentSounds = soundsOf(vm.runtime.getTargetById(targetId));
                if (!currentSounds || currentSounds.length !== beforeCount + 1) {
                    throw new Error('Studio could not identify the shared sound');
                }
                return {addedSound: soundReference(currentSounds[beforeCount])};
            }
        };
    });

    wrap('duplicateSound', args => {
        const [soundIndex] = args;
        const target = vm.editingTarget;
        const sounds = soundsOf(target);
        const sourceSound = sounds && sounds[soundIndex];
        if (!target || !sourceSound) return null;
        const beforeCount = sounds.length;
        return {
            operation: {
                type: 'sound-duplicate',
                targetId: target.id,
                targetRef: targetReference(target),
                soundIndex,
                sourceSound: soundReference(sourceSound)
            },
            complete: () => {
                const currentSounds = soundsOf(vm.runtime.getTargetById(target.id));
                if (!currentSounds || currentSounds.length !== beforeCount + 1) {
                    throw new Error('Studio could not identify the duplicated sound');
                }
                return {addedSound: soundReference(currentSounds[soundIndex + 1])};
            }
        };
    });

    wrap('renameSound', args => {
        const [soundIndex, requestedName] = args;
        const target = vm.editingTarget;
        const sound = soundsOf(target) && soundsOf(target)[soundIndex];
        if (!target || !sound || !requestedName || sound.name === requestedName) return null;
        return {
            operation: {
                type: 'sound-rename',
                targetId: target.id,
                targetRef: targetReference(target),
                soundIndex,
                oldSound: soundReference(sound),
                requestedName
            },
            complete: () => {
                const currentSounds = soundsOf(vm.runtime.getTargetById(target.id));
                const renamed = currentSounds && currentSounds[soundIndex];
                if (!renamed) throw new Error('Studio could not identify the renamed sound');
                return {renamedSound: soundReference(renamed)};
            }
        };
    });

    wrap('deleteSound', args => {
        const [soundIndex] = args;
        const target = vm.editingTarget;
        const sounds = soundsOf(target);
        const sound = sounds && sounds[soundIndex];
        if (!target || !sound) return null;
        const beforeCount = sounds.length;
        return {
            operation: {
                type: 'sound-delete',
                targetId: target.id,
                targetRef: targetReference(target),
                soundIndex,
                deletedSound: soundReference(sound)
            },
            complete: () => {
                const currentSounds = soundsOf(vm.runtime.getTargetById(target.id));
                if (!currentSounds || currentSounds.length !== beforeCount - 1) {
                    throw new Error('Studio expected one deleted sound');
                }
                return {};
            }
        };
    });

    wrap('reorderSound', args => {
        const [targetId, soundIndex, newIndex] = args;
        const target = vm.runtime.getTargetById(targetId);
        const sounds = soundsOf(target);
        if (!target || !sounds || !sounds[soundIndex] || soundIndex === newIndex) return null;
        return {
            operation: {
                type: 'sound-reorder',
                targetId,
                targetRef: targetReference(target),
                soundIndex,
                newIndex,
                movedSound: soundReference(sounds[soundIndex])
            },
            complete: result => ({reordered: Boolean(result)})
        };
    });

    wrap('updateSoundBuffer', args => {
        const [soundIndex, , soundEncoding] = args;
        const target = vm.editingTarget;
        const sounds = soundsOf(target);
        const sound = sounds && sounds[soundIndex];
        const source = projectOperationSources.get(vm);
        const soundEffect = source && source.kind === 'sound-effect' ? source.effect : null;
        // A null encoding is Scratch GUI's failure path: it updates only the
        // transient audio-engine buffer and deliberately stores no project data.
        if (!target || !sound || !soundEncoding) return null;
        return {
            operation: {
                type: 'sound-edit',
                targetId: target.id,
                targetRef: targetReference(target),
                soundIndex,
                previousSound: soundReference(sound),
                ...(soundEffect ? {soundEffect} : {})
            },
            complete: () => {
                const currentSounds = soundsOf(vm.runtime.getTargetById(target.id));
                const edited = currentSounds && currentSounds[soundIndex];
                if (!edited) throw new Error('Studio could not identify the edited sound');
                return {editedSound: soundReference(edited)};
            }
        };
    });

    return {
        detach: () => originals.forEach((original, name) => {
            if (vm[name] === wrappers.get(name)) vm[name] = original;
        })
    };
};

export {
    attachProjectOperationCapture,
    costumeReference,
    libraryItemReference,
    runStudioProjectOperationSource,
    soundReference,
    spriteLibraryItemReference,
    targetReference
};
