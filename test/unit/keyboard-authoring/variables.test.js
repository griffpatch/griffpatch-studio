import {JSDOM} from 'jsdom';
import {canCreateVariable, createVariableCompletion, scopeOrder, variableReporterXml} from
    '../../../src/experiments/keyboard-authoring/variables';
import {BlockInstance, BlockInputType, BlockShape} from
    '../../../src/addons/addons/middle-click-popup/BlockTypeInfo';

const dom = new JSDOM('');
const previousDocument = global.document;
beforeAll(() => { global.document = dom.window.document; });
afterAll(() => {
    if (typeof previousDocument === 'undefined') delete global.document;
    else global.document = previousDocument;
    dom.window.close();
});

const fixture = () => {
    const models = [];
    const model = (name, local = false, type = '', id = name) => ({name, type, isLocal: local, getId: () => id});
    const connection = {type: 1, targetBlock: () => null,
        checkType_: other => other.check_.includes('String'), connect: jest.fn()};
    class FieldVariable {
        constructor (variable) {
            this.name = 'VARIABLE'; this.EDITABLE = true; this.variable = variable;
        }
        isCurrentlyEditable () { return true; }
        getVariable () { return this.variable; }
        getValue () { return this.variable.getId(); }
        setValue (id) { this.variable = models.find(v => v.getId() === id); }
    }
    const original = model('old'); models.push(original);
    const field = new FieldVariable(original);
    const anchor = {inputList: [{fieldRow: [field]}], getInput: () => ({connection})};
    const createdBlock = {outputConnection: {check_: ['String', 'Number']}, moveBy: jest.fn(), dispose: jest.fn()};
    const workspace = {
        getBlockById: id => id === 'anchor' ? anchor : null,
        getVariable: (name, type) => models.find(v => v.name === name && v.type === type),
        getVariableById: id => models.find(v => v.getId() === id),
        getVariablesOfType: type => models.filter(v => v.type === type),
        createVariable: jest.fn((name, type, id, local) => {
            const variable = model(name, local, type, id || `new:${name}`);
            models.push(variable); return variable;
        }),
        deleteVariableById: jest.fn(id => { models.splice(models.findIndex(v => v.getId() === id), 1); })
    };
    const vm = {editingTarget: {id: 'sprite'}, runtime: {getAllVarNamesOfType: () => models.map(v => v.name)}};
    let group = 'previous';
    const disposeProbe = jest.fn();
    const ScratchBlocks = {FieldVariable, utils: {genUid: () => 'new-block'},
        Workspace: jest.fn(() => ({newBlock: () => createdBlock, dispose: disposeProbe})),
        Events: {disable: jest.fn(), enable: jest.fn(), getGroup: () => group, setGroup: jest.fn(value => { group = value; })},
        Xml: {domToBlock: jest.fn(() => createdBlock)}};
    const completion = createVariableCompletion({workspace, ScratchBlocks, vm});
    return {workspace, vm, ScratchBlocks, completion, models, model, connection, field, createdBlock, disposeProbe};
};
const input = {kind: 'input', blockId: 'anchor', inputName: 'VALUE'};
const dropdown = {kind: 'field', blockId: 'anchor', fieldName: 'VARIABLE'};

test('reporter XML preserves the native identity and literal name for both preview and accepted blocks', () => {
    const variable = {name: 'cake & "icing" <label>', getId: () => 'variable-id'};
    const preview = variableReporterXml(variable);
    const accepted = variableReporterXml(variable, 'accepted-block');
    for (const xml of [preview, accepted]) {
        expect(xml.getAttribute('type')).toBe('data_variable');
        expect(xml.querySelector('field').getAttribute('id')).toBe('variable-id');
        expect(xml.querySelector('field').textContent).toBe(variable.name);
        expect(xml.querySelectorAll('label')).toHaveLength(0);
    }
    expect(preview.hasAttribute('id')).toBe(false);
    expect(accepted.getAttribute('id')).toBe('accepted-block');
});

test.each([['cake','local'],['SCORE','global'],['Score','local'],['x2','local'],['99','local'],['蛋糕','local'],
    ['ÉTAT','global'],['a','global','global'],['ABC','local','local']]
    .map(([name, first, preference]) => ({name, first, preference})))(
    'scope ordering for $name promotes $first with preference $preference but allows the other scope',
    ({name, first, preference}) => {
        expect(scopeOrder(name, preference)).toEqual([first, first === 'local' ? 'global' : 'local']);
    });

test('native probe is disposed and events balanced without touching the live variable map', () => {
    const f = fixture();
    expect(f.disposeProbe).toHaveBeenCalledTimes(1);
    expect(f.ScratchBlocks.Events.disable).toHaveBeenCalledTimes(1);
    expect(f.ScratchBlocks.Events.enable).toHaveBeenCalledTimes(1);
    expect(f.workspace.createVariable).not.toHaveBeenCalled();
    expect(f.models.map(v => v.name)).toEqual(['old']);
});

test('native exact-case conflict rules and global conflicts across all sprites are preserved', () => {
    const f = fixture();
    expect(canCreateVariable(f.workspace, f.vm, 'old', 'local')).toBe(false);
    expect(canCreateVariable(f.workspace, f.vm, 'OLD', 'global')).toBe(true);
    f.vm.runtime.getAllVarNamesOfType = () => ['other-sprite-local'];
    expect(canCreateVariable(f.workspace, f.vm, 'other-sprite-local', 'global')).toBe(false);
    expect(canCreateVariable(f.workspace, f.vm, 'other-sprite-local', 'local')).toBe(true);
    f.vm.editingTarget.isStage = true;
    expect(canCreateVariable(f.workspace, f.vm, 'new', 'local')).toBe(false);
    expect(canCreateVariable(f.workspace, f.vm, 'new', 'global')).toBe(true);
});

test('scope-labelled existing scalar variables precede explicit declarations, excluding lists', () => {
    const f = fixture();
    f.models.push(f.model('gold', true), f.model('older list', false, 'list'));
    expect(f.completion.choices(input, 'old', 'local')).toEqual([
        {kind: 'variable', text: 'old', variableId: 'old', scope: 'global', fits: true},
        {kind: 'variable', text: 'gold', variableId: 'gold', scope: 'local', fits: true}
    ]);
    const choices = f.completion.choices(input, 'new name', 'uppercase');
    expect(choices.map(c => [c.kind, c.text, c.scope])).toEqual([
        ['create-variable', 'new name', 'local'], ['create-variable', 'new name', 'global']]);
    expect(f.workspace.createVariable).not.toHaveBeenCalled();
});

test.each(['', '  ', '42', '-7', '1.5', '1 + 2', '(x)', '<x>', 'a\nb'])(
    'query %j is not a suggested variable declaration', query => {
        expect(fixture().completion.choices(input, query).some(c => c.kind === 'create-variable')).toBe(false);
    });

test('native connection checks reject Boolean slots, statements, and occupied reporters', () => {
    const f = fixture();
    expect(f.completion.acceptsAt(input)).toBe(true);
    f.connection.checkType_ = other => other.check_.includes('Boolean');
    expect(f.completion.choices(input, 'cake')).toEqual([]);
    f.connection.checkType_ = () => true;
    f.connection.type = 3;
    expect(f.completion.choices(input, 'cake')).toEqual([]);
    f.connection.type = 1;
    f.connection.targetBlock = () => ({isShadow: () => false});
    expect(f.completion.choices(input, 'cake')).toEqual([]);
});

test('variable replacement requires and revalidates the explicitly selected reporter identity', () => {
    const f = fixture();
    const child = {id: 'selected', isShadow: () => false, dispose: jest.fn()};
    f.connection.targetBlock = () => child;
    expect(f.completion.choices(input, 'old')).toEqual([]);
    expect(f.completion.choices(input, 'old', 'local', 'other')).toEqual([]);
    const choice = f.completion.choices(input, 'old', 'local', child.id)[0];
    expect(f.completion.apply(input, choice, 'sprite', child.id)).toBe(f.createdBlock);
    expect(child.dispose).toHaveBeenCalledWith(false);
    expect(f.connection.connect).toHaveBeenCalledWith(f.createdBlock.outputConnection);
});

test('scalar variable fields support creation but broadcast and list fields keep their native editors', () => {
    const f = fixture();
    expect(f.completion.acceptsAt(dropdown)).toBe(true);
    f.field.variable = f.model('message', false, 'broadcast_msg');
    expect(f.completion.acceptsAt(dropdown)).toBe(false);
    f.field.variable = f.model('items', false, 'list');
    expect(f.completion.acceptsAt(dropdown)).toBe(false);
});

test('creation plus field use shares the native group and retains exact spelling', () => {
    const f = fixture();
    const choice = f.completion.choices(dropdown, '  cake & "icing"  ')[0];
    expect(f.completion.apply(dropdown, choice, 'sprite')).toBeNull();
    expect(f.field.getVariable()).toMatchObject({name: 'cake & "icing"', isLocal: true});
    expect(f.ScratchBlocks.Events.setGroup.mock.calls).toEqual([[true], ['previous']]);
    expect(f.ScratchBlocks.Xml.domToBlock).not.toHaveBeenCalled();
});

test('existing variables use their ID without allocation, and reporters use native XML and placement', () => {
    const f = fixture();
    const choice = f.completion.choices(input, 'old')[0];
    expect(f.completion.apply(input, choice, 'sprite')).toBe(f.createdBlock);
    const xml = f.ScratchBlocks.Xml.domToBlock.mock.calls[0][0];
    expect(xml.getAttribute('id')).toBe('new-block');
    expect(xml.querySelector('field').getAttribute('id')).toBe('old');
    expect(f.workspace.createVariable).not.toHaveBeenCalled();
    expect(f.connection.connect).toHaveBeenCalledWith(f.createdBlock.outputConnection);
});

test('commit revalidates the editing target, variable identity and connection before mutation', () => {
    const f = fixture();
    const choice = f.completion.choices(input, 'new')[0];
    expect(() => f.completion.apply(input, choice, 'other-sprite')).toThrow('destination');
    f.models.push(f.model('new'));
    expect(() => f.completion.apply(input, choice, 'sprite')).toThrow('choices');
    f.connection.targetBlock = () => ({isShadow: () => false});
    expect(() => f.completion.apply(input, choice, 'sprite')).toThrow('destination');
    expect(f.workspace.createVariable).not.toHaveBeenCalled();
});

test('a failed native import compensates only its newly created variable and restores event ownership', () => {
    const f = fixture();
    f.ScratchBlocks.Xml.domToBlock.mockImplementation(() => { throw new Error('Import failed'); });
    expect(() => f.completion.apply(input, f.completion.choices(input, 'new')[0], 'sprite')).toThrow('Import failed');
    expect(f.models.map(v => v.name)).toEqual(['old']);
    expect(f.workspace.deleteVariableById).toHaveBeenCalledWith('new:new');
    expect(f.ScratchBlocks.Events.getGroup()).toBe('previous');
});

const command = () => ({variableName:'fish', variableInput:0, scope:'local', kind:'create-variable-command',
    instance:new BlockInstance({shape:BlockShape.Stack,
        domForm:new dom.window.DOMParser().parseFromString('<block type="data_setvariableto">' +
            '<field name="VARIABLE" id="old">old</field></block>','text/xml').documentElement,
        workspaceForm:{inputList:[{name:'VARIABLE'}]},
        inputs:[{type:BlockInputType.ENUM,inputIdx:0,fieldIdx:0,getField:()=>({name:'VARIABLE'})}]
    },{value:'old',string:'old'})});
const loose = {kind:'workspace', x:24, y:48};

test('command choices use native destination and scope checks and do not allocate anything', () => {
    const f=fixture(), candidate=command();
    expect(f.completion.commandChoices(loose,[candidate],'uppercase').map(c=>c.scope)).toEqual(['local','global']);
    expect(f.completion.commandChoices(input,[candidate],'uppercase')).toEqual([]);
    f.vm.runtime.getAllVarNamesOfType=()=>['fish'];
    expect(f.completion.commandChoices(loose,[candidate],'uppercase').map(c=>c.scope)).toEqual(['local']);
    f.vm.editingTarget.isStage=true;
    expect(f.completion.commandChoices(loose,[candidate],'uppercase')).toEqual([]);
    expect(f.workspace.createVariable).not.toHaveBeenCalled();
});

test('command acceptance binds its newly created native identity in one event group', () => {
    const f=fixture(), onGroup=jest.fn();
    f.ScratchBlocks.utils.genUid=jest.fn().mockReturnValueOnce('new-block').mockReturnValueOnce('new-variable');
    const completion=createVariableCompletion({...f,onGroup});
    const candidate=command();
    candidate.instance.typeInfo.inputs[0].getField=()=>{
        if(f.workspace.createVariable.mock.calls.length) throw Error('Flyout has been refreshed');
        return {name:'VARIABLE'};
    };
    expect(completion.applyCommand(loose,candidate,'sprite')).toBe(f.createdBlock);
    const xml=f.ScratchBlocks.Xml.domToBlock.mock.calls[0][0];
    expect(xml.querySelector('field').getAttribute('id')).toBe('new-variable');
    expect(xml.querySelector('field').textContent).toBe('fish');
    expect(xml.getAttribute('id')).toBe('new-block');
    expect(f.createdBlock.moveBy).toHaveBeenCalledWith(24,48);
    expect(onGroup).toHaveBeenCalledTimes(1);
    expect(f.ScratchBlocks.Events.setGroup.mock.calls).toEqual([[true],['previous']]);
});

test('command acceptance revalidates target, scope and name before any mutation', () => {
    const f=fixture(), candidate=command();
    expect(()=>f.completion.applyCommand(loose,candidate,'other-sprite')).toThrow('changed');
    expect(()=>f.completion.applyCommand(input,candidate,'sprite')).toThrow('changed');
    f.models.push(f.model('fish'));
    expect(()=>f.completion.applyCommand(loose,candidate,'sprite')).toThrow('changed');
    expect(f.workspace.createVariable).not.toHaveBeenCalled();
    expect(f.ScratchBlocks.Xml.domToBlock).not.toHaveBeenCalled();
});

test('failed command placement compensates the owned command with tail healing, not tail deletion', () => {
    const f=fixture();
    f.ScratchBlocks.utils.genUid=jest.fn().mockReturnValueOnce('new-block').mockReturnValueOnce('new-variable');
    f.createdBlock.moveBy.mockImplementation(()=>{throw Error('Native placement failed');});
    f.workspace.getBlockById=id=>id==='new-block'?f.createdBlock:null;
    expect(()=>f.completion.applyCommand(loose,command(),'sprite')).toThrow('Native placement failed');
    expect(f.createdBlock.dispose).toHaveBeenCalledWith(true);
    expect(f.workspace.deleteVariableById).toHaveBeenCalledWith('new-variable');
    expect(f.models.map(v=>v.name)).toEqual(['old']);
    expect(f.ScratchBlocks.Events.getGroup()).toBe('previous');
});
