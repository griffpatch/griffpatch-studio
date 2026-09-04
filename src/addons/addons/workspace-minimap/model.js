const finite = value => Number.isFinite(value);
const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));

const normalizeRect = rect => {
  if (!rect || !finite(rect.left) || !finite(rect.top) || !finite(rect.width) || !finite(rect.height)) return null;
  if (rect.width < 0 || rect.height < 0) return null;
  return {
    ...rect,
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
    right: rect.left + rect.width,
    bottom: rect.top + rect.height,
  };
};

const unionRects = rectangles => rectangles.reduce((union, rectangle) => {
  const rect = normalizeRect(rectangle);
  if (!rect) return union;
  if (!union) return {...rect};
  const left = Math.min(union.left, rect.left);
  const top = Math.min(union.top, rect.top);
  const right = Math.max(union.right, rect.right);
  const bottom = Math.max(union.bottom, rect.bottom);
  return {left, top, right, bottom, width: right - left, height: bottom - top};
}, null);

const scrollableWorldFromMetrics = (metrics, scale = 1) => {
  if (!metrics || !finite(scale) || scale <= 0) return null;
  return normalizeRect({
    left: metrics.contentLeft / scale,
    top: metrics.contentTop / scale,
    width: metrics.contentWidth / scale,
    height: metrics.contentHeight / scale,
  });
};

// Blockly's content metrics deliberately include generous, and sometimes
// asymmetric, scroll padding. That is useful to the native scrollbars but it
// makes a compact overview look as though the scripts live in a remote corner
// of a much larger canvas. Half a viewport before the scripts keeps their
// natural top-left origin legible; a full viewport after them preserves the
// more useful forward editing room and still lets every script leave view.
const naturalWorkspaceWorld = ({blocks = [], viewport, scrollableWorld}) => {
  const view = normalizeRect(viewport);
  const nativeWorld = normalizeRect(scrollableWorld);
  const content = unionRects(blocks);
  if (!view) return nativeWorld || content;
  if (!content) return view;

  const desired = normalizeRect({
    left: Math.min(view.left, content.left - (view.width * 0.5)),
    top: Math.min(view.top, content.top - (view.height * 0.5)),
    width: Math.max(view.right, content.right + view.width) -
      Math.min(view.left, content.left - (view.width * 0.5)),
    height: Math.max(view.bottom, content.bottom + view.height) -
      Math.min(view.top, content.top - (view.height * 0.5)),
  });
  if (!nativeWorld) return desired;

  const clipped = normalizeRect({
    left: Math.max(nativeWorld.left, desired.left),
    top: Math.max(nativeWorld.top, desired.top),
    width: Math.max(0, Math.min(nativeWorld.right, desired.right) - Math.max(nativeWorld.left, desired.left)),
    height: Math.max(0, Math.min(nativeWorld.bottom, desired.bottom) - Math.max(nativeWorld.top, desired.top)),
  });
  // Defensive unions preserve the current camera and real content even if a
  // host briefly publishes stale scroll metrics during a workspace resize.
  return unionRects([clipped, view, content]);
};

const alignOverviewRect = (rect, pixelRatio = 1, minimumSize = 0) => {
  if (!rect || !finite(rect.x) || !finite(rect.y) || !finite(rect.width) || !finite(rect.height) ||
      rect.width < 0 || rect.height < 0 || !finite(pixelRatio) || pixelRatio <= 0) return null;
  const snap = value => Math.round(value * pixelRatio) / pixelRatio;
  const x = snap(rect.x);
  const y = snap(rect.y);
  const right = snap(rect.x + rect.width);
  const bottom = snap(rect.y + rect.height);
  return {
    x,
    y,
    width: Math.max(minimumSize, right - x),
    height: Math.max(minimumSize, bottom - y),
  };
};

const dampedPanPosition = ({from, to, elapsed, response}) => {
  if (!from || !to || !finite(from.x) || !finite(from.y) || !finite(to.x) || !finite(to.y) ||
      !finite(elapsed) || !finite(response)) return null;
  if (response <= 0) return {x: to.x, y: to.y};
  if (elapsed <= 0) return {x: from.x, y: from.y};
  const progress = 1 - Math.exp(-elapsed / response);
  return {
    x: from.x + ((to.x - from.x) * progress),
    y: from.y + ((to.y - from.y) * progress),
  };
};

const squareMinimapSize = ({requested, container, minimum = 128, maximum = 520, inset = 16}) => {
  if (!finite(requested) || !container || !finite(container.width) || !finite(container.height) ||
      !finite(minimum) || !finite(maximum) || !finite(inset) || requested <= 0 || minimum <= 0 || maximum <= 0) {
    return null;
  }
  const available = Math.max(1, Math.min(container.width - inset, container.height - inset, maximum));
  const lower = Math.min(minimum, available);
  return {
    side: clamp(requested, lower, available),
    minimum: lower,
    maximum: available,
  };
};

const resizedSquareSide = ({startSide, startPointer, pointer, minimum, maximum}) => {
  if (!finite(startSide) || !startPointer || !pointer || !finite(startPointer.x) || !finite(startPointer.y) ||
      !finite(pointer.x) || !finite(pointer.y) || !finite(minimum) || !finite(maximum) || minimum > maximum) {
    return null;
  }
  const horizontal = startPointer.x - pointer.x;
  const vertical = startPointer.y - pointer.y;
  const dominantDelta = Math.abs(horizontal) >= Math.abs(vertical) ? horizontal : vertical;
  return clamp(startSide + dominantDelta, minimum, maximum);
};

const createOverviewModel = ({blocks = [], viewport, world: fixedWorld, width, height, inset = 7}) => {
  const safeWidth = Math.max(1, finite(width) ? width : 1);
  const safeHeight = Math.max(1, finite(height) ? height : 1);
  const view = normalizeRect(viewport) || normalizeRect({left: 0, top: 0, width: 1, height: 1});
  const validBlocks = blocks.map(source => ({source, rect: normalizeRect(source)})).filter(block => block.rect);
  const anchoredWorld = normalizeRect(fixedWorld);
  const content = anchoredWorld || unionRects([...validBlocks.map(block => block.rect), view]);
  const span = Math.max(content.width, content.height, 1);
  const worldPadding = anchoredWorld ? 0 : Math.max(16, Math.min(96, span * 0.04));
  const world = {
    left: content.left - worldPadding,
    top: content.top - worldPadding,
    width: Math.max(1, content.width + (worldPadding * 2)),
    height: Math.max(1, content.height + (worldPadding * 2)),
  };
  world.right = world.left + world.width;
  world.bottom = world.top + world.height;
  const innerWidth = Math.max(1, safeWidth - (inset * 2));
  const innerHeight = Math.max(1, safeHeight - (inset * 2));
  const scale = Math.max(0.000001, Math.min(innerWidth / world.width, innerHeight / world.height));
  const origin = {
    x: (safeWidth - (world.width * scale)) / 2,
    y: (safeHeight - (world.height * scale)) / 2,
  };
  const project = rect => ({
    x: origin.x + ((rect.left - world.left) * scale),
    y: origin.y + ((rect.top - world.top) * scale),
    width: rect.width * scale,
    height: rect.height * scale,
  });
  return {
    width: safeWidth,
    height: safeHeight,
    world,
    scale,
    origin,
    blocks: validBlocks.map(block => ({...project(block.rect), source: block.source})),
    viewport: {...project(view), source: view},
  };
};

const viewportAtOverviewPoint = (model, point) => {
  if (!model || !model.viewport || !model.viewport.source || !point) return null;
  const mapRight = model.origin.x + (model.world.width * model.scale);
  const mapBottom = model.origin.y + (model.world.height * model.scale);
  const x = clamp(point.x, model.origin.x, mapRight);
  const y = clamp(point.y, model.origin.y, mapBottom);
  const worldX = model.world.left + ((x - model.origin.x) / model.scale);
  const worldY = model.world.top + ((y - model.origin.y) / model.scale);
  const viewWidth = model.viewport.source.width;
  const viewHeight = model.viewport.source.height;
  const centreX = model.world.width <= viewWidth ? model.world.left + (model.world.width / 2) :
    clamp(worldX, model.world.left + (viewWidth / 2), model.world.right - (viewWidth / 2));
  const centreY = model.world.height <= viewHeight ? model.world.top + (model.world.height / 2) :
    clamp(worldY, model.world.top + (viewHeight / 2), model.world.bottom - (viewHeight / 2));
  return {
    left: centreX - (viewWidth / 2),
    top: centreY - (viewHeight / 2),
  };
};

const minimapPlacement = ({container, zoom, size, gap = 10, inset = 8}) => {
  const fallback = {
    left: Math.max(inset, container.width - size.width - 56),
    top: Math.max(inset, container.height - size.height - 12),
  };
  if (!zoom || !finite(zoom.left) || !finite(zoom.top)) return fallback;
  const leftOfZoom = zoom.left - container.left - size.width - gap;
  const alignedBottom = zoom.bottom - container.top - size.height;
  if (leftOfZoom >= inset) {
    return {
      left: leftOfZoom,
      top: clamp(alignedBottom, inset, Math.max(inset, container.height - size.height - inset)),
    };
  }
  return {
    left: clamp(zoom.left - container.left + ((zoom.width - size.width) / 2), inset,
      Math.max(inset, container.width - size.width - inset)),
    top: clamp(zoom.top - container.top - size.height - gap, inset,
      Math.max(inset, container.height - size.height - inset)),
  };
};

export {
  alignOverviewRect,
  createOverviewModel,
  dampedPanPosition,
  minimapPlacement,
  naturalWorkspaceWorld,
  normalizeRect,
  resizedSquareSide,
  scrollableWorldFromMetrics,
  squareMinimapSize,
  unionRects,
  viewportAtOverviewPoint,
};
