import {
    createScratchBlocksDragDriver,
    enclosingConnections,
    resolvePlan,
    resolveSettledDestinations
} from '../../src/studio/bridge/native-interaction/scratch-blocks-drag-driver';

test.each(['SUBSTACK', 'SUBSTACK2'])('wraps using the recorded %s connection, not the outer notch', inputName => {
    const target = {};
    const source = {checkType_: candidate => candidate === target};
    const child = {id: 'live-child', type: 'control_wait', previousConnection: target};
    const parent = {id: 'live-parent', getNextBlock: () => child};
    const workspace = {getBlockById: id => [parent, child].find(block => block.id === id)};
    const block = {getInput: name => (name === inputName ? {connection: source} : null)};
    const destination = {parentId: 'old-parent', inputName: null};
    const occupant = {blockId: 'old-child',
        blockType: child.type,
        source: destination,
        destination: {parentId: 'wrapper', inputName}};
    const plan = {blockId: 'wrapper', destination, affectedBlocks: [occupant]};
    const aliases = new Map([['old-parent', parent.id]]);
    expect(enclosingConnections(workspace, block, plan, aliases)).toEqual({source, target});
    // Appending a tail or moving a child from a different socket is not a wrap.
    expect(enclosingConnections(workspace, block, {...plan,
        affectedBlocks: [{...occupant, destination: {parentId: 'wrapper', inputName: null}}]}, aliases)).toBeNull();
    expect(enclosingConnections(workspace, block, {...plan,
        destination: {...destination, inputName: 'OTHER'}}, aliases)).toBeNull();
});

test('aliases restored input shadows from their settled owning socket and rejects a non-shadow', () => {
    let restored = {id: 'live-shadow', isShadow: () => true};
    const parent = {id: 'live-parent', getInputTargetBlock: name => name === 'NUM1' ? restored : null};
    const workspace = {getBlockById: id => id === parent.id ? parent : null};
    const plan = {destination: {parentId: parent.id}, blockAliases: {'recorded-parent': parent.id},
        createdShadows: [{blockId: 'recorded-shadow',
            destination: {parentId: 'recorded-parent', inputName: 'NUM1'}}]};
    expect(resolveSettledDestinations(workspace, plan).blockAliases).toEqual({
        'recorded-parent': parent.id, 'recorded-shadow': 'live-shadow'
    });
    expect(plan.blockAliases['recorded-shadow']).toBeUndefined();
    restored = {id: 'wrong-reporter', isShadow: () => false};
    expect(() => resolveSettledDestinations(workspace, plan)).toThrow('restored input shadow is missing');
});

test('resolves an induced destination parent after the native drop establishes its final path', () => {
    const tail = {id: 'tail-live', type: 'motion_changexby', getNextBlock: () => null};
    const point = {id: 'point-live', type: 'motion_pointindirection', getNextBlock: () => tail};
    const glide = {id: 'glide-live', type: 'motion_glideto', getNextBlock: () => point};
    const moving = {id: 'moving-live', type: 'motion_movesteps', getNextBlock: () => glide};
    const root = {
        id: 'root-live',
        type: 'motion_changexby',
        getNextBlock: () => moving,
        getRelativeToSurfaceXY: () => ({x: 591, y: 175})
    };
    const blocks = [root, moving, glide, point, tail];
    const workspace = {
        getBlockById: id => blocks.find(block => block.id === id) || null,
        getTopBlocks: () => [root]
    };
    const rootRef = {
        ancestorId: 'recorded-root',
        ancestorType: 'motion_changexby',
        ancestorCoordinate: {x: 591, y: 175},
        path: []
    };
    const settled = resolveSettledDestinations(workspace, {
        blockId: moving.id,
        blockAliases: {
            'recorded-moving': moving.id,
            'recorded-tail': tail.id
        },
        destination: {parentId: root.id},
        affectedBlocks: [{
            blockId: moving.id,
            destination: {parentId: root.id}
        }, {
            blockId: tail.id,
            destination: {
                parentId: 'recorded-point',
                parentRef: {...rootRef, path: [{kind: 'next'}, {kind: 'next'}, {kind: 'next'}]}
            }
        }]
    });

    expect(settled.affectedBlocks[1].destination.parentId).toBe(point.id);
});

test('keeps a pre-resolved destination parent when insertion changes its recorded path', () => {
    const created = {id: 'created-live', type: 'motion_movesteps'};
    const parent = {id: 'parent-live', type: 'motion_movesteps', getNextBlock: () => null};
    const root = {
        id: 'root-live',
        type: 'motion_movesteps',
        getNextBlock: () => created,
        getRelativeToSurfaceXY: () => ({x: 205, y: 285})
    };
    const blocks = [root, created, parent];
    const workspace = {
        getBlockById: id => blocks.find(block => block.id === id) || null,
        getTopBlocks: () => [root]
    };
    const destination = {
        parentId: parent.id,
        inputName: null,
        coordinate: null,
        parentRef: {
            ancestorId: root.id,
            ancestorType: root.type,
            ancestorCoordinate: {x: 205, y: 285},
            path: [{kind: 'next'}]
        }
    };

    const settled = resolveSettledDestinations(workspace, {
        blockId: created.id,
        blockAliases: {'recorded-created': created.id},
        destination,
        affectedBlocks: [{blockId: created.id, destination}]
    });

    expect(settled.destination.parentId).toBe(parent.id);
    expect(settled.affectedBlocks[0].destination.parentId).toBe(parent.id);
});

test('uses one recorded-to-live alias map for every affected parent', () => {
    const root = {
        id: 'b',
        type: 'motion_movesteps',
        getRelativeToSurfaceXY: () => ({x: 131, y: 132})
    };
    const blocks = {
        a: {id: 'a', type: 'motion_turnright'},
        b: root,
        c: {id: 'c', type: 'motion_turnleft'}
    };
    const workspace = {
        getBlockById: id => blocks[id] || null,
        getAllBlocks: () => Object.values(blocks),
        getTopBlocks: () => [root]
    };
    const parentRef = {
        ancestorId: 'recorded-root',
        ancestorType: 'motion_movesteps',
        ancestorCoordinate: {x: 131, y: 132},
        path: []
    };
    const resolved = resolvePlan(workspace, {
        blockId: 'recorded-source',
        blockType: 'motion_turnleft',
        blockRef: null,
        destination: {parentId: 'recorded-root', parentRef},
        affectedBlocks: [{
            blockId: 'recorded-source',
            blockType: 'motion_turnleft',
            source: {parentId: 'recorded-root', parentRef},
            destination: {parentId: 'recorded-root', parentRef}
        }, {
            blockId: 'recorded-displaced',
            blockType: 'motion_turnright',
            source: {parentId: 'recorded-source'},
            destination: {parentId: 'recorded-source'}
        }]
    });

    expect(resolved).toMatchObject({
        blockId: 'c',
        blockAliases: {
            'recorded-source': 'c',
            'recorded-displaced': 'a',
            'recorded-root': 'b'
        },
        destination: {parentId: 'b'},
        affectedBlocks: [
            {blockId: 'c', source: {parentId: 'b'}, destination: {parentId: 'b'}},
            {blockId: 'a', source: {parentId: 'c'}, destination: {parentId: 'c'}}
        ]
    });
});

test('resolves a branched-history block when its recorded ID has been reused', () => {
    const recycled = {id: 'a', type: 'argument_reporter_string_number'};
    const moving = {
        id: 'h',
        type: 'motion_movesteps',
        getRelativeToSurfaceXY: () => ({x: 175, y: 246})
    };
    const workspace = {
        getBlockById: id => ({a: recycled, h: moving}[id] || null),
        getAllBlocks: () => [recycled, moving],
        getTopBlocks: () => [moving]
    };

    const resolved = resolvePlan(workspace, {
        blockId: 'a',
        blockType: 'motion_movesteps',
        blockRef: {
            ancestorId: 'a',
            ancestorType: 'motion_movesteps',
            ancestorCoordinate: {x: 175, y: 246},
            path: []
        },
        source: {parentId: null, inputName: null, coordinate: {x: 175, y: 246}},
        destination: {parentId: null, inputName: null, coordinate: {x: 205, y: 285}},
        affectedBlocks: [{
            blockId: 'a',
            blockType: 'motion_movesteps',
            source: {parentId: null, inputName: null, coordinate: {x: 175, y: 246}},
            destination: {parentId: null, inputName: null, coordinate: {x: 205, y: 285}}
        }]
    });

    expect(resolved).toMatchObject({
        blockId: 'h',
        blockAliases: {a: 'h'},
        affectedBlocks: [{blockId: 'h'}]
    });
});

test('resolves identical regenerated blocks from their source connections', () => {
    const third = {id: 'third-live', type: 'motion_gotoxy', getNextBlock: () => null};
    const displaced = {id: 'displaced-live', type: 'motion_gotoxy', getNextBlock: () => third};
    const moving = {id: 'moving-live', type: 'motion_gotoxy', getNextBlock: () => displaced};
    const root = {
        id: 'root-live',
        type: 'motion_pointtowards',
        getNextBlock: () => moving,
        getRelativeToSurfaceXY: () => ({x: 100, y: 100})
    };
    const blocks = {root, moving, displaced, third};
    const workspace = {
        getBlockById: id => Object.values(blocks).find(block => block.id === id) || null,
        getAllBlocks: () => Object.values(blocks),
        getTopBlocks: () => [root]
    };
    const rootRef = {
        ancestorId: 'root-recorded',
        ancestorType: 'motion_pointtowards',
        ancestorCoordinate: {x: 100, y: 100},
        path: []
    };
    const resolved = resolvePlan(workspace, {
        blockId: 'moving-recorded',
        blockType: 'motion_gotoxy',
        blockRef: {...rootRef, path: [{kind: 'next'}]},
        source: {parentId: 'root-recorded', parentRef: rootRef},
        destination: {parentId: 'root-recorded', parentRef: rootRef},
        affectedBlocks: [{
            blockId: 'moving-recorded',
            blockType: 'motion_gotoxy',
            source: {parentId: 'root-recorded', parentRef: rootRef},
            destination: {parentId: 'root-recorded', parentRef: rootRef}
        }, {
            blockId: 'displaced-recorded',
            blockType: 'motion_gotoxy',
            source: {parentId: 'moving-recorded'},
            destination: {parentId: 'moving-recorded'}
        }]
    });

    expect(resolved).toMatchObject({
        blockId: 'moving-live',
        affectedBlocks: [
            {blockId: 'moving-live', destination: {parentId: 'root-live'}},
            {blockId: 'displaced-live', destination: {parentId: 'moving-live'}}
        ]
    });
});

test('resolves a nested destination through the source stack as it will look after pickup', () => {
    const inputConnection = target => ({targetBlock: () => target});
    const nested = {id: 'nested-live', type: 'motion_goto', getNextBlock: () => null};
    const control = {
        id: 'control-live',
        type: 'control_if_else',
        getInput: name => (name === 'SUBSTACK' ? {connection: inputConnection(nested)} : null),
        getNextBlock: () => null
    };
    const tail = {id: 'tail-live', type: 'motion_glideto', getNextBlock: () => control};
    const moving = {id: 'moving-live', type: 'motion_goto', getNextBlock: () => tail};
    const root = {
        id: 'root-live',
        type: 'motion_goto',
        getNextBlock: () => moving,
        getRelativeToSurfaceXY: () => ({x: 209, y: 133})
    };
    const blocks = [root, moving, tail, control, nested];
    const workspace = {
        getBlockById: id => blocks.find(block => block.id === id) || null,
        getAllBlocks: () => blocks,
        getTopBlocks: () => [root]
    };
    const rootRef = {
        ancestorId: 'root-recorded',
        ancestorType: 'motion_goto',
        ancestorCoordinate: {x: 209, y: 133},
        path: []
    };
    const source = {parentId: 'root-recorded', inputName: null, parentRef: rootRef};
    const destination = {
        parentId: 'control-recorded',
        inputName: 'SUBSTACK',
        parentRef: {...rootRef, path: [{kind: 'next'}, {kind: 'next'}]}
    };

    const resolved = resolvePlan(workspace, {
        blockId: 'moving-recorded',
        blockType: 'motion_goto',
        blockRef: {...rootRef, path: [{kind: 'next'}, {kind: 'next'}, {kind: 'input', name: 'SUBSTACK'}]},
        source,
        destination,
        affectedBlocks: [{
            blockId: 'moving-recorded',
            blockType: 'motion_goto',
            source,
            destination
        }, {
            blockId: 'tail-recorded',
            blockType: 'motion_glideto',
            source: {parentId: 'moving-recorded', inputName: null},
            destination: source
        }]
    });

    expect(resolved).toMatchObject({
        blockId: moving.id,
        destination: {parentId: control.id, inputName: 'SUBSTACK'},
        affectedBlocks: [
            {blockId: moving.id, destination: {parentId: control.id, inputName: 'SUBSTACK'}},
            {blockId: tail.id, destination: {parentId: root.id}}
        ]
    });
});

test('feeds the overlay and genuine gesture identical coordinates and observes its marker', async () => {
    const calls = [];
    const snapRadii = [];
    const ScratchBlocks = {SNAP_RADIUS: 48, CONNECTING_SNAP_RADIUS: 68};
    const manager = {
        markerConnection_: null,
        highlightingBlock_: false,
        update: () => {
            manager.markerConnection_ = null;
            parent.nextConnection.y_ = 70;
        }
    };
    const gesture = {
        setConnectionPreviewTarget: target => {
            gesture.previewTarget = target;
            if (target === null) manager.update();
        },
        getConnectionPreview: () => ({
            visible: Boolean(manager.markerConnection_), targetConnection: gesture.previewTarget
        }),
        blockDragger_: {draggedConnectionManager_: manager},
        forceStartBlockDrag: (event, block) => {
            calls.push(['start', event.clientX, event.clientY, block.id]);
            // Blockly's insertion marker temporarily pushes the healed target
            // down after pickup. The pointer endpoint must retain the geometry
            // captured immediately after unplug(true).
            if (gesture.previewTarget !== null) {
                parent.nextConnection.y_ = 94;
                manager.markerConnection_ = {};
            }
        },
        handleMove: event => {
            snapRadii.push(ScratchBlocks.SNAP_RADIUS);
            block.previousConnection.y_ = 20 + ((event.clientY - 218) / workspace.scale);
            manager.markerConnection_ = gesture.previewTarget ? {} : null;
            calls.push(['move', event.clientX, event.clientY]);
        },
        handleUp: event => {
            calls.push(['up', event.clientX, event.clientY]);
            workspace.currentGesture_ = null;
        },
        cancel: jest.fn()
    };
    const block = {
        id: 'moving',
        previousConnection: {x_: 10, y_: 20, checkType_: () => true},
        outputConnection: null,
        getSvgRoot: () => ({getBoundingClientRect: () => ({left: 100, top: 200})}),
        getRelativeToSurfaceXY: () => ({x: 5, y: 6}),
        getParent: () => oldParent,
        getNextBlock: () => next,
        unplug: heal => calls.push(['heal', heal])
    };
    const parent = {id: 'parent', nextConnection: {x_: 10, y_: 70, getSourceBlock: () => parent}};
    const oldParent = {id: 'old-parent'};
    const next = {id: 'next'};
    const workspace = {
        currentGesture_: null,
        scale: 2,
        getBlockById: id => ({moving: block, parent, 'old-parent': oldParent, next}[id] || null),
        getGesture: () => {
            workspace.currentGesture_ = gesture;
            return gesture;
        },
        getInjectionDiv: () => ({})
    };
    const pointerPoints = [];
    const pointer = {moveTo: point => pointerPoints.push({...point})};
    const scope = {runWithoutUndo: callback => callback()};
    const clock = {
        play: async ({points, holdFrames, onFrame}) => {
            const frames = [...points, ...Array.from({length: holdFrames}, () => points[points.length - 1])];
            frames.forEach((point, index) => onFrame(point, index));
            return true;
        }
    };
    const driver = createScratchBlocksDragDriver({workspace, ScratchBlocks, clock, pointer, scope});

    const result = await driver.play({
        blockId: 'moving',
        blockRef: null,
        destination: {parentId: 'parent', inputName: null, coordinate: null},
        affectedBlocks: [{
            blockId: 'moving',
            destination: {parentId: 'parent', inputName: null, coordinate: null}
        }, {
            blockId: 'next',
            destination: {parentId: 'old-parent', inputName: null, coordinate: null}
        }],
        presentation: {grabOffset: {x: 24, y: 18}, frameCount: 4, markerHoldFrames: 2}
    });

    expect(calls[0]).toEqual(['heal', true]);
    expect(calls[1]).toEqual(['start', 124, 218, 'moving']);
    expect(calls[calls.length - 1]).toEqual(['up', 124, 318]);
    expect(parent.nextConnection.y_).toBe(70);
    expect(result.frames).toHaveLength(7);
    expect(result.frames.every(frame => (
        frame.pointer.x === frame.blockly.x && frame.pointer.y === frame.blockly.y
    ))).toBe(true);
    expect(result.frames.slice(0, 4).every(frame => !frame.markerVisible)).toBe(true);
    expect(result.frames.slice(4).every(frame => frame.markerVisible && frame.previewTargetMatches)).toBe(true);
    expect(pointerPoints.every(point => point.x === 124)).toBe(true);
    expect(pointerPoints[pointerPoints.length - 1]).toEqual({x: 124, y: 318});
    expect(snapRadii.every(radius => radius === 48)).toBe(true);
    expect(gesture.previewTarget).toBeUndefined();
    expect(ScratchBlocks).toEqual({SNAP_RADIUS: 48, CONNECTING_SNAP_RADIUS: 68});
    expect(gesture.cancel).not.toHaveBeenCalled();
});

test('clears the gesture constraint without changing global snap radii on cancellation', async () => {
    const ScratchBlocks = {SNAP_RADIUS: 48, CONNECTING_SNAP_RADIUS: 68};
    const observedRadii = [];
    const gesture = {
        setConnectionPreviewTarget: jest.fn(),
        blockDragger_: {draggedConnectionManager_: {}},
        forceStartBlockDrag: jest.fn(),
        handleMove: jest.fn(() => observedRadii.push(ScratchBlocks.SNAP_RADIUS)),
        handleUp: jest.fn(),
        cancel: jest.fn(() => {
            workspace.currentGesture_ = null;
        })
    };
    const block = {
        id: 'moving',
        previousConnection: {x_: 10, y_: 20, checkType_: () => true},
        outputConnection: null,
        getSvgRoot: () => ({getBoundingClientRect: () => ({left: 100, top: 200})}),
        getParent: () => null,
        getNextBlock: () => null
    };
    const parent = {id: 'parent', nextConnection: {x_: 10, y_: 70}};
    const workspace = {
        currentGesture_: null,
        scale: 1,
        getBlockById: id => ({moving: block, parent}[id] || null),
        getGesture: () => {
            workspace.currentGesture_ = gesture;
            return gesture;
        },
        getInjectionDiv: () => ({})
    };
    const driver = createScratchBlocksDragDriver({
        workspace,
        ScratchBlocks,
        pointer: {moveTo: jest.fn()},
        scope: {runWithoutUndo: callback => callback()},
        clock: {
            play: async ({points, onFrame}) => {
                onFrame(points[0], 0);
                return false;
            }
        }
    });

    const result = await driver.play({
        blockId: block.id,
        destination: {parentId: parent.id, inputName: null, coordinate: null},
        affectedBlocks: [{blockId: block.id, destination: {parentId: parent.id, inputName: null}}],
        presentation: {grabOffset: {x: 24, y: 18}, frameCount: 8, markerHoldFrames: 0}
    });

    expect(result).toMatchObject({cancelled: true});
    expect(observedRadii).toEqual([48]);
    expect(gesture.setConnectionPreviewTarget).toHaveBeenCalledWith(null);
    expect(gesture.setConnectionPreviewTarget).toHaveBeenLastCalledWith(undefined);
    expect(ScratchBlocks).toEqual({SNAP_RADIUS: 48, CONNECTING_SNAP_RADIUS: 68});
    expect(gesture.cancel).toHaveBeenCalledTimes(1);
});

test('permits only the intended preview during final approach without a corrective detour', async () => {
    const targetConnection = {x_: 10, y_: 70, getSourceBlock: () => parent};
    const neighbouringConnection = {x_: 10, y_: 94};
    const manager = {
        markerConnection_: {},
        closestConnection_: neighbouringConnection
    };
    const moves = [];
    const gesture = {
        setConnectionPreviewTarget: target => { gesture.previewTarget = target; },
        getConnectionPreview: () => ({
            visible: Boolean(manager.markerConnection_), targetConnection: manager.closestConnection_
        }),
        blockDragger_: {draggedConnectionManager_: manager},
        forceStartBlockDrag: jest.fn(),
        handleMove: event => {
            moves.push(event.clientY);
            manager.closestConnection_ = gesture.previewTarget === undefined ? neighbouringConnection :
                gesture.previewTarget;
            manager.markerConnection_ = manager.closestConnection_ ? {targetConnection: manager.closestConnection_} : null;
        },
        handleUp: jest.fn(() => {
            workspace.currentGesture_ = null;
        }),
        cancel: jest.fn()
    };
    const block = {
        id: 'moving',
        previousConnection: {x_: 10, y_: 20, checkType_: () => true},
        outputConnection: null,
        getSvgRoot: () => ({getBoundingClientRect: () => ({left: 100, top: 200})}),
        getRelativeToSurfaceXY: () => ({x: 5, y: 6}),
        getParent: () => null,
        getNextBlock: () => null
    };
    const parent = {id: 'parent', nextConnection: targetConnection};
    const workspace = {
        currentGesture_: null,
        scale: 2,
        getBlockById: id => ({moving: block, parent}[id] || null),
        getGesture: () => {
            workspace.currentGesture_ = gesture;
            return gesture;
        },
        getInjectionDiv: () => ({})
    };
    const clock = {
        play: async ({points, onFrame}) => {
            points.forEach(onFrame);
            return true;
        }
    };
    const driver = createScratchBlocksDragDriver({
        workspace,
        clock,
        pointer: {moveTo: jest.fn()},
        scope: {runWithoutUndo: callback => callback()}
    });

    const result = await driver.play({
        blockId: block.id,
        blockRef: null,
        destination: {parentId: parent.id, inputName: null, coordinate: null},
        affectedBlocks: [{blockId: block.id, destination: {parentId: parent.id, inputName: null}}],
        presentation: {grabOffset: {x: 24, y: 18}, frameCount: 4, markerHoldFrames: 0}
    });

    expect(manager.closestConnection_).toBe(targetConnection);
    expect(result.frames.filter(frame => frame.connectionCorrection)).toHaveLength(0);
    expect(result.frames.every(frame => frame.previewTargetMatches)).toBe(true);
    expect(result.frames[result.frames.length - 1].markerVisible).toBe(true);
    expect(moves[moves.length - 1]).toBe(318);
    expect(gesture.handleUp).toHaveBeenCalledWith(expect.objectContaining({
        clientY: 318
    }));
});

test('flyout drag acquires only its intended connection without global snapping changes', async () => {
    const ScratchBlocks = {SNAP_RADIUS: 48, CONNECTING_SNAP_RADIUS: 68};
    const targetConnection = {x_: 300, y_: 218, getSourceBlock: () => parent};
    const neighbouringConnection = {x_: 320, y_: 218};
    const manager = {markerConnection_: null, closestConnection_: null};
    const gesture = {
        setConnectionPreviewTarget: target => { gesture.previewTarget = target; },
        getConnectionPreview: () => ({
            visible: Boolean(manager.markerConnection_), targetConnection: manager.closestConnection_
        }),
        blockDragger_: {draggedConnectionManager_: manager},
        handleMove: jest.fn(() => {
            manager.closestConnection_ = gesture.previewTarget === undefined ? neighbouringConnection :
                gesture.previewTarget;
            manager.markerConnection_ = manager.closestConnection_ ? {targetConnection: manager.closestConnection_} : null;
        }),
        handleUp: jest.fn(() => {
            workspace.currentGesture_ = null;
        }),
        cancel: jest.fn()
    };
    const created = {
        id: 'created-live',
        type: 'motion_movesteps',
        previousConnection: {x_: 100, y_: 118, checkType_: () => true},
        getParent: () => null,
        getSvgRoot: () => ({getBoundingClientRect: () => ({left: 40, top: 80})})
    };
    const parent = {
        id: 'parent',
        nextConnection: targetConnection,
        getRootBlock: () => parent,
        getSvgRoot: () => ({getBoundingClientRect: () => ({left: 300, right: 520})})
    };
    const identityCanvas = () => ({
        getScreenCTM: () => ({a: 1, b: 0, c: 0, d: 1, e: 0, f: 0})
    });
    const flyoutPort = {
        prepare: () => Promise.resolve({
            flyout: {getWorkspace: () => ({getCanvas: identityCanvas})},
            block: created
        }),
        beginGesture: () => {
            workspace.currentGesture_ = gesture;
            return gesture;
        },
        pickupPoint: ({start}) => ({x: start.x + 32, y: start.y}),
        createdBlock: () => created
    };
    const workspace = {
        currentGesture_: null,
        scale: 1,
        getCanvas: identityCanvas,
        getBlockById: id => ({'created-live': created, parent}[id] || null),
        getAllBlocks: () => [created, parent],
        getInjectionDiv: () => ({})
    };
    const driver = createScratchBlocksDragDriver({
        workspace,
        ScratchBlocks,
        pointer: {moveTo: jest.fn()},
        scope: {runWithoutUndo: callback => callback()},
        clock: {
            play: async ({points, onFrame}) => {
                points.forEach(onFrame);
                return true;
            }
        },
        flyoutPort
    });

    const result = await driver.play({
        kind: 'flyout-block-drag',
        blockId: 'created-recorded',
        blockType: created.type,
        destination: {parentId: parent.id, inputName: null, coordinate: null},
        affectedBlocks: [{
            blockId: 'created-recorded',
            blockType: created.type,
            destination: {parentId: parent.id, inputName: null, coordinate: null}
        }],
        presentation: {grabOffset: {x: 24, y: 18}, frameCount: 4, markerHoldFrames: 0}
    });

    expect(result).toMatchObject({cancelled: false});
    expect(manager.markerConnection_.targetConnection).toBe(targetConnection);
    expect(result.frames.some(frame => frame.connectionCorrection)).toBe(false);
    expect(result.frames.every(frame => frame.previewTargetMatches)).toBe(true);
    expect(result.frames[result.frames.length - 1].markerVisible).toBe(true);
    expect(ScratchBlocks.SNAP_RADIUS).toBe(48);
    expect(gesture.handleUp).toHaveBeenCalledTimes(1);
});

test('clones one flyout block and drags the live alias to its durable coordinate', async () => {
    let coordinate = {x: 100, y: 100};
    const stationaryAlignment = [];
    const created = {
        id: 'created-live',
        type: 'motion_movesteps',
        getRelativeToSurfaceXY: () => coordinate,
        getParent: () => null,
        getSvgRoot: () => ({getBoundingClientRect: () => ({left: 100, top: 100})}),
        moveBy: (x, y) => {
            coordinate = {x: coordinate.x + x, y: coordinate.y + y};
        }
    };
    const manager = {markerConnection_: {}};
    const gesture = {
        blockDragger_: {draggedConnectionManager_: manager},
        handleMove: jest.fn(() => {
            stationaryAlignment.push(workspace.options.snapDraggedBlockToConnection);
        }),
        handleUp: () => {
            coordinate = {x: 300, y: 200};
            workspace.currentGesture_ = null;
        },
        cancel: jest.fn()
    };
    const flyoutBlock = {
        getSvgRoot: () => ({getBoundingClientRect: () => ({left: 40, top: 80})})
    };
    const flyoutPort = {
        prepare: jest.fn(() => Promise.resolve({flyout: {}, block: flyoutBlock})),
        beginGesture: jest.fn(() => {
            workspace.currentGesture_ = gesture;
            return gesture;
        }),
        pickupPoint: jest.fn(({start}) => ({x: start.x + 32, y: start.y})),
        createdBlock: jest.fn(() => created)
    };
    const workspace = {
        currentGesture_: null,
        options: {snapDraggedBlockToConnection: true},
        scale: 1,
        getBlockById: id => id === created.id ? created : null,
        getAllBlocks: () => [created],
        getInjectionDiv: () => ({})
    };
    const pointer = {moveTo: jest.fn()};
    const scope = {runWithoutUndo: callback => callback()};
    const clock = {
        play: async ({points, onFrame}) => {
            points.forEach(onFrame);
            return true;
        }
    };
    const driver = createScratchBlocksDragDriver({workspace, clock, pointer, scope, flyoutPort});

    const result = await driver.play({
        kind: 'flyout-block-drag',
        blockId: 'created-recorded',
        blockType: 'motion_movesteps',
        destination: {parentId: null, inputName: null, coordinate: {x: 300, y: 200}},
        affectedBlocks: [{
            blockId: 'created-recorded',
            blockType: 'motion_movesteps',
            destination: {parentId: null, inputName: null, coordinate: {x: 300, y: 200}}
        }],
        presentation: {grabOffset: {x: 24, y: 18}, frameCount: 4, markerHoldFrames: 0}
    });

    expect(result).toMatchObject({
        cancelled: false,
        resolvedPlan: {
            blockId: 'created-live',
            blockAliases: {'created-recorded': 'created-live'},
            affectedBlocks: [{blockId: 'created-live'}]
        }
    });
    expect(flyoutPort.beginGesture).toHaveBeenCalledTimes(1);
    expect(gesture.handleMove).toHaveBeenCalled();
    expect(gesture.cancel).not.toHaveBeenCalled();
    expect(stationaryAlignment).toContain(false);
    expect(workspace.options.snapDraggedBlockToConnection).toBe(true);
    expect(coordinate).toEqual({x: 300, y: 200});
    expect(result.frames.every(frame => frame.pointer.x === frame.blockly.x &&
        frame.pointer.y === frame.blockly.y)).toBe(true);
});

test('does not repeat the flyout pickup offset when approaching a connection', async () => {
    const created = {
        id: 'created-live',
        type: 'motion_movesteps',
        previousConnection: {x_: 100, y_: 118, checkType_: () => true},
        getParent: () => null,
        getSvgRoot: () => ({getBoundingClientRect: () => ({left: 40, top: 80})})
    };
    const parent = {id: 'parent', nextConnection: {x_: 300, y_: 218}};
    const gesture = {
        blockDragger_: {draggedConnectionManager_: {}},
        handleMove: jest.fn(),
        handleUp: jest.fn(() => {
            workspace.currentGesture_ = null;
        }),
        cancel: jest.fn()
    };
    const flyoutPort = {
        prepare: () => Promise.resolve({flyout: {}, block: created}),
        beginGesture: () => {
            workspace.currentGesture_ = gesture;
            return gesture;
        },
        pickupPoint: ({start}) => ({x: start.x + 32, y: start.y}),
        createdBlock: () => created
    };
    const workspace = {
        currentGesture_: null,
        scale: 1,
        getBlockById: id => ({'created-live': created, parent}[id] || null),
        getAllBlocks: () => [created, parent],
        getInjectionDiv: () => ({})
    };
    const driver = createScratchBlocksDragDriver({
        workspace,
        pointer: {moveTo: jest.fn()},
        scope: {runWithoutUndo: callback => callback()},
        clock: {
            play: async ({points, onFrame}) => {
                points.forEach(onFrame);
                return true;
            }
        },
        flyoutPort
    });

    await driver.play({
        kind: 'flyout-block-drag',
        blockId: 'created-recorded',
        blockType: 'motion_movesteps',
        destination: {parentId: 'parent', inputName: null, coordinate: null},
        affectedBlocks: [{
            blockId: 'created-recorded',
            blockType: 'motion_movesteps',
            destination: {parentId: 'parent', inputName: null, coordinate: null}
        }],
        presentation: {grabOffset: {x: 24, y: 18}, frameCount: 4, markerHoldFrames: 0}
    });

    // Start is (64, 98); the stale connection delta is (200, 100).
    // The 32 px hysteresis pickup must not be added a second time.
    expect(gesture.handleMove).toHaveBeenLastCalledWith(expect.objectContaining({
        clientX: 264,
        clientY: 198
    }));
});

test('maps flyout and destination connections through their independent screen transforms', async () => {
    const ScratchBlocks = {SNAP_RADIUS: 48, CONNECTING_SNAP_RADIUS: 68};
    const snapRadii = [];
    const created = {
        id: 'created-live',
        type: 'motion_movesteps',
        previousConnection: {x_: 100, y_: 118, checkType_: () => true},
        getParent: () => null,
        getSvgRoot: () => ({getBoundingClientRect: () => ({left: 40, top: 80})})
    };
    const parent = {
        id: 'parent',
        nextConnection: {x_: 300, y_: 218},
        getRootBlock: () => parent,
        getSvgRoot: () => ({getBoundingClientRect: () => ({left: 300, right: 1500})})
    };
    const gesture = {
        blockDragger_: {draggedConnectionManager_: {}},
        handleMove: jest.fn(() => snapRadii.push(ScratchBlocks.SNAP_RADIUS)),
        handleUp: jest.fn(() => {
            workspace.currentGesture_ = null;
        }),
        cancel: jest.fn()
    };
    const flyoutWorkspace = {
        getCanvas: () => ({
            getScreenCTM: () => ({a: 0.675, b: 0, c: 0, d: 0.675, e: 0, f: 2})
        })
    };
    const flyout = {getWorkspace: () => flyoutWorkspace};
    const flyoutPort = {
        prepare: () => Promise.resolve({flyout, block: created}),
        beginGesture: () => {
            workspace.currentGesture_ = gesture;
            return gesture;
        },
        pickupPoint: ({start}) => ({x: start.x + 32, y: start.y}),
        createdBlock: () => created
    };
    const workspace = {
        currentGesture_: null,
        scale: 2.9,
        getCanvas: () => ({
            getScreenCTM: () => ({a: 2.9, b: 0, c: 0, d: 2.9, e: 54, f: -197})
        }),
        getBlockById: id => ({'created-live': created, parent}[id] || null),
        getAllBlocks: () => [created, parent],
        getInjectionDiv: () => ({})
    };
    const driver = createScratchBlocksDragDriver({
        workspace,
        ScratchBlocks,
        pointer: {moveTo: jest.fn()},
        scope: {runWithoutUndo: callback => callback()},
        clock: {
            play: async ({points, onFrame}) => {
                points.forEach(onFrame);
                return true;
            }
        },
        flyoutPort
    });

    await driver.play({
        kind: 'flyout-block-drag',
        blockId: 'created-recorded',
        blockType: 'motion_movesteps',
        destination: {parentId: 'parent', inputName: null, coordinate: null},
        affectedBlocks: [{
            blockId: 'created-recorded',
            blockType: 'motion_movesteps',
            destination: {parentId: 'parent', inputName: null, coordinate: null}
        }],
        presentation: {grabOffset: {x: 24, y: 18}, frameCount: 4, markerHoldFrames: 0}
    });

    // Source connection is at (67.5, 81.65), 3.5 px right and 16.35 px above
    // the pointer. Destination connection is at (924, 435.2).
    const finalMove = gesture.handleMove.mock.calls[gesture.handleMove.mock.calls.length - 1][0];
    expect(finalMove.clientX).toBeCloseTo(920.5);
    expect(finalMove.clientY).toBeCloseTo(451.55);
    const dragPoints = gesture.handleMove.mock.calls.slice(1).map(([event]) => ({
        x: event.clientX,
        y: event.clientY
    }));
    const routeStart = dragPoints[0];
    const routeDistance = Math.hypot(finalMove.clientX - routeStart.x, finalMove.clientY - routeStart.y);
    const deviations = dragPoints.map(point => Math.abs(
        ((finalMove.clientY - routeStart.y) * point.x) -
        ((finalMove.clientX - routeStart.x) * point.y) +
        (finalMove.clientX * routeStart.y) - (finalMove.clientY * routeStart.x)
    ) / routeDistance);
    expect(Math.max(...deviations)).toBeGreaterThan(1);
    expect(Math.max(...deviations)).toBeLessThan(28);
    expect(Math.max(...dragPoints.map(point => point.x))).toBeGreaterThan(finalMove.clientX);
    expect(Math.max(...dragPoints.map(point => point.x)) - finalMove.clientX).toBeLessThan(7);
    expect(dragPoints.some(point => (
        point.x > routeStart.x + 100 && point.y > routeStart.y + 40
    ))).toBe(true);
    expect(snapRadii.every(radius => radius === 48)).toBe(true);
    expect(snapRadii[snapRadii.length - 1]).toBe(48);
    expect(ScratchBlocks).toEqual({SNAP_RADIUS: 48, CONNECTING_SNAP_RADIUS: 68});
});

test('picks up a connected block before calculating a top-level coordinate drag', async () => {
    let pickedUp = false;
    const gesture = {
        blockDragger_: {draggedConnectionManager_: {}},
        forceStartBlockDrag: () => {
            pickedUp = true;
        },
        handleMove: jest.fn(),
        handleUp: () => {
            workspace.currentGesture_ = null;
        },
        cancel: jest.fn()
    };
    const block = {
        id: 'bottom',
        type: 'motion_pointtowards',
        getSvgRoot: () => ({getBoundingClientRect: () => ({left: 100, top: 200})}),
        getRelativeToSurfaceXY: () => pickedUp ? {x: 220, y: 160} : null,
        getParent: () => ({id: 'top'}),
        getNextBlock: () => null
    };
    const workspace = {
        currentGesture_: null,
        scale: 1,
        getBlockById: id => id === 'bottom' ? block : null,
        getGesture: () => {
            workspace.currentGesture_ = gesture;
            return gesture;
        },
        getInjectionDiv: () => ({})
    };
    const pointer = {moveTo: jest.fn()};
    const scope = {runWithoutUndo: callback => callback()};
    const clock = {
        play: async ({points, onFrame}) => {
            points.forEach(onFrame);
            return true;
        }
    };
    const driver = createScratchBlocksDragDriver({workspace, clock, pointer, scope});

    await expect(driver.play({
        blockId: 'bottom',
        blockRef: null,
        destination: {parentId: null, inputName: null, coordinate: {x: 260, y: 180}},
        affectedBlocks: [{
            blockId: 'bottom',
            destination: {parentId: null, inputName: null, coordinate: {x: 260, y: 180}}
        }],
        presentation: {grabOffset: {x: 24, y: 18}, frameCount: 4, markerHoldFrames: 0}
    })).resolves.toMatchObject({cancelled: false});

    expect(pickedUp).toBe(true);
    expect(gesture.handleMove).toHaveBeenLastCalledWith(expect.objectContaining({
        clientX: 164,
        clientY: 238
    }));
    expect(gesture.cancel).not.toHaveBeenCalled();
});

test('drags above a displaced root using native statement connection geometry', async () => {
    let pickedUp = false;
    const gesture = {
        blockDragger_: {draggedConnectionManager_: {}},
        forceStartBlockDrag: () => {
            pickedUp = true;
        },
        handleMove: jest.fn(),
        handleUp: () => {
            workspace.currentGesture_ = null;
        },
        cancel: jest.fn()
    };
    const block = {
        id: 'bottom',
        type: 'motion_pointtowards',
        nextConnection: {x_: 120, y_: 280, checkType_: () => true},
        getSvgRoot: () => ({getBoundingClientRect: () => ({left: 100, top: 200})}),
        getRelativeToSurfaceXY: () => pickedUp ? {x: 220, y: 160} : null,
        getParent: () => ({id: 'top'}),
        getNextBlock: () => null
    };
    const displaced = {
        id: 'top',
        type: 'motion_gotoxy',
        previousConnection: {x_: 100, y_: 200}
    };
    const workspace = {
        currentGesture_: null,
        scale: 1,
        getBlockById: id => ({bottom: block, top: displaced}[id] || null),
        getGesture: () => {
            workspace.currentGesture_ = gesture;
            return gesture;
        },
        getInjectionDiv: () => ({})
    };
    const pointer = {moveTo: jest.fn()};
    const scope = {runWithoutUndo: callback => callback()};
    const clock = {
        play: async ({points, onFrame}) => {
            points.forEach(onFrame);
            return true;
        }
    };
    const driver = createScratchBlocksDragDriver({workspace, clock, pointer, scope});

    await expect(driver.play({
        blockId: 'bottom',
        blockRef: null,
        destination: {parentId: null, inputName: null, coordinate: {x: 220, y: 160}},
        destinationCoordinateIsGesturePickup: true,
        affectedBlocks: [{
            blockId: 'bottom',
            source: {parentId: 'top'},
            destination: {parentId: null, inputName: null, coordinate: {x: 220, y: 160}}
        }, {
            blockId: 'top',
            source: {parentId: null, coordinate: {x: 220, y: 112}},
            destination: {parentId: 'bottom', inputName: null, coordinate: null}
        }],
        presentation: {grabOffset: {x: 24, y: 18}, frameCount: 4, markerHoldFrames: 0}
    })).resolves.toMatchObject({cancelled: false});

    expect(gesture.handleMove).toHaveBeenLastCalledWith(expect.objectContaining({
        clientX: 104,
        clientY: 138
    }));
    expect(gesture.cancel).not.toHaveBeenCalled();
});

test('uses the tail connection when prepending a compound substack above its former root', async () => {
    let pickedUp = false;
    const gesture = {
        blockDragger_: {draggedConnectionManager_: {}},
        forceStartBlockDrag: () => {
            pickedUp = true;
        },
        handleMove: jest.fn(),
        handleUp: () => {
            workspace.currentGesture_ = null;
        },
        cancel: jest.fn()
    };
    const moving = {
        id: 'goto',
        type: 'motion_goto',
        nextConnection: {x_: 120, y_: 248, checkType_: () => true},
        getSvgRoot: () => ({getBoundingClientRect: () => ({left: 100, top: 200})}),
        getRelativeToSurfaceXY: () => pickedUp ? {x: 220, y: 208} : null,
        getParent: () => ({id: 'move'}),
        getNextBlock: () => ({id: 'turn-right'})
    };
    const tail = {
        id: 'turn-left',
        nextConnection: {x_: 120, y_: 344, checkType_: () => true}
    };
    const displaced = {
        id: 'move',
        type: 'motion_movesteps',
        previousConnection: {x_: 100, y_: 160}
    };
    const workspace = {
        currentGesture_: null,
        scale: 1,
        getBlockById: id => ({goto: moving, 'turn-left': tail, move: displaced}[id] || null),
        getGesture: () => {
            workspace.currentGesture_ = gesture;
            return gesture;
        },
        getInjectionDiv: () => ({})
    };
    const pointer = {moveTo: jest.fn()};
    const scope = {runWithoutUndo: callback => callback()};
    const clock = {
        play: async ({points, onFrame}) => {
            points.forEach(onFrame);
            return true;
        }
    };
    const driver = createScratchBlocksDragDriver({workspace, clock, pointer, scope});

    await driver.play({
        blockId: 'goto',
        blockRef: null,
        source: {parentId: 'move'},
        destination: {parentId: null, inputName: null, coordinate: {x: 220, y: 208}},
        destinationCoordinateIsGesturePickup: true,
        affectedBlocks: [{
            blockId: 'goto',
            source: {parentId: 'move'},
            destination: {parentId: null, inputName: null, coordinate: {x: 220, y: 208}}
        }, {
            blockId: 'move',
            source: {parentId: null, inputName: null, coordinate: {x: 220, y: 160}},
            destination: {parentId: 'turn-left', inputName: null, coordinate: null}
        }],
        presentation: {grabOffset: {x: 24, y: 18}, frameCount: 4, markerHoldFrames: 0}
    });

    expect(gesture.handleMove).toHaveBeenLastCalledWith(expect.objectContaining({
        clientX: 104,
        clientY: 34
    }));
    expect(gesture.cancel).not.toHaveBeenCalled();
});

test('uses the durable coordinate after a split top-level reorder drag', async () => {
    let pickedUp = false;
    const gesture = {
        blockDragger_: {draggedConnectionManager_: {}},
        forceStartBlockDrag: () => {
            pickedUp = true;
        },
        handleMove: jest.fn(),
        handleUp: () => {
            workspace.currentGesture_ = null;
        },
        cancel: jest.fn()
    };
    const block = {
        id: 'bottom',
        type: 'motion_changexby',
        nextConnection: {x_: 120, y_: 280, checkType_: () => true},
        getSvgRoot: () => ({getBoundingClientRect: () => ({left: 100, top: 200})}),
        getRelativeToSurfaceXY: () => pickedUp ? {x: 220, y: 256} : null,
        getParent: () => ({id: 'top'}),
        getNextBlock: () => null
    };
    const displaced = {
        id: 'top',
        type: 'motion_gotoxy',
        previousConnection: {x_: 100, y_: 200}
    };
    const workspace = {
        currentGesture_: null,
        scale: 1,
        getBlockById: id => ({bottom: block, top: displaced}[id] || null),
        getGesture: () => {
            workspace.currentGesture_ = gesture;
            return gesture;
        },
        getInjectionDiv: () => ({})
    };
    const pointer = {moveTo: jest.fn()};
    const scope = {runWithoutUndo: callback => callback()};
    const clock = {
        play: async ({points, onFrame}) => {
            points.forEach(onFrame);
            return true;
        }
    };
    const driver = createScratchBlocksDragDriver({workspace, clock, pointer, scope});

    await driver.play({
        blockId: 'bottom',
        blockRef: null,
        destination: {parentId: null, inputName: null, coordinate: {x: 220, y: 160}},
        destinationCoordinateIsGesturePickup: false,
        affectedBlocks: [{
            blockId: 'bottom',
            source: {parentId: 'top'},
            destination: {parentId: null, inputName: null, coordinate: {x: 220, y: 160}}
        }, {
            blockId: 'top',
            source: {parentId: null, coordinate: {x: 220, y: 208}},
            destination: {parentId: 'bottom', inputName: null, coordinate: null}
        }],
        presentation: {grabOffset: {x: 24, y: 18}, frameCount: 4, markerHoldFrames: 0}
    });

    expect(gesture.handleMove).toHaveBeenLastCalledWith(expect.objectContaining({
        clientX: 124,
        clientY: 122
    }));
});

test('detaches only an aliased top-level root before dragging it into its own stationary remainder', async () => {
    const order = [];
    const destination = {
        id: 'go-to-live',
        type: 'motion_gotoxy',
        nextConnection: {x_: 120, y_: 300, checkType_: () => true}
    };
    const point = {
        id: 'point-live',
        type: 'motion_pointindirection',
        getNextBlock: () => destination
    };
    let nextBlock = point;
    const gesture = {
        blockDragger_: {draggedConnectionManager_: {}},
        forceStartBlockDrag: () => order.push('drag'),
        handleMove: jest.fn(),
        handleUp: () => {
            workspace.currentGesture_ = null;
        },
        cancel: jest.fn()
    };
    const root = {
        id: 'turn-left-live',
        type: 'motion_turnleft',
        previousConnection: {x_: 100, y_: 175, checkType_: () => true},
        getSvgRoot: () => ({getBoundingClientRect: () => ({left: 100, top: 175})}),
        getRelativeToSurfaceXY: () => ({x: 308, y: 175}),
        getParent: () => null,
        getNextBlock: () => nextBlock,
        unplug: jest.fn(() => {
            order.push('split');
            nextBlock = null;
        })
    };
    const rootRef = {
        ancestorId: 'turn-left-recorded',
        ancestorType: 'motion_turnleft',
        ancestorCoordinate: {x: 308, y: 175},
        path: []
    };
    const workspace = {
        currentGesture_: null,
        scale: 1,
        getBlockById: id => ({
            'turn-left-live': root,
            'point-live': point,
            'go-to-live': destination
        }[id] || null),
        getAllBlocks: () => [root, point, destination],
        getTopBlocks: () => [root],
        getGesture: () => {
            workspace.currentGesture_ = gesture;
            return gesture;
        },
        getInjectionDiv: () => ({})
    };
    const driver = createScratchBlocksDragDriver({
        workspace,
        clock: {
            play: async ({points, onFrame}) => {
                points.forEach(onFrame);
                return true;
            }
        },
        pointer: {moveTo: jest.fn()},
        scope: {runWithoutUndo: callback => callback()}
    });

    await expect(driver.play({
        kind: 'existing-block-drag',
        blockId: 'turn-left-recorded',
        blockType: 'motion_turnleft',
        blockRef: rootRef,
        source: {parentId: null, coordinate: {x: 308, y: 175}},
        destination: {
            parentId: 'go-to-recorded',
            inputName: null,
            coordinate: null,
            parentRef: {...rootRef, path: [{kind: 'next'}, {kind: 'next'}]}
        },
        splitSourceRoot: true,
        affectedBlocks: [{
            blockId: 'turn-left-recorded',
            blockType: 'motion_turnleft',
            source: {parentId: null, coordinate: {x: 308, y: 175}},
            destination: {
                parentId: 'go-to-recorded',
                inputName: null,
                coordinate: null,
                parentRef: {...rootRef, path: [{kind: 'next'}, {kind: 'next'}]}
            }
        }, {
            blockId: 'point-recorded',
            blockType: 'motion_pointindirection',
            source: {parentId: 'turn-left-recorded', parentRef: rootRef},
            destination: {parentId: null, coordinate: {x: 308, y: 223}}
        }],
        presentation: {grabOffset: {x: 24, y: 18}, frameCount: 4, markerHoldFrames: 0}
    })).resolves.toMatchObject({cancelled: false});

    expect(root.unplug).toHaveBeenCalledWith(true);
    expect(order).toEqual(['split', 'drag']);
    expect(gesture.handleMove).toHaveBeenLastCalledWith(expect.objectContaining({
        clientX: 144,
        clientY: 318
    }));
    expect(gesture.cancel).not.toHaveBeenCalled();
});

test('settles a fractional-scale top-level drag on the exact durable coordinate', async () => {
    let coordinate = {x: 220, y: 256};
    const moveEvents = [];
    const gesture = {
        blockDragger_: {draggedConnectionManager_: {}},
        forceStartBlockDrag: jest.fn(),
        handleMove: event => {
            moveEvents.push(event);
            coordinate = moveEvents.length === 1 ?
                {x: 219.962962962963, y: 159.33333333333334} :
                {x: 220, y: 160};
        },
        handleUp: () => {
            workspace.currentGesture_ = null;
        },
        cancel: jest.fn()
    };
    const block = {
        id: 'bottom',
        type: 'motion_changexby',
        getSvgRoot: () => ({getBoundingClientRect: () => ({left: 100, top: 200})}),
        getRelativeToSurfaceXY: () => coordinate,
        getParent: () => ({id: 'top'}),
        getNextBlock: () => null
    };
    const workspace = {
        currentGesture_: null,
        scale: 0.75,
        getBlockById: id => id === 'bottom' ? block : null,
        getGesture: () => {
            workspace.currentGesture_ = gesture;
            return gesture;
        },
        getInjectionDiv: () => ({})
    };
    const pointer = {moveTo: jest.fn()};
    const scope = {runWithoutUndo: callback => callback()};
    const clock = {
        play: async ({points, onFrame}) => {
            onFrame(points[points.length - 1], 0);
            return true;
        }
    };
    const driver = createScratchBlocksDragDriver({workspace, clock, pointer, scope});

    const result = await driver.play({
        blockId: 'bottom',
        blockRef: null,
        destination: {parentId: null, inputName: null, coordinate: {x: 220, y: 160}},
        destinationCoordinateIsGesturePickup: false,
        affectedBlocks: [{
            blockId: 'bottom',
            destination: {parentId: null, inputName: null, coordinate: {x: 220, y: 160}}
        }],
        presentation: {grabOffset: {x: 24, y: 18}, frameCount: 4, markerHoldFrames: 0}
    });

    expect(coordinate).toEqual({x: 220, y: 160});
    expect(moveEvents).toHaveLength(2);
    expect(moveEvents[1]).toMatchObject({clientX: 124.04166666666663, clientY: 146.75});
    expect(result.frames[1]).toMatchObject({coordinateCorrection: true});
});

test('repeats fractional-scale settling when Blockly absorbs part of the first correction', async () => {
    let coordinate = {x: 220, y: 256};
    const moveEvents = [];
    const gesture = {
        blockDragger_: {draggedConnectionManager_: {}},
        forceStartBlockDrag: jest.fn(),
        handleMove: event => {
            moveEvents.push(event);
            coordinate = [
                {x: 412.9, y: 438.55},
                {x: 412.7, y: 438.55},
                {x: 412.45, y: 438.55}
            ][Math.min(moveEvents.length - 1, 2)];
        },
        handleUp: () => {
            workspace.currentGesture_ = null;
        },
        cancel: jest.fn()
    };
    const block = {
        id: 'moving',
        type: 'motion_movesteps',
        getSvgRoot: () => ({getBoundingClientRect: () => ({left: 100, top: 200})}),
        getRelativeToSurfaceXY: () => coordinate,
        getParent: () => null,
        getNextBlock: () => null
    };
    const workspace = {
        currentGesture_: null,
        scale: 0.75,
        getBlockById: id => id === 'moving' ? block : null,
        getGesture: () => {
            workspace.currentGesture_ = gesture;
            return gesture;
        },
        getInjectionDiv: () => ({})
    };
    const clock = {
        play: async ({points, onFrame}) => {
            onFrame(points[points.length - 1], 0);
            return true;
        }
    };
    const driver = createScratchBlocksDragDriver({
        workspace,
        clock,
        pointer: {moveTo: jest.fn()},
        scope: {runWithoutUndo: callback => callback()}
    });

    const result = await driver.play({
        blockId: 'moving',
        blockRef: null,
        destination: {parentId: null, inputName: null, coordinate: {x: 412, y: 439}},
        destinationCoordinateIsGesturePickup: false,
        affectedBlocks: [{
            blockId: 'moving',
            destination: {parentId: null, inputName: null, coordinate: {x: 412, y: 439}}
        }],
        presentation: {grabOffset: {x: 24, y: 18}, frameCount: 4, markerHoldFrames: 0}
    });

    expect(moveEvents).toHaveLength(3);
    expect(Math.round(coordinate.x)).toBe(412);
    expect(Math.round(coordinate.y)).toBe(439);
    expect(result.frames.filter(frame => frame.coordinateCorrection)).toHaveLength(2);
});

test('repairs a subpixel coordinate shift introduced by the top-level mouse-up commit', async () => {
    let coordinate = {x: 220, y: 256};
    const moveBy = jest.fn((dx, dy) => {
        coordinate = {x: coordinate.x + dx, y: coordinate.y + dy};
    });
    const gesture = {
        blockDragger_: {draggedConnectionManager_: {}},
        forceStartBlockDrag: jest.fn(),
        handleMove: () => {
            coordinate = {x: 412, y: 439};
        },
        handleUp: () => {
            coordinate = {x: 412.7, y: 439.1};
            workspace.currentGesture_ = null;
        },
        cancel: jest.fn()
    };
    const block = {
        id: 'moving',
        type: 'motion_movesteps',
        getSvgRoot: () => ({getBoundingClientRect: () => ({left: 100, top: 200})}),
        getRelativeToSurfaceXY: () => coordinate,
        getParent: () => null,
        getNextBlock: () => null,
        moveBy
    };
    const workspace = {
        currentGesture_: null,
        scale: 0.75,
        getBlockById: id => id === 'moving' ? block : null,
        getGesture: () => {
            workspace.currentGesture_ = gesture;
            return gesture;
        },
        getInjectionDiv: () => ({})
    };
    const scope = {runWithoutUndo: jest.fn(callback => callback())};
    const driver = createScratchBlocksDragDriver({
        workspace,
        clock: {
            play: async ({points, onFrame}) => {
                onFrame(points[points.length - 1], 0);
                return true;
            }
        },
        pointer: {moveTo: jest.fn()},
        scope
    });

    const result = await driver.play({
        blockId: 'moving',
        blockRef: null,
        destination: {parentId: null, inputName: null, coordinate: {x: 412, y: 439}},
        destinationCoordinateIsGesturePickup: false,
        affectedBlocks: [{
            blockId: 'moving',
            destination: {parentId: null, inputName: null, coordinate: {x: 412, y: 439}}
        }],
        presentation: {grabOffset: {x: 24, y: 18}, frameCount: 4, markerHoldFrames: 0}
    });

    expect(moveBy).toHaveBeenCalledWith(-0.6999999999999886, -0.10000000000002274);
    expect(coordinate).toEqual({x: 412, y: 439});
    expect(result.frames[result.frames.length - 1]).toMatchObject({
        coordinateCorrection: true,
        postDropCoordinateCorrection: true
    });
});

test('rejects an active user gesture before acquiring or moving a block', async () => {
    const workspace = {currentGesture_: {hasStarted: () => true}};
    const driver = createScratchBlocksDragDriver({
        workspace,
        clock: {},
        pointer: {},
        scope: {}
    });
    await expect(driver.play({blockId: 'moving'})).rejects.toThrow(
        'Cannot start native playback during an active gesture'
    );
});
