import {JSDOM} from 'jsdom';
import {blockTransformationPlan, rankTransformationChoices, transformBlock, transformationChoice} from
    '../../../src/experiments/keyboard-authoring/block-transform';

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
        if (!other || this.targetConnection || other.targetConnection) throw new Error('occupied connection');
        if (!this.checkType_(other) || !other.checkType_(this)) throw new Error('incompatible connection');
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

const input = (owner, name, type, child = null, check = () => true, checks = null) => {
    const result = {name, fieldRow: [], connection: connection(owner, type, check)};
    result.connection.check_ = checks;
    if (child) result.connection.connect(type === 3 ? child.previousConnection : child.outputConnection);
    return result;
};

const block = ({id, type, output = null, previous = true, next = true, inputs = []}) => {
    const result = {
        id,
        type,
        disabled: false,
        inputList: [],
        isShadow: () => false,
        isDeletable: () => true,
        getRelativeToSurfaceXY: () => ({x: 30, y: 40}),
        moveBy: jest.fn(),
        getInput (name) {
            return this.inputList.find(candidate => candidate.name === name);
        },
        getCommentText: () => null,
        isCollapsed: () => false,
        dispose: jest.fn()
    };
    if (output) result.outputConnection = connection(result, 2);
    if (previous) result.previousConnection = connection(result, 4);
    if (next) result.nextConnection = connection(result, 3);
    result.inputList = inputs.map(spec => input(result, ...spec));
    return result;
};

const reporter = (id, outputType = 'String', shadow = false) => {
    const result = block({id, type: shadow ? 'text' : 'data_variable', output: [outputType],
        previous: false, next: false});
    result.outputConnection.outputType = outputType;
    result.isShadow = () => shadow;
    return result;
};

const statement = id => block({id, type: 'looks_say'});

const instance = (type, inputs, {output = false, previous = true, next = true} = {}) => {
    const xml = document.createElement('block');
    xml.setAttribute('type', type);
    const form = block({id: `${type}-form`, type, output: output ? ['Boolean', 'String', 'Number'] : null,
        previous, next, inputs});
    if (form.outputConnection) form.outputConnection.outputType = output === true ? 'String' : output;
    return {inputs: [], typeInfo: {
        domForm: xml,
        inputs: [],
        shape: {canBeRound: Boolean(output), canStackUp: previous, canStackDown: next},
        category: {name: 'control'},
        workspaceForm: form
    }};
};

const scratchBlocks = replacement => {
    let group = '';
    return {
        Events: {
            getGroup: () => group,
            setGroup: value => {
                group = value === true ? 'transform-group' : value;
            }
        },
        Xml: {domToBlock: jest.fn(() => replacement)}
    };
};

test('if to if-else retains condition, then body and both surrounding stack connections', () => {
    const predicate = reporter('predicate', 'Boolean');
    const body = statement('body');
    const source = block({id: 'if', type: 'control_if', inputs: [
        ['CONDITION', 1, predicate, other => other.outputType === 'Boolean'],
        ['SUBSTACK', 3, body]
    ]});
    const above = statement('above');
    const below = statement('below');
    above.nextConnection.connect(source.previousConnection);
    source.nextConnection.connect(below.previousConnection);
    const targetInstance = instance('control_if_else', [
        ['CONDITION', 1, null, other => other.outputType === 'Boolean'],
        ['SUBSTACK', 3],
        ['SUBSTACK2', 3]
    ]);
    const replacement = block({id: 'if-else', type: 'control_if_else', inputs: [
        ['CONDITION', 1, null, other => other.outputType === 'Boolean'],
        ['SUBSTACK', 3],
        ['SUBSTACK2', 3]
    ]});
    const workspace = {getBlockById: id => id === source.id && source};
    const onGroup = jest.fn();

    const result = transformBlock({ScratchBlocks: scratchBlocks(replacement), workspace,
        sourceBlockId: source.id, instance: targetInstance, onGroup});
    expect(result.block).toBe(replacement);
    expect(result.retainedBlockIds).toEqual(['predicate', 'body']);
    expect(above.nextConnection.targetBlock()).toBe(replacement);
    expect(replacement.nextConnection.targetBlock()).toBe(below);
    expect(replacement.getInput('CONDITION').connection.targetBlock()).toBe(predicate);
    expect(replacement.getInput('SUBSTACK').connection.targetBlock()).toBe(body);
    expect(replacement.getInput('SUBSTACK2').connection.targetBlock()).toBeNull();
    expect(source.dispose).toHaveBeenCalledWith(false);
    expect(onGroup).toHaveBeenCalledWith('transform-group');
});

test('if-else can contract only when its else body is empty', () => {
    const thenBody = statement('then');
    const elseBody = statement('else');
    const source = block({id: 'if-else', type: 'control_if_else', inputs: [
        ['CONDITION', 1], ['SUBSTACK', 3, thenBody], ['SUBSTACK2', 3, elseBody]
    ]});
    const workspace = {getBlockById: id => id === source.id && source};
    const target = instance('control_if', [['CONDITION', 1], ['SUBSTACK', 3]]);
    expect(blockTransformationPlan(workspace, source.id, target)).toBeNull();
    source.getInput('SUBSTACK2').connection.disconnect();
    const plan = blockTransformationPlan(workspace, source.id, target);
    expect(plan.mappings.map(mapping => mapping.childId)).toEqual(['then']);
});

test('an else-only body is never reinterpreted as the then body during contraction', () => {
    const elseBody = statement('else');
    const source = block({id: 'if-else', type: 'control_if_else', inputs: [
        ['CONDITION', 1], ['SUBSTACK', 3], ['SUBSTACK2', 3, elseBody]
    ]});
    const workspace = {getBlockById: id => id === source.id && source};
    const target = instance('control_if', [['CONDITION', 1], ['SUBSTACK', 3]]);
    expect(blockTransformationPlan(workspace, source.id, target)).toBeNull();
});

test('related statement families map a compatible authored reporter even when native input names differ', () => {
    const value = reporter('value');
    const source = block({id: 'say', type: 'looks_say', inputs: [
        ['MESSAGE', 1, value, other => other.outputType === 'String']
    ]});
    const workspace = {getBlockById: id => id === source.id && source};
    const target = instance('looks_think', [
        ['WORDS', 1, null, other => ['String', 'Number'].includes(other.outputType)]
    ]);
    const choice = transformationChoice({workspace, sourceBlockId: source.id,
        result: {instance: target, text: 'think hello', truncated: false}});
    expect(choice).toMatchObject({kind: 'block-transform', fits: true, retainedBlockCount: 1,
        completionText: 'think hello', transformSourceId: 'say'});
    expect(blockTransformationPlan(workspace, source.id, target).mappings[0]).toMatchObject({
        sourceInputName: 'MESSAGE', targetInputName: 'WORDS', childId: 'value'
    });
});

test('matching moves a flexible child aside instead of rejecting a complete compatible mapping', () => {
    const flexible = reporter('flexible');
    const constrained = reporter('constrained', 'Number');
    const source = block({id: 'source', type: 'source', inputs: [
        ['FIRST', 1, flexible], ['SECOND', 1, constrained]
    ]});
    const workspace = {getBlockById: id => id === source.id && source};
    const target = instance('target', [
        ['ONLY_NUMBER', 1, null, other => other.outputType === 'Number'],
        ['ANY_VALUE', 1]
    ]);
    expect(blockTransformationPlan(workspace, source.id, target).mappings).toEqual([
        expect.objectContaining({sourceInputName: 'FIRST', targetInputName: 'ANY_VALUE'}),
        expect.objectContaining({sourceInputName: 'SECOND', targetInputName: 'ONLY_NUMBER'})
    ]);
});

test('a transformation never overwrites an authored target input or drops an external continuation', () => {
    const value = reporter('value');
    const source = block({id: 'source', type: 'looks_say', inputs: [['MESSAGE', 1, value]]});
    const below = statement('below');
    source.nextConnection.connect(below.previousConnection);
    const workspace = {getBlockById: id => id === source.id && source};

    const occupied = instance('occupied', [['MESSAGE', 1]]);
    const valueElement = document.createElement('value');
    valueElement.setAttribute('name', 'MESSAGE');
    valueElement.appendChild(document.createElement('block'));
    occupied.typeInfo.domForm.appendChild(valueElement);
    expect(blockTransformationPlan(workspace, source.id, occupied)).toBeNull();

    const cap = instance('cap', [['MESSAGE', 1]], {next: false});
    expect(blockTransformationPlan(workspace, source.id, cap)).toBeNull();
});

test('ambiguous transformations rank matching native input types before parser order', () => {
    const predicate = reporter('predicate', 'Boolean');
    const source = block({id: 'if', type: 'control_if', inputs: [
        ['CONDITION', 1, predicate, other => other.outputType === 'Boolean', ['Boolean']],
        ['SUBSTACK', 3]
    ]});
    const workspace = {getBlockById: id => id === source.id && source};
    const numeric = transformationChoice({workspace, sourceBlockId: source.id, result: {
        instance: instance('control_repeat', [
            ['TIMES', 1, null, () => true, ['Number']], ['SUBSTACK', 3]
        ]),
        text: 'repeat',
        truncated: false
    }});
    const boolean = transformationChoice({workspace, sourceBlockId: source.id, result: {
        instance: instance('control_repeat_until', [
            ['CONDITION', 1, null, other => other.outputType === 'Boolean', ['Boolean']], ['SUBSTACK', 3]
        ]),
        text: 'repeat until',
        truncated: true
    }});

    expect(numeric.fits).toBe(true);
    expect(boolean).toMatchObject({fits: true, retainedBlockCount: 1});
    expect(boolean.inputAffinity).toBeGreaterThan(numeric.inputAffinity);
    expect(rankTransformationChoices([numeric, boolean], 'repeat')).toEqual([boolean, numeric]);
});
