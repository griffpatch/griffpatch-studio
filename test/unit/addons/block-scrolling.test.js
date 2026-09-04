import {createSmoothScrollAnimator} from '../../../src/addons/libraries/common/cs/block-scrolling';

describe.each([false, true])('shared scrolling lifecycle (modern Blockly: %s)', modern => {
    let raf;
    let now;
    let frames;
    beforeEach(() => {
        raf = global.requestAnimationFrame;
        now = 0;
        frames = [];
        global.requestAnimationFrame = callback => frames.push(callback);
        jest.spyOn(Date, 'now').mockImplementation(() => now);
    });
    afterEach(() => {global.requestAnimationFrame = raf; jest.restoreAllMocks();});
    const tick = time => {
        now = time;
        const pending = frames.splice(0);
        pending.forEach(callback => callback());
    };
    const fixture = () => {
        const listeners = [];
        // Match DOM listener identity, including capture. Omitting capture from
        // removal used to leak two listeners after every Finder/history pan.
        const svgGroup_ = {
            addEventListener: (type, fn, capture) => listeners.push({type, fn, capture}),
            removeEventListener: (type, fn, capture = false) => {
                const index = listeners.findIndex(item => item.type === type && item.fn === fn &&
                    item.capture === capture);
                if (index >= 0) listeners.splice(index, 1);
            }
        };
        const axis = () => ({handlePosition_: 0, ratio_: 1, scrollViewSize_: 200,
            setHandlePosition: jest.fn()});
        const workspace = {svgGroup_, getMetrics: () => ({viewLeft: 0, viewTop: 0}),
            setMetrics: jest.fn(), scrollbar: {set: jest.fn(), hScroll: axis(), vScroll: axis(),
                getRatio_: position => position / 200}};
        const animate = createSmoothScrollAnimator(modern ? {registry: {}} : {});
        return {listeners, workspace, animate};
    };

    test('completed and superseded pans remove all capturing listeners', async () => {
        const {listeners, workspace, animate} = fixture();
        const first = animate(workspace, 100, 20);
        expect(listeners).toHaveLength(2);
        const second = animate(workspace, 200, 40);
        await first;
        expect(listeners).toHaveLength(2);
        tick(500);
        await second;
        expect(listeners).toHaveLength(0);
    });

    test('an obsolete request stops before the next write and removes its listeners', async () => {
        const {listeners, workspace, animate} = fixture();
        let current = true;
        const pending = animate(workspace, 100, 20, () => current);
        workspace.scrollbar.set.mockClear();
        workspace.setMetrics.mockClear();
        current = false;
        tick(80);
        await pending;
        expect(workspace.scrollbar.set).not.toHaveBeenCalled();
        expect(workspace.setMetrics).not.toHaveBeenCalled();
        expect(listeners).toHaveLength(0);
    });

    test('a real scrollbar interaction cancels without leaked handlers affecting the next pan', async () => {
        const {listeners, workspace, animate} = fixture();
        const pending = animate(workspace, 100, 20);
        listeners.find(item => item.type === 'mousedown').fn({
            target: {classList: {contains: name => name === 'blocklyScrollbarHandle'}}
        });
        await pending;
        expect(listeners).toHaveLength(0);
        const next = animate(workspace, 200, 40);
        tick(500);
        await next;
        expect(listeners).toHaveLength(0);
    });
});
