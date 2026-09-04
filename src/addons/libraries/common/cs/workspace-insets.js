// Presentation chrome declares its occupied client-pixel band. Navigation
// consumes it without knowing which optional addon owns that chrome.
export const workspaceTopInset = workspace => {
  const container = workspace?.getParentSvg?.()?.parentElement;
  let inset = 0;
  for (const element of container?.querySelectorAll('[data-workspace-inset-top]:not([hidden])') || []) {
    const value = Number(element.dataset.workspaceInsetTop);
    if (Number.isFinite(value)) inset = Math.max(inset, value);
  }
  return inset;
};
