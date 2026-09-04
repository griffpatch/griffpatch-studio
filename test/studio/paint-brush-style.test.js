import {
    normalizePaintBrushStyle,
    paintBrushStyleFromState,
    samePaintBrushStyle
} from '../../src/studio/bridge/paint-brush-style';

const paintState = {
    bitBrushSize: 23,
    brushMode: {brushSize: 14},
    color: {
        fillColor: {primary: '#12AB34'},
        strokeColor: {primary: '#445566'},
        strokeWidth: 3
    }
};

test('captures only the active vector brush settings', () => {
    expect(paintBrushStyleFromState(paintState, 'svg')).toEqual({
        brushSize: 14,
        fillColor: '#12AB34'
    });
});

test('captures only the active bitmap brush settings', () => {
    expect(paintBrushStyleFromState(paintState, 'bitmap')).toEqual({
        brushSize: 23,
        fillColor: '#12AB34'
    });
});

test('rejects malformed or unbounded persisted styles', () => {
    expect(normalizePaintBrushStyle({brushSize: 0, fillColor: '#000'}, 'bitmap')).toBeNull();
    expect(normalizePaintBrushStyle({brushSize: 10, fillColor: ''}, 'bitmap')).toBeNull();
    expect(normalizePaintBrushStyle({brushSize: 10, fillColor: '#000'}, 'unknown')).toBeNull();
});

test('compares the active brush colour case-insensitively', () => {
    expect(samePaintBrushStyle({
        brushSize: 10,
        fillColor: '#AABBCC'
    }, {
        brushSize: 10,
        fillColor: '#aabbcc'
    }, 'svg')).toBe(true);
});
