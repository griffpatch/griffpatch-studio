import {
    createInteractionClock,
    generatedPath,
    movementEaseIn,
    movementEaseOut
} from '../../src/studio/bridge/native-interaction/interaction-clock';

test('creation decelerates and deletion accelerates with exact reversible endpoints', () => {
    const enter = generatedPath({x: 0, y: 0}, {x: 100, y: 0}, 4, movementEaseOut).map(point => point.x);
    const exit = generatedPath({x: 100, y: 0}, {x: 0, y: 0}, 4, movementEaseIn).map(point => point.x);
    expect(enter).toEqual([0, 57.8125, 87.5, 98.4375, 100]);
    expect(exit).toEqual([...enter].reverse());
});

test('uses a pronounced symmetric ease-in-out curve for genuine moved-block paths', () => {
    expect(generatedPath({x: 0, y: 0}, {x: 100, y: 40}, 4)).toEqual([
        {x: 0, y: 0},
        {x: 6.25, y: 2.5},
        {x: 50, y: 20},
        {x: 93.75, y: 37.5},
        {x: 100, y: 40}
    ]);
});

test('finishes the remaining native pointer path synchronously at the requested endpoint', async () => {
    let scheduled;
    const cancelFrame = jest.fn();
    const clock = createInteractionClock({
        requestFrame: callback => {
            scheduled = callback;
            return 17;
        },
        cancelFrame
    });
    const frames = [];
    const playback = clock.play({
        points: [{x: 0, y: 0}, {x: 10, y: 10}, {x: 20, y: 20}],
        onFrame: point => frames.push(point)
    });
    await Promise.resolve();

    expect(frames).toEqual([{x: 0, y: 0, hold: false}]);
    expect(typeof scheduled).toBe('function');
    clock.finish();
    await playback;

    expect(cancelFrame).toHaveBeenCalledWith(17);
    expect(frames[frames.length - 1]).toEqual({x: 20, y: 20, hold: false});
});

test('scales native interaction frames without changing their semantic order', async () => {
    const scheduled = [];
    const clock = createInteractionClock({
        requestFrame: callback => {
            scheduled.push(callback);
            return scheduled.length;
        },
        cancelFrame: jest.fn()
    });
    clock.setSpeed(2);
    const frames = [];
    const playback = clock.play({
        points: [{x: 0}, {x: 1}, {x: 2}, {x: 3}],
        onFrame: point => frames.push(point.x)
    });
    while (!scheduled.length) await Promise.resolve();
    expect(frames).toEqual([0, 1]);
    scheduled.shift()();
    await playback;
    expect(frames).toEqual([0, 1, 2, 3]);

    expect(() => clock.setSpeed(0)).toThrow('Playback speed must be positive');
});

test('a click can keep presentation speed without slowing the next history journey', async () => {
    let frames = 0;
    const clock = createInteractionClock({
        requestFrame: callback => {
            frames++;
            Promise.resolve().then(callback);
            return frames;
        },
        cancelFrame: jest.fn()
    });
    clock.setSpeed(3);
    const points = Array.from({length: 13}, () => ({x: 10, y: 20}));
    await clock.play({points, speed: 1, onFrame: () => {}});
    expect(frames).toBe(12);
    frames = 0;
    await clock.play({points, onFrame: () => {}});
    expect(frames).toBe(4);
    await expect(clock.play({points, speed: 0, onFrame: () => {}})).rejects.toThrow('Playback speed');
});
