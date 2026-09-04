import WorkspaceQuerier from '../../addons/addons/middle-click-popup/WorkspaceQuerier';
import {BlockInputString, BlockInputType, BlockInstance, BlockTypeInfo} from
    '../../addons/addons/middle-click-popup/BlockTypeInfo';

// Scratch hides variable commands when no scalar variable exists (including
// on Stage with only sprite-local variables). Obtain their real definitions
// from its DataCategory factories in a private, event-silent headless workspace.
// Nothing is added to the live palette, VM, history or rendered scene.
const createEmptyVariableTemplates = ({ScratchBlocks, vm, workspace, locale}) => {
    let probe;
    const dispose = () => {
        ScratchBlocks.Events.disable();
        try {
            if (probe) probe.dispose();
            probe = null;
        } finally {
            ScratchBlocks.Events.enable();
        }
    };
    ScratchBlocks.Events.disable();
    try {
        probe = new ScratchBlocks.Workspace();
        const variable = probe.createVariable(ScratchBlocks.Variables.generateUniqueName(probe), '');
        const xml = [];
        const category = ScratchBlocks.DataCategory;
        for (const add of [category.addSetVariableTo, category.addChangeVariableBy,
            category.addShowVariable, category.addHideVariable]) add(xml, variable);
        const types = xml.flatMap(dom => BlockTypeInfo._createBlocks(workspace, vm, ScratchBlocks, locale,
            ScratchBlocks.Xml.domToBlock(dom, probe), dom));
        return {types, dispose};
    } catch (error) {
        dispose();
        throw error;
    } finally {
        ScratchBlocks.Events.enable();
    }
};

const createEmptyListTemplates = ({ScratchBlocks, vm, workspace, locale}) => {
    let probe;
    const dispose = () => {
        ScratchBlocks.Events.disable();
        try {
            if (probe) probe.dispose();
            probe = null;
        } finally {
            ScratchBlocks.Events.enable();
        }
    };
    ScratchBlocks.Events.disable();
    try {
        probe = new ScratchBlocks.Workspace();
        const list = probe.createVariable(ScratchBlocks.Variables.generateUniqueName(probe),
            ScratchBlocks.LIST_VARIABLE_TYPE);
        const xml = [];
        const category = ScratchBlocks.DataCategory;
        for (const add of [category.addDataList, category.addAddToList, category.addDeleteOfList,
            category.addDeleteAllOfList, category.addInsertAtList, category.addReplaceItemOfList,
            category.addItemOfList, category.addItemNumberOfList, category.addLengthOfList,
            category.addListContainsItem, category.addShowList, category.addHideList]) add(xml, list);
        const types = xml.flatMap(dom => BlockTypeInfo._createBlocks(workspace, vm, ScratchBlocks, locale,
            ScratchBlocks.Xml.domToBlock(dom, probe), dom));
        return {types, dispose};
    } catch (error) {
        dispose();
        throw error;
    } finally {
        ScratchBlocks.Events.enable();
    }
};

// Interpret a proposed identity only in one native typed-variable dropdown.
// Reuse the Addons grammar for labels, quoting, argument boundaries and
// expressions; do not split localized commands with a second handwritten
// parser. Scalar variables and broadcast messages share this native shape,
// while their eligibility and commit rules remain separate.
const createTypedVariableCommandParser = (types, ScratchBlocks, variableType, acceptsRoot,
    acceptsInput = input => !input.isRound) => {
    const descriptors = new Map();
    const commands = [];
    for (const type of types) {
        if (!acceptsRoot(type)) continue;
        const variableInputs = type.inputs.filter(input => {
            if (input.type !== BlockInputType.ENUM || !acceptsInput(input)) return false;
            const field = input.getField(type.workspaceForm);
            // A private broadcast shadow may not bind a model until it enters
            // a rendered flyout. Its native defaultType_ is still the typed
            // field contract; ordinary live fields retain the stronger model
            // identity check.
            return field instanceof ScratchBlocks.FieldVariable &&
                (field.getVariable()?.type ?? field.defaultType_) === variableType;
        });
        if (variableInputs.length !== 1) continue;
        const input = variableInputs[0];
        // A declaration needs an explicit leading command label, not a guess
        // made inside an argument. The identity dropdown may itself come after
        // other inputs (for example "add [item] to [list]"); the bundled parser
        // still owns those argument boundaries and localized connective words.
        const labels = type.parts.slice(0, type.parts.findIndex(part => typeof part !== 'string'));
        if (!labels.length) continue;
        const prefix = labels.join(' ').trim()
            .toLowerCase();
        const proposed = new BlockInputString(input.inputIdx, input.fieldIdx, '');
        proposed.literalOnly = true;
        const descriptor = Object.assign(Object.create(Object.getPrototypeOf(type)), type, {
            parts: type.parts.map(part => (part === input ? proposed : part)),
            inputs: type.inputs.map(part => (part === input ? proposed : part))
        });
        descriptors.set(descriptor, {type, inputIndex: type.inputs.indexOf(input), prefix});
        commands.push(descriptor);
    }
    let querier;
    return query => {
        const normalized = query.trim().toLowerCase();
        if (![...descriptors.values()].some(({prefix}) => normalized.startsWith(`${prefix} `))) return [];
        if (!querier) {
            querier = new WorkspaceQuerier();
            // Existing reporters supply the ordinary argument grammar. Only
            // the root command's scalar dropdown gets a proposed-name slot.
            querier.indexWorkspace([...commands, ...types.filter(type => type.shape.canBeRound)]);
        }
        const matches = [];
        // Match the main completion ranking: an explicit value such as "1"
        // beats the incomplete "10 ^ of ..." reporter it also happens to prefix.
        // Preserve the parser's relevance order within each completeness tier.
        const results = querier.queryWorkspace(query).results
            .sort((a, b) => Number(a.isTruncated) - Number(b.isTruncated));
        for (const result of results) {
            const parsed = result.getBlock();
            const descriptor = descriptors.get(parsed.typeInfo);
            if (!descriptor || !normalized.startsWith(`${descriptor.prefix} `)) continue;
            const {type, inputIndex} = descriptor;
            const value = parsed.inputs[inputIndex];
            if (typeof value !== 'string' || !value.trim()) continue;
            const inputs = parsed.inputs.slice();
            inputs[inputIndex] = type.inputs[inputIndex].defaultValue;
            matches.push({identityName: value.trim(),
                identityInput: inputIndex,
                instance: new BlockInstance(type, ...inputs),
                text: result.toText(false).trim()});
        }
        return matches;
    };
};

const createVariableCommandParser = (types, ScratchBlocks) => {
    const parse = createTypedVariableCommandParser(types, ScratchBlocks, '', type =>
        type.shape.canStackUp && !type.shape.canBeRound);
    return query => parse(query).map(command => ({...command,
        variableName: command.identityName,
        variableInput: command.identityInput}));
};

const createListCommandParser = (types, ScratchBlocks) => {
    const parse = createTypedVariableCommandParser(types, ScratchBlocks, ScratchBlocks.LIST_VARIABLE_TYPE,
        type => type.shape.canStackUp || type.shape.canBeRound);
    return query => parse(query).map(command => ({...command,
        listName: command.identityName,
        listInput: command.identityInput}));
};

const bindTypedVariableCommand = (command, variable) => {
    const inputs = command.instance.inputs.slice();
    inputs[command.identityInput] = {value: variable.getId(), string: variable.name};
    return new BlockInstance(command.instance.typeInfo, ...inputs);
};

const bindVariableCommand = (command, variable) =>
    bindTypedVariableCommand({...command, identityInput: command.variableInput}, variable);

const bindListCommand = (command, variable) =>
    bindTypedVariableCommand({...command, identityInput: command.listInput}, variable);

export {createTypedVariableCommandParser, bindTypedVariableCommand, createVariableCommandParser,
    createListCommandParser, bindVariableCommand, bindListCommand, createEmptyVariableTemplates,
    createEmptyListTemplates};
