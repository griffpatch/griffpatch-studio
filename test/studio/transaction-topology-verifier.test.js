import {
    expectedMoves,
    verifyTransactionTopology
} from '../../src/studio/bridge/transaction-topology-verifier';
import {finalBlockPresence} from '../../src/studio/replay/block-event-presence';

const moveTransaction = () => ({
    events: [{
        type: 'move',
        blockId: 'child',
        details: {
            oldLocation: {parentId: null, inputName: null, coordinate: {x: 10, y: 20}},
            newLocation: {parentId: 'parent', inputName: 'SUBSTACK', coordinate: null}
        }
    }]
});

const makeTopology = ({connected = true, vmParent = 'parent'} = {}) => {
    let child;
    const parent = {
        id: 'parent',
        inputList: [{
            name: 'SUBSTACK',
            connection: {targetBlock: () => (connected ? child : null)}
        }]
    };
    child = {
        id: 'child',
        getParent: () => (connected ? parent : null),
        getRelativeToSurfaceXY: () => ({x: 10, y: 20})
    };
    const blocks = new Map([['parent', parent], ['child', child]]);
    return {
        workspace: {
            getBlockById: id => blocks.get(id) || null,
            getTopBlocks: () => (connected ? [parent] : [parent, child])
        },
        vm: {
            editingTarget: {
                blocks: {getBlock: id => (id === 'child' ? {parent: vmParent} : null)}
            }
        }
    };
};

test('accepts a move only when Blockly and VM share the recorded parent', () => {
    const topology = makeTopology();
    expect(verifyTransactionTopology({
        ...topology,
        transaction: moveTransaction(),
        direction: 'forward'
    })).toMatchObject({matches: true, checked: 1});
});

test('rejects a visually overlapping block which is still top-level', () => {
    const topology = makeTopology({connected: false, vmParent: null});
    expect(verifyTransactionTopology({
        ...topology,
        transaction: moveTransaction(),
        direction: 'forward'
    })).toMatchObject({
        matches: false,
        results: [{reason: 'workspace topology differs'}]
    });
});

test('rejects a connection present in Blockly but absent from the VM', () => {
    const topology = makeTopology({vmParent: null});
    expect(verifyTransactionTopology({
        ...topology,
        transaction: moveTransaction(),
        direction: 'forward'
    })).toMatchObject({
        matches: false,
        results: [{reason: 'VM topology differs'}]
    });
});

test('uses the original location when traversing backward', () => {
    expect(expectedMoves(moveTransaction(), 'backward')).toEqual([{
        blockId: 'child',
        blockType: null,
        blockRef: null,
        source: {parentId: 'parent', inputName: 'SUBSTACK', coordinate: null},
        destination: {parentId: null, inputName: null, coordinate: {x: 10, y: 20}}
    }]);
});

test('does not require a newly-created block to exist after undo deletes it', () => {
    const transaction = moveTransaction();
    transaction.events.unshift({
        type: 'create',
        blockId: 'child',
        details: {ids: ['child']}
    });

    expect(finalBlockPresence(transaction, 'backward').get('child')).toBe(false);
    expect(expectedMoves(transaction, 'backward')).toEqual([]);
    expect(verifyTransactionTopology({
        workspace: {getBlockById: () => null},
        vm: {editingTarget: {blocks: {getBlock: () => null}}},
        transaction,
        direction: 'backward'
    })).toMatchObject({matches: true, checked: 0});
});

test('still verifies the connection after redoing a newly-created block', () => {
    const transaction = moveTransaction();
    transaction.events.unshift({
        type: 'create',
        blockId: 'child',
        details: {ids: ['child']}
    });

    expect(finalBlockPresence(transaction, 'forward').get('child')).toBe(true);
    expect(verifyTransactionTopology({
        ...makeTopology(),
        transaction,
        direction: 'forward'
    })).toMatchObject({matches: true, checked: 1});
});

test('verifies every active reporter edge encoded inside a created XML tree', () => {
    const transaction = {
        events: [{
            type: 'create',
            blockId: 'recorded-root',
            details: {
                ids: ['recorded-root', 'recorded-shadow', 'recorded-child', 'recorded-nested-shadow'],
                xml: '<block id="recorded-root" type="looks_say">' +
                    '<value name="MESSAGE"><shadow id="recorded-shadow" type="text" />' +
                    '<block id="recorded-child" type="operator_join">' +
                    '<value name="STRING1"><shadow id="recorded-nested-shadow" type="text" /></value>' +
                    '</block></value></block>'
            }
        }]
    };
    const rootShadow = {id: 'live-root-shadow', type: 'text'};
    const nestedShadow = {id: 'live-nested-shadow', type: 'text'};
    const child = {
        id: 'live-child',
        type: 'operator_join',
        inputList: [{name: 'STRING1', connection: {targetBlock: () => nestedShadow}}]
    };
    const rootInput = {name: 'MESSAGE', connection: {targetBlock: () => child}};
    const root = {id: 'live-root', type: 'looks_say', inputList: [rootInput]};
    const blocks = new Map([
        [root.id, root],
        [rootShadow.id, rootShadow],
        [child.id, child],
        [nestedShadow.id, nestedShadow]
    ]);
    const vmBlocks = {
        'live-root': {
            parent: null,
            inputs: {MESSAGE: {block: 'live-child', shadow: 'live-root-shadow'}}
        },
        'live-root-shadow': {parent: 'live-root'},
        'live-child': {
            parent: 'live-root',
            inputs: {STRING1: {block: 'live-nested-shadow', shadow: 'live-nested-shadow'}}
        },
        'live-nested-shadow': {parent: 'live-child'}
    };
    const xmlElement = (localName, attributes, childNodes = []) => ({
        localName,
        childNodes,
        getAttribute: name => attributes[name] || null
    });
    const nestedShadowXml = xmlElement('shadow', {id: 'recorded-nested-shadow', type: 'text'});
    const childXml = xmlElement('block', {id: 'recorded-child', type: 'operator_join'}, [
        xmlElement('value', {name: 'STRING1'}, [nestedShadowXml])
    ]);
    const rootXml = xmlElement('block', {id: 'recorded-root', type: 'looks_say'}, [
        xmlElement('value', {name: 'MESSAGE'}, [
            xmlElement('shadow', {id: 'recorded-shadow', type: 'text'}),
            childXml
        ])
    ]);
    const topology = {
        workspace: {getBlockById: id => blocks.get(id) || null},
        vm: {
            editingTarget: {
                blocks: {getBlock: id => vmBlocks[id] || null}
            }
        },
        ScratchBlocks: {
            Xml: {textToDom: () => rootXml}
        },
        transaction,
        direction: 'forward',
        blockAliases: {'recorded-root': 'live-root'}
    };

    expect(verifyTransactionTopology(topology)).toMatchObject({matches: true, checked: 3});
    rootInput.connection.targetBlock = () => null;
    expect(verifyTransactionTopology(topology)).toMatchObject({
        matches: false,
        results: expect.arrayContaining([
            expect.objectContaining({reason: 'created-tree workspace topology differs'})
        ])
    });
});

test('tracks nested create IDs when only the child has a recorded move', () => {
    const transaction = moveTransaction();
    transaction.events.unshift({
        type: 'create',
        blockId: 'parent',
        details: {ids: ['parent', 'child']}
    });

    expect(expectedMoves(transaction, 'backward')).toEqual([]);
});

test('treats a compound reorder detach coordinate as pickup evidence, not final stack geometry', () => {
    const transaction = {
        events: [{
            type: 'move',
            blockId: 'child',
            details: {
                oldLocation: {parentId: 'parent', inputName: null, coordinate: null},
                newLocation: {parentId: null, inputName: null, coordinate: {x: 10, y: 116}}
            }
        }, {
            type: 'move',
            blockId: 'parent',
            details: {
                oldLocation: {parentId: null, inputName: null, coordinate: {x: 10, y: 20}},
                newLocation: {parentId: 'child', inputName: null, coordinate: null}
            }
        }]
    };
    const child = {
        id: 'child',
        getParent: () => null,
        getRelativeToSurfaceXY: () => ({x: 10, y: 20}),
        inputList: [{name: null, connection: {targetBlock: () => parent}}]
    };
    const parent = {id: 'parent', getParent: () => child};
    const blocks = new Map([['child', child], ['parent', parent]]);
    const result = verifyTransactionTopology({
        workspace: {getBlockById: id => blocks.get(id) || null},
        vm: {
            editingTarget: {
                blocks: {getBlock: id => ({child: {parent: null}, parent: {parent: 'child'}}[id] || null)}
            }
        },
        transaction,
        direction: 'forward'
    });

    expect(expectedMoves(transaction, 'forward')[0]).toMatchObject({
        blockId: 'child',
        destinationCoordinateIsGesturePickup: true
    });
    expect(result).toMatchObject({matches: true, checked: 2});
});

test('uses pre-mutation aliases after inverse substack insertion changes every recorded path', () => {
    const root = {
        id: 'live-root',
        type: 'motion_changexby',
        getParent: () => null,
        getRelativeToSurfaceXY: () => ({x: 591, y: 175}),
        inputList: []
    };
    const moving = {
        id: 'live-moving',
        type: 'motion_movesteps',
        getParent: () => null,
        getRelativeToSurfaceXY: () => ({x: 205, y: 285}),
        inputList: []
    };
    const tail = {
        id: 'live-tail',
        type: 'motion_changexby',
        getParent: () => root,
        getRelativeToSurfaceXY: () => ({x: 591, y: 223}),
        inputList: []
    };
    root.getNextBlock = () => tail;
    tail.getNextBlock = () => null;
    moving.getNextBlock = () => null;
    const blocks = new Map([[root.id, root], [moving.id, moving], [tail.id, tail]]);
    const rootRef = {
        ancestorId: 'recorded-root',
        ancestorType: 'motion_changexby',
        ancestorCoordinate: {x: 591, y: 175},
        path: []
    };
    const transaction = {
        events: [{
            type: 'move',
            blockId: 'recorded-moving',
            blockRef: {...rootRef, path: [{kind: 'next'}]},
            details: {
                oldLocation: {parentId: null, inputName: null, coordinate: {x: 205, y: 285}},
                newLocation: {parentId: null, inputName: null, coordinate: {x: 591, y: 223}}
            }
        }, {
            type: 'move',
            blockId: 'recorded-tail',
            blockRef: {...rootRef, path: [{kind: 'next'}, {kind: 'next'}, {kind: 'next'}]},
            details: {
                oldLocation: {
                    parentId: 'recorded-root',
                    inputName: null,
                    coordinate: null,
                    parentRef: rootRef
                },
                newLocation: {parentId: 'recorded-point', inputName: null, coordinate: null}
            }
        }, {
            type: 'move',
            blockId: 'recorded-moving',
            blockRef: {...rootRef, path: [{kind: 'next'}]},
            details: {
                oldLocation: {parentId: null, inputName: null, coordinate: {x: 591, y: 223}},
                newLocation: {parentId: 'recorded-root', inputName: null, coordinate: null}
            }
        }]
    };
    const topology = {
        workspace: {
            getBlockById: id => blocks.get(id) || null,
            getTopBlocks: () => [root, moving]
        },
        vm: {
            editingTarget: {
                blocks: {getBlock: id => ({
                    'live-root': {parent: null},
                    'live-moving': {parent: null},
                    'live-tail': {parent: 'live-root'}
                }[id] || null)}
            }
        },
        transaction,
        direction: 'backward'
    };

    expect(verifyTransactionTopology(topology)).toMatchObject({matches: false});
    expect(verifyTransactionTopology({
        ...topology,
        blockAliases: {
            'recorded-moving': 'live-moving',
            'recorded-tail': 'live-tail'
        }
    })).toMatchObject({matches: true, checked: 2});
});
