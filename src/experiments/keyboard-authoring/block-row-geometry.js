// Scratch fields share a native SVG middle baseline. Read that baseline, not
// glyph bounds (which vary with the text), the hat contour or the whole C box.
// Local SVG transforms remain valid when Scratch culls an offscreen script.
const blockRowMetrics = block => {
    try {
        const root = block.getSvgRoot();
        const text = (block.inputList || []).flatMap(input => input.fieldRow)
            .map(field => field.textElement_)
            .find(element => element && element.textContent.trim());
        if (!root || !text) return null;
        let x = Number.parseFloat(text.getAttribute('x') || '0');
        let y = Number.parseFloat(text.getAttribute('y') || '0') +
            Number.parseFloat(text.getAttribute('dy') || '0');
        let node = text;
        for (; node && node !== root; node = node.parentNode) {
            const transforms = node.transform && node.transform.baseVal;
            for (let i = (transforms ? transforms.numberOfItems : 0) - 1; i >= 0; i--) {
                const m = transforms.getItem(i).matrix;
                [x, y] = [(m.a * x) + (m.c * y) + m.e, (m.b * x) + (m.d * y) + m.f];
            }
        }
        const renderer = block.constructor;
        const baselineY = block.getRelativeToSurfaceXY().y + y;
        const offset = (renderer.MIN_BLOCK_Y / 2) + renderer.FIELD_TOP_PADDING;
        if (node !== root || ![baselineY, offset].every(Number.isFinite)) return null;
        return {baselineY, originY: baselineY - offset};
    } catch {
        // Disposed, unrendered and textless shapes keep ordinary origin placement.
        return null;
    }
};

const placementDeltaY = (block, position) => {
    if (!Number.isFinite(position.baselineY)) return position.y;
    const row = blockRowMetrics(block);
    return row ? position.baselineY - row.baselineY : position.y;
};

export {blockRowMetrics, placementDeltaY};
