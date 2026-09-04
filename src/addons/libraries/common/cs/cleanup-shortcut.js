export const isCleanUpShortcut = event => event.altKey && event.shiftKey &&
  !event.ctrlKey && !event.metaKey && event.key?.toLowerCase() === "c";

// Blockly's mouse workspace leaves body focused. Remember the last pointer
// owner, not the last selected block; another control always revokes that grant.
export const ownsMouseCleanup = (event, workspace, pointerWorkspace) => {
  const svg = workspace?.getParentSvg();
  const target = event.target;
  if (!svg || !svg.getClientRects().length || event.defaultPrevented || event.isComposing) return false;
  if (target?.closest?.('input,textarea,select,button,a,[contenteditable="true"],[role="textbox"],'+
    '[aria-label="Scratch keyboard editor"],.blocklyWidgetDiv,.blocklyDropDownDiv')) return false;
  const doc = svg.ownerDocument;
  const visible = node => node.getClientRects().length &&
    doc.defaultView.getComputedStyle(node).visibility !== "hidden";
  if ([...doc.querySelectorAll('[role="dialog"],[aria-modal="true"],.blocklyWidgetDiv,.blocklyDropDownDiv,.goog-menu')]
    .some(visible)) return false;
  return svg.contains(target) || (target === doc.body && pointerWorkspace === workspace);
};
