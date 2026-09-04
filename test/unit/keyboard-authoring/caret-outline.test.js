import {caretOutline, genericStatementPath, RANGE_CONTOUR_MODE, rangeContour, columnCuePosition} from
    '../../../src/experiments/keyboard-authoring/caret-outline';

const renderer = {CORNER_RADIUS: 4, NOTCH_START_PADDING: 12, NOTCH_WIDTH: 32, NOTCH_HEIGHT: 8,
    NOTCH_PATH_LEFT: 'l 8 8 h 20 l 8 -8', NOTCH_PATH_RIGHT: 'l -8 8 h -20 l -8 -8'};

test('right column cue clears the complete row while retaining the operand vertical anchor', () => {
    expect(columnCuePosition({left: 140, top: 60, width: 20, height: 24},
        {left: 100, top: 50, width: 200, height: 48}, 'right')).toEqual({left: 306, top: 58});
});

test('column cue respects a wider range or placeholder and has safe geometry without a live row', () => {
    const selection = {left: 140, top: 60, width: 320, height: 180};
    expect(columnCuePosition(selection, {left: 100, width: 50}, 'right')).toEqual({left: 466, top: 70});
    expect(columnCuePosition(selection, null, 'right')).toEqual({left: 466, top: 70});
    expect(columnCuePosition(selection, null, 'left')).toEqual({left: 122, top: 70});
});

test('selected outlines retain the native path at its actual scaled screen position', () => {
    const path = 'M 0 0 H 90 V 40 H 0 Z';
    const source = {getAttribute: name => name === 'd' ? path : null,
        getScreenCTM: () => ({a: 2, b: 0, c: 0, d: 2, e: 310, f: 220})};
    expect(caretOutline(source, {left: 300, top: 210, width: 180, height: 80}, false)).toEqual({
        d: path, transform: 'matrix(2 0 0 2 10 10)', source: 'native'
    });
});

test('unplaced commands have upper and lower notches, not a vertical text caret', () => {
    const outline = caretOutline(null, {width: 170, height: 38}, true, {renderer});
    expect(outline.d).toBe(genericStatementPath(170, 38, renderer));
    expect(outline.d).toContain(renderer.NOTCH_PATH_LEFT);
    expect(outline.d).toContain(renderer.NOTCH_PATH_RIGHT);
    expect(outline.source).toBe('generic');
    expect(outline.transform).toBe('scale(1)');
    const zoomed = caretOutline(null, {width: 340, height: 76}, true, {scale: 2, renderer});
    expect(zoomed.d).toBe(outline.d);
    expect(zoomed.transform).toBe('scale(2)');
});

test('fields use a rounded outline and detached sources safely fall back to generic geometry', () => {
    const field = caretOutline({getScreenCTM: () => null}, {width: 50, height: 20}, false);
    expect(field.source).toBe('generic');
    expect(field.d).not.toContain('L 20 4');
    expect(field.d).toContain('Q 50 0 50 5');
});

test('ranges retain every native shape and default to a combined silhouette', () => {
    const source = (d, e) => ({
        getAttribute: name => name === 'd' ? d : null,
        getScreenCTM: () => ({a: 1, b: 0, c: 0, d: 1, e, f: 40})
    });
    const box = {left: 100, top: 40};
    const contour = rangeContour([source('M 0 0 H 90 V 40 H 0 Z', 100),
        source('M 0 0 H 120 V 80 H 0 Z', 100)], box);
    expect(RANGE_CONTOUR_MODE).toBe('silhouette');
    expect(contour.mode).toBe('silhouette');
    expect(contour.outlines).toEqual([
        {d: 'M 0 0 H 90 V 40 H 0 Z', transform: 'matrix(1 0 0 1 0 0)', source: 'native'},
        {d: 'M 0 0 H 120 V 80 H 0 Z', transform: 'matrix(1 0 0 1 0 0)', source: 'native'}
    ]);
});

test('the hidden contour switch can restore individual block outlines', () => {
    const source = {getAttribute: () => 'M 0 0 Z',
        getScreenCTM: () => ({a: 1, b: 0, c: 0, d: 1, e: 10, f: 20})};
    expect(rangeContour([source, source], {left: 10, top: 20}, 'individual').mode).toBe('individual');
    expect(rangeContour([source], {left: 10, top: 20}).mode).toBe('individual');
});
