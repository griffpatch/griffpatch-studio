import {fieldAtPosition, resolveConnection} from './navigation';
import {accepts, inEventGroup, placeBlock} from './operations';
import {blockXml} from './catalogue';
import {bindVariableCommand} from './variable-command';

const scopeLabel = scope => (scope === 'local' ? 'This sprite only' : 'All sprites');
const isVariableName = name => Boolean(name && !Number.isFinite(Number(name)) && !/[+*/<>=()[\]\r\n]/.test(name));
const isVariableCreation = choice => choice && ['create-variable', 'create-variable-command'].includes(choice.kind);
const variableReporterXml = (variable, blockId = null) => {
    const xml = document.createElement('block');
    xml.setAttribute('type', 'data_variable');
    if (blockId) xml.setAttribute('id', blockId);
    const field = document.createElement('field');
    field.setAttribute('name', 'VARIABLE');
    field.setAttribute('id', variable.getId());
    field.textContent = variable.name;
    xml.appendChild(field);
    return xml;
};
const scopeOrder = (name, preference = 'uppercase') => {
    const globalFirst = preference === 'global' || (preference === 'uppercase' &&
        name === name.toUpperCase() && name.toLowerCase() !== name.toUpperCase());
    return globalFirst ? ['global', 'local'] : ['local', 'global'];
};

const variableFieldAt = (workspace, position, ScratchBlocks) => {
    const target = fieldAtPosition(workspace, position);
    return target && target.field instanceof ScratchBlocks.FieldVariable &&
        target.field.getVariable() && target.field.getVariable().type === '' ? target : null;
};

const canCreateTypedVariable = (workspace, vm, name, scope, type) => {
    if (!name || !['local', 'global'].includes(scope) || !vm.editingTarget ||
        (scope === 'local' && vm.editingTarget.isStage) || workspace.getVariable(name, type)) return false;
    // Match Scratch's global-name guard across ALL original sprites, not just
    // the current palette. Locals on different sprites may share a name.
    return scope === 'local' || !vm.runtime.getAllVarNamesOfType(type).includes(name);
};
const canCreateVariable = (workspace, vm, name, scope) => canCreateTypedVariable(workspace, vm, name, scope, '');

// Native output checks are discovered once, without populating the live
// workspace, variable map, VM or history with a probe reporter.
const scalarOutputCheck = ScratchBlocks => {
    ScratchBlocks.Events.disable();
    let probe;
    try {
        probe = new ScratchBlocks.Workspace();
        const block = probe.newBlock('data_variable');
        const check = block.outputConnection.check_;
        return {check_: check && check.slice()};
    } finally {
        if (probe) probe.dispose();
        ScratchBlocks.Events.enable();
    }
};

const createVariableCompletion = ({workspace, ScratchBlocks, vm, onGroup}) => {
    const output = scalarOutputCheck(ScratchBlocks);
    const fieldAt = position => variableFieldAt(workspace, position, ScratchBlocks);
    const acceptsAt = (position, replacementBlockId = null) => {
        if (fieldAt(position) || position.kind === 'workspace') return true;
        const connection = resolveConnection(workspace, position);
        const child = connection && connection.targetBlock();
        const replaceSelected = child && !child.isShadow() && child.id === replacementBlockId;
        return Boolean(connection && connection.type === 1 && (!child || child.isShadow() || replaceSelected) &&
            connection.checkType_(output));
    };
    const identityChoices = (query, preference) => {
        const name = query.trim(); // Same normalization as Scratch's name prompt.
        const existing = workspace.getVariablesOfType('')
            .filter(variable => !name || variable.name.toLowerCase().includes(name.toLowerCase()))
            .sort((a, b) => Number(b.name === name) - Number(a.name === name) || a.name.localeCompare(b.name))
            .slice(0, 5)
            .map(variable => ({kind: 'variable',
                text: variable.name,
                variableId: variable.getId(),
                scope: variable.isLocal ? 'local' : 'global',
                fits: true}));
        // Do not turn numeric literals or arithmetic expressions into suggested
        // declarations. Multi-word and non-Latin variable names remain allowed.
        const create = isVariableName(name) ? scopeOrder(name, preference)
            .filter(scope => canCreateVariable(workspace, vm, name, scope))
            .map(scope => ({kind: 'create-variable', text: name, scope, fits: true})) : [];
        return [...existing, ...create];
    };
    const choices = (position, query, preference, replacementBlockId = null) => (
        acceptsAt(position, replacementBlockId) ? identityChoices(query, preference) : []
    );
    const choicesAtConnection = (connection, query, preference) => (
        connection && connection.type === 1 && connection.checkType_(output) ?
            identityChoices(query, preference) : []
    );
    const apply = (position, choice, expectedTargetId, replacementBlockId = null) => {
        if (!vm.editingTarget || vm.editingTarget.id !== expectedTargetId ||
            !acceptsAt(position, replacementBlockId)) {
            throw new Error('The variable destination has changed. Choose it again.');
        }
        const creating = choice.kind === 'create-variable';
        const name = choice.text.trim();
        let variable = creating ? null : workspace.getVariableById(choice.variableId);
        if (creating ? !canCreateVariable(workspace, vm, name, choice.scope) : !variable || variable.type !== '') {
            throw new Error('The variable choices have changed. Choose an existing variable or another name.');
        }
        const field = fieldAt(position);
        const oldValue = field && field.field.getValue();
        const blockId = field ? null : ScratchBlocks.utils.genUid();
        return inEventGroup(ScratchBlocks, () => {
            try {
                if (creating) variable = workspace.createVariable(name, '', null, choice.scope === 'local', false);
                if (field) {
                    field.field.setValue(variable.getId());
                    return null;
                }
                const block = ScratchBlocks.Xml.domToBlock(variableReporterXml(variable, blockId), workspace);
                placeBlock(workspace, position, block, replacementBlockId);
                return block;
            } catch (error) {
                // Compensate only objects this action owns. Native events keep
                // the VM in step; do not restore a whole-project snapshot.
                const block = blockId && workspace.getBlockById(blockId);
                if (block) block.dispose(false);
                if (field) field.field.setValue(oldValue);
                if (creating && variable) workspace.deleteVariableById(variable.getId());
                throw error;
            }
        }, onGroup);
    };
    const commandChoices = (position, matches, preference) => matches
        .filter(command => isVariableName(command.variableName) && accepts(workspace, position, command.instance))
        .flatMap(command => scopeOrder(command.variableName, preference)
            .filter(scope => canCreateVariable(workspace, vm, command.variableName, scope))
            .map(scope => ({...command, kind: 'create-variable-command', scope, fits: true})));
    const applyCommand = (position, choice, expectedTargetId) => {
        if (!vm.editingTarget || vm.editingTarget.id !== expectedTargetId ||
            !accepts(workspace, position, choice.instance) ||
            !canCreateVariable(workspace, vm, choice.variableName, choice.scope)) {
            throw new Error('The variable command destination or name has changed. Choose it again.');
        }
        const blockId = ScratchBlocks.utils.genUid();
        const variableId = ScratchBlocks.utils.genUid();
        // Resolve the parser's native field descriptors before creating the
        // variable: a variable-create notification refreshes the live flyout
        // and disposes those source fields synchronously. The committed XML
        // uses the reserved native ID, never an already disposed palette block.
        const xml = blockXml(bindVariableCommand(choice, {
            name: choice.variableName,
            getId: () => variableId
        }));
        xml.setAttribute('id', blockId);
        let variable;
        return inEventGroup(ScratchBlocks, () => {
            try {
                variable = workspace.createVariable(choice.variableName, '', variableId,
                    choice.scope === 'local', false);
                return placeBlock(workspace, position, ScratchBlocks.Xml.domToBlock(xml, workspace));
            } catch (error) {
                const block = workspace.getBlockById(blockId);
                // Preserve any existing continuation even after a failed native
                // connection. This action owns its new command, not the tail.
                if (block) block.dispose(true);
                if (variable) workspace.deleteVariableById(variable.getId());
                throw error;
            }
        }, onGroup);
    };
    return {fieldAt, acceptsAt, choices, choicesAtConnection, apply, commandChoices, applyCommand};
};

export {scopeLabel, scopeOrder, isVariableName, canCreateTypedVariable, canCreateVariable, variableFieldAt,
    createVariableCompletion, variableReporterXml, isVariableCreation};
