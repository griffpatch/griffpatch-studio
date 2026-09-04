import {canonicalPosition} from './navigation-topology';
import {semanticPosition} from './navigation-location';

const memories = new WeakMap();
const copyPosition = position => {
    if (!position) return null;
    if (position.kind !== 'workspace') return semanticPosition(position);
    return Number.isFinite(position.x) && Number.isFinite(position.y) ?
        {kind: 'workspace',
            x: position.x,
            y: position.y,
            ...(Number.isFinite(position.baselineY) ? {baselineY: position.baselineY} : {})} : null;
};

// Save identities and local recovery boundaries, not a stale flattened topology
// or live SVG/Blockly object. Default shadows remain owned by their input slot.
const captureCaret = (workspace, at, range = null) => {
    const position = copyPosition(canonicalPosition(workspace, at));
    if (!position) return null;
    const fallback = [];
    let block = workspace.getBlockById(position.blockId);
    if (!block && position.kind !== 'workspace') return null;
    const point = block?.getRelativeToSurfaceXY?.() || position;
    const seen = new Set();
    if (block && position.kind !== 'block') fallback.push({kind: 'block', blockId: block.id});
    while (block && !seen.has(block.id)) {
        seen.add(block.id);
        const parent = block.getParent?.();
        if (parent) {
            const child = block;
            const slot = parent.inputList.find(input => input.connection?.targetBlock() === child);
            fallback.push(slot ? {kind: slot.connection.type === 3 ? 'gap' : 'input',
                blockId: parent.id,
                inputName: slot.name} : {kind: 'gap', blockId: parent.id});
            fallback.push({kind: 'block', blockId: parent.id});
        } else {
            const next = block.getNextBlock?.();
            if (next) fallback.push({kind: 'before', blockId: next.id});
        }
        block = parent;
    }
    if (Number.isFinite(point.x) && Number.isFinite(point.y)) {
        fallback.push({kind: 'workspace', x: point.x, y: point.y});
    }
    return {position,
        fallback,
        range: range ? {
            anchorBlockId: range.anchorBlockId, focusBlockId: range.focusBlockId
        } : null};
};

const resolveCaret = (workspace, saved) => {
    if (!saved) return null;
    for (const at of [saved.position, ...(saved.fallback || [])]) {
        const position = copyPosition(at);
        if (!position) continue;
        if (position.kind === 'workspace') return position;
        const block = workspace.getBlockById(position.blockId);
        if (!block) continue;
        if (position.kind === 'before' && !block.previousConnection) continue;
        if (position.kind === 'field' && !block.getField(position.fieldName)) continue;
        if (position.inputName) {
            const connection = block.getInput(position.inputName)?.connection;
            if (!connection || (position.kind === 'gap' ? connection.type !== 3 : connection.type !== 1)) continue;
        } else if (position.kind === 'gap' && !block.nextConnection) continue;
        return canonicalPosition(workspace, position);
    }
    return null;
};

const getCaretMemory = vm => {
    let memory = memories.get(vm);
    if (!memory) {
        memory = {enabled: false, locations: new Map()};
        memories.set(vm, memory);
        vm.runtime.on('PROJECT_LOADED', () => {
            memory.enabled = false;
            memory.locations.clear();
        });
    }
    return memory;
};

export {captureCaret, resolveCaret, getCaretMemory};
