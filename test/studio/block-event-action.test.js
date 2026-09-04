import {createBlockEventAction} from '../../src/studio/replay/block-event-action';
import {captured, makeChangeSnapshot} from './helpers/block-snapshots';

test('creates forward and backward field-change actions from explicit values', () => {
    const snapshot = makeChangeSnapshot({
        details: {
            element: 'field',
            name: 'VALUE',
            oldValue: captured('10'),
            newValue: {kind: 'undefined'}
        }
    });
    snapshot.blockRef = {ancestorId: 'root', ancestorType: 'looks_say', path: []};

    expect(createBlockEventAction(snapshot, 'forward')).toMatchObject({
        blockRef: snapshot.blockRef,
        eventJson: {
            type: 'change',
            blockId: 'block-1',
            newValue: void 0
        }
    });
    expect(createBlockEventAction(snapshot, 'backward').eventJson.newValue).toBe('10');
});

test('inverts create and delete actions using captured XML', () => {
    const created = makeChangeSnapshot({
        type: 'create',
        details: {xml: '<block id="block-1" />', ids: ['block-1']}
    });
    const deleted = makeChangeSnapshot({
        type: 'delete',
        details: {oldXml: '<block id="block-1" />', ids: ['block-1']}
    });

    expect(createBlockEventAction(created, 'backward').eventJson).toMatchObject({
        type: 'delete',
        ids: ['block-1']
    });
    expect(createBlockEventAction(deleted, 'backward').eventJson).toMatchObject({
        type: 'create',
        xml: '<block id="block-1" />'
    });
});

test('round-trips comment lifecycle, content and position through explicit state', () => {
    const state = {
        text: 'Explain this',
        coordinate: {x: 40, y: 80},
        width: 160,
        height: 120,
        minimized: false
    };
    const deleted = makeChangeSnapshot({
        type: 'comment_delete',
        blockId: 'block-1',
        commentId: 'comment-1',
        details: {commentId: 'comment-1', oldXml: '<comment/>', state}
    });
    const changed = makeChangeSnapshot({
        type: 'comment_change',
        blockId: null,
        commentId: 'comment-1',
        details: {
            commentId: 'comment-1',
            oldContents: {text: 'before'},
            newContents: {text: 'after'}
        }
    });
    const moved = makeChangeSnapshot({
        type: 'comment_move',
        blockId: null,
        commentId: 'comment-1',
        details: {
            commentId: 'comment-1',
            oldCoordinate: {x: 10.5, y: 20.25},
            newCoordinate: {x: 30.75, y: 40.5}
        }
    });

    expect(createBlockEventAction(deleted, 'backward')).toMatchObject({
        eventJson: {
            type: 'comment_create',
            commentId: 'comment-1',
            blockId: 'block-1',
            xml: '<comment/>'
        },
        commentState: state
    });
    expect(createBlockEventAction(changed, 'backward')).toMatchObject({
        eventJson: {type: 'comment_change', commentId: 'comment-1', newValue: {text: 'before'}},
        commentState: {newContents: {text: 'before'}}
    });
    expect(createBlockEventAction(moved, 'forward')).toMatchObject({
        eventJson: {type: 'comment_move', commentId: 'comment-1', newCoordinate: '30.75,40.5'},
        commentState: {newCoordinate: {x: 30.75, y: 40.5}}
    });
});

test('swaps move locations without losing the VM-authored coordinate', () => {
    const parentRef = {
        ancestorId: 'recorded-parent',
        ancestorType: 'control_repeat',
        ancestorCoordinate: {x: 100, y: 120},
        path: []
    };
    const snapshot = makeChangeSnapshot({
        type: 'move',
        details: {
            oldLocation: {
                parentId: null,
                inputName: null,
                coordinate: {x: 12.5, y: 34.75}
            },
            newLocation: {
                parentId: 'parent-1',
                inputName: 'SUBSTACK',
                coordinate: null,
                parentRef
            }
        }
    });

    expect(createBlockEventAction(snapshot, 'forward')).toMatchObject({
        eventJson: {
            type: 'move',
            newParentId: 'parent-1',
            newInputName: 'SUBSTACK'
        },
        previousLocation: {parentId: null, inputName: null},
        destinationLocation: expect.objectContaining({parentId: 'parent-1', parentRef})
    });
    expect(createBlockEventAction(snapshot, 'backward')).toMatchObject({
        eventJson: {newCoordinate: '12.5,34.75'},
        previousLocation: {parentId: 'parent-1', inputName: 'SUBSTACK', parentRef}
    });
});

test('preserves floating-point take coordinates across replay', () => {
    const snapshot = makeChangeSnapshot({
        type: 'move',
        details: {
            oldLocation: {
                parentId: null,
                inputName: null,
                coordinate: {x: 161.62962962962962, y: 243.40740740740753}
            },
            newLocation: {
                parentId: 'parent-1',
                inputName: null,
                coordinate: null
            }
        }
    });

    expect(createBlockEventAction(snapshot, 'backward').eventJson.newCoordinate)
        .toBe('161.62962962962962,243.40740740740753');
});

test('inverts a list deletion and carries the definition to restore', () => {
    const definition = {
        present: true,
        id: 'list-id',
        targetRef: {isStage: true, name: 'Stage'},
        name: 'items',
        value: ['one']
    };
    const snapshot = makeChangeSnapshot({
        type: 'var_delete',
        blockId: null,
        details: {
            varId: 'list-id',
            varType: 'list',
            varName: 'items',
            isLocal: false,
            isCloud: false,
            definition: {before: definition, after: null}
        }
    });

    expect(createBlockEventAction(snapshot, 'backward')).toMatchObject({
        eventJson: {type: 'var_create', varId: 'list-id', varType: 'list'},
        listDefinition: definition
    });
    expect(createBlockEventAction(snapshot, 'forward').listDefinition).toMatchObject({
        present: false,
        id: 'list-id'
    });
});

test('replays scalar local variable creation without list metadata', () => {
    const snapshot = makeChangeSnapshot({
        type: 'var_create',
        blockId: null,
        details: {
            varId: 'cake-id',
            varType: '',
            varName: 'cake',
            isLocal: true,
            isCloud: false,
            definition: null
        }
    });

    expect(createBlockEventAction(snapshot, 'forward')).toMatchObject({
        eventJson: {
            type: 'var_create',
            varId: 'cake-id',
            varName: 'cake',
            isLocal: true
        },
        listDefinition: null
    });
    expect(createBlockEventAction(snapshot, 'backward')).toMatchObject({
        eventJson: {type: 'var_delete', varId: 'cake-id', isLocal: true},
        listDefinition: null
    });
});

test('inverts broadcast creation as the same typed variable definition', () => {
    const definition = {
        present: true,
        id: 'broadcast-id',
        targetRef: {isStage: true, name: 'Stage'},
        name: 'party',
        type: 'broadcast_msg',
        value: 'party'
    };
    const snapshot = makeChangeSnapshot({
        type: 'var_create',
        blockId: null,
        details: {
            varId: 'broadcast-id',
            varType: 'broadcast_msg',
            varName: 'party',
            isLocal: false,
            isCloud: false,
            definition: {before: null, after: definition}
        }
    });

    expect(createBlockEventAction(snapshot, 'forward')).toMatchObject({
        eventJson: {
            type: 'var_create',
            varId: 'broadcast-id',
            varType: 'broadcast_msg',
            varName: 'party'
        },
        listDefinition: definition
    });
    expect(createBlockEventAction(snapshot, 'backward')).toMatchObject({
        eventJson: {
            type: 'var_delete',
            varId: 'broadcast-id',
            varType: 'broadcast_msg'
        },
        listDefinition: {
            present: false,
            id: 'broadcast-id',
            type: 'broadcast_msg'
        }
    });
});

test('retains scalar definition metadata for monitor restoration', () => {
    const definition = {
        present: true,
        id: 'cake-id',
        targetRef: {isStage: false, name: 'Sprite1'},
        name: 'cake',
        type: '',
        value: 0,
        monitor: {id: 'cake-id', opcode: 'data_variable', visible: true}
    };
    const snapshot = makeChangeSnapshot({
        type: 'var_create',
        blockId: null,
        details: {
            varId: 'cake-id',
            varType: '',
            varName: 'cake',
            isLocal: true,
            isCloud: false,
            definition: {before: null, after: definition}
        }
    });

    expect(createBlockEventAction(snapshot, 'forward').listDefinition).toBe(definition);
    expect(createBlockEventAction(snapshot, 'backward').listDefinition).toMatchObject({
        present: false,
        id: 'cake-id',
        type: ''
    });
});
