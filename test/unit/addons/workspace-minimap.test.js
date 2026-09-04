import {
    alignOverviewRect,
    createOverviewModel,
    dampedPanPosition,
    minimapPlacement,
    naturalWorkspaceWorld,
    normalizeRect,
    resizedSquareSide,
    scrollableWorldFromMetrics,
    squareMinimapSize,
    unionRects,
    viewportAtOverviewPoint
} from '../../../src/addons/addons/workspace-minimap/model';
import {
    blockFrame,
    captureWorkspace,
    scrollTargetForViewport
} from '../../../src/addons/addons/workspace-minimap/userscript';
import {createOutlineCache, drawBlockLandmark} from '../../../src/addons/addons/workspace-minimap/silhouette';

describe('workspace minimap silhouettes', () => {
    test('caches only native statement-mouth paths, refreshing when a mouth grows', () => {
        const Path = jest.fn(data => ({data}));
        const outline = createOutlineCache(Path);
        let data = 'M0 0H80V20H16V60H80V80H0Z';
        const svgPath = {getAttribute: () => data};
        const block = {inputList: [{type: 3}], svgPath_: svgPath};
        const first = outline(block);
        expect(outline(block)).toBe(first);
        expect(Path).toHaveBeenCalledTimes(1);
        expect(outline({...block, inputList: [{type: 1}]})).toBeNull();
        expect(outline({...block, svgPath_: null})).toBeNull();
        data = 'M0 0H80V20H16V100H80V120H0Z';
        expect(outline(block)).not.toBe(first);
        expect(Path).toHaveBeenCalledTimes(2);
    });

    test.each([false, true])('draws the native concavity without stretching it, RTL=%s', rtl => {
        const context = Object.fromEntries(['save', 'restore', 'translate', 'scale', 'fill', 'fillRect']
            .map(key => [key, jest.fn()]));
        const path = {};
        drawBlockLandmark(context, {x: 10, y: 12, width: 40, height: 60,
            source: {outline: {path, rtl}}}, 0.25, 2);
        expect(context.fillRect).not.toHaveBeenCalled();
        expect(context.translate).toHaveBeenCalledWith(rtl ? 50 : 10, 12);
        expect(context.scale).toHaveBeenCalledWith(rtl ? -0.25 : 0.25, 0.25);
        expect(context.fill).toHaveBeenCalledWith(path);
        expect(context.restore).toHaveBeenCalledTimes(1);
    });

    test('ordinary tiny blocks retain their crisp minimum-size landmarks', () => {
        const fillRect = jest.fn();
        drawBlockLandmark({fillRect}, {x: 10, y: 12, width: 0.1, height: 0.1, source: {}}, 0.01, 2);
        expect(fillRect).toHaveBeenCalledWith(10, 12, 1, 1);
    });
});

describe('workspace minimap geometry', () => {
    test('fits negative and positive script regions without distorting their aspect ratio', () => {
        const model = createOverviewModel({
            width: 160,
            height: 100,
            blocks: [
                {left: -200, top: -50, width: 100, height: 300, color: '#4c97ff'},
                {left: 500, top: 200, width: 250, height: 80, color: '#ffab19'}
            ],
            viewport: {left: 0, top: 0, width: 400, height: 240}
        });
        expect(model.scale).toBeGreaterThan(0);
        expect(model.blocks).toHaveLength(2);
        expect(model.blocks[0].width / model.blocks[0].height).toBeCloseTo(1 / 3);
        expect(model.blocks.every(block => block.x >= 0 && block.y >= 0 &&
            block.x + block.width <= 160 && block.y + block.height <= 100)).toBe(true);
        expect(model.viewport.x).toBeGreaterThanOrEqual(0);
        expect(model.viewport.y).toBeGreaterThanOrEqual(0);
    });

    test('shows the current viewport even when there are no blocks', () => {
        const model = createOverviewModel({
            width: 156,
            height: 104,
            viewport: {left: 1200, top: -500, width: 600, height: 400}
        });
        expect(model.blocks).toEqual([]);
        expect(model.viewport.width).toBeGreaterThan(0);
        expect(model.viewport.height).toBeGreaterThan(0);
        expect(model.world.left).toBeLessThan(1200);
        expect(model.world.bottom).toBeGreaterThan(-100);
    });

    test('centres navigation on the world point represented by a minimap click', () => {
        const model = createOverviewModel({
            width: 160,
            height: 100,
            blocks: [{left: 0, top: 0, width: 1000, height: 600}],
            viewport: {left: 100, top: 50, width: 400, height: 240}
        });
        const point = {
            x: model.origin.x + ((700 - model.world.left) * model.scale),
            y: model.origin.y + ((400 - model.world.top) * model.scale)
        };
        expect(viewportAtOverviewPoint(model, point)).toEqual({left: 500, top: 280});
    });

    test('keeps block landmarks anchored while only the viewport moves', () => {
        const initial = createOverviewModel({
            width: 160,
            height: 100,
            blocks: [{left: 100, top: 200, width: 180, height: 60}],
            viewport: {left: 0, top: 0, width: 500, height: 300}
        });
        const panned = createOverviewModel({
            width: 160,
            height: 100,
            blocks: [{left: 100, top: 200, width: 180, height: 60}],
            viewport: {left: 240, top: 160, width: 500, height: 300},
            world: initial.world
        });
        expect(panned.world).toEqual(initial.world);
        expect(panned.blocks[0]).toMatchObject({
            x: initial.blocks[0].x,
            y: initial.blocks[0].y,
            width: initial.blocks[0].width,
            height: initial.blocks[0].height
        });
        expect(panned.viewport.x).not.toBe(initial.viewport.x);
        expect(panned.viewport.y).not.toBe(initial.viewport.y);
    });

    test('keeps a navigated viewport inside the stable minimap world', () => {
        const model = createOverviewModel({
            width: 160,
            height: 100,
            blocks: [{left: 0, top: 0, width: 1000, height: 600}],
            viewport: {left: 100, top: 50, width: 400, height: 240}
        });
        const edge = viewportAtOverviewPoint(model, {x: 160, y: 100});
        expect(edge.left).toBeLessThanOrEqual(model.world.right - 400);
        expect(edge.top).toBeLessThanOrEqual(model.world.bottom - 240);
    });

    test('places the overview left of zoom controls and moves it above when space is narrow', () => {
        const common = {
            container: {left: 100, top: 50, width: 800, height: 600},
            size: {width: 156, height: 104}
        };
        expect(minimapPlacement({...common,
            zoom: {left: 820, top: 470, right: 856, bottom: 594, width: 36, height: 124}
        })).toEqual({left: 554, top: 440});
        const narrow = minimapPlacement({
            container: {left: 100, top: 50, width: 210, height: 600},
            zoom: {left: 120, top: 470, right: 156, bottom: 594, width: 36, height: 124},
            size: {width: 156, height: 104}
        });
        expect(narrow.top).toBeLessThan(420);
        expect(narrow.left).toBeGreaterThanOrEqual(8);
    });

    test('rejects malformed rectangles and unions valid coordinates', () => {
        expect(normalizeRect({left: 0, top: 0, width: -1, height: 2})).toBeNull();
        expect(unionRects([
            {left: -2, top: 5, width: 4, height: 5},
            null,
            {left: 8, top: -3, width: 2, height: 4}
        ])).toEqual({left: -2, top: -3, right: 10, bottom: 10, width: 12, height: 13});
    });

    test('uses the complete native scrollbar world at the current Blockly scale', () => {
        expect(scrollableWorldFromMetrics({
            contentLeft: -900,
            contentTop: -450,
            contentWidth: 3000,
            contentHeight: 1800
        }, 1.5)).toEqual({
            left: -600,
            top: -300,
            width: 2000,
            height: 1200,
            right: 1400,
            bottom: 900
        });
        expect(scrollableWorldFromMetrics({contentLeft: 0}, 1)).toBeNull();
        expect(scrollableWorldFromMetrics({
            contentLeft: 0, contentTop: 0, contentWidth: 100, contentHeight: 100
        }, 0)).toBeNull();
    });

    test('frames scripts with half a viewport before and one viewport after the content', () => {
        expect(naturalWorkspaceWorld({
            blocks: [
                {left: 20, top: 30, width: 180, height: 70},
                {left: 820, top: 430, width: 280, height: 170}
            ],
            viewport: {left: 0, top: 0, width: 500, height: 300},
            scrollableWorld: {left: -2000, top: -1500, width: 5000, height: 4000}
        })).toEqual({
            left: -230,
            top: -120,
            right: 1600,
            bottom: 900,
            width: 1830,
            height: 1020
        });
    });

    test('clips natural minimap padding to native travel but retains stale cameras and content', () => {
        expect(naturalWorkspaceWorld({
            blocks: [{left: 10, top: 20, width: 100, height: 50}],
            viewport: {left: -40, top: -20, width: 200, height: 120},
            scrollableWorld: {left: 0, top: 0, width: 150, height: 100}
        })).toEqual({
            left: -40,
            top: -20,
            right: 160,
            bottom: 100,
            width: 200,
            height: 120
        });
        expect(naturalWorkspaceWorld({
            blocks: [],
            viewport: {left: 5, top: 10, width: 200, height: 120},
            scrollableWorld: null
        })).toMatchObject({left: 5, top: 10, width: 200, height: 120});
    });

    test('snaps tiny overview landmarks to physical pixels without losing them', () => {
        expect(alignOverviewRect({x: 2.18, y: 4.24, width: 0.08, height: 3.41}, 2, 1)).toEqual({
            x: 2,
            y: 4,
            width: 1,
            height: 3.5
        });
        expect(alignOverviewRect({x: 0, y: 0, width: 1, height: 1}, 0)).toBeNull();
    });

    test('gives minimap pans a continuous low-pass response with an exact start', () => {
        const pan = {from: {x: 10, y: -20}, to: {x: 110, y: 60}, response: 20};
        expect(dampedPanPosition({...pan, elapsed: 0})).toEqual({x: 10, y: -20});
        expect(dampedPanPosition({...pan, elapsed: 20})).toEqual({
            x: 10 + (100 * (1 - Math.exp(-1))),
            y: -20 + (80 * (1 - Math.exp(-1)))
        });
        const later = dampedPanPosition({...pan, elapsed: 100});
        expect(later.x).toBeGreaterThan(109);
        expect(later.y).toBeGreaterThan(59);
    });

    test('makes invalid or disabled pan interpolation safe and deterministic', () => {
        expect(dampedPanPosition({from: {x: 0, y: 0}, to: {x: 4, y: 8}, elapsed: 1, response: 0}))
            .toEqual({x: 4, y: 8});
        expect(dampedPanPosition({from: {x: 0, y: 0}, to: {x: NaN, y: 8}, elapsed: 1, response: 10}))
            .toBeNull();
    });

    test('keeps preset and custom minimap sizes square within the available editor', () => {
        expect(squareMinimapSize({
            requested: 300,
            container: {width: 900, height: 700}
        })).toEqual({side: 300, minimum: 128, maximum: 520});
        expect(squareMinimapSize({
            requested: 700,
            container: {width: 480, height: 360}
        })).toEqual({side: 344, minimum: 128, maximum: 344});
        expect(squareMinimapSize({
            requested: 156,
            container: {width: 100, height: 90}
        })).toEqual({side: 74, minimum: 74, maximum: 74});
    });

    test('resizes a top-left square handle by its dominant pointer movement and clamps it', () => {
        const resize = {
            startSide: 228,
            startPointer: {x: 100, y: 100},
            minimum: 128,
            maximum: 520
        };
        expect(resizedSquareSide({...resize, pointer: {x: 40, y: 55}})).toBe(288);
        expect(resizedSquareSide({...resize, pointer: {x: 170, y: 250}})).toBe(128);
        expect(resizedSquareSide({...resize, pointer: {x: -500, y: -500}})).toBe(520);
        expect(resizedSquareSide({...resize, pointer: {x: NaN, y: 0}})).toBeNull();
    });

    test('preserves the source metadata of valid blocks after malformed entries are filtered', () => {
        const valid = {id: 'valid', left: 20, top: 30, width: 40, height: 50, color: '#59c059'};
        const model = createOverviewModel({
            width: 156,
            height: 104,
            blocks: [{id: 'invalid', left: 0, top: 0, width: -1, height: 10}, valid],
            viewport: {left: 0, top: 0, width: 400, height: 240}
        });
        expect(model.blocks).toHaveLength(1);
        expect(model.blocks[0].source).toBe(valid);
    });
});

describe('workspace minimap Blockly adapter', () => {
    test('captures a rendered LTR or RTL block without including its next stack', () => {
        const ltrBlock = {
            id: 'one', rendered: true, width: 120, height: 40, RTL: false,
            isShadow: () => false, isSelected: () => true, getColour: () => '#4c97ff',
            getRelativeToSurfaceXY: () => ({x: 30, y: 50})
        };
        const ltr = blockFrame(ltrBlock);
        const rtl = blockFrame({
            id: 'two', rendered: true, width: 80, height: 32, RTL: true,
            isShadow: () => false, isSelected: () => false, getColour: () => '#ffab19',
            getRelativeToSurfaceXY: () => ({x: 210, y: 90})
        });
        expect(ltr).toEqual({id: 'one', left: 30, top: 50, width: 120, height: 40,
            color: '#4c97ff', selected: true});
        expect(rtl.left).toBe(130);
        expect(blockFrame({...ltrBlock, isShadow: () => true})).toBeNull();
    });

    test('converts a desired workspace viewport back to native scrollbar pixels', () => {
        const workspace = {
            scale: 1.5,
            getMetrics: () => ({contentLeft: -300, contentTop: -120})
        };
        expect(scrollTargetForViewport(workspace, {left: 200, top: -40}))
            .toEqual({x: 600, y: 60});
    });

    test('does not recalculate block frames for viewport-only redraws', () => {
        const getAllBlocks = jest.fn(() => []);
        const outlineForBlock = jest.fn();
        const workspace = {
            scale: 2,
            getMetrics: () => ({viewLeft: 20, viewTop: 30, viewWidth: 800, viewHeight: 600}),
            getAllBlocks
        };
        expect(captureWorkspace(workspace, false, outlineForBlock)).toEqual({
            metrics: {viewLeft: 20, viewTop: 30, viewWidth: 800, viewHeight: 600},
            scale: 2,
            viewport: {left: 10, top: 15, width: 400, height: 300},
            world: null,
            blocks: null
        });
        expect(getAllBlocks).not.toHaveBeenCalled();
        expect(outlineForBlock).not.toHaveBeenCalled();
    });
});
