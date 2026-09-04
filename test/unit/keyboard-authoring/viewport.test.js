import {revealDelta, scriptFrameDelta, svgClientBounds} from '../../../src/experiments/keyboard-authoring/viewport';

const bounds = {left:300, top:90, right:1100, bottom:850};
const apply = (box, delta) => ({...box, left:box.left + delta.x, top:box.top + delta.y});

test('safe targets leave both camera axes untouched', () => {
    expect(revealDelta({left:400, top:200, width:200, height:60}, bounds)).toEqual({x:0,y:0});
});

test.each([
    {left:250, top:60, width:120, height:40},
    {left:1050, top:810, width:120, height:40},
    {left:800, top:300, width:1400, height:80},
    {left:350, top:200, width:160, height:2300},
    {left:350, top:130, width:160, height:650}
])('one reveal correction is stable for %p', box => {
    const delta = revealDelta(box, bounds);
    const adjusted = apply(box, delta);
    expect(revealDelta(adjusted, bounds)).toEqual({x:0,y:0});
    expect(adjusted.left).toBeGreaterThanOrEqual(bounds.left + 20);
    expect(adjusted.top).toBeGreaterThanOrEqual(bounds.top + 24);
});

describe('explicit script framing', () => {
    test('offscreen culled SVGs use native path coordinates and their screen transform', () => {
        const canvas = {getScreenCTM: () => ({a: 1.5, b: 0, c: 0, d: 1.5, e: -300, f: -200})};
        const element = {getBoundingClientRect: () => ({width: 0, height: 0}),
            getBBox: () => ({x: 10, y: -20, width: 120, height: 60}),
            getScreenCTM: () => {throw Error('Culled child CTM must not be read');}, parentNode: canvas};
        expect(svgClientBounds(element, canvas)).toEqual({left: -285, top: -230, width: 180, height: 90});
        element.parentNode = {parentNode: canvas, transform: {baseVal: {numberOfItems: 1,
            getItem: () => ({matrix: {a: 1,b: 0,c: 0,d: 1,e: 40,f: 60}})}}};
        expect(svgClientBounds(element, canvas)).toEqual({left: -225, top: -140, width: 180, height: 90});
    });
    const head = {left: 650, top: 270, width: 180, height: 48};
    test('a visible short script still aligns its head with 32px padding', () => {
        expect(scriptFrameDelta(head, {...head, top: 350}, bounds)).toEqual({x: -318, y: -148});
    });
    test('a long script sacrifices its head to keep the complete caret at two-thirds height', () => {
        const caret = {...head, top: 1700};
        const moved = apply(caret, scriptFrameDelta(head, caret, bounds));
        expect(moved.top + moved.height).toBeCloseTo(bounds.top + (bounds.bottom - bounds.top) * 2 / 3);
    });
    test('a far-right nested operand takes priority over the script left edge', () => {
        const caret = {...head, left: 1850, width: 120};
        const moved = apply(caret, scriptFrameDelta(head, caret, bounds));
        expect(moved.left + moved.width).toBe(bounds.right - 32);
    });
    test.each([
        {left: 650, top: 370, width: 180, height: 48},
        {left: 650, top: 3700, width: 180, height: 48},
        {left: 1650, top: 3700, width: 180, height: 48},
        {left: 650, top: 270, width: 1400, height: 1200},
        {left: 650, top: 215, width: 144, height: 56}
    ])('one correction is idempotent for %p, including oversized and upper-insertion carets', caret => {
        const delta = scriptFrameDelta(head, caret, bounds);
        expect(scriptFrameDelta(apply(head, delta), apply(caret, delta), bounds)).toEqual({x: 0, y: 0});
    });
    test('a free placeholder is framed without inventing a script', () => {
        expect(scriptFrameDelta(null, head, bounds)).toEqual({x: -318, y: -148});
    });
    test('translation and workspace zoom leave the screen padding unchanged', () => {
        [0.5, 1, 1.5, 3].forEach(scale => {
            const scaled = {...head, width: head.width * scale, height: head.height * scale};
            const moved = apply(scaled, scriptFrameDelta(scaled, scaled, bounds));
            expect(moved.left).toBe(bounds.left + 32);
            expect(moved.top).toBe(bounds.top + 32);
        });
    });
    test('missing caret and hidden viewport do not scroll', () => {
        expect(scriptFrameDelta(head, null, bounds)).toEqual({x: 0, y: 0});
        expect(scriptFrameDelta(head, head, {...bounds, right: bounds.left})).toEqual({x: 0, y: 0});
    });
});
