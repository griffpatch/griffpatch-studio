// Client-pixel geometry: do not mix workspace units with scroll offsets.
// An oversized target cannot satisfy both edges. Anchor its leading edge
// consistently instead of alternating corrections on consecutive key presses.
const revealDelta = (box, bounds) => {
    const left = bounds.left + 24;
    const right = bounds.right - 24;
    const top = bounds.top + 28;
    const bottom = bounds.bottom - 60;
    let x = 0;
    let y = 0;
    if (box.width > right - left || box.left < left - 4) x = left - box.left;
    else if (box.left + box.width > right) x = right - box.left - box.width;
    if (box.height > bottom - top || box.top < top - 4) y = top - box.top;
    else if (box.top + box.height > bottom) {
        y = Math.max(top, bounds.bottom - 100 - box.height) - box.top;
    }
    return {x: Math.abs(x) < 0.5 ? 0 : x, y: Math.abs(y) < 0.5 ? 0 : y};
};

// Explicit framing differs from automatic reveal: even a visible script may
// benefit from a better composition. Geometry is in client pixels so padding
// remains constant at every Blockly zoom. Do not measure the whole script tail.
const scriptFrameDelta = (head, caret, bounds) => {
    if (!caret || !bounds || bounds.right <= bounds.left || bounds.bottom <= bounds.top) return {x: 0, y: 0};
    const padding = Math.min(32, (bounds.right - bounds.left) / 4, (bounds.bottom - bounds.top) / 4);
    const left = bounds.left + padding;
    const right = bounds.right - padding;
    const top = bounds.top + padding;
    const editBottom = bounds.top + ((bounds.bottom - bounds.top) * 2 / 3);
    const anchor = head || caret;
    let x = left - anchor.left;
    let y = top - anchor.top;
    // Retain the script's left edge unless the active expression needs more
    // room. An oversized expression has one stable leading-edge alignment.
    if (caret.width > right - left) x = left - caret.left;
    else {
        x = Math.min(x, right - caret.left - caret.width);
        x = Math.max(x, left - caret.left);
    }
    y = Math.min(y, editBottom - caret.top - caret.height);
    y = Math.max(y, top - caret.top);
    return {x: Math.abs(x) < 0.5 ? 0 : x, y: Math.abs(y) < 0.5 ? 0 : y};
};

// Scratch culls offscreen stacks with display:none. Client rects then become
// zero, but the native SVG path and transform still describe their geometry.
const svgClientBounds = (element, canvas) => {
    if (!element) return null;
    const visible = element.getBoundingClientRect();
    if (visible.width || visible.height) return visible;
    const box = element.getBBox();
    const matrix = canvas && canvas.getScreenCTM();
    if (!matrix) return null;
    let points = [[box.x, box.y], [box.x + box.width, box.y],
        [box.x, box.y + box.height], [box.x + box.width, box.y + box.height]];
    const transform = m => {
        points = points.map(([x, y]) => [(m.a * x) + (m.c * y) + m.e, (m.b * x) + (m.d * y) + m.f]);
    };
    // A culled descendant's getScreenCTM can also be stale. Compose its native
    // SVG transforms up to the visible canvas, whose current matrix is valid.
    // Read individual transforms without consolidating/mutating their lists.
    let node = element;
    for (; node && node !== canvas; node = node.parentNode) {
        const list = node.transform && node.transform.baseVal;
        for (let i = (list ? list.numberOfItems : 0) - 1; i >= 0; i--) transform(list.getItem(i).matrix);
    }
    if (node !== canvas) return null;
    transform(matrix);
    const left = Math.min(...points.map(point => point[0]));
    const top = Math.min(...points.map(point => point[1]));
    return {left,
        top,
        width: Math.max(...points.map(point => point[0])) - left,
        height: Math.max(...points.map(point => point[1])) - top};
};

export {revealDelta, scriptFrameDelta, svgClientBounds};
