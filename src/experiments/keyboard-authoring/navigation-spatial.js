import {semanticPosition} from './navigation-location';

const rootStops = stops => stops.filter(stop => stop.kind === 'block' && stop.blockId === stop.scriptId);
const centreY = bounds => bounds.y + (bounds.height / 2);
const sameColumn = (first, second) => {
    const tolerance = Math.max(48, Math.min(first.width, second.width, 200) * 0.45);
    return Math.abs(first.x - second.x) <= tolerance;
};

const positionAfterColumn = current => current.scriptBounds && ({
    kind: 'workspace',
    x: current.scriptBounds.x,
    y: current.scriptBounds.y + current.scriptBounds.height + 50,
    sourcePosition: semanticPosition(current),
    spatialDirection: 'down'
});

const nextScriptBelow = (stops, current) => {
    if (!current.scriptBounds) return null;
    const edge = current.scriptBounds.y + current.scriptBounds.height;
    const candidates = rootStops(stops).filter(stop => stop.scriptId !== current.scriptId &&
        stop.scriptBounds && stop.scriptBounds.y >= edge - 8 &&
        sameColumn(current.scriptBounds, stop.scriptBounds));
    candidates.sort((first, second) =>
        ((first.scriptBounds.y - edge) +
            (Math.abs(first.scriptBounds.x - current.scriptBounds.x) * 0.35)) -
        ((second.scriptBounds.y - edge) +
            (Math.abs(second.scriptBounds.x - current.scriptBounds.x) * 0.35)));
    return candidates[0] || null;
};

const previousScriptAbove = (stops, current) => {
    if (!current.scriptBounds) return null;
    const edge = current.scriptBounds.y;
    const candidates = rootStops(stops).filter(stop => stop.scriptId !== current.scriptId &&
        stop.scriptBounds && stop.scriptBounds.y + stop.scriptBounds.height <= edge + 8 &&
        sameColumn(current.scriptBounds, stop.scriptBounds));
    candidates.sort((first, second) =>
        ((edge - first.scriptBounds.y - first.scriptBounds.height) +
            (Math.abs(first.scriptBounds.x - current.scriptBounds.x) * 0.35)) -
        ((edge - second.scriptBounds.y - second.scriptBounds.height) +
            (Math.abs(second.scriptBounds.x - current.scriptBounds.x) * 0.35)));
    return candidates[0] || null;
};

const statementRows = (stops, scriptId) => stops.filter(stop => stop.scriptId === scriptId &&
    stop.kind === 'block' && stop.blockId === stop.rowId && stop.bounds);
// Only a script's vertical head/tail excludes nested body commands. Spatial
// column navigation must be able to enter every command row it can leave.
const mainStatementRows = (stops, scriptId) => statementRows(stops, scriptId).filter(stop => !stop.bodyPosition);

const unionBounds = bounds => {
    if (!bounds.length) return null;
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    for (const item of bounds) {
        left = Math.min(left, item.x);
        top = Math.min(top, item.y);
        right = Math.max(right, item.x + item.width);
        bottom = Math.max(bottom, item.y + item.height);
    }
    return {x: left, y: top, width: right - left, height: bottom - top};
};

const rangeBounds = (stops, range) => {
    if (!range || !Array.isArray(range.blockIds) || !range.blockIds.length) return null;
    const bounds = range.blockIds.map(id => {
        const stop = stops.find(candidate => candidate.kind === 'block' && candidate.blockId === id);
        return stop && stop.bounds;
    });
    // A partially stale range is not a smaller selection. Fall back to the
    // active block until the controller has reconciled every native identity.
    if (!bounds.every(Boolean)) return null;
    const combined = unionBounds(bounds);
    if (bounds.some(item => Number.isFinite(item.originY))) {
        const first = [...bounds].sort((a, b) => (a.originY ?? a.y) - (b.originY ?? b.y))[0];
        combined.originY = first.originY ?? first.y;
        if (Number.isFinite(first.baselineY)) combined.baselineY = first.baselineY;
    }
    return combined;
};

const verticalGap = (first, second) => Math.max(0,
    first.y - (second.y + second.height),
    second.y - (first.y + first.height));

const FREE_STEP = 96;
const FREE_SNAP_REACH = FREE_STEP / 4;
const COLUMN_GAP = 80;
const MIN_COLUMN_STEP = 240;

// Fixed column anchors avoid transitive grouping drift on ragged layouts.
const scriptColumns = stops => {
    const roots = rootStops(stops).filter(root => root.scriptBounds)
        .sort((a, b) => a.scriptBounds.x - b.scriptBounds.x ||
            a.scriptBounds.y - b.scriptBounds.y || a.blockId.localeCompare(b.blockId));
    const columns = [];
    for (const root of roots) {
        const bounds = root.scriptBounds;
        let column = columns.find(item => sameColumn(item.anchor, bounds));
        if (!column) {
            column = {x: bounds.x, right: bounds.x + bounds.width, anchor: bounds, roots: []};
            columns.push(column);
        }
        column.right = Math.max(column.right, bounds.x + bounds.width);
        column.roots.push(root);
    }
    for (const column of columns) {
        column.roots.sort((a, b) => a.scriptBounds.y - b.scriptBounds.y || a.blockId.localeCompare(b.blockId));
    }
    return columns;
};

const horizontalDestination = (stops, position, direction, span = null) => {
    const columns = scriptColumns(stops);
    const sign = direction === 'right' ? 1 : -1;
    const current = columns.find(column => sameColumn(column.anchor, {x: position.x, width: 144}));
    const originX = current ? current.x : position.x;
    const anchors = [...columns.map(column => column.x), ...(position.columnXs || []), originX]
        .filter((x, index, all) => Number.isFinite(x) && all.indexOf(x) === index)
        .sort((a, b) => a - b);
    const next = anchors.filter(x => (x - originX) * sign > 1)
        .sort((a, b) => Math.abs(a - originX) - Math.abs(b - originX))[0];
    const step = current ? Math.max(MIN_COLUMN_STEP, current.right - current.x + COLUMN_GAP) :
        position.columnStep || MIN_COLUMN_STEP;
    const x = typeof next === 'number' ? next : originX + (sign * step);
    const column = columns.find(item => item.x === x);
    const selection = span || {x, y: position.y, width: 144, height: 1};
    const rows = column ? column.roots.flatMap(root => statementRows(stops, root.scriptId)) : [];
    rows.sort((a, b) => verticalGap(selection, a.bounds) - verticalGap(selection, b.bounds) ||
        Math.abs(centreY(a.bounds) - centreY(selection)) - Math.abs(centreY(b.bounds) - centreY(selection)) ||
        // A C and its child can share a centre. Prefer the matching full band,
        // not whichever parent/child happened to occur first in traversal.
        Math.abs(a.bounds.height - selection.height) - Math.abs(b.bounds.height - selection.height));
    if (rows.length && verticalGap(selection, rows[0].bounds) <= 12) return rows[0];
    return {kind: 'workspace',
        x,
        y: position.y,
        columnXs: [...anchors, x],
        columnStep: step,
        ...(Number.isFinite(position.baselineY) ? {baselineY: position.baselineY} : {})};
};

const horizontalSpan = (stops, current, range = null) => {
    if (current.kind === 'workspace') {
        return {y: current.y,
            height: 1,
            ...(Number.isFinite(current.baselineY) ? {baselineY: current.baselineY, originY: current.y} : {})};
    }
    const row = stops.find(stop => stop.kind === 'block' && stop.blockId === current.rowId);
    return rangeBounds(stops, range) || (row || current).bounds || null;
};

const spatialHorizontal = (stops, current, direction, range = null, lane = null) => {
    const row = stops.find(stop => stop.kind === 'block' && stop.blockId === current.rowId);
    const origin = row || current;
    // Body commands have horizontal row edges too. Their C owner determines
    // the script's column, not a local Left/Right destination above the row.
    if (!origin || origin.inputPosition || !origin.scriptBounds || !origin.bounds) return null;
    const selectionBounds = lane || horizontalSpan(stops, origin, range);
    return horizontalDestination(stops, {
        kind: 'workspace',
        x: origin.scriptBounds.x,
        y: selectionBounds.originY ?? selectionBounds.y,
        baselineY: selectionBounds.baselineY
    }, direction, selectionBounds);
};

const scriptBoundary = (stops, root, down) => {
    if (down) return root.canInsertBefore ? {kind: 'before', blockId: root.blockId} : root;
    const rows = mainStatementRows(stops, root.scriptId);
    const tail = rows[rows.length - 1] || root;
    return stops.find(stop => stop.blockId === tail.blockId &&
        ['gap', 'after'].includes(stop.kind) && !stop.inputName) || tail;
};

const terminalScriptStop = (stops, scriptId) => {
    const root = rootStops(stops).find(stop => stop.scriptId === scriptId);
    return root ? scriptBoundary(stops, root, false) : null;
};

const navigateFreeSpace = (stops, position, key, lane = null) => {
    if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) return position;
    if (key === 'ArrowLeft' || key === 'ArrowRight') {
        return horizontalDestination(stops, position, key === 'ArrowLeft' ? 'left' : 'right', lane);
    }
    if (key !== 'ArrowUp' && key !== 'ArrowDown') return position;
    const down = key === 'ArrowDown';
    const y = position.y + (down ? FREE_STEP : -FREE_STEP);
    // Finish a step that falls just short of a useful alignment. This extends
    // only forward in the pressed direction; distant targets keep coarse steps.
    const reach = y + (down ? FREE_SNAP_REACH : -FREE_SNAP_REACH);
    const candidates = rootStops(stops).filter(root => root.scriptBounds &&
        sameColumn(root.scriptBounds, {x: position.x, width: 144}))
        .map(root => ({
            root, edge: down ? root.scriptBounds.y : root.scriptBounds.y + root.scriptBounds.height
        }))
        .filter(item => (down ? item.edge >= position.y - 1 && item.edge <= reach :
            item.edge <= position.y + 1 && item.edge >= reach))
        .sort((a, b) => Math.abs(a.edge - position.y) - Math.abs(b.edge - position.y));
    if (candidates.length) return scriptBoundary(stops, candidates[0].root, down);
    // Once moved, reverse arrows use this location, not an old source shortcut.
    const {sourcePosition: _source, spatialDirection: _direction, ...free} = position;
    // Only adjacent occupied columns contribute guide stops, and only script
    // heads: every nested command would make dense projects painfully sticky.
    // A same-column structural destination above always wins over these guides.
    const columns = scriptColumns(stops).filter(column =>
        !sameColumn(column.anchor, {x: position.x, width: 144}));
    const neighbours = [columns.filter(column => column.x < position.x).pop(),
        columns.find(column => column.x > position.x)].filter(Boolean);
    const guides = neighbours.flatMap(column => column.roots)
        .filter(root => Number.isFinite(root.bounds?.baselineY) && Number.isFinite(root.bounds?.originY))
        .map(root => ({y: root.bounds.originY, baselineY: root.bounds.baselineY}))
        .filter(guide => (down ? guide.y > position.y + 1 && guide.y <= reach :
            guide.y < position.y - 1 && guide.y >= reach))
        .sort((a, b) => Math.abs(a.y - position.y) - Math.abs(b.y - position.y));
    if (guides.length) return {...free, ...guides[0]};
    return {...free,
        y,
        ...(Number.isFinite(position.baselineY) ?
            {baselineY: position.baselineY + y - position.y} : {})};
};

export {nextScriptBelow, previousScriptAbove, terminalScriptStop, spatialHorizontal, positionAfterColumn,
    scriptColumns, navigateFreeSpace, horizontalSpan, FREE_STEP};
