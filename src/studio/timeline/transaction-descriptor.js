const BLOCK_LABELS = {
    event_whenflagclicked: 'when flag clicked',
    event_whenthisspriteclicked: 'when sprite clicked',
    motion_movesteps: 'move steps',
    looks_nextbackdrop: 'next backdrop',
    control_if: 'if',
    control_if_else: 'if / else',
    control_repeat: 'repeat',
    control_forever: 'forever',
    operator_equals: 'equals',
    operator_join: 'join',
    procedures_definition: 'custom block definition'
};

const humanize = value => String(value || 'block')
    .replace(/^[^_]+_/, '')
    .replace(/_/g, ' ')
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .toLowerCase();

const blockLabel = event => BLOCK_LABELS[event.blockType] || humanize(event.blockType);

const variableLabel = event => {
    const details = event.details || {};
    const kind = details.varType === 'broadcast_msg' ? 'broadcast' :
        details.varType === 'list' ? 'list' : 'variable';
    return `${kind}${details.varName ? ` “${details.varName}”` : ''}`;
};

const operationLabel = operation => {
    if (!operation) return 'Project operation';
    const labels = {
        'sprite-create': 'Add sprite',
        'sprite-library-add': 'Add sprite',
        'sprite-duplicate': 'Duplicate sprite',
        'sprite-rename': 'Rename sprite',
        'sprite-delete': 'Delete sprite',
        'sprite-reorder': 'Reorder sprite',
        'block-share': 'Copy script',
        'block-import': 'Import script',
        'costume-share': 'Add costume',
        'costume-add': 'Add costume',
        'costume-library-add': 'Add costume',
        'costume-edit': 'Edit costume',
        'costume-edit-session': 'Edit costumes',
        'backdrop-library-add': 'Add backdrop',
        'backdrop-add': 'Add backdrop',
        'backdrop-edit': 'Edit backdrop',
        'backdrop-edit-session': 'Edit backdrops',
        'costume-duplicate': 'Duplicate costume',
        'costume-rename': 'Rename costume',
        'costume-delete': 'Delete costume',
        'costume-reorder': 'Reorder costume',
        'backdrop-share': 'Add backdrop',
        'backdrop-duplicate': 'Duplicate backdrop',
        'backdrop-rename': 'Rename backdrop',
        'backdrop-delete': 'Delete backdrop',
        'backdrop-reorder': 'Reorder backdrop',
        'sound-add': 'Add sound',
        'sound-share': 'Add sound',
        'sound-duplicate': 'Duplicate sound',
        'sound-rename': 'Rename sound',
        'sound-delete': 'Delete sound',
        'sound-reorder': 'Reorder sound',
        'sound-edit': 'Edit sound'
    };
    return labels[operation.type] || humanize(operation.type);
};

const dataEditLabel = transaction => {
    if (transaction.dataEditLabel) return transaction.dataEditLabel;
    const properties = new Set();
    [...(transaction.beforeDataDeltas || []), ...(transaction.afterDataDeltas || [])].forEach(delta => {
        (delta.targets || []).forEach(target => {
            Object.keys(target.properties || {}).forEach(property => properties.add(property));
        });
    });
    if (properties.size === 1) return `Set ${humanize([...properties][0])}`;
    if (properties.size > 1 && [...properties].every(property => property === 'x' || property === 'y')) {
        return 'Move sprite';
    }
    if (properties.size > 1) return 'Edit sprite properties';
    return 'Edit project data';
};

/**
 * Produce a compact stable label for one transaction boundary.
 *
 * @param {object} transaction Studio transaction
 * @param {number} index zero-based transaction index
 * @returns {object} timeline descriptor
 */
const describeTransaction = (transaction, index) => {
    let label;
    if (transaction.kind === 'project-operation') {
        label = operationLabel(transaction.operation);
    } else if (transaction.kind === 'data-edit') {
        label = dataEditLabel(transaction);
    } else {
        const events = transaction.events || [];
        const event = events.find(item => item.type !== 'move') || events[0] || {};
        if (event.type === 'var_create') label = `Create ${variableLabel(event)}`;
        else if (event.type === 'var_delete') label = `Delete ${variableLabel(event)}`;
        else if (event.type === 'comment_create') label = 'Add comment';
        else if (event.type === 'comment_delete') label = 'Delete comment';
        else if (event.type === 'comment_move') label = 'Move comment';
        else if (event.type === 'comment_change') label = 'Edit comment';
        else if (event.type === 'create') label = `Add ${blockLabel(event)}`;
        else if (event.type === 'delete') label = `Delete ${blockLabel(event)}`;
        else if (event.type === 'move') label = `Move ${blockLabel(event)}`;
        else if (event.type === 'change') label = `Edit ${blockLabel(event)}`;
        else label = 'Edit project';
    }
    const operationReference = transaction.operation && (transaction.operation.createdTargetRef ||
            transaction.operation.renamedTargetRef || transaction.operation.deletedTargetRef ||
            transaction.operation.movedTargetRef ||
            transaction.operation.targetRef || transaction.operation.afterEditingTargetRef);
    const reference = (transaction.kind === 'project-operation' && operationReference) ||
        transaction.targetRef ||
        (transaction.events && transaction.events[0] && transaction.events[0].targetRef) ||
        operationReference || null;
    return {
        index: index + 1,
        label,
        target: reference && reference.name ? reference.name : null
    };
};

export {describeTransaction};
