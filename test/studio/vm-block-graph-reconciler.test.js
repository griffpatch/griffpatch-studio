import {reconcileVmBlockGraph} from '../../src/studio/bridge/vm-block-graph-reconciler';

test('repairs every still-referenced obscured shadow without touching ordinary roots', () => {
    const resetCache = jest.fn();
    const blocks = {
        parent: {
            id: 'parent',
            inputs: {VALUE: {block: 'reporter', shadow: 'shadow'}}
        },
        reporter: {id: 'reporter', parent: 'parent', topLevel: false},
        shadow: {id: 'shadow', parent: null, topLevel: true, x: 40, y: 50, shadow: true},
        root: {id: 'root', parent: null, topLevel: true, x: 10, y: 20}
    };
    const vm = {
        runtime: {
            targets: [{
                id: 'sprite-1',
                blocks: {_blocks: blocks, _scripts: ['shadow', 'root'], resetCache}
            }]
        }
    };

    expect(reconcileVmBlockGraph(vm)).toEqual({
        repaired: 1,
        repairs: [{
            targetId: 'sprite-1',
            parentId: 'parent',
            inputName: 'VALUE',
            blockId: 'shadow',
            kind: 'shadow-ownership'
        }]
    });
    expect(blocks.shadow).toMatchObject({parent: 'parent', topLevel: false});
    expect(blocks.shadow).not.toHaveProperty('x');
    expect(blocks.shadow).not.toHaveProperty('y');
    expect(vm.runtime.targets[0].blocks._scripts).toEqual(['root']);
    expect(blocks.root).toMatchObject({parent: null, topLevel: true, x: 10, y: 20});
    expect(resetCache).toHaveBeenCalledTimes(1);
});

test('repairs dangling and live connection references before boundary hashing', () => {
    const resetCache = jest.fn();
    const blocks = {
        parent: {
            id: 'parent',
            next: 'deleted-next',
            inputs: {
                VALUE: {block: 'deleted-reporter', shadow: 'shadow'},
                SUBSTACK: {block: 'child', shadow: null}
            }
        },
        shadow: {id: 'shadow', parent: null, topLevel: true, x: 10, y: 20},
        child: {id: 'child', parent: null, topLevel: true, x: 30, y: 40}
    };
    const vm = {
        runtime: {
            targets: [{
                id: 'sprite-1',
                blocks: {_blocks: blocks, _scripts: ['shadow', 'child'], resetCache}
            }]
        }
    };

    expect(reconcileVmBlockGraph(vm)).toMatchObject({repaired: 4});
    expect(blocks.parent.next).toBeNull();
    expect(blocks.parent.inputs.VALUE).toEqual({block: 'shadow', shadow: 'shadow'});
    expect(blocks.shadow).toMatchObject({parent: 'parent', topLevel: false});
    expect(blocks.child).toMatchObject({parent: 'parent', topLevel: false});
    expect(vm.runtime.targets[0].blocks._scripts).toEqual([]);
    expect(resetCache).toHaveBeenCalledTimes(1);
});
