import {
    attachStudioTargetPropertyListener,
    beginStudioTargetPropertyGesture,
    runStudioTargetPropertyEdit
} from '../../src/studio/bridge/target-property-edit-hook';

const makeTarget = () => ({
    id: 'sprite-a',
    isStage: false,
    sprite: {name: 'Sprite1'},
    x: 0,
    y: 0,
    direction: 90,
    size: 100,
    visible: true,
    draggable: false,
    rotationStyle: 'all around',
    currentCostume: 0,
    getName: () => 'Sprite1'
});

test('captures one submitted sprite property edit', () => {
    const target = makeTarget();
    const edits = [];
    const vm = {
        editingTarget: target,
        postSpriteInfo: data => Object.assign(target, data)
    };
    const detach = attachStudioTargetPropertyListener(vm, edit => {
        edits.push(edit);
        return after => {
            edits[edits.length - 1].after = after;
        };
    });

    expect(vm.postSpriteInfo({x: 42})).toBe(target);
    expect(edits).toHaveLength(1);
    expect(edits[0]).toMatchObject({
        targetId: 'sprite-a',
        targetRef: {name: 'Sprite1', isStage: false},
        before: {x: 0},
        after: {x: 42}
    });

    detach();
    vm.postSpriteInfo({x: 50});
    expect(edits).toHaveLength(1);
});

test('coalesces repeated stage-drag updates into one before/after edit', () => {
    const target = makeTarget();
    const completed = [];
    const vm = {
        editingTarget: target,
        _dragTarget: target,
        postSpriteInfo: data => Object.assign(target, data),
        stopDrag: () => {
            vm._dragTarget = null;
            return 'stopped';
        }
    };
    attachStudioTargetPropertyListener(vm, edit => after => completed.push({...edit, after}));

    vm.postSpriteInfo({x: 10, y: 5});
    vm.postSpriteInfo({x: 20, y: 15});
    vm.postSpriteInfo({x: 30, y: 25});
    expect(completed).toHaveLength(0);
    expect(vm.stopDrag('sprite-a')).toBe('stopped');
    expect(completed).toHaveLength(1);
    expect(completed[0]).toMatchObject({
        before: {x: 0, y: 0},
        after: {x: 30, y: 25}
    });
});

test('bypasses capture when the session declines an edit', () => {
    const target = makeTarget();
    const vm = {
        editingTarget: target,
        postSpriteInfo: data => Object.assign(target, data)
    };
    attachStudioTargetPropertyListener(vm, () => null);

    vm.postSpriteInfo({visible: false});
    expect(target.visible).toBe(false);
});

test('captures explicit GUI costume selection but not runtime costume changes', () => {
    const target = makeTarget();
    const completed = [];
    target.setCostume = costumeIndex => {
        target.currentCostume = costumeIndex;
    };
    const vm = {
        editingTarget: target,
        postSpriteInfo: data => Object.assign(target, data)
    };
    const detach = attachStudioTargetPropertyListener(
        vm,
        edit => after => completed.push({...edit, after})
    );

    runStudioTargetPropertyEdit(vm, ['currentCostume'], () => target.setCostume(2));
    expect(completed).toEqual([expect.objectContaining({
        targetId: 'sprite-a',
        before: {currentCostume: 0},
        after: {currentCostume: 2}
    })]);

    target.setCostume(1);
    expect(completed).toHaveLength(1);

    detach();
    runStudioTargetPropertyEdit(vm, ['currentCostume'], () => target.setCostume(0));
    expect(completed).toHaveLength(1);
});

test('captures a stage drag and every shifted layer in one gesture', () => {
    const first = makeTarget();
    const second = {
        ...makeTarget(),
        id: 'sprite-b',
        sprite: {name: 'Sprite2'},
        x: 50,
        getName: () => 'Sprite2'
    };
    const layers = new Map([[first, 0], [second, 1]]);
    first.getLayerOrder = () => layers.get(first);
    second.getLayerOrder = () => layers.get(second);
    const completed = [];
    const vm = {
        editingTarget: first,
        _dragTarget: first,
        postSpriteInfo: data => Object.assign(first, data),
        stopDrag: () => {
            vm._dragTarget = null;
        }
    };
    attachStudioTargetPropertyListener(vm, edit => after => completed.push({...edit, after}));

    const finish = beginStudioTargetPropertyGesture(
        vm,
        first,
        ['x', 'layerOrder'],
        [first, second]
    );
    layers.set(first, 1);
    layers.set(second, 0);
    vm.postSpriteInfo({x: 20});
    vm.stopDrag(first.id);
    finish();

    expect(completed).toHaveLength(1);
    expect(completed[0]).toMatchObject({
        targetId: 'sprite-a',
        targets: [{
            targetRef: {name: 'Sprite1'},
            before: {x: 0, layerOrder: 0}
        }, {
            targetRef: {name: 'Sprite2'},
            before: {x: 50, layerOrder: 1}
        }],
        after: [{x: 20, layerOrder: 1}, {x: 50, layerOrder: 0}]
    });
});
