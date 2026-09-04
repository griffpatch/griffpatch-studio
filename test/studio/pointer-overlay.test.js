import {
    POINTER_ART_CLASS,
    POINTER_GLOW_CLASS,
    POINTER_IDLE_FADE_MS,
    POINTER_IDLE_HOLD_MS,
    POINTER_ID,
    POINTER_SHAPE_CLASS,
    createPointerOverlay
} from '../../src/studio/bridge/native-interaction/pointer-overlay';

const makeElement = tagName => ({
    tagName,
    attributes: new Map(),
    children: [],
    dataset: {},
    style: {},
    parentNode: null,
    setAttribute (name, value) {
        this.attributes.set(name, String(value));
    },
    getAttribute (name) {
        return this.attributes.get(name) || null;
    },
    appendChild (child) {
        child.parentNode = this;
        this.children.push(child);
        return child;
    },
    querySelector (selector) {
        const matches = child => (selector.startsWith('.') ?
            child.getAttribute('class') === selector.slice(1) : child.tagName === selector);
        for (const child of this.children) {
            if (matches(child)) return child;
            const descendant = child.querySelector(selector);
            if (descendant) return descendant;
        }
        return null;
    },
    remove () {
        if (!this.parentNode) return;
        this.parentNode.children = this.parentNode.children.filter(child => child !== this);
        this.parentNode = null;
    }
});

const makeDocument = () => {
    const body = makeElement('body');
    return {
        body,
        defaultView: {setTimeout, clearTimeout},
        createElement: makeElement,
        createElementNS: (namespace, tagName) => makeElement(tagName)
    };
};

test('renders a black and white arrow above a red underglow', () => {
    const pointer = createPointerOverlay({documentObject: makeDocument()});
    const art = pointer.element.querySelector(`.${POINTER_ART_CLASS}`);
    const glow = pointer.element.querySelector(`.${POINTER_GLOW_CLASS}`);
    const path = art.querySelector('path');

    expect(pointer.element.id).toBe(POINTER_ID);
    expect(pointer.element.getAttribute('aria-hidden')).toBe('true');
    expect(pointer.element.style.zIndex).toBe('100001');
    expect(pointer.element.style.pointerEvents).toBe('none');
    expect(path.getAttribute('fill')).toBe('#0b0c0f');
    expect(path.getAttribute('stroke')).toBe('#ffffff');
    expect(glow.style.background).toContain('rgba(255, 35, 56');
    expect(glow.style.filter).toBe('blur(4px)');
    expect(glow.style.left).toBe('4px');
    expect(glow.style.top).toBe('4px');
    expect(art.style.filter).toContain('drop-shadow(0 1px 0');
    expect(art.style.filter).toContain('drop-shadow(0 2px 1px');
});

test('keeps a fixed screen hotspot near the neutral tip while the artwork rolls', () => {
    const pointer = createPointerOverlay({documentObject: makeDocument()});
    const art = pointer.element.querySelector(`.${POINTER_ART_CLASS}`);

    pointer.moveTo({x: 100, y: 80});
    pointer.moveTo({x: 180, y: 110});

    expect(pointer.element.style.left).toBe('180px');
    expect(pointer.element.style.top).toBe('110px');
    expect(pointer.element.style.transform).toBe('translate(-17px, -17px)');
    expect(art.style.left).toBe('10px');
    expect(art.style.top).toBe('10px');
    expect(art.style.transformOrigin).toBe('12px 12px');
    expect(parseFloat(pointer.element.dataset.rotation)).toBeGreaterThan(0);
    expect(art.style.transform).toMatch(/^rotate\([\d.]+deg\)$/);
});

test('leans clearly into vertical travel while keeping it slightly below horizontal travel', () => {
    const vertical = createPointerOverlay({documentObject: makeDocument()});
    vertical.moveTo({x: 100, y: 80});
    vertical.moveTo({x: 100, y: 180});
    const verticalRoll = parseFloat(vertical.element.dataset.rotation);

    const horizontal = createPointerOverlay({documentObject: makeDocument()});
    horizontal.moveTo({x: 100, y: 80});
    horizontal.moveTo({x: 200, y: 80});
    const horizontalRoll = parseFloat(horizontal.element.dataset.rotation);

    const upward = createPointerOverlay({documentObject: makeDocument()});
    upward.moveTo({x: 100, y: 180});
    upward.moveTo({x: 100, y: 80});

    expect(verticalRoll).toBeGreaterThan(3);
    expect(verticalRoll).toBeLessThan(horizontalRoll);
    expect(parseFloat(upward.element.dataset.rotation)).toBeLessThan(-3);
});

test('springs the artwork back to neutral and gives fast history travel the same motion', () => {
    const pointer = createPointerOverlay({documentObject: makeDocument()});
    const art = pointer.element.querySelector(`.${POINTER_ART_CLASS}`);
    const glow = pointer.element.querySelector(`.${POINTER_GLOW_CLASS}`);
    const animation = {cancel: jest.fn()};
    art.animate = jest.fn(() => animation);
    glow.animate = jest.fn(() => animation);

    pointer.moveTo({x: 20, y: 20});
    pointer.moveTo({x: 120, y: 40});
    pointer.settle();

    const settleFrames = art.animate.mock.calls[0][0];
    const settleAngles = settleFrames.map(frame => parseFloat(frame.transform.slice(7)));
    expect(settleFrames).toHaveLength(25);
    expect(settleAngles.some(angle => angle > 0)).toBe(true);
    expect(settleAngles.some(angle => angle < 0)).toBe(true);
    expect(settleFrames[settleFrames.length - 1]).toMatchObject({
        transform: 'rotate(0.00deg)',
        offset: 1
    });
    expect(art.animate).toHaveBeenCalledWith(settleFrames, expect.objectContaining({duration: 1200}));
    expect(pointer.element.dataset.rotation).toBe('0.00');

    pointer.animateTravel({x: 120, y: 40}, {x: 80, y: 160}, {durationMs: 420, pickupMs: 70});
    expect(art.animate).toHaveBeenLastCalledWith(expect.arrayContaining([
        expect.objectContaining({offset: 0}),
        expect.objectContaining({offset: 1})
    ]), expect.objectContaining({duration: 420}));
    expect(glow.animate).toHaveBeenCalled();
});

test('compresses around the centre target on press and springs back on release', () => {
    const pointer = createPointerOverlay({documentObject: makeDocument()});
    const shape = pointer.element.querySelector(`.${POINTER_SHAPE_CLASS}`);
    const animation = {cancel: jest.fn()};
    shape.animate = jest.fn(() => animation);

    pointer.moveTo({x: 140, y: 90});
    pointer.press();
    expect(pointer.element.dataset.pressed).toBe('true');
    expect(shape.animate).toHaveBeenLastCalledWith(expect.arrayContaining([
        expect.objectContaining({transform: expect.stringContaining('scale(0.82)')})
    ]), expect.objectContaining({duration: 70}));

    pointer.release();
    expect(pointer.element.dataset.pressed).toBeUndefined();
    expect(shape.animate).toHaveBeenLastCalledWith(expect.arrayContaining([
        expect.objectContaining({transform: expect.stringContaining('scale(1.06)')}),
        expect.objectContaining({transform: expect.stringContaining('scale(1)')})
    ]), expect.objectContaining({duration: 120}));
    expect(pointer.element.style.left).toBe('140px');
    expect(pointer.element.style.top).toBe('90px');
});

test('hides completely for typing and restores without changing the fixed hotspot', () => {
    const pointer = createPointerOverlay({documentObject: makeDocument()});
    pointer.moveTo({x: 140, y: 90});

    pointer.hide();
    expect(pointer.element.style.opacity).toBe('0');
    expect(pointer.element.dataset.hiddenForTyping).toBe('true');

    pointer.show();
    expect(pointer.element.style.opacity).toBe('1');
    expect(pointer.element.dataset.hiddenForTyping).toBeUndefined();
    expect(pointer.element.style.left).toBe('140px');
    expect(pointer.element.style.top).toBe('90px');
});

test('holds after use, fades gently, and removes itself after the idle presentation', () => {
    const scheduled = [];
    const schedule = (callback, delay) => {
        const task = {callback, delay, cancelled: false};
        scheduled.push(task);
        return task;
    };
    const cancelSchedule = task => {
        task.cancelled = true;
    };
    const pointer = createPointerOverlay({
        documentObject: makeDocument(),
        schedule,
        cancelSchedule
    });
    const fadeAnimation = {cancel: jest.fn()};
    pointer.element.animate = jest.fn(() => fadeAnimation);

    pointer.idle();
    expect(pointer.element.dataset.idle).toBe('true');
    expect(pointer.element.style.opacity).toBe('1');
    expect(scheduled[0].delay).toBe(POINTER_IDLE_HOLD_MS);

    scheduled[0].callback();
    expect(pointer.element.dataset.idle).toBeUndefined();
    expect(pointer.element.dataset.fading).toBe('true');
    expect(pointer.element.animate).toHaveBeenCalledWith([
        {opacity: 1},
        {opacity: 0}
    ], expect.objectContaining({duration: POINTER_IDLE_FADE_MS, easing: 'ease-out'}));
    expect(scheduled[1].delay).toBe(POINTER_IDLE_FADE_MS);

    scheduled[1].callback();
    expect(pointer.element.parentNode).toBeNull();
});

test('keeps a typing-hidden pointer invisible through idle retirement', () => {
    const scheduled = [];
    const pointer = createPointerOverlay({
        documentObject: makeDocument(),
        schedule: callback => {
            scheduled.push(callback);
            return scheduled.length;
        },
        cancelSchedule: jest.fn()
    });

    pointer.hide();
    expect(pointer.element.style.opacity).toBe('0');
    expect(pointer.element.dataset.hiddenForTyping).toBe('true');

    pointer.idle();

    expect(pointer.element.style.opacity).toBe('0');
    expect(pointer.element.dataset.hiddenForTyping).toBe('true');
    expect(pointer.element.dataset.idle).toBe('true');
    expect(scheduled).toHaveLength(1);

    scheduled[0]();
    expect(pointer.element.parentNode).toBeNull();
});

test('new pointer activity cancels a pending idle fade', () => {
    const scheduled = [];
    const schedule = (callback, delay) => {
        const task = {callback, delay, cancelled: false};
        scheduled.push(task);
        return task;
    };
    const pointer = createPointerOverlay({
        documentObject: makeDocument(),
        schedule,
        cancelSchedule: task => {
            task.cancelled = true;
        }
    });

    pointer.idle();
    pointer.show();

    expect(scheduled[0].cancelled).toBe(true);
    expect(pointer.element.dataset.idle).toBeUndefined();
    expect(pointer.element.style.opacity).toBe('1');
    expect(pointer.element.parentNode).not.toBeNull();
});

test('new activity retires an idle pointer without suppressing parallel active pointers', () => {
    const documentObject = makeDocument();
    const schedule = () => ({fakeTimer: true});
    const cancelSchedule = () => {};
    const first = createPointerOverlay({documentObject, schedule, cancelSchedule});
    first.idle();

    const second = createPointerOverlay({documentObject, schedule, cancelSchedule});
    expect(first.element.parentNode).toBeNull();
    expect(second.element.parentNode).not.toBeNull();

    const parallel = createPointerOverlay({documentObject, schedule, cancelSchedule});
    expect(second.element.parentNode).not.toBeNull();
    expect(parallel.element.parentNode).not.toBeNull();

    second.remove();
    parallel.remove();
});
