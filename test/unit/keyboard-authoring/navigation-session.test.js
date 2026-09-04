import {NavigationSession, locationKey} from '../../../src/experiments/keyboard-authoring/navigation-session';
import {navigate, navigationStops, outerScriptBoundary, positionKey} from
    '../../../src/experiments/keyboard-authoring/navigation';

const root = (id, x, y, height = 40, {hat = false, cap = false} = {}) => {
    const context = {blockId: id, rowId: id, scriptId: id,
        bounds: {x, y, width: 144, height}, scriptBounds: {x, y, width: 144, height}};
    return [{kind: 'block', ...context, canInsertBefore: !hat},
        ...cap ? [] : [{kind: 'gap', ...context}]];
};
const base = [...root('left', 100, 100), ...root('right', 440, 100)];
const left = base[0];
const right = base[2];

test.each(['ArrowLeft', 'ArrowRight'])('hat origins survive full-band column journeys (%s)', key => {
    const hat = root('hat', 100, 63.5, 64.5, {hat: true})[0];
    hat.bounds.originY = 80;
    const sign = key === 'ArrowRight' ? 1 : -1;
    const middle = root('tall-c', 100 + (300 * sign), 50, 240)[0];
    middle.bounds.originY = 50;
    const stops = [hat, middle];
    const session = new NavigationSession();
    session.move(stops, hat, key);
    expect(session.move(stops, hat, key).position).toBe(middle);
    session.move(stops, middle, key);
    const free = session.move(stops, middle, key).position;
    expect(free).toMatchObject({kind: 'workspace', y: 80});
    expect(session.lane.span).toEqual({y: 63.5, height: 64.5, originY: 80});
    const further = session.move(stops, free, key).position;
    expect(further.y).toBe(80);
    const reverse = key === 'ArrowRight' ? 'ArrowLeft' : 'ArrowRight';
    const back = session.move(stops, further, reverse).position;
    expect(session.move(stops, back, reverse).position).toBe(middle);
    session.move(stops, middle, reverse);
    expect(session.move(stops, middle, reverse).position).toBe(hat);
    session.cancel();
    session.move(stops, middle, key);
    expect(session.move(stops, middle, key).position.y).toBe(50);
});

test('a range beginning with a raised hat places from its native row, not its contour', () => {
    const hat = root('hat', 100, 63.5, 64.5, {hat: true})[0];
    hat.bounds.originY = 80;
    const tail = {...root('tail', 100, 128)[0], scriptId: 'hat', scriptBounds: hat.scriptBounds};
    tail.bounds.originY = 128;
    const session = new NavigationSession();
    const stops = [hat, tail];
    const range = {blockIds: ['hat', 'tail']};
    session.move(stops, tail, 'ArrowRight', {range});
    expect(session.move(stops, tail, 'ArrowRight', {range}).position.y).toBe(80);
    expect(session.lane.span).toEqual({y: 63.5, height: 104.5, originY: 80});
});

test('horizontal baseline intent survives another column and a taller intervening script', () => {
    const start = root('start', 0, 100, 80)[0];
    start.bounds = {...start.bounds, originY: 124, baselineY: 150};
    const middle = root('middle', 300, 50, 240)[0];
    middle.bounds = {...middle.bounds, originY: 50, baselineY: 76};
    const stops = [start, middle];
    const session = new NavigationSession();
    session.move(stops, start, 'ArrowRight');
    expect(session.move(stops, start, 'ArrowRight').position).toBe(middle);
    session.move(stops, middle, 'ArrowRight');
    const free = session.move(stops, middle, 'ArrowRight').position;
    expect(free).toMatchObject({kind: 'workspace', y: 124, baselineY: 150});
    expect(session.move(stops, free, 'ArrowRight').position).toMatchObject({y: 124, baselineY: 150});
});

test.each(['ArrowUp', 'ArrowDown'])('free %s pauses at adjacent script-head baselines without sticking', key => {
    const down = key === 'ArrowDown';
    const head = root('head', 0, 80, 64.5, {hat: true})[0];
    head.bounds = {...head.bounds, originY: 96.5, baselineY: 122.5};
    const nested = {...root('nested', 24, down ? 35 : 150)[0], scriptId: 'head'};
    nested.bounds = {...nested.bounds, originY: nested.bounds.y, baselineY: nested.bounds.y + 26};
    const session = new NavigationSession();
    const start = {kind: 'workspace', x: 300, y: down ? 20 : 170};
    const snapped = session.move([head, nested], start, key).position;
    expect(snapped).toEqual({kind: 'workspace', x: 300, y: 96.5, baselineY: 122.5});
    expect(session.move([head, nested], snapped, key).position)
        .toMatchObject({y: 96.5 + (down ? 96 : -96), baselineY: 122.5 + (down ? 96 : -96)});
});

test('guides use the nearest crossed head and ignore columns beyond their neighbours', () => {
    const far = root('far', -300, 140)[0];
    const near = root('near', 0, 80)[0];
    const nearHigher = root('higher', 0, 50)[0];
    for (const at of [far, near, nearHigher]) at.bounds = {...at.bounds, originY: at.bounds.y, baselineY: at.bounds.y + 26};
    const session = new NavigationSession();
    const at = session.move([far, near, nearHigher], {kind: 'workspace', x: 300, y: 160}, 'ArrowUp').position;
    expect(at).toMatchObject({y: 80, baselineY: 106});
    expect(session.move([far, near, nearHigher], at, 'ArrowUp').position).toMatchObject({y: 50});
});

test('same-column stack entry wins over an earlier neighbouring baseline guide', () => {
    const adjacent = root('adjacent', 0, 120)[0];
    adjacent.bounds = {...adjacent.bounds, originY: 120, baselineY: 146};
    const own = root('own', 300, 40);
    const session = new NavigationSession();
    expect(session.move([adjacent, ...own], {kind: 'workspace', x: 300, y: 150}, 'ArrowUp').position).toBe(own[1]);
});

test.each(['ArrowUp', 'ArrowDown'])('free %s reaches a guide just beyond its step without distant attraction', key => {
    const sign = key === 'ArrowDown' ? 1 : -1;
    const start = {kind: 'workspace', x: 300, y: 200, baselineY: 226};
    for (const distance of [108, 120, 121]) {
        const target = 200 + (sign * distance);
        const head = root('head', 0, target)[0];
        head.bounds = {...head.bounds, originY: target, baselineY: target + 26};
        const result = navigate([head], start, key);
        const expected = distance <= 120 ? target : 200 + (sign * 96);
        expect(result).toMatchObject({kind: 'workspace', y: expected, baselineY: expected + 26});
        if (distance <= 120) {
            expect(navigate([head], result, key).y).toBe(target + (sign * 96));
        }
    }
    // A guide already crossed in the step wins over one just past its end.
    const guides = [60, 108].map(distance => {
        const at = root(String(distance), 0, 200 + (sign * distance))[0];
        at.bounds = {...at.bounds, originY: at.bounds.y, baselineY: at.bounds.y + 26};
        return at;
    });
    expect(navigate(guides, start, key).y).toBe(200 + (sign * 60));
});

test.each(['ArrowUp', 'ArrowDown'])('free %s uses the same shortfall tolerance for a native stack boundary', key => {
    const down = key === 'ArrowDown';
    for (const distance of [120, 121]) {
        const boundary = 200 + (down ? distance : -distance);
        const own = root('own', 300, down ? boundary : boundary - 40);
        const result = navigate(own, {kind: 'workspace', x: 300, y: 200}, key);
        expect(result).toMatchObject(distance === 120 ?
            {kind: down ? 'before' : 'gap', blockId: 'own'} :
            {kind: 'workspace', x: 300, y: 200 + (down ? 96 : -96)});
    }
});

test.each(['ArrowLeft', 'ArrowRight'])('%s needs a distinct second press to leave a script', key => {
    const session = new NavigationSession();
    const position = key === 'ArrowRight' ? left : right;
    const expected = key === 'ArrowRight' ? right : left;
    expect(session.move(base, position, key)).toEqual({position, blocked: true});
    for (let i = 0; i < 8; i++) {
        expect(session.move(base, position, key, {repeat: true})).toEqual({position, blocked: true});
    }
    expect(session.move(base, position, key)).toEqual({position: expected, blocked: false});
    expect(session.pending).toBeNull();
});

test('a different move or explicit cancellation resets a pending column exit', () => {
    const session = new NavigationSession();
    session.move(base, left, 'ArrowRight');
    session.move(base, left, 'Home');
    expect(session.move(base, left, 'ArrowRight').blocked).toBe(true);
    session.cancel();
    expect(session.move(base, left, 'ArrowRight').blocked).toBe(true);
});

test('distinct presses use keyup even when the host does not mark repeat', () => {
    const session = new NavigationSession();
    const press = () => session.move(base, left, 'ArrowRight', {repeat: session.keyDown('ArrowRight')});
    expect(press().blocked).toBe(true);
    expect(press().blocked).toBe(true);
    session.keyUp('ArrowRight');
    expect(press()).toEqual({position: right, blocked: false});
    session.blur();
    expect(session.keyDown('ArrowRight')).toBe(false);
});

test('inline inputs never require a second press', () => {
    const input = {kind: 'input', blockId: 'left', inputName: 'N', rowId: 'left', scriptId: 'left'};
    const stops = [left, input, ...base.slice(1)];
    const session = new NavigationSession();
    expect(session.move(stops, left, 'ArrowRight')).toEqual({position: input, blocked: false});
    expect(session.move(stops, input, 'ArrowRight').blocked).toBe(true);
});

test.each(['ArrowLeft', 'ArrowRight'])('a nested body row uses the same two-press column exit for %s', key => {
    const owner = root('owner', 100, 100, 180)[0];
    const mouth = {kind: 'gap', blockId: 'owner', inputName: 'BODY'};
    const body = {...root('body', 124, 160)[0], scriptId: 'owner', scriptBounds: owner.scriptBounds,
        bodyPosition: mouth};
    const operand = {kind: 'input', blockId: 'body', inputName: 'N', rowId: 'body', scriptId: 'owner'};
    const neighbour = root('neighbour', key === 'ArrowRight' ? 440 : -240, 160)[0];
    const stops = [owner, body, operand, neighbour];
    const start = key === 'ArrowRight' ? operand : body;
    const session = new NavigationSession();
    expect(session.move(stops, start, key)).toEqual({position: start, blocked: true});
    expect(session.pending.direction).toBe(key === 'ArrowRight' ? 'right' : 'left');
    expect(session.move(stops, start, key, {repeat: true})).toEqual({position: start, blocked: true});
    expect(session.move(stops, start, key)).toEqual({position: neighbour, blocked: false});
    const reverse = key === 'ArrowRight' ? 'ArrowLeft' : 'ArrowRight';
    expect(session.move(stops, neighbour, reverse)).toEqual({position: neighbour, blocked: true});
    expect(session.move(stops, neighbour, reverse)).toEqual({position: body, blocked: false});
});

test.each(['ArrowLeft', 'ArrowRight'])('nested rows round-trip through empty columns using their full band (%s)', key => {
    for (const offset of [-400, 0, 850]) {
        // All three centres coincide: neither always selecting the outer C nor
        // always selecting the deepest child preserves the selected band.
        const outer = root('outer', 100 + offset, 100 + offset, 240)[0];
        const inner = {...root('inner', 124 + offset, 160 + offset, 120)[0], scriptId: outer.scriptId,
            scriptBounds: outer.scriptBounds, bodyPosition: {kind: 'gap', blockId: outer.blockId, inputName: 'THEN'}};
        const body = {...root('body', 148 + offset, 200 + offset)[0], scriptId: outer.scriptId,
            scriptBounds: outer.scriptBounds, bodyPosition: {kind: 'gap', blockId: inner.blockId, inputName: 'BODY'}};
        const stops = [outer, inner, body];
        const reverse = key === 'ArrowRight' ? 'ArrowLeft' : 'ArrowRight';
        for (const start of stops) {
            const session = new NavigationSession();
            expect(session.move(stops, start, key)).toEqual({position: start, blocked: true});
            const free = session.move(stops, start, key).position;
            expect(free).toMatchObject({kind: 'workspace', y: start.bounds.y});
            const further = session.move(stops, free, key);
            expect(further.blocked).toBe(false);
            const back = session.move(stops, further.position, reverse);
            expect(back.blocked).toBe(false);
            expect(back.position.x).toBe(free.x);
            expect(session.move(stops, back.position, reverse)).toEqual({position: start, blocked: false});
            expect(session.lane.span).toEqual({y: start.bounds.y, height: start.bounds.height});
        }
    }
});

test('a free caret moved vertically chooses the body row at its new height, not the old departure', () => {
    const owner = root('owner', 100, 100, 260)[0];
    const thenRow = {...root('then', 124, 200)[0], scriptId: 'owner', scriptBounds: owner.scriptBounds,
        bodyPosition: {kind: 'gap', blockId: 'owner', inputName: 'THEN'}};
    const elseRow = {...root('else', 124, 296)[0], scriptId: 'owner', scriptBounds: owner.scriptBounds,
        bodyPosition: {kind: 'gap', blockId: 'owner', inputName: 'ELSE'}};
    const stops = [owner, thenRow, elseRow];
    const session = new NavigationSession();
    session.move(stops, thenRow, 'ArrowRight');
    const free = session.move(stops, thenRow, 'ArrowRight').position;
    const down = session.move(stops, free, 'ArrowDown').position;
    expect(session.move(stops, down, 'ArrowLeft')).toEqual({position: elseRow, blocked: false});
    // A fresh spatial entry also considers nested rows; this is not an
    // origin-ID special case which only makes immediate reversal work.
    const fresh = new NavigationSession();
    expect(fresh.move(stops, {kind: 'workspace', x: free.x, y: 296}, 'ArrowLeft').position).toBe(elseRow);
});

test('new columns use the gate only when departing a script, not when already free', () => {
    const session = new NavigationSession();
    expect(session.move(base, right, 'ArrowRight').blocked).toBe(true);
    const free = session.move(base, right, 'ArrowRight').position;
    expect(free).toMatchObject({kind: 'workspace', x: 680, y: 100});
    const further = session.move(base, free, 'ArrowRight');
    expect(further.blocked).toBe(false);
    expect(further.position.x).toBe(920);
    const back = session.move(base, further.position, 'ArrowLeft');
    expect(back.blocked).toBe(false);
    expect(back.position.x).toBe(free.x);
    expect(session.move(base, back.position, 'ArrowLeft')).toEqual({position: right, blocked: false});
});

test('a free caret follows height, not an obsolete departure point', () => {
    const stops = [...base, ...root('lowerRight', 440, 292)];
    const session = new NavigationSession();
    let free = {kind: 'workspace', x: 680, y: 100};
    free = session.move(stops, free, 'ArrowDown').position;
    free = session.move(stops, free, 'ArrowDown').position;
    expect(free.y).toBe(292);
    expect(session.move(stops, free, 'ArrowLeft').position.blockId).toBe('lowerRight');
});

test.each([false, true])('free movement stops at an encountered head without crossing it (hat %s)', hat => {
    const stops = root('near', 100, 120, 40, {hat});
    expect(navigate(stops, {kind: 'workspace', x: 100, y: 100}, 'ArrowDown')).toMatchObject({
        kind: hat ? 'block' : 'before', blockId: 'near'
    });
});

test.each([false, true])('free upward movement respects the outer tail (cap %s)', cap => {
    const stops = root('near', 100, 120, 40, {cap});
    expect(navigate(stops, {kind: 'workspace', x: 100, y: 180}, 'ArrowUp')).toMatchObject({
        kind: cap ? 'block' : 'gap', blockId: 'near'
    });
});

test('empty workspaces allow free movement and distinct location identity', () => {
    const start = {kind: 'workspace', x: 100, y: 100};
    const next = navigate([], start, 'ArrowDown');
    expect(next).toMatchObject({x: 100, y: 196});
    expect(locationKey(start)).not.toBe(locationKey(next));
    expect(navigate([], next, 'ArrowUp')).toEqual(start);
});

test('an input on a root follows the same two-stage Up boundary as its command', () => {
    const stops = [...root('upper', 100, 0), ...root('lower', 100, 180),
        {kind: 'input', blockId: 'lower', inputName: 'N', rowId: 'lower', scriptId: 'lower'}];
    const before = navigate(stops, stops[4], 'ArrowUp');
    expect(before).toEqual({kind: 'before', blockId: 'lower'});
    expect(positionKey(navigate(stops, before, 'ArrowUp'))).toBe('gap:upper::');
});

test('outer Home End never select a nested branch tail', () => {
    const stops = [...root('outer', 100, 100, 200, {hat: true, cap: true}),
        {...root('inside', 124, 140)[0], scriptId: 'outer', bodyPosition: {kind: 'gap', blockId: 'outer', inputName: 'BODY'}}];
    expect(outerScriptBoundary(stops, stops[1])).toBe(stops[0]);
    expect(outerScriptBoundary(stops, stops[1], true)).toBe(stops[0]);
    const lower = root('lower', 100, 400)[0];
    expect(navigate([...stops, lower], {kind: 'before', blockId: 'lower'}, 'ArrowUp')).toBe(stops[0]);
});

test('a head insertion caret is still anchored and confirms a horizontal departure', () => {
    const session = new NavigationSession();
    const before = {kind: 'before', blockId: left.blockId};
    expect(session.move(base, before, 'ArrowRight')).toEqual({position: before, blocked: true});
    expect(session.move(base, before, 'ArrowRight')).toEqual({position: right, blocked: false});
});

test.each([200, 1000])('snapshot sizing is linear for a rendered %s-block stack', size => {
    let next = null;
    let measurements = 0;
    for (let i = size - 1; i >= 0; i--) {
        const tail = next;
        next = {id: String(i), inputList: [], isShadow: () => false,
            previousConnection: {}, nextConnection: {}, getNextBlock: () => tail,
            getRelativeToSurfaceXY: () => ({x: 100, y: i * 36}),
            svgPath_: {getBBox: () => ({x: 0, y: 0, width: 144, height: 40})},
            getHeightWidth: () => {
                measurements++;
                return {width: 144, height: tail ? tail.getHeightWidth().height + 36 : 40};
            }};
    }
    const stops = navigationStops({getTopBlocks: () => [next]});
    expect(stops).toHaveLength(size * 2);
    expect(measurements).toBe(size);
});

test('spatial destinations are invariant under translating the entire layout', () => {
    for (const offset of [-500, 0, 900]) {
        const stops = [...root('left', 100 + offset, 100 + offset), ...root('right', 440 + offset, 100 + offset)];
        expect(navigate(stops, stops[0], 'ArrowRight').blockId).toBe('right');
        expect(navigate(stops, {kind: 'workspace', x: 680 + offset, y: 100 + offset}, 'ArrowLeft').blockId).toBe('right');
    }
});

test.each([-500, 0, 900])('column sequences retain the original full height at offset %s', offset => {
    const stops = [...root('a', 0, 120 + offset, 40), ...root('b', 300, 100 + offset, 300),
        ...root('c-high', 600, 120 + offset, 40), ...root('c-low', 600, 250 + offset, 40)];
    const session = new NavigationSession();
    const cross = (at, key) => {
        expect(session.move(stops, at, key).blocked).toBe(true);
        return session.move(stops, at, key).position;
    };
    const middle = cross(stops[0], 'ArrowRight');
    expect(middle.blockId).toBe('b');
    expect(cross(middle, 'ArrowRight').blockId).toBe('c-high');
    expect(cross(stops[4], 'ArrowLeft').blockId).toBe('b');
    expect(cross(stops[2], 'ArrowLeft').blockId).toBe('a');
    // A deliberate local change (or pointer selection) starts a new band.
    session.cancel();
    expect(cross(stops[2], 'ArrowRight').blockId).toBe('c-low');
});

test('a retained lane crosses free space without changing its height, and vertical movement resets it', () => {
    const stops = [...root('a', 0, 120, 40), ...root('b', 300, 100, 300)];
    const session = new NavigationSession();
    session.move(stops, stops[0], 'ArrowRight');
    const b = session.move(stops, stops[0], 'ArrowRight').position;
    session.move(stops, b, 'ArrowRight');
    const free = session.move(stops, b, 'ArrowRight').position;
    expect(free.y).toBe(120);
    const more = session.move(stops, free, 'ArrowRight').position;
    expect(more.y).toBe(120);
    const down = session.move(stops, more, 'ArrowDown').position;
    expect(down.y).toBe(216);
    expect(session.lane).toBeNull();
});

test('a structural input traversal clears lane memory without changing native destinations', () => {
    const input = {kind: 'input', blockId: 'right', inputName: 'N', rowId: 'right', scriptId: 'right'};
    const stops = [...base.slice(0, 3), input, base[3]];
    const session = new NavigationSession();
    session.move(stops, left, 'ArrowRight');
    session.move(stops, left, 'ArrowRight');
    expect(session.lane).not.toBeNull();
    expect(session.move(stops, right, 'ArrowRight').position).toBe(input);
    expect(session.lane).toBeNull();
});

test('long staggered-column sequences are deterministic and do not mutate topology or stored coordinates', () => {
    for (let layout = 0; layout < 24; layout++) {
        const y = -200 + (layout * 37);
        const stops = Array.from({length: 12}, (_, i) => root(`col-${i}`, i * 350,
            i % 2 ? y - 60 : y, i % 2 ? 180 + layout : 40)).flat();
        const original = JSON.stringify(stops);
        const session = new NavigationSession();
        let at = stops[0];
        for (const direction of ['ArrowRight', 'ArrowLeft']) {
            for (let step = 1; step < 12; step++) {
                expect(session.move(stops, at, direction).blocked).toBe(true);
                at = session.move(stops, at, direction).position;
                expect(at.blockId).toBe(`col-${direction === 'ArrowRight' ? step : 11 - step}`);
                expect(session.lane.span).toEqual({y, height: 40});
            }
        }
        expect(JSON.stringify(stops)).toBe(original);
    }
});
