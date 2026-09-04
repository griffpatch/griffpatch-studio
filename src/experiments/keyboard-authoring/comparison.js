import {blockXml} from './catalogue';
import {completionChoicesForConnection} from './completion';
import {accepts, inEventGroup, placeBlock} from './operations';
import {canCreateTypedVariable, canCreateVariable, variableReporterXml} from './variables';
import {listReporterXml} from './lists';

const TYPE_BY_OPERATOR = {
    '=': 'operator_equals',
    '>': 'operator_gt',
    '<': 'operator_lt'
};
const OPERATOR_BY_TYPE = Object.fromEntries(Object.entries(TYPE_BY_OPERATOR).map(([operator, type]) =>
    [type, operator]));

const comparisonInput = (instance, index) => {
    const descriptor = instance && instance.typeInfo && instance.typeInfo.inputs[index];
    return descriptor && instance.typeInfo.workspaceForm.inputList[descriptor.inputIdx];
};

const comparisonType = instance => instance && instance.typeInfo &&
    instance.typeInfo.workspaceForm && instance.typeInfo.workspaceForm.type;

const comparisonIdentity = choice => choice && choice.comparisonLeft;

const implicitComparisonChoices = ({workspace, position, comparison, matches, value, identityChoices, search}) => {
    const seed = (value || (matches[0] && matches[0].text) || '0').trim();
    const template = comparison(seed, '=');
    const connection = template && comparisonInput(template.instance, 0) &&
        comparisonInput(template.instance, 0).connection;
    if (!connection) return [];
    const identities = identityChoices(connection);
    const leftChoices = completionChoicesForConnection(connection, 'input', matches, value, identities, [], search);
    return leftChoices.flatMap(left => {
        const wrapper = comparison(left.text, '=') || template;
        if (!wrapper || comparisonType(wrapper.instance) !== TYPE_BY_OPERATOR['=']) return [];
        return [{
            ...wrapper,
            kind: 'comparison-left',
            text: left.text,
            completionText: left.completionText || left.text,
            truncated: left.truncated,
            comparisonLeft: left,
            fits: left.fits && accepts(workspace, position, wrapper.instance)
        }];
    });
};

const replaceInputXml = (xml, inputName, child) => {
    let value = Array.from(xml.children).find(node =>
        node.tagName.toLowerCase() === 'value' && node.getAttribute('name') === inputName);
    if (!value) {
        value = xml.ownerDocument.createElement('value');
        value.setAttribute('name', inputName);
        xml.appendChild(value);
    }
    while (value.firstChild) value.removeChild(value.firstChild);
    value.appendChild(child);
};

const identityDetails = (workspace, ScratchBlocks, vm, choice, expectedTargetId) => {
    if (!vm.editingTarget || vm.editingTarget.id !== expectedTargetId) {
        throw new Error('The comparison destination has changed. Choose the value again.');
    }
    const list = ['list', 'create-list'].includes(choice.kind);
    const creating = ['create-variable', 'create-list'].includes(choice.kind);
    const type = list ? ScratchBlocks.LIST_VARIABLE_TYPE : '';
    const name = list ? choice.listName : choice.text.trim();
    const existing = creating ? null : workspace.getVariableById(choice.variableId);
    const canCreate = list ? canCreateTypedVariable(workspace, vm, name, choice.scope, type) :
        canCreateVariable(workspace, vm, name, choice.scope);
    if (creating ? !canCreate : !existing || existing.type !== type) {
        throw new Error('The variable or list choices have changed. Choose the value again.');
    }
    const id = existing ? existing.getId() : ScratchBlocks.utils.genUid();
    return {list, creating, type, name, id, existing};
};

const implicitComparisonXml = (instance, identity) => {
    const xml = blockXml(instance);
    if (!identity) return xml;
    const input = comparisonInput(instance, 0);
    if (!input || !input.name) throw new Error('The comparison lost its first native input.');
    const model = identity.existing || {name: identity.name, getId: () => identity.id};
    replaceInputXml(xml, input.name, identity.list ? listReporterXml(model) : variableReporterXml(model));
    return xml;
};

const insertImplicitComparison = ({ScratchBlocks, workspace, vm, position, result, expectedTargetId, onGroup}) => {
    if (!result || result.kind !== 'comparison-left' || comparisonType(result.instance) !== TYPE_BY_OPERATOR['='] ||
        !accepts(workspace, position, result.instance)) {
        throw new Error('The default comparison no longer fits this Boolean input.');
    }
    const left = comparisonIdentity(result);
    const needsIdentity = left && ['variable', 'create-variable', 'list', 'create-list'].includes(left.kind);
    const identity = needsIdentity ? identityDetails(workspace, ScratchBlocks, vm, left, expectedTargetId) : null;
    const xml = implicitComparisonXml(result.instance, identity);
    let block;
    let createdIdentity = null;
    return inEventGroup(ScratchBlocks, () => {
        try {
            if (identity && identity.creating) {
                createdIdentity = workspace.createVariable(identity.name, identity.type, identity.id,
                    left.scope === 'local', false);
            }
            block = ScratchBlocks.Xml.domToBlock(xml, workspace);
            return placeBlock(workspace, position, block);
        } catch (error) {
            if (block && block.workspace) block.dispose(true);
            if (createdIdentity) workspace.deleteVariableById(createdIdentity.getId());
            throw error;
        }
    }, onGroup);
};

const blockComparisonInputs = block => block && block.inputList.filter(input =>
    input.connection && input.connection.type === 1).slice(0, 2);

const canReplaceComparison = (workspace, sourceBlockId, instance) => {
    const source = workspace.getBlockById(sourceBlockId);
    if (!source || !OPERATOR_BY_TYPE[source.type] || !OPERATOR_BY_TYPE[comparisonType(instance)] ||
        blockComparisonInputs(source).length !== 2) return false;
    const incoming = source.outputConnection && source.outputConnection.targetConnection;
    return Boolean(source.outputConnection && (!incoming ||
        incoming.checkType_(instance.typeInfo.workspaceForm.outputConnection)));
};

const copyShadowFields = (source, destination) => {
    if (!source || !destination || !source.isShadow() || !destination.isShadow()) return;
    for (const input of source.inputList) {
        for (const field of input.fieldRow) {
            const target = field.name && destination.getField(field.name);
            if (target) target.setValue(field.getValue());
        }
    }
};

// Replace only the native comparison shell. Authored reporter operands retain
// their block identities; literal shadows retain their field values. The
// create, operand moves and old-shell deletion stay in one native Undo group.
const replaceComparison = ({ScratchBlocks, workspace, sourceBlockId, instance, onGroup = null}) => {
    if (!canReplaceComparison(workspace, sourceBlockId, instance)) {
        throw new Error('The selected comparison can no longer be replaced.');
    }
    const source = workspace.getBlockById(sourceBlockId);
    if (source.type === comparisonType(instance)) return {block: source, changed: false};
    const incoming = source.outputConnection.targetConnection;
    const coordinate = source.getRelativeToSurfaceXY();
    const sourceInputs = blockComparisonInputs(source);
    let replacement;
    inEventGroup(ScratchBlocks, () => {
        replacement = ScratchBlocks.Xml.domToBlock(blockXml(instance), workspace);
        const replacementInputs = blockComparisonInputs(replacement);
        if (replacementInputs.length !== 2) {
            replacement.dispose(false);
            throw new Error('The replacement comparison has an unexpected native shape.');
        }
        sourceInputs.forEach((sourceInput, index) => {
            const child = sourceInput.connection.targetBlock();
            const targetInput = replacementInputs[index];
            const defaultChild = targetInput.connection.targetBlock();
            if (!child) return;
            if (child.isShadow()) {
                copyShadowFields(child, defaultChild);
                return;
            }
            sourceInput.connection.disconnect();
            if (defaultChild) defaultChild.dispose(false);
            targetInput.connection.connect(child.outputConnection);
        });
        if (incoming) source.outputConnection.disconnect();
        source.dispose(false);
        if (incoming) incoming.connect(replacement.outputConnection);
        else replacement.moveBy(coordinate.x, coordinate.y);
    }, onGroup);
    return {block: replacement, changed: true};
};

const comparisonReplacementChoice = ({workspace, sourceBlockId, operator, comparison}) => {
    const source = workspace.getBlockById(sourceBlockId);
    const parsed = TYPE_BY_OPERATOR[operator] && comparison('0', operator);
    if (!source || !parsed || comparisonType(parsed.instance) !== TYPE_BY_OPERATOR[operator] ||
        !OPERATOR_BY_TYPE[source.type]) return null;
    const second = comparisonInput(parsed.instance, 1);
    return {
        ...parsed,
        kind: 'comparison-replace',
        text: `Replace ${OPERATOR_BY_TYPE[source.type]} with ${operator}`,
        completionText: operator,
        comparisonOperator: operator,
        focusInputName: second && second.name,
        fits: canReplaceComparison(workspace, sourceBlockId, parsed.instance)
    };
};

export {TYPE_BY_OPERATOR, OPERATOR_BY_TYPE, comparisonInput, comparisonIdentity, implicitComparisonChoices,
    implicitComparisonXml, insertImplicitComparison, canReplaceComparison, replaceComparison,
    comparisonReplacementChoice};
