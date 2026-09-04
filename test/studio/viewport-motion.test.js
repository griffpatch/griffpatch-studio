import {createViewportMotion} from '../../src/studio/bridge/viewport-motion';

const makeHarness = ({x = 0, y = 0} = {}) => {
    let position = {x, y};
    let time = 0;
    let nextFrameId = 1;
    const frames = new Map();
    const writes = [];
    const motion = createViewportMotion({
        read: () => position,
        write: (nextX, nextY) => {
            position = {x: nextX, y: nextY};
            writes.push(position);
        },
        requestFrame: callback => {
            const id = nextFrameId++;
            frames.set(id, callback);
            return id;
        },
        cancelFrame: id => frames.delete(id),
        now: () => time
    });
    const advance = nextTime => {
        time = nextTime;
        const callbacks = [...frames.values()];
        frames.clear();
        callbacks.forEach(callback => callback(time));
    };
    return {
        advance,
        getPosition: () => position,
        motion,
        writes
    };
};

test('eases between the current and requested viewport positions', async () => {
    const harness = makeHarness();
    const completed = harness.motion.moveTo(300, 400);

    harness.advance(100);
    expect(harness.getPosition().x).toBeGreaterThan(0);
    expect(harness.getPosition().x).toBeLessThan(300);

    harness.advance(450);
    await expect(completed).resolves.toBe(true);
    expect(harness.getPosition()).toEqual({x: 300, y: 400});
});

test('snaps imperceptible movement without scheduling animation frames', async () => {
    const harness = makeHarness({x: 10, y: 10});

    await expect(harness.motion.moveTo(11, 11)).resolves.toBe(false);
    expect(harness.getPosition()).toEqual({x: 11, y: 11});
    expect(harness.writes).toHaveLength(1);
});

test('stops an active move before starting a replacement', async () => {
    const harness = makeHarness();
    const first = harness.motion.moveTo(300, 400);
    const second = harness.motion.moveTo(100, 0);

    await expect(first).resolves.toBe(false);
    harness.advance(450);
    await expect(second).resolves.toBe(true);
    expect(harness.getPosition()).toEqual({x: 100, y: 0});
});

test('preserves a supplied starting position before the first animation frame', async () => {
    const harness = makeHarness({x: 500, y: 500});
    const completed = harness.motion.moveTo(100, 200, {from: {x: 10, y: 20}});

    expect(harness.getPosition()).toEqual({x: 10, y: 20});
    harness.advance(450);
    await completed;
    expect(harness.getPosition()).toEqual({x: 100, y: 200});
});

test('jumps to an exact anchor and cancels an active movement', async () => {
    const harness = makeHarness();
    const moving = harness.motion.moveTo(300, 400);

    harness.motion.jumpTo(25, 50);

    await expect(moving).resolves.toBe(false);
    expect(harness.getPosition()).toEqual({x: 25, y: 50});
});

test('scales camera duration with playback speed without changing its endpoint', async () => {
    const fast = makeHarness();
    const fastMove = fast.motion.moveTo(300, 0, {speed: 2});
    fast.advance(99);
    expect(fast.getPosition().x).toBeLessThan(300);
    fast.advance(100);
    await expect(fastMove).resolves.toBe(true);
    expect(fast.getPosition()).toEqual({x: 300, y: 0});

    const slow = makeHarness();
    const slowMove = slow.motion.moveTo(300, 0, {speed: 0.5});
    slow.advance(200);
    expect(slow.getPosition().x).toBeGreaterThan(0);
    expect(slow.getPosition().x).toBeLessThan(300);
    slow.advance(400);
    await expect(slowMove).resolves.toBe(true);
    expect(slow.getPosition()).toEqual({x: 300, y: 0});

    expect(() => slow.motion.moveTo(0, 0, {speed: 0})).toThrow('Camera speed must be positive');
});
