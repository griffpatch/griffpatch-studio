// Work in native workspace coordinates, independent of zoom and scroll. Try
// beside the edited script and below it; move past occupied roots, never move
// those roots to make room for a newly declared procedure.
const findProcedurePosition = (anchor, occupied, size, rtl = false) => {
    const padding = 64;
    const beside = rtl ? anchor.topLeft.x - size.width - padding : anchor.bottomRight.x + padding;
    const aligned = rtl ? anchor.bottomRight.x - size.width : anchor.topLeft.x;
    const candidates = [{x: beside, y: anchor.topLeft.y}, {x: aligned, y: anchor.bottomRight.y + padding}];
    const obstacles = [...occupied].sort((a, b) => a.topLeft.y - b.topLeft.y);
    for (const point of candidates) {
        for (const rect of obstacles) {
            if (point.x < rect.bottomRight.x + padding && point.x + size.width + padding > rect.topLeft.x &&
                point.y < rect.bottomRight.y + padding && point.y + size.height + padding > rect.topLeft.y) {
                point.y = rect.bottomRight.y + padding;
            }
        }
    }
    const distance = point => Math.pow(point.x - aligned, 2) + Math.pow(point.y - anchor.topLeft.y, 2);
    candidates.sort((a, b) => distance(a) - distance(b));
    const point = candidates[0];
    return {kind: 'workspace', x: point.x + (rtl ? size.width : 0), y: point.y};
};

export {findProcedurePosition};
