import {compileHistoryPresentationPlan} from './history-presentation-plan';
import {resolveWorkspaceBlockId} from './workspace-block-reference';
import {
    createInteractionClock, generatedPath, CONNECTION_PREVIEW_PROGRESS,
    movementEaseIn, movementEaseOut, movementEaseInOut
} from './native-interaction/interaction-clock';

const location = block => {
    const point = block.getRelativeToSurfaceXY();
    return {x: point.x, y: point.y};
};
const moveTo = (block, point) => {
    const current = location(block);
    block.moveBy(point.x - current.x, point.y - current.y);
};
const nextBlock = block => block && block.getNextBlock();
// Arrivals brake into their slot; departures gather speed as they leave it.
const TRANSITION_EASING = {enter: movementEaseOut, exit: movementEaseIn, move: movementEaseInOut};
const aliasFor = (aliases, id) => aliases && (typeof aliases.get === 'function' ? aliases.get(id) : aliases[id]);
const statementSize = block => ({
    ...block.getHeightWidth(), hasNextConnection: Boolean(block.lastConnectionInStack())
});
const withoutEvents = (ScratchBlocks, callback) => {
    ScratchBlocks.Events.disable();
    try {
        return callback();
    } finally {
        ScratchBlocks.Events.enable();
    }
};

/**
 * Blockly owns every rendered block, shadow and insertion marker here. The
 * presentation workspace is isolated from the editor and its VM. The executor
 * applies the exact journal transaction once underneath this surface, verifies
 * it, then asks us to animate toward that verified result.
 * @param {object} options rendering dependencies
 * @returns {object} isolated transition presentation lifecycle
 */
const createBlockTransitionPresentationPort = ({
    workspace,
    ScratchBlocks,
    blockAliases = () => new Map(),
    historyPointer = null,
    createClock = createInteractionClock
}) => {
    const active = new Set();
    let generation = 0;
    const resolve = (owner, id, ref) => {
        const aliases = blockAliases();
        const liveId = aliasFor(aliases, id);
        return (liveId && owner.getBlockById(liveId)) || owner.getBlockById(id) ||
            owner.getBlockById(resolveWorkspaceBlockId(owner, ref, id));
    };
    const finish = state => {
        if (!state || state.disposed) return;
        state.disposed = true;
        state.clock.finish();
        try {
            withoutEvents(ScratchBlocks, () => {
                try {
                    for (const manager of state.managers) {
                        manager.previewConnection(null, null);
                        manager.dispose();
                    }
                } finally {
                    state.surface.dispose();
                }
            });
        } finally {
            active.delete(state);
            if (historyPointer) historyPointer.endBlock();
        }
    };
    const captureBefore = ({transaction, direction}) => {
        const plan = compileHistoryPresentationPlan(transaction, direction);
        if (!plan.lifecycles.length && !plan.moveOnly) return null;
        if (typeof workspace.createTransitionWorkspace !== 'function') {
            throw new Error('Block transitions require the local Scratch Blocks presentation contract');
        }
        const state = {
            plan,
            surface: workspace.createTransitionWorkspace(),
            clock: createClock(),
            managers: [],
            generation,
            disposed: false,
            beforeIds: new Set(workspace.getAllBlocks(false).map(block => block.id))
        };
        active.add(state);
        return state;
    };
    const playAfter = async ({transaction, before, playbackSpeed = 1}) => {
        if (!before || before.disposed || before.generation !== generation) return {animated: 0};
        const scene = before.surface.workspace;
        const evidence = {engine: 'native-block-transition', frames: [], animated: 0};
        const actors = [];
        const attachPreview = (block, local, target) => {
            if (!local || !target) return null;
            const manager = new ScratchBlocks.InsertionMarkerManager(block);
            before.managers.push(manager);
            return {manager, local, target};
        };
        const receivingConnection = after => {
            const inferior = after && (after.previousConnection || after.outputConnection);
            const receiving = inferior && inferior.targetConnection;
            if (!receiving) return null;
            const parent = scene.getBlockById(receiving.getSourceBlock().id);
            if (!parent) return null;
            const input = receiving.getSourceBlock().inputList.find(item => item.connection === receiving);
            return input ? parent.getInput(input.name).connection : parent.nextConnection;
        };
        // Ownership includes statement inputs, not just the next-chain. When a
        // wrapper leaves, surviving contents belong to the receiving script;
        // its value inputs and genuinely carried substacks still travel with it.
        const detach = (block, keepEdge) => {
            const start = location(block);
            const parentConnection = (block.previousConnection || block.outputConnection)?.targetConnection;
            const released = [];
            for (const input of block.inputList || []) {
                const connection = input.connection;
                const child = connection && connection.type === ScratchBlocks.NEXT_STATEMENT &&
                    connection.targetBlock();
                if (child && !keepEdge(block, child, input.name)) {
                    const shape = {inputName: input.name, size: statementSize(child)};
                    connection.disconnect();
                    block.setStatementInputPreview(input.name, shape.size, 1);
                    released.push({local: connection, child, shape});
                }
            }
            let tail = block;
            while (nextBlock(tail) && keepEdge(tail, nextBlock(tail))) tail = nextBlock(tail);
            const remainder = nextBlock(tail);
            if (remainder) tail.nextConnection.disconnect();
            block.unplug(false);
            if (remainder && parentConnection && parentConnection.type === ScratchBlocks.NEXT_STATEMENT) {
                parentConnection.connect(remainder.previousConnection);
            }
            for (const {child} of released) {
                const afterChild = workspace.getBlockById(child.id);
                const receiving = receivingConnection(afterChild);
                if (receiving) receiving.connect(child.previousConnection);
                else if (afterChild) moveTo(child, location(afterChild));
            }
            moveTo(block, start);
            return {start, tail, parentConnection, released};
        };
        const destinationPreview = (block, tail, after) => {
            // Surrounding a script connects the C's inner statement socket to
            // the existing child's previous connection. Blockly then grows its
            // marker around the contents and keeps the outer parent anchored.
            for (const input of after.inputList || []) {
                const local = block.getInput(input.name)?.connection;
                const child = input.connection && input.connection.type === ScratchBlocks.NEXT_STATEMENT &&
                    input.connection.targetBlock();
                const target = child && scene.getBlockById(child.id);
                if (local && target && local.targetBlock() !== target) {
                    return {...attachPreview(block, local, target.previousConnection),
                        shape: {inputName: input.name, size: statementSize(child)}};
                }
            }
            const receiving = receivingConnection(after);
            if (receiving) return attachPreview(block, block.previousConnection || block.outputConnection, receiving);
            // Top-level prepend: the stationary script's previous connection
            // receives the last connection of the moving chain.
            const afterTail = workspace.getBlockById(tail.id);
            const following = nextBlock(afterTail);
            const target = following && scene.getBlockById(following.id);
            return target ? attachPreview(block, tail.nextConnection, target.previousConnection) : null;
        };
        try {
            withoutEvents(ScratchBlocks, () => {
                const descriptors = before.plan.lifecycles.length ? before.plan.lifecycles : [{
                    blockId: before.plan.primaryMoveBlockId,
                    blockRef: transaction.events.find(event =>
                        event.blockId === before.plan.primaryMoveBlockId)?.blockRef,
                    kind: 'move'
                }];
                for (const descriptor of descriptors) {
                    const after = resolve(workspace, descriptor.blockId, descriptor.blockRef);
                    let block = resolve(scene, descriptor.blockId, descriptor.blockRef);
                    if (descriptor.kind === 'enter') {
                        if (!after) throw new Error('Transition destination block is missing');
                        const xml = ScratchBlocks.Xml.blockToDom(after);
                        // Existing blocks displaced by insertion remain in the
                        // scene; never duplicate them inside the entering root.
                        for (const child of Array.from(xml.querySelectorAll('block'))) {
                            if (before.beforeIds.has(child.getAttribute('id'))) child.remove();
                        }
                        block = ScratchBlocks.Xml.domToBlock(xml, scene);
                        moveTo(block, location(after));
                    }
                    if (!block || (descriptor.kind !== 'exit' && !after)) {
                        throw new Error('Transition actor could not be resolved');
                    }
                    const lifecycleIds = new Set((descriptor.blockIds || []).map(id =>
                        aliasFor(blockAliases(), id) || id));
                    const detached = detach(block, (parent, child, inputName) => {
                        if (descriptor.kind !== 'move') return lifecycleIds.has(child.id);
                        const afterParent = workspace.getBlockById(parent.id);
                        const retained = inputName ?
                            afterParent?.getInputTargetBlock(inputName) : nextBlock(afterParent);
                        return retained?.id === child.id;
                    });
                    let start = detached.start;
                    let end = after ? location(after) : start;
                    const offset = descriptor.offset || {x: 40, y: 24};
                    // Offsets are screen pixels, regardless of block zoom.
                    if (descriptor.kind === 'enter') {
                        start = {x: end.x + (offset.x / workspace.scale), y: end.y + (offset.y / workspace.scale)};
                    }
                    if (descriptor.kind === 'exit') {
                        end = {x: start.x + (offset.x / workspace.scale), y: start.y + (offset.y / workspace.scale)};
                    }
                    moveTo(block, start);
                    const unwrapped = detached.released[0];
                    const sourcePreview = unwrapped ?
                        {...attachPreview(block, unwrapped.local, unwrapped.child.previousConnection),
                            shape: unwrapped.shape} : null;
                    const preview = descriptor.kind === 'exit' ? (sourcePreview ||
                        attachPreview(block, block.previousConnection || block.outputConnection,
                            detached.parentConnection)) :
                        destinationPreview(block, detached.tail, after);
                    if (sourcePreview) {
                        sourcePreview.manager.previewConnection(sourcePreview.local, sourcePreview.target);
                    }
                    if (descriptor.kind === 'exit' && preview && preview !== sourcePreview) {
                        preview.manager.previewConnection(preview.local, preview.target);
                    }
                    block.bringToFront();
                    block.getSvgRoot().setAttribute('data-studio-transition-actor', descriptor.kind);
                    actors.push({block, start, end, preview, sourcePreview, kind: descriptor.kind});
                }
            });
            // Follow the one manipulated actor, never the stationary blocks
            // that Blockly shifts to preview its receiving connection.
            const primaryActor = actors[0];
            if (historyPointer && primaryActor) {
                await historyPointer.beginBlock(primaryActor.block, playbackSpeed);
                if (before.disposed) return {animated: 0};
            }
            before.clock.setSpeed(playbackSpeed);
            const frameCount = 18;
            const paths = actors.map(actor =>
                generatedPath(actor.start, actor.end, frameCount, TRANSITION_EASING[actor.kind]));
            await before.clock.play({
                points: generatedPath({x: 0, y: 0}, {x: 1, y: 1}, frameCount),
                holdFrames: 3,
                onFrame: (point, index) => {
                    if (before.disposed) return;
                    withoutEvents(ScratchBlocks, () => actors.forEach((actor, actorIndex) => {
                        const progress = TRANSITION_EASING[actor.kind](Math.min(index / frameCount, 1));
                        if (actor.sourcePreview?.shape) {
                            const {inputName, size} = actor.sourcePreview.shape;
                            actor.block.setStatementInputPreview(inputName, size,
                                1 - Math.min(1, progress / (1 - CONNECTION_PREVIEW_PROGRESS)));
                        }
                        if (actor.kind !== 'exit' && actor.preview?.shape) {
                            const {inputName, size} = actor.preview.shape;
                            actor.block.setStatementInputPreview(inputName, size,
                                Math.min(1, progress / CONNECTION_PREVIEW_PROGRESS));
                        }
                        moveTo(actor.block, paths[actorIndex][Math.min(index, frameCount)]);
                        if (actor.kind === 'move' && actor.sourcePreview &&
                            TRANSITION_EASING.move(Math.min(index / frameCount, 1)) > 1 - CONNECTION_PREVIEW_PROGRESS) {
                            actor.sourcePreview.manager.previewConnection(null, null);
                        }
                        if (actor.preview && actor.kind !== 'exit' &&
                            TRANSITION_EASING[actor.kind](Math.min(index / frameCount, 1)) >=
                                CONNECTION_PREVIEW_PROGRESS) {
                            actor.preview.manager.previewConnection(actor.preview.local, actor.preview.target);
                        }
                        actor.block.getSvgRoot().style.opacity = actor.kind === 'exit' ?
                            String(Math.min(1, (1 - point.x) * 4)) : '1';
                    }));
                    if (historyPointer && primaryActor) historyPointer.followBlock(primaryActor.block);
                    evidence.frames.push({
                        index,
                        previews: actors.map(actor => Boolean(actor.preview?.manager.getConnectionPreview().visible ||
                            actor.sourcePreview?.manager.getConnectionPreview().visible))
                    });
                }
            });
            evidence.animated = actors.length;
            return evidence;
        } finally {
            finish(before);
        }
    };
    return {
        captureBefore,
        playAfter,
        discard: finish,
        finishActive: () => {
            generation++;
            for (const state of active) finish(state);
        },
        detach: () => {
            for (const state of active) finish(state);
        }
    };
};

export {createBlockTransitionPresentationPort};
