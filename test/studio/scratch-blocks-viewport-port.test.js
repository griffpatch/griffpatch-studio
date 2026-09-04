import {
    PRE_CREATE_CAMERA_MODES,
    VIEWPORT_PRESENTATION_MODES,
    createScratchBlocksViewportPort,
    installExpandedScrollRegion,
    safeViewportForFrame
} from '../../src/studio/bridge/scratch-blocks-viewport-port';

const makeTransaction = (overrides = {}) => ({
    ...overrides,
    events: (overrides.events || [
        {blockId: 'temporary-block'},
        {blockId: 'focus-block'}
    ]).map(event => ({...event, details: {oldLocation: {}, newLocation: {}, ...event.details}}))
});

const makeHarness = ({motion = null, preCreateMode = PRE_CREATE_CAMERA_MODES.WAIT} = {}) => {
    let block = null;
    let blockId = 'focus-block';
    let metrics = {
        contentLeft: 0,
        contentTop: 0,
        viewLeft: 40,
        viewTop: 20,
        viewWidth: 400,
        viewHeight: 200
    };
    const workspace = {
        RTL: false,
        scale: 2,
        getBlockById: id => (block && id === blockId ? block : null),
        getTopBlocks: () => (block ? [block] : []),
        getParentSvg: () => ({
            getBoundingClientRect: () => ({left: 0, right: 400, top: 0, bottom: 200})
        }),
        getMetrics: () => metrics,
        scrollbar: {set: jest.fn()}
    };
    return {
        port: createScratchBlocksViewportPort({workspace, motion, preCreateMode}),
        removeBlock: () => {
            block = null;
        },
        setBlock: ({
            id = 'focus-block',
            type = 'test_block',
            focusX,
            focusY,
            focusWidth = 40,
            focusHeight = 20,
            rootX = focusX,
            rootY = focusY,
            rootWidth = focusWidth,
            rootHeight = focusHeight,
            rootTreeWidth = null,
            renderedRect = null
        }) => {
            blockId = id;
            const root = {
                getRelativeToSurfaceXY: () => ({x: rootX, y: rootY}),
                getHeightWidth: () => ({width: rootWidth, height: rootHeight})
            };
            if (rootTreeWidth !== null) {
                root.getDescendants = () => [root, {
                    getRelativeToSurfaceXY: () => ({x: rootX, y: rootY}),
                    getHeightWidth: () => ({width: rootTreeWidth, height: rootHeight})
                }];
            }
            block = {
                id,
                type,
                getRelativeToSurfaceXY: () => ({x: focusX, y: focusY}),
                getHeightWidth: () => ({width: focusWidth, height: focusHeight}),
                getParent: () => null,
                getRootBlock: () => root,
                getSvgRoot: renderedRect ? () => ({getBoundingClientRect: () => renderedRect}) : void 0
            };
        },
        setMetrics: nextMetrics => {
            metrics = {...metrics, ...nextMetrics};
        },
        workspace
    };
};

test('captures the visible workspace origin in scale-independent coordinates', () => {
    const harness = makeHarness();

    expect(harness.port.capture()).toEqual({viewLeft: 20, viewTop: 10});
});

test('adds one full viewport of parking room and restores the original metrics', () => {
    const originalGetMetrics = jest.fn(() => ({
        contentHeight: 600,
        contentLeft: 100,
        contentTop: 80,
        contentWidth: 1000,
        toolboxWidth: 60,
        viewHeight: 300,
        viewWidth: 400
    }));
    const workspace = {
        getMetrics: originalGetMetrics,
        resize: jest.fn(),
        resizeContents: jest.fn(),
        scrollbar: {resize: jest.fn()}
    };

    const restore = installExpandedScrollRegion(workspace);

    expect(workspace.getMetrics()).toEqual({
        contentHeight: 900,
        contentLeft: -100,
        contentTop: -70,
        contentWidth: 1460,
        toolboxWidth: 60,
        viewHeight: 300,
        viewWidth: 400
    });
    expect(workspace.resizeContents).toHaveBeenCalledTimes(1);
    expect(workspace.scrollbar.resize).toHaveBeenCalledTimes(1);
    expect(workspace.resize).toHaveBeenCalledTimes(1);

    restore();
    restore();

    expect(workspace.getMetrics).toBe(originalGetMetrics);
    expect(workspace.resizeContents).toHaveBeenCalledTimes(2);
    expect(workspace.scrollbar.resize).toHaveBeenCalledTimes(2);
    expect(workspace.resize).toHaveBeenCalledTimes(2);
});

test('cancels camera motion and restores the viewport from before the transaction', () => {
    const motion = {jumpTo: jest.fn(), moveTo: jest.fn(), stop: jest.fn()};
    const harness = makeHarness({motion});
    harness.port.beginTransaction(makeTransaction({viewport: {viewLeft: 250, viewTop: 150}}), 'forward');
    harness.setMetrics({viewLeft: 300, viewTop: 200});

    harness.port.cancel();

    expect(motion.stop).toHaveBeenCalledTimes(1);
    expect(motion.jumpTo).toHaveBeenCalledWith(40, 20);
});

test('uses spare top-left space to retain other scripts already intersecting the viewport', () => {
    const block = (x, y, width, height) => ({
        getRelativeToSurfaceXY: () => ({x, y}),
        getHeightWidth: () => ({width, height})
    });
    const workspace = {
        RTL: false,
        scale: 1,
        getMetrics: () => ({viewWidth: 400, viewHeight: 300}),
        getTopBlocks: () => [
            block(200, 160, 100, 40),
            block(320, 220, 110, 70),
            block(800, 600, 100, 100)
        ]
    };
    const active = {
        focus: {left: 200, right: 300, top: 160, bottom: 200},
        root: {left: 200, right: 300, top: 160, bottom: 200}
    };

    // Vertical framing is already safe at 70, but correcting the unsafe left
    // edge should compose the complete fitting shot on both axes.
    expect(safeViewportForFrame(workspace, {viewLeft: 0, viewTop: 70}, active)).toEqual({
        viewLeft: 168,
        viewTop: 96
    });
});

test('restores the viewport recorded with the transaction', async () => {
    const harness = makeHarness();
    harness.port.beginTransaction(makeTransaction({
        viewport: {viewLeft: 25, viewTop: 15}
    }));

    await expect(harness.port.focusTransaction()).resolves.toBe(true);
    expect(harness.workspace.scrollbar.set).toHaveBeenCalledWith(50, 30);
});

test('preserves the current viewport when the stack is safe even if the authoring view differed', async () => {
    const motion = {jumpTo: jest.fn(), moveTo: jest.fn(() => Promise.resolve()), stop: jest.fn()};
    const harness = makeHarness({motion});
    harness.setMetrics({viewWidth: 600, viewHeight: 500});
    harness.setBlock({
        focusX: 120,
        focusY: 90,
        focusWidth: 40,
        focusHeight: 20,
        rootX: 60,
        rootY: 50,
        rootWidth: 200,
        rootHeight: 100
    });
    harness.port.beginTransaction(makeTransaction({viewport: {viewLeft: 250, viewTop: 150}}), 'forward');

    await harness.port.focusTransaction();

    expect(motion.moveTo).toHaveBeenCalledWith(40, 20, {from: {x: 40, y: 20}});
});

test('passes the selected playback speed to recorded and interaction camera moves', async () => {
    const motion = {jumpTo: jest.fn(), moveTo: jest.fn(() => Promise.resolve()), stop: jest.fn()};
    const harness = makeHarness({motion});
    harness.setBlock({
        focusX: 180,
        focusY: 140,
        focusWidth: 40,
        focusHeight: 20,
        rootX: 120,
        rootY: 50,
        rootWidth: 100,
        rootHeight: 120
    });
    harness.port.beginTransaction(makeTransaction({viewport: {viewLeft: 20, viewTop: 0}}), 'forward', {
        speed: 4
    });

    await harness.port.focusTransaction();
    expect(motion.moveTo).toHaveBeenLastCalledWith(208, 216, {from: {x: 40, y: 20}, speed: 4});

    harness.setBlock({
        id: 'live-parent',
        focusX: 110,
        focusY: 250,
        focusWidth: 80,
        focusHeight: 40,
        rootX: 110,
        rootY: 80,
        rootWidth: 120,
        rootHeight: 210
    });
    await harness.port.ensureInteractionVisible({
        blockType: 'motion_movesteps',
        destination: {parentId: 'recorded-parent', inputName: null, coordinate: null}
    }, new Map([['recorded-parent', 'live-parent']]), {speed: 0.5});
    expect(motion.moveTo.mock.calls[motion.moveTo.mock.calls.length - 1][2]).toMatchObject({speed: 0.5});
});

test('frames a clipboard destination using the full copied script width', async () => {
    const motion = {jumpTo: jest.fn(), moveTo: jest.fn(() => Promise.resolve()), stop: jest.fn()};
    const harness = makeHarness({motion});
    harness.setBlock({id: 'source-copy', focusX: 100, focusY: 40, focusWidth: 160, focusHeight: 20});
    await harness.port.ensureInteractionVisible({
        kind: 'clipboard-block-paste',
        sourceBlockRef: {ancestorId: 'source-copy', ancestorType: 'test_block', path: []},
        destination: {parentId: null, coordinate: {x: 150, y: 20}}
    });
    expect(motion.moveTo).toHaveBeenCalled();
    const [scrollX] = motion.moveTo.mock.calls[0];
    expect(((150 + 160) * harness.workspace.scale) - scrollX).toBeLessThanOrEqual(400 - 32);
});

test('anchors a fitting unsafe frame at the top-left safe margins', async () => {
    const motion = {jumpTo: jest.fn(), moveTo: jest.fn(() => Promise.resolve()), stop: jest.fn()};
    const harness = makeHarness({motion});
    harness.setMetrics({viewHeight: 400, viewTop: 0});
    harness.setBlock({
        focusX: 180,
        focusY: 140,
        focusWidth: 40,
        focusHeight: 20,
        rootX: 120,
        rootY: 50,
        rootWidth: 100,
        rootHeight: 120
    });
    harness.port.beginTransaction(makeTransaction({viewport: {viewLeft: 20, viewTop: 0}}), 'forward');

    await harness.port.focusTransaction();

    // Once a fitting frame needs correction, use the top-left safe margins so
    // the remaining workspace is available for the rest of the script.
    expect(motion.moveTo).toHaveBeenCalledWith(208, 36, {from: {x: 40, y: 0}});
});

test('reduces left padding to retain the right edge of a nearly full-width script', async () => {
    const motion = {jumpTo: jest.fn(), moveTo: jest.fn(() => Promise.resolve()), stop: jest.fn()};
    const harness = makeHarness({motion});
    harness.setBlock({
        focusX: 100,
        focusY: 40,
        rootX: 100,
        rootY: 40,
        rootWidth: 40,
        rootHeight: 20,
        rootTreeWidth: 160
    });
    harness.port.beginTransaction(makeTransaction({viewport: {viewLeft: 20, viewTop: 10}}), 'forward');

    await harness.port.focusTransaction();

    // Use the preferred 32px left margin and retain the remaining 48px on the
    // right rather than allowing any of the script to fall outside the frame.
    expect(motion.moveTo).toHaveBeenCalledWith(168, 16, {from: {x: 40, y: 20}});
});

test('does not chase a wide script edge while its editing region fits', () => {
    const workspace = {
        RTL: false,
        scale: 1,
        getMetrics: () => ({viewWidth: 400, viewHeight: 300}),
        getTopBlocks: () => []
    };
    const active = {
        focus: {left: 100, right: 180, top: 40, bottom: 80},
        root: {left: 100, right: 600, top: 40, bottom: 120}
    };

    expect(safeViewportForFrame(workspace, {viewLeft: 0, viewTop: 0}, active)).toEqual({
        viewLeft: 0,
        viewTop: -24
    });
});

test('prioritizes an input at the far right when the whole script cannot fit', () => {
    const workspace = {scale: 1, getMetrics: () => ({viewWidth: 400, viewHeight: 300}), getTopBlocks: () => []};
    const frame = {focus: {left: 700, right: 760, top: 80, bottom: 100},
        root: {left: 0, right: 800, top: 80, bottom: 120}};
    expect(safeViewportForFrame(workspace, {viewLeft: 0, viewTop: 0}, frame).viewLeft).toBe(668);
});

test('gives an oversized script future coding room and retains that shot for the next block', () => {
    const block = (x, y, width, height) => ({
        getRelativeToSurfaceXY: () => ({x, y}),
        getHeightWidth: () => ({width, height})
    });
    const workspace = {
        RTL: false,
        scale: 1,
        getMetrics: () => ({viewWidth: 400, viewHeight: 300}),
        getTopBlocks: () => [
            block(200, 0, 100, 500),
            block(0, 100, 100, 100)
        ]
    };
    const firstEdit = {
        focus: {left: 200, right: 300, top: 240, bottom: 280},
        root: {left: 200, right: 300, top: 0, bottom: 500}
    };

    const framed = safeViewportForFrame(workspace, {viewLeft: 0, viewTop: 0}, firstEdit);
    expect(framed).toEqual({viewLeft: 168, viewTop: 124});

    const nextEdit = {
        focus: {left: 200, right: 300, top: 280, bottom: 320},
        root: {left: 200, right: 300, top: 0, bottom: 540}
    };
    expect(safeViewportForFrame(workspace, framed, nextEdit)).toEqual(framed);
});

test('frames a missing created block from its recorded destination at the current zoom', async () => {
    const motion = {jumpTo: jest.fn(), moveTo: jest.fn(() => Promise.resolve()), stop: jest.fn()};
    const harness = makeHarness({motion});
    harness.setMetrics({viewLeft: 0, viewTop: 0});
    harness.port.beginTransaction(makeTransaction({
        viewport: {viewLeft: 0, viewTop: 0},
        events: [
            {type: 'create', blockId: 'focus-block'},
            {
                type: 'move',
                blockId: 'focus-block',
                details: {newLocation: {coordinate: {x: 300, y: 200}}}
            }
        ]
    }), 'forward');

    await harness.port.focusTransaction();

    expect(motion.moveTo).toHaveBeenCalledWith(568, 336, {from: {x: 0, y: 0}});
});

test('reserves the incoming flyout block height below a connected creation destination', async () => {
    const motion = {jumpTo: jest.fn(), moveTo: jest.fn(() => Promise.resolve()), stop: jest.fn()};
    const parent = {
        id: 'parent-block',
        type: 'control_wait',
        getRelativeToSurfaceXY: () => ({x: 100, y: 50}),
        getHeightWidth: () => ({width: 60, height: 80}),
        getRootBlock: () => parent,
        getDescendants: () => [parent],
        getSvgRoot: () => null
    };
    const workspace = {
        RTL: false,
        scale: 2,
        getBlockById: id => (id === parent.id ? parent : null),
        getTopBlocks: () => [parent],
        getFlyout: () => ({
            getWorkspace: () => ({
                getAllBlocks: () => [{
                    type: 'motion_movesteps',
                    getHeightWidth: () => ({width: 60, height: 60})
                }]
            })
        }),
        getMetrics: () => ({
            contentLeft: 0,
            contentTop: 0,
            viewLeft: 0,
            viewTop: 0,
            viewWidth: 400,
            viewHeight: 200
        }),
        scrollbar: {set: jest.fn()}
    };
    const port = createScratchBlocksViewportPort({workspace, motion});
    port.beginTransaction(makeTransaction({
        viewport: {viewLeft: 0, viewTop: 0},
        events: [
            {type: 'create', blockId: 'created-block', blockType: 'motion_movesteps'},
            {
                type: 'move',
                blockId: 'created-block',
                details: {newLocation: {parentId: parent.id, inputName: null}}
            }
        ]
    }), 'forward');

    await port.focusTransaction();

    expect(motion.moveTo).toHaveBeenCalledWith(168, 276, {from: {x: 0, y: 0}});
});

test('defers custom-definition framing until the real dialog has created the block', async () => {
    const motion = {jumpTo: jest.fn(), moveTo: jest.fn(() => Promise.resolve()), stop: jest.fn()};
    const harness = makeHarness({motion});
    harness.setMetrics({viewLeft: 0, viewTop: 0});
    harness.port.beginTransaction(makeTransaction({
        viewport: {viewLeft: 0, viewTop: 0},
        events: [
            {
                type: 'create',
                blockId: 'focus-block',
                blockType: 'procedures_definition',
                details: {xml: '<block type="procedures_definition" />'}
            },
            {
                type: 'move',
                blockId: 'focus-block',
                details: {newLocation: {coordinate: {x: 44, y: 44}}}
            }
        ]
    }), 'forward');

    await expect(harness.port.focusTransaction()).resolves.toBe(false);
    expect(motion.moveTo).not.toHaveBeenCalled();

    harness.setBlock({
        type: 'procedures_definition',
        focusX: 44,
        focusY: 44,
        focusWidth: 200,
        focusHeight: 20
    });
    await expect(harness.port.focusTransaction({phase: 'after'})).resolves.toBe(true);
    expect(motion.moveTo).toHaveBeenCalledWith(88, 24, {from: {x: 0, y: 0}});
});

test('frames a regenerated nested edit through its durable block reference', async () => {
    const motion = {jumpTo: jest.fn(), moveTo: jest.fn(() => Promise.resolve()), stop: jest.fn()};
    const harness = makeHarness({motion});
    harness.setMetrics({viewLeft: 0, viewTop: 0});
    harness.setBlock({
        id: 'live-shadow',
        type: 'text',
        focusX: 200,
        focusY: 140,
        focusWidth: 40,
        focusHeight: 20
    });
    harness.port.beginTransaction(makeTransaction({
        viewport: {viewLeft: 0, viewTop: 0},
        events: [{
            type: 'change',
            blockId: 'recorded-shadow',
            blockRef: {
                ancestorId: 'recorded-shadow',
                ancestorType: 'text',
                ancestorCoordinate: {x: 200, y: 140},
                path: []
            }
        }]
    }), 'forward');

    await harness.port.focusTransaction();

    expect(motion.moveTo).toHaveBeenCalledWith(368, 216, {from: {x: 0, y: 0}});
});

test('ignores a recorded viewport during fast history when the affected block is already visible', async () => {
    const motion = {jumpTo: jest.fn(), moveTo: jest.fn(), stop: jest.fn()};
    const harness = makeHarness({motion});
    harness.setMetrics({viewHeight: 400});
    harness.setBlock({focusX: 120, focusY: 50});
    harness.port.beginTransaction(makeTransaction({
        viewport: {viewLeft: 250, viewTop: 150}
    }), 'backward', {presentationMode: VIEWPORT_PRESENTATION_MODES.REVEAL});
    harness.port.observeBeforeAction({eventJson: {blockId: 'focus-block'}});

    await expect(harness.port.focusTransaction()).resolves.toBe(true);

    expect(motion.jumpTo).toHaveBeenCalledWith(40, 20);
    expect(motion.moveTo).not.toHaveBeenCalled();
});

test('uses the shared safe frame instead of accepting an edge-adjacent rendered block', async () => {
    const motion = {jumpTo: jest.fn(), moveTo: jest.fn(), stop: jest.fn()};
    const harness = makeHarness({motion});
    harness.setBlock({
        focusX: 1000,
        focusY: 800,
        renderedRect: {left: 100, right: 140, top: 40, bottom: 60}
    });
    harness.port.beginTransaction(makeTransaction({
        viewport: {viewLeft: 250, viewTop: 150}
    }), 'backward', {presentationMode: VIEWPORT_PRESENTATION_MODES.REVEAL});

    await expect(harness.port.focusTransaction()).resolves.toBe(true);

    expect(motion.jumpTo).not.toHaveBeenCalled();
    expect(motion.moveTo).toHaveBeenCalled();
});

test('reserves the short lifecycle motion before an edge-adjacent block is removed', async () => {
    const motion = {jumpTo: jest.fn(), moveTo: jest.fn(), stop: jest.fn()};
    const harness = makeHarness({motion});
    harness.setMetrics({viewHeight: 400});
    harness.setBlock({focusX: 150, focusY: 50});
    harness.port.beginTransaction(makeTransaction({events: [{
        type: 'create',
        blockId: 'focus-block',
        blockType: 'test_block',
        details: {ids: ['focus-block'], xml: '<block type="test_block" x="150" y="50" />'}
    }]}), 'backward', {presentationMode: VIEWPORT_PRESENTATION_MODES.REVEAL});
    await harness.port.focusTransaction();
    expect(motion.moveTo).toHaveBeenCalled();
});

test('undoing creation frames its current slot, never the original flyout pickup', async () => {
    const motion = {jumpTo: jest.fn(), moveTo: jest.fn(), stop: jest.fn()};
    const harness = makeHarness({motion});
    harness.setMetrics({viewHeight: 400});
    harness.setBlock({focusX: 120, focusY: 50});
    harness.port.beginTransaction(makeTransaction({events: [
        {type: 'create',
            blockId: 'focus-block',
            blockType: 'test_block',
            details: {ids: ['focus-block'], xml: '<block type="test_block" x="-5000" y="0" />'}},
        {type: 'move',
            blockId: 'focus-block',
            details: {
                oldLocation: {coordinate: {x: -5000, y: 0}}, newLocation: {coordinate: {x: 120, y: 50}}
            }}
    ]}), 'backward', {presentationMode: VIEWPORT_PRESENTATION_MODES.REVEAL});
    await harness.port.focusTransaction();
    expect(motion.moveTo).not.toHaveBeenCalled();
});

test('preserves the current viewport throughout bulk rewind', async () => {
    const motion = {jumpTo: jest.fn(), moveTo: jest.fn(), stop: jest.fn()};
    const harness = makeHarness({motion});
    harness.setBlock({focusX: 1000, focusY: 800});
    harness.port.beginTransaction(makeTransaction({
        viewport: {viewLeft: 250, viewTop: 150}
    }), 'backward', {presentationMode: VIEWPORT_PRESENTATION_MODES.PRESERVE});
    harness.port.observeBeforeAction({eventJson: {blockId: 'focus-block'}});

    await expect(harness.port.focusTransaction()).resolves.toBe(true);

    expect(motion.jumpTo).toHaveBeenCalledWith(40, 20);
    expect(motion.moveTo).not.toHaveBeenCalled();
});

test('restores the logical viewport after Blockly changes its content bounds', async () => {
    const motion = {jumpTo: jest.fn(), moveTo: jest.fn(), stop: jest.fn()};
    const harness = makeHarness({motion});
    harness.port.beginTransaction(makeTransaction(), 'backward', {
        presentationMode: VIEWPORT_PRESENTATION_MODES.PRESERVE
    });

    // Disposing the last block can change content bounds and recenter Blockly.
    harness.setMetrics({contentLeft: -100, contentTop: -60, viewLeft: 0, viewTop: 0});
    await harness.port.focusTransaction();

    expect(motion.jumpTo).toHaveBeenCalledWith(140, 80);
    expect(motion.moveTo).not.toHaveBeenCalled();
});

test('defers fast-history creation framing until the rendered block exists', async () => {
    const motion = {jumpTo: jest.fn(), moveTo: jest.fn(), stop: jest.fn()};
    const harness = makeHarness({motion});
    const transaction = makeTransaction({
        viewport: {viewLeft: 250, viewTop: 150},
        events: [
            {type: 'create', blockId: 'focus-block'},
            {
                type: 'move',
                blockId: 'focus-block',
                details: {newLocation: {coordinate: {x: 300, y: 200}}}
            }
        ]
    });
    harness.port.beginTransaction(transaction, 'forward', {
        presentationMode: VIEWPORT_PRESENTATION_MODES.REVEAL
    });

    await expect(harness.port.prepareBeforeAction({
        eventJson: {type: 'create', blockId: 'focus-block', xml: '<block x="0" y="0" />'}
    })).resolves.toBe(false);

    expect(motion.moveTo).not.toHaveBeenCalled();
});

test('frames an old take from the stack root while keeping a low edit visible', async () => {
    const harness = makeHarness();
    harness.setBlock({focusX: 120, focusY: 140, rootX: 100, rootY: 50});
    harness.port.beginTransaction(makeTransaction());
    harness.port.observeBeforeAction({eventJson: {blockId: 'focus-block'}});

    await expect(harness.port.focusTransaction()).resolves.toBe(true);
    expect(harness.workspace.scrollbar.set).toHaveBeenCalledWith(136, 184);
});

test('preserves the current view when a legacy edit is already visible', async () => {
    const motion = {jumpTo: jest.fn(), moveTo: jest.fn(), stop: jest.fn()};
    const harness = makeHarness({motion});
    harness.setBlock({focusX: 120, focusY: 40});
    harness.port.beginTransaction(makeTransaction(), 'forward');
    harness.port.observeBeforeAction({eventJson: {blockId: 'focus-block'}});

    await expect(harness.port.focusTransaction()).resolves.toBe(true);

    expect(motion.jumpTo).toHaveBeenCalledWith(40, 20);
    expect(motion.moveTo).not.toHaveBeenCalled();
});

test('frames the first observed stack position after replay removes the block', async () => {
    const harness = makeHarness();
    harness.setBlock({focusX: 120, focusY: 140, rootX: 100, rootY: 50});
    harness.port.beginTransaction(makeTransaction());
    harness.port.observeBeforeAction({eventJson: {blockId: 'focus-block'}});

    // A backwards create can move to its temporary creation point before it is
    // deleted. The authoring destination must remain the presentation anchor.
    harness.setBlock({focusX: 300, focusY: 300});
    harness.port.observeBeforeAction({eventJson: {blockId: 'focus-block'}});
    harness.removeBlock();

    await expect(harness.port.focusTransaction()).resolves.toBe(true);
    expect(harness.workspace.scrollbar.set).toHaveBeenCalledWith(136, 184);
});

test('carries the outgoing viewport across a sprite workspace switch', async () => {
    const motion = {moveTo: jest.fn(() => Promise.resolve()), stop: jest.fn()};
    const harness = makeHarness({motion});
    harness.port.beginTransaction(makeTransaction({
        viewport: {viewLeft: 100, viewTop: 200}
    }));

    // Selecting another sprite changes both its content bounds and cached view.
    harness.setMetrics({contentLeft: -50, contentTop: -100, viewLeft: 400, viewTop: 500});
    await harness.port.focusTransaction();

    expect(motion.moveTo).toHaveBeenCalledWith(250, 500, {
        from: {x: 90, y: 120}
    });
});

test('waits at an offscreen creation destination before revealing the block', async () => {
    let finishMove;
    const moving = new Promise(resolve => {
        finishMove = resolve;
    });
    const motion = {moveTo: jest.fn(() => moving), stop: jest.fn()};
    const harness = makeHarness({motion});
    const transaction = makeTransaction({
        viewport: {viewLeft: 250, viewTop: 150},
        events: [
            {type: 'create', blockId: 'focus-block'},
            {
                type: 'move',
                blockId: 'focus-block',
                details: {newLocation: {coordinate: {x: 300, y: 200}}}
            }
        ]
    });
    harness.port.beginTransaction(transaction, 'forward');

    let prepared = false;
    const preparation = harness.port.prepareBeforeAction({
        eventJson: {type: 'create', blockId: 'focus-block', xml: '<block x="0" y="0" />'}
    }).then(() => {
        prepared = true;
    });
    await Promise.resolve();

    expect(prepared).toBe(false);
    expect(motion.moveTo).toHaveBeenCalledWith(500, 300, {from: {x: 40, y: 20}});
    finishMove(true);
    await preparation;
    expect(prepared).toBe(true);
});

test('can move concurrently with creation while still finishing before the next transaction', async () => {
    let finishMove;
    const moving = new Promise(resolve => {
        finishMove = resolve;
    });
    const motion = {jumpTo: jest.fn(), moveTo: jest.fn(() => moving), stop: jest.fn()};
    const harness = makeHarness({motion, preCreateMode: PRE_CREATE_CAMERA_MODES.CONCURRENT});
    harness.port.beginTransaction(makeTransaction({
        viewport: {viewLeft: 250, viewTop: 150},
        events: [{type: 'create', blockId: 'focus-block'}]
    }), 'forward');

    await expect(harness.port.prepareBeforeAction({
        eventJson: {type: 'create', blockId: 'focus-block', xml: '<block x="300" y="200" />'}
    })).resolves.toBe(true);
    let focused = false;
    const focusing = harness.port.focusTransaction().then(() => {
        focused = true;
    });
    await Promise.resolve();
    expect(focused).toBe(false);

    harness.setMetrics({contentLeft: -50, contentTop: -100});
    finishMove(true);
    await focusing;
    expect(focused).toBe(true);
    expect(motion.jumpTo).toHaveBeenCalledWith(550, 400);
});

test('frames a legacy offscreen creation from its serialized XML position', async () => {
    const motion = {moveTo: jest.fn(() => Promise.resolve()), stop: jest.fn()};
    const harness = makeHarness({motion});
    harness.port.beginTransaction(makeTransaction({
        events: [{type: 'create', blockId: 'focus-block'}]
    }), 'forward');

    await harness.port.prepareBeforeAction({
        eventJson: {type: 'create', blockId: 'focus-block', xml: '<block x="300" y="200" />'}
    });

    expect(motion.moveTo).toHaveBeenCalledWith(536, 336, {from: {x: 40, y: 20}});
});

test('can disable pre-create movement without changing final transaction framing', async () => {
    const motion = {moveTo: jest.fn(() => Promise.resolve()), stop: jest.fn()};
    const harness = makeHarness({motion, preCreateMode: PRE_CREATE_CAMERA_MODES.OFF});
    harness.port.beginTransaction(makeTransaction({
        viewport: {viewLeft: 250, viewTop: 150},
        events: [{type: 'create', blockId: 'focus-block'}]
    }), 'forward');

    await expect(harness.port.prepareBeforeAction({
        eventJson: {type: 'create', blockId: 'focus-block', xml: '<block x="300" y="200" />'}
    })).resolves.toBe(false);
    expect(motion.moveTo).not.toHaveBeenCalled();
});

test('reveals an aliased native child destination before pointer travel begins', async () => {
    const motion = {moveTo: jest.fn(() => Promise.resolve()), stop: jest.fn()};
    const harness = makeHarness({motion});
    harness.setBlock({
        id: 'live-parent',
        focusX: 110,
        focusY: 250,
        focusWidth: 80,
        focusHeight: 40,
        rootX: 110,
        rootY: 80,
        rootWidth: 120,
        rootHeight: 210
    });

    await expect(harness.port.ensureInteractionVisible({
        blockType: 'motion_movesteps',
        destination: {parentId: 'recorded-parent', inputName: null, coordinate: null}
    }, new Map([['recorded-parent', 'live-parent']]))).resolves.toBe(true);

    expect(motion.moveTo).toHaveBeenCalledTimes(1);
    expect(motion.moveTo.mock.calls[0][0]).toBeGreaterThanOrEqual(0);
    expect(motion.moveTo.mock.calls[0][1]).toBeGreaterThan(20);
});
