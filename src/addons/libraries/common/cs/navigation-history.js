import * as Scrolling from "./block-scrolling.js";
import {getScriptContext, scriptLocation} from "./script-context.js";

// One owner per editor, shared by Finder, Jump to Definition and optional host
// adapters. Entries contain serializable locations, never native block objects.
const histories = new WeakMap();
const distance = (a, b) => Math.hypot(a.left - b.left, a.top - b.top);
const samePlace = (a, b, threshold = 0) => Boolean(a && b && a.targetId === b.targetId &&
  a.view.scale === b.view.scale && distance(a.view, b.view) <= threshold &&
  JSON.stringify(a.focus) === JSON.stringify(b.focus) && JSON.stringify(a.script) === JSON.stringify(b.script));

export class NavigationHistory {
  constructor(vm, getWorkspace) {
    this.vm = vm;
    this.getWorkspace = getWorkspace;
    this.entries = [];
    this.index = -1;
    this.generation = 0;
    this.request = 0;
    this.programmatic = 0;
    this.host = null;
    this.exploration = null;
    this.operation = null;
    this.targetId = this.currentTargetId();
    this.scrollTimer = null;
    this.scrollOrigin = null;
    this.workspaceHook = null;
    this.contextTimer = null;
    this.leaving = null;
    this.onTargetsUpdate = () => {
      if (this.currentTargetId() !== this.targetId) this.leaving = this.capture(this.targetId);
    };
    this.onWorkspaceUpdate = () => this.contextChanged();
    this.onProjectLoaded = () => this.clearHistory();
    vm.on?.("workspaceUpdate", this.onWorkspaceUpdate);
    vm.on?.("targetsUpdate", this.onTargetsUpdate);
    vm.runtime?.on?.("PROJECT_LOADED", this.onProjectLoaded);
  }

  currentTargetId() {
    return this.vm.editingTarget?.id || this.vm.runtime?.getEditingTarget?.()?.id;
  }

  registerHost(host) {
    this.host = host;
    return () => {
      if (this.host === host) {
        this.interrupt();
        this.host = null;
      }
    };
  }

  bindInteractions(document) {
    if (this.document === document) return;
    this.document = document;
    const interrupt = event => {
      if (event.target?.closest?.(".sa-find-bar")) return;
      if (event.type === "keydown" && (event.ctrlKey || event.metaKey) &&
          ["ArrowLeft", "ArrowRight"].includes(event.key)) return;
      if (event.type === "keydown" && ["Control", "Meta", "Alt", "Shift"].includes(event.key)) return;
      this.interrupt();
    };
    document.addEventListener("mousedown", interrupt, true);
    document.addEventListener("keydown", interrupt, true);
    document.addEventListener("wheel", interrupt, {capture: true, passive: true});
    document.defaultView?.addEventListener("blur", () => this.interrupt());
  }

  capture(targetId = this.currentTargetId(), destination = null) {
    const workspace = this.getWorkspace();
    const metrics = workspace?.getMetrics?.();
    if (!metrics || !targetId) return null;
    return {
      generation: this.generation,
      targetId,
      view: {left: metrics.viewLeft, top: metrics.viewTop, scale: workspace.scale},
      focus: destination ? this.host?.destination?.(destination) || null : this.host?.capture?.() || null,
      script: destination ? scriptLocation({blockId: destination.blockId,
        rootId: workspace.getBlockById?.(destination.blockId)?.getRootBlock?.()?.id}) :
        getScriptContext(this.vm).get(targetId),
    };
  }

  valid(entry) {
    return entry && entry.generation === this.generation &&
      Boolean(this.vm.runtime.getTargetById(entry.targetId));
  }

  append(entry) {
    if (!entry) return;
    this.entries.splice(this.index + 1);
    if (!samePlace(this.entries[this.index], entry)) this.entries.push(entry);
    this.entries = this.entries.slice(-200);
    this.index = this.entries.length - 1;
  }

  departure(entry) {
    if (!entry) return;
    // Local arrows are not history steps. Refresh the departure operand/frame
    // of the current journey rather than making Back visit every caret move.
    if (this.index >= 0 && this.entries[this.index].targetId === entry.targetId) {
      this.entries[this.index] = entry;
    } else this.append(entry);
  }

  beginExploration() {
    if (!this.exploration) {
      // Refocusing search is a new user intent, even while a history return is
      // still scrolling. Its late completion must not reclaim editor focus.
      this.interrupt(false);
      this.exploration = {origin: this.capture(), candidate: null};
    }
  }

  commitExploration() {
    const exploration = this.exploration;
    if (exploration && this.operation) {
      exploration.commitRequested = true;
      return;
    }
    this.exploration = null;
    if (exploration?.candidate) {
      this.departure(exploration.origin);
      this.append(exploration.candidate);
    }
  }

  async cancelExploration() {
    const origin = this.exploration?.origin;
    this.exploration = null;
    this.interrupt(false);
    if (this.valid(origin)) await this.restore(origin);
  }

  interrupt(commit = true) {
    this.request++;
    this.operation = null;
    this.cancelPendingScrollTracking();
    if (commit) this.commitExploration();
  }

  beginNavigation(targetId) {
    const origin = this.operation?.origin || this.capture();
    this.interrupt(false);
    const operation = {request: this.request, targetId, origin, generation: this.generation};
    this.operation = operation;
    return operation;
  }

  isCurrent(operation) {
    return this.operation === operation && operation.request === this.request &&
      operation.generation === this.generation;
  }

  finishNavigation(operation, destination = null) {
    if (!this.isCurrent(operation)) return false;
    // A camera-only command retains the current semantic caret, rather than
    // manufacturing a block destination and losing its operand/range identity.
    const entry = this.capture(destination?.targetId || operation.targetId, destination);
    if (destination) getScriptContext(this.vm).set(entry?.targetId, entry?.script);
    this.operation = null;
    if (this.exploration) {
      this.exploration.candidate = entry;
      if (this.exploration.commitRequested) this.commitExploration();
    }
    else {
      this.departure(operation.origin);
      this.append(entry);
    }
    return true;
  }

  programmaticScroll(action) {
    this.cancelPendingScrollTracking();
    this.programmatic++;
    try {
      const result = action();
      if (result?.then) return result.finally(() => { this.programmatic--; });
      this.programmatic--;
      return result;
    } catch (error) {
      this.programmatic--;
      throw error;
    }
  }

  // Same-target UI links (for example script breadcrumbs) use the existing
  // journey and optional semantic host, not a second selection/history owner.
  async navigateToBlock(blockId, {scroll = Scrolling.scrollBlockIntoViewIfNeeded,
    isAvailable = () => true} = {}) {
    const workspace = this.getWorkspace();
    if (!workspace?.getBlockById(blockId) || !isAvailable()) return false;
    const targetId = this.currentTargetId();
    const operation = this.beginNavigation(targetId);
    const current = () => this.isCurrent(operation) && isAvailable() &&
      this.currentTargetId() === targetId && this.getWorkspace() === workspace &&
      Boolean(workspace.getBlockById(blockId));
    try {
      return await this.programmaticScroll(async () => {
        await scroll(workspace, workspace.getBlockById(blockId), 32, 32, false, current);
        if (!current()) return false;
        const destination = {targetId, blockId};
        workspace.getBlockById(blockId).select();
        const entry = this.capture(targetId, destination);
        this.host?.restore?.(entry.focus, {isCurrent: current});
        return this.finishNavigation(operation, destination);
      });
    } finally {
      if (this.operation === operation) this.operation = null;
    }
  }

  async restore(entry) {
    if (!this.valid(entry)) return false;
    const operation = this.beginNavigation(entry.targetId);
    operation.restoreEntry = entry;
    const current = () => this.isCurrent(operation) && this.currentTargetId() === entry.targetId;
    try {
      await this.programmaticScroll(async () => {
        if (this.currentTargetId() !== entry.targetId) this.vm.setEditingTarget(entry.targetId);
        // VM listeners rebuild the native workspace synchronously. Yield once
        // for host toolbox work, then re-resolve; never retain the old workspace.
        await Promise.resolve();
        if (!current()) return;
        const workspace = this.getWorkspace();
        if (!workspace) return;
        if (Number.isFinite(entry.view.scale) && workspace.scale !== entry.view.scale) {
          workspace.setScale(entry.view.scale);
          workspace.resize?.();
        }
        const {sx, sy} = Scrolling.scrollPosFromOffset(entry.view, workspace.getMetrics());
        await Scrolling.animateScrollTo(workspace, sx, sy, current);
        if (current()) {
          getScriptContext(this.vm).set(entry.targetId, entry.script);
          this.host?.restore?.(entry.focus, {isCurrent: current});
        }
      });
      return current();
    } finally {
      if (this.operation === operation) this.operation = null;
    }
  }

  async travel(direction) {
    const wasReturning = Boolean(this.operation?.restoreEntry);
    this.interrupt();
    if (!wasReturning) this.departure(this.capture());
    let index = this.index + direction;
    while (index >= 0 && index < this.entries.length && !this.valid(this.entries[index])) index += direction;
    if (index < 0 || index >= this.entries.length) return false;
    const previous = this.index;
    this.index = index;
    const request = this.request + 1;
    let restored = false;
    try {
      restored = await this.restore(this.entries[index]);
    } catch (error) {
      console.warn("Navigation history could not restore this location", error);
      if (this.request === request) this.host?.unavailable?.();
    }
    // A newer command owns the index now. Never roll it back on late completion.
    if (!restored && this.request === request) this.index = previous;
    return restored;
  }

  goBack() { return this.travel(-1); }
  goForward() { return this.travel(1); }
  peek() { return this.entries[this.index] || null; }

  storeView(next = this.peek(), threshold = 64) {
    if (this.programmatic || this.operation || this.exploration) return;
    const entry = this.capture();
    if (entry && !samePlace(entry, next, threshold)) this.append(entry);
  }

  clearHistory() {
    this.interrupt(false);
    clearTimeout(this.contextTimer);
    this.generation++;
    this.entries = [];
    this.index = -1;
    this.exploration = null;
    this.leaving = null;
    this.targetId = this.currentTargetId();
  }

  contextChanged() {
    this.ensureWorkspace();
    const nextTargetId = this.currentTargetId();
    const previousTargetId = this.targetId;
    this.targetId = nextTargetId;
    if (previousTargetId === nextTargetId) return;
    clearTimeout(this.contextTimer);
    if (this.operation?.targetId === nextTargetId) { this.leaving = null; return; }
    // This listener runs before the GUI clears the old workspace. A manual
    // sprite switch is a journey; the GUI still owns each sprite's camera.
    const origin = this.leaving || this.capture(previousTargetId);
    this.leaving = null;
    this.interrupt();
    const request = this.request;
    this.contextTimer = setTimeout(() => {
      if (request !== this.request || this.currentTargetId() !== nextTargetId) return;
      this.departure(origin);
      this.append(this.capture());
    }, 0);
  }

  cancelPendingScrollTracking() {
    clearTimeout(this.scrollTimer);
    this.scrollTimer = null;
    this.scrollOrigin = null;
  }

  ensureWorkspace() {
    const workspace = this.getWorkspace();
    if (!workspace?.scrollbar || this.workspaceHook?.workspace === workspace) return;
    if (this.workspaceHook) {
      const {workspace: previous, original, wrapper} = this.workspaceHook;
      if (previous.scrollbar?.set === wrapper) previous.scrollbar.set = original;
    }
    this.cancelPendingScrollTracking();
    const original = workspace.scrollbar.set;
    const wrapper = (...args) => {
      if (this.workspaceHook?.workspace !== workspace) return original.apply(workspace.scrollbar, args);
      if (this.programmatic || this.operation || this.exploration) return original.apply(workspace.scrollbar, args);
      if (!this.scrollOrigin) this.scrollOrigin = this.capture();
      const result = original.apply(workspace.scrollbar, args);
      clearTimeout(this.scrollTimer);
      this.scrollTimer = setTimeout(() => {
        const origin = this.scrollOrigin;
        this.cancelPendingScrollTracking();
        if (this.getWorkspace() !== workspace || origin?.targetId !== this.currentTargetId()) return;
        const end = this.capture();
        if (end && !samePlace(origin, end, 64)) {
          this.departure(origin);
          this.append(end);
        }
      }, 1500);
      return result;
    };
    workspace.scrollbar.set = wrapper;
    this.workspaceHook = {workspace, original, wrapper};
  }
}

export const getNavigationHistory = (vm, getWorkspace) => {
  let history = histories.get(vm);
  if (!history) {
    history = new NavigationHistory(vm, getWorkspace);
    histories.set(vm, history);
  }
  history.getWorkspace = getWorkspace;
  history.ensureWorkspace();
  return history;
};
