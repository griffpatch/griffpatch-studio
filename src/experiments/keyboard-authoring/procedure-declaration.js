import {inEventGroup, placeBlock} from './operations';
import {resolveConnection} from './navigation';
import {findProcedurePosition} from './procedure-placement';

const isProcedureCreation = choice => choice && choice.kind === 'create-procedure';

const normalize = value => value.trim().replace(/\s+/g, ' ');

const signatureFromParts = parts => {
    const arguments_ = parts.filter(part => part.kind !== 'label');
    return {
        procCode: parts.map(part => (part.kind === 'label' ? part.text.replace(/%/g, '\\%') :
            part.kind === 'boolean' ? '%b' : '%s')).join(' '),
        argumentNames: arguments_.map(argument => argument.name),
        argumentTypes: arguments_.map(argument => argument.kind),
        argumentDefaults: arguments_.map(argument => (argument.kind === 'boolean' ? 'false' : ''))
    };
};

// This is deliberately a small Scratch-shaped declaration language, not a
// second general block parser. Parentheses denote text/number arguments and
// angle brackets denote Boolean arguments, matching their eventual slots.
const parseProcedureDeclaration = (query, keywords = ['define']) => {
    const source = query.trimStart();
    const keyword = keywords.filter(Boolean).sort((a, b) => b.length - a.length)
        .find(candidate => source.toLowerCase() === candidate.toLowerCase() ||
            source.toLowerCase().startsWith(`${candidate.toLowerCase()} `));
    if (!keyword) return null;
    const declarationText = source.slice(keyword.length).trim();
    const warpSuffix = /\s+::\s*warp\s*$/i.exec(declarationText);
    const signature = warpSuffix ? declarationText.slice(0, warpSuffix.index).trim() : declarationText;
    const options = warpSuffix ? {warp: true} : {};
    const parts = [];
    let label = '';
    const flushLabel = () => {
        const text = normalize(label);
        if (text) parts.push({kind: 'label', text});
        label = '';
    };
    // Strict creation and tolerant presentation share one scan. Incomplete
    // input exposes only a preview signature; it never acquires a creatable
    // procCode or silently repairs the user's text.
    const invalid = error => {
        flushLabel();
        return {text: source.trim(), error, ...options, preview: {...signatureFromParts(parts), ...options}};
    };
    if (!signature) return {...invalid('Type a custom block name after define.'), pending: true};
    if (signature.length > 160) return invalid('Custom block declarations are limited to 160 characters.');
    for (let index = 0; index < signature.length;) {
        const opening = signature[index];
        if (opening !== '(' && opening !== '<') {
            if (opening === ')' || opening === '>') {
                return invalid(`Unexpected “${opening}” in the custom block declaration.`);
            }
            label += opening;
            index++;
            continue;
        }
        flushLabel();
        if (parts.filter(part => part.kind !== 'label').length === 12) {
            return invalid('Custom blocks are limited to 12 typed arguments here.');
        }
        const closing = opening === '(' ? ')' : '>';
        const end = signature.indexOf(closing, index + 1);
        if (end < 0) {
            const name = normalize(signature.slice(index + 1).split(/[()<>]/)[0]);
            parts.push({kind: opening === '(' ? 'string' : 'boolean', name});
            return invalid(`Close the ${opening}${closing} argument before creating the block.`);
        }
        const name = normalize(signature.slice(index + 1, end));
        if (!name) {
            parts.push({kind: opening === '(' ? 'string' : 'boolean', name});
            return invalid('Every custom block argument needs a name.');
        }
        if (/[()< >]/.test(name.replace(/ /g, ''))) {
            return invalid('Custom block argument names cannot contain bracket characters.');
        }
        parts.push({kind: opening === '(' ? 'string' : 'boolean', name});
        index = end + 1;
    }
    flushLabel();
    const arguments_ = parts.filter(part => part.kind !== 'label');
    if (!parts.some(part => part.kind === 'label')) {
        return invalid('A custom block needs at least one text label.');
    }
    const names = new Set();
    for (const argument of arguments_) {
        const key = argument.name.toLowerCase();
        if (names.has(key)) return invalid(`Argument “${argument.name}” is repeated.`);
        names.add(key);
    }
    return {text: source.trim(), ...signatureFromParts(parts), ...options};
};

const definitionKeywords = ScratchBlocks => {
    const translated = (ScratchBlocks.Msg.PROCEDURES_DEFINITION || '').replace(/%\d+/g, '').trim();
    return [...new Set([translated, 'define'].filter(Boolean))];
};

const procedureMutation = (declaration, ScratchBlocks, argumentIds) => {
    const mutation = ScratchBlocks.Procedures.newProcedureMutation();
    mutation.setAttribute('proccode', declaration.procCode);
    mutation.setAttribute('argumentids', JSON.stringify(argumentIds));
    mutation.setAttribute('argumentnames', JSON.stringify(declaration.argumentNames));
    mutation.setAttribute('argumentdefaults', JSON.stringify(declaration.argumentDefaults));
    mutation.setAttribute('warp', String(Boolean(declaration.warp)));
    return mutation;
};

// Match Scratch Blocks' own createProcedureCallbackFactory_ XML exactly, while
// letting the keyboard caret choose the position and event group.
const procedureDefinitionXml = (declaration, ScratchBlocks, argumentIds) => {
    const root = ScratchBlocks.Xml.textToDom(`<xml>
        <block type="procedures_definition">
            <statement name="custom_block">
                <shadow type="procedures_prototype"></shadow>
            </statement>
        </block>
    </xml>`);
    root.querySelector('shadow').appendChild(procedureMutation(declaration, ScratchBlocks, argumentIds));
    return root.querySelector('block');
};

// Use the same mutation and native shadow generation as the My Blocks flyout.
// Reusing a definition must retain its argument IDs, warp flag and return type.
const procedureCallXml = (mutation, ScratchBlocks) => {
    const block = ScratchBlocks.Xml.textToDom('<xml><block type="procedures_call"></block></xml>')
        .querySelector('block');
    const callMutation = mutation.cloneNode(true);
    callMutation.setAttribute('generateshadows', 'true');
    block.appendChild(callMutation);
    return block;
};

const acceptsProcedureCall = (workspace, position, ScratchBlocks) => {
    if (!position || !['before', 'gap'].includes(position.kind)) return false;
    const anchor = workspace.getBlockById(position.blockId);
    if (!anchor) return false;
    const connection = resolveConnection(workspace, position);
    return connection ? connection.type === ScratchBlocks.NEXT_STATEMENT :
        position.kind === 'before' && Boolean(anchor.previousConnection);
};

const createProcedureCompletion = ({workspace, ScratchBlocks, vm, onGroup}) => {
    const keywords = definitionKeywords(ScratchBlocks);
    const choices = (position, query) => {
        const declaration = parseProcedureDeclaration(query, keywords);
        if (!declaration || (position.kind !== 'workspace' &&
            !acceptsProcedureCall(workspace, position, ScratchBlocks))) return [];
        const insertCall = position.kind !== 'workspace';
        const duplicate = declaration.procCode && ScratchBlocks.Procedures.getDefineBlock(
            declaration.procCode, workspace);
        const error = declaration.error || (duplicate && !insertCall ?
            'A custom block with this signature already exists.' : duplicate &&
            ScratchBlocks.Procedures.getProcedureReturnType(declaration.procCode, workspace) !==
                ScratchBlocks.PROCEDURES_CALL_TYPE_STATEMENT ?
                'This custom block does not fit a statement slot.' : null);
        const choice = {...declaration,
            warp: Boolean(declaration.warp),
            kind: 'create-procedure',
            insertCall,
            definitionId: duplicate ? duplicate.id : null,
            fits: Boolean(declaration.procCode && !error),
            description: insertCall ? duplicate ? 'Use existing custom block' :
                'Insert call · Also creates a definition' : 'Create custom block',
            error};
        // Existing signatures keep their own execution policy. Incomplete
        // signatures have only a disabled preview, not two creatable variants.
        if (duplicate || error) return [choice];
        const text = declaration.text.replace(/\s+::\s*warp\s*$/i, '');
        return [choice.warp, !choice.warp].map(warp => ({
            ...choice,
            warp,
            text: warp ? `${text} :: warp` : text,
            description: `${choice.description} · ${warp ? 'Run without screen refresh' : 'With screen refresh'}`}));
    };
    const xml = (choice, preview = false) => procedureDefinitionXml(choice, ScratchBlocks,
        choice.argumentNames.map((name, index) => (preview ? `tw-keyboard-argument-${index}` :
            ScratchBlocks.utils.genUid())));
    const apply = (position, choice, expectedTargetId) => {
        const insertCall = position.kind !== 'workspace';
        const existing = choice.procCode && ScratchBlocks.Procedures.getDefineBlock(choice.procCode, workspace);
        if ((!insertCall && existing) || (insertCall && !acceptsProcedureCall(workspace, position, ScratchBlocks)) ||
            !vm.editingTarget || vm.editingTarget.id !== expectedTargetId || !choice.procCode || choice.error ||
            insertCall !== choice.insertCall || (existing ? existing.id : null) !== choice.definitionId ||
            (existing && ScratchBlocks.Procedures.getProcedureReturnType(choice.procCode, workspace) !==
                ScratchBlocks.PROCEDURES_CALL_TYPE_STATEMENT)) {
            throw new Error('The custom block destination or signature has changed. Choose it again.');
        }
        let definition;
        let call;
        return inEventGroup(ScratchBlocks, () => {
            try {
                definition = existing || ScratchBlocks.Xml.domToBlock(xml(choice), workspace);
                if (!insertCall) return placeBlock(workspace, position, definition);
                const prototype = definition.getInputTargetBlock('custom_block');
                call = ScratchBlocks.Xml.domToBlock(procedureCallXml(prototype.mutationToDom(true), ScratchBlocks),
                    workspace);
                placeBlock(workspace, position, call);
                if (!existing) {
                    const anchor = call.getRootBlock().getBoundingRectangle();
                    const occupied = workspace.getTopBlocks(false).filter(block => block !== definition)
                        .map(block => block.getBoundingRectangle());
                    const destination = findProcedurePosition(anchor, occupied, definition.getHeightWidth(),
                        workspace.RTL);
                    placeBlock(workspace, destination, definition);
                }
                return call;
            } catch (error) {
                if (call) call.dispose(true);
                if (definition && !existing) definition.dispose(true);
                throw error;
            }
        }, onGroup);
    };
    const previewXml = choice => {
        if (!choice.insertCall) return xml({...choice.preview || choice, warp: choice.warp}, true);
        const existing = choice.definitionId && workspace.getBlockById(choice.definitionId);
        const declaration = {...choice.preview || choice, warp: choice.warp};
        const mutation = existing ? existing.getInputTargetBlock('custom_block').mutationToDom(true) :
            procedureMutation(declaration, ScratchBlocks,
                declaration.argumentNames.map((name, index) => `tw-keyboard-argument-${index}`));
        return procedureCallXml(mutation, ScratchBlocks);
    };
    return {choices, apply, previewXml};
};

export {acceptsProcedureCall, createProcedureCompletion, definitionKeywords, isProcedureCreation,
    parseProcedureDeclaration, procedureCallXml, procedureDefinitionXml};
