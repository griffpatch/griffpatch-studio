import {cloneJson} from '../lib/clone-json';

const EDITABLE_TARGET_PROPERTIES = [
    'x',
    'y',
    'direction',
    'size',
    'visible',
    'draggable',
    'rotationStyle'
];

const studioTargetPropertyEditors = new WeakMap();

const targetReference = target => ({
    isStage: Boolean(target.isStage),
    name: target.getName ? target.getName() : target.sprite.name
});

const targetPropertyValue = (target, property) => (
    property === 'layerOrder' && typeof target.getLayerOrder === 'function' ?
        target.getLayerOrder() : target[property]
);

const targetProperties = (
    target,
    selectedProperties = EDITABLE_TARGET_PROPERTIES
) => selectedProperties.reduce((properties, property) => {
    if (property in target || (property === 'layerOrder' && typeof target.getLayerOrder === 'function')) {
        properties[property] = cloneJson(targetPropertyValue(target, property));
    }
    return properties;
}, {});

/**
 * Open one GUI gesture which can mutate several related targets. Stage drags
 * use this before goToFront so position and every shifted layer index share
 * the same reversible transaction.
 *
 * @param {object} vm Scratch VM
 * @param {object} primaryTarget target presented by the timeline
 * @param {Array<string>} selectedProperties properties owned by the gesture
 * @param {Array<object>} relatedTargets targets whose properties may change
 * @returns {Function} completes the gesture after the GUI mutation
 */
const beginStudioTargetPropertyGesture = (
    vm,
    primaryTarget,
    selectedProperties,
    relatedTargets = [primaryTarget]
) => {
    const editor = vm && studioTargetPropertyEditors.get(vm);
    if (!editor || !primaryTarget || editor.activeGesture) return () => {};
    const targets = [...new Map(relatedTargets.map(target => [target.id, target])).values()];
    const snapshots = targets.map(target => ({
        targetId: target.id,
        targetRef: targetReference(target),
        before: targetProperties(target, selectedProperties)
    }));
    const finishEdit = editor.beginEdit({
        targetId: primaryTarget.id,
        targetRef: targetReference(primaryTarget),
        targets: snapshots
    });
    const gesture = {targets};
    editor.activeGesture = gesture;
    return () => {
        if (editor.activeGesture !== gesture) return;
        editor.activeGesture = null;
        if (finishEdit) finishEdit(targets.map(target => targetProperties(target, selectedProperties)));
    };
};

/**
 * Record a GUI-owned target mutation without wrapping the corresponding VM
 * method globally. Runtime blocks call methods such as setCostume too, so the
 * GUI action boundary is the only reliable place to distinguish authoring
 * from project execution.
 *
 * @param {object} vm Scratch VM
 * @param {Array<string>} selectedProperties properties changed by the GUI action
 * @param {Function} mutate performs the target mutation
 * @returns {*} mutation result, or a promise for it
 */
const runStudioTargetPropertyEdit = (vm, selectedProperties, mutate) => {
    const editor = vm && studioTargetPropertyEditors.get(vm);
    const target = vm && vm.editingTarget;
    if (!editor || !target) return mutate();
    const finish = editor.beginEdit({
        targetId: target.id,
        targetRef: targetReference(target),
        before: targetProperties(target, selectedProperties)
    });
    const complete = result => {
        if (finish) finish(targetProperties(target, selectedProperties));
        return result;
    };
    const result = mutate();
    if (result && typeof result.then === 'function') return result.then(complete);
    return complete(result);
};

/**
 * Turn GUI sprite-info changes into one semantic edit per field submit or
 * stage drag. The VM exposes the dragged target while pointer moves are in
 * progress, so those repeated postSpriteInfo calls can share one before/after
 * boundary and never flood the Studio timeline with motion frames.
 *
 * @param {object} vm Scratch VM
 * @param {Function} beginEdit opens a visible property edit before mutation
 * @returns {Function} detach callback
 */
const attachStudioTargetPropertyListener = (vm, beginEdit) => {
    if (!vm || typeof vm.postSpriteInfo !== 'function') return () => {};
    const editor = {beginEdit};
    studioTargetPropertyEditors.set(vm, editor);
    const originalPost = vm.postSpriteInfo;
    const originalStopDrag = vm.stopDrag;
    let activeDragEdit = null;

    const beginForTarget = target => beginEdit({
        targetId: target.id,
        targetRef: targetReference(target),
        before: targetProperties(target)
    });

    const wrappedPost = data => {
        const target = vm._dragTarget || vm.editingTarget;
        if (!target || !data || !EDITABLE_TARGET_PROPERTIES.some(property => property in data)) {
            return originalPost.call(vm, data);
        }
        if (vm._dragTarget) {
            if (editor.activeGesture) return originalPost.call(vm, data);
            if (!activeDragEdit) {
                const finish = beginForTarget(target);
                if (finish) activeDragEdit = {target, finish};
            }
            return originalPost.call(vm, data);
        }
        const finish = beginForTarget(target);
        const result = originalPost.call(vm, data);
        if (finish) finish(targetProperties(target));
        return result;
    };

    const wrappedStopDrag = (...args) => {
        if (editor.activeGesture) return originalStopDrag.apply(vm, args);
        const edit = activeDragEdit;
        activeDragEdit = null;
        const result = originalStopDrag.apply(vm, args);
        if (edit) edit.finish(targetProperties(edit.target));
        return result;
    };

    vm.postSpriteInfo = wrappedPost;
    if (typeof originalStopDrag === 'function') vm.stopDrag = wrappedStopDrag;
    return () => {
        if (vm.postSpriteInfo === wrappedPost) vm.postSpriteInfo = originalPost;
        if (vm.stopDrag === wrappedStopDrag) vm.stopDrag = originalStopDrag;
        if (studioTargetPropertyEditors.get(vm) === editor) studioTargetPropertyEditors.delete(vm);
    };
};

export {
    attachStudioTargetPropertyListener,
    beginStudioTargetPropertyGesture,
    EDITABLE_TARGET_PROPERTIES,
    runStudioTargetPropertyEdit,
    targetProperties
};
