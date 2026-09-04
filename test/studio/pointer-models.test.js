import {createPointerController} from '../../src/studio/bridge/native-interaction/pointer-controller';
import {
    createDeterministicPointerModel,
    createNaturalPointerModel,
    createPointerModelByName
} from '../../src/studio/bridge/native-interaction/pointer-models';
import {createElementPointerTarget} from '../../src/studio/bridge/native-interaction/pointer-target';

test('keeps deterministic and natural models endpoint-exact while allowing different motion', () => {
    const from = {x: 10, y: 20};
    const to = {x: 210, y: 100};
    const deterministic = createDeterministicPointerModel({frameCount: 4}).plan({from, to});
    const natural = createNaturalPointerModel({random: () => 1}).plan({
        from,
        to,
        targetBounds: {width: 80, height: 32}
    });

    expect(deterministic[0]).toEqual(from);
    expect(deterministic[deterministic.length - 1]).toEqual(to);
    expect(natural[0]).toEqual(from);
    expect(natural[natural.length - 1]).toEqual(to);
    expect(natural.some((point, index) => deterministic[index] &&
        point.y !== deterministic[index].y)).toBe(true);
});

test('gives natural travel a restrained overshoot before settling exactly on target', () => {
    const from = {x: 10, y: 20};
    const to = {x: 210, y: 100};
    const natural = createNaturalPointerModel({random: () => 0.5}).plan({
        from,
        to,
        targetBounds: {width: 80, height: 32}
    });
    const distance = Math.hypot(to.x - from.x, to.y - from.y);
    const unit = {x: (to.x - from.x) / distance, y: (to.y - from.y) / distance};
    const projectionPastTarget = point => ((point.x - to.x) * unit.x) + ((point.y - to.y) * unit.y);
    const projections = natural.map(projectionPastTarget);
    const maximumProjection = Math.max(...projections);
    const overshootIndex = projections.indexOf(maximumProjection);
    const recoil = projections.slice(overshootIndex);

    expect(maximumProjection).toBeGreaterThan(0);
    expect(maximumProjection).toBeLessThanOrEqual(6);
    expect(recoil).toHaveLength(7);
    expect(recoil.every((projection, index) => index === 0 || projection <= recoil[index - 1])).toBe(true);
    expect(recoil.every(projection => projection >= -Number.EPSILON)).toBe(true);
    expect(natural[natural.length - 1]).toEqual(to);
});

test('spends natural travel frames accelerating and decelerating around a fast middle', () => {
    const points = createNaturalPointerModel({
        random: () => 0.5,
        minimumFrames: 12,
        maximumFrames: 12,
        recoilFrames: 1,
        maximumOvershootPx: 0
    }).plan({
        from: {x: 0, y: 0},
        to: {x: 120, y: 0},
        targetBounds: {width: 30, height: 20}
    }).slice(0, 13);
    const distances = points.slice(1).map((point, index) => point.x - points[index].x);

    expect(distances[5]).toBeGreaterThan(distances[0] * 8);
    expect(distances[6]).toBeGreaterThan(distances[11] * 8);
    expect(points[3].x).toBeLessThan(10);
    expect(points[9].x).toBeGreaterThan(110);
});

test('leaves deterministic travel free of natural-model overshoot', () => {
    const from = {x: 10, y: 20};
    const to = {x: 210, y: 100};
    const deterministic = createDeterministicPointerModel({frameCount: 12}).plan({from, to});
    const distance = Math.hypot(to.x - from.x, to.y - from.y);
    const unit = {x: (to.x - from.x) / distance, y: (to.y - from.y) / distance};

    expect(deterministic.every(point =>
        (((point.x - to.x) * unit.x) + ((point.y - to.y) * unit.y)) <= 0
    )).toBe(true);
    expect(deterministic[deterministic.length - 1]).toEqual(to);
});

test('selects pointer models by stable public name and rejects unknown models', () => {
    expect(createPointerModelByName('natural', {random: () => 0.5}).name).toBe('natural');
    expect(createPointerModelByName('deterministic', {frameCount: 3}).name).toBe('deterministic');
    expect(() => createPointerModelByName('recorded')).toThrow('Unknown pointer model: recorded');
});

test('travels between freshly resolved targets and retains position for the next action', async () => {
    const overlay = {
        moveTo: jest.fn(),
        settle: jest.fn(),
        press: jest.fn(),
        release: jest.fn(),
        show: jest.fn(),
        hide: jest.fn(),
        remove: jest.fn(),
        element: {}
    };
    const model = createDeterministicPointerModel({frameCount: 2});
    const controller = createPointerController({overlay, model});
    const clock = {
        play: async ({points, onFrame}) => {
            points.forEach(onFrame);
            return true;
        }
    };
    const element = {getBoundingClientRect: () => ({left: 100, top: 40, width: 60, height: 20})};
    const target = createElementPointerTarget({id: 'dropdown:item:mouse', locate: () => element});

    const initial = await controller.travelTo(target, {clock});
    expect(initial.initialPlacement).toBe(true);
    expect(controller.getPosition()).toEqual({x: 130, y: 50});
    expect(overlay.settle).toHaveBeenCalledTimes(1);

    element.getBoundingClientRect = () => ({left: 300, top: 200, width: 80, height: 40});
    const moved = await controller.travelTo(target, {clock});
    expect(moved.initialPlacement).toBe(false);
    expect(moved.frames).toHaveLength(3);
    expect(controller.getPosition()).toEqual({x: 340, y: 220});
    expect(overlay.settle).toHaveBeenCalledTimes(2);

    const activate = jest.fn();
    expect(await controller.click(activate, {clock})).toBe(true);
    expect(overlay.press).toHaveBeenCalledTimes(1);
    expect(activate).toHaveBeenCalledTimes(1);
    expect(overlay.release).toHaveBeenCalledTimes(1);
    controller.hide();
    expect(overlay.hide).toHaveBeenCalledTimes(1);
    expect(overlay.show).not.toHaveBeenCalled();
    controller.moveTo({x: 341, y: 220});
    expect(overlay.show).toHaveBeenCalledTimes(1);
    controller.remove();
    expect(overlay.remove).toHaveBeenCalledTimes(1);
});
