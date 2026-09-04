// Project snapshots carry their editing context separately from the target
// whose data changed (notably when copying a script to another sprite).
const historyTargetReference = (transaction, direction) => {
    if (transaction.kind !== 'project-operation') return transaction;
    const operation = transaction.operation;
    return direction === 'forward' ? {
        targetId: operation.afterEditingTargetId,
        targetRef: operation.afterEditingTargetRef
    } : {
        targetId: operation.beforeEditingTargetId,
        targetRef: operation.beforeEditingTargetRef
    };
};

const retainsEditingTarget = transaction => {
    const operation = transaction.operation;
    return Boolean(transaction.kind === 'project-operation' && operation.beforeEditingTargetId &&
        operation.beforeEditingTargetId === operation.afterEditingTargetId);
};

// A rename changes the portable name, not the sprite the user is looking at.
// Select the incoming identity before the edit and restore its outgoing name
// before paint. Created/deleted sprites do not share this identity boundary.
const historyTargetBeforeApply = (transaction, direction) => historyTargetReference(
    transaction, retainsEditingTarget(transaction) ? (direction === 'forward' ? 'backward' : 'forward') : direction
);

export {historyTargetBeforeApply, historyTargetReference, retainsEditingTarget};
