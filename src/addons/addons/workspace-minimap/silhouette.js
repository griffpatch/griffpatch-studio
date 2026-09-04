import {alignOverviewRect} from "./model.js";

// Ordinary blocks keep the inexpensive, pixel-aligned landmark. A statement
// input makes its parent's bounding rectangle misleading: it includes the
// empty mouth and all the nested blocks. Use the renderer's own concave body
// path for these blocks, without copying any SVG, text or input decorations.
const createOutlineCache = PathConstructor => {
  const cache = new WeakMap();
  return block => {
    if (!block.inputList || !block.inputList.some(input => input.type === 3)) return null;
    const data = block.svgPath_ && block.svgPath_.getAttribute("d");
    if (!data) return null;
    const previous = cache.get(block);
    if (previous && previous.data === data && previous.rtl === Boolean(block.RTL)) return previous;
    const outline = {data, path: new PathConstructor(data), rtl: Boolean(block.RTL)};
    cache.set(block, outline);
    return outline;
  };
};

const drawBlockLandmark = (context, block, scale, ratio) => {
  const outline = block.source.outline;
  if (!outline) {
    const crisp = alignOverviewRect(block, ratio, 1);
    context.fillRect(crisp.x, crisp.y, crisp.width, crisp.height);
    return;
  }
  // Native paths start at the block's workspace origin (the right edge in
  // RTL), not at the bounding rectangle's left. Keep uniform world scaling so
  // mouths still align with the independently drawn children inside them.
  const x = block.x + (outline.rtl ? block.width : 0);
  context.save();
  context.translate(Math.round(x * ratio) / ratio, Math.round(block.y * ratio) / ratio);
  context.scale(outline.rtl ? -scale : scale, scale);
  context.fill(outline.path);
  context.restore();
};

export {createOutlineCache, drawBlockLandmark};
