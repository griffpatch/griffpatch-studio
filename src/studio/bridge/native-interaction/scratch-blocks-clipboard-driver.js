import {resolveWorkspaceBlockId} from '../workspace-block-reference';
import {combinePointerTravels, dispatchMouseSelection} from './dom-interaction';
import {createElementPointerTarget} from './pointer-target';
import {activateThroughPointer} from './pointer-activation';
import {selectScratchTargetThroughPointer} from './scratch-target-selection-driver';

const blockCount = workspace => workspace.getAllBlocks(false).length;

const waitForAddedBlocks = async ({workspace, before, documentObject, signal, frameLimit = 120}) => {
    for (let frame = 0; frame < frameLimit; frame += 1) {
        if (blockCount(workspace) > before) return true;
        if (signal && signal.aborted) return false;
        await new Promise(resolve => documentObject.defaultView.requestAnimationFrame(resolve));
    }
    return false;
};

/**
 * Replay Scratch's deterministic, in-workspace clipboard. The virtual pointer
 * selects the durable source block; Scratch Blocks remains responsible for
 * copying, regenerating IDs, collision offsetting and firing the grouped create.
 * No operating-system clipboard is read or written.
 *
 * @param {object} options native interaction dependencies
 * @returns {object} clipboard interaction driver
 */
const createScratchBlocksClipboardDriver = ({
    workspace,
    vm,
    ScratchBlocks,
    documentObject,
    clock,
    pointer,
    scope,
    blockDriver,
    afterTargetSelection = null
}) => ({
    cleanup: () => false,
    play: async (plan, signal = null) => {
        const selectedTarget = await selectScratchTargetThroughPointer({
            vm,
            item: plan,
            documentObject,
            clock,
            pointer,
            scope,
            afterTargetSelection,
            signal
        });
        if (selectedTarget.status !== 'verified') {
            return selectedTarget.status === 'cancelled' ? {
                cancelled: true,
                pointerTravel: selectedTarget.pointerTravel || null
            } : {
                unsupported: true,
                reason: selectedTarget.reason || 'the clipboard target is unavailable'
            };
        }
        const sourceId = resolveWorkspaceBlockId(workspace, plan.sourceBlockRef, null);
        const sourceBlock = sourceId && workspace.getBlockById(sourceId);
        const sourceRoot = sourceBlock && sourceBlock.getSvgRoot && sourceBlock.getSvgRoot();
        if (!sourceBlock || !sourceRoot ||
            (plan.sourceBlockType && sourceBlock.type !== plan.sourceBlockType)) {
            return {unsupported: true, reason: 'the recorded clipboard source block is unavailable'};
        }
        const sourceTravel = await pointer.travelTo(createElementPointerTarget({
            id: `workspace-clipboard-source:${sourceBlock.id}`,
            kind: 'workspace-block',
            locate: () => sourceBlock.getSvgRoot(),
            anchorX: 16,
            anchorY: 18
        }), {clock, signal});
        if (!sourceTravel.completed) return {cancelled: true, pointerTravel: sourceTravel};
        const clicked = await activateThroughPointer({
            pointer,
            clock,
            signal,
            activate: () => scope.runWithoutUndo(() => dispatchMouseSelection(
                sourceTravel.target.element,
                sourceTravel.target.point
            ))
        });
        if (!clicked) return {cancelled: true, pointerTravel: sourceTravel};
        const beforeCount = blockCount(workspace);
        scope.runWithoutUndo(() => {
            ScratchBlocks.copy_(sourceBlock);
            const coordinate = plan.pasteCoordinate || (plan.destination && plan.destination.coordinate);
            if (coordinate && ScratchBlocks.clipboardXml_ && ScratchBlocks.clipboardXml_.setAttribute) {
                ScratchBlocks.clipboardXml_.setAttribute('x', String(coordinate.x));
                ScratchBlocks.clipboardXml_.setAttribute('y', String(coordinate.y));
            }
            workspace.paste(ScratchBlocks.clipboardXml_);
        });
        scope.flushPendingEvents();
        const createEvent = scope.observed && scope.observed.slice()
            .reverse()
            .find(event => event && event.type === 'create' && Array.isArray(event.ids));
        const liveIds = createEvent ? createEvent.ids : [];
        const idAliases = liveIds.length === plan.blockIds.length ? Object.fromEntries(
            plan.blockIds.map((recordedId, index) => [recordedId, liveIds[index]])
        ) : {};
        const settled = await waitForAddedBlocks({
            workspace,
            before: beforeCount,
            documentObject,
            signal
        });
        if (plan.placement && settled) {
            const liveRootId = idAliases[plan.placement.blockId];
            if (!liveRootId || !workspace.getBlockById(liveRootId) || !blockDriver) {
                throw new Error('Clipboard placement requires the native copied-root identity');
            }
            // The copy and its placement share one isolation/verification scope.
            // Reuse the same native drag and target-only preview as other moves.
            const placed = await blockDriver.play({
                ...plan.placement,
                blockId: liveRootId,
                affectedBlocks: plan.placement.affectedBlocks.map(affected => ({
                    ...affected,
                    blockId: idAliases[affected.blockId] || affected.blockId
                }))
            }, signal);
            return {
                ...placed,
                idAliases,
                pointerTravel: combinePointerTravels({source: sourceTravel, placement: placed.pointerTravel})
            };
        }
        return {
            frames: [],
            pointerTravel: sourceTravel,
            controlsVisible: true,
            sourceBlockId: sourceBlock.id,
            sourceBlockCount: plan.copiedBlockCount,
            targetBlockCount: blockCount(workspace),
            idAliases,
            projectMatches: Boolean(settled)
        };
    }
});

export {createScratchBlocksClipboardDriver};
