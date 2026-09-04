import {JSDOM} from 'jsdom';
import {canWrapExpression, restoreWrappedExpression, wrapExpression} from
    '../../../src/experiments/keyboard-authoring/expression-wrap';

const dom = new JSDOM();
global.document = dom.window.document;
afterAll(() => dom.window.close());

const connection = (source, type, check = () => true) => ({
    source,
    type,
    targetConnection: null,
    checkType_: check,
    getSourceBlock () {
        return this.source;
    },
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

const reporter = (id, {shadow = false} = {}) => {
    const block = {id, isShadow: () => shadow};
    block.outputConnection = connection(block, 2);
    block.dispose = jest.fn(() => {
        if (block.outputConnection.targetConnection) block.outputConnection.disconnect();
    });
    return block;
};

const candidate = ({nested = false, accepts = () => true} = {}) => {
    const xml = document.createElement('block');
    xml.setAttribute('type', 'operator_add');
    const first = document.createElement('value');
    first.setAttribute('name', 'NUM1');
    first.appendChild(document.createElement(nested ? 'block' : 'shadow'));
    xml.appendChild(first);
    return {inputs: [], typeInfo: {
        domForm: xml,
        inputs: [],
        shape: {canBeRound: true},
        workspaceForm: {
            outputConnection: {type: 'Number'},
            inputList: [{name: 'NUM1', connection: {type: 1, checkType_: accepts}}]
        }
    }};
};

const wrapper = () => {
    const block = reporter('wrapper');
    const input = {name: 'NUM1', connection: connection(block, 1)};
    const shadow = reporter('default', {shadow: true});
    input.connection.connect(shadow.outputConnection);
    block.getInput = name => name === 'NUM1' && input;
    block.dispose = jest.fn(() => {
        if (block.outputConnection.targetConnection) block.outputConnection.disconnect();
    });
    return {block, input, shadow};
};

const scratchBlocks = actor => {
    let group = '';
    return {
        Events: {
            getGroup: () => group,
            setGroup: value => {
                group = value === true ? 'expression-group' : value;
            }
        },
        Xml: {domToBlock: jest.fn(() => actor)}
    };
};

test('wraps a connected reporter while retaining its object and one native event group', () => {
    const parent = {}, incoming = connection(parent, 1);
    const source = reporter('source');
    incoming.connect(source.outputConnection);
    const {block: actor, input, shadow} = wrapper();
    const workspace = {getBlockById: id => id === source.id && source};
    const onGroup = jest.fn();
    const result = wrapExpression({
        ScratchBlocks: scratchBlocks(actor),
        workspace,
        sourceBlockId: source.id,
        instance: candidate(),
        onGroup
    });
    expect(result).toEqual({block: actor, sourceBlockId: source.id, inputName: 'NUM1'});
    expect(incoming.targetBlock()).toBe(actor);
    expect(input.connection.targetBlock()).toBe(source);
    expect(shadow.dispose).toHaveBeenCalledWith(false);
    expect(onGroup).toHaveBeenCalledWith('expression-group');

    restoreWrappedExpression({wrapper: actor, sourceBlockId: source.id, inputName: 'NUM1', incoming});
    expect(incoming.targetBlock()).toBe(source);
    expect(actor.dispose).toHaveBeenCalledWith(false);
});

test('uses only compatible default inputs and never overwrites parsed nested content', () => {
    const parent = {}, incoming = connection(parent, 1);
    const source = reporter('source');
    incoming.connect(source.outputConnection);
    const workspace = {getBlockById: () => source};
    expect(canWrapExpression(workspace, source.id, candidate())).toBe(true);
    expect(canWrapExpression(workspace, source.id, candidate({nested: true}))).toBe(false);
    expect(canWrapExpression(workspace, source.id, candidate({accepts: () => false}))).toBe(false);
});

test('requires the selected reporter to still own its parent value connection', () => {
    const source = reporter('source');
    const workspace = {getBlockById: () => source};
    expect(canWrapExpression(workspace, source.id, candidate())).toBe(false);
});
