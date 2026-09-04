const controllers = new WeakMap();

/**
 * Coalesce a long-lived editor visit into one checkpoint-backed Studio
 * operation. The capture opens only after its before-boundary is durable;
 * mutations then run serially until the editor closes the session.
 *
 * @param {object} options controller dependencies
 * @param {Function} options.captureOperation checkpoint-backed capture function
 * @param {Function} [options.beforeCapture] wait for Studio initialization
 * @param {Function} [options.completeOperation] derive operation metadata
 * @returns {object} project edit session controller
 */
const createStudioProjectEditSessionController = ({
    captureOperation,
    beforeCapture = () => Promise.resolve(),
    completeOperation = () => ({})
}) => {
    const records = new Map();
    let activeRecord = null;
    let nextToken = 1;
    let sequence = Promise.resolve();

    const settleReady = (record, error) => {
        if (record.readySettled) return;
        record.readySettled = true;
        if (error) record.rejectReady(error);
        else record.resolveReady();
    };

    const requestClose = (record, error = null) => {
        record.closeRequest = {error};
        if (!record.resolveClose) return;
        if (error) record.rejectClose(error);
        else record.resolveClose();
    };

    const finishRecord = record => {
        if (!record) return Promise.resolve();
        if (record.finishPromise) return record.finishPromise;
        record.ended = true;
        record.finishPromise = record.mutationTail.then(
            () => record.readyPromise.then(() => requestClose(record)),
            mutationError => record.readyPromise.then(
                () => requestClose(record, mutationError),
                () => {}
            )
        )
            .then(() => record.capturePromise)
            .finally(() => {
                records.delete(record.token);
                if (activeRecord === record) activeRecord = null;
            });
        // Paint callbacks and component teardown do not await this promise.
        // Keep the rejection observable to explicit callers without producing
        // an unhandled browser rejection in those fire-and-forget paths.
        record.finishPromise.catch(() => {});
        return record.finishPromise;
    };

    const begin = operation => {
        if (!operation || !operation.targetId) return null;
        if (activeRecord && !activeRecord.ended) finishRecord(activeRecord);
        const token = {id: `project-edit-session-${nextToken++}`};
        let resolveReady;
        let rejectReady;
        const readyPromise = new Promise((resolve, reject) => {
            resolveReady = resolve;
            rejectReady = reject;
        });
        // A capture can fail before any mutation or end call observes ready.
        // Attach a rejection handler immediately while preserving the original
        // promise for callers which must stop rather than mutate unrecorded.
        readyPromise.catch(() => {});
        const record = {
            token,
            operation,
            readyPromise,
            resolveReady,
            rejectReady,
            readySettled: false,
            mutationTail: Promise.resolve(),
            resolveClose: null,
            rejectClose: null,
            closeRequest: null,
            capturePromise: null,
            finishPromise: null,
            ended: false
        };
        records.set(token, record);
        activeRecord = record;
        const previous = sequence;
        record.capturePromise = previous.then(async () => {
            await beforeCapture();
            const closePromise = new Promise((resolve, reject) => {
                record.resolveClose = resolve;
                record.rejectClose = reject;
                if (record.closeRequest) {
                    if (record.closeRequest.error) reject(record.closeRequest.error);
                    else resolve();
                }
            });
            return captureOperation(
                operation,
                () => {
                    settleReady(record);
                    return closePromise;
                },
                result => completeOperation(operation, result)
            );
        }).catch(error => {
            settleReady(record, error);
            throw error;
        });
        // A later session cannot start its before-boundary until this one has
        // fully captured or rolled back.
        sequence = record.capturePromise.catch(() => {});
        return token;
    };

    return {
        begin,
        mutate: (token, mutate) => {
            const record = records.get(token);
            if (!record) return Promise.resolve();
            if (record.ended) return record.finishPromise || Promise.resolve();
            record.mutationTail = record.mutationTail
                .then(() => record.readyPromise)
                .then(() => mutate());
            record.mutationTail.catch(() => {});
            return record.mutationTail;
        },
        end: token => finishRecord(records.get(token)),
        closeActive: () => finishRecord(activeRecord),
        hasOpen: () => Boolean(activeRecord),
        detach: () => finishRecord(activeRecord)
    };
};

const attachStudioProjectEditSessionController = (vm, controller) => {
    if (!vm || !controller) return {detach: () => {}};
    controllers.set(vm, controller);
    return {
        detach: () => {
            if (controllers.get(vm) === controller) controllers.delete(vm);
        }
    };
};

const beginStudioProjectEditSession = (vm, operation) => {
    const controller = vm && controllers.get(vm);
    return controller && typeof controller.begin === 'function' ? controller.begin(operation) : null;
};

const runStudioProjectEditMutation = (vm, token, mutate) => {
    const controller = vm && controllers.get(vm);
    if (!controller || !token || typeof controller.mutate !== 'function') return mutate();
    return controller.mutate(token, mutate);
};

const endStudioProjectEditSession = (vm, token) => {
    const controller = vm && controllers.get(vm);
    if (!controller || !token || typeof controller.end !== 'function') return Promise.resolve();
    return controller.end(token);
};

export {
    attachStudioProjectEditSessionController,
    beginStudioProjectEditSession,
    createStudioProjectEditSessionController,
    endStudioProjectEditSession,
    runStudioProjectEditMutation
};
