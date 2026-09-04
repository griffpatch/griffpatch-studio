import {BlockInputEnum, BlockInputString, BlockInstance, BlockShape, BlockTypeInfo, BlockInputType} from
    '../../../src/addons/addons/middle-click-popup/BlockTypeInfo';
import {createVariableCommandParser, createListCommandParser, bindVariableCommand, bindListCommand} from
    '../../../src/experiments/keyboard-authoring/variable-command';

class FieldVariable {
    constructor (type = '') { this.variableType = type; }
    getVariable () { return {type: this.variableType}; }
}
const fixture = (prefix = 'set', suffix = 'to', variableType = '') => {
    const variable = new BlockInputEnum([['my variable', 'old-id']], 0, 0, false);
    const value = new BlockInputString(1, -1, '0');
    const type = {id: 'data_setvariableto', shape: BlockShape.Stack, inputs: [variable, value],
        parts: [prefix, variable, suffix, value],
        workspaceForm: {type: 'data_setvariableto', inputList: [{fieldRow: [new FieldVariable(variableType)]}]},
        createBlock (...inputs) { return new BlockInstance(this, ...inputs); }};
    const parse = createVariableCommandParser([type], {FieldVariable});
    return {parse, type, variable, value};
};

test.each([
    ['set fish', 'fish', '0'],
    ['set fish to', 'fish', '0'],
    ['set fish to 50', 'fish', '50'],
    ['set FISH to -7', 'FISH', '-7'],
    ['set fish count to 50', 'fish count', '50'],
    ['set "fish to fry" to 50', 'fish to fry', '50'],
    ['set "fish & chips" to 50', 'fish & chips', '50']
])('native grammar identifies the variable and argument in %s', (query, name, value) => {
    const f = fixture();
    const choices = f.parse(query);
    expect(choices.length).toBeGreaterThan(0);
    expect(choices[0].variableName).toBe(name);
    expect(choices[0].instance.inputs[1]).toBe(value);
    expect(choices[0].instance.typeInfo).toBe(f.type);
    expect(choices[0].instance.inputs[0]).toBe(f.variable.defaultValue);
});

test('uses localized native command labels instead of recognizing hard-coded English verbs', () => {
    const f = fixture('mettre', 'à');
    expect(f.parse('mettre poisson à 12')[0]).toMatchObject({variableName: 'poisson'});
    expect(f.parse('set fish to 12')).toEqual([]);
});

test.each(['', 'fish', 's fish', 'say set fish', 'set'])('query %j has no explicit declaration prefix', query => {
    expect(fixture().parse(query)).toEqual([]);
});

test.each(['list', 'broadcast_msg'])('does not interpret %s menus as scalar declarations', type => {
    expect(fixture('set', 'to', type).parse('set fish to 50')).toEqual([]);
});

test('binds the accepted native variable identity without editing the parser or its templates', () => {
    const f = fixture();
    const command = f.parse('set fish to 50')[0];
    const instance = bindVariableCommand(command, {name: 'fish', getId: () => 'native-fish-id'});
    expect(instance.typeInfo).toBe(f.type);
    expect(instance.inputs).toEqual([{value: 'native-fish-id', string: 'fish'}, '50']);
    expect(command.instance.inputs[0]).toBe(f.variable.defaultValue);
    expect(f.type.parts[1]).toBe(f.variable);
    expect(f.variable.values).toEqual([{value: 'old-id', string: 'my variable'}]);
});

test('the same native grammar identifies and binds typed list command identities', () => {
    const item = new BlockInputString(0, -1, 'thing');
    const list = new BlockInputEnum([['my list', 'old-list-id']], 1, 0, false);
    const type = {id: 'data_addtolist', shape: BlockShape.Stack, inputs: [item, list],
        parts: ['add', item, 'to', list], workspaceForm: {type: 'data_addtolist', inputList: [
            {fieldRow: []}, {fieldRow: [new FieldVariable('list')]}
        ]}, createBlock (...inputs) { return new BlockInstance(this, ...inputs); }};
    const parse = createListCommandParser([type], {FieldVariable, LIST_VARIABLE_TYPE: 'list'});
    const command = parse('add apple to groceries')[0];
    expect(command.listName).toBe('groceries');
    expect(command.instance.inputs[0]).toBe('apple');
    const instance = bindListCommand(command, {name: 'apple', getId: () => 'native-list-id'});
    expect(instance.inputs[1]).toEqual({value: 'native-list-id', string: 'apple'});
    expect(command.instance.inputs[1]).toBe(list.defaultValue);
});

test('native dropdown descriptors do not depend on rendered CSS classes', () => {
    class FieldDropdown {
        getOptions () { return [['my variable','native-id']]; }
    }
    const dropdown=new FieldDropdown();
    dropdown.className_='blocklyText'; // No SVG view has been initialized.
    const label={getText:()=> 'set'};
    const source={id:'set',category_:'data',nextConnection:{},inputList:[{fieldRow:[label,dropdown]}]};
    const types=BlockTypeInfo._createBlocks({}, {}, {FieldDropdown,FieldImage:class {}}, x=>x,source,{});
    expect(types[0].inputs[0].type).toBe(BlockInputType.ENUM);
    expect(types[0].inputs[0].values).toEqual([{string:'my variable',value:'native-id'}]);
});

test('a proposed name cannot be consumed as a reporter from another sprite', () => {
    const f=fixture();
    const reporter={id:'other-variable',shape:BlockShape.Round,parts:['fish'],inputs:[],
        createBlock (...inputs) { return new BlockInstance(this,...inputs); }};
    const parse=createVariableCommandParser([f.type,reporter],{FieldVariable});
    const choices=parse('set fish to fish');
    expect(choices[0].variableName).toBe('fish');
    expect(choices[0].instance.inputs[1]).toBeInstanceOf(BlockInstance);
    expect(choices[0].instance.inputs[1].typeInfo).toBe(reporter);
});

test('a complete numeric value ranks before a partially matched reporter in a new-variable command', () => {
    const f=fixture();
    const number=new BlockInputString(0,-1,'');
    const power={id:'operator_mathop',shape:BlockShape.Round,parts:['10 ^','of',number],inputs:[number],
        createBlock (...inputs) { return new BlockInstance(this,...inputs); }};
    const parse=createVariableCommandParser([f.type,power],{FieldVariable});
    for(const value of ['1','10']) expect(parse(`set score to ${value}`)[0].instance.inputs[1]).toBe(value);
    expect(parse('set score to 10 ^ of 2')[0].instance.inputs[1].typeInfo).toBe(power);
});
