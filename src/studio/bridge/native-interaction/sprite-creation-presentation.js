import {createElementPointerTarget} from './pointer-target';
import {activateThroughPointer} from './pointer-activation';
import {placePointerAtCurrentTarget} from './scratch-target-selection-driver';

// Presentation only: the caller owns the exact checkpoint mutation and its
// editing context. Play and history use the same Add target and click timing.
const presentSpriteCreation = async ({
    transaction, direction, vm, documentObject, pointer, clock, restore, signal = null, clickSpeed = null
}) => {
    if (transaction.operation?.type !== 'sprite-create' || direction !== 'forward') {
        return {status: 'unsupported'};
    }
    const placed = await placePointerAtCurrentTarget({vm, documentObject, pointer, clock, signal});
    if (!placed.completed) return {status: 'cancelled'};
    const pointerTravel = await pointer.travelTo(createElementPointerTarget({
        id: 'sprite-library-open',
        kind: 'sprite-create',
        locate: () => documentObject.querySelector('[data-studio-target="sprite-library-open"]')
    }), {clock, signal});
    if (!pointerTravel.completed) return {status: 'cancelled'};
    const completed = await activateThroughPointer({
        pointer, clock, signal, targetKind: 'sprite-create', speed: clickSpeed, activate: restore
    });
    return {
        status: completed ? 'presented' : 'cancelled',
        plan: {kind: 'snapshot-sprite-create', transactionId: transaction.id},
        evidence: {pointerTravel, mutation: 'verified-checkpoint'}
    };
};

export {presentSpriteCreation};
