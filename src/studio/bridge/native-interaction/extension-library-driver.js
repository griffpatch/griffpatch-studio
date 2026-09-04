import {combinePointerTravels, dispatchMouseSelection} from './dom-interaction';
import {createElementPointerTarget} from './pointer-target';
import {activateThroughPointer} from './pointer-activation';

const TARGET_ATTRIBUTE = 'data-studio-target';
const LIBRARY_KEY_ATTRIBUTE = 'data-studio-library-key';

const escapedAttributeValue = value => String(value)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"');
const attributeTarget = (documentObject, attribute, value) => documentObject.querySelector(
    `[${attribute}="${escapedAttributeValue(value)}"]`
);

const waitFor = async (locate, documentObject, signal, frameLimit = 180) => {
    for (let frame = 0; frame < frameLimit; frame += 1) {
        const value = locate();
        if (value) return value;
        if (signal && signal.aborted) return null;
        await new Promise(resolve => documentObject.defaultView.requestAnimationFrame(resolve));
    }
    return null;
};

const clickThroughPointer = async ({pointer, clock, signal, scope, id, kind, locate}) => {
    const travel = await pointer.travelTo(createElementPointerTarget({id, kind, locate}), {clock, signal});
    if (!travel.completed) return travel;
    const completed = await activateThroughPointer({
        pointer,
        clock,
        signal,
        activate: () => scope.runWithoutUndo(() => dispatchMouseSelection(
            travel.target.element,
            travel.target.point
        ))
    });
    return {...travel, completed};
};

const extensionIdForBlockType = (vm, blockType) => {
    const separator = typeof blockType === 'string' ? blockType.indexOf('_') : -1;
    if (separator < 1 || !vm || !vm.extensionManager) return null;
    const extensionId = blockType.slice(0, separator);
    return vm.extensionManager.isBuiltinExtension(extensionId) ? extensionId : null;
};

/**
 * @param {object} workspace Scratch Blocks workspace
 * @param {string} blockType expected extension block type
 * @returns {?object} visibly rendered flyout block
 */
const visibleFlyoutBlock = (workspace, blockType) => {
    const flyout = workspace && workspace.getFlyout && workspace.getFlyout();
    const flyoutWorkspace = flyout && flyout.getWorkspace && flyout.getWorkspace();
    if (!flyoutWorkspace) return null;
    return flyoutWorkspace.getAllBlocks(false).find(block => {
        if (block.type !== blockType || block.disabled) return false;
        const root = block.getSvgRoot && block.getSvgRoot();
        const rect = root && root.getBoundingClientRect && root.getBoundingClientRect();
        return rect && rect.width > 0 && rect.height > 0;
    }) || null;
};

/**
 * Make a built-in extension available before replay asks Blockly for one of
 * its flyout blocks. A restored base project may contain no extension opcodes,
 * so a clean reload must traverse the real extension library first.
 *
 * @param {object} options interaction dependencies
 * @returns {object} extension preparation driver
 */
const createExtensionLibraryDriver = ({vm, workspace = null, documentObject, clock, pointer, scope}) => ({
    ensureForBlock: async (blockType, signal = null) => {
        const extensionId = extensionIdForBlockType(vm, blockType);
        if (!extensionId || vm.extensionManager.isExtensionLoaded(extensionId)) {
            return {cancelled: false, extensionId, loaded: false, pointerTravel: null};
        }

        const travels = {};
        const openLocator = () => attributeTarget(
            documentObject,
            TARGET_ATTRIBUTE,
            'extension-library-open'
        );
        const openControl = await waitFor(openLocator, documentObject, signal);
        if (!openControl) throw new Error('Extension library control is unavailable');
        travels.open = await clickThroughPointer({
            pointer,
            clock,
            signal,
            scope,
            id: 'extension-library-open',
            kind: 'library-open',
            locate: openLocator
        });
        if (!travels.open.completed) {
            return {cancelled: true, extensionId, loaded: false, pointerTravel: combinePointerTravels(travels)};
        }

        const itemLocator = () => attributeTarget(
            documentObject,
            LIBRARY_KEY_ATTRIBUTE,
            extensionId
        );
        const item = await waitFor(itemLocator, documentObject, signal);
        if (!item) throw new Error(`Extension library item is unavailable: ${extensionId}`);
        if (typeof item.scrollIntoView === 'function') item.scrollIntoView({block: 'center', inline: 'center'});
        travels.item = await clickThroughPointer({
            pointer,
            clock,
            signal,
            scope,
            id: `extension-library-item:${extensionId}`,
            kind: 'library-item',
            locate: itemLocator
        });
        if (!travels.item.completed) {
            return {cancelled: true, extensionId, loaded: false, pointerTravel: combinePointerTravels(travels)};
        }

        const loaded = await waitFor(
            () => vm.extensionManager.isExtensionLoaded(extensionId),
            documentObject,
            signal
        );
        if (!loaded) throw new Error(`Extension did not finish loading: ${extensionId}`);
        if (workspace) {
            const visibleBlock = await waitFor(
                () => visibleFlyoutBlock(workspace, blockType),
                documentObject,
                signal
            );
            if (!visibleBlock) throw new Error(`Extension flyout did not become visible: ${extensionId}`);
        }
        return {
            cancelled: false,
            extensionId,
            loaded: true,
            pointerTravel: combinePointerTravels(travels)
        };
    }
});

export {
    createExtensionLibraryDriver,
    extensionIdForBlockType,
    visibleFlyoutBlock
};
