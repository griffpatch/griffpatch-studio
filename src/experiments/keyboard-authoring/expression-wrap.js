import {blockXml} from './catalogue';
import {inEventGroup} from './operations';

const directChild = (element, tag, name) => Array.from(element.children || []).find(child =>
    child.tagName.toLowerCase() === tag && (!name || child.getAttribute('name') === name));

const expressionWrapPlan = (workspace, sourceBlockId, instance) => {
    const source = workspace.getBlockById(sourceBlockId);
    const form = instance && instance.typeInfo && instance.typeInfo.workspaceForm;
    if (!source || source.isShadow() || !source.outputConnection || !source.outputConnection.targetConnection ||
        !form || !form.outputConnection) return null;
    const incoming = source.outputConnection.targetConnection;
    if (!incoming.checkType_(form.outputConnection)) return null;
    const xml = blockXml(instance);
    const input = (form.inputList || []).find(candidate => {
        if (!candidate.connection || candidate.connection.type !== 1 ||
            !candidate.connection.checkType_(source.outputConnection)) return false;
        const value = directChild(xml, 'value', candidate.name);
        // A parsed reporter is authored content. Only an empty/default-shadow
        // slot may receive the selected native expression.
        return !value || !directChild(value, 'block');
    });
    return input ? {source, incoming, inputName: input.name, xml} : null;
};

const canWrapExpression = (workspace, sourceBlockId, instance) =>
    Boolean(expressionWrapPlan(workspace, sourceBlockId, instance));

// Put a new reporter around an existing connected reporter without serialising,
// disposing or recreating the selected object. Blockly records the create and
// connection changes in one native event group, so its normal Undo/Redo remains
// authoritative.
const wrapExpression = ({ScratchBlocks, workspace, sourceBlockId, instance, onGroup = null}) => {
    const plan = expressionWrapPlan(workspace, sourceBlockId, instance);
    if (!plan) throw new Error('This reporter cannot wrap the selected expression.');
    const {source, incoming, inputName, xml} = plan;
    let wrapper;
    inEventGroup(ScratchBlocks, () => {
        wrapper = ScratchBlocks.Xml.domToBlock(xml, workspace);
        const input = wrapper.getInput(inputName);
        const defaultChild = input && input.connection && input.connection.targetBlock();
        if (!wrapper.outputConnection || !input || !input.connection || input.connection.type !== 1 ||
            (defaultChild && !defaultChild.isShadow()) ||
            !incoming.checkType_(wrapper.outputConnection) ||
            !input.connection.checkType_(source.outputConnection)) {
            wrapper.dispose(false);
            throw new Error('The chosen reporter no longer has a compatible default input.');
        }
        source.outputConnection.disconnect();
        if (defaultChild) defaultChild.dispose(false);
        input.connection.connect(source.outputConnection);
        incoming.connect(wrapper.outputConnection);
    }, onGroup);
    return {block: wrapper, sourceBlockId: source.id, inputName};
};

const restoreWrappedExpression = ({wrapper, sourceBlockId, inputName, incoming}) => {
    const input = wrapper && wrapper.getInput(inputName);
    const source = input && input.connection.targetBlock();
    if (!source || source.id !== sourceBlockId || !source.outputConnection ||
        wrapper.outputConnection.targetConnection !== incoming) {
        throw new Error('The wrapped preview no longer owns its selected expression.');
    }
    wrapper.outputConnection.disconnect();
    input.connection.disconnect();
    wrapper.dispose(false);
    incoming.connect(source.outputConnection);
};

export {canWrapExpression, expressionWrapPlan, restoreWrappedExpression, wrapExpression};
