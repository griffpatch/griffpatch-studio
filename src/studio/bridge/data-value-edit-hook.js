const listeners = new WeakMap();

/**
 * Register the active Studio session for authored values changed through GUI
 * monitors. The seam is deliberately inert outside a query-flagged Studio
 * session.
 *
 * @param {object} vm TurboWarp VM
 * @param {Function} listener called before the normal VM value mutation
 * @returns {Function} detach callback
 */
const attachStudioDataValueListener = (vm, listener) => {
    listeners.set(vm, listener);
    return () => {
        if (listeners.get(vm) === listener) listeners.delete(vm);
    };
};

/**
 * Start one authored-value gesture. The returned completion callback accepts
 * the final value after the ordinary GUI mutation has finished.
 *
 * @param {object} vm TurboWarp VM
 * @param {object} edit immutable gesture description including its before value
 * @returns {?Function} completion callback
 */
const beginStudioDataValueEdit = (vm, edit) => {
    const listener = listeners.get(vm);
    return listener ? listener(edit) : null;
};

export {
    attachStudioDataValueListener,
    beginStudioDataValueEdit
};
