const MAX_COLOR_LENGTH = 64;
const MAX_BRUSH_SIZE = 100;
const INVALID = Symbol('invalid-paint-brush-style');

const normalizedColor = value => {
    if (typeof value !== 'string') return INVALID;
    const color = value.trim();
    return color && color.length <= MAX_COLOR_LENGTH ? color : INVALID;
};

const boundedNumber = (value, minimum, maximum) => (
    Number.isFinite(value) && value >= minimum && value <= maximum ? value : INVALID
);

const normalizePaintBrushStyle = (style, editFormat) => {
    if (!style || typeof style !== 'object') return null;
    const brushSize = boundedNumber(style.brushSize, 1, MAX_BRUSH_SIZE);
    const fillColor = normalizedColor(style.fillColor);
    if (brushSize === INVALID || fillColor === INVALID) return null;
    return editFormat === 'svg' || editFormat === 'bitmap' ? {brushSize, fillColor} : null;
};

const paintBrushStyleFromState = (paintState, editFormat) => {
    if (!paintState || !paintState.color || !paintState.color.fillColor) return null;
    const common = {
        brushSize: editFormat === 'bitmap' ? paintState.bitBrushSize :
            paintState.brushMode && paintState.brushMode.brushSize,
        fillColor: paintState.color.fillColor.primary
    };
    return normalizePaintBrushStyle(common, editFormat);
};

const comparableColor = value => (
    typeof value === 'string' ? value.trim().toLowerCase() : value
);
const samePaintBrushStyle = (actual, expected, editFormat) => {
    const normalizedActual = normalizePaintBrushStyle(actual, editFormat);
    const normalizedExpected = normalizePaintBrushStyle(expected, editFormat);
    if (!normalizedActual || !normalizedExpected) return false;
    return normalizedActual.brushSize === normalizedExpected.brushSize &&
        comparableColor(normalizedActual.fillColor) === comparableColor(normalizedExpected.fillColor);
};

export {
    MAX_BRUSH_SIZE,
    MAX_COLOR_LENGTH,
    normalizePaintBrushStyle,
    paintBrushStyleFromState,
    samePaintBrushStyle
};
