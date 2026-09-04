import {cloneJson} from '../lib/clone-json';
import {canonicalJson} from '../validation/canonical-json';

const BLOCK_EVENT_TYPES = new Set([
    'change',
    'create',
    'delete',
    'move',
    'comment_create',
    'comment_change',
    'comment_move',
    'comment_delete',
    'var_create',
    'var_delete',
    'var_rename'
]);

const captureValue = value => {
    if (typeof value === 'undefined') {
        return {kind: 'undefined'};
    }
    return {
        kind: 'value',
        value: cloneJson(value)
    };
};

const finiteCoordinateComponent = value => {
    const number = Number(value);
    if (!Number.isFinite(number)) throw new Error('Studio cannot snapshot a non-finite block coordinate');
    return Object.is(number, -0) ? 0 : number;
};

const captureCoordinate = coordinate => {
    if (!coordinate) return null;
    return {
        // Blockly's Move#toJson rounds coordinates, but scratch-vm receives
        // the original floating-point Coordinate object. Preserve that value
        // so replay crosses the same Math.round boundary when the VM later
        // serializes the project. Rounded coordinates remain appropriate for
        // durable block-reference lookup, but not for authored state.
        x: finiteCoordinateComponent(coordinate.x),
        y: finiteCoordinateComponent(coordinate.y)
    };
};

const optionalId = value => value || null;

const captureCommentState = event => ({
    text: String(event.text || ''),
    coordinate: captureCoordinate(event.xy),
    width: finiteCoordinateComponent(event.width),
    height: finiteCoordinateComponent(event.height),
    minimized: Boolean(event.minimized)
});

const serializeXml = (xml, xmlToText, eventType) => {
    if (!xml) {
        throw new Error(`Studio cannot snapshot ${eventType}: event XML is missing`);
    }
    if (typeof xmlToText !== 'function') {
        throw new Error(`Studio cannot snapshot ${eventType}: xmlToText is missing`);
    }
    return xmlToText(xml);
};

const captureDetails = (event, xmlToText, variableDefinition) => {
    switch (event.type) {
    case 'change':
        return {
            element: event.element,
            name: event.name || null,
            oldValue: captureValue(event.oldValue),
            newValue: captureValue(event.newValue)
        };
    case 'create':
        return {
            xml: serializeXml(event.xml, xmlToText, event.type),
            ids: cloneJson(event.ids)
        };
    case 'delete':
        return {
            oldXml: serializeXml(event.oldXml, xmlToText, event.type),
            ids: cloneJson(event.ids)
        };
    case 'move':
        return {
            oldLocation: {
                parentId: optionalId(event.oldParentId),
                inputName: optionalId(event.oldInputName),
                coordinate: captureCoordinate(event.oldCoordinate)
            },
            newLocation: {
                parentId: optionalId(event.newParentId),
                inputName: optionalId(event.newInputName),
                coordinate: captureCoordinate(event.newCoordinate)
            }
        };
    case 'var_create':
    case 'var_delete':
        return {
            varId: event.varId,
            varType: event.varType,
            varName: event.varName,
            isLocal: Boolean(event.isLocal),
            isCloud: Boolean(event.isCloud),
            definition: cloneJson(variableDefinition)
        };
    case 'var_rename':
        return {
            varId: event.varId,
            oldName: event.oldName,
            newName: event.newName,
            definition: cloneJson(variableDefinition)
        };
    case 'comment_create':
        return {
            commentId: event.commentId,
            xml: serializeXml(event.xml, xmlToText, event.type),
            state: captureCommentState(event)
        };
    case 'comment_delete':
        return {
            commentId: event.commentId,
            oldXml: serializeXml(event.xml, xmlToText, event.type),
            state: captureCommentState(event)
        };
    case 'comment_change':
        return {
            commentId: event.commentId,
            oldContents: cloneJson(event.oldContents_),
            newContents: cloneJson(event.newContents_)
        };
    case 'comment_move':
        return {
            commentId: event.commentId,
            oldCoordinate: captureCoordinate(event.oldCoordinate_),
            newCoordinate: captureCoordinate(event.newCoordinate_)
        };
    default:
        return null;
    }
};

/**
 * Scratch Blocks can emit a CommentChange while refreshing a comment even
 * though the represented state did not change. Those implementation events
 * are not authored actions and must not become visible Studio transactions.
 *
 * @param {object} snapshot durable Studio event snapshot
 * @returns {boolean} true when old and new comment state are semantically equal
 */
const isSemanticallyNullCommentChange = snapshot => Boolean(
    snapshot && snapshot.type === 'comment_change' && snapshot.details &&
    canonicalJson(snapshot.details.oldContents) === canonicalJson(snapshot.details.newContents)
);

/**
 * Copy a live Scratch Blocks event while its inverse fields are still present.
 * Returns null for events outside the first spike's state-changing block types.
 *
 * @param {object} event live Scratch Blocks event
 * @param {object} context Studio capture context
 * @param {string} context.targetId stable VM target ID
 * @param {number} context.recordedAtMs source-take time
 * @param {Function} context.xmlToText ScratchBlocks.Xml.domToText
 * @returns {?object} durable Studio event snapshot
 */
const snapshotBlockEvent = (event, {
    targetId,
    targetName = null,
    targetIsStage = false,
    recordedAtMs,
    xmlToText,
    variableDefinition = null
}) => {
    if (!event || !BLOCK_EVENT_TYPES.has(event.type)) return null;
    if (!targetId) throw new Error('Studio cannot snapshot block event without a target ID');
    if (typeof event.toJson !== 'function') {
        throw new Error(`Studio cannot snapshot ${event.type}: toJson is missing`);
    }

    const snapshot = {
        schemaVersion: 1,
        recordedAtMs,
        targetId,
        targetRef: {
            runtimeId: targetId,
            name: targetName,
            isStage: targetIsStage
        },
        workspaceId: event.workspaceId || null,
        blockId: event.blockId || null,
        ...(event.commentId ? {commentId: event.commentId} : {}),
        type: event.type,
        group: event.group || null,
        recordUndo: event.recordUndo !== false,
        forwardJson: cloneJson(event.toJson()),
        details: captureDetails(event, xmlToText, variableDefinition)
    };
    return isSemanticallyNullCommentChange(snapshot) ? null : snapshot;
};

export {
    BLOCK_EVENT_TYPES,
    isSemanticallyNullCommentChange,
    snapshotBlockEvent
};
