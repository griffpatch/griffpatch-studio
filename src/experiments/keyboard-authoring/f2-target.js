import {editableFields, fieldAtPosition} from './navigation';

const allFields = block => (block.inputList || []).reduce((fields, input) =>
    fields.concat(input.fieldRow || []), []);

const referencedVariable = field => field && typeof field.getVariable === 'function' && field.getVariable();
const procedureTypes = ScratchBlocks => new Set([
    ScratchBlocks.PROCEDURES_CALL_BLOCK_TYPE || 'procedures_call',
    ScratchBlocks.PROCEDURES_DEFINITION_BLOCK_TYPE || 'procedures_definition',
    ScratchBlocks.PROCEDURES_PROTOTYPE_BLOCK_TYPE || 'procedures_prototype'
]);

// F2 acts on the semantic item represented by the caret. A variable menu is a
// reference to a variable, not merely a dropdown; ordinary fields remain
// ordinary native editors. Broadcast command menus live in a shadow child, so
// include only a directly owned broadcast shadow rather than searching through
// arbitrary nested user expressions.
const f2Target = (workspace, ScratchBlocks, position) => {
    const block = position && workspace.getBlockById(position.blockId);
    if (!block) return null;
    if (position.kind === 'block' && procedureTypes(ScratchBlocks).has(block.type)) {
        return {kind: 'procedure', block};
    }
    const direct = fieldAtPosition(workspace, position);
    if (direct) {
        const variable = referencedVariable(direct.field);
        return variable ? {kind: 'variable', ...direct, variable} : {kind: 'field', ...direct};
    }
    if (position.kind !== 'block') return null;
    for (const field of allFields(block)) {
        const variable = referencedVariable(field);
        if (variable) return {kind: 'variable', block, field, variable};
    }
    for (const input of block.inputList || []) {
        const child = input.connection && input.connection.targetBlock();
        if (!child || !child.isShadow()) continue;
        for (const field of allFields(child)) {
            const variable = referencedVariable(field);
            if (variable && variable.type === ScratchBlocks.BROADCAST_MESSAGE_VARIABLE_TYPE) {
                return {kind: 'variable', block: child, field, variable};
            }
        }
    }
    const field = editableFields(block)[0];
    return field ? {kind: 'field', block, field} : null;
};

export {allFields, f2Target, referencedVariable};
