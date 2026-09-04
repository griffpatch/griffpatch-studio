const MARGIN = 8;
const GAP = 10;
const MIN_ROOM = 120;
const MIN_SIDE_WIDTH = 196;

const clamp = (value, low, high) => Math.max(low, Math.min(value, high));

// The text input belongs to the structural insertion point, not to a candidate's
// changing right edge. Reserve the tallest draft seen in this composition so a
// shorter suggestion cannot pull the input back towards the block. Popup rows
// scroll within the available space instead of moving the text caret.
const compositionLayout = ({anchor, preview, bounds, context, scale = 1, previous}) => {
    const width = Math.max(1, Math.min(310, bounds.right - bounds.left - (2 * MARGIN)));
    const left = clamp(anchor.left, bounds.left + MARGIN, bounds.right - MARGIN - width);
    const top = bounds.top + MARGIN;
    const bottom = bounds.bottom - MARGIN;
    const clearance = Math.max(previous ? previous.clearance : 0,
        (preview.top + preview.height - anchor.top) / scale);
    // When editing inside a script, keep its continuation visible by using a
    // stable side column if it fits. Reserve a modest typing width up front;
    // do not chase each new candidate's right edge. A genuinely wider draft
    // falls back to above/below once and stays there for this composition.
    if (context && (!previous || previous.side === 'beside')) {
        const contextOffset = Math.max(0, (context.right - anchor.left) / scale);
        const preferredOffset = Math.max(320, contextOffset);
        // Preserve the normal generous gutter when possible. In a narrower
        // editor, contract only that empty gutter before putting the panel
        // beneath the very continuation whose space we have just opened.
        const largestUsefulOffset = (bounds.right - MARGIN - GAP - MIN_SIDE_WIDTH - anchor.left) / scale;
        const sideOffset = previous ? previous.sideOffset :
            Math.max(contextOffset, Math.min(preferredOffset, largestUsefulOffset));
        const sideLeft = anchor.left + (sideOffset * scale) + GAP;
        const sideWidth = Math.min(width, bounds.right - MARGIN - sideLeft);
        if (sideLeft >= context.right + GAP && sideWidth >= MIN_SIDE_WIDTH) {
            const edge = clamp(anchor.top, top, bottom - Math.min(240, bottom - top));
            return {
                left: sideLeft,
                width: sideWidth,
                side: 'beside',
                edge,
                clearance,
                sideOffset,
                maxHeight: bottom - edge
            };
        }
    }
    const below = anchor.top + (clearance * scale) + GAP;
    const above = anchor.top - GAP;
    const roomBelow = bottom - below;
    const roomAbove = above - top;
    let side = previous && previous.side !== 'beside' ? previous.side :
        (roomBelow >= Math.min(240, roomAbove) ? 'below' : 'above');
    // A viewport resize/pan or genuinely taller candidate can require a new
    // side. Do not switch back just because the suggestion list got shorter.
    if (side === 'below' && roomBelow < MIN_ROOM && roomAbove > roomBelow) side = 'above';
    else if (side === 'above' && roomAbove < MIN_ROOM && roomBelow > roomAbove) side = 'below';
    const minimum = Math.min(MIN_ROOM, Math.max(1, bottom - top));
    const edge = side === 'below' ? clamp(below, top, bottom - minimum) :
        clamp(above, top + minimum, bottom);
    return {
        left,
        width,
        side,
        edge,
        clearance,
        maxHeight: Math.max(1, side === 'below' ? bottom - edge : edge - top)
    };
};

export {compositionLayout};
