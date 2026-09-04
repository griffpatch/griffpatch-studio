import {
    scrollBlockIntoViewIfNeeded,
    scrollPosFromOffset
} from '../../../src/addons/libraries/common/cs/block-scrolling';

const makeBlock = ({x = 20, y = 20, width = 60, height = 40} = {}) => {
    const block = {
        width,
        height,
        getRelativeToSurfaceXY: () => ({x, y}),
        getRootBlock: () => block
    };
    return block;
};

const makeWorkspace = ({scale = 1, metrics = {}} = {}) => ({
    scale,
    getMetrics: () => ({
        viewLeft: 0,
        viewTop: 0,
        viewWidth: 400,
        viewHeight: 300,
        scrollLeft: 0,
        scrollTop: 0,
        ...metrics
    }),
    scrollbar: {
        set: jest.fn()
    }
});

describe('Find Bar block scrolling', () => {
    beforeAll(() => {
        global.document = {querySelector: jest.fn(() => null)};
    });

    beforeEach(() => {
        global.document.querySelector.mockReset();
        global.document.querySelector.mockReturnValue(null);
    });

    afterAll(() => {
        delete global.document;
    });

    test('converts new Blockly metrics to scrollbar positions', () => {
        expect(scrollPosFromOffset(
            {left: 240, top: 180},
            {scrollLeft: 20, scrollTop: 30}
        )).toEqual({sx: 220, sy: 150});
    });

    test('falls back to old Blockly content metrics', () => {
        expect(scrollPosFromOffset(
            {left: 240, top: 180},
            {contentLeft: -40, contentTop: -10}
        )).toEqual({sx: 280, sy: 190});
    });

    test('does not scroll a comfortably visible block', async () => {
        const block = makeBlock({x: 80, y: 70, width: 60, height: 40});
        const workspace = makeWorkspace();

        await expect(scrollBlockIntoViewIfNeeded(workspace, block, 32, 32, true)).resolves.toEqual({
            scrolled: false,
            targetX: 0,
            targetY: 0
        });
        expect(workspace.scrollbar.set).not.toHaveBeenCalled();
    });

    test('uses scaled height when deciding whether the block is below the safe frame', async () => {
        const block = makeBlock({x: 40, y: 34, width: 40, height: 60});
        const workspace = makeWorkspace({scale: 3});

        const result = await scrollBlockIntoViewIfNeeded(workspace, block, 32, 32, true);

        expect(result.scrolled).toBe(true);
        expect(workspace.scrollbar.set).toHaveBeenCalledTimes(1);
    });

    test('keeps a nested reporter and its receiving block in the visible frame', async () => {
        const receiver = makeBlock({x: 130, y: 20, width: 90, height: 110});
        const reporter = {
            width: 30,
            height: 20,
            getRelativeToSurfaceXY: () => ({x: 140, y: 50}),
            getRootBlock: () => receiver,
            getOutputShape: () => 1,
            getSurroundParent: () => receiver
        };
        const workspace = makeWorkspace({scale: 2});

        const result = await scrollBlockIntoViewIfNeeded(workspace, reporter, 32, 32, true);

        expect(result.scrolled).toBe(true);
        expect(workspace.scrollbar.set).toHaveBeenCalledTimes(1);
    });

    test('reserves horizontal room for an open Find Bar dropdown', async () => {
        global.document.querySelector.mockReturnValue({offsetWidth: 80});
        const block = makeBlock({x: 90, y: 70, width: 60, height: 40});
        const workspace = makeWorkspace();

        const result = await scrollBlockIntoViewIfNeeded(workspace, block, 32, 32, true);

        expect(result.scrolled).toBe(true);
        expect(workspace.scrollbar.set).toHaveBeenCalledTimes(1);
    });

    test('returns a no-op for a missing workspace or block', async () => {
        await expect(scrollBlockIntoViewIfNeeded(null, makeBlock(), 32, 32, true)).resolves.toEqual({
            scrolled: false,
            targetX: 0,
            targetY: 0
        });
        await expect(scrollBlockIntoViewIfNeeded(makeWorkspace(), null, 32, 32, true)).resolves.toEqual({
            scrolled: false,
            targetX: 0,
            targetY: 0
        });
    });
});
