import WorkspaceQuerier from '../../addons/addons/middle-click-popup/WorkspaceQuerier';
import {
    BlockInputType, BlockInstance, BlockTypeInfo
} from '../../addons/addons/middle-click-popup/BlockTypeInfo';
import {blockIconLabel} from './block-icon-labels';
import {createVariableCommandParser, createListCommandParser, createEmptyVariableTemplates,
    createEmptyListTemplates} from './variable-command';
import {createBroadcastCommandParser, createEmptyBroadcastTemplates} from './broadcast-command';

const childNamed = (element, tag, name) => Array.from(element.children).find(child =>
    child.tagName.toLowerCase() === tag && (!name || child.getAttribute('name') === name)
);

const comparisonResult = (search, query, operator = '=') => {
    const left = query.trim();
    const types = {'=': 'operator_equals', '>': 'operator_gt', '<': 'operator_lt'};
    if (!left || /[<>=]/.test(left) || !types[operator]) return null;
    return search(`${left} ${operator}`).find(choice =>
        choice.instance.typeInfo.workspaceForm.type === types[operator]) || null;
};

// Translate the existing Addons parse tree into a single native XML create. No
// temporary blocks, reused flyout IDs, or partial creations enter the live VM.
const blockXml = instance => {
    const {typeInfo} = instance;
    const xml = typeInfo.domForm.cloneNode(true);
    [xml, ...xml.querySelectorAll('block, shadow')].forEach(node => {
        node.removeAttribute('id');
        node.removeAttribute('x');
        node.removeAttribute('y');
    });
    typeInfo.inputs.forEach((input, index) => {
        const value = instance.inputs[index];
        if (value === null || typeof value === 'undefined') return;
        const sourceInput = typeInfo.workspaceForm.inputList[input.inputIdx];
        const tag = input.type === BlockInputType.BLOCK ? 'statement' : 'value';
        let slot = childNamed(xml, tag, sourceInput.name);
        if (value instanceof BlockInstance) {
            // Empty Boolean and statement holes have no XML child until filled.
            if (!slot) {
                slot = xml.ownerDocument.createElement(tag);
                slot.setAttribute('name', sourceInput.name);
                xml.appendChild(slot);
            }
            const previous = childNamed(slot, 'block');
            if (previous) previous.remove();
            slot.appendChild(blockXml(value));
            return;
        }
        const sourceField = input.getField(typeInfo.workspaceForm);
        const owner = input.fieldIdx === -1 && slot ? childNamed(slot, 'shadow') || childNamed(slot, 'block') : xml;
        const field = owner && childNamed(owner, 'field', sourceField.name);
        if (!field) throw new Error(`Missing native field ${sourceField.name}`);
        if (input.type === BlockInputType.ENUM) {
            if (field.hasAttribute('id')) {
                field.setAttribute('id', value.value);
                field.textContent = value.string;
            } else {
                field.textContent = value.value;
            }
        } else {
            field.textContent = String(value);
        }
    });
    if (typeInfo.workspaceForm.type === 'control_stop') {
        childNamed(xml, 'mutation').setAttribute('hasnext',
            String(instance.inputs[0].value === 'other scripts in sprite'));
    }
    return xml;
};

const createCatalogue = ({ScratchBlocks, vm, workspace, locale = blockIconLabel}) => {
    const types = BlockTypeInfo.getBlocks(ScratchBlocks, vm, workspace, locale, {includeCurrentSprite: true});
    const querier = new WorkspaceQuerier();
    querier.indexWorkspace(types);
    const commandHeads = [...new Set(types.filter(type => type.shape.canStackUp || type.shape.canStackDown)
        .map(type => (typeof type.parts[0] === 'string' ? type.parts[0].trim().split(/\s+/)[0] : ''))
        .filter(Boolean))];
    const empty = workspace.getVariablesOfType('').length ? null :
        createEmptyVariableTemplates({ScratchBlocks, vm, workspace, locale});
    const emptyList = !ScratchBlocks || workspace.getVariablesOfType(ScratchBlocks.LIST_VARIABLE_TYPE).length ? null :
        createEmptyListTemplates({ScratchBlocks, vm, workspace, locale});
    // A potential message model can exist even while the currently indexed
    // flyout has no Event blocks. Detect the native command templates, not the
    // variable map, before supplying the private fallbacks.
    const hasBroadcastCommands = types.some(type => ['event_whenbroadcastreceived', 'event_broadcast',
        'event_broadcastandwait'].includes(type.workspaceForm && type.workspaceForm.type));
    const emptyBroadcast = hasBroadcastCommands || !ScratchBlocks || !vm ? null :
        createEmptyBroadcastTemplates({ScratchBlocks, vm, workspace, locale});
    const search = query => {
        if (!query.trim()) return [];
        const prefix = query.trim().toLowerCase();
        let parsed = querier.queryWorkspace(query).results;
        // A bounded fallback for "wa 4": expand only one unambiguous
        // leading command word from the live catalogue, then let the same
        // parser validate the arguments. Never guess between command words
        // or rewrite names, dropdowns, or already successful parses.
        const abbreviation = query.trim().match(/^(\S{2,})\s+(\S[\s\S]*)$/);
        if (!parsed.length && abbreviation) {
            const stem = abbreviation[1].toLowerCase();
            const heads = commandHeads.filter(head => head.toLowerCase().startsWith(stem));
            if (heads.length === 1 && heads[0].toLowerCase() !== stem) {
                parsed = querier.queryWorkspace(`${heads[0]} ${abbreviation[2]}`).results;
            }
        }
        return parsed
            .map(result => ({
                instance: result.getBlock(),
                text: result.toText(false),
                truncated: Boolean(result.isTruncated)
            }))
            // A leading name match ("wai" -> "wait") comes before a
            // complete but incidental match ("broadcast ... and wait").
            // "say no" is a complete literal, not a request to create the
            // partially typed "not" operator. Preserve parser relevance
            // within each group; no hard-coded opcode ranking is needed.
            .sort((a, b) => Number(b.text.toLowerCase().startsWith(prefix)) -
                Number(a.text.toLowerCase().startsWith(prefix)) ||
                (!/\s/.test(prefix) && a.text.toLowerCase().startsWith(prefix) &&
                    b.text.toLowerCase().startsWith(prefix) ? a.text.trim().length - b.text.trim().length : 0) ||
                Number(a.truncated) - Number(b.truncated))
            .map(({instance, text, truncated}) => ({instance, text, truncated}));
    };
    return {
        dispose: () => {
            if (empty) empty.dispose();
            if (emptyList) emptyList.dispose();
            if (emptyBroadcast) emptyBroadcast.dispose();
        },
        broadcastCommands: ScratchBlocks ? createBroadcastCommandParser(
            emptyBroadcast ? [...types, ...emptyBroadcast.types] : types, ScratchBlocks) : () => [],
        variableCommands: createVariableCommandParser(empty ? [...types, ...empty.types] : types, ScratchBlocks),
        listCommands: ScratchBlocks ? createListCommandParser(
            emptyList ? [...types, ...emptyList.types] : types, ScratchBlocks) : () => [],
        byType: type => {
            const match = types.find(candidate => candidate.workspaceForm && candidate.workspaceForm.type === type);
            return match ? match.createBlock() : null;
        },
        search,
        comparison: (query, operator) => comparisonResult(search, query, operator)
    };
};

export {blockIconLabel, blockXml, comparisonResult, createCatalogue};
