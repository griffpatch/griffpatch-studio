import {analyzeTransactionEffects} from '../../replay/transaction-effects';

const unsupported = reason => ({kind: 'semantic-only', reason});

/**
 * Compile the deliberately small first-gate native plan. Transactions outside
 * one existing-block move are rejected before the editor is touched.
 *
 * @param {object} transaction Studio transaction
 * @param {'forward'|'backward'} direction playback direction
 * @returns {object} native drag plan or semantic-only decision
 */
const PRESENTATION_MODES = {
    history: {
        generated: true,
        grabOffset: {x: 24, y: 18},
        frameCount: 7,
        markerHoldFrames: 1,
        pointerTravel: false
    },
    realistic: {
        generated: true,
        grabOffset: {x: 24, y: 18},
        frameCount: 24,
        markerHoldFrames: 12,
        pointerTravel: true
    }
};
const WORKSPACE_COMMENT_DEFAULT_SIZE = 200;

// Keep the visible pointer close to a statement block's connection notch. The
// drag endpoint already maps the exact Blockly connection; a deep pickup makes
// that correct drop look conspicuously too far to the right.
const FLYOUT_GRAB_OFFSET = {x: 16, y: 18};

const singleCreatedRoot = event => {
    const xml = event && event.details && event.details.xml;
    return Boolean(xml) && (xml.match(/<block(?:\s|>)/gi) || []).length === 1;
};

const capturedValue = captured => (
    captured && captured.kind === 'undefined' ? void 0 : captured && captured.value
);

const exactKeys = (value, keys) => Boolean(value && typeof value === 'object' &&
    Object.keys(value)
        .sort()
        .join('\0') === keys.slice()
        .sort()
        .join('\0'));

const topLevelXmlCoordinate = xml => {
    if (typeof xml !== 'string') return null;
    const value = name => {
        const match = xml.match(new RegExp(`\\s${name}="([^"]+)"`));
        return match ? Number(match[1]) : NaN;
    };
    const x = value('x');
    const y = value('y');
    return Number.isFinite(x) && Number.isFinite(y) ? {x, y} : null;
};

const fieldChangePlan = (transaction, direction, presentationMode) => {
    const events = transaction.events || [];
    if (presentationMode !== 'realistic' || events.length !== 1) return null;
    const event = events[0];
    if (event.type !== 'change' || !event.details || event.details.element !== 'field' ||
        !event.details.name) return null;
    return {
        kind: 'block-field-edit',
        transactionId: transaction.id,
        targetId: transaction.targetId,
        blockId: event.blockId,
        blockType: event.blockType || null,
        blockRef: event.blockRef || null,
        fieldName: event.details.name,
        sourceValue: capturedValue(
            direction === 'forward' ? event.details.oldValue : event.details.newValue
        ),
        value: capturedValue(
            direction === 'forward' ? event.details.newValue : event.details.oldValue
        ),
        presentation: PRESENTATION_MODES.realistic
    };
};

const commentPlan = (transaction, direction, presentationMode) => {
    const events = transaction.events || [];
    if (presentationMode !== 'realistic' || direction !== 'forward' || events.length !== 1) return null;
    const event = events[0];
    if (!event.commentId || !event.details) return null;
    const commentOwner = event.blockId ? 'block' : 'workspace';
    const kind = action => `${commentOwner}-comment-${action}`;
    const base = {
        transactionId: transaction.id,
        targetId: transaction.targetId,
        commentOwner,
        commentId: event.commentId,
        presentation: PRESENTATION_MODES.realistic,
        ...(event.blockId ? {
            blockId: event.blockId,
            blockType: event.blockType || null,
            blockRef: event.blockRef || null
        } : {})
    };
    if (event.type === 'comment_create') {
        const state = event.details.state;
        // Scratch's block context menu creates one empty comment. Preserve
        // that exact native boundary and leave API-created/non-empty comments
        // to semantic replay rather than pretending the menu authored them.
        if (!state || state.text !== '') return null;
        if (commentOwner === 'workspace' && (!state.coordinate ||
            !Number.isFinite(state.coordinate.x) || !Number.isFinite(state.coordinate.y) ||
            state.width !== WORKSPACE_COMMENT_DEFAULT_SIZE ||
            state.height !== WORKSPACE_COMMENT_DEFAULT_SIZE || state.minimized)) return null;
        return {
            ...base,
            kind: kind('create'),
            text: '',
            ...(commentOwner === 'workspace' ? {
                coordinate: state.coordinate,
                size: {width: state.width, height: state.height},
                minimized: Boolean(state.minimized)
            } : {})
        };
    }
    if (event.type === 'comment_delete') {
        return {...base, kind: kind('delete')};
    }
    if (event.type === 'comment_move') {
        const source = event.details.oldCoordinate;
        const destination = event.details.newCoordinate;
        if (!source || !destination || !Number.isFinite(source.x) || !Number.isFinite(source.y) ||
            !Number.isFinite(destination.x) || !Number.isFinite(destination.y)) return null;
        return {
            ...base,
            kind: kind('move'),
            source,
            destination
        };
    }
    if (event.type !== 'comment_change') return null;
    const oldContents = event.details.oldContents;
    const newContents = event.details.newContents;
    if (exactKeys(oldContents, ['text']) && exactKeys(newContents, ['text']) &&
        typeof oldContents.text === 'string' && typeof newContents.text === 'string') {
        return {
            ...base,
            kind: kind('text'),
            sourceText: oldContents.text,
            text: newContents.text
        };
    }
    if (exactKeys(oldContents, ['minimized']) && exactKeys(newContents, ['minimized']) &&
        typeof oldContents.minimized === 'boolean' && typeof newContents.minimized === 'boolean' &&
        oldContents.minimized !== newContents.minimized) {
        return {
            ...base,
            kind: kind('minimize'),
            sourceMinimized: oldContents.minimized,
            minimized: newContents.minimized
        };
    }
    if (exactKeys(oldContents, ['width', 'height']) && exactKeys(newContents, ['width', 'height']) &&
        [oldContents.width, oldContents.height, newContents.width, newContents.height]
            .every(Number.isFinite)) {
        return {
            ...base,
            kind: kind('resize'),
            sourceSize: {width: oldContents.width, height: oldContents.height},
            size: {width: newContents.width, height: newContents.height}
        };
    }
    return null;
};

const variableCreatePlan = (transaction, direction, presentationMode) => {
    const events = transaction.events || [];
    if (presentationMode !== 'realistic' || direction !== 'forward' || events.length !== 1) return null;
    const event = events[0];
    if (event.type !== 'var_create' || !event.details || !event.details.varId ||
        typeof event.details.varName !== 'string' ||
        !['', 'list'].includes(event.details.varType || '')) return null;
    return {
        kind: 'variable-create-dialog',
        transactionId: transaction.id,
        targetId: transaction.targetId,
        targetRef: transaction.targetRef || event.targetRef || null,
        varId: event.details.varId,
        varName: event.details.varName,
        varType: event.details.varType || '',
        isLocal: Boolean(event.details.isLocal),
        isCloud: Boolean(event.details.isCloud),
        definition: event.details.definition || null,
        presentation: PRESENTATION_MODES.realistic
    };
};

const variableLifecyclePlan = (transaction, direction, presentationMode) => {
    const events = transaction.events || [];
    if (presentationMode !== 'realistic' || direction !== 'forward') return null;
    if (events.length === 1 && events[0].type === 'var_rename') {
        const event = events[0];
        const details = event.details || {};
        const definition = details.definition || null;
        const definitionBefore = definition && definition.before;
        const definitionAfter = definition && definition.after;
        const varType = (definitionBefore && definitionBefore.type) ||
            (definitionAfter && definitionAfter.type) || '';
        if (!details.varId || typeof details.oldName !== 'string' || typeof details.newName !== 'string' ||
            !['', 'list'].includes(varType)) return null;
        return {
            kind: 'variable-rename-dialog',
            transactionId: transaction.id,
            targetId: transaction.targetId,
            targetRef: transaction.targetRef || event.targetRef ||
                (definitionBefore && definitionBefore.targetRef) || null,
            varId: details.varId,
            varType,
            oldName: details.oldName,
            newName: details.newName,
            definition,
            presentation: PRESENTATION_MODES.realistic
        };
    }

    const deletedVariableEvents = events.filter(event => event.type === 'var_delete');
    if (deletedVariableEvents.length !== 1 || events.some(event => !['delete', 'var_delete'].includes(event.type))) {
        return null;
    }
    const event = deletedVariableEvents[0];
    const details = event.details || {};
    if (!details.varId || typeof details.varName !== 'string' ||
        !['', 'list'].includes(details.varType || '')) return null;
    const deleteEvents = events.filter(candidate => candidate.type === 'delete');
    return {
        kind: 'variable-delete-dropdown',
        transactionId: transaction.id,
        targetId: transaction.targetId,
        targetRef: transaction.targetRef || event.targetRef ||
            (details.definition && details.definition.before && details.definition.before.targetRef) || null,
        varId: details.varId,
        varName: details.varName,
        varType: details.varType || '',
        isLocal: Boolean(details.isLocal),
        isCloud: Boolean(details.isCloud),
        definition: details.definition || null,
        deletedBlocks: deleteEvents.map(deleted => ({
            blockId: deleted.blockId,
            blockType: deleted.blockType || null,
            blockRef: deleted.blockRef || null,
            blockIds: deleted.details && Array.isArray(deleted.details.ids) ? deleted.details.ids.slice() : []
        })),
        presentation: PRESENTATION_MODES.realistic
    };
};

const broadcastCreatePlan = (transaction, direction, presentationMode) => {
    const events = transaction.events || [];
    if (presentationMode !== 'realistic' || direction !== 'forward' || events.length !== 2) return null;
    const created = events.find(event => event.type === 'var_create' && event.details &&
        event.details.varType === 'broadcast_msg');
    const selection = created && events.find(event => event.type === 'change' && event.details &&
        event.details.element === 'field' && event.details.name === 'BROADCAST_OPTION' &&
        capturedValue(event.details.newValue) === created.details.varId);
    if (!created || !selection || !created.details.varId || typeof created.details.varName !== 'string') {
        return null;
    }
    return {
        kind: 'broadcast-create-dialog',
        transactionId: transaction.id,
        targetId: transaction.targetId,
        targetRef: transaction.targetRef || selection.targetRef || created.targetRef || null,
        blockId: selection.blockId,
        blockType: selection.blockType || null,
        blockRef: selection.blockRef || null,
        fieldName: selection.details.name,
        sourceValue: capturedValue(selection.details.oldValue),
        value: created.details.varId,
        varId: created.details.varId,
        varName: created.details.varName,
        varType: 'broadcast_msg',
        isLocal: false,
        isCloud: false,
        definition: created.details.definition || null,
        presentation: PRESENTATION_MODES.realistic
    };
};

const customProcedureCreatePlan = (transaction, direction, presentationMode) => {
    const events = transaction.events || [];
    if (presentationMode !== 'realistic' || direction !== 'forward' || events.length !== 2) return null;
    const create = events.find(event => event.type === 'create' && event.blockType === 'procedures_definition');
    const move = create && events.find(event => event.type === 'move' && event.blockId === create.blockId);
    const destination = move && move.details && move.details.newLocation;
    if (!create || !move || !create.details || typeof create.details.xml !== 'string' ||
        !Array.isArray(create.details.ids) || create.details.ids.length < 2 ||
        !destination || destination.parentId || !destination.coordinate) return null;
    return {
        kind: 'custom-procedure-dialog',
        transactionId: transaction.id,
        targetId: transaction.targetId,
        targetRef: transaction.targetRef || create.targetRef || null,
        blockId: create.blockId,
        blockIds: create.details.ids.slice(),
        blockType: create.blockType,
        xml: create.details.xml,
        destination: {
            parentId: null,
            inputName: null,
            coordinate: destination.coordinate
        },
        presentation: PRESENTATION_MODES.realistic
    };
};

const clipboardPastePlan = (transaction, direction, presentationMode) => {
    const events = transaction.events || [];
    if (presentationMode !== 'realistic' || direction !== 'forward') return null;
    const event = events.find(candidate => candidate.type === 'create' &&
        candidate.interactionSource?.kind === 'workspace-clipboard');
    const source = event && event.interactionSource;
    if (!event || !source ||
        !source.sourceBlockRef || !event.details || !Array.isArray(event.details.ids) ||
        !event.details.ids.length) return null;
    if (events.some(candidate => candidate !== event && candidate.type !== 'move')) {
        return unsupported('the clipboard transaction contains unsupported editing effects');
    }
    const destinationCoordinate = topLevelXmlCoordinate(event.details.xml);
    if (!destinationCoordinate) return null;
    const effects = events.length > 1 ? analyzeTransactionEffects(transaction, direction) : null;
    const primary = effects && effects.moves.find(move => move.blockId === event.blockId);
    if (effects && (!primary || !primary.destination || primary.destination.parentId ||
        !primary.destination.coordinate || effects.moves.some(move => move.blockId !== event.blockId))) {
        return unsupported('the clipboard placement requires a single top-level drag');
    }
    return {
        kind: 'clipboard-block-paste',
        transactionId: transaction.id,
        targetId: transaction.targetId,
        targetRef: transaction.targetRef || event.targetRef || null,
        sourceBlockRef: source.sourceBlockRef,
        sourceBlockType: source.sourceBlockType || null,
        blockIds: event.details.ids.slice(),
        copiedBlockCount: event.details.ids.length,
        destination: primary ? primary.destination :
            {parentId: null, inputName: null, coordinate: destinationCoordinate},
        pasteCoordinate: destinationCoordinate,
        ...(primary ? {placement: {
            kind: 'block-drag',
            transactionId: transaction.id,
            targetId: transaction.targetId,
            blockId: event.blockId,
            blockType: event.blockType,
            source: primary.source,
            destination: primary.destination,
            affectedBlocks: [primary],
            presentation: PRESENTATION_MODES.realistic
        }} : {}),
        presentation: PRESENTATION_MODES.realistic
    };
};

const projectLibraryPlan = (transaction, direction, presentationMode) => {
    if (transaction.kind !== 'project-operation' || direction !== 'forward' ||
        presentationMode !== 'realistic') return null;
    const operation = transaction.operation || {};
    if (operation.type === 'sprite-duplicate' && operation.sourceTargetRef && operation.targetRef) {
        return {
            kind: 'sprite-duplicate-click',
            transactionId: transaction.id,
            sourceTargetRef: operation.sourceTargetRef,
            createdTargetRef: operation.targetRef,
            presentation: PRESENTATION_MODES.realistic
        };
    }
    if (operation.type === 'sprite-rename' && operation.targetRef && operation.renamedTargetRef &&
        typeof operation.requestedName === 'string') {
        return {
            kind: 'sprite-rename-input',
            transactionId: transaction.id,
            targetRef: operation.targetRef,
            requestedName: operation.requestedName,
            renamedTargetRef: operation.renamedTargetRef,
            presentation: PRESENTATION_MODES.realistic
        };
    }
    if (operation.type === 'sprite-delete' && operation.targetRef) {
        return {
            kind: 'sprite-delete-click',
            transactionId: transaction.id,
            targetRef: operation.targetRef,
            presentation: PRESENTATION_MODES.realistic
        };
    }
    const paintConversion = (operation.type === 'costume-edit' || operation.type === 'backdrop-edit') &&
        operation.previousCostume && operation.editedCostume && operation.targetRef &&
        Number.isInteger(operation.costumeIndex) && !operation.paintGesture &&
        ((operation.previousCostume.dataFormat === 'svg' && operation.editFormat === 'bitmap' &&
            operation.editedCostume.dataFormat !== 'svg') ||
        (operation.previousCostume.dataFormat !== 'svg' && operation.editFormat === 'svg' &&
            operation.editedCostume.dataFormat === 'svg'));
    if (paintConversion) {
        const destination = operation.editFormat === 'bitmap' ? 'bitmap' : 'vector';
        const assetKind = operation.type === 'backdrop-edit' ? 'backdrop' : 'costume';
        return {
            kind: `${assetKind}-convert-to-${destination}`,
            transactionId: transaction.id,
            targetId: operation.targetId || transaction.targetId || null,
            targetRef: operation.targetRef,
            assetKind,
            costumeIndex: operation.costumeIndex,
            editFormat: operation.editFormat,
            editedCheckpointId: operation.afterCheckpointId,
            previousCostume: operation.previousCostume,
            editedCostume: operation.editedCostume,
            presentation: PRESENTATION_MODES.realistic
        };
    }
    if ((operation.type === 'costume-edit' || operation.type === 'backdrop-edit') &&
        (operation.editFormat === 'svg' || operation.editFormat === 'bitmap') &&
        operation.paintGesture && operation.paintGesture.tool === 'brush' &&
        operation.previousCostume && operation.editedCostume && operation.targetRef &&
        Number.isInteger(operation.costumeIndex)) {
        return {
            kind: operation.type === 'backdrop-edit' ? 'backdrop-brush-stroke' : 'costume-brush-stroke',
            transactionId: transaction.id,
            targetId: operation.targetId || transaction.targetId || null,
            targetRef: operation.targetRef,
            assetKind: operation.type === 'backdrop-edit' ? 'backdrop' : 'costume',
            costumeIndex: operation.costumeIndex,
            editFormat: operation.editFormat,
            editedCheckpointId: operation.afterCheckpointId,
            previousCostume: operation.previousCostume,
            editedCostume: operation.editedCostume,
            paintGesture: operation.paintGesture,
            presentation: PRESENTATION_MODES.realistic
        };
    }
    const costumeLifecycleType = /^(costume|backdrop)-(duplicate|rename|delete|reorder)$/.exec(
        operation.type || ''
    );
    if (costumeLifecycleType && operation.targetRef && Number.isInteger(operation.costumeIndex)) {
        const [, assetKind, action] = costumeLifecycleType;
        const sourceCostume = operation.sourceCostume || operation.oldCostume ||
            operation.deletedCostume || operation.movedCostume;
        if (sourceCostume && (
            (action === 'duplicate' && operation.addedCostume) ||
            (action === 'rename' && operation.renamedCostume && typeof operation.requestedName === 'string') ||
            action === 'delete' ||
            (action === 'reorder' && Number.isInteger(operation.newIndex))
        )) {
            return {
                kind: `${assetKind}-${action === 'reorder' ? 'reorder-drag' :
                    action === 'rename' ? 'rename-input' : `${action}-click`}`,
                transactionId: transaction.id,
                targetId: operation.targetId || transaction.targetId || null,
                targetRef: operation.targetRef,
                assetKind,
                costumeIndex: operation.costumeIndex,
                sourceCostume,
                ...(operation.addedCostume ? {addedCostume: operation.addedCostume} : {}),
                ...(typeof operation.requestedName === 'string' ? {requestedName: operation.requestedName} : {}),
                ...(operation.renamedCostume ? {renamedCostume: operation.renamedCostume} : {}),
                ...(Number.isInteger(operation.newIndex) ? {newIndex: operation.newIndex} : {}),
                presentation: PRESENTATION_MODES.realistic
            };
        }
    }
    if (operation.type === 'sprite-reorder' && operation.movedTargetRef &&
        Number.isInteger(operation.targetIndex) && Number.isInteger(operation.newIndex)) {
        return {
            kind: 'sprite-reorder-drag',
            transactionId: transaction.id,
            movedTargetRef: operation.movedTargetRef,
            targetIndex: operation.targetIndex,
            newIndex: operation.newIndex,
            presentation: PRESENTATION_MODES.realistic
        };
    }
    if (operation.type === 'block-share' && operation.sourceTargetRef && operation.targetRef &&
        operation.sourceRoot && operation.sourceRoot.blockRef && operation.sourceRoot.blockCount > 0) {
        return {
            kind: 'cross-sprite-script-drag',
            transactionId: transaction.id,
            sourceTargetRef: operation.sourceTargetRef,
            targetRef: operation.targetRef,
            sourceBlockRef: operation.sourceRoot.blockRef,
            copiedBlockCount: operation.sourceRoot.blockCount,
            presentation: PRESENTATION_MODES.realistic
        };
    }
    if (operation.type === 'block-import' && operation.importSource &&
        operation.importSource.kind === 'backpack' && operation.importSource.type === 'script' &&
        operation.targetRef && operation.sourceRoot && operation.sourceRoot.blockCount > 0 &&
        operation.destinationCoordinate) {
        return {
            kind: 'backpack-script-drag',
            transactionId: transaction.id,
            targetRef: operation.targetRef,
            backpackItem: operation.importSource,
            copiedRootOpcode: operation.sourceRoot.opcode,
            copiedBlockCount: operation.sourceRoot.blockCount,
            destination: {
                parentId: null,
                inputName: null,
                coordinate: operation.destinationCoordinate
            },
            presentation: PRESENTATION_MODES.realistic
        };
    }
    if (operation.type === 'sound-edit' && operation.soundEffect && operation.editedSound) {
        return {
            kind: 'sound-effect-click',
            transactionId: transaction.id,
            targetId: operation.targetId || transaction.targetId || null,
            targetRef: operation.targetRef || transaction.targetRef || null,
            soundIndex: operation.soundIndex,
            previousSound: operation.previousSound,
            editedSound: operation.editedSound,
            soundEffect: operation.soundEffect,
            presentation: PRESENTATION_MODES.realistic
        };
    }
    if (operation.type === 'sound-duplicate' && operation.sourceSound && operation.addedSound) {
        return {
            kind: 'sound-duplicate-click',
            transactionId: transaction.id,
            targetId: operation.targetId || transaction.targetId || null,
            targetRef: operation.targetRef || transaction.targetRef || null,
            soundIndex: operation.soundIndex,
            sourceSound: operation.sourceSound,
            addedSound: operation.addedSound,
            presentation: PRESENTATION_MODES.realistic
        };
    }
    if (operation.type === 'sound-rename' && operation.oldSound && operation.renamedSound &&
        typeof operation.requestedName === 'string') {
        return {
            kind: 'sound-rename-input',
            transactionId: transaction.id,
            targetId: operation.targetId || transaction.targetId || null,
            targetRef: operation.targetRef || transaction.targetRef || null,
            soundIndex: operation.soundIndex,
            oldSound: operation.oldSound,
            requestedName: operation.requestedName,
            renamedSound: operation.renamedSound,
            presentation: PRESENTATION_MODES.realistic
        };
    }
    if (operation.type === 'sound-delete' && operation.deletedSound) {
        return {
            kind: 'sound-delete-click',
            transactionId: transaction.id,
            targetId: operation.targetId || transaction.targetId || null,
            targetRef: operation.targetRef || transaction.targetRef || null,
            soundIndex: operation.soundIndex,
            deletedSound: operation.deletedSound,
            presentation: PRESENTATION_MODES.realistic
        };
    }
    if (operation.type === 'sound-reorder' && operation.movedSound &&
        Number.isInteger(operation.soundIndex) && Number.isInteger(operation.newIndex)) {
        return {
            kind: 'sound-reorder-drag',
            transactionId: transaction.id,
            targetId: operation.targetId || transaction.targetId || null,
            targetRef: operation.targetRef || transaction.targetRef || null,
            soundIndex: operation.soundIndex,
            newIndex: operation.newIndex,
            movedSound: operation.movedSound,
            presentation: PRESENTATION_MODES.realistic
        };
    }
    if (operation.type === 'sound-add' && operation.uploadFile && operation.addedSound) {
        return {
            kind: 'sound-file-upload',
            transactionId: transaction.id,
            targetId: operation.targetId || transaction.targetId || null,
            targetRef: operation.targetRef || transaction.targetRef || null,
            uploadFile: operation.uploadFile,
            addedSound: operation.addedSound,
            sourceCheckpointId: operation.afterCheckpointId,
            sourceAssetMd5: `${operation.addedSound.assetId}.${operation.addedSound.dataFormat}`,
            presentation: PRESENTATION_MODES.realistic
        };
    }
    if ((operation.type === 'costume-add' || operation.type === 'backdrop-add') &&
        operation.uploadFile && operation.addedCostume) {
        return {
            kind: operation.type === 'backdrop-add' ? 'backdrop-file-upload' : 'costume-file-upload',
            transactionId: transaction.id,
            targetId: operation.targetId || transaction.targetId || null,
            targetRef: operation.targetRef || transaction.targetRef || null,
            uploadFile: operation.uploadFile,
            addedCostume: operation.addedCostume,
            sourceCheckpointId: operation.afterCheckpointId,
            sourceAssetMd5: `${operation.addedCostume.assetId}.${operation.addedCostume.dataFormat}`,
            presentation: PRESENTATION_MODES.realistic
        };
    }
    if ((operation.type === 'costume-add' || operation.type === 'backdrop-add') &&
        operation.createdWith === 'paint' && operation.addedCostume) {
        return {
            kind: operation.type === 'backdrop-add' ? 'backdrop-paint-create' : 'costume-paint-create',
            transactionId: transaction.id,
            targetId: operation.targetId || transaction.targetId || null,
            targetRef: operation.targetRef || transaction.targetRef || null,
            addedCostume: operation.addedCostume,
            presentation: PRESENTATION_MODES.realistic
        };
    }
    const libraryItem = operation.libraryItem;
    if (!libraryItem || typeof libraryItem.name !== 'string' || typeof libraryItem.md5ext !== 'string') {
        return null;
    }
    if (operation.type === 'sprite-create') {
        return {
            kind: 'sprite-library-select',
            transactionId: transaction.id,
            libraryItem,
            targetId: operation.targetId || transaction.targetId || null,
            targetRef: operation.targetRef || transaction.targetRef || null,
            presentation: PRESENTATION_MODES.realistic
        };
    }
    if (operation.type === 'costume-library-add' && operation.addedCostume) {
        return {
            kind: 'costume-library-select',
            transactionId: transaction.id,
            libraryItem,
            targetId: operation.targetId || transaction.targetId || null,
            targetRef: operation.targetRef || transaction.targetRef || null,
            addedCostume: operation.addedCostume,
            presentation: PRESENTATION_MODES.realistic
        };
    }
    if (operation.type === 'backdrop-library-add' && operation.addedBackdrop) {
        return {
            kind: 'backdrop-library-select',
            transactionId: transaction.id,
            libraryItem,
            targetId: operation.targetId || transaction.targetId || null,
            targetRef: operation.targetRef || transaction.targetRef || null,
            addedCostume: operation.addedBackdrop,
            presentation: PRESENTATION_MODES.realistic
        };
    }
    if (operation.type === 'sound-add' && operation.addedSound) {
        return {
            kind: 'sound-library-select',
            transactionId: transaction.id,
            libraryItem,
            targetId: operation.targetId || transaction.targetId || null,
            targetRef: operation.targetRef || transaction.targetRef || null,
            addedSound: operation.addedSound,
            presentation: PRESENTATION_MODES.realistic
        };
    }
    return null;
};

const compileInteractionPlan = (transaction, direction, {presentationMode = 'realistic'} = {}) => {
    if (direction !== 'forward' && direction !== 'backward') {
        return unsupported(`unknown native interaction direction: ${direction}`);
    }
    // A keyboard expression is an atomic native XML edit including its supplied
    // values, not a palette gesture. A default flyout prototype can lose hidden
    // shadow defaults later. Use the shared native transaction presentation
    // until typed-composition playback exists; mouse/legacy plans are unchanged.
    if (presentationMode === 'realistic' && (transaction.events || []).some(event =>
        event.interactionSource && event.interactionSource.kind === 'keyboard-authoring')) {
        return unsupported('keyboard composition uses atomic native transaction presentation');
    }
    const projectPlan = projectLibraryPlan(transaction, direction, presentationMode);
    if (projectPlan) return projectPlan;
    if (transaction.kind === 'project-operation') {
        return unsupported('the project operation has no realistic library interaction');
    }
    const compiledCommentPlan = commentPlan(transaction, direction, presentationMode);
    if (compiledCommentPlan) return compiledCommentPlan;
    const broadcastPlan = broadcastCreatePlan(transaction, direction, presentationMode);
    if (broadcastPlan) return broadcastPlan;
    const procedurePlan = customProcedureCreatePlan(transaction, direction, presentationMode);
    if (procedurePlan) return procedurePlan;
    const variableLifecycle = variableLifecyclePlan(transaction, direction, presentationMode);
    if (variableLifecycle) return variableLifecycle;
    const variablePlan = variableCreatePlan(transaction, direction, presentationMode);
    if (variablePlan) return variablePlan;
    const fieldPlan = fieldChangePlan(transaction, direction, presentationMode);
    if (fieldPlan) return fieldPlan;
    const pastePlan = clipboardPastePlan(transaction, direction, presentationMode);
    if (pastePlan) return pastePlan;
    const effects = analyzeTransactionEffects(transaction, direction);
    if (effects.hasDataDeltas) {
        return unsupported('data deltas require semantic playback');
    }
    const entering = effects.lifecycles.filter(lifecycle => lifecycle.kind === 'enter' && !lifecycle.isShadow);
    if (presentationMode === 'realistic' && direction === 'forward' && entering.length === 1) {
        const lifecycle = entering[0];
        const primary = effects.moves.find(move => move.blockId === lifecycle.blockId);
        const unsupportedEvent = transaction.events.find(event => !['create', 'move', 'delete'].includes(event.type));
        const nonShadowDelete = transaction.events.find(event => event.type === 'delete' &&
            !/^\s*<shadow(?:\s|>)/i.test((event.details && event.details.oldXml) || ''));
        if (!primary || unsupportedEvent || nonShadowDelete) {
            return unsupported('the flyout gate accepts one create-and-drag transaction');
        }
        if (!primary.destination || (!primary.destination.parentId && !primary.destination.coordinate)) {
            return unsupported('the flyout drag has no durable destination');
        }
        const createEvent = transaction.events.find(event => event.type === 'create' &&
            event.blockId === lifecycle.blockId);
        if (!singleCreatedRoot(createEvent)) {
            return unsupported('the flyout gate requires one created command root');
        }
        const blockType = primary.blockType || (createEvent && createEvent.blockType);
        if (!blockType) return unsupported('the flyout block type was not recorded');
        const origin = transaction.events.find(event => event.gesture &&
            event.gesture.blockId === lifecycle.blockId && event.gesture.origin)?.gesture.origin;
        // Old journals lack clone-source provenance. Do not invent a palette
        // source for a definition argument which cannot exist there.
        if (!origin && /^argument_reporter_/.test(blockType)) {
            return unsupported('legacy argument copy has no recorded source');
        }
        return {
            kind: origin?.kind === 'workspace-copy' ? 'workspace-block-copy' : 'flyout-block-drag',
            ...(origin ? {origin} : {}),
            transactionId: transaction.id,
            targetId: transaction.targetId,
            blockId: lifecycle.blockId,
            blockIds: lifecycle.blockIds,
            blockType,
            // A flyout can legitimately contain several blocks with the same
            // opcode (one variable/list reporter per model, or one procedure
            // call per custom definition). Preserve the authored root XML so
            // the browser driver can resolve the semantic prototype rather
            // than guessing by type or visual order.
            prototypeXml: createEvent.details.xml,
            blockRef: primary.blockRef,
            source: primary.source,
            destination: primary.destination,
            topLevelPrepend: primary.topLevelPrepend,
            affectedBlocks: effects.survivingMoves.filter(move => move.changed).map(move => ({
                blockId: move.blockId,
                blockType: move.blockType,
                blockRef: move.blockRef,
                source: move.source,
                destination: move.destination,
                topLevelPrepend: move.topLevelPrepend,
                destinationCoordinateIsGesturePickup: move.destinationCoordinateIsGesturePickup
            })),
            presentation: {
                ...PRESENTATION_MODES.realistic,
                grabOffset: FLYOUT_GRAB_OFFSET
            }
        };
    }
    if (!effects.moveOnly) {
        return unsupported(presentationMode === 'history' ?
            'history lifecycle uses the fast semantic presentation' :
            'the native gate accepts existing moves or one flyout create-and-drag');
    }

    if (!effects.primaryMove) return unsupported('the move has no durable destination');
    if (effects.primaryAmbiguous) {
        return unsupported('the first native gate cannot distinguish the dragged block from induced moves');
    }
    if (direction === 'backward' && effects.motionMoves.length > 1) {
        return unsupported('the inverse requires more than one native drag');
    }
    const primary = effects.primaryMove;
    const splitsOwnDescendantStack = effects.motionMoves.some(move =>
        move.blockId !== primary.blockId &&
        move.source && move.source.parentId === primary.blockId &&
        move.destination && !move.destination.parentId
    );
    const splitsTopLevelRoot = Boolean(
        splitsOwnDescendantStack && primary.source && !primary.source.parentId && primary.source.coordinate
    );
    if (splitsOwnDescendantStack && !splitsTopLevelRoot) {
        // A nested command cannot leave its descendants behind through one
        // ordinary drag. A top-level root is the useful exception: Scratch
        // detaches that one command from its remainder before inserting it
        // back into the same script, and the native driver models that exact
        // pickup below.
        return unsupported('moving a root without its descendants requires semantic playback');
    }
    const destination = primary.destination;
    if (!destination || (!destination.parentId && !destination.coordinate)) {
        return unsupported('the move has no durable destination');
    }

    return {
        kind: 'existing-block-drag',
        transactionId: transaction.id,
        targetId: transaction.targetId,
        blockId: primary.blockId,
        blockType: primary.blockType,
        blockRef: primary.blockRef,
        source: primary.source,
        destination,
        splitSourceRoot: splitsTopLevelRoot,
        topLevelPrepend: primary.topLevelPrepend,
        destinationCoordinateIsGesturePickup: primary.destinationCoordinateIsGesturePickup,
        createdShadows: effects.lifecycles.filter(item => item.isShadow && item.kind === 'enter').map(item => {
            const move = effects.moves.find(candidate => candidate.blockId === item.blockId);
            return {blockId: item.blockId, destination: move && move.destination};
        }),
        affectedBlocks: effects.motionMoves.map(move => ({
            blockId: move.blockId,
            blockType: move.blockType,
            blockRef: move.blockRef,
            source: move.source,
            destination: move.destination,
            topLevelPrepend: move.topLevelPrepend,
            destinationCoordinateIsGesturePickup: move.destinationCoordinateIsGesturePickup
        })),
        presentation: PRESENTATION_MODES[presentationMode] || PRESENTATION_MODES.realistic
    };
};

export {PRESENTATION_MODES, compileInteractionPlan};
