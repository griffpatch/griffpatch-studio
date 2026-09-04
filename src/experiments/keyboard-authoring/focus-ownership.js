const nativeEditorSelector = '.blocklyWidgetDiv, .blocklyDropDownDiv';

const isTextInput = element => Boolean(element &&
    (['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName) || element.isContentEditable));

// Classify the event's actual owner once. A pending cross-sprite handoff may
// temporarily own body keys, but must never borrow them from another control.
const keyOwner = (element, {surface, input, body, editingField, pendingNavigation}) => {
    if (element === surface) return 'surface';
    if (element === input) return 'composer';
    if (editingField && element?.closest?.(nativeEditorSelector)) return 'native';
    if (pendingNavigation && element === body) return 'navigation';
    return 'external';
};

// Closing a native editor may leave body focused. An explicitly focused page
// control (including Finder) is a newer owner, not a reason to refocus Code.
const canReturnFocus = (element, {surface, body, workspaceSvg}) =>
    element === body || element === surface || Boolean(workspaceSvg && element === workspaceSvg) ||
    Boolean(element?.closest?.(nativeEditorSelector));

// A deferred return is presentation only. The caller supplies the existing
// navigation/lifecycle identity; this does not create another focus history.
const createFocusReturn = ({capture, isCurrent, restore, requestFrame}) => {
    let pending = null;
    const finish = request => {
        pending = null;
        if (isCurrent(request.context)) restore();
    };
    return {
        cancel: () => {
            pending = null;
        },
        schedule: () => {
            const request = {context: capture()};
            pending = request;
            requestFrame(() => {
                if (pending !== request) return;
                finish(request);
            });
        },
        // Native close observation is already running at the paint boundary.
        // Consume the existing request now; scheduling another frame here can
        // swallow the next physical key and split native field Undo timing.
        finish: () => finish(pending || {context: capture()})
    };
};

export {isTextInput, keyOwner, canReturnFocus, createFocusReturn};
