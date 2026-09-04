import {captureScriptViewportAnchor} from "./script-viewport-anchor.js";

const histories = new WeakMap();

// One workspace-local adapter around native history. Blockly still groups,
// filters, applies and transfers its own events; we only bracket a marked group
// with presentation anchoring. Weak event membership dies with discarded history.
const layoutHistory = (workspace, resolveAnchor) => {
  let state = histories.get(workspace);
  if (state) { state.resolveAnchor = resolveAnchor; return state; }
  state = {events: new WeakSet(), resolveAnchor};
  histories.set(workspace, state);
  const nativeUndo = workspace.undo;
  workspace.undo = function (redo) {
    const stack = redo ? this.redoStack_ : this.undoStack_;
    const last = stack[stack.length - 1];
    let layout = false;
    for (let i = stack.length - 1; i >= 0; i--) {
      const event = stack[i];
      if (i !== stack.length - 1 && (!last.group || event.group !== last.group)) break;
      if (state.events.has(event)) { layout = true; break; }
    }
    const restore = layout ? captureScriptViewportAnchor(this, state.resolveAnchor()) : () => {};
    try { return nativeUndo.call(this, redo); } finally { restore(); }
  };
  return state;
};

// Call run() for each synchronous part of an operation, then finish(). Never
// leave Blockly's global group active while awaiting a dialog, timer or user.
export const createLayoutTransaction = (workspace, Blockly, resolveAnchor) => {
  const history = layoutHistory(workspace, resolveAnchor);
  const previous = Blockly.Events.getGroup();
  Blockly.Events.setGroup(true);
  const group = Blockly.Events.getGroup();
  Blockly.Events.setGroup(previous);
  let finished = false;
  const record = event => {
    if (event.recordUndo && event.group === group) history.events.add(event);
  };
  workspace.addChangeListener(record);
  return {
    run(action, anchor = resolveAnchor()) {
      if (finished) throw new Error("Layout transaction already finished");
      const restore = captureScriptViewportAnchor(workspace, anchor);
      const enclosing = Blockly.Events.getGroup();
      Blockly.Events.setGroup(group);
      try { return action(); } finally {
        Blockly.Events.setGroup(enclosing);
        restore();
      }
    },
    finish() {
      if (finished) return;
      finished = true;
      Blockly.Events.afterPendingEvents(() => workspace.removeChangeListener(record));
    }
  };
};
