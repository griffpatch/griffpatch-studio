import {
  alignOverviewRect,
  createOverviewModel,
  dampedPanPosition,
  minimapPlacement,
  naturalWorkspaceWorld,
  resizedSquareSide,
  scrollableWorldFromMetrics,
  squareMinimapSize,
  viewportAtOverviewPoint,
} from "./model.js";
import {createOutlineCache, drawBlockLandmark} from "./silhouette.js";

const SIZES = {
  small: {width: 128, height: 128},
  medium: {width: 228, height: 228},
  large: {width: 300, height: 300},
};
const DEFAULT_SIZE = SIZES.small;

// A roughly one-frame response softens pointer sampling without making the
// workspace feel as though it is trailing behind the minimap.
const PAN_RESPONSE_MS = 24;
const PAN_SNAP_RATIO = 0.0025;
const RESIZE_STEP = 12;
const CUSTOM_SIZE_KEY = "tw:addon:workspace-minimap:custom-side";

const readCustomSide = () => {
  try {
    const value = Number(localStorage.getItem(CUSTOM_SIZE_KEY));
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch (error) {
    return null;
  }
};

const storeCustomSide = side => {
  try {
    if (Number.isFinite(side) && side > 0) localStorage.setItem(CUSTOM_SIZE_KEY, String(Math.round(side)));
    else localStorage.removeItem(CUSTOM_SIZE_KEY);
  } catch (error) {
    // Storage can be disabled without making the minimap unusable.
  }
};

const blockFrame = (block, outlineForBlock) => {
  if (!block || !block.rendered || (block.isShadow && block.isShadow())) return null;
  const xy = block.getRelativeToSurfaceXY();
  const width = Number(block.width);
  const height = Number(block.height);
  if (!xy || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  return {
    id: block.id,
    left: block.RTL ? xy.x - width : xy.x,
    top: xy.y,
    width,
    height,
    color: typeof block.getColour === "function" ? block.getColour() : "#855cd6",
    selected: Boolean(block.isSelected && block.isSelected()),
    ...(outlineForBlock ? {outline: outlineForBlock(block)} : {}),
  };
};

const captureWorkspace = (workspace, includeBlocks = true, outlineForBlock) => {
  const metrics = workspace.getMetrics();
  const scale = workspace.scale || 1;
  return {
    metrics,
    scale,
    viewport: {
      left: metrics.viewLeft / scale,
      top: metrics.viewTop / scale,
      width: metrics.viewWidth / scale,
      height: metrics.viewHeight / scale,
    },
    world: scrollableWorldFromMetrics(metrics, scale),
    blocks: includeBlocks ? workspace.getAllBlocks(false)
      .map(block => blockFrame(block, outlineForBlock)).filter(Boolean) : null,
  };
};

const scrollTargetForViewport = (workspace, viewport) => {
  const metrics = workspace.getMetrics();
  return {
    x: (viewport.left * workspace.scale) - metrics.contentLeft,
    y: (viewport.top * workspace.scale) - metrics.contentTop,
  };
};

const cssValue = (style, name, fallback) => style.getPropertyValue(name).trim() || fallback;

const attachMinimap = ({workspace, addon}) => {
  const parentSvg = workspace.getParentSvg();
  const injectionDiv = parentSvg && parentSvg.parentElement;
  if (!injectionDiv) return null;

  const root = document.createElement("div");
  root.className = "sa-workspace-minimap";
  root.dataset.workspaceMinimap = "true";
  root.dataset.workspaceNavigationControl = "true";
  root.title = "Code overview. Click or drag to navigate.";
  root.setAttribute("role", "navigation");
  root.setAttribute("aria-label", "Code overview");
  const landmarksCanvas = document.createElement("canvas");
  landmarksCanvas.className = "sa-workspace-minimap-landmarks";
  landmarksCanvas.setAttribute("aria-hidden", "true");
  const viewportCanvas = document.createElement("canvas");
  viewportCanvas.className = "sa-workspace-minimap-viewport";
  viewportCanvas.setAttribute("aria-hidden", "true");
  const resizeHandle = document.createElement("button");
  resizeHandle.type = "button";
  resizeHandle.className = "sa-workspace-minimap-resize";
  resizeHandle.title = "Drag to resize the code overview. Double-click to reset.";
  resizeHandle.setAttribute("aria-label", "Resize code overview");
  resizeHandle.setAttribute("role", "slider");
  root.appendChild(landmarksCanvas);
  root.appendChild(viewportCanvas);
  root.appendChild(resizeHandle);
  injectionDiv.appendChild(root);

  let model = null;
  let blockFrames = [];
  const outlineForBlock = createOutlineCache(window.Path2D);
  let blocksDirty = true;
  let landmarksDirty = true;
  let worldAnchor = null;
  let lastScale = null;
  let landmarkRevision = 0;
  let viewportRevision = 0;
  let frame = 0;
  let panFrame = 0;
  let panPosition = null;
  let panTarget = null;
  let panLastTimestamp = 0;
  let panSnapDistance = 0;
  let activePointer = null;
  let customSide = readCustomSide();
  let renderedSide = 0;
  let resizePointer = null;
  let resizeStart = null;

  const sizeForContainer = container => {
    const requestedSize = SIZES[addon.settings.get("size")] || DEFAULT_SIZE;
    return squareMinimapSize({
      requested: customSide || requestedSize.width,
      container,
    });
  };

  const position = () => {
    const container = injectionDiv.getBoundingClientRect();
    const resolvedSize = sizeForContainer(container);
    if (!resolvedSize) return;
    const side = resolvedSize.side;
    renderedSide = side;
    const size = {
      width: side,
      height: side,
    };
    root.style.width = `${size.width}px`;
    root.style.height = `${size.height}px`;
    const zoomElement = injectionDiv.querySelector(".blocklyZoom");
    const zoom = zoomElement && zoomElement.getBoundingClientRect();
    const placement = minimapPlacement({
      container: {left: container.left, top: container.top, width: container.width, height: container.height},
      zoom: zoom && {left: zoom.left, top: zoom.top, right: zoom.right, bottom: zoom.bottom,
        width: zoom.width, height: zoom.height},
      size,
    });
    root.style.left = `${placement.left}px`;
    root.style.top = `${placement.top}px`;
    root.dataset.side = String(side);
    root.dataset.sizeMode = customSide ? "custom" : "preset";
    resizeHandle.setAttribute("aria-valuemin", String(Math.round(resolvedSize.minimum)));
    resizeHandle.setAttribute("aria-valuemax", String(Math.round(resolvedSize.maximum)));
    resizeHandle.setAttribute("aria-valuenow", String(Math.round(side)));
    resizeHandle.setAttribute("aria-valuetext", `${Math.round(side)} pixels square`);
  };

  const draw = () => {
    frame = 0;
    if (addon.self.disabled || !workspace.scrollbar || !document.body.contains(parentSvg)) {
      root.hidden = true;
      return;
    }
    root.hidden = false;
    position();
    const snapshot = captureWorkspace(workspace, blocksDirty, outlineForBlock);
    if (blocksDirty) {
      blockFrames = snapshot.blocks;
      blocksDirty = false;
    }
    if (lastScale !== null && snapshot.scale !== lastScale) {
      worldAnchor = null;
      landmarksDirty = true;
    }
    lastScale = snapshot.scale;
    if (!worldAnchor) {
      worldAnchor = naturalWorkspaceWorld({
        blocks: blockFrames,
        viewport: snapshot.viewport,
        scrollableWorld: snapshot.world,
      });
      landmarksDirty = true;
    }
    const bounds = root.getBoundingClientRect();
    const width = bounds.width || SIZES.medium.width;
    const height = bounds.height || SIZES.medium.height;
    const ratio = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    const pixelWidth = Math.round(width * ratio);
    const pixelHeight = Math.round(height * ratio);
    for (const canvas of [landmarksCanvas, viewportCanvas]) {
      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
        landmarksDirty = true;
      }
    }
    const landmarksContext = landmarksCanvas.getContext("2d");
    const viewportContext = viewportCanvas.getContext("2d");
    if (!landmarksContext || !viewportContext) return;
    if (landmarksDirty) {
      landmarksContext.setTransform(ratio, 0, 0, ratio, 0, 0);
      landmarksContext.clearRect(0, 0, width, height);
      const landmarksModel = createOverviewModel({
        blocks: blockFrames,
        viewport: snapshot.viewport,
        world: worldAnchor,
        width,
        height,
      });
      for (const block of landmarksModel.blocks) {
        landmarksContext.globalAlpha = block.source.selected ? 1 : 0.82;
        landmarksContext.fillStyle = typeof block.source.color === "string" ? block.source.color : "#855cd6";
        drawBlockLandmark(landmarksContext, block, landmarksModel.scale, ratio);
      }
      landmarksContext.globalAlpha = 1;
      landmarksDirty = false;
      landmarkRevision += 1;
    }
    viewportContext.setTransform(ratio, 0, 0, ratio, 0, 0);
    viewportContext.clearRect(0, 0, width, height);
    model = createOverviewModel({
      blocks: [],
      viewport: snapshot.viewport,
      world: worldAnchor,
      width,
      height,
    });
    const style = getComputedStyle(root);
    const view = model.viewport;
    const crispView = alignOverviewRect(view, ratio);
    const keyline = cssValue(style, "--sa-minimap-keyline", cssValue(style, "--text-primary", "#575e75"));
    const accent = cssValue(style, "--sa-minimap-accent", cssValue(style, "--looks-secondary", "#cf245f"));
    viewportContext.globalAlpha = 0.12;
    viewportContext.fillStyle = keyline;
    viewportContext.fillRect(crispView.x, crispView.y, crispView.width, crispView.height);
    viewportContext.globalAlpha = 1;
    viewportContext.strokeStyle = accent;
    const viewLineWidth = Math.max(1, Math.round(1.75 * ratio) / ratio);
    const viewInset = viewLineWidth / 2;
    viewportContext.lineWidth = viewLineWidth;
    viewportContext.strokeRect(crispView.x + viewInset, crispView.y + viewInset,
      Math.max(0, crispView.width - viewLineWidth), Math.max(0, crispView.height - viewLineWidth));
    viewportRevision += 1;
    root.dataset.blockCount = String(blockFrames.length);
    root.dataset.landmarkRevision = String(landmarkRevision);
    root.dataset.viewportRevision = String(viewportRevision);
    root.dataset.worldLeft = String(model.world.left);
    root.dataset.worldTop = String(model.world.top);
    root.dataset.worldWidth = String(model.world.width);
    root.dataset.worldHeight = String(model.world.height);
    root.dataset.viewLeft = String(snapshot.viewport.left);
    root.dataset.viewTop = String(snapshot.viewport.top);
    root.dataset.viewWidth = String(snapshot.viewport.width);
    root.dataset.viewHeight = String(snapshot.viewport.height);
  };

  const schedule = ({blocks = false, landmarks = false, resetWorld = false} = {}) => {
    blocksDirty = blocksDirty || blocks;
    landmarksDirty = landmarksDirty || landmarks || blocks;
    if (resetWorld) worldAnchor = null;
    if (!frame) frame = window.requestAnimationFrame(draw);
  };

  const readViewportPosition = () => {
    const metrics = workspace.getMetrics();
    if (!metrics || !Number.isFinite(metrics.viewLeft) || !Number.isFinite(metrics.viewTop) ||
        !Number.isFinite(workspace.scale) || workspace.scale <= 0) return null;
    return {
      x: metrics.viewLeft / workspace.scale,
      y: metrics.viewTop / workspace.scale,
    };
  };

  const resetPan = () => {
    if (panFrame) window.cancelAnimationFrame(panFrame);
    panFrame = 0;
    panPosition = null;
    panTarget = null;
    panLastTimestamp = 0;
    panSnapDistance = 0;
    root.dataset.panState = "idle";
  };

  const stepPan = timestamp => {
    panFrame = 0;
    if (!panPosition || !panTarget || addon.self.disabled || !workspace.scrollbar ||
        !document.body.contains(parentSvg)) {
      resetPan();
      return;
    }
    const elapsed = Math.max(0, timestamp - panLastTimestamp);
    const position = dampedPanPosition({
      from: panPosition,
      to: panTarget,
      elapsed,
      response: PAN_RESPONSE_MS,
    });
    if (!position) {
      resetPan();
      return;
    }
    panPosition = position;
    panLastTimestamp = timestamp;
    const remaining = Math.hypot(panTarget.x - position.x, panTarget.y - position.y);
    const settled = remaining <= panSnapDistance;
    const appliedPosition = settled ? panTarget : position;
    const scrollTarget = scrollTargetForViewport(workspace, {left: appliedPosition.x, top: appliedPosition.y});
    workspace.scrollbar.set(scrollTarget.x, scrollTarget.y);
    schedule();
    if (!settled) {
      panFrame = window.requestAnimationFrame(stepPan);
    } else {
      resetPan();
    }
  };

  const setPanTarget = target => {
    if (!target || !Number.isFinite(target.x) || !Number.isFinite(target.y)) return;
    const reducedMotion = typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion) {
      resetPan();
      const scrollTarget = scrollTargetForViewport(workspace, {left: target.x, top: target.y});
      workspace.scrollbar.set(scrollTarget.x, scrollTarget.y);
      root.dataset.panState = "direct";
      schedule();
      return;
    }
    if (panTarget && panFrame && Math.abs(panTarget.x - target.x) < 0.01 &&
        Math.abs(panTarget.y - target.y) < 0.01) return;
    if (!panPosition) panPosition = readViewportPosition();
    if (!panPosition) {
      resetPan();
      const scrollTarget = scrollTargetForViewport(workspace, {left: target.x, top: target.y});
      workspace.scrollbar.set(scrollTarget.x, scrollTarget.y);
      schedule();
      return;
    }
    panTarget = target;
    const distance = Math.hypot(panTarget.x - panPosition.x, panTarget.y - panPosition.y);
    panSnapDistance = Math.max(0.01, distance * PAN_SNAP_RATIO);
    if (!panLastTimestamp) {
      panLastTimestamp = window.performance && typeof window.performance.now === "function" ?
        window.performance.now() : Date.now();
    }
    root.dataset.panState = "smooth";
    if (!panFrame) panFrame = window.requestAnimationFrame(stepPan);
  };

  const navigate = event => {
    if (!model || addon.self.disabled || !workspace.scrollbar) return;
    const rect = root.getBoundingClientRect();
    const viewport = viewportAtOverviewPoint(model, {x: event.clientX - rect.left, y: event.clientY - rect.top});
    if (!viewport) return;
    setPanTarget({x: viewport.left, y: viewport.top});
  };

  const onPointerDown = event => {
    if (event.button !== 0 || addon.self.disabled) return;
    event.preventDefault();
    event.stopPropagation();
    activePointer = event.pointerId;
    root.classList.add("sa-workspace-minimap-dragging");
    if (root.setPointerCapture) root.setPointerCapture(event.pointerId);
    navigate(event);
  };
  const onPointerMove = event => {
    if (event.pointerId !== activePointer) return;
    event.preventDefault();
    navigate(event);
  };
  const onPointerEnd = event => {
    if (event.pointerId !== activePointer) return;
    event.preventDefault();
    event.stopPropagation();
    activePointer = null;
    root.classList.remove("sa-workspace-minimap-dragging");
    if (root.releasePointerCapture && root.hasPointerCapture(event.pointerId)) root.releasePointerCapture(event.pointerId);
  };
  root.addEventListener("pointerdown", onPointerDown);
  root.addEventListener("pointermove", onPointerMove);
  root.addEventListener("pointerup", onPointerEnd);
  root.addEventListener("pointercancel", onPointerEnd);
  // Blockly and optional editor layers both listen for native mouse events.
  // Keep this presentation-only control from being mistaken for a workspace
  // click after its pointer gesture has already handled navigation.
  const stopMouseGesture = event => {
    event.preventDefault();
    event.stopPropagation();
  };
  root.addEventListener("mousedown", stopMouseGesture);
  root.addEventListener("mouseup", stopMouseGesture);
  root.addEventListener("click", stopMouseGesture);
  root.addEventListener("dblclick", stopMouseGesture);

  const applyCustomSide = side => {
    if (!Number.isFinite(side)) return;
    customSide = side;
    schedule({landmarks: true});
  };

  const resetCustomSide = () => {
    customSide = null;
    storeCustomSide(null);
    schedule({landmarks: true});
  };

  const onResizePointerDown = event => {
    if (event.button !== 0 || addon.self.disabled) return;
    event.preventDefault();
    event.stopPropagation();
    resetPan();
    const container = injectionDiv.getBoundingClientRect();
    const bounds = squareMinimapSize({requested: renderedSide || DEFAULT_SIZE.width, container});
    if (!bounds) return;
    resizePointer = event.pointerId;
    resizeStart = {
      side: renderedSide || bounds.side,
      pointer: {x: event.clientX, y: event.clientY},
      minimum: bounds.minimum,
      maximum: bounds.maximum,
      customSide,
    };
    root.classList.add("sa-workspace-minimap-resizing");
    root.dataset.resizeState = "active";
  };

  const updateResize = (pointerId, clientX, clientY) => {
    if (pointerId !== resizePointer || !resizeStart) return;
    const side = resizedSquareSide({
      startSide: resizeStart.side,
      startPointer: resizeStart.pointer,
      pointer: {x: clientX, y: clientY},
      minimum: resizeStart.minimum,
      maximum: resizeStart.maximum,
    });
    applyCustomSide(side);
  };

  const finishResize = (pointerId, commit) => {
    if (pointerId !== resizePointer) return;
    if (!commit && resizeStart) customSide = resizeStart.customSide;
    if (commit) {
      customSide = Math.round(customSide || renderedSide);
      storeCustomSide(customSide);
    }
    resizePointer = null;
    resizeStart = null;
    root.classList.remove("sa-workspace-minimap-resizing");
    root.dataset.resizeState = "idle";
    schedule({landmarks: true});
  };

  // Listen on the window rather than the small grip so resizing remains reliable after the pointer
  // leaves the handle. Mouse fallbacks also cover hosts which do not continue Pointer Events cleanly.
  const onResizePointerMove = event => {
    if (event.pointerId !== resizePointer) return;
    event.preventDefault();
    updateResize(event.pointerId, event.clientX, event.clientY);
  };
  const onResizePointerUp = event => {
    if (event.pointerId !== resizePointer) return;
    event.preventDefault();
    finishResize(event.pointerId, true);
  };
  const onResizePointerCancel = event => finishResize(event.pointerId, false);
  const onResizeMouseMove = event => {
    if (resizePointer === null) return;
    event.preventDefault();
    updateResize(resizePointer, event.clientX, event.clientY);
  };
  const onResizeMouseUp = event => {
    if (event.button !== 0 || resizePointer === null) return;
    event.preventDefault();
    finishResize(resizePointer, true);
  };
  const cancelResize = () => {
    if (resizePointer !== null) finishResize(resizePointer, false);
  };
  const onResizeEscape = event => {
    if (event.key !== "Escape" || resizePointer === null) return;
    event.preventDefault();
    cancelResize();
  };

  const onResizeKeyDown = event => {
    if (event.key === "Enter" || event.key === "Home") {
      event.preventDefault();
      event.stopPropagation();
      resetCustomSide();
      return;
    }
    const outward = event.key === "ArrowLeft" || event.key === "ArrowUp";
    const inward = event.key === "ArrowRight" || event.key === "ArrowDown";
    if (!outward && !inward) return;
    event.preventDefault();
    event.stopPropagation();
    const container = injectionDiv.getBoundingClientRect();
    const bounds = sizeForContainer(container);
    if (!bounds) return;
    const step = event.shiftKey ? RESIZE_STEP * 3 : RESIZE_STEP;
    applyCustomSide(Math.max(bounds.minimum, Math.min(bounds.maximum,
      (renderedSide || bounds.side) + (outward ? step : -step))));
    storeCustomSide(customSide);
  };

  const stopResizeMouseGesture = event => {
    event.preventDefault();
    event.stopPropagation();
  };
  resizeHandle.addEventListener("pointerdown", onResizePointerDown);
  window.addEventListener("pointermove", onResizePointerMove, true);
  window.addEventListener("pointerup", onResizePointerUp, true);
  window.addEventListener("pointercancel", onResizePointerCancel, true);
  window.addEventListener("mousemove", onResizeMouseMove, true);
  window.addEventListener("mouseup", onResizeMouseUp, true);
  window.addEventListener("blur", cancelResize);
  window.addEventListener("keydown", onResizeEscape, true);
  resizeHandle.addEventListener("mousedown", stopResizeMouseGesture);
  resizeHandle.addEventListener("mouseup", stopResizeMouseGesture);
  resizeHandle.addEventListener("click", stopResizeMouseGesture);
  resizeHandle.addEventListener("dblclick", event => {
    stopResizeMouseGesture(event);
    resetCustomSide();
  });
  resizeHandle.addEventListener("keydown", onResizeKeyDown);

  const workspaceListener = event => {
    const selection = event && event.type === "ui" && event.element === "selected";
    const blocksChanged = !event || event.type !== "ui" || selection;
    schedule({blocks: blocksChanged, resetWorld: blocksChanged && !selection});
  };
  workspace.addChangeListener(workspaceListener);
  const canvasObserver = new MutationObserver(() => schedule());
  canvasObserver.observe(workspace.getCanvas(), {attributes: true, attributeFilter: ["transform"]});
  const themeObserver = new MutationObserver(() => schedule({blocks: true}));
  themeObserver.observe(document.documentElement, {attributes: true, attributeFilter: ["class", "style"]});
  themeObserver.observe(document.body, {attributes: true, attributeFilter: ["class", "style"]});
  const resizeObserver = typeof ResizeObserver === "function" ?
    new ResizeObserver(() => schedule({landmarks: true, resetWorld: true})) : null;
  if (resizeObserver) resizeObserver.observe(injectionDiv);
  const onResize = () => schedule({landmarks: true, resetWorld: true});
  window.addEventListener("resize", onResize);
  const onAvailability = () => schedule({blocks: true, resetWorld: true});
  const onSettingsChange = () => {
    resetCustomSide();
    schedule({landmarks: true, resetWorld: true});
  };
  addon.self.addEventListener("disabled", onAvailability);
  addon.self.addEventListener("reenabled", onAvailability);
  addon.settings.addEventListener("change", onSettingsChange);
  schedule({blocks: true, resetWorld: true});

  return {
    workspace,
    refresh: () => schedule({blocks: true, resetWorld: true}),
    dispose: () => {
      if (frame) window.cancelAnimationFrame(frame);
      resetPan();
      workspace.removeChangeListener(workspaceListener);
      canvasObserver.disconnect();
      themeObserver.disconnect();
      if (resizeObserver) resizeObserver.disconnect();
      cancelResize();
      window.removeEventListener("pointermove", onResizePointerMove, true);
      window.removeEventListener("pointerup", onResizePointerUp, true);
      window.removeEventListener("pointercancel", onResizePointerCancel, true);
      window.removeEventListener("mousemove", onResizeMouseMove, true);
      window.removeEventListener("mouseup", onResizeMouseUp, true);
      window.removeEventListener("blur", cancelResize);
      window.removeEventListener("keydown", onResizeEscape, true);
      window.removeEventListener("resize", onResize);
      addon.self.removeEventListener("disabled", onAvailability);
      addon.self.removeEventListener("reenabled", onAvailability);
      addon.settings.removeEventListener("change", onSettingsChange);
      root.remove();
    },
  };
};

export default async function ({addon}) {
  const Blockly = await addon.tab.traps.getBlockly();
  let attachment = null;
  while (true) {
    await addon.tab.waitForElement(".blocklyZoom", {
      markAsSeen: true,
      reduxEvents: [
        "scratch-gui/mode/SET_PLAYER",
        "scratch-gui/locales/SELECT_LOCALE",
        "scratch-gui/theme/SET_THEME",
        "fontsLoaded/SET_FONTS_LOADED",
      ],
      reduxCondition: state => !state.scratchGui.mode.isPlayerOnly,
    });
    const workspace = Blockly.getMainWorkspace();
    if (!workspace || workspace.isFlyout) continue;
    if (attachment && attachment.workspace !== workspace) {
      attachment.dispose();
      attachment = null;
    }
    if (!attachment) attachment = attachMinimap({workspace, addon});
    else attachment.refresh();
  }
}

export {attachMinimap, blockFrame, captureWorkspace, scrollTargetForViewport};
