import {blockAtPointerTarget} from "../../libraries/common/cs/block-pointer-target.js";
import {meaningfulBlock} from "./model.js";

// Context follows interaction intent, never whichever block a layout batch
// happened to move last. Rendering still refreshes after all structural edits.
export const attachScriptInteraction = ({workspace, Blockly, context, targetId, isAvailable, refresh}) => {
  const available = () => isAvailable() && !context.caretActive;
  const remember = block => {
    if (!meaningfulBlock(block)) return;
    if (block.isShadow?.()) block = block.getParent();
    if (block) context.set(targetId(), {blockId: block.id, rootId: block.getRootBlock().id});
  };
  const onPointer = event => {
    if (event.button !== 0 || !available()) return;
    remember(blockAtPointerTarget(workspace, event.target));
  };
  const onChange = event => {
    if (!isAvailable()) return;
    if (event.type === "ui" || event.isUiEvent) {
      if (available() && event.element === "selected" && event.newValue &&
          Blockly.selected?.id === event.newValue) remember(workspace.getBlockById(event.newValue));
      return;
    }
    refresh();
  };
  const onDrag = detail => {
    if (!available() || detail.workspaceId !== workspace.id) return;
    if (detail.phase === "start" || (detail.phase === "settled" &&
        context.get(targetId())?.blockId === detail.blockId)) {
      remember(workspace.getBlockById(detail.blockId));
      refresh();
    }
  };
  const canvas = workspace.getCanvas();
  canvas.addEventListener("mousedown", onPointer, true);
  workspace.addChangeListener(onChange);
  workspace.addBlockDragListener?.(onDrag);
  return () => {
    canvas.removeEventListener("mousedown", onPointer, true);
    workspace.removeChangeListener(onChange);
    workspace.removeBlockDragListener?.(onDrag);
  };
};
