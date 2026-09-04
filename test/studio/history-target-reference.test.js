import {
    historyTargetBeforeApply, historyTargetReference, retainsEditingTarget
} from '../../src/studio/bridge/history-target-reference';

const snapshot = (beforeId, beforeName, afterId, afterName) => ({
    kind: 'project-operation',
    operation: {
        beforeEditingTargetId: beforeId,
        beforeEditingTargetRef: {isStage: false, name: beforeName},
        afterEditingTargetId: afterId,
        afterEditingTargetRef: {isStage: false, name: afterName}
    }
});

test('renamed context has an incoming selection identity and outgoing restore identity', () => {
    const rename = snapshot('a', 'Sprite2', 'a', 'Guide');
    expect(retainsEditingTarget(rename)).toBe(true);
    expect(historyTargetBeforeApply(rename, 'backward').targetRef.name).toBe('Guide');
    expect(historyTargetReference(rename, 'backward').targetRef.name).toBe('Sprite2');
    expect(historyTargetBeforeApply(rename, 'forward').targetRef.name).toBe('Sprite2');
    expect(historyTargetReference(rename, 'forward').targetRef.name).toBe('Guide');
});

test('created/deleted targets cannot borrow an unrelated incoming identity', () => {
    const creation = snapshot('a', 'Sprite1', 'b', 'Apple');
    expect(retainsEditingTarget(creation)).toBe(false);
    expect(historyTargetBeforeApply(creation, 'forward').targetRef.name).toBe('Apple');
    expect(historyTargetBeforeApply(creation, 'backward').targetRef.name).toBe('Sprite1');
});

test('script sharing selects the editing context, not the destination whose data changes', () => {
    const copy = snapshot('a', 'Sprite1', 'a', 'Sprite1');
    copy.operation.targetRef = {name: 'Apple', isStage: false};
    expect(historyTargetBeforeApply(copy, 'forward').targetRef.name).toBe('Sprite1');
    expect(historyTargetBeforeApply(copy, 'backward').targetRef.name).toBe('Sprite1');
    const blocks = {targetId: 'a', events: [{targetId: 'a'}]};
    expect(historyTargetBeforeApply(blocks, 'forward')).toBe(blocks);
});
