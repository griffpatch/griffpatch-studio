const meaningfulBlock = block => block && !block.isInsertionMarker?.() &&
  block.type !== "tw_keyboard_draft_statement";

// Read only this command's header, not toString()'s recursive substack/tail.
const headerLabel = block => {
  const prototype = block?.getInputTargetBlock?.("custom_block");
  if (prototype) return `${block.inputList.flatMap(input => input.fieldRow || [])
    .map(field => field.getText?.()).filter(Boolean).join(" ")} ${headerLabel(prototype)}`.trim();
  const words = [];
  for (const input of block?.inputList || []) {
    if (input.type === 3) break; // Native NEXT_STATEMENT: body, not header.
    for (const field of input.fieldRow || []) {
      const text = field.getText?.();
      if (text) words.push(text);
    }
    if (input.connection) {
      const child = input.connection.targetBlock();
      if (child?.isShadow?.()) {
        for (const field of child.inputList?.flatMap(item => item.fieldRow) || []) {
          const text = field.getText?.();
          if (text) words.push(text);
        }
      } else words.push("…");
    }
  }
  return words.join(" ").replace(/\s+/g, " ").trim() || "Script";
};

const scriptDescription = (workspace, location, messages = {}) => {
  let block = workspace.getBlockById(location?.blockId) || workspace.getBlockById(location?.rootId);
  if (!meaningfulBlock(block)) return null;
  if (block.isShadow?.()) block = block.getParent();
  if (!block) return null;
  const root = block.getRootBlock();
  const scopes = [];
  const ancestors = [];
  const bodyLabel = (owner, name) => {
    if (owner.getInput?.("SUBSTACK2")) return name === "SUBSTACK2" ? messages.CONTROL_ELSE || "else" : "then";
    return headerLabel(owner);
  };
  // A body insertion point belongs inside its owner, before any child exists.
  if (location?.kind === "gap" && location.inputName && block.getInput?.(location.inputName)?.type === 3) {
    scopes.push(bodyLabel(block, location.inputName));
    ancestors.push({blockId: block.id, label: scopes[0]});
  }
  const seen = new Set();
  for (let child = block, parent; child && !seen.has(child.id); child = parent) {
    seen.add(child.id);
    parent = child.getParent?.();
    if (!parent) break;
    const input = parent.inputList?.find(item => item.type === 3 && item.connection?.targetBlock() === child);
    if (input) {
      const label = bodyLabel(parent, input.name);
      scopes.unshift(label);
      ancestors.unshift({blockId: parent.id, label});
    }
  }
  const title = headerLabel(root);
  return {blockId: block.id, rootId: root.id, title, scopes,
    links: [{blockId: root.id, label: title}, ...ancestors]};
};

const pinnedHead = ({x, top, bottom}, bounds) => {
  // Only pin a head which has actually left above the editing viewport, and
  // only while some of its script remains below that edge.
  if (top >= bounds.top || bottom <= bounds.top) return null;
  return {left: Math.max(bounds.left, Math.min(x, bounds.right - 100)), top: bounds.top};
};

export {headerLabel, meaningfulBlock, scriptDescription, pinnedHead};
