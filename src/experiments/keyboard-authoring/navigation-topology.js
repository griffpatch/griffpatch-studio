import {scriptColumns} from './navigation-spatial';
import {blockRowMetrics} from './block-row-geometry';

const nativeBounds = block => {
    try {
        const xy = block && block.getRelativeToSurfaceXY && block.getRelativeToSurfaceXY();
        const size = block && block.getHeightWidth && block.getHeightWidth();
        if (!xy || !size || ![xy.x, xy.y, size.width, size.height].every(Number.isFinite)) return null;
        return {x: xy.x, y: xy.y, width: size.width, height: size.height};
    } catch {
        // A native render can be between dispose and rebuild while Undo settles.
        // Semantic traversal remains available without the optional snapshot.
        return null;
    }
};

// getHeightWidth intentionally includes a statement continuation. That is the
// right geometry for a complete script, but it makes every statement look like
// the whole tail during row-to-row navigation. Prefer the block's own rendered
// path there so a tall selection can be compared with each actual target row.
const blockBounds = block => {
    try {
        const xy = block && block.getRelativeToSurfaceXY && block.getRelativeToSurfaceXY();
        const box = block && block.svgPath_ && block.svgPath_.getBBox && block.svgPath_.getBBox();
        if (xy && box && [xy.x, xy.y, box.x, box.y, box.width, box.height].every(Number.isFinite)) {
            // Full outlines choose neighbouring rows. The independent native
            // text baseline positions new blocks, even with tall first inputs.
            return {x: xy.x + box.x,
                y: xy.y + box.y,
                width: box.width,
                height: box.height,
                originY: xy.y,
                ...blockRowMetrics(block)};
        }
        if (xy && [xy.x, xy.y, block.width, block.height].every(Number.isFinite)) {
            return {x: xy.x, y: xy.y, width: block.width, height: block.height};
        }
    } catch {
        // A disposed SVG path can disappear during native workspace replacement.
    }
    return nativeBounds(block);
};

const isEditableField = field => field.name && field.EDITABLE && field.isCurrentlyEditable();
const editableFields = block => (block.inputList || []).reduce((all, input) =>
    all.concat(input.fieldRow.filter(isEditableField)), []);

// A default shadow is the value of its slot, not another navigation level.
// Keep that caret on the owning connection even when native undo replaces the
// shadow object. A real reporter, conversely, owns its single block stop.
const canonicalPosition = (workspace, position) => {
    const block = position && workspace.getBlockById(position.blockId);
    if (!block) return position;
    if (position.kind === 'input') {
        const slot = block.getInput(position.inputName);
        const child = slot && slot.connection && slot.connection.targetBlock();
        if (child && !child.isShadow()) return {kind: 'block', blockId: child.id};
    } else if (position.kind === 'field' && block.isShadow() && editableFields(block).length === 1) {
        const parent = block.getParent();
        const slot = parent && parent.inputList.find(input =>
            input.connection && input.connection.targetBlock() === block);
        if (slot) return {kind: 'input', blockId: parent.id, inputName: slot.name};
    }
    return position;
};

const fieldAtPosition = (workspace, position) => {
    const block = position && workspace.getBlockById(position.blockId);
    if (!block) return null;
    if (position.kind === 'field') {
        const field = editableFields(block).find(candidate => candidate.name === position.fieldName);
        return field ? {block, field} : null;
    }
    if (position.kind === 'input') {
        const slot = block.getInput(position.inputName);
        const child = slot && slot.connection && slot.connection.targetBlock();
        const fields = child && child.isShadow() && editableFields(child);
        if (fields && fields.length === 1) return {block: child, field: fields[0]};
    }
    return null;
};

const valueInputPosition = (block, input) => {
    const child = input.connection.targetBlock();
    if (child && !child.isShadow()) return {kind: 'block', blockId: child.id};
    const fields = child ? editableFields(child) : [];
    if (fields.length > 1) return {kind: 'field', blockId: child.id, fieldName: fields[0].name};
    return {kind: 'input', blockId: block.id, inputName: input.name};
};

// A chosen block's operands come before its inline selector (e.g. abs/floor),
// even if both live on the same native input row. Menus remain normal Tab stops;
// a selector-only block still starts at its field, before any C body.
const firstInput = block => {
    if (!block) return null;
    const value = block.inputList.find(input => input.connection && input.connection.type === 1);
    if (value) return valueInputPosition(block, value);
    for (const input of block.inputList) {
        const field = input.fieldRow.find(isEditableField);
        if (field) return {kind: 'field', blockId: block.id, fieldName: field.name};
        if (input.connection && input.connection.type === 3) {
            const child = input.connection.targetBlock();
            if (child && child.isShadow() && child.type === 'procedures_prototype') {
                return {kind: 'gap', blockId: block.id};
            }
            return {kind: 'gap', blockId: block.id, inputName: input.name};
        }
    }
    return null;
};

const navigationStops = workspace => {
    const stops = [];
    const seen = new Set();
    let roots = workspace.getTopBlocks(true);
    // Full-script sizing traverses the native tail. Do it only once per root.
    const boundsById = new Map(roots.map(block => [block.id, nativeBounds(block)]));
    if (roots.every(block => boundsById.get(block.id))) {
        const byId = new Map(roots.map(block => [block.id, block]));
        const columns = scriptColumns(roots.map(block => ({
            kind: 'block', blockId: block.id, scriptId: block.id, scriptBounds: boundsById.get(block.id)
        })));
        roots = columns.flatMap(column => column.roots.map(root => byId.get(root.blockId)));
    }
    const rootIds = new Set(roots.map(block => block.id));
    const visit = (block, {scriptId, scriptBounds, rowId, inputPosition, bodyPosition, beforePosition}) => {
        if (!block || seen.has(block.id) || block.isShadow()) return;
        seen.add(block.id);
        const row = rowId || block.id;
        const bounds = blockBounds(block);
        const context = {rowId: row, scriptId};
        if (scriptBounds) context.scriptBounds = scriptBounds;
        if (bounds) context.bounds = bounds;
        const blockStop = {kind: 'block', blockId: block.id, ...context};
        // Only an actual top-level statement with an upper connection can
        // offer insertion above itself. Hats and loose reporters cannot.
        if (rootIds.has(block.id) && block.previousConnection) blockStop.canInsertBefore = true;
        // Keep the owning boundary for caret recovery, but do not make it an
        // extra stop with an identical outline around this reporter.
        if (inputPosition) blockStop.inputPosition = inputPosition;
        // Keep branch ownership for Home/End, ranges and recovery. It is not
        // a horizontal navigation edge. Next connections retain this scope.
        if (bodyPosition) blockStop.bodyPosition = bodyPosition;
        if (beforePosition) blockStop.beforePosition = beforePosition;
        stops.push(blockStop);
        for (const input of block.inputList) {
            for (const field of input.fieldRow) {
                if (isEditableField(field)) {
                    stops.push({kind: 'field', blockId: block.id, fieldName: field.name, ...context});
                }
            }
            if (!input.connection) continue;
            const child = input.connection.targetBlock();
            // Scratch's statement input is NEXT_STATEMENT (3), not INPUT_VALUE (1).
            if (input.connection.type === 3) {
                // A custom definition's statement input contains only its
                // non-editable signature prototype. Its actual body belongs
                // to the definition hat's next connection and is visited by
                // the ordinary statement-chain path below.
                const prototype = child && child.isShadow() && child.type === 'procedures_prototype';
                if (!prototype) {
                    const mouth = {kind: 'gap', blockId: block.id, inputName: input.name};
                    stops.push({...mouth, ...context, firstBlockId: child && child.id, occupied: Boolean(child)});
                    visit(child, {scriptId, scriptBounds, bodyPosition: mouth, beforePosition: mouth});
                }
            } else if (child && !child.isShadow()) {
                visit(child, {...context, inputPosition: {kind: 'input', blockId: block.id, inputName: input.name}});
            } else {
                const fields = child ? editableFields(child) : [];
                if (fields.length <= 1) {
                    stops.push({kind: 'input', blockId: block.id, inputName: input.name, ...context});
                } else {
                    for (const field of fields) {
                        stops.push({kind: 'field', blockId: child.id, fieldName: field.name, ...context});
                    }
                }
            }
        }
        if (block.nextConnection) {
            stops.push({kind: 'gap', blockId: block.id, ...context, occupied: Boolean(block.getNextBlock())});
        }
        visit(block.getNextBlock(), {
            scriptId,
            scriptBounds,
            bodyPosition,
            beforePosition: {kind: 'gap', blockId: block.id}
        });
    };
    roots.forEach(block => {
        const scriptBounds = boundsById.get(block.id);
        visit(block, {scriptId: block.id, scriptBounds});
        // A loose reporter has no next connection, but must not trap the caret
        // in its last operand. This boundary starts a separate script below it.
        if (block.outputConnection) {
            stops.push({kind: 'after', blockId: block.id, rowId: block.id, scriptId: block.id});
        }
    });
    return stops;
};


export {canonicalPosition, editableFields, fieldAtPosition, firstInput, valueInputPosition, navigationStops};
