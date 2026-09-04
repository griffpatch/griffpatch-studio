import {fieldAtPosition, resolveConnection} from './navigation';
import {accepts, inEventGroup, placeBlock} from './operations';
import {blockXml} from './catalogue';
import {bindListCommand} from './variable-command';
import {canCreateTypedVariable, isVariableName, scopeOrder} from './variables';

const isListCreation = choice => choice && ['create-list', 'create-list-command'].includes(choice.kind);
const listReporterXml = (list, blockId = null) => {
    const xml = document.createElement('block');
    xml.setAttribute('type', 'data_listcontents');
    if (blockId) xml.setAttribute('id', blockId);
    const field = document.createElement('field');
    field.setAttribute('name', 'LIST');
    field.setAttribute('id', list.getId());
    field.setAttribute('variabletype', 'list');
    field.textContent = list.name;
    xml.appendChild(field);
    return xml;
};

const listFieldAt = (workspace, position, ScratchBlocks) => {
    const target = fieldAtPosition(workspace, position);
    return target && target.field instanceof ScratchBlocks.FieldVariable && target.field.getVariable() &&
        target.field.getVariable().type === ScratchBlocks.LIST_VARIABLE_TYPE ? target : null;
};

const listOutputCheck = ScratchBlocks => {
    ScratchBlocks.Events.disable();
    let probe;
    try {
        probe = new ScratchBlocks.Workspace();
        const block = probe.newBlock('data_listcontents');
        const check = block.outputConnection.check_;
        return {check_: check && check.slice()};
    } finally {
        if (probe) probe.dispose();
        ScratchBlocks.Events.enable();
    }
};

const explicitListName = query => {
    const match = /^\s*(?:create\s+)?list\s+(.+?)\s*$/i.exec(query);
    return match && match[1];
};

const createListCompletion = ({workspace, ScratchBlocks, vm, onGroup}) => {
    const type = ScratchBlocks.LIST_VARIABLE_TYPE;
    const output = listOutputCheck(ScratchBlocks);
    const fieldAt = position => listFieldAt(workspace, position, ScratchBlocks);
    const acceptsAt = (position, replacementBlockId = null) => {
        if (fieldAt(position) || position.kind === 'workspace') return true;
        const connection = resolveConnection(workspace, position);
        const child = connection && connection.targetBlock();
        const replaceSelected = child && !child.isShadow() && child.id === replacementBlockId;
        return Boolean(connection && connection.type === 1 && (!child || child.isShadow() || replaceSelected) &&
            connection.checkType_(output));
    };
    const identityChoices = (query, preference, field = null) => {
        const name = field ? query.trim() : explicitListName(query);
        if (!name) return [];
        const label = field ? name : `list ${name}`;
        const existing = workspace.getVariablesOfType(type)
            .filter(list => list.name.toLowerCase().includes(name.toLowerCase()))
            .sort((a, b) => Number(b.name === name) - Number(a.name === name) || a.name.localeCompare(b.name))
            .slice(0, 5)
            .map(list => ({kind: 'list',
                text: field ? list.name : `list ${list.name}`,
                listName: list.name,
                variableId: list.getId(),
                scope: list.isLocal ? 'local' : 'global',
                fits: true}));
        const create = isVariableName(name) ? scopeOrder(name, preference)
            .filter(scope => canCreateTypedVariable(workspace, vm, name, scope, type))
            .map(scope => ({kind: 'create-list', text: label, listName: name, scope, fits: true})) : [];
        return [...existing, ...create];
    };
    const choices = (position, query, preference, replacementBlockId = null) => {
        if (!acceptsAt(position, replacementBlockId)) return [];
        return identityChoices(query, preference, fieldAt(position));
    };
    const choicesAtConnection = (connection, query, preference) => (
        connection && connection.type === 1 && connection.checkType_(output) ?
            identityChoices(query, preference) : []
    );
    const apply = (position, choice, expectedTargetId, replacementBlockId = null) => {
        if (!vm.editingTarget || vm.editingTarget.id !== expectedTargetId ||
            !acceptsAt(position, replacementBlockId)) {
            throw new Error('The list destination has changed. Choose it again.');
        }
        const creating = choice.kind === 'create-list';
        const name = choice.listName;
        let list = creating ? null : workspace.getVariableById(choice.variableId);
        if (creating ? !canCreateTypedVariable(workspace, vm, name, choice.scope, type) :
            !list || list.type !== type) {
            throw new Error('The list choices have changed. Choose an existing list or another name.');
        }
        const field = fieldAt(position);
        const oldValue = field && field.field.getValue();
        const blockId = field ? null : ScratchBlocks.utils.genUid();
        return inEventGroup(ScratchBlocks, () => {
            try {
                if (creating) list = workspace.createVariable(name, type, null, choice.scope === 'local', false);
                if (field) {
                    field.field.setValue(list.getId());
                    return null;
                }
                const block = ScratchBlocks.Xml.domToBlock(listReporterXml(list, blockId), workspace);
                placeBlock(workspace, position, block, replacementBlockId);
                return block;
            } catch (error) {
                const block = blockId && workspace.getBlockById(blockId);
                if (block) block.dispose(false);
                if (field) field.field.setValue(oldValue);
                if (creating && list) workspace.deleteVariableById(list.getId());
                throw error;
            }
        }, onGroup);
    };
    const commandChoices = (position, matches, preference) => matches
        .filter(command => isVariableName(command.listName) && accepts(workspace, position, command.instance))
        .flatMap(command => scopeOrder(command.listName, preference)
            .filter(scope => canCreateTypedVariable(workspace, vm, command.listName, scope, type))
            .map(scope => ({...command, kind: 'create-list-command', scope, fits: true})));
    const applyCommand = (position, choice, expectedTargetId) => {
        if (!vm.editingTarget || vm.editingTarget.id !== expectedTargetId ||
            !accepts(workspace, position, choice.instance) ||
            !canCreateTypedVariable(workspace, vm, choice.listName, choice.scope, type)) {
            throw new Error('The list command destination or name has changed. Choose it again.');
        }
        const blockId = ScratchBlocks.utils.genUid();
        const listId = ScratchBlocks.utils.genUid();
        const xml = blockXml(bindListCommand(choice, {name: choice.listName, getId: () => listId}));
        xml.setAttribute('id', blockId);
        let list;
        return inEventGroup(ScratchBlocks, () => {
            try {
                list = workspace.createVariable(choice.listName, type, listId, choice.scope === 'local', false);
                return placeBlock(workspace, position, ScratchBlocks.Xml.domToBlock(xml, workspace));
            } catch (error) {
                const block = workspace.getBlockById(blockId);
                if (block) block.dispose(true);
                if (list) workspace.deleteVariableById(list.getId());
                throw error;
            }
        }, onGroup);
    };
    return {fieldAt, acceptsAt, choices, choicesAtConnection, apply, commandChoices, applyCommand};
};

export {explicitListName, isListCreation, listFieldAt, listReporterXml, createListCompletion};
