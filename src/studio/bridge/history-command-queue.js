/**
 * Serialize explicit history requests, regardless of their input surface.
 * A request is one user command (which may only select a sprite), not a
 * desired cursor delta. Only presentation may be skipped during catch-up.
 * @param {object} options session and queue lifecycle dependencies
 * @returns {object} shared request/admission and disposal interface
 */
const createHistoryCommandQueue = ({
    session,
    isAvailable = () => true,
    canWait = () => false,
    onActiveChange = () => {}
}) => {
    const pending = [];
    let active = false;
    let detached = false;
    const canApply = direction => (direction === 'redo' ? session.canRedo() : session.canUndo());
    const canRequest = direction => Boolean(!detached && isAvailable() &&
        (active || canApply(direction) || canWait() || session.hasPendingHistoryBoundary?.()));
    const clearPending = error => {
        for (const request of pending.splice(0)) {
            if (error) request.reject(error);
            else request.resolve(null);
        }
    };
    const drain = async () => {
        active = true;
        onActiveChange(true);
        try {
            while (pending.length) {
                if (detached) break;
                const request = pending.shift();
                try {
                    if (!isAvailable()) {
                        request.resolve(null);
                        clearPending();
                        break;
                    }
                    if (session.prepareHistoryCommand) await session.prepareHistoryCommand(request.direction);
                    if (detached || !isAvailable() || !canApply(request.direction)) {
                        request.resolve(null);
                        continue;
                    }
                    const result = await session[request.direction]({
                        ...request.options,
                        lifecyclePresentation: pending.length === 0
                    });
                    request.resolve(result);
                    if (result?.matches === false) clearPending();
                } catch (error) {
                    // Later requests assumed this operation succeeded. Do not
                    // carry them across a restored/failed history boundary.
                    request.reject(error);
                    clearPending(error);
                }
            }
        } finally {
            active = false;
            onActiveChange(false);
        }
    };
    return {
        canRequest,
        request: (direction, options = {}) => {
            if (!['undo', 'redo'].includes(direction)) {
                return Promise.reject(new Error(`Unknown history command: ${direction}`));
            }
            if (!canRequest(direction)) return Promise.resolve(null);
            const result = new Promise((resolve, reject) => pending.push({direction, options, resolve, reject}));
            if (active) session.finishHistoryPresentation?.();
            else drain();
            return result;
        },
        detach: () => {
            detached = true;
            clearPending();
        }
    };
};

export {createHistoryCommandQueue};
