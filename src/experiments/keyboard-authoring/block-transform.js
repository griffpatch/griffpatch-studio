import {blockXml} from './catalogue';
import {inEventGroup} from './operations';

const connectionInputs = block => ((block && block.inputList) || []).filter(input =>
    input.connection && [1, 3].includes(input.connection.type));

const connectionCheckKey = connection => (Array.isArray(connection && connection.check_) ?
    [...connection.check_].sort().join('|') : '*');

const connectionShapeKey = connection => (connection && typeof connection.getOutputShape === 'function' ?
    connection.getOutputShape() : connectionCheckKey(connection));

const overlapCount = (left, right) => {
    const remaining = [...right];
    return left.reduce((count, value) => {
        const index = remaining.indexOf(value);
        if (index < 0) return count;
        remaining.splice(index, 1);
        return count + 1;
    }, 0);
};

// Rank ambiguous transformations by the native shape of the selected block,
// including empty inputs. This is deliberately only an ordering signal: the
// lossless plan below remains the authority on whether a candidate may be
// accepted at all.
const transformationInputAffinity = (source, form) => {
    const describe = input => ({
        name: input.name,
        kind: input.connection.type,
        signature: [input.connection.type, connectionShapeKey(input.connection),
            connectionCheckKey(input.connection)].join(':')
    });
    const sourceInputs = connectionInputs(source).map(describe);
    const targetInputs = connectionInputs(form).map(describe);
    const exact = sourceInputs.filter(sourceInput => targetInputs.some(targetInput =>
        targetInput.name === sourceInput.name && targetInput.signature === sourceInput.signature)).length;
    const signatures = overlapCount(sourceInputs.map(input => input.signature),
        targetInputs.map(input => input.signature));
    const kinds = overlapCount(sourceInputs.map(input => input.kind), targetInputs.map(input => input.kind));
    return (exact * 100) + (signatures * 10) + kinds;
};

const directChild = (element, tag, name) => Array.from((element && element.children) || []).find(child =>
    child.tagName.toLowerCase() === tag && (!name || child.getAttribute('name') === name));

const targetInputIsAuthored = (xml, input) => {
    const tag = input.connection.type === 3 ? 'statement' : 'value';
    const slot = directChild(xml, tag, input.name);
    return Boolean(slot && directChild(slot, 'block'));
};

const childConnection = (child, type) => (type === 3 ? child.previousConnection : child.outputConnection);

const authoredInputMappings = (source, form, xml) => {
    const targets = connectionInputs(form).map((input, index) => ({input, index}));
    const sources = connectionInputs(source).map((input, index) => ({input, index}))
        .filter(({input}) => {
            const child = input.connection.targetBlock();
            return child && !child.isShadow();
        })
        .map(({input, index}) => {
            const child = input.connection.targetBlock();
            const connection = childConnection(child, input.connection.type);
            if (!connection) return null;
            const candidates = targets.filter(target =>
                target.input.connection.type === input.connection.type &&
                // Statement mouths carry control-flow meaning. SUBSTACK2 is
                // not an interchangeable spare SUBSTACK, even though their
                // connection checks match. Reporter/value slots may use
                // different native names across otherwise related families.
                (input.connection.type !== 3 || target.input.name === input.name) &&
                !targetInputIsAuthored(xml, target.input) &&
                target.input.connection.checkType_(connection))
                .sort((a, b) => Number(b.input.name === input.name) - Number(a.input.name === input.name) ||
                    Math.abs(a.index - index) - Math.abs(b.index - index));
            return {input, index, child, connection, candidates};
        });
    if (sources.some(sourceInput => !sourceInput || !sourceInput.candidates.length)) return null;

    // Input families are small, but a greedy first fit can still reject a
    // valid transform when one child has several compatible destinations and
    // another has only one. This augmenting match keeps exact names first while
    // allowing an earlier child to move aside for the only complete mapping.
    const targetOwners = new Map();
    const assign = (sourceInput, visited) => {
        for (const target of sourceInput.candidates) {
            if (visited.has(target.index)) continue;
            visited.add(target.index);
            const owner = targetOwners.get(target.index);
            if (!owner || assign(owner, visited)) {
                targetOwners.set(target.index, sourceInput);
                return true;
            }
        }
        return false;
    };
    for (const sourceInput of [...sources].sort((a, b) =>
        a.candidates.length - b.candidates.length || a.index - b.index)) {
        if (!assign(sourceInput, new Set())) return null;
    }
    return Array.from(targetOwners, ([targetIndex, sourceInput]) => ({
        sourceInputName: sourceInput.input.name,
        targetInputName: targets[targetIndex].input.name,
        sourceIndex: sourceInput.index,
        targetIndex,
        childId: sourceInput.child.id
    })).sort((a, b) => a.sourceIndex - b.sourceIndex);
};

const externalPlan = (source, form) => {
    if (source.outputConnection || form.outputConnection) {
        if (!source.outputConnection || !form.outputConnection) return null;
        const incoming = source.outputConnection.targetConnection;
        if (incoming && !incoming.checkType_(form.outputConnection)) return null;
        return {kind: 'reporter', incoming, outgoing: null};
    }
    const incoming = source.previousConnection && source.previousConnection.targetConnection;
    const outgoing = source.nextConnection && source.nextConnection.targetConnection;
    if (incoming && (!form.previousConnection || !incoming.checkType_(form.previousConnection))) return null;
    if (outgoing && (!form.nextConnection || !form.nextConnection.checkType_(outgoing))) return null;
    return {kind: 'statement', incoming, outgoing};
};

// A transformation may discard native default shadows, but never an authored
// reporter or statement body. Exact native input names lead; compatible inputs
// of the same connection kind are the fallback for related block families.
const blockTransformationPlan = (workspace, sourceBlockId, instance, {allowReadOnly = false} = {}) => {
    const source = workspace.getBlockById(sourceBlockId);
    const form = instance && instance.typeInfo && instance.typeInfo.workspaceForm;
    if (!source || source.isShadow() || (!allowReadOnly && !source.isDeletable()) || !form) return null;
    const external = externalPlan(source, form);
    if (!external) return null;
    const xml = blockXml(instance);
    const mappings = authoredInputMappings(source, form, xml);
    if (!mappings) return null;
    return {source, form, xml, mappings, inputAffinity: transformationInputAffinity(source, form), ...external};
};

const canTransformBlock = (workspace, sourceBlockId, instance) =>
    Boolean(blockTransformationPlan(workspace, sourceBlockId, instance));

const moveNewRootTo = (block, xy) => block.moveBy(xy.x, xy.y);

const ownDisabled = block => (typeof block.disabled === 'boolean' ? block.disabled : null);

// Replace one native shell while retaining every compatible authored child and
// surrounding connection. Validation completes before the first disconnect;
// until the old shell is finally disposed, every move can still be rolled back.
const transformBlock = ({ScratchBlocks, workspace, sourceBlockId, instance, onGroup = null,
    allowReadOnly = false}) => {
    const plan = blockTransformationPlan(workspace, sourceBlockId, instance, {allowReadOnly});
    if (!plan) throw new Error('This transformation would lose or disconnect existing block content.');
    const {source, xml, mappings, kind} = plan;
    const coordinate = source.getRelativeToSurfaceXY();
    const comment = typeof source.getCommentText === 'function' ? source.getCommentText() : null;
    const disabled = ownDisabled(source);
    const collapsed = typeof source.isCollapsed === 'function' && source.isCollapsed();
    let replacement;
    return inEventGroup(ScratchBlocks, () => {
        replacement = ScratchBlocks.Xml.domToBlock(xml, workspace);
        const current = blockTransformationPlan(workspace, sourceBlockId, instance, {allowReadOnly});
        if (!current || current.mappings.length !== mappings.length) {
            replacement.dispose(false);
            throw new Error('The selected block changed before the transformation could be applied.');
        }
        const moves = current.mappings.map(mapping => {
            const sourceInput = source.getInput(mapping.sourceInputName);
            const targetInput = replacement.getInput(mapping.targetInputName);
            const child = sourceInput && sourceInput.connection.targetBlock();
            const targetChild = targetInput && targetInput.connection.targetBlock();
            if (!sourceInput || !targetInput || !child || child.id !== mapping.childId || child.isShadow() ||
                (targetChild && !targetChild.isShadow()) ||
                !targetInput.connection.checkType_(childConnection(child, sourceInput.connection.type))) {
                replacement.dispose(false);
                throw new Error('The selected block inputs changed before the transformation could be applied.');
            }
            return {sourceInput, targetInput, child, targetChild};
        });
        const incoming = kind === 'reporter' ? source.outputConnection.targetConnection :
            source.previousConnection && source.previousConnection.targetConnection;
        const outgoing = kind === 'statement' && source.nextConnection && source.nextConnection.targetConnection;
        const moved = [];
        let incomingMoved = false;
        let outgoingMoved = false;
        try {
            for (const move of moves) {
                move.sourceInput.connection.disconnect();
                if (move.targetChild) move.targetChild.dispose(false);
                move.targetInput.connection.connect(childConnection(move.child, move.sourceInput.connection.type));
                moved.push(move);
            }
            if (kind === 'reporter') {
                if (incoming) {
                    source.outputConnection.disconnect();
                    incoming.connect(replacement.outputConnection);
                    incomingMoved = true;
                } else {
                    moveNewRootTo(replacement, coordinate);
                }
            } else {
                if (outgoing) {
                    source.nextConnection.disconnect();
                    replacement.nextConnection.connect(outgoing);
                    outgoingMoved = true;
                }
                if (incoming) {
                    source.previousConnection.disconnect();
                    incoming.connect(replacement.previousConnection);
                    incomingMoved = true;
                } else {
                    moveNewRootTo(replacement, coordinate);
                }
            }
        } catch (error) {
            if (incomingMoved) {
                if (kind === 'reporter') replacement.outputConnection.disconnect();
                else replacement.previousConnection.disconnect();
                incoming.connect(kind === 'reporter' ? source.outputConnection : source.previousConnection);
            }
            if (outgoingMoved) {
                replacement.nextConnection.disconnect();
                source.nextConnection.connect(outgoing);
            }
            for (const move of moved.reverse()) {
                move.targetInput.connection.disconnect();
                move.sourceInput.connection.connect(childConnection(move.child, move.sourceInput.connection.type));
            }
            replacement.dispose(false);
            throw error;
        }
        if (comment && typeof replacement.setCommentText === 'function') replacement.setCommentText(comment);
        if (disabled !== null && typeof replacement.setEnabled === 'function') replacement.setEnabled(!disabled);
        if (collapsed && typeof replacement.setCollapsed === 'function') replacement.setCollapsed(true);
        source.dispose(false);
        return {block: replacement, retainedBlockIds: moves.map(move => move.child.id)};
    }, onGroup);
};

const transformationChoice = ({workspace, sourceBlockId, result, text = null, completionText = null,
    focusInputName = null}) => {
    const plan = result && blockTransformationPlan(workspace, sourceBlockId, result.instance);
    return result && {
        ...result,
        kind: 'block-transform',
        text: text || `Change selected block to ${result.text.trim()}`,
        completionText: completionText || result.text,
        transformSourceId: sourceBlockId,
        retainedBlockCount: plan ? plan.mappings.length : 0,
        inputAffinity: plan ? plan.inputAffinity : 0,
        focusInputName,
        fits: Boolean(plan)
    };
};

const rankTransformationChoices = (choices, query = '') => {
    const normalizedQuery = query.trim().toLowerCase();
    const exact = choice => Boolean(normalizedQuery) && !choice.truncated &&
        choice.completionText.trim().toLowerCase() === normalizedQuery;
    return choices.map((choice, index) => ({choice, index}))
        .sort((a, b) => Number(b.choice.fits) - Number(a.choice.fits) ||
            b.choice.inputAffinity - a.choice.inputAffinity ||
            Number(exact(b.choice)) - Number(exact(a.choice)) || a.index - b.index)
        .map(({choice}) => choice);
};

export {blockTransformationPlan, canTransformBlock, rankTransformationChoices, transformBlock,
    transformationChoice, transformationInputAffinity};
