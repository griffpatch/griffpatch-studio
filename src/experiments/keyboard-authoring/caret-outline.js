// A generic unplaced command has a top and bottom notch. Selected blocks use
// their actual renderer path instead; no cloned fields or live block styling.
const genericStatementPath = (width, height, renderer) => {
    const r = renderer.CORNER_RADIUS;
    const notchStart = renderer.NOTCH_START_PADDING;
    const notchEnd = notchStart + renderer.NOTCH_WIDTH + r;
    const w = Math.max(notchEnd + r, width);
    const h = Math.max(r * 2, height - renderer.NOTCH_HEIGHT);
    return `M ${r} 0 H ${notchStart} ${renderer.NOTCH_PATH_LEFT} H ${w - r} Q ${w} 0 ${w} ${r} ` +
        `V ${h - r} Q ${w} ${h} ${w - r} ${h} H ${notchEnd} ${renderer.NOTCH_PATH_RIGHT} ` +
        `H ${r} Q 0 ${h} 0 ${h - r} V ${r} Q 0 0 ${r} 0 Z`;
};

const caretOutline = (source, box, statement, {scale = 1, renderer} = {}) => {
    const matrix = source && source.getScreenCTM();
    if (matrix) {
        return {
            d: source.getAttribute('d'),
            transform: `matrix(${matrix.a} ${matrix.b} ${matrix.c} ${matrix.d} ` +
            `${matrix.e - box.left} ${matrix.f - box.top})`,
            source: 'native'
        };
    }
    return {
        d: statement ? genericStatementPath(box.width / scale, box.height / scale, renderer) :
            `M 5 0 H ${Math.max(5, box.width - 5)} Q ${box.width} 0 ${box.width} 5 ` +
            `V ${Math.max(5, box.height - 5)} Q ${box.width} ${box.height} ${box.width - 5} ${box.height} ` +
            `H 5 Q 0 ${box.height} 0 ${box.height - 5} V 5 Q 0 0 5 0 Z`,
        transform: statement ? `scale(${scale})` : '',
        source: 'generic'
    };
};

// This is intentionally not a user preference yet. "silhouette" keeps each
// native Blockly path but masks away strokes inside the filled union, leaving
// one shape-faithful outside contour. "individual" restores the earlier
// outline around every selected block.
const RANGE_CONTOUR_MODE = 'silhouette';

const rangeContour = (sources, box, mode = RANGE_CONTOUR_MODE) => {
    const outlines = sources.map(source => caretOutline(source, box, false));
    return {
        mode: mode === 'silhouette' && outlines.length > 1 ? 'silhouette' : 'individual',
        outlines
    };
};

// A selected operand can end well before its command's final label. The exit
// cue belongs outside that entire row, not inside its enclosing block. The
// native row path excludes the following command's possibly wider tail.
const columnCuePosition = (selection, row, direction) => ({
    left: direction === 'right' ? Math.max(selection.left + selection.width,
        row ? row.left + row.width : -Infinity) + 6 : selection.left - 18,
    top: selection.top + Math.min(selection.height / 2, 24) - 14
});

export {caretOutline, genericStatementPath, RANGE_CONTOUR_MODE, rangeContour, columnCuePosition};
