import {resolveConnection} from './navigation';
import {inEventGroup, placeBlock} from './operations';
import {blocksInRange} from './block-range';

// Blockly's native clipboard is process-global and intentionally survives a
// workspace/controller remount. Keep the source target and referenced Scratch
// identities on that same in-memory XML node. The private attribute survives
// a native clone but is removed before import; File > New clears both stores.
const enrichedClipboardSnapshots = new WeakMap();
const clipboardSnapshotAttribute = 'data-keyboard-authoring-snapshot';

const retainClipboardSnapshot = (ScratchBlocks, snapshot) => {
    const xml = ScratchBlocks.clipboardXml_ || snapshot.xml;
    const metadata = {
        targetId: snapshot.targetId,
        variables: snapshot.variables.map(variable => ({...variable}))
    };
    enrichedClipboardSnapshots.set(xml, metadata);
    xml.setAttribute(clipboardSnapshotAttribute, JSON.stringify(metadata));
};

const readClipboardSnapshot = ScratchBlocks => {
    const sourceXml = ScratchBlocks.clipboardXml_;
    if (!sourceXml) return null;
    let snapshot = enrichedClipboardSnapshots.get(sourceXml);
    if (!snapshot && sourceXml.hasAttribute(clipboardSnapshotAttribute)) {
        try {
            snapshot = JSON.parse(sourceXml.getAttribute(clipboardSnapshotAttribute));
            enrichedClipboardSnapshots.set(sourceXml, snapshot);
        } catch (error) { /* A foreign or obsolete native clipboard is not enriched. */ }
    }
    if (!snapshot) return null;
    const xml = sourceXml.cloneNode(true);
    if (xml.removeAttribute) xml.removeAttribute(clipboardSnapshotAttribute);
    return {
        targetId: snapshot.targetId,
        xml,
        variables: snapshot.variables.map(variable => ({...variable}))
    };
};

const clearClipboardSnapshot = ScratchBlocks => {
    const xml = ScratchBlocks.clipboardXml_;
    if (!xml) return;
    enrichedClipboardSnapshots.delete(xml);
    if (xml.removeAttribute) xml.removeAttribute(clipboardSnapshotAttribute);
};

const selectedBlockAt = (workspace, position) => position && position.kind === 'block' &&
    workspace.getBlockById(position.blockId);

const directChild = (element, tagName) => Array.from(element.children || []).find(child =>
    child.tagName.toLowerCase() === tagName);

// Scratch serialises a selected statement with its entire `next` continuation.
// A keyboard range owns only the chosen sibling slice, while every selected
// block retains its inputs and C-mouth descendants. Walking direct children is
// what prevents nested statement stacks from being clipped accidentally.
const clipStackXml = (sourceXml, blockCount) => {
    if (!sourceXml || blockCount < 1) throw new Error('The selected block range is empty.');
    const xml = sourceXml.cloneNode(true);
    let current = xml;
    for (let index = 1; index < blockCount; index++) {
        const next = directChild(current, 'next');
        current = next && directChild(next, 'block');
        if (!current) throw new Error('The selected block range no longer matches its native stack.');
    }
    const trailing = directChild(current, 'next');
    if (trailing) trailing.remove();
    return xml;
};

const modelId = model => model && (model.id || (model.getId && model.getId()));
const modelSnapshot = model => ({
    id: modelId(model),
    name: model.name,
    type: model.type || '',
    isLocal: Boolean(model.isLocal),
    isCloud: Boolean(model.isCloud)
});

// A target switch can leave the previous sprite's local model in Blockly until
// the next workspace refresh, even though the VM has already made the new
// target authoritative. Blockly de-duplicates variables by name and type, so
// createVariable would silently return that unowned model and no VarCreate
// event would reach the destination VM. Remove only an unreferenced identity
// that the authoritative target cannot resolve; successful paste replaces it
// with the destination identity, while failed paste restores it without
// changing VM state or native history.
const displaceUnownedWorkspaceVariable = (workspace, ScratchBlocks, target, definition) => {
    const conflict = workspace.getVariable(definition.name, definition.type);
    if (!conflict || target.lookupVariableById(modelId(conflict))) return null;
    if (workspace.getVariableUsesById(modelId(conflict)).length) {
        throw new Error(`The workspace still uses an identity named “${definition.name}”. ` +
            'Switch sprites and try again.');
    }
    const snapshot = modelSnapshot(conflict);
    ScratchBlocks.Events.disable();
    try {
        workspace.deleteVariableById(snapshot.id);
    } finally {
        ScratchBlocks.Events.enable();
    }
    return snapshot;
};

const restoreDisplacedWorkspaceVariable = (workspace, ScratchBlocks, snapshot) => {
    if (!snapshot) return;
    ScratchBlocks.Events.disable();
    try {
        workspace.createVariable(snapshot.name, snapshot.type, snapshot.id, snapshot.isLocal, snapshot.isCloud);
    } finally {
        ScratchBlocks.Events.enable();
    }
};

const withoutTrailingDigits = value => String(value).replace(/[0-9]+$/, '');
const unusedName = (name, existingNames) => {
    if (!existingNames.includes(name)) return name;
    const base = withoutTrailingDigits(name);
    let suffix = 2;
    while (existingNames.includes(`${base}${suffix}`)) suffix++;
    return `${base}${suffix}`;
};

// Capture only identities actually referenced by the copied subtree. A sprite
// target's own variable table contains locals; globals and broadcasts resolve
// through the Stage. This is the same distinction used by Scratch VM when a
// script is dragged between targets.
const collectVariableReferences = (xml, sourceTarget) => {
    if (!xml || !sourceTarget) return [];
    const seen = new Set();
    return [...xml.querySelectorAll('field[id]')].map(field => {
        const id = field.getAttribute('id');
        if (!id || seen.has(id)) return null;
        const variable = sourceTarget.lookupVariableById(id);
        if (!variable) return null;
        seen.add(id);
        return {
            id,
            name: variable.name,
            type: variable.type || '',
            isLocal: !sourceTarget.isStage && Object.prototype.hasOwnProperty.call(sourceTarget.variables, id),
            isCloud: Boolean(variable.isCloud)
        };
    }).filter(Boolean);
};

// Produce a destination mapping without mutating either Blockly or the VM.
// New identities are created later, inside the same native event group as the
// pasted block, so one destination Undo reverses the complete transaction.
const crossTargetVariablePlan = (variables, target, runtime) => variables.map(variable => {
    if (!variable.isLocal) {
        const existing = target.lookupVariableById(variable.id);
        if (!existing) throw new Error(`The shared Scratch identity “${variable.name}” is unavailable.`);
        return {oldId: variable.id, existing};
    }
    if (!target.isStage) {
        const existing = target.lookupVariableByNameAndType(variable.name, variable.type);
        return existing ? {oldId: variable.id,
            existing} : {oldId: variable.id,
            create: {
                id: null,
                name: variable.name,
                type: variable.type,
                isLocal: true,
                isCloud: false
            }};
    }
    const id = `StageVarFromLocal_${variable.id}`;
    const existing = target.lookupVariableById(id);
    if (existing) return {oldId: variable.id, existing};
    return {oldId: variable.id,
        create: {
            id,
            name: unusedName(`Stage: ${variable.name}`, runtime.getAllVarNamesOfType(variable.type)),
            type: variable.type,
            isLocal: false,
            isCloud: false
        }};
});

const crossTargetBlockElements = xml => [xml, ...xml.querySelectorAll('block,shadow')]
    .filter(element => ['block', 'shadow'].includes(String(element.tagName).toLowerCase()));

const rewriteCrossTargetXml = (sourceXml, plan, destinationIsStage) => {
    const xml = sourceXml.cloneNode(true);
    const blocks = crossTargetBlockElements(xml);
    if (blocks.some(element => {
        const type = element.getAttribute('type') || '';
        return type.startsWith('procedures_') || type.startsWith('argument_reporter_');
    })) {
        throw new Error('Copy custom blocks with their native editor; a fragment cannot safely change sprites.');
    }
    blocks.forEach(element => {
        const type = element.getAttribute('type');
        if (destinationIsStage && type === 'event_whenthisspriteclicked') {
            element.setAttribute('type', 'event_whenstageclicked');
        } else if (!destinationIsStage && type === 'event_whenstageclicked') {
            element.setAttribute('type', 'event_whenthisspriteclicked');
        }
    });
    const mappings = new Map(plan.map(item => [item.oldId, item.existing || item.create]));
    [...xml.querySelectorAll('field[id]')].forEach(field => {
        const variable = mappings.get(field.getAttribute('id'));
        const id = modelId(variable);
        if (!variable || !id) return;
        field.setAttribute('id', id);
        field.textContent = variable.name;
    });
    return xml;
};

// Validate the native block's real connections after deserialisation but before
// its create event enters Scratch history. An occupied expression is protected;
// statement insertion may retain a continuation only when the pasted stack has
// a native lower connection.
const fitsBlock = (workspace, position, block) => {
    if (!position || !block) return false;
    if (position.kind === 'workspace') return true;
    const anchor = position.blockId && workspace.getBlockById(position.blockId);
    if (!anchor) return false;
    const receiving = resolveConnection(workspace, position);
    if (position.kind === 'before' && !receiving) {
        return Boolean(anchor.previousConnection && block.nextConnection && !block.outputConnection);
    }
    if (!receiving) return false;
    const child = receiving.targetBlock();
    if (receiving.type === 1) {
        return Boolean(block.outputConnection && (!child || child.isShadow()) &&
            receiving.checkType_(block.outputConnection));
    }
    return Boolean(block.previousConnection && (!child || block.nextConnection));
};

const createBlockClipboard = ({workspace, ScratchBlocks, vm, onGroup}) => {
    const selectedBlocks = (position, range) => {
        if (range) return blocksInRange(workspace, range);
        return [selectedBlockAt(workspace, position)].filter(Boolean);
    };
    const copy = (position, targetId, range = null) => {
        const blocks = selectedBlocks(position, range);
        const block = blocks[0];
        if (!block || blocks.some(item => item.isShadow() || !item.isMovable() || !item.isDeletable())) return null;
        // Scratch's own serializer owns comments, mutations, fields, shadow DOM
        // and the connected subtree. Retain its global clipboard too so leaving
        // the experiment does not make Copy behave differently.
        ScratchBlocks.copy_(block);
        const xml = range ? clipStackXml(ScratchBlocks.clipboardXml_, blocks.length) :
            ScratchBlocks.clipboardXml_.cloneNode(true);
        ScratchBlocks.clipboardXml_ = xml.cloneNode(true);
        ScratchBlocks.clipboardSource_ = workspace;
        const sourceTarget = vm && vm.runtime.getTargetById(targetId);
        retainClipboardSnapshot(ScratchBlocks, {
            targetId,
            xml,
            variables: collectVariableReferences(xml, sourceTarget)
        });
        return block;
    };
    const source = expectedTargetId => {
        const snapshot = readClipboardSnapshot(ScratchBlocks);
        if (snapshot) return snapshot;
        if (ScratchBlocks.clipboardXml_ && ScratchBlocks.clipboardSource_ === workspace) {
            return {targetId: expectedTargetId,
                xml: ScratchBlocks.clipboardXml_.cloneNode(true),
                variables: []};
        }
        throw new Error('Copy a whole block before pasting.');
    };
    const probeCrossTargetFit = (position, copied, destinationIsStage) => {
        ScratchBlocks.Events.disable();
        let probe;
        try {
            probe = new ScratchBlocks.Workspace();
            const plan = copied.variables.map(variable => {
                const model = probe.createVariable(variable.name, variable.type, variable.id,
                    variable.isLocal, variable.isCloud);
                return {oldId: variable.id, existing: model};
            });
            const block = ScratchBlocks.Xml.domToBlock(
                rewriteCrossTargetXml(copied.xml, plan, destinationIsStage), probe);
            return fitsBlock(workspace, position, block);
        } finally {
            if (probe) probe.dispose();
            ScratchBlocks.Events.enable();
        }
    };
    const create = (position, copied, expectedTargetId) => inEventGroup(ScratchBlocks, () => {
        const crossTarget = copied.targetId !== expectedTargetId;
        const target = crossTarget && vm && vm.runtime.getTargetById(expectedTargetId);
        if (crossTarget && (!target || !probeCrossTargetFit(position, copied, target.isStage))) {
            throw new Error('The copied block does not fit at this caret on the other target.');
        }
        const plan = crossTarget ? crossTargetVariablePlan(copied.variables, target, vm.runtime) : [];
        const createdVariables = [];
        const displacedVariables = [];
        let block;
        let importError = null;
        try {
            plan.forEach(item => {
                if (!item.create) return;
                const displaced = displaceUnownedWorkspaceVariable(workspace, ScratchBlocks, target, item.create);
                if (displaced) displacedVariables.push(displaced);
                item.existing = workspace.createVariable(item.create.name, item.create.type, item.create.id,
                    item.create.isLocal, item.create.isCloud);
                createdVariables.push(item.existing);
            });
            const xml = crossTarget ? rewriteCrossTargetXml(copied.xml, plan, target.isStage) : copied.xml;
            ScratchBlocks.Events.disable();
            try {
                ScratchBlocks.scratchBlocksUtils.changeCopiedBlockIds(xml);
                block = ScratchBlocks.Xml.domToBlock(xml, workspace);
                ScratchBlocks.scratchBlocksUtils.changeObscuredShadowIds(block);
                if (!fitsBlock(workspace, position, block)) {
                    throw new Error('The copied block does not fit at this caret. Delete an occupied value first.');
                }
            } finally {
                ScratchBlocks.Events.enable();
            }
        } catch (error) {
            if (block) block.dispose(false);
            importError = error;
        }
        if (importError) {
            createdVariables.reverse().forEach(variable => workspace.deleteVariableById(modelId(variable)));
            displacedVariables.reverse().forEach(variable =>
                restoreDisplacedWorkspaceVariable(workspace, ScratchBlocks, variable));
            throw importError;
        }
        // Match Scratch's native paste contract: one subtree create event,
        // followed by native connection/move events in the same undo group.
        if (!block.isShadow()) ScratchBlocks.Events.fire(new ScratchBlocks.Events.BlockCreate(block));
        placeBlock(workspace, position, block);
        block.select();
        return block;
    }, onGroup);
    const paste = (position, expectedTargetId) => create(position, source(expectedTargetId), expectedTargetId);
    const insertXml = (position, xml, expectedTargetId) => create(position, {
        targetId: expectedTargetId,
        xml: xml.cloneNode(true),
        variables: collectVariableReferences(xml, vm && vm.runtime.getTargetById(expectedTargetId))
    }, expectedTargetId);
    const disposeSelection = (blocks, range) => inEventGroup(ScratchBlocks, () => {
        const first = blocks[0];
        if (!range) {
            // A lone block deliberately owns its continuation, matching
            // Scratch's native clipboard and the established Lab contract.
            first.dispose(false);
            return;
        }
        const last = blocks[blocks.length - 1];
        const incoming = first.previousConnection && first.previousConnection.targetConnection;
        const tail = last.getNextBlock();
        if (tail) last.nextConnection.disconnect();
        if (incoming) first.previousConnection.disconnect();
        if (incoming && tail) incoming.connect(tail.previousConnection);
        first.dispose(false);
    }, onGroup);
    const cut = (position, expectedTargetId, range = null) => {
        const blocks = selectedBlocks(position, range);
        const block = copy(position, expectedTargetId, range);
        if (!block) return false;
        disposeSelection(blocks, range);
        return true;
    };
    const removeRange = range => {
        const blocks = selectedBlocks(null, range);
        if (!blocks.length || blocks.some(item => item.isShadow() || !item.isDeletable())) return false;
        disposeSelection(blocks, range);
        return true;
    };
    const duplicate = (position, expectedTargetId, range = null) => {
        const block = selectedBlocks(position, range)[0];
        if (!block || !copy(position, expectedTargetId, range)) return null;
        const xy = block.getRelativeToSurfaceXY();
        const snapshot = readClipboardSnapshot(ScratchBlocks);
        return create({kind: 'workspace',
            x: xy.x + ScratchBlocks.SNAP_RADIUS,
            y: xy.y + (ScratchBlocks.SNAP_RADIUS * 2)}, {
            ...snapshot,
            xml: snapshot.xml.cloneNode(true)
        }, expectedTargetId);
    };
    return {copy,
        cut,
        paste,
        insertXml,
        removeRange,
        duplicate,
        hasData: () => Boolean(readClipboardSnapshot(ScratchBlocks) || (ScratchBlocks.clipboardXml_ &&
            ScratchBlocks.clipboardSource_ === workspace)),
        clear: () => {
            clearClipboardSnapshot(ScratchBlocks);
            // Blockly keeps its native clipboard in process-global slots.
            // Clearing only our richer snapshot would let a block from the
            // previous project leak through source(); the main workspace may
            // also be recreated before Runtime announces PROJECT_LOADED.
            ScratchBlocks.clipboardXml_ = null;
            ScratchBlocks.clipboardSource_ = null;
        }};
};

export {clearClipboardSnapshot, clipStackXml, collectVariableReferences, createBlockClipboard, crossTargetVariablePlan,
    displaceUnownedWorkspaceVariable, fitsBlock, readClipboardSnapshot, restoreDisplacedWorkspaceVariable,
    retainClipboardSnapshot, rewriteCrossTargetXml};
