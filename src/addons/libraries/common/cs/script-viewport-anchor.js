import {scrollPosFromOffset} from "./block-scrolling.js";

// Layout changes both script coordinates and scrollable content bounds.
export const captureScriptViewportAnchor = (workspace, block) => {
  const root = block?.getRootBlock();
  // With no current script, preserve the workspace origin in screen space.
  // This also compensates for changed scroll bounds during native undo/redo.
  const point = () => {
    const matrix = (root ? root.getSvgRoot() : workspace.getCanvas?.())?.getScreenCTM();
    return matrix && {x: matrix.e, y: matrix.f};
  };
  const before = point();
  if (!before || !workspace.scrollbar) return () => {};
  return () => {
    // Cleanup's optional deletion prompt can remove the active orphan.
    if (root && workspace.getBlockById(root.id) !== root) return;
    workspace.resizeContents();
    const after = point();
    const metrics = workspace.getMetrics();
    if (after && metrics) {
      const {sx, sy} = scrollPosFromOffset({
        left: metrics.viewLeft + after.x - before.x,
        top: metrics.viewTop + after.y - before.y
      }, metrics);
      workspace.scrollbar.set(sx, sy);
    }
  };
};
