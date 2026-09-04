const DIRECTIONS = new Set(['forward', 'backward']);

const readCapturedValue = captured => (captured.kind === 'undefined' ? void 0 : captured.value);

const locationFields = location => {
    const fields = {};
    if (location.parentId) fields.newParentId = location.parentId;
    if (location.inputName) fields.newInputName = location.inputName;
    if (location.coordinate) {
        fields.newCoordinate = `${location.coordinate.x},${location.coordinate.y}`;
    }
    return fields;
};

const baseEventJson = snapshot => {
    const json = {
        type: snapshot.type,
        blockId: snapshot.blockId
    };
    if (snapshot.group) json.group = snapshot.group;
    return json;
};

const changeAction = (snapshot, direction) => ({
    ...baseEventJson(snapshot),
    type: 'change',
    element: snapshot.details.element,
    name: snapshot.details.name || void 0,
    newValue: readCapturedValue(
        direction === 'forward' ? snapshot.details.newValue : snapshot.details.oldValue
    )
});

const createAction = (snapshot, xml) => ({
    ...baseEventJson(snapshot),
    type: 'create',
    xml,
    ids: snapshot.details.ids
});

const deleteAction = snapshot => ({
    ...baseEventJson(snapshot),
    type: 'delete',
    ids: snapshot.details.ids
});

const moveAction = (snapshot, direction) => {
    const from = direction === 'forward' ? snapshot.details.oldLocation : snapshot.details.newLocation;
    const to = direction === 'forward' ? snapshot.details.newLocation : snapshot.details.oldLocation;
    return {
        eventJson: {
            ...baseEventJson(snapshot),
            type: 'move',
            ...locationFields(to)
        },
        previousLocation: {
            parentId: from.parentId,
            inputName: from.inputName,
            parentRef: from.parentRef || null
        },
        destinationLocation: to
    };
};

const variableEventJson = (snapshot, type, direction) => {
    const details = snapshot.details;
    const json = {
        type,
        varId: details.varId
    };
    if (snapshot.group) json.group = snapshot.group;
    if (type === 'var_rename') {
        json.oldName = direction === 'forward' ? details.oldName : details.newName;
        json.newName = direction === 'forward' ? details.newName : details.oldName;
    } else {
        json.varType = details.varType;
        json.varName = details.varName;
        json.isLocal = details.isLocal;
        json.isCloud = details.isCloud;
    }
    return json;
};

const commentEventJson = (snapshot, type, fields = {}) => ({
    type,
    commentId: snapshot.details.commentId,
    ...(snapshot.blockId ? {blockId: snapshot.blockId} : {}),
    ...(snapshot.group ? {group: snapshot.group} : {}),
    ...fields
});

const commentAction = (snapshot, direction) => {
    const details = snapshot.details;
    switch (snapshot.type) {
    case 'comment_create':
        return direction === 'forward' ? {
            eventJson: commentEventJson(snapshot, 'comment_create', {xml: details.xml}),
            commentState: details.state
        } : {
            eventJson: commentEventJson(snapshot, 'comment_delete')
        };
    case 'comment_delete':
        return direction === 'forward' ? {
            eventJson: commentEventJson(snapshot, 'comment_delete')
        } : {
            eventJson: commentEventJson(snapshot, 'comment_create', {xml: details.oldXml}),
            commentState: details.state
        };
    case 'comment_change': {
        const desired = direction === 'forward' ? details.newContents : details.oldContents;
        return {
            eventJson: commentEventJson(snapshot, 'comment_change', {newValue: desired}),
            commentState: {newContents: desired}
        };
    }
    case 'comment_move': {
        const desired = direction === 'forward' ? details.newCoordinate : details.oldCoordinate;
        return {
            eventJson: commentEventJson(snapshot, 'comment_move', {
                newCoordinate: `${desired.x},${desired.y}`
            }),
            commentState: {newCoordinate: desired}
        };
    }
    default:
        return null;
    }
};

const listDefinitionState = (snapshot, direction) => {
    const definition = snapshot.details && snapshot.details.definition;
    if (!definition) return null;
    const desired = direction === 'forward' ? definition.after : definition.before;
    if (desired) return desired;
    const previous = definition.before || definition.after;
    return {
        present: false,
        id: previous.id,
        targetRef: previous.targetRef,
        type: Object.prototype.hasOwnProperty.call(previous, 'type') ? previous.type : 'list'
    };
};

/**
 * Convert a durable Studio snapshot into one forward-running Scratch Blocks
 * action. Backward actions swap state rather than relying on a hidden undo stack.
 *
 * @param {object} snapshot durable event snapshot
 * @param {'forward'|'backward'} direction replay direction
 * @returns {object} executable action contract
 */
const createBlockEventAction = (snapshot, direction) => {
    if (!DIRECTIONS.has(direction)) throw new Error(`Unknown replay direction: ${direction}`);

    let eventJson;
    let previousLocation = null;
    let destinationLocation = null;
    let listDefinition = null;
    let commentState = null;
    switch (snapshot.type) {
    case 'change':
        eventJson = changeAction(snapshot, direction);
        break;
    case 'create':
        eventJson = direction === 'forward' ?
            createAction(snapshot, snapshot.details.xml) : deleteAction(snapshot);
        break;
    case 'delete':
        eventJson = direction === 'forward' ?
            deleteAction(snapshot) : createAction(snapshot, snapshot.details.oldXml);
        break;
    case 'move': {
        const action = moveAction(snapshot, direction);
        eventJson = action.eventJson;
        previousLocation = action.previousLocation;
        destinationLocation = action.destinationLocation;
        break;
    }
    case 'var_create':
        eventJson = variableEventJson(
            snapshot,
            direction === 'forward' ? 'var_create' : 'var_delete',
            direction
        );
        listDefinition = listDefinitionState(snapshot, direction);
        break;
    case 'var_delete':
        eventJson = variableEventJson(
            snapshot,
            direction === 'forward' ? 'var_delete' : 'var_create',
            direction
        );
        listDefinition = listDefinitionState(snapshot, direction);
        break;
    case 'var_rename':
        eventJson = variableEventJson(snapshot, 'var_rename', direction);
        listDefinition = listDefinitionState(snapshot, direction);
        break;
    case 'comment_create':
    case 'comment_change':
    case 'comment_move':
    case 'comment_delete': {
        const action = commentAction(snapshot, direction);
        eventJson = action.eventJson;
        commentState = action.commentState || null;
        break;
    }
    default:
        throw new Error(`Unsupported replay event: ${snapshot.type}`);
    }

    return {
        targetId: snapshot.targetId,
        targetRef: snapshot.targetRef || {runtimeId: snapshot.targetId},
        blockRef: snapshot.blockRef || null,
        eventJson,
        commentState,
        listDefinition,
        previousLocation,
        destinationLocation
    };
};

export {createBlockEventAction, listDefinitionState};
