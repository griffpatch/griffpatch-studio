import {getScriptContext} from "../../libraries/common/cs/script-context.js";
import {getNavigationHistory} from "../../libraries/common/cs/navigation-history.js";
import {initializeSmoothScrolling} from "../../libraries/common/cs/block-scrolling.js";
import {scriptDescription, pinnedHead} from "./model.js";
import {attachScriptInteraction} from "./interaction.js";

const attachBreadcrumb = ({workspace, Blockly, addon}) => {
  const vm = addon.tab.traps.vm;
  const context = getScriptContext(vm);
  const svg = workspace.getParentSvg();
  const container = svg.parentElement;
  const root = document.createElement("div");
  root.className = "sa-script-breadcrumb";
  root.dataset.scriptBreadcrumb = "true";
  root.dataset.workspaceNavigationControl = "true";
  root.dataset.workspaceInsetTop = "32";
  root.setAttribute("role", "navigation");
  root.setAttribute("aria-label", "Current script context");
  const bar = document.createElement("div");
  bar.className = "sa-script-breadcrumb-bar";
  const icon = document.createElement("img");
  icon.alt = "";
  const spriteName = document.createElement("strong");
  const spriteLink = document.createElement("button");
  spriteLink.type = "button";
  spriteLink.className = "sa-script-breadcrumb-sprite";
  const path = document.createElement("span");
  path.dataset.scriptPath = "true";
  const pin = document.createElement("div");
  pin.className = "sa-script-breadcrumb-pin";
  pin.dataset.scriptHeadPin = "true";
  spriteLink.append(icon, spriteName);
  bar.append(spriteLink, path);
  root.append(bar, pin);
  container.append(root);
  let frame = 0;
  let disposed = false;
  let dirty = true;
  let description = null;
  let scriptHeight = 0;
  let costumeAsset;
  let boundTarget = vm.editingTarget?.id;
  let changingTarget = false;
  let revision = 0;

  const renderLinks = (container, links, prefix) => {
    container.replaceChildren();
    for (const [index, entry] of links.entries()) {
      const separator = document.createElement("span");
      separator.textContent = index ? "›" : prefix;
      separator.setAttribute("aria-hidden", "true");
      const link = document.createElement("button");
      link.type = "button";
      link.textContent = entry.label;
      link.title = `Go to ${entry.label}`;
      link.dataset.blockId = entry.blockId;
      container.append(separator, link);
    }
  };
  const onClick = event => {
    const link = event.target.closest("button[data-block-id]");
    if (!link || !root.contains(link) || addon.self.disabled || disposed || changingTarget) return;
    const history = getNavigationHistory(vm, () => Blockly.getMainWorkspace());
    history.bindInteractions(document);
    initializeSmoothScrolling(Blockly);
    history.navigateToBlock(link.dataset.blockId, {isAvailable: () =>
      !disposed && !addon.self.disabled && !changingTarget && vm.editingTarget?.id === boundTarget
    }).catch(error => console.warn("Script breadcrumb navigation did not complete", error));
  };
  root.addEventListener("click", onClick);

  const draw = () => {
    frame = 0;
    if (disposed) return;
    const target = vm.editingTarget;
    const rect = svg.getBoundingClientRect();
    const metrics = workspace.getMetrics();
    root.hidden = Boolean(addon.self.disabled || changingTarget || !target || !metrics ||
      !rect.width || !rect.height || addon.tab.redux.state.scratchGui.editorTab.activeTabIndex !== 0 ||
      addon.tab.redux.state.scratchGui.mode.isPlayerOnly);
    if (root.hidden) return;
    const bounds = {left: (metrics.absoluteLeft || 0) + (metrics.flyoutWidth || 0) + 8,
      right: rect.width - 20, top: 0};
    root.style.left = `${bounds.left}px`;
    root.style.top = "4px";
    root.style.width = `${Math.max(0, bounds.right - bounds.left)}px`;
    if (dirty) {
      dirty = false;
      description = scriptDescription(workspace, context.get(target.id), Blockly.Msg);
      scriptHeight = description ? workspace.getBlockById(description.rootId).getHeightWidth().height : 0;
      spriteName.textContent = target.isStage ? "Stage" : target.getName();
      const asset = target.getCostumes?.()[target.currentCostume]?.asset;
      if (asset !== costumeAsset) {
        costumeAsset = asset;
        if (asset?.encodeDataURI) icon.src = asset.encodeDataURI();
        else icon.removeAttribute("src");
      }
      icon.hidden = !asset;
      spriteLink.disabled = !description;
      spriteLink.dataset.blockId = description?.rootId || "";
      spriteLink.title = description ? `Go to ${description.title}` : spriteName.textContent;
      renderLinks(path, description?.links || [], "›");
      bar.title = [spriteName.textContent, description?.title, ...(description?.scopes || [])].filter(Boolean).join(" › ");
      renderLinks(pin, description?.links || [], "↑");
      root.dataset.targetId = target.id;
      root.dataset.rootId = description?.rootId || "";
      root.dataset.contextRevision = String(++revision);
    }
    const block = description && workspace.getBlockById(description.rootId);
    let pinned = null;
    if (block) {
      // Read native coordinates + the live canvas transform, including culled
      // heads. Scrolling does not rescan the workspace or re-render the text.
      const xy = block.getRelativeToSurfaceXY();
      const matrix = workspace.getCanvas().getScreenCTM();
      if (matrix) {
        const point = svg.createSVGPoint();
        point.x = xy.x; point.y = xy.y;
        const head = point.matrixTransform(matrix);
        point.y += scriptHeight;
        const tail = point.matrixTransform(matrix);
        pinned = pinnedHead({x: head.x - rect.left, top: head.y - rect.top,
          bottom: tail.y - rect.top}, bounds);
      }
    }
    pin.hidden = !pinned;
    path.hidden = Boolean(pinned);
    if (pinned) {
      // Share one header row with the sprite badge. A second floating row would
      // cover the first visible command and duplicate the same script title.
      const left = Math.max(pinned.left - bounds.left, bar.offsetWidth + 6);
      pin.style.left = `${left}px`;
      pin.style.top = `${pinned.top}px`;
      pin.style.maxWidth = `${Math.max(0, bounds.right - bounds.left - left)}px`;
    }
  };
  const schedule = (refresh = false) => {
    dirty = dirty || refresh;
    if (!disposed && !frame) frame = requestAnimationFrame(draw);
  };
  const detachInteraction = attachScriptInteraction({workspace, Blockly, context,
    targetId: () => boundTarget,
    isAvailable: () => !disposed && !addon.self.disabled && !changingTarget && boundTarget === vm.editingTarget?.id,
    refresh: () => schedule(true)});
  const onWorkspaceUpdate = () => {
    changingTarget = true;
    schedule();
    // The VM event precedes the GUI's synchronous native workspace rebuild.
    queueMicrotask(() => {
      if (disposed) return;
      boundTarget = vm.editingTarget?.id;
      changingTarget = false;
      schedule(true);
    });
  };
  const onState = () => schedule(true);
  const onTargets = () => {
    const target = vm.editingTarget;
    if (target?.id !== boundTarget || target?.getName() !== spriteName.textContent ||
        target?.getCostumes?.()[target.currentCostume]?.asset !== costumeAsset) schedule(true);
  };
  const onRedux = event => {
    const {prev, next} = event.detail;
    if (["editorTab", "mode", "locales", "theme"].some(key => prev.scratchGui[key] !== next.scratchGui[key])) {
      schedule(true);
    }
  };
  const unsubscribe = context.subscribe(onState);
  vm.on("workspaceUpdate", onWorkspaceUpdate);
  vm.on("targetsUpdate", onTargets);
  addon.tab.redux.addEventListener("statechanged", onRedux);
  addon.self.addEventListener("disabled", onState);
  addon.self.addEventListener("reenabled", onState);
  const canvasObserver = new MutationObserver(() => schedule());
  canvasObserver.observe(workspace.getCanvas(), {attributes: true, attributeFilter: ["transform"]});
  const resize = new ResizeObserver(() => schedule());
  resize.observe(container);
  schedule(true);
  return {workspace, refresh: onState, dispose: () => {
    disposed = true;
    cancelAnimationFrame(frame);
    unsubscribe();
    detachInteraction();
    vm.removeListener("workspaceUpdate", onWorkspaceUpdate);
    vm.removeListener("targetsUpdate", onTargets);
    addon.tab.redux.removeEventListener("statechanged", onRedux);
    addon.self.removeEventListener("disabled", onState);
    addon.self.removeEventListener("reenabled", onState);
    canvasObserver.disconnect();
    resize.disconnect();
    root.removeEventListener("click", onClick);
    root.remove();
  }};
};

export default async function ({addon}) {
  const Blockly = await addon.tab.traps.getBlockly();
  let attachment;
  while (true) {
    await addon.tab.waitForElement(".blocklyZoom", {markAsSeen: true,
      reduxEvents: ["scratch-gui/mode/SET_PLAYER", "scratch-gui/locales/SELECT_LOCALE",
        "scratch-gui/theme/SET_THEME", "fontsLoaded/SET_FONTS_LOADED"],
      reduxCondition: state => !state.scratchGui.mode.isPlayerOnly});
    const workspace = Blockly.getMainWorkspace();
    if (!workspace || workspace.isFlyout) continue;
    if (attachment?.workspace !== workspace) {
      attachment?.dispose();
      attachment = attachBreadcrumb({workspace, Blockly, addon});
    } else attachment.refresh();
  }
}
export {attachBreadcrumb};
