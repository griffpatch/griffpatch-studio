import {BlockTypeInfo} from '../../../src/addons/addons/middle-click-popup/BlockTypeInfo';

const fixture = (reversed = false, includesSelf = false, isStage = false) => {
    class FieldDropdown {
        constructor (values) { this.values = values; }
        getOptions () { return this.values; }
    }
    const targets = [['_Stage_', '_stage_'], ['Other', 'Other'], ...includesSelf ? [['Main Cat', 'Main Cat']] : []];
    const property = {fieldRow: [new FieldDropdown([['volume', 'volume']]), {getText: () => 'of'}]};
    const object = {fieldRow: [], connection: {targetBlock: () => ({inputList: [
        {fieldRow: [new FieldDropdown(targets)]}
    ]})}};
    const current = {isStage, getName: () => 'Main Cat', getAllVariableNamesInScopeByType: () => ['score total', 'camelCase']};
    const vm = {editingTarget: current, runtime: {
        getTargetForStage: () => ({getAllVariableNamesInScopeByType: () => ['global total']}),
        getSpriteTargetByName: name => name === 'Main Cat' ? current : {getAllVariableNamesInScopeByType: () => ['other only']}
    }};
    const Blockly = {FieldDropdown, FieldImage: class {}, Msg: new Proxy({}, {get: (_, key) => `localized ${key}`})};
    const source = {id: 'of', type: 'sensing_of', outputConnection: {},
        inputList: reversed ? [object, property] : [property, object]};
    return {targets, types: options => BlockTypeInfo._createBlocks({}, vm, Blockly, x => x, source, {}, options)};
};

test.each([false, true])('self-target completion reuses all properties and local names in native order (reversed %s)', reversed => {
    const {types, targets} = fixture(reversed);
    const original = JSON.stringify(targets);
    const targetIndex = reversed ? 0 : 1;
    const values = result => result.map(type => type.inputs[targetIndex].values[0].value);
    expect(values(types())).toEqual(['_stage_', 'Other']);
    const expanded = types({includeCurrentSprite: true});
    expect(values(expanded)).toEqual(['_stage_', 'Other', 'Main Cat']);
    const properties = expanded[2].inputs[reversed ? 1 : 0].values;
    expect(properties.map(option => option.value)).toEqual(['score total', 'camelCase', 'x position', 'y position',
        'direction', 'costume #', 'costume name', 'size', 'volume']);
    expect(properties.find(option => option.value === 'x position').string).toBe('localized SENSING_OF_XPOSITION');
    expect(expanded[0].inputs[reversed ? 1 : 0].values.map(option => option.value))
        .toEqual(['global total', 'backdrop #', 'backdrop name', 'volume']);
    expect(JSON.stringify(targets)).toBe(original);
});

test('self targets are not duplicated and Stage never acquires sprite-only properties', () => {
    expect(fixture(false, true).types({includeCurrentSprite: true})).toHaveLength(3);
    expect(fixture(false, false, true).types({includeCurrentSprite: true})).toHaveLength(2);
});
