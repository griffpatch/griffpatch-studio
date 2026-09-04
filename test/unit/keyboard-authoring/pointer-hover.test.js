import {blockAtPointerTarget, updateBlockHover} from
    '../../../src/experiments/keyboard-authoring/pointer-hover';

const makeClassList = initial => {
    const values = new Set(initial);
    return {
        add: value => values.add(value),
        remove: value => values.delete(value),
        contains: value => values.has(value)
    };
};

const makeRoot = (id, parent) => {
    const attributes = new Map([['data-id', id]]);
    const root = {
        parent,
        classList: makeClassList(['blocklyDraggable']),
        getAttribute: name => attributes.get(name) || null,
        setAttribute: (name, value) => attributes.set(name, value),
        removeAttribute: name => attributes.delete(name)
    };
    const closest = function (selector) {
        let node = this;
        while (node) {
            if (selector === 'g.blocklyDraggable' && node.classList?.contains('blocklyDraggable')) return node;
            node = node.parent;
        }
        return null;
    };
    root.closest = closest;
    const child = {parent: root, closest};
    return {root, child};
};

test('resolves the exact nested Blockly group under the pointer', () => {
    const canvas = {contains: node => {
        for (let current = node; current; current = current.parent) if (current === canvas) return true;
        return false;
    }};
    const outer = makeRoot('outer', canvas);
    const inner = makeRoot('inner', outer.root);
    const blocks = [
        {id: 'outer', getSvgRoot: () => outer.root},
        {id: 'inner', getSvgRoot: () => inner.root}
    ];
    const workspace = {
        getCanvas: () => canvas,
        getBlockById: id => blocks.find(block => block.id === id),
        getAllBlocks: () => blocks
    };
    expect(blockAtPointerTarget(workspace, inner.child)).toBe(blocks[1]);
    expect(blockAtPointerTarget(workspace, outer.child)).toBe(blocks[0]);
});

test('falls back to root identity and moves one presentation class without changing block state', () => {
    const canvas = {contains: node => {
        for (let current = node; current; current = current.parent) if (current === canvas) return true;
        return false;
    }};
    const firstRoot = makeRoot('stale-id', canvas);
    const secondRoot = makeRoot('second', canvas);
    const first = {getSvgRoot: () => firstRoot.root};
    const second = {getSvgRoot: () => secondRoot.root};
    const workspace = {
        getCanvas: () => canvas,
        getBlockById: () => null,
        getAllBlocks: () => [first, second]
    };
    expect(blockAtPointerTarget(workspace, firstRoot.child)).toBe(first);
    expect(updateBlockHover(null, first, 'hovered')).toBe(first);
    expect(firstRoot.root.classList.contains('hovered')).toBe(true);
    expect(firstRoot.root.getAttribute('data-keyboard-hovered')).toBe('true');
    expect(updateBlockHover(first, second, 'hovered')).toBe(second);
    expect(firstRoot.root.classList.contains('hovered')).toBe(false);
    expect(firstRoot.root.getAttribute('data-keyboard-hovered')).toBeNull();
    expect(secondRoot.root.classList.contains('hovered')).toBe(true);
    expect(updateBlockHover(second, null, 'hovered')).toBeNull();
    expect(secondRoot.root.classList.contains('hovered')).toBe(false);
});
