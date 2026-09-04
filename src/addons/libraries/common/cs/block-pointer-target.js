// Resolve the innermost real block, including clicks on fields/shadows.
export const blockAtPointerTarget = (workspace, target) => {
  if (!workspace || !target || typeof target.closest !== "function") return null;
  const root = target.closest("g.blocklyDraggable");
  if (!root || !workspace.getCanvas().contains(root)) return null;
  const id = root.getAttribute("data-id");
  const byId = id && workspace.getBlockById(id);
  if (byId && byId.getSvgRoot() === root) return byId;
  return workspace.getAllBlocks(false).find(block => block.getSvgRoot() === root) || null;
};
