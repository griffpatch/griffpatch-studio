import {createInteractionClock} from './native-interaction/interaction-clock';
import {createPointerController} from './native-interaction/pointer-controller';
import {createPointerOverlay} from './native-interaction/pointer-overlay';
import {createPointerModelByName} from './native-interaction/pointer-models';
import {createElementPointerTarget, createPointerTargetResolver} from './native-interaction/pointer-target';
import {createPlaybackEventScope} from './native-interaction/playback-event-scope';
import {selectScratchTargetThroughPointer} from './native-interaction/scratch-target-selection-driver';
import {presentSpriteCreation} from './native-interaction/sprite-creation-presentation';

// Only travel pacing is accelerated. Sprite clicks retain a readable stop.
// Block motion keeps the existing history clock, and every intermediate
// history state is still applied.
const HISTORY_POINTER_SPEED = 3;

const createHistoryPointerPresentation = ({
    workspace, vm, ScratchBlocks, documentObject, journalCounts,
    enabled = true, pointerModelName = 'natural',
    createClock = createInteractionClock, createOverlay = createPointerOverlay,
    createControl = createPointerController, createScope = createPlaybackEventScope,
    selectTarget = selectScratchTargetThroughPointer,
    presentCreation = presentSpriteCreation
}) => {
    const clock = createClock();
    const resolver = createPointerTargetResolver();
    let pointer = null;
    let interrupted = false;
    let controller = new AbortController();
    const available = () => enabled && !interrupted;
    const acquire = () => {
        if (pointer && !pointer.element?.parentNode) pointer = null;
        if (!pointer) {
            pointer = createControl({
                overlay: createOverlay({documentObject}), model: createPointerModelByName(pointerModelName)
            });
        }
        // Reusing an idle cursor must cancel its old fade/removal timer before
        // a fresh journey starts, including a long or slow sprite selection.
        pointer.show();
        return pointer;
    };
    const dismiss = () => {
        if (pointer) pointer.remove();
        pointer = null;
    };
    const finishActive = () => {
        interrupted = true;
        controller.abort();
        clock.cancel();
        if (pointer) {
            pointer.release();
            pointer.hide();
        }
    };
    const blockTarget = block => createElementPointerTarget({
        id: `history-block:${block.id}`,
        kind: 'workspace-block',
        locate: () => block.getSvgRoot(),
        anchorX: 16,
        anchorY: 18
    });
    return {
        isEnabled: () => enabled,
        setEnabled: value => {
            enabled = Boolean(value);
            if (!enabled) {
                finishActive();
                dismiss();
            }
        },
        begin: ({animate = true} = {}) => {
            controller = new AbortController();
            interrupted = !animate;
            if (!animate) dismiss();
        },
        finishActive,
        dismiss,
        presentProjectRestore: async ({transaction, direction, restore, speed = 1}) => {
            if (!available() || !documentObject?.createElement ||
                transaction.operation?.type !== 'sprite-create' || direction !== 'forward') {
                return {status: 'unsupported'};
            }
            let scope;
            try {
                clock.setSpeed(HISTORY_POINTER_SPEED * speed);
                scope = createScope({workspace, ScratchBlocks, documentObject, journalCounts});
                const result = await presentCreation({
                    transaction,
                    direction,
                    restore,
                    vm,
                    documentObject,
                    pointer: acquire(),
                    clock,
                    signal: controller.signal,
                    clickSpeed: speed
                });
                // Catch-up skips presentation, not the requested history edit.
                return result.status === 'cancelled' ? {...result, status: 'skipped'} : result;
            } finally {
                if (scope) scope.detach();
                if (pointer && available()) pointer.idle();
            }
        },
        selectTarget: async (item, {speed = 1} = {}) => {
            if (!available() || !documentObject?.createElement) return {status: 'unsupported'};
            let scope;
            try {
                clock.setSpeed(HISTORY_POINTER_SPEED * speed);
                scope = createScope({workspace, ScratchBlocks, documentObject, journalCounts});
                return await selectTarget({
                    vm,
                    item,
                    documentObject,
                    clock,
                    pointer: acquire(),
                    scope,
                    signal: controller.signal,
                    clickSpeed: speed
                });
            } finally {
                if (scope) scope.detach();
                if (pointer && available()) pointer.idle();
            }
        },
        beginBlock: async (block, speed = 1) => {
            if (!available()) return;
            clock.setSpeed(HISTORY_POINTER_SPEED * speed);
            const travel = await acquire().travelTo(blockTarget(block), {clock, signal: controller.signal});
            if (travel.completed && available()) pointer.press();
        },
        followBlock: block => {
            if (available() && pointer) pointer.moveTo(resolver.resolve(blockTarget(block)).point);
        },
        endBlock: () => {
            if (pointer) {
                pointer.release();
                pointer.settle();
                if (available()) pointer.idle();
            }
        },
        detach: () => {
            finishActive();
            dismiss();
        }
    };
};

export {createHistoryPointerPresentation, HISTORY_POINTER_SPEED};
