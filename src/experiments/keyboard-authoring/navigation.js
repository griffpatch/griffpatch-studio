import {positionKey} from './navigation-location';
import {canonicalPosition, editableFields, fieldAtPosition, firstInput, valueInputPosition,
    navigationStops} from './navigation-topology';
import {nextScriptBelow, previousScriptAbove, terminalScriptStop, spatialHorizontal,
    positionAfterColumn, navigateFreeSpace} from './navigation-spatial';

// Capture the semantic deletion site BEFORE native disposal heals connections
// and recreates default shadows. Never anchor a replacement caret to a removed
// block or to a transient shadow ID.
const deletionPosition = (workspace, position, {backwards = false} = {}) => {
    const block = position && workspace.getBlockById(position.blockId);
    if (!block || position.kind !== 'block' || block.isShadow()) return null;
    const stops = navigationStops(workspace);
    const index = stops.findIndex(stop => stop.kind === 'block' && stop.blockId === block.id);
    const current = stops[index];
    if (backwards && current) {
        for (let i = index - 1; i >= 0; i--) {
            const previous = stops[i];
            if (previous.scriptId !== current.scriptId) break;
            if (previous.kind !== 'block') continue;
            // Commands move back through command rows; expressions through
            // their own row's expression tree. Neither visits fields or gaps.
            if (block.outputConnection ? previous.rowId === current.rowId : previous.rowId === previous.blockId) {
                return {kind: 'block', blockId: previous.blockId};
            }
        }
    }
    if (current && current.inputPosition) return {...current.inputPosition};
    if (current && current.beforePosition) return {...current.beforePosition};
    const tail = block.getNextBlock();
    if (tail) return {kind: 'before', blockId: tail.id};
    const {x, y} = block.getRelativeToSurfaceXY();
    return {kind: 'workspace', x, y};
};

const outerScriptBoundary = (stops, position, end = false) => {
    if (!position || position.kind === 'workspace') return position;
    const current = stops.find(stop => stop.blockId === position.blockId);
    if (!current) return position;
    const rows = stops.filter(stop => stop.scriptId === current.scriptId && stop.kind === 'block' &&
        stop.blockId === stop.rowId && !stop.bodyPosition);
    if (!rows.length) return position;
    if (!end) return rows[0];
    const tail = rows[rows.length - 1];
    return stops.find(stop => stop.blockId === tail.blockId &&
        ['gap', 'after'].includes(stop.kind) && !stop.inputName) || tail;
};

const navigate = (stops, position, key, backwards = false, range = null, lane = null) => {
    if (position && position.kind === 'workspace') {
        if (position.sourcePosition) {
            const reverse = (position.spatialDirection === 'down' && key === 'ArrowUp') ||
                (position.spatialDirection === 'left' && key === 'ArrowRight') ||
                (position.spatialDirection === 'right' && key === 'ArrowLeft');
            if (reverse) {
                return stops.find(stop => positionKey(stop) === positionKey(position.sourcePosition)) || position;
            }
        }
        if (key.startsWith('Arrow')) return navigateFreeSpace(stops, position, key, lane);
        if (key === 'Home' || key === 'End') return position;
    }
    if (!stops.length) return position;
    if (position && position.kind === 'before') {
        const anchor = stops.find(stop => stop.kind === 'block' && stop.blockId === position.blockId);
        if (anchor) {
            // Shift+Enter can leave a before-caret after a cancelled draft.
            // When connected, that is the existing incoming boundary, not a
            // second top-of-stack stop with different arrow behaviour.
            if (anchor.beforePosition) return navigate(stops, anchor.beforePosition, key, backwards, range, lane);
            if (key === 'ArrowUp') {
                // The first Up on a hatless root exposes this insertion site;
                // a second Up can now continue spatially to the stack above.
                const above = previousScriptAbove(stops, anchor);
                return above ? terminalScriptStop(stops, above.scriptId) || above : position;
            }
            if (key === 'ArrowLeft' || key === 'ArrowRight') {
                return spatialHorizontal(stops, anchor,
                    key === 'ArrowLeft' ? 'left' : 'right', range, lane) || position;
            }
            if (key === 'ArrowDown' || (key === 'Tab' && !backwards)) return anchor;
            return navigate(stops, anchor, key, backwards, range, lane);
        }
    }
    const index = stops.findIndex(stop => positionKey(stop) === positionKey(position));
    if (index < 0) return stops[0];
    const current = stops[index];
    if (key === 'Home' || key === 'End') {
        // Inputs/reporters belong to their command row. A C-mouth caret belongs
        // to that branch instead; its owner must not pull navigation into the
        // outer chain or a neighbouring then/else body.
        const row = stops.find(stop => stop.kind === 'block' && stop.blockId === current.rowId);
        const body = current.kind === 'gap' && current.inputName ? current : row && row.bodyPosition;
        const bodyKey = positionKey(body);
        const chain = stops.filter(stop => stop.kind === 'block' && stop.blockId === stop.rowId &&
            stop.scriptId === current.scriptId && positionKey(stop.bodyPosition) === bodyKey);
        if (!chain.length) return current; // An empty mouth is already its own insertion site.
        if (key === 'Home') return chain[0];
        const tail = chain[chain.length - 1];
        // Caps have no legal insertion below. Loose reporters retain their
        // separate new-script boundary; ordinary statements use the native gap.
        return stops.find(stop => (stop.kind === 'gap' || stop.kind === 'after') &&
            stop.blockId === tail.blockId && !stop.inputName) || tail;
    }
    if (key === 'ArrowUp' || key === 'ArrowDown') {
        // Existing statements are the vertical stops, not every connection
        // between them. Empty mouths and stack ends remain directly writable.
        // Keep an explicitly opened occupied boundary in this traversal so
        // Escape followed by Up/Down leaves it in the expected direction.
        const rows = stops.filter(stop => stop.scriptId === current.scriptId && (
            (stop.kind === 'block' && stop.blockId === stop.rowId) || stop.kind === 'after' ||
            (stop.kind === 'gap' && (!stop.occupied || stop === current))));
        const row = rows.findIndex(stop => stop === current ||
            (current.kind !== 'gap' && current.kind !== 'after' &&
                stop.kind === 'block' && stop.blockId === current.rowId));
        const anchor = rows[row];
        const adjacent = rows[row + (key === 'ArrowUp' ? -1 : 1)];
        if (adjacent) return adjacent;
        if (key === 'ArrowUp') {
            // At the root of a hatless command stack, Up means "insert above"
            // even when another visual stack happens to be nearby. Moving to
            // that other stack here would make the legal head insertion
            // unreachable by arrows and would depend on incidental layout.
            if (anchor && anchor.canInsertBefore) {
                return {kind: 'before', blockId: anchor.blockId};
            }
            const above = previousScriptAbove(stops, current);
            if (above) return terminalScriptStop(stops, above.scriptId) || above;
        }
        if (key === 'ArrowDown') {
            // A second Down at an ordinary tail, or the first Down on a cap,
            // continues within the same visual column. Inputs and fields are
            // deliberately skipped: vertical movement enters another stack
            // at its whole root block, just as it does within one.
            const below = nextScriptBelow(stops, current);
            if (below) return below;
            const newScript = positionAfterColumn(current);
            if (newScript) return newScript;
            // Geometry-free unit fixtures and a temporarily unrendered native
            // workspace retain the deterministic document-order fallback.
            for (let next = index + 1; next < stops.length; next++) {
                const stop = stops[next];
                if (stop.scriptId !== current.scriptId && stop.kind === 'block' &&
                    stop.blockId === stop.rowId) return stop;
            }
        }
        return anchor || current;
    }
    if (key === 'ArrowLeft' || key === 'ArrowRight') {
        const blockStop = id => stops.find(stop => stop.kind === 'block' && stop.blockId === id);
        if (range && Array.isArray(range.blockIds) && range.blockIds.length > 1) {
            return spatialHorizontal(stops, current, key === 'ArrowLeft' ? 'left' : 'right', range, lane) || current;
        }
        // Statement boundaries, including C mouths, belong to the vertical
        // path. From a boundary Left/Right can only depart to another column.
        if (current.kind === 'gap' || current.kind === 'after') {
            return spatialHorizontal(stops, current,
                key === 'ArrowLeft' ? 'left' : 'right', range, lane) || current;
        }
        if (key === 'ArrowLeft' && current.kind === 'block') {
            const parent = current.inputPosition;
            return parent ? blockStop(parent.blockId) :
                spatialHorizontal(stops, current, 'left', range, lane) || current;
        }
        const row = stops.filter(stop => stop.rowId === current.rowId &&
            stop.kind !== 'after' && stop.kind !== 'gap');
        const at = row.indexOf(current);
        const next = row[at + (key === 'ArrowLeft' ? -1 : 1)];
        if (next) return next;
        return spatialHorizontal(stops, current, key === 'ArrowLeft' ? 'left' : 'right', range, lane) || current;
    }
    const delta = key === 'Tab' && backwards ? -1 : 1;
    for (let next = index + delta; next >= 0 && next < stops.length; next += delta) {
        if (!stops[next].occupied) return stops[next];
    }
    return current;
};

// Native Undo can delete the block that owns the caret. Retain the nearest
// surviving structural boundary from the previous document, not its first row.
const recoverPosition = (stops, previousStops, position) => {
    if (!position || position.kind === 'workspace') return position;
    const byKey = new Map(stops.map(stop => [positionKey(stop), stop]));
    const exact = byKey.get(positionKey(position));
    if (exact) return exact;
    const owner = stops.find(stop => stop.kind === 'block' && stop.blockId === position.blockId);
    if (owner) return position.kind === 'before' ? position : owner;
    const oldIndex = previousStops.findIndex(stop => positionKey(stop) === positionKey(position) ||
        (position.kind === 'before' && stop.kind === 'block' && stop.blockId === position.blockId));
    const survivingStop = previous => previous && (byKey.get(positionKey(previous)) ||
        byKey.get(positionKey(previous.inputPosition)));
    const restoredInput = survivingStop(previousStops[oldIndex]);
    if (restoredInput) return restoredInput;
    for (let index = oldIndex - 1; index >= 0; index--) {
        const survivor = survivingStop(previousStops[index]);
        if (survivor) return survivor;
    }
    for (let index = oldIndex + 1; index < previousStops.length; index++) {
        const survivor = survivingStop(previousStops[index]);
        if (survivor) return survivor;
    }
    return stops[0] || null;
};

const resolveConnection = (workspace, position) => {
    const block = position && workspace.getBlockById(position.blockId);
    if (!block) return null;
    if (position.kind === 'before') return block.previousConnection && block.previousConnection.targetConnection;
    if (position.inputName) {
        const input = block.getInput(position.inputName);
        return input && input.connection;
    }
    return position.kind === 'gap' ? block.nextConnection : null;
};

export {canonicalPosition, deletionPosition, editableFields, fieldAtPosition, firstInput, valueInputPosition,
    navigate, navigationStops, positionKey, recoverPosition, resolveConnection, outerScriptBoundary};
