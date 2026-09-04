import {snapshotBlockEvent} from '../../src/studio/journal/snapshot-block-event';

const makeEvent = overrides => {
    const event = {
        type: 'change',
        group: 'group-1',
        recordUndo: true,
        workspaceId: 'workspace-1',
        blockId: 'block-1',
        element: 'field',
        name: 'VALUE',
        oldValue: '10',
        newValue: '20',
        ...overrides
    };
    event.toJson = () => ({
        type: event.type,
        group: event.group,
        blockId: event.blockId,
        newValue: event.newValue
    });
    return event;
};

const context = {
    targetId: 'sprite-a',
    recordedAtMs: 1234,
    xmlToText: xml => xml.text
};

test('captures complete change values and Studio context', () => {
    const snapshot = snapshotBlockEvent(makeEvent(), context);

    expect(snapshot).toEqual({
        schemaVersion: 1,
        recordedAtMs: 1234,
        targetId: 'sprite-a',
        targetRef: {
            runtimeId: 'sprite-a',
            name: null,
            isStage: false
        },
        workspaceId: 'workspace-1',
        blockId: 'block-1',
        type: 'change',
        group: 'group-1',
        recordUndo: true,
        forwardJson: {
            type: 'change',
            group: 'group-1',
            blockId: 'block-1',
            newValue: '20'
        },
        details: {
            element: 'field',
            name: 'VALUE',
            oldValue: {kind: 'value', value: '10'},
            newValue: {kind: 'value', value: '20'}
        }
    });
});

test('distinguishes an undefined value from null', () => {
    const event = makeEvent({oldValue: void 0, newValue: null});
    const snapshot = snapshotBlockEvent(event, context);

    expect(snapshot.details.oldValue).toEqual({kind: 'undefined'});
    expect(snapshot.details.newValue).toEqual({kind: 'value', value: null});
});

test('captures deleted XML and descendants before disposal', () => {
    const event = makeEvent({
        type: 'delete',
        oldXml: {text: '<block id="block-1" />'},
        ids: ['block-1', 'block-child']
    });
    const snapshot = snapshotBlockEvent(event, context);

    event.ids.push('later-mutation');
    event.oldXml.text = '<changed />';

    expect(snapshot.details).toEqual({
        oldXml: '<block id="block-1" />',
        ids: ['block-1', 'block-child']
    });
});

test('captures created XML and descendants', () => {
    const event = makeEvent({
        type: 'create',
        xml: {text: '<block id="block-1" />'},
        ids: ['block-1']
    });
    const snapshot = snapshotBlockEvent(event, context);

    expect(snapshot.details).toEqual({
        xml: '<block id="block-1" />',
        ids: ['block-1']
    });
});

test('captures both connected and top-level move locations', () => {
    const event = makeEvent({
        type: 'move',
        oldParentId: null,
        oldInputName: null,
        oldCoordinate: {x: 12.5, y: 34.75},
        newParentId: 'parent-1',
        newInputName: 'SUBSTACK',
        newCoordinate: null
    });
    const snapshot = snapshotBlockEvent(event, context);

    expect(snapshot.details).toEqual({
        oldLocation: {
            parentId: null,
            inputName: null,
            coordinate: {x: 12.5, y: 34.75}
        },
        newLocation: {
            parentId: 'parent-1',
            inputName: 'SUBSTACK',
            coordinate: null
        }
    });
});

test('captures complete workspace-comment lifecycle state omitted by event JSON', () => {
    const created = snapshotBlockEvent(makeEvent({
        type: 'comment_create',
        blockId: null,
        commentId: 'comment-1',
        text: 'Remember this',
        xy: {x: 40.5, y: 80.25},
        width: 160,
        height: 120,
        minimized: false,
        xml: {text: '<comment id="comment-1">Remember this</comment>'}
    }), context);
    const changed = snapshotBlockEvent(makeEvent({
        type: 'comment_change',
        blockId: null,
        commentId: 'comment-1',
        oldContents_: {text: 'Remember this'},
        newContents_: {text: 'Updated'}
    }), context);
    const moved = snapshotBlockEvent(makeEvent({
        type: 'comment_move',
        blockId: null,
        commentId: 'comment-1',
        oldCoordinate_: {x: 40.5, y: 80.25},
        newCoordinate_: {x: 240.75, y: 180.5}
    }), context);

    expect(created).toMatchObject({
        blockId: null,
        commentId: 'comment-1',
        details: {
            commentId: 'comment-1',
            xml: '<comment id="comment-1">Remember this</comment>',
            state: {
                text: 'Remember this',
                coordinate: {x: 40.5, y: 80.25},
                width: 160,
                height: 120,
                minimized: false
            }
        }
    });
    expect(changed.details).toEqual({
        commentId: 'comment-1',
        oldContents: {text: 'Remember this'},
        newContents: {text: 'Updated'}
    });
    expect(moved.details).toEqual({
        commentId: 'comment-1',
        oldCoordinate: {x: 40.5, y: 80.25},
        newCoordinate: {x: 240.75, y: 180.5}
    });
});

test('ignores a semantically null comment refresh emitted by Scratch Blocks', () => {
    const snapshot = snapshotBlockEvent(makeEvent({
        type: 'comment_change',
        blockId: null,
        commentId: 'comment-1',
        oldContents_: {height: 200, width: 200},
        newContents_: {width: 200, height: 200}
    }), context);

    expect(snapshot).toBeNull();
});

test('captures the deleted block-comment state needed for inverse recreation', () => {
    const snapshot = snapshotBlockEvent(makeEvent({
        type: 'comment_delete',
        blockId: 'block-1',
        commentId: 'comment-1',
        text: 'Why?',
        xy: {x: 12, y: 18},
        width: 140,
        height: 90,
        minimized: true,
        xml: {text: '<comment id="comment-1">Why?</comment>'}
    }), context);

    expect(snapshot.details).toEqual({
        commentId: 'comment-1',
        oldXml: '<comment id="comment-1">Why?</comment>',
        state: {
            text: 'Why?',
            coordinate: {x: 12, y: 18},
            width: 140,
            height: 90,
            minimized: true
        }
    });
});

test('rejects a non-finite semantic coordinate instead of persisting JSON null', () => {
    expect(() => snapshotBlockEvent(makeEvent({
        type: 'move',
        oldParentId: null,
        oldCoordinate: {x: Number.NaN, y: 10},
        newParentId: 'parent-1',
        newCoordinate: null
    }), context)).toThrow('non-finite block coordinate');
});

test('captures a sprite-local scalar variable event without list metadata', () => {
    const snapshot = snapshotBlockEvent(makeEvent({
        type: 'var_create',
        blockId: null,
        varId: 'cake-id',
        varType: '',
        varName: 'cake',
        isLocal: true,
        isCloud: false
    }), context);

    expect(snapshot).toMatchObject({
        type: 'var_create',
        details: {
            varId: 'cake-id',
            varType: '',
            varName: 'cake',
            isLocal: true,
            isCloud: false,
            definition: null
        }
    });
});

test('ignores UI events outside the first block-journal contract', () => {
    expect(snapshotBlockEvent(makeEvent({type: 'ui'}), context)).toBeNull();
});

test('fails loudly when a durable delete snapshot would be incomplete', () => {
    expect(() => snapshotBlockEvent(makeEvent({
        type: 'delete',
        oldXml: null,
        ids: ['block-1']
    }), context)).toThrow('event XML is missing');
});
