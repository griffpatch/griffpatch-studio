import {JSDOM} from 'jsdom';
import {implicitComparisonChoices, insertImplicitComparison, replaceComparison} from
    '../../../src/experiments/keyboard-authoring/comparison';

const dom = new JSDOM();
global.document = dom.window.document;
afterAll(() => dom.window.close());

const connection = (source, type, check = () => true) => ({
    source,
    type,
    checkType_: check,
    targetConnection: null,
    targetBlock () {
        return this.targetConnection && this.targetConnection.source;
    },
    connect (other) {
        if (this.targetConnection || other.targetConnection) throw new Error('occupied connection');
        this.targetConnection = other;
        other.targetConnection = this;
    },
    disconnect () {
        const other = this.targetConnection;
        if (!other) throw new Error('disconnected connection');
        this.targetConnection = null;
        other.targetConnection = null;
    }
});

const xmlBlock = type => {
    const block = document.createElement('block');
    block.setAttribute('type', type);
    return block;
};

const comparisonInstance = (type = 'operator_equals') => {
    const xml = xmlBlock(type);
    for (const name of ['OPERAND1', 'OPERAND2']) {
        const value = document.createElement('value');
        value.setAttribute('name', name);
        const shadow = document.createElement('shadow');
        shadow.setAttribute('type', 'text');
        const field = document.createElement('field');
        field.setAttribute('name', 'TEXT');
        field.textContent = '50';
        shadow.appendChild(field);
        value.appendChild(shadow);
        xml.appendChild(value);
    }
    const inputList = ['OPERAND1', 'OPERAND2'].map(name => ({
        name,
        connection: {type: 1, checkType_: output => ['String', 'Number'].includes(output.type)}
    }));
    return {inputs: [null, null], typeInfo: {
        domForm: xml,
        inputs: [{inputIdx: 0}, {inputIdx: 1}],
        shape: {canBeRound: true},
        category: {name: 'operators'},
        workspaceForm: {type, inputList, outputConnection: {type: 'Boolean'}}
    }};
};

const reporterInstance = text => ({text, instance: {typeInfo: {
    shape: {canBeRound: true},
    category: {name: 'variables'},
    workspaceForm: {type: 'data_variable', outputConnection: {type: 'String'}}
}}});

test('a Boolean hole exposes ordinary first-operand choices through one implicit equals shell', () => {
    const anchor = {id: 'if'};
    const destination = connection(anchor, 1, output => output.type === 'Boolean');
    anchor.getInput = () => ({connection: destination});
    const workspace = {getBlockById: () => anchor};
    const position = {kind: 'input', blockId: 'if', inputName: 'CONDITION'};
    const equals = comparisonInstance();
    const choices = implicitComparisonChoices({
        workspace,
        position,
        comparison: () => ({instance: equals, text: 'score ='}),
        matches: [reporterInstance('score')],
        value: 'score',
        search: 'score',
        identityChoices: () => [{kind: 'create-variable', text: 'score', scope: 'local', fits: true}]
    });
    expect(choices.map(choice => [choice.kind, choice.text, choice.comparisonLeft.kind])).toEqual([
        ['comparison-left', 'score', 'block'],
        ['comparison-left', 'score', 'value'],
        ['comparison-left', 'score', 'create-variable']
    ]);
    expect(choices.every(choice => choice.instance === equals && choice.fits)).toBe(true);
});

const reporter = (id, {shadow = false, value = ''} = {}) => {
    const field = {name: 'TEXT', getValue: () => value, setValue: jest.fn()};
    const block = {
        id,
        type: shadow ? 'text' : 'data_variable',
        inputList: [{fieldRow: [field]}],
        isShadow: () => shadow,
        getField: name => name === 'TEXT' && field
    };
    block.outputConnection = connection(block, 2);
    block.dispose = jest.fn(() => {
        if (block.outputConnection.targetConnection) block.outputConnection.disconnect();
    });
    return block;
};

const comparisonBlock = (id, type, left, right) => {
    const block = {id, type, isShadow: () => false, getRelativeToSurfaceXY: () => ({x: 40, y: 60})};
    block.outputConnection = connection(block, 2);
    block.inputList = [left, right].map((child, index) => {
        const input = {name: `OPERAND${index + 1}`, fieldRow: [], connection: connection(block, 1)};
        input.connection.connect(child.outputConnection);
        return input;
    });
    block.dispose = jest.fn(() => {
        for (const input of block.inputList) {
            const child = input.connection.targetBlock();
            if (child && child.isShadow()) child.dispose(false);
        }
        if (block.outputConnection.targetConnection) block.outputConnection.disconnect();
    });
    return block;
};

const scratchBlocks = replacement => {
    let group = '';
    return {
        Events: {
            getGroup: () => group,
            setGroup: value => {
                group = value === true ? 'comparison-group' : value;
            }
        },
        Xml: {domToBlock: jest.fn(() => replacement)}
    };
};

test('comparison replacement retains an authored reporter and the right literal in one native group', () => {
    const left = reporter('left');
    const oldRight = reporter('old-right', {shadow: true, value: '7'});
    const source = comparisonBlock('old', 'operator_equals', left, oldRight);
    const parent = {};
    const incoming = connection(parent, 1, output => output.type === 'Boolean');
    incoming.connect(source.outputConnection);
    const defaultLeft = reporter('default-left', {shadow: true, value: '50'});
    const newRight = reporter('new-right', {shadow: true, value: '50'});
    const replacement = comparisonBlock('new', 'operator_gt', defaultLeft, newRight);
    replacement.moveBy = jest.fn();
    const workspace = {getBlockById: id => id === source.id && source};
    const onGroup = jest.fn();
    const result = replaceComparison({
        ScratchBlocks: scratchBlocks(replacement),
        workspace,
        sourceBlockId: source.id,
        instance: comparisonInstance('operator_gt'),
        onGroup
    });
    expect(result).toEqual({block: replacement, changed: true});
    expect(incoming.targetBlock()).toBe(replacement);
    expect(replacement.inputList[0].connection.targetBlock()).toBe(left);
    expect(defaultLeft.dispose).toHaveBeenCalledWith(false);
    expect(newRight.getField('TEXT').setValue).toHaveBeenCalledWith('7');
    expect(source.dispose).toHaveBeenCalledWith(false);
    expect(onGroup).toHaveBeenCalledWith('comparison-group');
});

test('comparison replacement retains both authored operand objects and a same-type choice is a no-op', () => {
    const left = reporter('left');
    const right = reporter('right');
    const source = comparisonBlock('old', 'operator_equals', left, right);
    const defaultLeft = reporter('default-left', {shadow: true, value: '50'});
    const defaultRight = reporter('default-right', {shadow: true, value: '50'});
    const replacement = comparisonBlock('new', 'operator_lt', defaultLeft, defaultRight);
    replacement.moveBy = jest.fn();
    const workspace = {getBlockById: id => id === source.id && source};
    const blocks = scratchBlocks(replacement);

    expect(replaceComparison({
        ScratchBlocks: blocks,
        workspace,
        sourceBlockId: source.id,
        instance: comparisonInstance('operator_equals')
    })).toEqual({block: source, changed: false});
    expect(blocks.Xml.domToBlock).not.toHaveBeenCalled();

    replaceComparison({
        ScratchBlocks: blocks,
        workspace,
        sourceBlockId: source.id,
        instance: comparisonInstance('operator_lt')
    });
    expect(replacement.inputList[0].connection.targetBlock()).toBe(left);
    expect(replacement.inputList[1].connection.targetBlock()).toBe(right);
    expect(defaultLeft.dispose).toHaveBeenCalledWith(false);
    expect(defaultRight.dispose).toHaveBeenCalledWith(false);
});

test('creating a variable and its default equality wrapper is one reversible native action', () => {
    const anchor = {id: 'if'};
    const destination = connection(anchor, 1, output => output.type === 'Boolean');
    anchor.getInput = () => ({connection: destination});
    const wrapper = {outputConnection: connection(null, 2)};
    wrapper.outputConnection.source = wrapper;
    wrapper.dispose = jest.fn();
    const created = {name: 'score', type: '', getId: () => 'variable-id'};
    const workspace = {
        getBlockById: () => anchor,
        getVariableById: () => null,
        getVariable: () => null,
        createVariable: jest.fn(() => created),
        deleteVariableById: jest.fn()
    };
    const ScratchBlocks = scratchBlocks(wrapper);
    ScratchBlocks.LIST_VARIABLE_TYPE = 'list';
    ScratchBlocks.utils = {genUid: () => 'variable-id'};
    const vm = {
        editingTarget: {id: 'sprite', isStage: false},
        runtime: {getAllVarNamesOfType: () => []}
    };
    const result = {
        kind: 'comparison-left',
        instance: comparisonInstance(),
        comparisonLeft: {kind: 'create-variable', text: 'score', scope: 'local'},
        fits: true
    };
    insertImplicitComparison({
        ScratchBlocks,
        workspace,
        vm,
        position: {kind: 'input', blockId: 'if', inputName: 'CONDITION'},
        result,
        expectedTargetId: 'sprite'
    });
    expect(destination.targetBlock()).toBe(wrapper);
    expect(workspace.createVariable).toHaveBeenCalledWith('score', '', 'variable-id', true, false);
    const xml = ScratchBlocks.Xml.domToBlock.mock.calls[0][0];
    expect(xml.querySelector('value[name="OPERAND1"] block').getAttribute('type')).toBe('data_variable');
    expect(xml.querySelector('field[name="VARIABLE"]').getAttribute('id')).toBe('variable-id');
});
