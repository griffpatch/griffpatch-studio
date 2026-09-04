import {
    attachStudioDataValueListener,
    beginStudioDataValueEdit
} from './data-value-edit-hook';

/**
 * Register the active Studio session for direct list-monitor edits. The GUI
 * utility remains inert when no query-flagged Studio session is attached.
 *
 * @param {object} vm TurboWarp VM
 * @param {Function} listener called before the VM value is changed
 * @returns {Function} detach callback
 */
const attachStudioListValueListener = (vm, listener) => attachStudioDataValueListener(vm, listener);

/**
 * Start one direct list edit. The listener may return a completion callback so
 * Studio can snapshot the final value only after the normal GUI mutation.
 *
 * @param {object} vm TurboWarp VM
 * @param {object} edit immutable before/after edit description
 * @returns {?Function} completion callback
 */
const beginStudioListValueEdit = (vm, edit) => {
    const finish = beginStudioDataValueEdit(vm, {
        ...edit,
        valueType: 'list'
    });
    return finish ? () => finish(edit.after) : null;
};

export {
    attachStudioListValueListener,
    beginStudioListValueEdit
};
