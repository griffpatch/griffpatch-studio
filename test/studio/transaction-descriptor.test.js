import {describeTransaction} from '../../src/studio/timeline/transaction-descriptor';

test('labels block, field, variable and project-operation boundaries compactly', () => {
    expect(describeTransaction({
        events: [{type: 'create', blockType: 'event_whenflagclicked', targetRef: {name: 'Sprite1'}}]
    }, 0)).toEqual({index: 1, label: 'Add when flag clicked', target: 'Sprite1'});
    expect(describeTransaction({
        events: [{type: 'change', blockType: 'operator_equals'}]
    }, 1)).toMatchObject({index: 2, label: 'Edit equals'});
    expect(describeTransaction({
        events: [{type: 'var_create', details: {varType: 'broadcast_msg', varName: 'go'}}]
    }, 2)).toMatchObject({index: 3, label: 'Create broadcast “go”'});
    expect(describeTransaction({
        kind: 'project-operation',
        operation: {type: 'sprite-create', createdTargetRef: {name: 'Apple'}}
    }, 3)).toEqual({index: 4, label: 'Add sprite', target: 'Apple'});
    expect(describeTransaction({
        kind: 'project-operation',
        targetRef: {name: 'Sprite1'},
        operation: {
            type: 'sprite-rename',
            targetRef: {name: 'Sprite1'},
            renamedTargetRef: {name: 'Hero'}
        }
    }, 4)).toEqual({index: 5, label: 'Rename sprite', target: 'Hero'});
    expect(describeTransaction({
        kind: 'project-operation',
        targetRef: {name: 'Stage', isStage: true},
        operation: {
            type: 'backdrop-reorder',
            targetRef: {name: 'Stage', isStage: true},
            afterEditingTargetRef: {name: 'Sprite1', isStage: false}
        }
    }, 5)).toEqual({index: 6, label: 'Reorder backdrop', target: 'Stage'});
    expect(describeTransaction({
        kind: 'data-edit',
        targetRef: {name: 'Sprite1', isStage: false},
        afterDataDeltas: [{targets: [{properties: {x: {before: 0, after: 42}}}]}]
    }, 6)).toEqual({index: 7, label: 'Set x', target: 'Sprite1'});
    expect(describeTransaction({
        kind: 'data-edit',
        targetRef: {name: 'Sprite1', isStage: false},
        afterDataDeltas: [{targets: [{properties: {currentCostume: {before: 0, after: 1}}}]}]
    }, 7)).toEqual({index: 8, label: 'Set current costume', target: 'Sprite1'});
    expect(describeTransaction({
        events: [{type: 'comment_change', targetRef: {name: 'Sprite1'}}]
    }, 8)).toEqual({index: 9, label: 'Edit comment', target: 'Sprite1'});
    expect(describeTransaction({
        kind: 'project-operation',
        operation: {type: 'costume-edit', targetRef: {name: 'Sprite1'}}
    }, 9)).toEqual({index: 10, label: 'Edit costume', target: 'Sprite1'});
    expect(describeTransaction({
        kind: 'project-operation',
        operation: {type: 'sound-edit', targetRef: {name: 'Sprite1'}}
    }, 10)).toEqual({index: 11, label: 'Edit sound', target: 'Sprite1'});
    expect(describeTransaction({
        kind: 'project-operation',
        operation: {type: 'sprite-reorder', movedTargetRef: {name: 'Sprite2'}}
    }, 11)).toEqual({index: 12, label: 'Reorder sprite', target: 'Sprite2'});
    expect(describeTransaction({
        kind: 'project-operation',
        operation: {type: 'block-share', targetRef: {name: 'Sprite2'}}
    }, 12)).toEqual({index: 13, label: 'Copy script', target: 'Sprite2'});
});
