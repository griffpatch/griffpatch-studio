import {JSDOM} from 'jsdom';

import {clearClipboardSnapshot, clipStackXml, collectVariableReferences, createBlockClipboard, crossTargetVariablePlan,
    displaceUnownedWorkspaceVariable, fitsBlock, readClipboardSnapshot, restoreDisplacedWorkspaceVariable,
    retainClipboardSnapshot, rewriteCrossTargetXml} from '../../../src/experiments/keyboard-authoring/block-clipboard';

const dom = new JSDOM('');
const document = dom.window.document;

const block = overrides => ({outputConnection: null, previousConnection: null, nextConnection: null, ...overrides});
const workspace = connection => ({
    getBlockById: id => id === 'anchor' ? {previousConnection: {}} : null
});

test('a workspace accepts native statement or reporter roots', () => {
    expect(fitsBlock(workspace(), {kind: 'workspace'}, block({outputConnection: {}}))).toBe(true);
});

test('an expression slot protects real children and checks native output types', () => {
    const child = {isShadow: () => false};
    const open = {type: 1, targetBlock: () => null, checkType_: () => true};
    const occupied = {...open, targetBlock: () => child};
    const reporter = block({outputConnection: {}});
    const ws = {getBlockById: () => ({getInput: () => ({connection: open})})};
    expect(fitsBlock(ws, {kind: 'input', blockId: 'anchor', inputName: 'VALUE'}, reporter)).toBe(true);
    ws.getBlockById = () => ({getInput: () => ({connection: occupied})});
    expect(fitsBlock(ws, {kind: 'input', blockId: 'anchor', inputName: 'VALUE'}, reporter)).toBe(false);
    ws.getBlockById = () => ({getInput: () => ({connection: {...open, checkType_: () => false}})});
    expect(fitsBlock(ws, {kind: 'input', blockId: 'anchor', inputName: 'VALUE'}, reporter)).toBe(false);
});

test('a statement can splice a continuation only with both native stack connections', () => {
    const tail = {};
    const connection = {type: 3, targetBlock: () => tail};
    const ws = {getBlockById: () => ({nextConnection: connection})};
    const at = {kind: 'gap', blockId: 'anchor'};
    expect(fitsBlock(ws, at, block({previousConnection: {}, nextConnection: {}}))).toBe(true);
    expect(fitsBlock(ws, at, block({previousConnection: {}}))).toBe(false);
    expect(fitsBlock(ws, at, block({outputConnection: {}}))).toBe(false);
});

test('insertion above a free root requires a lower statement connection', () => {
    const at = {kind: 'before', blockId: 'anchor'};
    expect(fitsBlock(workspace(), at, block({nextConnection: {}}))).toBe(true);
    expect(fitsBlock(workspace(), at, block({previousConnection: {}}))).toBe(false);
});

const blockXml = () => {
    const root = document.createElement('block');
    root.setAttribute('type', 'event_whenthisspriteclicked');
    const local = document.createElement('field');
    local.setAttribute('name', 'VARIABLE');
    local.setAttribute('id', 'local-id');
    local.setAttribute('variabletype', '');
    local.textContent = 'score';
    root.appendChild(local);
    const global = document.createElement('field');
    global.setAttribute('name', 'LIST');
    global.setAttribute('id', 'global-id');
    global.setAttribute('variabletype', 'list');
    global.textContent = 'items';
    root.appendChild(global);
    return root;
};

test('captures only referenced native variable identities and their source scope', () => {
    const models = {
        'local-id': {id: 'local-id', name: 'score', type: '', isCloud: false},
        'global-id': {id: 'global-id', name: 'items', type: 'list', isCloud: false}
    };
    const source = {
        isStage: false,
        variables: {'local-id': models['local-id']},
        lookupVariableById: id => models[id]
    };
    expect(collectVariableReferences(blockXml(), source)).toEqual([
        {id: 'local-id', name: 'score', type: '', isLocal: true, isCloud: false},
        {id: 'global-id', name: 'items', type: 'list', isLocal: false, isCloud: false}
    ]);
});

test('maps a copied local identity to an existing destination local and keeps globals by id', () => {
    const local = {id: 'destination-local', name: 'score', type: ''};
    const global = {id: 'global-id', name: 'items', type: 'list'};
    const target = {
        isStage: false,
        lookupVariableById: id => id === global.id ? global : null,
        lookupVariableByNameAndType: (name, type) => name === 'score' && type === '' ? local : null
    };
    expect(crossTargetVariablePlan([
        {id: 'local-id', name: 'score', type: '', isLocal: true, isCloud: false},
        {id: 'global-id', name: 'items', type: 'list', isLocal: false, isCloud: false}
    ], target, {getAllVarNamesOfType: () => []})).toEqual([
        {oldId: 'local-id', existing: local},
        {oldId: 'global-id', existing: global}
    ]);
});

test('matches Scratch sharing by reusing an in-scope Stage global when no destination local exists', () => {
    const global = {id: 'stage-score', name: 'score', type: ''};
    const target = {
        isStage: false,
        lookupVariableById: () => null,
        // Target.lookupVariableByNameAndType searches destination locals first,
        // then Stage globals. The clipboard must preserve that native ordering.
        lookupVariableByNameAndType: (name, type) => name === 'score' && type === '' ? global : null
    };
    expect(crossTargetVariablePlan([
        {id: 'source-local', name: 'score', type: '', isLocal: true, isCloud: false}
    ], target, {getAllVarNamesOfType: () => []})).toEqual([
        {oldId: 'source-local', existing: global}
    ]);
});

test('keeps same-named scalar and list identities separate when sharing', () => {
    const scalar = {id: 'destination-scalar', name: 'items', type: ''};
    const target = {
        isStage: false,
        lookupVariableById: () => null,
        lookupVariableByNameAndType: (name, type) => name === 'items' && type === '' ? scalar : null
    };
    expect(crossTargetVariablePlan([
        {id: 'source-scalar', name: 'items', type: '', isLocal: true, isCloud: false},
        {id: 'source-list', name: 'items', type: 'list', isLocal: true, isCloud: false}
    ], target, {getAllVarNamesOfType: () => []})).toEqual([
        {oldId: 'source-scalar', existing: scalar},
        {oldId: 'source-list', create: {
            id: null, name: 'items', type: 'list', isLocal: true, isCloud: false
        }}
    ]);
});

test('refuses a missing project-global identity instead of silently changing its scope', () => {
    expect(() => crossTargetVariablePlan([
        {id: 'missing-global', name: 'shared', type: '', isLocal: false, isCloud: false}
    ], {
        isStage: false,
        lookupVariableById: () => null
    }, {getAllVarNamesOfType: () => []})).toThrow(/unavailable/i);
});

test('plans a new destination local and Scratch-compatible unique Stage global', () => {
    const localPlan = crossTargetVariablePlan([
        {id: 'source-local', name: 'score', type: '', isLocal: true, isCloud: false}
    ], {
        isStage: false,
        lookupVariableById: () => null,
        lookupVariableByNameAndType: () => null
    }, {getAllVarNamesOfType: () => []});
    expect(localPlan).toEqual([{oldId: 'source-local', create: {
        id: null, name: 'score', type: '', isLocal: true, isCloud: false
    }}]);

    const stagePlan = crossTargetVariablePlan([
        {id: 'source-local', name: 'score', type: '', isLocal: true, isCloud: false}
    ], {
        isStage: true,
        lookupVariableById: () => null
    }, {getAllVarNamesOfType: () => ['Stage: score', 'Stage: score2']});
    expect(stagePlan).toEqual([{oldId: 'source-local', create: {
        id: 'StageVarFromLocal_source-local', name: 'Stage: score3', type: '', isLocal: false, isCloud: false
    }}]);
});

test('replaces only an unused previous-target Blockly identity and can restore it after failure', () => {
    const stale = {id: 'source-list', name: 'groceries', type: 'list', isLocal: false, isCloud: false};
    const variables = new Map([[stale.id, stale]]);
    let eventDepth = 0;
    const ScratchBlocks = {Events: {
        disable: jest.fn(() => eventDepth++),
        enable: jest.fn(() => eventDepth--)
    }};
    const ws = {
        getVariable: (name, type) => [...variables.values()].find(model =>
            model.name === name && model.type === type) || null,
        getVariableUsesById: () => [],
        deleteVariableById: id => variables.delete(id),
        createVariable: (name, type, id, isLocal, isCloud) => {
            const model = {id, name, type, isLocal, isCloud};
            variables.set(id, model);
            return model;
        }
    };
    const target = {lookupVariableById: () => null};
    const displaced = displaceUnownedWorkspaceVariable(ws, ScratchBlocks, target,
        {name: 'groceries', type: 'list'});
    expect(displaced).toEqual(stale);
    expect(variables.size).toBe(0);
    expect(eventDepth).toBe(0);
    restoreDisplacedWorkspaceVariable(ws, ScratchBlocks, displaced);
    expect(variables.get(stale.id)).toEqual(stale);
    expect(eventDepth).toBe(0);
});

test('never displaces a workspace identity owned or referenced by the current target', () => {
    const model = {id: 'current-list', name: 'groceries', type: 'list'};
    const workspaceWith = uses => ({
        getVariable: () => model,
        getVariableUsesById: () => uses,
        deleteVariableById: jest.fn()
    });
    const ScratchBlocks = {Events: {disable: jest.fn(), enable: jest.fn()}};
    const owned = workspaceWith([]);
    expect(displaceUnownedWorkspaceVariable(owned, ScratchBlocks,
        {lookupVariableById: () => model}, model)).toBeNull();
    expect(owned.deleteVariableById).not.toHaveBeenCalled();
    expect(() => displaceUnownedWorkspaceVariable(workspaceWith([{}]), ScratchBlocks,
        {lookupVariableById: () => null}, model)).toThrow(/still uses an identity/i);
});

test('rewrites destination identities and sprite-click hats without changing source XML', () => {
    const source = blockXml();
    const rewritten = rewriteCrossTargetXml(source, [
        {oldId: 'local-id', existing: {id: 'destination-local', name: 'points'}},
        {oldId: 'global-id', existing: {id: 'global-id', name: 'items'}}
    ], true);
    expect(source.getAttribute('type')).toBe('event_whenthisspriteclicked');
    expect(rewritten.getAttribute('type')).toBe('event_whenstageclicked');
    expect(rewritten.querySelector('field[id="destination-local"]').textContent).toBe('points');
    expect(rewritten.querySelector('field[id="global-id"]').textContent).toBe('items');
});

test('refuses custom-procedure fragments across targets', () => {
    const xml = document.createElement('block');
    xml.setAttribute('type', 'procedures_call');
    expect(() => rewriteCrossTargetXml(xml, [], false)).toThrow(/custom block/i);
});

test('clips only the outer selected continuation and preserves nested C-mouth stacks', () => {
    const root = document.createElement('block');
    root.setAttribute('type', 'control_repeat');
    const mouth = document.createElement('statement');
    mouth.setAttribute('name', 'SUBSTACK');
    const nested = document.createElement('block');
    nested.setAttribute('type', 'looks_say');
    const nestedNext = document.createElement('next');
    const nestedTail = document.createElement('block');
    nestedTail.setAttribute('type', 'motion_movesteps');
    nestedNext.appendChild(nestedTail);
    nested.appendChild(nestedNext);
    mouth.appendChild(nested);
    root.appendChild(mouth);
    let current = root;
    ['looks_nextcostume', 'sound_play', 'motion_turnright'].forEach(type => {
        const next = document.createElement('next');
        const child = document.createElement('block');
        child.setAttribute('type', type);
        next.appendChild(child);
        current.appendChild(next);
        current = child;
    });
    const clipped = clipStackXml(root, 2);
    expect(clipped.querySelector('statement[name="SUBSTACK"] block next block').getAttribute('type'))
        .toBe('motion_movesteps');
    const outerSecond = clipped.querySelector(':scope > next > block');
    expect(outerSecond.getAttribute('type')).toBe('looks_nextcostume');
    expect(Array.from(outerSecond.children).find(child => child.tagName.toLowerCase() === 'next')).toBeUndefined();
    expect(root.querySelector(':scope > next > block > next > block').getAttribute('type')).toBe('sound_play');
});

test('project reset clears both the enriched snapshot and Blockly native clipboard for this workspace', () => {
    const sourceWorkspace = {};
    const ScratchBlocks = {clipboardXml_: {oldProject: true}, clipboardSource_: sourceWorkspace};
    createBlockClipboard({workspace: sourceWorkspace, ScratchBlocks, vm: null}).clear();
    expect(ScratchBlocks.clipboardXml_).toBeNull();
    expect(ScratchBlocks.clipboardSource_).toBeNull();

    // A project replacement may recreate the main Blockly workspace before
    // PROJECT_LOADED reaches the controller. The old workspace identity must
    // not protect an old-project clipboard from being cleared.
    ScratchBlocks.clipboardXml_ = {oldProject: true};
    ScratchBlocks.clipboardSource_ = {};
    createBlockClipboard({workspace: sourceWorkspace, ScratchBlocks, vm: null}).clear();
    expect(ScratchBlocks.clipboardXml_).toBeNull();
    expect(ScratchBlocks.clipboardSource_).toBeNull();
});

test('enriched clipboard identity survives a controller remount and is cloned on read', () => {
    const ScratchBlocks = {clipboardXml_: blockXml()};
    const xml = blockXml();
    retainClipboardSnapshot(ScratchBlocks, {
        targetId: 'source-sprite',
        xml,
        variables: [{id: 'local-id', name: 'score', type: '', isLocal: true, isCloud: false}]
    });
    const first = readClipboardSnapshot(ScratchBlocks);
    const second = readClipboardSnapshot(ScratchBlocks);
    expect(first).toEqual(expect.objectContaining({targetId: 'source-sprite'}));
    expect(first.variables).toEqual(second.variables);
    expect(first.variables).not.toBe(second.variables);
    expect(first.xml).not.toBe(second.xml);
    expect(first.xml.hasAttribute('data-keyboard-authoring-snapshot')).toBe(false);
    first.xml.setAttribute('type', 'changed');
    expect(second.xml.getAttribute('type')).toBe('event_whenthisspriteclicked');
    // Scratch may clone its native clipboard between controller lifetimes.
    // The in-memory metadata follows that node without entering pasted XML.
    ScratchBlocks.clipboardXml_ = ScratchBlocks.clipboardXml_.cloneNode(true);
    expect(readClipboardSnapshot(ScratchBlocks).variables).toEqual(second.variables);
    clearClipboardSnapshot(ScratchBlocks);
    expect(readClipboardSnapshot(ScratchBlocks)).toBeNull();
});
