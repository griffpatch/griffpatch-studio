// Optional presentation context shared by mouse editing, Finder and Keyboard.
// Native IDs only; never retain live blocks across a sprite/workspace rebuild.
const contexts = new WeakMap();
export const scriptLocation = location => location ? {
  blockId: location.blockId || null, rootId: location.rootId || null,
  inputName: location.inputName || null, kind: location.kind || "block",
} : null;
export class ScriptContext {
  constructor() {
    // A structural editor publishes precise input/body locations itself.
    // Mouse tracking resumes immediately when it relinquishes that ownership.
    this.caretActive = false;
    this.locations = new Map();
    this.listeners = new Set();
  }
  get(targetId) { return this.locations.get(targetId) || null; }
  set(targetId, location) {
    if (!targetId) return;
    const next = scriptLocation(location);
    if (JSON.stringify(this.get(targetId)) === JSON.stringify(next)) return;
    if (next) this.locations.set(targetId, next);
    else this.locations.delete(targetId);
    this.listeners.forEach(listener => listener());
  }
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  clear() {
    this.locations.clear();
    this.listeners.forEach(listener => listener());
  }
}
export const getScriptContext = vm => {
  if (!contexts.has(vm)) {
    const context = new ScriptContext();
    vm.runtime?.on?.("PROJECT_LOADED", () => context.clear());
    contexts.set(vm, context);
  }
  return contexts.get(vm);
};
