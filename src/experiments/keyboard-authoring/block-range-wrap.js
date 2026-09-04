import {blockXml} from './catalogue';
import {blocksInRange} from './block-range';
import {inEventGroup} from './operations';

const statementInputNames = instance => ((instance && instance.typeInfo &&
    instance.typeInfo.workspaceForm.inputList) || [])
    .filter(input => input.connection && input.connection.type === 3)
    .map(input => input.name);

const directChild = (element, tag, name) => Array.from(element.children || []).find(child =>
    child.tagName.toLowerCase() === tag && (!name || child.getAttribute('name') === name));

const emptyStatementInput = (instance, xml) => statementInputNames(instance).find(name => {
    const statement = directChild(xml, 'statement', name);
    return !statement || !directChild(statement, 'block');
});

const wrapPlan = (workspace, range, instance) => {
    const blocks = blocksInRange(workspace, range);
    if (!blocks.length || !instance || !instance.typeInfo || !instance.typeInfo.shape) return null;
    const first = blocks[0];
    const last = blocks[blocks.length - 1];
    if (!first.previousConnection) return null;
    const xml = blockXml(instance);
    const inputName = emptyStatementInput(instance, xml);
    if (!inputName || !instance.typeInfo.shape.canStackUp || instance.typeInfo.shape.canBeRound) return null;
    const outgoing = last.nextConnection && last.nextConnection.targetConnection;
    if (outgoing && !instance.typeInfo.shape.canStackDown) return null;
    return {blocks, first, last, outgoing, inputName, xml};
};

const canWrapStatementRange = (workspace, range, instance) => Boolean(wrapPlan(workspace, range, instance));

const moveRootTo = (block, xy) => {
    const current = block.getRelativeToSurfaceXY();
    const dx = xy.x - current.x;
    const dy = xy.y - current.y;
    if (dx || dy) block.moveBy(dx, dy);
};

// Enclose an exact sibling range without serialising or replacing any selected
// block. The receiving connection, selected objects and continuation are all
// retained; native Blockly events describe the one structural edit.
const wrapStatementRange = ({ScratchBlocks, workspace, range, instance, onGroup = null}) => {
    const plan = wrapPlan(workspace, range, instance);
    if (!plan) throw new Error('This C block cannot wrap the selected commands.');
    const {blocks, first, last, outgoing, inputName, xml} = plan;
    const incoming = first.previousConnection.targetConnection;
    const rootXY = first.getRelativeToSurfaceXY();
    let wrapper;
    inEventGroup(ScratchBlocks, () => {
        // Create and validate the native shape before disturbing the live
        // chain. A malformed catalogue entry therefore leaves it untouched.
        wrapper = ScratchBlocks.Xml.domToBlock(xml, workspace);
        const mouth = wrapper.getInput(inputName);
        if (!wrapper.previousConnection || !mouth || !mouth.connection || mouth.connection.type !== 3 ||
            mouth.connection.targetBlock() || (outgoing && !wrapper.nextConnection)) {
            wrapper.dispose(false);
            throw new Error('The chosen C block no longer has an empty statement mouth.');
        }
        if (outgoing) last.nextConnection.disconnect();
        if (incoming) first.previousConnection.disconnect();
        mouth.connection.connect(first.previousConnection);
        if (outgoing) wrapper.nextConnection.connect(outgoing);
        if (incoming) incoming.connect(wrapper.previousConnection);
        else moveRootTo(wrapper, rootXY);
    }, onGroup);
    return {block: wrapper, blockIds: blocks.map(block => block.id), inputName};
};

// Restore the retained objects in an isolated preview so another C candidate
// can reuse the same copied receiver. This is the exact inverse connection
// transform; it deliberately does not serialise the range.
const restoreWrappedStatementRange = ({workspace, wrapper, range, inputName}) => {
    const blocks = blocksInRange(workspace, range);
    const mouth = wrapper && wrapper.getInput(inputName);
    const first = blocks[0];
    const last = blocks[blocks.length - 1];
    if (!blocks.length || !mouth || mouth.connection.targetBlock() !== first ||
        first.previousConnection.targetConnection !== mouth.connection) {
        throw new Error('The wrapped preview no longer owns its selected commands.');
    }
    const rootXY = wrapper.getRelativeToSurfaceXY();
    const incoming = wrapper.previousConnection.targetConnection;
    const outgoing = wrapper.nextConnection && wrapper.nextConnection.targetConnection;
    if (outgoing) wrapper.nextConnection.disconnect();
    mouth.connection.disconnect();
    if (incoming) wrapper.previousConnection.disconnect();
    wrapper.dispose(false);
    if (outgoing) last.nextConnection.connect(outgoing);
    if (incoming) incoming.connect(first.previousConnection);
    else moveRootTo(first, rootXY);
};

export {canWrapStatementRange, restoreWrappedStatementRange, statementInputNames, wrapPlan, wrapStatementRange};
