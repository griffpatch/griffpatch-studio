import {canWrapStatementRange, restoreWrappedStatementRange, wrapStatementRange} from
    '../../../src/experiments/keyboard-authoring/block-range-wrap';
import {rangeFor} from '../../../src/experiments/keyboard-authoring/block-range';
import {JSDOM} from 'jsdom';

const dom = new JSDOM();
global.document = dom.window.document;

const connection = (source, type) => ({
    source,
    type,
    targetConnection: null,
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

const command = (id, {up = true, down = true, x = 20, y = 40} = {}) => {
    const item = {
        id,
        outputConnection: null,
        previousConnection: null,
        nextConnection: null,
        inputList: [],
        xy: {x, y},
        isShadow: () => false,
        getRelativeToSurfaceXY () {
            return {...this.xy};
        },
        moveBy (dx, dy) {
            this.xy = {x: this.xy.x + dx, y: this.xy.y + dy};
        }
    };
    if (up) item.previousConnection = connection(item, 4);
    if (down) item.nextConnection = connection(item, 3);
    item.getPreviousBlock = () => item.previousConnection && item.previousConnection.targetBlock();
    item.getNextBlock = () => item.nextConnection && item.nextConnection.targetBlock();
    item.getParent = item.getPreviousBlock;
    return item;
};

const wrapper = (id = 'wrapper', {down = true, mouths = ['SUBSTACK']} = {}) => {
    const item = command(id, {down});
    item.inputs = new Map(mouths.map(name => [name, {name, connection: connection(item, 3)}]));
    item.inputList = Array.from(item.inputs.values());
    item.getInput = name => item.inputs.get(name);
    item.dispose = jest.fn();
    item.getDescendants = () => [item];
    return item;
};

const instance = ({down = true, mouths = ['SUBSTACK'], filled = []} = {}) => {
    const xml = document.createElement('block');
    xml.setAttribute('type', 'control_repeat');
    mouths.forEach(name => {
        const statement = document.createElement('statement');
        statement.setAttribute('name', name);
        if (filled.includes(name)) statement.appendChild(document.createElement('block'));
        xml.appendChild(statement);
    });
    return {inputs: [], typeInfo: {
        domForm: xml,
        inputs: [],
        shape: {canStackUp: true, canStackDown: down, canBeRound: false},
        workspaceForm: {
            type: 'control_repeat',
            inputList: mouths.map(name => ({name, connection: {type: 3}}))
        }
    }};
};

const graph = ids => {
    const blocks = ids.map((id, index) => command(id, {y: 40 + (index * 32)}));
    blocks.slice(0, -1).forEach((item, index) => item.nextConnection.connect(blocks[index + 1].previousConnection));
    const all = [...blocks];
    return {blocks, all, workspace: {getBlockById: id => all.find(item => item.id === id)}};
};

const chain = root => {
    const result = [];
    for (let current = root; current; current = current.getNextBlock()) result.push(current.id);
    return result;
};

const scratchBlocks = created => {
    let group = 'outer';
    return {
        Events: {
            getGroup: () => group,
            setGroup: value => {
                group = value === true ? 'wrap-group' : value;
            }
        },
        Xml: {domToBlock: jest.fn(() => created)}
    };
};

test('wraps a middle sibling range while retaining both neighbours and selected identities', () => {
    const {blocks, all, workspace} = graph(['a', 'b', 'c', 'd']);
    const actor = wrapper();
    all.push(actor);
    const onGroup = jest.fn();
    const result = wrapStatementRange({
        ScratchBlocks: scratchBlocks(actor),
        workspace,
        range: rangeFor(workspace, 'b', 'c'),
        instance: instance(),
        onGroup
    });
    expect(chain(blocks[0])).toEqual(['a', 'wrapper', 'd']);
    expect(chain(actor.getInput('SUBSTACK').connection.targetBlock())).toEqual(['b', 'c']);
    expect(result).toEqual({block: actor, blockIds: ['b', 'c'], inputName: 'SUBSTACK'});
    expect(onGroup).toHaveBeenCalledWith('wrap-group');
});

test('keeps a top-level selection at its original coordinate', () => {
    const {blocks, all, workspace} = graph(['b', 'c']);
    const original = blocks[0].getRelativeToSurfaceXY();
    const actor = wrapper();
    all.push(actor);
    wrapStatementRange({ScratchBlocks: scratchBlocks(actor), workspace,
        range: rangeFor(workspace, 'b', 'c'), instance: instance()});
    expect(actor.getRelativeToSurfaceXY()).toEqual(original);
    expect(chain(actor)).toEqual(['wrapper']);
    expect(chain(actor.getInput('SUBSTACK').connection.targetBlock())).toEqual(['b', 'c']);
});

test('restores a wrapped preview for another candidate without replacing retained blocks', () => {
    const {blocks, all, workspace} = graph(['a', 'b', 'c', 'd']);
    const actor = wrapper();
    all.push(actor);
    const range = rangeFor(workspace, 'b', 'c');
    const result = wrapStatementRange({ScratchBlocks: scratchBlocks(actor), workspace, range, instance: instance()});
    restoreWrappedStatementRange({workspace, wrapper: result.block, range, inputName: result.inputName});
    expect(chain(blocks[0])).toEqual(['a', 'b', 'c', 'd']);
    expect(blocks.map(item => workspace.getBlockById(item.id))).toEqual(blocks);
    expect(actor.dispose).toHaveBeenCalledWith(false);
});

test('wraps a leading C-mouth range without crossing its structural owner', () => {
    const {blocks, all, workspace} = graph(['b', 'c', 'd']);
    const owner = wrapper('owner');
    owner.nextConnection = null;
    owner.getNextBlock = () => null;
    owner.getInput('SUBSTACK').connection.connect(blocks[0].previousConnection);
    const actor = wrapper();
    all.push(owner, actor);
    wrapStatementRange({ScratchBlocks: scratchBlocks(actor), workspace,
        range: rangeFor(workspace, 'b', 'c'), instance: instance()});
    expect(owner.getInput('SUBSTACK').connection.targetBlock()).toBe(actor);
    expect(chain(actor)).toEqual(['wrapper', 'd']);
    expect(chain(actor.getInput('SUBSTACK').connection.targetBlock())).toEqual(['b', 'c']);
});

test('uses the first empty mouth and rejects shapes that cannot preserve the boundary', () => {
    const {workspace} = graph(['a', 'b', 'c']);
    const range = rangeFor(workspace, 'a', 'b');
    expect(canWrapStatementRange(workspace, range,
        instance({mouths: ['SUBSTACK', 'SUBSTACK2'], filled: ['SUBSTACK']}))).toBe(true);
    expect(canWrapStatementRange(workspace, range, instance({down: false}))).toBe(false);
    expect(canWrapStatementRange(workspace, range, instance({filled: ['SUBSTACK']}))).toBe(false);
    expect(canWrapStatementRange(workspace, {anchorBlockId: 'a', focusBlockId: 'c', blockIds: ['a', 'c']},
        instance())).toBe(false);
});
