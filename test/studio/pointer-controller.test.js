import {createPointerController, SPRITE_CLICK_TIMING}
    from '../../src/studio/bridge/native-interaction/pointer-controller';

test('reports every generated travel frame to the gesture callback', async () => {
    const overlay = {
        moveTo: jest.fn(),
        show: jest.fn(),
        settle: jest.fn(),
        remove: jest.fn()
    };
    const resolver = {
        resolve: target => ({id: target.id, kind: target.kind, point: target.point, bounds: {width: 20, height: 20}})
    };
    const model = {
        name: 'test-path',
        plan: () => [{x: 2, y: 3}, {x: 5, y: 7}, {x: 8, y: 9}]
    };
    const clock = {
        play: async ({points, onFrame}) => {
            points.forEach(onFrame);
            return true;
        }
    };
    const pointer = createPointerController({overlay, resolver, model});
    const onFrame = jest.fn();

    await pointer.travelTo({id: 'initial', kind: 'control', point: {x: 0, y: 0}}, {clock});
    const result = await pointer.travelTo({id: 'destination', kind: 'control', point: {x: 8, y: 9}}, {
        clock,
        onFrame
    });

    expect(onFrame.mock.calls.map(([point, index, target]) => ({point, index, target: target.id}))).toEqual([
        {point: {x: 2, y: 3}, index: 0, target: 'destination'},
        {point: {x: 5, y: 7}, index: 1, target: 'destination'},
        {point: {x: 8, y: 9}, index: 2, target: 'destination'}
    ]);
    expect(result).toMatchObject({completed: true, model: 'test-path', initialPlacement: false});
});

test('reveals a hidden pointer when its next genuine journey begins', async () => {
    const overlay = {
        moveTo: jest.fn(),
        show: jest.fn(),
        hide: jest.fn(),
        press: jest.fn(),
        idle: jest.fn(),
        settle: jest.fn(),
        remove: jest.fn()
    };
    const pointer = createPointerController({
        overlay,
        resolver: {resolve: target => ({
            id: target.id,
            kind: target.kind,
            point: target.point,
            bounds: {width: 20, height: 20}
        })},
        model: {name: 'direct', plan: ({from, to}) => [from, to]}
    });
    const clock = {
        play: async ({points, onFrame}) => {
            points.forEach(onFrame);
            return true;
        }
    };

    await pointer.travelTo({id: 'input', kind: 'control', point: {x: 10, y: 10}}, {clock});
    pointer.hideUntilMove();
    pointer.idle();
    expect(pointer.isHiddenUntilMove()).toBe(true);
    expect(overlay.idle).toHaveBeenCalledWith({preserveHidden: true});
    overlay.show.mockClear();
    pointer.press();
    expect(overlay.show).not.toHaveBeenCalled();
    overlay.moveTo.mockClear();
    await pointer.travelTo({id: 'next', kind: 'control', point: {x: 30, y: 20}}, {clock});

    expect(overlay.hide).toHaveBeenCalledTimes(1);
    expect(overlay.show).toHaveBeenCalledTimes(1);
    expect(overlay.moveTo.mock.invocationCallOrder[0]).toBeLessThan(
        overlay.show.mock.invocationCallOrder[0]
    );
    expect(overlay.show.mock.invocationCallOrder[0]).toBeLessThan(
        overlay.moveTo.mock.invocationCallOrder[1]
    );
    expect(overlay.moveTo).toHaveBeenLastCalledWith({x: 30, y: 20});
});

test('sprite clicks pause at the destination and wait for an asynchronous update before the final hold', async () => {
    let frame = -1;
    const events = [];
    let finishUpdate;
    const overlay = {
        moveTo: jest.fn(),
        press: () => events.push(['press', frame]),
        release: () => events.push(['release', frame])
    };
    const pointer = createPointerController({overlay});
    pointer.moveTo({x: 140, y: 240});
    const clock = {play: jest.fn(async ({points, onFrame}) => {
        for (frame = 0; frame < points.length; frame++) {
            expect(points[frame]).toEqual({x: 140, y: 240});
            await onFrame(points[frame], frame);
        }
        return true;
    })};
    const clicked = pointer.click(() => {
        events.push(['update', frame]);
        return new Promise(resolve => {
            finishUpdate = resolve;
        });
    }, {clock, timing: SPRITE_CLICK_TIMING, speed: 1});
    for (let tick = 0; tick < 40; tick++) {
        if (finishUpdate) break;
        await Promise.resolve();
    }
    expect(events).toEqual([['press', 12], ['release', 16], ['update', 16]]);
    expect(frame).toBe(16);
    finishUpdate();
    await expect(clicked).resolves.toBe(true);
    expect(frame).toBe(29);
    expect(clock.play).toHaveBeenCalledWith(expect.objectContaining({speed: 1}));
});

test.each([5, 13])('cancelled sprite click at frame %s never activates and releases a held press', async stop => {
    const overlay = {moveTo: jest.fn(), press: jest.fn(), release: jest.fn()};
    const pointer = createPointerController({overlay});
    pointer.moveTo({x: 140, y: 240});
    const activate = jest.fn();
    const clock = {play: async ({points, onFrame}) => {
        for (let frame = 0; frame < stop; frame++) await onFrame(points[frame], frame);
        return false;
    }};
    await expect(pointer.click(activate, {clock, timing: SPRITE_CLICK_TIMING})).resolves.toBe(false);
    expect(activate).not.toHaveBeenCalled();
    expect(overlay.press).toHaveBeenCalledTimes(stop > 12 ? 1 : 0);
    expect(overlay.release).toHaveBeenCalledTimes(stop > 12 ? 1 : 0);
});
