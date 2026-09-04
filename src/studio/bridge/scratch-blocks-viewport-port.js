import {createViewportMotion} from './viewport-motion';
import {resolveWorkspaceBlockId} from './workspace-block-reference';
import {analyzeTransactionEffects} from '../replay/transaction-effects';
import {compileHistoryPresentationPlan} from './history-presentation-plan';

const emptyPort = Object.freeze({
    beginTransaction: () => {},
    capture: () => null,
    observeBeforeAction: () => {},
    prepareBeforeAction: () => Promise.resolve(false),
    focusTransaction: () => Promise.resolve(false),
    ensureInteractionVisible: () => Promise.resolve(false),
    cancel: () => {},
    stop: () => {},
    detach: () => {}
});

const VIEW_MARGIN = 64;
const SIDE_MARGIN = 32;
const EDIT_BOTTOM_MARGIN = 96;
const OVERSIZED_EDIT_BOTTOM_RATIO = 0.48;
const PRE_CREATE_CAMERA_MODES = Object.freeze({
    WAIT: 'wait',
    CONCURRENT: 'concurrent',
    OFF: 'off'
});
const VIEWPORT_PRESENTATION_MODES = Object.freeze({
    PRESERVE: 'preserve',
    RECORDED: 'recorded',
    REVEAL: 'reveal'
});

/**
 * Give Studio a full viewport of scrollable parking space around the blocks.
 * Scratch Blocks already supplies half a viewport; adding another half on
 * each side lets the camera compose a shot without the scrollbar clamping it
 * back when the block bounds change during a connection.
 *
 * This is deliberately installed only for the Studio session lifetime. It
 * changes navigation bounds, not the saved coordinates of any script.
 *
 * @param {object} workspace visible Scratch Blocks workspace
 * @returns {Function} idempotent restore function
 */
const installExpandedScrollRegion = workspace => {
    if (!workspace || typeof workspace.getMetrics !== 'function') return () => {};
    const originalGetMetrics = workspace.getMetrics;
    const refresh = () => {
        if (typeof workspace.resizeContents === 'function') workspace.resizeContents();
        if (workspace.scrollbar && typeof workspace.scrollbar.resize === 'function') {
            workspace.scrollbar.resize();
        }
        if (typeof workspace.resize === 'function') workspace.resize();
    };
    workspace.getMetrics = function () {
        const metrics = originalGetMetrics.call(this);
        if (!metrics) return metrics;
        const extraLeft = metrics.viewWidth / 2;
        const extraTop = metrics.viewHeight / 2;
        return {
            ...metrics,
            contentLeft: metrics.contentLeft - extraLeft,
            contentTop: metrics.contentTop - extraTop,
            contentWidth: metrics.contentWidth + metrics.viewWidth + (metrics.toolboxWidth || 0),
            contentHeight: metrics.contentHeight + metrics.viewHeight
        };
    };
    refresh();
    let restored = false;
    return () => {
        if (restored) return;
        restored = true;
        workspace.getMetrics = originalGetMetrics;
        refresh();
    };
};

const blockFrame = (workspace, block) => {
    const position = block.getRelativeToSurfaceXY();
    const size = block.getHeightWidth();
    const left = workspace.RTL ? position.x - size.width : position.x;
    return {
        bottom: position.y + (block.height || size.height),
        left,
        right: left + size.width,
        top: position.y
    };
};

const blockTreeFrame = (workspace, root) => {
    const descendants = typeof root.getDescendants === 'function' ? root.getDescendants() : [root];
    return descendants.reduce((frame, block) => {
        const next = blockFrame(workspace, block);
        if (!frame) return next;
        return {
            bottom: Math.max(frame.bottom, next.bottom),
            left: Math.min(frame.left, next.left),
            right: Math.max(frame.right, next.right),
            top: Math.min(frame.top, next.top)
        };
    }, null) || blockFrame(workspace, root);
};

const renderedBlockVisibility = (workspace, block) => {
    const root = block.getSvgRoot && block.getSvgRoot();
    const parentSvg = workspace.getParentSvg && workspace.getParentSvg();
    if (!root || !parentSvg || !root.getBoundingClientRect || !parentSvg.getBoundingClientRect) return null;
    const blockRect = root.getBoundingClientRect();
    const workspaceRect = parentSvg.getBoundingClientRect();
    const metrics = workspace.getMetrics();
    const left = workspaceRect.left + (workspace.RTL ? 0 : metrics.toolboxWidth || 0);
    const right = workspaceRect.right - (workspace.RTL ? metrics.toolboxWidth || 0 : 0);
    return blockRect.left >= left && blockRect.right <= right &&
        blockRect.top >= workspaceRect.top && blockRect.bottom <= workspaceRect.bottom;
};

const transactionFrame = (workspace, block) => {
    const root = typeof block.getRootBlock === 'function' ? block.getRootBlock() : block;
    return {
        focus: blockFrame(workspace, block),
        root: blockTreeFrame(workspace, root),
        renderedVisible: renderedBlockVisibility(workspace, block)
    };
};

const recordedViewportTarget = (workspace, viewport) => {
    const metrics = workspace.getMetrics();
    const scale = workspace.scale;
    return {
        x: (viewport.viewLeft * scale) - metrics.contentLeft,
        y: (viewport.viewTop * scale) - metrics.contentTop
    };
};

const transactionViewportTarget = (workspace, frame) => {
    const metrics = workspace.getMetrics();
    const scale = workspace.scale;
    const root = frame.root;
    const focus = frame.focus;
    const rootTop = Math.min(
        VIEW_MARGIN,
        metrics.viewHeight - VIEW_MARGIN - ((focus.bottom - root.top) * scale)
    );
    const focusWidthFromRoot = workspace.RTL ? root.right - focus.left : focus.right - root.left;
    const rootSide = Math.min(
        VIEW_MARGIN,
        metrics.viewWidth - VIEW_MARGIN - (focusWidthFromRoot * scale)
    );
    const rootPixelX = (workspace.RTL ? root.right : root.left) * scale;
    const rootScreenX = workspace.RTL ? metrics.viewWidth - rootSide : rootSide;
    return {
        x: rootPixelX - metrics.contentLeft - rootScreenX,
        y: (root.top * scale) - metrics.contentTop - rootTop
    };
};

const unionFrames = frames => frames.reduce((frame, next) => {
    if (!frame) return next;
    return {
        bottom: Math.max(frame.bottom, next.bottom),
        left: Math.min(frame.left, next.left),
        right: Math.max(frame.right, next.right),
        top: Math.min(frame.top, next.top)
    };
}, null);

const frameIntersectsViewport = (frame, viewport, metrics, scale) => {
    const right = viewport.viewLeft + (metrics.viewWidth / scale);
    const bottom = viewport.viewTop + (metrics.viewHeight / scale);
    return frame.right >= viewport.viewLeft && frame.left <= right &&
        frame.bottom >= viewport.viewTop && frame.top <= bottom;
};

const visibleContextFrame = (workspace, viewport, activeRoot) => {
    if (typeof workspace.getTopBlocks !== 'function') return activeRoot;
    const metrics = workspace.getMetrics();
    const frames = workspace.getTopBlocks(false)
        .map(block => blockTreeFrame(workspace, block))
        .filter(frame => frameIntersectsViewport(frame, viewport, metrics, workspace.scale));
    return unionFrames([activeRoot, ...frames]);
};

const safeViewportForFrame = (workspace, viewport, frame) => {
    const metrics = workspace.getMetrics();
    const scale = workspace.scale;
    const active = unionFrames([frame.root, frame.focus]);
    const context = visibleContextFrame(workspace, viewport, active);
    const activeWidthFits = (active.right - active.left) * scale <=
        metrics.viewWidth - (SIDE_MARGIN * 2);
    const activeHeightFits = (active.bottom - active.top) * scale <=
        metrics.viewHeight - VIEW_MARGIN - EDIT_BOTTOM_MARGIN;
    // Surrounding scripts are secondary context. Once the active script itself
    // cannot fit, allowing nearby scripts to influence the shot causes the
    // camera to walk sideways as the active stack grows.
    const canComposeContext = activeWidthFits && activeHeightFits;
    const contextWidthFits = (context.right - context.left) * scale <=
        metrics.viewWidth - (SIDE_MARGIN * 2);
    const horizontal = activeWidthFits ? (canComposeContext && contextWidthFits ? context : active) : frame.focus;
    const contextBottom = Math.max(
        context.bottom,
        frame.focus.bottom + ((EDIT_BOTTOM_MARGIN - VIEW_MARGIN) / scale)
    );
    const contextHeightFits = (contextBottom - context.top) * scale <=
        metrics.viewHeight - (VIEW_MARGIN * 2);
    const composeVerticalContext = canComposeContext && contextHeightFits;
    const verticalTop = composeVerticalContext ? context.top : active.top;
    const verticalBottom = composeVerticalContext ? contextBottom : frame.focus.bottom;
    const bottomMargin = composeVerticalContext ? VIEW_MARGIN : EDIT_BOTTOM_MARGIN;
    const left = horizontal.left;
    const right = horizontal.right;
    const horizontalWidth = (right - left) * scale;
    const preferredLeftMargin = Math.min(
        SIDE_MARGIN,
        Math.max(0, (metrics.viewWidth - horizontalWidth) / 2)
    );
    const minimumLeft = right - ((metrics.viewWidth - preferredLeftMargin) / scale);
    const maximumLeft = left - (preferredLeftMargin / scale);
    const minimumTop = verticalBottom - ((metrics.viewHeight - bottomMargin) / scale);
    const maximumTop = verticalTop - (VIEW_MARGIN / scale);
    const horizontalIsSafe = minimumLeft <= maximumLeft &&
        viewport.viewLeft >= minimumLeft && viewport.viewLeft <= maximumLeft;
    const focusTop = (frame.focus.top - viewport.viewTop) * scale;
    const focusBottom = (frame.focus.bottom - viewport.viewTop) * scale;
    const verticalIsSafe = activeHeightFits ?
        (minimumTop <= maximumTop && viewport.viewTop >= minimumTop && viewport.viewTop <= maximumTop) :
        (focusTop >= VIEW_MARGIN && focusBottom <= metrics.viewHeight - EDIT_BOTTOM_MARGIN);
    const composeFittingContext = canComposeContext && contextWidthFits && contextHeightFits &&
        (!horizontalIsSafe || !verticalIsSafe);
    const oversizedBottomMargin = Math.max(
        EDIT_BOTTOM_MARGIN,
        metrics.viewHeight * OVERSIZED_EDIT_BOTTOM_RATIO
    );
    const oversizedEditTop = frame.focus.bottom -
        ((metrics.viewHeight - oversizedBottomMargin) / scale);
    const alignActiveLeft = !horizontalIsSafe || (!activeHeightFits && !verticalIsSafe);
    return {
        viewLeft: composeFittingContext || alignActiveLeft ? maximumLeft : viewport.viewLeft,
        viewTop: composeFittingContext ? maximumTop :
            (verticalIsSafe ? viewport.viewTop : (activeHeightFits ? maximumTop : oversizedEditTop))
    };
};

const captureViewport = workspace => {
    const metrics = workspace.getMetrics();
    return {
        viewLeft: metrics.viewLeft / workspace.scale,
        viewTop: metrics.viewTop / workspace.scale
    };
};

const currentViewport = workspace => {
    const metrics = workspace.getMetrics();
    return {
        x: (metrics.viewLeft * workspace.scale) - metrics.contentLeft,
        y: (metrics.viewTop * workspace.scale) - metrics.contentTop
    };
};

const xmlCoordinate = (workspace, xml) => {
    if (typeof xml !== 'string') return null;
    const xMatch = xml.match(/\sx="(-?\d+)"/);
    const yMatch = xml.match(/\sy="(-?\d+)"/);
    if (!xMatch || !yMatch) return null;
    const x = Number(xMatch[1]);
    return {
        x: workspace.RTL && typeof workspace.getWidth === 'function' ? workspace.getWidth() - x : x,
        y: Number(yMatch[1])
    };
};

const transactionDestination = (workspace, transaction, direction, blockId) => {
    const moves = transaction.events.filter(event => event.type === 'move' && event.blockId === blockId);
    const move = direction === 'forward' ? moves[moves.length - 1] : moves[0];
    if (!move) return null;
    const location = direction === 'forward' ? move.details.newLocation : move.details.oldLocation;
    if (location.coordinate) return location.coordinate;
    if (!location.parentId) return null;
    const parentId = resolveWorkspaceBlockId(workspace, location.parentRef, location.parentId);
    const parent = workspace.getBlockById(parentId);
    return parent ? parent.getRelativeToSurfaceXY() : null;
};

const destinationFrame = (workspace, transaction, direction, blockId) => {
    const moves = transaction.events.filter(event => event.type === 'move' && event.blockId === blockId);
    const move = direction === 'forward' ? moves[moves.length - 1] : moves[0];
    const lifecycleEvent = transaction.events.find(event =>
        ['create', 'delete'].includes(event.type) && event.blockId === blockId);
    const xml = lifecycleEvent && lifecycleEvent.details &&
        (lifecycleEvent.details.xml || lifecycleEvent.details.oldXml);
    const location = (move && move.details && (
        direction === 'forward' ? move.details.newLocation : move.details.oldLocation
    )) || (xml ? {coordinate: xmlCoordinate(workspace, xml)} : null);
    if (!location) return null;
    const createEvent = lifecycleEvent;
    const flyout = typeof workspace.getFlyout === 'function' ? workspace.getFlyout() : null;
    const flyoutWorkspace = flyout && typeof flyout.getWorkspace === 'function' ? flyout.getWorkspace() : null;
    const flyoutBlocks = flyoutWorkspace ? (
        typeof flyoutWorkspace.getAllBlocks === 'function' ? flyoutWorkspace.getAllBlocks(false) :
            (typeof flyoutWorkspace.getTopBlocks === 'function' ? flyoutWorkspace.getTopBlocks(false) : [])
    ) : [];
    const prototype = createEvent && flyoutBlocks.find(block => block.type === createEvent.blockType);
    const currentBlock = workspace.getBlockById(resolveWorkspaceBlockId(workspace, move && move.blockRef, blockId));
    const measured = currentBlock || prototype;
    const measuredSize = measured && measured.getHeightWidth();
    const createdSize = measured ? {width: measuredSize.width, height: measured.height || measuredSize.height} : {
        height: createEvent && createEvent.blockType ? 56 : 0,
        width: createEvent && createEvent.blockType ? 160 : 0
    };
    if (location.parentId) {
        const parentId = resolveWorkspaceBlockId(workspace, location.parentRef, location.parentId);
        const parent = workspace.getBlockById(parentId);
        if (!parent) return null;
        const parentFrame = transactionFrame(workspace, parent);
        if (location.inputName || !createdSize.height) return parentFrame;
        const predicted = {
            bottom: parentFrame.focus.bottom + createdSize.height,
            left: parentFrame.focus.left,
            right: parentFrame.focus.left + createdSize.width,
            top: parentFrame.focus.bottom
        };
        return {
            focus: predicted,
            root: unionFrames([parentFrame.root, predicted]),
            renderedVisible: null
        };
    }
    if (!location.coordinate) return null;
    const {x, y} = location.coordinate;
    return {
        focus: {bottom: y + createdSize.height, left: x, right: x + createdSize.width, top: y},
        root: {bottom: y + createdSize.height, left: x, right: x + createdSize.width, top: y},
        renderedVisible: null
    };
};

const interactionDestinationFrame = (workspace, plan, aliases = new Map()) => {
    if (!plan || !plan.destination) return null;
    const destination = plan.destination;
    const alias = blockId => (typeof aliases.get === 'function' ? aliases.get(blockId) : aliases[blockId]);
    if (destination.parentId) {
        const parentId = alias(destination.parentId) ||
            resolveWorkspaceBlockId(workspace, destination.parentRef, destination.parentId);
        const parent = workspace.getBlockById(parentId);
        if (!parent) return null;
        const parentFrame = transactionFrame(workspace, parent);
        if (destination.inputName) return parentFrame;
        const flyout = typeof workspace.getFlyout === 'function' ? workspace.getFlyout() : null;
        const flyoutWorkspace = flyout && typeof flyout.getWorkspace === 'function' ? flyout.getWorkspace() : null;
        const prototypes = flyoutWorkspace && typeof flyoutWorkspace.getAllBlocks === 'function' ?
            flyoutWorkspace.getAllBlocks(false) : [];
        const prototype = prototypes.find(block => block.type === plan.blockType);
        const size = prototype ? prototype.getHeightWidth() : {height: 56, width: 0};
        const predicted = {
            bottom: parentFrame.focus.bottom + size.height,
            left: parentFrame.focus.left,
            right: parentFrame.focus.left + size.width,
            top: parentFrame.focus.bottom
        };
        return {
            focus: predicted,
            root: unionFrames([parentFrame.root, predicted]),
            renderedVisible: null
        };
    }
    if (!destination.coordinate) return null;
    const sourceId = plan.sourceBlockRef && resolveWorkspaceBlockId(workspace, plan.sourceBlockRef, null);
    const sourceBlock = sourceId && workspace.getBlockById(sourceId);
    const sourceFrame = sourceBlock && blockTreeFrame(workspace, sourceBlock);
    const size = sourceFrame ? {
        height: sourceFrame.bottom - sourceFrame.top,
        width: sourceFrame.right - sourceFrame.left
    } : {height: 56, width: 0};
    const focus = {
        bottom: destination.coordinate.y + Math.min(size.height, 56),
        left: destination.coordinate.x,
        right: destination.coordinate.x + size.width,
        top: destination.coordinate.y
    };
    return {focus, root: {...focus, bottom: destination.coordinate.y + size.height}, renderedVisible: null};
};

const creationAnchor = (workspace, transaction, direction, action) =>
    transactionDestination(workspace, transaction, direction, action.eventJson.blockId) ||
    xmlCoordinate(workspace, action.eventJson.xml);

const defersCreatedBlockFocus = (transaction, blockId) => (transaction.events || []).some(event =>
    event.type === 'create' && event.blockId === blockId && event.blockType === 'procedures_definition'
);

const isOffscreen = (workspace, viewport, position) => {
    const metrics = workspace.getMetrics();
    const scale = workspace.scale;
    const screenX = (position.x - viewport.viewLeft) * scale;
    const screenY = (position.y - viewport.viewTop) * scale;
    return screenX < 0 || screenX > metrics.viewWidth || screenY < 0 || screenY > metrics.viewHeight;
};

const frameIsVisible = (workspace, viewport, frame) => {
    const metrics = workspace.getMetrics();
    const scale = workspace.scale;
    return (frame.left - viewport.viewLeft) * scale >= 0 &&
        (frame.right - viewport.viewLeft) * scale <= metrics.viewWidth &&
        (frame.top - viewport.viewTop) * scale >= 0 &&
        (frame.bottom - viewport.viewTop) * scale <= metrics.viewHeight;
};

const creationViewport = (workspace, position) => {
    const metrics = workspace.getMetrics();
    const scale = workspace.scale;
    const side = workspace.RTL ? metrics.viewWidth - VIEW_MARGIN : VIEW_MARGIN;
    return {
        viewLeft: position.x - (side / scale),
        viewTop: position.y - (VIEW_MARGIN / scale)
    };
};

const browserFrameScheduling = () => {
    if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
        return {};
    }
    return {
        requestFrame: callback => window.requestAnimationFrame(callback),
        cancelFrame: frameId => window.cancelAnimationFrame(frameId),
        now: () => window.performance.now()
    };
};

/**
 * Restore the authoring viewport when it was recorded. Older takes fall back
 * to framing the edited stack consistently from its root, retaining the first
 * frame so a removed block can still be followed.
 *
 * @param {object} options viewport dependencies
 * @param {object} options.workspace visible Scratch Blocks workspace
 * @param {?object} [options.motion] injected viewport motion controller
 * @param {'wait'|'concurrent'|'off'} [options.preCreateMode] creation camera policy
 * @param {boolean} [options.expandScrollRegion] add a full viewport of parking space
 * @returns {object} transaction viewport lifecycle
 */
const createScratchBlocksViewportPort = ({
    workspace,
    motion = null,
    preCreateMode = PRE_CREATE_CAMERA_MODES.WAIT,
    expandScrollRegion = false
}) => {
    if (!workspace || typeof workspace.getBlockById !== 'function') return emptyPort;

    const restoreScrollRegion = expandScrollRegion ? installExpandedScrollRegion(workspace) : () => {};

    const viewportMotion = motion || createViewportMotion({
        read: () => currentViewport(workspace),
        write: (x, y) => workspace.scrollbar.set(x, y),
        ...browserFrameScheduling()
    });

    let focusBlockId = null;
    let focusBlockRef = null;
    let recordedViewport = null;
    let retainedFrame = null;
    let startingViewport = null;
    let activeTransaction = null;
    let replayDirection = 'forward';
    let preCreateMotion = null;
    let preCreateViewport = null;
    let presentationMode = VIEWPORT_PRESENTATION_MODES.RECORDED;
    let deferredCreatedBlockFocus = false;
    let playbackSpeed = 1;

    const moveOptions = (from, speed = playbackSpeed) => (
        speed === 1 ? {from} : {from, speed}
    );

    const focusBlock = () => {
        if (!focusBlockId) return null;
        const liveId = resolveWorkspaceBlockId(workspace, focusBlockRef, focusBlockId);
        return workspace.getBlockById(liveId);
    };

    return {
        beginTransaction: (transaction, direction, options = {}) => {
            startingViewport = captureViewport(workspace);
            activeTransaction = transaction;
            replayDirection = direction || 'forward';
            presentationMode = options.presentationMode || VIEWPORT_PRESENTATION_MODES.RECORDED;
            playbackSpeed = typeof options.speed === 'undefined' ? 1 : options.speed;
            preCreateMotion = null;
            preCreateViewport = null;
            const effects = analyzeTransactionEffects(transaction, replayDirection);
            const lifecycle = effects.lifecycles.find(item => !item.isShadow);
            const primaryId = lifecycle ? lifecycle.blockId : effects.primaryMove && effects.primaryMove.blockId;
            const focalEvent = [...transaction.events].reverse().find(event =>
                event.blockId && (!primaryId || event.blockId === primaryId));
            focusBlockId = focalEvent ? focalEvent.blockId : null;
            focusBlockRef = focalEvent ? focalEvent.blockRef || null : null;
            deferredCreatedBlockFocus = defersCreatedBlockFocus(transaction, focusBlockId);
            recordedViewport = transaction.viewport || null;
            retainedFrame = null;
        },
        capture: () => captureViewport(workspace),
        observeBeforeAction: action => {
            if (!focusBlockId || retainedFrame || action.eventJson.blockId !== focusBlockId) return;
            const block = focusBlock();
            if (block) retainedFrame = transactionFrame(workspace, block);
        },
        prepareBeforeAction: async action => {
            if (presentationMode !== VIEWPORT_PRESENTATION_MODES.RECORDED ||
                preCreateMode === PRE_CREATE_CAMERA_MODES.OFF || preCreateMotion ||
                action.eventJson.type !== 'create' || !workspace.scrollbar) return false;
            const anchor = creationAnchor(workspace, activeTransaction, replayDirection, action);
            if (!anchor || !isOffscreen(workspace, startingViewport, anchor)) return false;
            preCreateViewport = recordedViewport || creationViewport(workspace, anchor);
            const target = recordedViewportTarget(workspace, preCreateViewport);
            const from = recordedViewportTarget(workspace, startingViewport);
            preCreateMotion = viewportMotion.moveTo(target.x, target.y, moveOptions(from));
            if (preCreateMode === PRE_CREATE_CAMERA_MODES.WAIT) await preCreateMotion;
            return true;
        },
        focusTransaction: async (options = {}) => {
            const phase = options.phase || 'before';
            if (!workspace.scrollbar) return false;
            if (phase === 'after' && !deferredCreatedBlockFocus) return false;
            if (presentationMode === VIEWPORT_PRESENTATION_MODES.PRESERVE) {
                const target = recordedViewportTarget(workspace, startingViewport);
                viewportMotion.jumpTo(target.x, target.y);
                return true;
            }
            const preparedBeforeCreate = Boolean(preCreateMotion);
            if (preCreateMotion) {
                const pendingMotion = preCreateMotion;
                preCreateMotion = null;
                await pendingMotion;
            }
            if (preparedBeforeCreate && preCreateViewport) {
                const target = recordedViewportTarget(workspace, preCreateViewport);
                viewportMotion.jumpTo(target.x, target.y);
                preCreateViewport = null;
                return true;
            }
            let target = null;
            let fromViewport = startingViewport;
            if (presentationMode === VIEWPORT_PRESENTATION_MODES.RECORDED && recordedViewport) {
                const block = focusBlock();
                if (phase !== 'after' && deferredCreatedBlockFocus && !block) return false;
                const frame = block ? transactionFrame(workspace, block) :
                    destinationFrame(workspace, activeTransaction, replayDirection, focusBlockId);
                const current = frame ? captureViewport(workspace) : null;
                if (current) fromViewport = current;
                target = recordedViewportTarget(
                    workspace,
                    frame ? safeViewportForFrame(workspace, current, frame) : recordedViewport
                );
            } else if (focusBlockId && presentationMode === VIEWPORT_PRESENTATION_MODES.REVEAL) {
                const block = focusBlock();
                const source = block ? transactionFrame(workspace, block) : retainedFrame;
                const lifecycle = compileHistoryPresentationPlan(activeTransaction, replayDirection)
                    .lifecycles.find(item => item.blockId === focusBlockId);
                // An exiting block leaves its current slot by a short offset;
                // its original flyout/pickup coordinate is not a destination.
                const destination = lifecycle && lifecycle.kind === 'exit' ? null :
                    destinationFrame(workspace, activeTransaction, replayDirection, focusBlockId);
                let frame = destination || source;
                if (source && destination) {
                    const focus = unionFrames([source.focus, destination.focus]);
                    const metrics = workspace.getMetrics();
                    // Show both ends when they fit. Otherwise compose the
                    // destination, with generous room for subsequent coding.
                    if ((focus.right - focus.left) * workspace.scale <= metrics.viewWidth - (SIDE_MARGIN * 2) &&
                        (focus.bottom - focus.top) * workspace.scale <=
                            metrics.viewHeight - VIEW_MARGIN - EDIT_BOTTOM_MARGIN) {
                        frame = {focus, root: unionFrames([source.root, destination.root])};
                    }
                }
                if (frame) {
                    if (lifecycle) {
                        // The nearby entrance/exit is part of the shot too,
                        // not just the block's connected resting rectangle.
                        frame = {
                            ...frame,
                            focus: {
                                ...frame.focus,
                                right: frame.focus.right + (Math.max(0, lifecycle.offset.x) / workspace.scale),
                                bottom: frame.focus.bottom + (Math.max(0, lifecycle.offset.y) / workspace.scale)
                            }
                        };
                    }
                    const safe = safeViewportForFrame(workspace, startingViewport, frame);
                    target = recordedViewportTarget(workspace, safe);
                    if (Math.abs(safe.viewLeft - startingViewport.viewLeft) < 0.5 &&
                        Math.abs(safe.viewTop - startingViewport.viewTop) < 0.5) {
                        viewportMotion.jumpTo(target.x, target.y);
                        return true;
                    }
                }
            } else if (focusBlockId) {
                const block = focusBlock();
                const frame = block ? transactionFrame(workspace, block) : retainedFrame ||
                    destinationFrame(workspace, activeTransaction, replayDirection, focusBlockId);
                // Frame an entering block before taking the presentation
                // snapshot rather than panning underneath it after creation.
                const visible = frame && (frame.renderedVisible === null ?
                    frameIsVisible(workspace, startingViewport, frame.focus) : frame.renderedVisible);
                if (visible) {
                    const currentTarget = recordedViewportTarget(workspace, startingViewport);
                    viewportMotion.jumpTo(currentTarget.x, currentTarget.y);
                    return true;
                }
                if (frame) target = transactionViewportTarget(workspace, frame);
            }
            if (!target) return false;
            const from = recordedViewportTarget(workspace, fromViewport);
            await viewportMotion.moveTo(target.x, target.y, moveOptions(from));
            return true;
        },
        ensureInteractionVisible: async (plan, aliases = new Map(), options = {}) => {
            if (!workspace.scrollbar) return false;
            const frame = interactionDestinationFrame(workspace, plan, aliases);
            if (!frame) return false;
            const current = captureViewport(workspace);
            const safe = safeViewportForFrame(workspace, current, frame);
            if (Math.abs(safe.viewLeft - current.viewLeft) < 0.5 &&
                Math.abs(safe.viewTop - current.viewTop) < 0.5) return false;
            const target = recordedViewportTarget(workspace, safe);
            const from = recordedViewportTarget(workspace, current);
            const speed = typeof options.speed === 'undefined' ? playbackSpeed : options.speed;
            await viewportMotion.moveTo(target.x, target.y, moveOptions(from, speed));
            return true;
        },
        cancel: () => {
            viewportMotion.stop();
            if (!startingViewport || !workspace.scrollbar) return;
            const target = recordedViewportTarget(workspace, startingViewport);
            viewportMotion.jumpTo(target.x, target.y);
        },
        stop: viewportMotion.stop,
        detach: () => {
            viewportMotion.stop();
            restoreScrollRegion();
        }
    };
};

export {
    PRE_CREATE_CAMERA_MODES,
    VIEWPORT_PRESENTATION_MODES,
    createScratchBlocksViewportPort,
    installExpandedScrollRegion,
    safeViewportForFrame
};
