import {selectedToolboxCategoryId} from './ui-state';
import {resolveWorkspaceBlockId} from '../workspace-block-reference';

const DEFAULT_SCROLL_FRAME_LIMIT = 30;
const DEFAULT_REFRESH_FRAME_LIMIT = 60;
const PICKUP_DISTANCE_PX = 32;
const BLOCK_REVEAL_PADDING = 16;

const nextFrame = () => new Promise(resolve => {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(resolve);
    else setTimeout(resolve, 0);
});

const waitForFlyoutScroll = async (flyout, frameLimit = DEFAULT_SCROLL_FRAME_LIMIT) => {
    for (let frame = 0; frame < frameLimit && flyout.scrollTarget !== null; frame += 1) {
        await nextFrame();
    }
    if (flyout.scrollTarget !== null) throw new Error('Flyout category scroll did not settle');
};

const categoryForBlock = (flyout, block) => {
    const position = block.getRelativeToSurfaceXY();
    const axis = flyout.horizontalLayout_ ? position.x : position.y;
    return [...(flyout.categoryScrollPositions || [])]
        .reverse()
        .find(category => axis >= category.position) || null;
};

const pickupDelta = flyout => {
    const candidates = [
        {x: PICKUP_DISTANCE_PX, y: 0},
        {x: -PICKUP_DISTANCE_PX, y: 0},
        {x: 0, y: PICKUP_DISTANCE_PX},
        {x: 0, y: -PICKUP_DISTANCE_PX}
    ];
    if (!flyout.isScrollable || !flyout.isScrollable()) return candidates[0];
    return candidates.find(delta => flyout.isDragTowardWorkspace(delta)) || candidates[0];
};

const aliasedValue = (aliases, value) => {
    if (!aliases || value === null || typeof value === 'undefined') return value;
    if (typeof aliases.get === 'function') return aliases.get(value) || value;
    return aliases[value] || value;
};

const directChild = (element, tagName) => Array.from(
    (element && (element.childNodes || element.children)) || []
).filter(child => child && child.tagName)
    .find(child => String(child.tagName).toLowerCase() === tagName) || null;

const directChildren = (element, tagName) => Array.from(
    (element && (element.childNodes || element.children)) || []
).filter(child => child && child.tagName && String(child.tagName).toLowerCase() === tagName);

const prototypeIdentity = (ScratchBlocks, xml) => {
    if (!ScratchBlocks || !ScratchBlocks.Xml || typeof ScratchBlocks.Xml.textToDom !== 'function' || !xml) {
        return null;
    }
    const root = ScratchBlocks.Xml.textToDom(xml);
    if (!root) throw new Error('Recorded flyout prototype XML is invalid');
    const fields = directChildren(root, 'field')
        .map(field => ({
            name: field.getAttribute('name'),
            id: field.getAttribute('id'),
            value: field.textContent
        }))
        .filter(field => field.name);
    const mutation = directChild(root, 'mutation');
    const proccode = mutation && mutation.getAttribute('proccode');
    if (!fields.length && !proccode) return null;
    return {fields, proccode: proccode || null};
};

const matchesPrototypeIdentity = (block, identity, aliases) => {
    if (!identity) return false;
    const fieldsMatch = identity.fields.every(expected => {
        const field = block.getField && block.getField(expected.name);
        if (!field || typeof field.getValue !== 'function') return false;
        const recorded = expected.id || expected.value;
        return String(field.getValue()) === String(aliasedValue(aliases, recorded));
    });
    if (!fieldsMatch) return false;
    if (!identity.proccode) return true;
    const mutation = block.mutationToDom && block.mutationToDom();
    return Boolean(mutation && mutation.getAttribute('proccode') === identity.proccode);
};

const resolvePrototype = ({candidates, plan, ScratchBlocks, aliases}) => {
    if (candidates.length <= 1) return candidates;
    const identity = prototypeIdentity(ScratchBlocks, plan.prototypeXml);
    if (!identity) return candidates;
    return candidates.filter(block => matchesPrototypeIdentity(block, identity, aliases));
};

/**
 * Contain the pinned Scratch Blocks flyout seams used by realistic Play.
 * Resolve a live flyout prototype by opcode and, where necessary, the stable
 * field/mutation identity captured in the authored root XML.
 *
 * @param {object} options adapter dependencies
 * @returns {object} flyout interaction port
 */
const createScratchBlocksFlyoutPort = ({workspace, ScratchBlocks = null, aliases = new Map()}) => ({
    prepare: async plan => {
        if (plan.origin?.kind === 'workspace-copy') {
            const source = plan.origin;
            const block = workspace.getBlockById(aliasedValue(aliases, source.blockId)) ||
                workspace.getBlockById(resolveWorkspaceBlockId(workspace, source.blockRef, source.blockId));
            if (!block || !block.isShadow() || block.type !== plan.blockType ||
                !matchesPrototypeIdentity(block, prototypeIdentity(ScratchBlocks, plan.prototypeXml), aliases)) {
                throw new Error('Recorded workspace copy source is unavailable or changed');
            }
            return {block, sourceWorkspace: workspace, flyout: null, category: null};
        }
        let flyout = workspace.getFlyout && workspace.getFlyout();
        let flyoutWorkspace = flyout && flyout.getWorkspace && flyout.getWorkspace();
        if (!flyout || !flyoutWorkspace) throw new Error('Native flyout is unavailable');
        let candidates = flyoutWorkspace.getAllBlocks(false)
            .filter(block => block.type === plan.blockType && !block.disabled);
        for (let frame = 0; !candidates.length && frame < DEFAULT_REFRESH_FRAME_LIMIT; frame += 1) {
            await nextFrame();
            flyout = workspace.getFlyout && workspace.getFlyout();
            flyoutWorkspace = flyout && flyout.getWorkspace && flyout.getWorkspace();
            if (!flyout || !flyoutWorkspace) continue;
            candidates = flyoutWorkspace.getAllBlocks(false)
                .filter(block => block.type === plan.blockType && !block.disabled);
        }
        const typedCandidateCount = candidates.length;
        candidates = resolvePrototype({candidates, plan, ScratchBlocks, aliases});
        if (candidates.length !== 1) {
            const reason = typedCandidateCount && !candidates.length ? 'identity missing' :
                (candidates.length ? 'ambiguous' : 'missing');
            throw new Error(`Native flyout block type is ${reason}: ${plan.blockType}`);
        }
        const block = candidates[0];
        const category = categoryForBlock(flyout, block);
        const toolbox = workspace.getToolbox && workspace.getToolbox();
        if (category && category.categoryId && toolbox && toolbox.setSelectedCategoryById &&
            selectedToolboxCategoryId(toolbox) !== category.categoryId) {
            toolbox.setSelectedCategoryById(category.categoryId);
            await waitForFlyoutScroll(flyout);
        }
        let root = block.getSvgRoot && block.getSvgRoot();
        if ((!root || !root.getBoundingClientRect().width) && typeof flyout.scrollTo === 'function') {
            const position = block.getRelativeToSurfaceXY();
            const axis = flyout.horizontalLayout_ ? position.x : position.y;
            flyout.scrollTo(Math.max(0, axis - BLOCK_REVEAL_PADDING));
            await waitForFlyoutScroll(flyout);
            root = block.getSvgRoot && block.getSvgRoot();
        }
        if (!root || !root.getBoundingClientRect().width) {
            throw new Error(`Native flyout block is not visible: ${plan.blockType}`);
        }
        return {flyout, block, category};
    },
    beginGesture: ({flyout, block, event}) => {
        const gesture = workspace.getGesture(event);
        if (!gesture) throw new Error('Scratch Blocks refused the flyout gesture');
        gesture.setStartBlock(block);
        if (flyout) gesture.handleFlyoutStart(event, flyout);
        else gesture.handleWsStart(event, workspace);
        return gesture;
    },
    pickupPoint: ({flyout, start}) => {
        const delta = flyout ? pickupDelta(flyout) : {x: PICKUP_DISTANCE_PX, y: 0};
        return {x: start.x + delta.x, y: start.y + delta.y};
    },
    createdBlock: gesture => gesture.getDraggedBlock()
});

export {
    BLOCK_REVEAL_PADDING,
    DEFAULT_REFRESH_FRAME_LIMIT,
    DEFAULT_SCROLL_FRAME_LIMIT,
    PICKUP_DISTANCE_PX,
    categoryForBlock,
    createScratchBlocksFlyoutPort,
    matchesPrototypeIdentity,
    prototypeIdentity,
    waitForFlyoutScroll
};
