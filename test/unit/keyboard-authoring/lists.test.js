import {JSDOM} from 'jsdom';
import {createListCompletion, explicitListName, listReporterXml} from
    '../../../src/experiments/keyboard-authoring/lists';

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
    const model = (name, local = false, id = name) => ({name, type: 'list', isLocal: local, getId: () => id});
    class FieldVariable {
        constructor (variable) { this.name = 'LIST'; this.EDITABLE = true; this.variable = variable; }
        isCurrentlyEditable () { return true; }
        getVariable () { return this.variable; }
        getValue () { return this.variable.getId(); }
        setValue (id) { this.variable = models.find(item => item.getId() === id); }
    }
    const original = model('old list'); models.push(original);
    const field = new FieldVariable(original);
    const connection = {type: 1, targetBlock: () => null, checkType_: () => true, connect: jest.fn()};
    const anchor = {inputList: [{fieldRow: [field]}], getInput: () => ({connection})};
    const createdBlock = {outputConnection: {}, moveBy: jest.fn(), dispose: jest.fn()};
    const workspace = {
        getBlockById: id => id === 'anchor' ? anchor : null,
        getVariable: (name, type) => models.find(item => item.name === name && item.type === type),
        getVariableById: id => models.find(item => item.getId() === id),
        getVariablesOfType: type => models.filter(item => item.type === type),
        createVariable: jest.fn((name, type, id, local) => {
            const item = model(name, local, id || `new:${name}`); models.push(item); return item;
        }),
        deleteVariableById: jest.fn()
    };
    const vm = {editingTarget: {id: 'sprite'}, runtime: {getAllVarNamesOfType: () => models.map(item => item.name)}};
    let group = '';
    const ScratchBlocks = {LIST_VARIABLE_TYPE: 'list', FieldVariable, utils: {genUid: () => 'new-block'},
        Workspace: jest.fn(() => ({newBlock: () => createdBlock, dispose: jest.fn()})),
        Events: {disable: jest.fn(), enable: jest.fn(), getGroup: () => group,
            setGroup: jest.fn(value => { group = value; })},
        Xml: {domToBlock: jest.fn(() => createdBlock)}};
    return {models, field, connection, workspace, vm, ScratchBlocks,
        completion: createListCompletion({workspace, ScratchBlocks, vm})};
};

test.each([['list groceries','groceries'], ['create list groceries','groceries'], [' groceries ',null]])(
    'explicit list declaration query %j resolves to %j', (query, expected) => {
        expect(explicitListName(query)).toBe(expected);
    });

test('list reporter XML preserves its native list identity', () => {
    const xml = listReporterXml({name: 'groceries & snacks', getId: () => 'list-id'}, 'block-id');
    expect(xml.getAttribute('type')).toBe('data_listcontents');
    expect(xml.getAttribute('id')).toBe('block-id');
    expect(xml.querySelector('field').getAttribute('name')).toBe('LIST');
    expect(xml.querySelector('field').getAttribute('id')).toBe('list-id');
    expect(xml.querySelector('field').getAttribute('variabletype')).toBe('list');
    expect(xml.querySelector('field').textContent).toBe('groceries & snacks');
});

test('loose list creation requires an explicit prefix and offers both scopes without allocation', () => {
    const f = fixture();
    const at = {kind: 'workspace', x: 20, y: 30};
    expect(f.completion.choices(at, 'groceries', 'local')).toEqual([]);
    expect(f.completion.choices(at, 'list groceries', 'local').map(choice => [choice.kind, choice.listName,
        choice.scope])).toEqual([
        ['create-list', 'groceries', 'local'], ['create-list', 'groceries', 'global']
    ]);
    expect(f.workspace.createVariable).not.toHaveBeenCalled();
});

test('a typed list dropdown accepts a bare new name while other variable types remain excluded', () => {
    const f = fixture();
    const at = {kind: 'field', blockId: 'anchor', fieldName: 'LIST'};
    expect(f.completion.choices(at, 'shopping', 'global').map(choice => choice.scope)).toEqual(['global', 'local']);
    f.field.variable = {name: 'score', type: '', getId: () => 'score'};
    expect(f.completion.choices(at, 'shopping', 'global')).toEqual([]);
});

test('creating a loose list reporter is one native group with the chosen scope and identity', () => {
    const f = fixture();
    const at = {kind: 'workspace', x: 20, y: 30};
    const choice = f.completion.choices(at, 'list groceries', 'local')[0];
    expect(f.completion.apply(at, choice, 'sprite')).toBeDefined();
    expect(f.models.find(item => item.name === 'groceries')).toMatchObject({type: 'list', isLocal: true});
    const xml = f.ScratchBlocks.Xml.domToBlock.mock.calls[0][0];
    expect(xml.querySelector('field').getAttribute('id')).toBe('new:groceries');
    expect(f.connection.connect).not.toHaveBeenCalled();
});

test('list reporter replacement cannot evict a child other than the explicit selection', () => {
    const f = fixture();
    const child = {id: 'selected', isShadow: () => false, dispose: jest.fn()};
    f.connection.targetBlock = () => child;
    expect(f.completion.choices({kind: 'input', blockId: 'anchor', inputName: 'VALUE'},
        'list old list', 'local')).toEqual([]);
    const position = {kind: 'input', blockId: 'anchor', inputName: 'VALUE'};
    const choice = f.completion.choices(position, 'list old list', 'local', child.id)[0];
    expect(f.completion.apply(position, choice, 'sprite', child.id)).toBeDefined();
    expect(child.dispose).toHaveBeenCalledWith(false);
    expect(f.connection.connect).toHaveBeenCalled();
});
