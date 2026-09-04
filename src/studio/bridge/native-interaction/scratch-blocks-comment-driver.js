import {
    combinePointerTravels,
    dispatchMouseSelection,
    typeInputText,
    withGeneratedIds
} from './dom-interaction';
import {activateThroughPointer} from './pointer-activation';
import {createElementPointerTarget} from './pointer-target';
import {resolvePlaybackBlockId} from './playback-block-resolver';
import {inputIsFocused, inputPoint} from './ui-state';

const TEXT_FRAMES_PER_CHARACTER = 5;

const visible = element => {
    const bounds = element && element.getBoundingClientRect && element.getBoundingClientRect();
    return Boolean(bounds && bounds.width > 0 && bounds.height > 0);
};

const waitFor = async (locate, documentObject, signal, frameLimit = 120) => {
    for (let frame = 0; frame < frameLimit; frame += 1) {
        const value = locate();
        if (value) return value;
        if (signal && signal.aborted) return null;
        await new Promise(resolve => documentObject.defaultView.requestAnimationFrame(resolve));
    }
    return null;
};

const mouseEvent = (documentObject, type, point, buttons = 1) => new documentObject.defaultView.MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    view: documentObject.defaultView,
    button: 0,
    buttons,
    clientX: point.x,
    clientY: point.y
});

const closeNumber = (actual, expected) => Number.isFinite(actual) && Number.isFinite(expected) &&
    Math.abs(actual - expected) < 1;

const commentCoordinate = comment => {
    const coordinate = comment && comment.getXY && comment.getXY();
    return coordinate && Number.isFinite(coordinate.x) && Number.isFinite(coordinate.y) ?
        {x: coordinate.x, y: coordinate.y} : null;
};

const commentSize = comment => {
    const size = comment && comment.getHeightWidth && comment.getHeightWidth();
    return size && Number.isFinite(size.width) && Number.isFinite(size.height) ?
        {width: size.width, height: size.height} : null;
};

const coordinatesMatch = (actual, expected) => Boolean(actual && expected &&
    closeNumber(actual.x, expected.x) && closeNumber(actual.y, expected.y));

const sizesMatch = (actual, expected) => Boolean(actual && expected &&
    closeNumber(actual.width, expected.width) && closeNumber(actual.height, expected.height));

const isWorkspaceCommentPlan = plan => plan.commentOwner === 'workspace' ||
    plan.kind.startsWith('workspace-comment-');

const commentMinimized = comment => Boolean(comment && (
    typeof comment.isMinimized === 'function' ? comment.isMinimized() : comment.isMinimized_
));

const commentControls = (comment, workspaceComment) => {
    if (!comment) return {};
    if (workspaceComment) {
        return {
            textarea: comment.textarea_,
            minimize: comment.minimizeArrow_,
            resize: comment.resizeGroup_,
            move: comment.svgHandleTarget_,
            delete: comment.deleteIcon_
        };
    }
    const bubble = comment.bubble_ || {};
    return {
        textarea: comment.textarea_,
        minimize: bubble.minimizeArrow_,
        resize: bubble.resizeGroup_,
        move: bubble.commentTopBar_
    };
};

const dragCommentControl = async ({
    plan,
    locate,
    sourceKind,
    destinationKind,
    delta,
    documentObject,
    clock,
    pointer,
    scope,
    signal,
    travels
}) => {
    const sourceTravel = await pointer.travelTo(createElementPointerTarget({
        id: `comment:${plan.commentId}:${sourceKind}`,
        kind: sourceKind,
        locate
    }), {clock, signal});
    travels.source = sourceTravel;
    if (!sourceTravel.completed) return false;
    const sourceElement = sourceTravel.target.element;
    scope.runWithoutUndo(() => sourceElement.dispatchEvent(mouseEvent(
        documentObject,
        'mousedown',
        sourceTravel.target.point
    )));
    if (typeof pointer.press === 'function') pointer.press();
    let pointerPressed = true;
    try {
        const destinationTravel = await pointer.travelTo(createElementPointerTarget({
            id: `comment:${plan.commentId}:${destinationKind}`,
            kind: destinationKind,
            locate,
            offsetX: delta.x,
            offsetY: delta.y
        }), {
            clock,
            signal,
            onFrame: point => scope.runWithoutUndo(() => documentObject.dispatchEvent(
                mouseEvent(documentObject, 'mousemove', point)
            ))
        });
        travels.destination = destinationTravel;
        if (!destinationTravel.completed) return false;
        // ScratchBubble records a completed resize from the handle's mouseup
        // listener. The handle follows the pointer during a real resize, so a
        // physical release targets it and then bubbles to Blockly's document
        // cleanup listener. Preserve that native ordering for both resize and
        // top-bar drags instead of releasing directly on document.
        scope.runWithoutUndo(() => destinationTravel.target.element.dispatchEvent(mouseEvent(
            documentObject,
            'mouseup',
            destinationTravel.target.point,
            0
        )));
        if (typeof pointer.release === 'function') pointer.release();
        pointerPressed = false;
        return true;
    } finally {
        if (pointerPressed) {
            const point = (typeof pointer.getPosition === 'function' && pointer.getPosition()) ||
                sourceTravel.target.point;
            scope.runWithoutUndo(() => documentObject.dispatchEvent(mouseEvent(
                documentObject,
                'mouseup',
                point,
                0
            )));
            if (typeof pointer.release === 'function') pointer.release();
        }
    }
};

const menuItem = (ScratchBlocks, label) => {
    const root = ScratchBlocks.WidgetDiv && ScratchBlocks.WidgetDiv.DIV;
    const items = root && root.querySelectorAll('.goog-menuitem');
    return (items && Array.from(items).find(item => item.textContent.trim() === label)) || null;
};

const openBlockMenu = ({block, point, scope}) => {
    const root = block && block.getSvgRoot && block.getSvgRoot();
    if (!root || typeof root.dispatchEvent !== 'function') {
        throw new Error('Scratch Blocks context menu is unavailable');
    }
    // Enter through Blockly's real gesture path. Calling showContextMenu_
    // directly leaves currentGesture_ empty, which breaks addons that extend
    // ContextMenu.show and also would not constitute a native interaction.
    const view = root.ownerDocument.defaultView;
    scope.runWithoutUndo(() => root.dispatchEvent(new view.MouseEvent('mousedown', {
        bubbles: true,
        cancelable: true,
        view,
        button: 2,
        buttons: 2,
        clientX: point.x,
        clientY: point.y
    })));
};

const blockComment = block => (block && block.comment) || null;

const assertCommentPrecondition = ({workspace, block, blockId, plan, workspaceComment}) => {
    const comment = workspace.getCommentById && workspace.getCommentById(plan.commentId);
    const attached = blockComment(block);
    if (plan.kind === 'block-comment-create') {
        if (attached) throw new Error(`Comment playback block already has a comment: ${blockId}`);
        if (comment) throw new Error(`Comment playback ID already exists: ${plan.commentId}`);
        return null;
    }
    if (plan.kind === 'workspace-comment-create') {
        if (comment) throw new Error(`Comment playback ID already exists: ${plan.commentId}`);
        return null;
    }
    if (workspaceComment) {
        if (!comment || comment.blockId) {
            throw new Error(`Workspace comment identity differs: ${plan.commentId}`);
        }
        return comment;
    }
    if (!comment || attached !== comment || comment.id !== plan.commentId || comment.blockId !== blockId) {
        throw new Error(`Comment does not belong to playback block: ${plan.commentId}`);
    }
    return comment;
};

const workspaceClientPoint = (workspace, coordinate) => {
    const injection = workspace.getInjectionDiv && workspace.getInjectionDiv();
    const bounds = injection && injection.getBoundingClientRect && injection.getBoundingClientRect();
    const origin = workspace.getOriginOffsetInPixels && workspace.getOriginOffsetInPixels();
    if (!bounds || !origin || !Number.isFinite(coordinate && coordinate.x) ||
        !Number.isFinite(coordinate && coordinate.y)) {
        throw new Error('Workspace comment coordinate cannot be resolved');
    }
    return {
        x: bounds.left + origin.x + (coordinate.x * workspace.scale),
        y: bounds.top + origin.y + (coordinate.y * workspace.scale)
    };
};

const openWorkspaceMenu = ({workspace, point, scope, documentObject}) => {
    const background = workspace.svgBackground_;
    if (!background || typeof background.dispatchEvent !== 'function') {
        throw new Error('Scratch Blocks workspace context menu is unavailable');
    }
    scope.runWithoutUndo(() => background.dispatchEvent(new documentObject.defaultView.MouseEvent('mousedown', {
        bubbles: true,
        cancelable: true,
        view: documentObject.defaultView,
        button: 2,
        buttons: 2,
        clientX: point.x,
        clientY: point.y
    })));
};

const createScratchBlocksCommentDriver = ({
    workspace,
    ScratchBlocks,
    documentObject,
    clock,
    pointer,
    scope,
    aliases = new Map()
}) => ({
    cleanup: () => {
        if (ScratchBlocks.ContextMenu && typeof ScratchBlocks.ContextMenu.hide === 'function') {
            ScratchBlocks.ContextMenu.hide();
            return true;
        }
        return false;
    },
    play: async (plan, signal = null) => {
        const workspaceComment = isWorkspaceCommentPlan(plan);
        const blockId = workspaceComment ? null : resolvePlaybackBlockId(workspace, plan, aliases);
        const block = workspaceComment ? null : workspace.getBlockById(blockId);
        if (!workspaceComment && !block) throw new Error(`Comment playback block is missing: ${plan.blockId}`);
        const existingComment = assertCommentPrecondition({
            workspace,
            block,
            blockId,
            plan,
            workspaceComment
        });
        const action = plan.kind.slice(plan.kind.lastIndexOf('-') + 1);
        const travels = {};
        if (action === 'text') {
            const comment = existingComment;
            const textarea = commentControls(comment, workspaceComment).textarea;
            if (!comment || !textarea || !visible(textarea)) {
                throw new Error(`Comment editor is unavailable: ${plan.commentId}`);
            }
            if (comment.getText() !== plan.sourceText) {
                throw new Error(`Comment source text differs: ${plan.commentId}`);
            }
            let textareaTravel = null;
            if (!inputIsFocused(documentObject, textarea)) {
                textareaTravel = await pointer.travelTo(createElementPointerTarget({
                    id: `comment:${plan.commentId}:text`,
                    kind: 'comment-text',
                    locate: () => textarea
                }), {clock, signal});
                travels.text = textareaTravel;
                if (!textareaTravel.completed) {
                    return {cancelled: true, frames: [], pointerTravel: combinePointerTravels(travels)};
                }
                const clicked = await activateThroughPointer({
                    pointer,
                    clock,
                    signal,
                    activate: () => scope.runWithoutUndo(() => dispatchMouseSelection(
                        textarea,
                        textareaTravel.target.point
                    ))
                });
                if (!clicked) {
                    return {cancelled: true, frames: [], pointerTravel: combinePointerTravels(travels)};
                }
                if (typeof textarea.focus === 'function') textarea.focus();
            }
            const typed = await typeInputText({
                input: textarea,
                value: plan.text,
                clock,
                signal,
                point: textareaTravel ? textareaTravel.target.point : inputPoint(pointer, textarea),
                pointer,
                framesPerCharacter: TEXT_FRAMES_PER_CHARACTER,
                replaceValue: (input, value, character) => scope.runWithoutUndo(() => {
                    const view = input.ownerDocument.defaultView;
                    input.value = value;
                    const event = view.InputEvent ? new view.InputEvent('input', {
                        bubbles: true,
                        data: character,
                        inputType: 'insertText'
                    }) : new view.Event('input', {bubbles: true});
                    input.dispatchEvent(event);
                })
            });
            if (!typed.completed) {
                return {cancelled: true, frames: [], pointerTravel: combinePointerTravels(travels)};
            }
            scope.runWithoutUndo(() => textarea.dispatchEvent(new documentObject.defaultView.Event('change', {
                bubbles: true
            })));
            return {
                frames: [],
                pointerTravel: combinePointerTravels(travels),
                controlsVisible: true,
                intermediateValues: typed.intermediateValues,
                commentMatches: (workspaceComment ? !comment.blockId :
                    block.comment === comment && comment.blockId === blockId) && comment.getText() === plan.text,
                resolvedBlockId: blockId
            };
        }

        if (action === 'minimize') {
            const comment = existingComment;
            const arrow = commentControls(comment, workspaceComment).minimize;
            if (!visible(arrow)) throw new Error(`Comment minimize control is unavailable: ${plan.commentId}`);
            if (commentMinimized(comment) !== plan.sourceMinimized) {
                throw new Error(`Comment minimized state differs: ${plan.commentId}`);
            }
            const minimizeTravel = await pointer.travelTo(createElementPointerTarget({
                id: `comment:${plan.commentId}:minimize`,
                kind: 'comment-minimize-control',
                locate: () => arrow
            }), {clock, signal});
            travels.minimize = minimizeTravel;
            if (!minimizeTravel.completed) {
                return {cancelled: true, frames: [], pointerTravel: combinePointerTravels(travels)};
            }
            const clicked = await activateThroughPointer({
                pointer,
                clock,
                signal,
                activate: () => scope.runWithoutUndo(() => dispatchMouseSelection(
                    arrow,
                    minimizeTravel.target.point
                ))
            });
            if (!clicked) return {cancelled: true, frames: [], pointerTravel: combinePointerTravels(travels)};
            const commentMatches = await waitFor(
                () => commentMinimized(comment) === plan.minimized && comment,
                documentObject,
                signal
            );
            return {
                frames: [],
                pointerTravel: combinePointerTravels(travels),
                controlsVisible: true,
                commentMatches: Boolean(commentMatches),
                resolvedBlockId: blockId
            };
        }

        if (action === 'resize' || action === 'move') {
            const comment = existingComment;
            const controls = commentControls(comment, workspaceComment);
            let locate;
            let delta;
            if (action === 'resize') {
                const resize = controls.resize;
                if (!visible(resize)) throw new Error(`Comment resize control is unavailable: ${plan.commentId}`);
                if (!sizesMatch(commentSize(comment), plan.sourceSize)) {
                    throw new Error(`Comment source size differs: ${plan.commentId}`);
                }
                locate = () => resize;
                delta = {
                    x: (plan.size.width - plan.sourceSize.width) * workspace.scale * (workspace.RTL ? -1 : 1),
                    y: (plan.size.height - plan.sourceSize.height) * workspace.scale
                };
            } else {
                const topBar = controls.move;
                if (!visible(topBar)) throw new Error(`Comment move control is unavailable: ${plan.commentId}`);
                if (!coordinatesMatch(commentCoordinate(comment), plan.source)) {
                    throw new Error(`Comment source position differs: ${plan.commentId}`);
                }
                locate = () => topBar;
                delta = {
                    x: (plan.destination.x - plan.source.x) * workspace.scale,
                    y: (plan.destination.y - plan.source.y) * workspace.scale
                };
            }
            const dragged = await dragCommentControl({
                plan,
                locate,
                sourceKind: action === 'resize' ?
                    'comment-resize-control' : 'comment-top-bar',
                destinationKind: action === 'resize' ?
                    'comment-resize-destination' : 'comment-move-destination',
                delta,
                documentObject,
                clock,
                pointer,
                scope,
                signal,
                travels
            });
            if (!dragged) {
                return {cancelled: true, frames: [], pointerTravel: combinePointerTravels(travels)};
            }
            const commentMatches = await waitFor(() => (
                action === 'resize' ? sizesMatch(commentSize(comment), plan.size) :
                    coordinatesMatch(commentCoordinate(comment), plan.destination)
            ) && comment, documentObject, signal);
            return {
                frames: [],
                pointerTravel: combinePointerTravels(travels),
                controlsVisible: true,
                commentMatches: Boolean(commentMatches),
                resolvedBlockId: blockId
            };
        }

        if (workspaceComment && action === 'delete') {
            const deleteControl = commentControls(existingComment, true).delete;
            if (!visible(deleteControl)) {
                throw new Error(`Workspace comment delete control is unavailable: ${plan.commentId}`);
            }
            const deleteTravel = await pointer.travelTo(createElementPointerTarget({
                id: `comment:${plan.commentId}:delete`,
                kind: 'comment-delete-control',
                locate: () => deleteControl
            }), {clock, signal});
            travels.delete = deleteTravel;
            if (!deleteTravel.completed) {
                return {cancelled: true, frames: [], pointerTravel: combinePointerTravels(travels)};
            }
            const clicked = await activateThroughPointer({
                pointer,
                clock,
                signal,
                activate: () => scope.runWithoutUndo(() => dispatchMouseSelection(
                    deleteControl,
                    deleteTravel.target.point
                ))
            });
            if (!clicked) return {cancelled: true, frames: [], pointerTravel: combinePointerTravels(travels)};
            const commentMatches = await waitFor(
                () => !workspace.getCommentById(plan.commentId) && true,
                documentObject,
                signal
            );
            return {
                frames: [],
                pointerTravel: combinePointerTravels(travels),
                controlsVisible: true,
                commentMatches: Boolean(commentMatches),
                resolvedBlockId: null
            };
        }

        if (workspaceComment && action === 'create') {
            const background = workspace.svgBackground_;
            if (!visible(background)) throw new Error('Workspace comment surface is unavailable');
            const clientPoint = workspaceClientPoint(workspace, plan.coordinate);
            const bounds = background.getBoundingClientRect();
            const workspaceTravel = await pointer.travelTo(createElementPointerTarget({
                id: `comment:${plan.commentId}:workspace-create`,
                kind: 'workspace-comment-origin',
                locate: () => background,
                anchorX: 'start',
                anchorY: 'start',
                offsetX: clientPoint.x - bounds.left,
                offsetY: clientPoint.y - bounds.top
            }), {clock, signal});
            travels.workspace = workspaceTravel;
            if (!workspaceTravel.completed) {
                return {cancelled: true, frames: [], pointerTravel: combinePointerTravels(travels)};
            }
            openWorkspaceMenu({
                workspace,
                point: workspaceTravel.target.point,
                scope,
                documentObject
            });
            const option = await waitFor(
                () => menuItem(ScratchBlocks, ScratchBlocks.Msg.ADD_COMMENT),
                documentObject,
                signal
            );
            if (!visible(option)) throw new Error('Workspace Add Comment menu item is unavailable');
            const optionTravel = await pointer.travelTo(createElementPointerTarget({
                id: 'workspace-comment-menu:add',
                kind: 'context-menu-item',
                locate: () => option
            }), {clock, signal});
            travels.option = optionTravel;
            if (!optionTravel.completed) {
                ScratchBlocks.ContextMenu.hide();
                return {cancelled: true, frames: [], pointerTravel: combinePointerTravels(travels)};
            }
            const clicked = await activateThroughPointer({
                pointer,
                clock,
                signal,
                activate: () => scope.runWithoutUndo(() => withGeneratedIds(
                    ScratchBlocks,
                    [plan.commentId],
                    () => dispatchMouseSelection(option, optionTravel.target.point)
                ))
            });
            if (!clicked) return {cancelled: true, frames: [], pointerTravel: combinePointerTravels(travels)};
            const commentMatches = await waitFor(() => {
                const comment = workspace.getCommentById(plan.commentId);
                return comment && !comment.blockId && comment.getText() === '' &&
                    coordinatesMatch(commentCoordinate(comment), plan.coordinate) &&
                    sizesMatch(commentSize(comment), plan.size) &&
                    commentMinimized(comment) === plan.minimized && comment;
            }, documentObject, signal);
            return {
                frames: [],
                pointerTravel: combinePointerTravels(travels),
                controlsVisible: true,
                menuVisibleBeforeClick: true,
                commentMatches: Boolean(commentMatches),
                resolvedBlockId: null
            };
        }

        const blockTravel = await pointer.travelTo(createElementPointerTarget({
            id: `block:${blockId}:comment-menu`,
            kind: 'block-context-menu',
            locate: () => block.getSvgRoot()
        }), {clock, signal});
        travels.block = blockTravel;
        if (!blockTravel.completed) {
            return {cancelled: true, frames: [], pointerTravel: combinePointerTravels(travels)};
        }

        const label = plan.kind === 'block-comment-create' ?
            ScratchBlocks.Msg.ADD_COMMENT : ScratchBlocks.Msg.REMOVE_COMMENT;
        openBlockMenu({block, point: blockTravel.target.point, scope});
        const option = await waitFor(() => menuItem(ScratchBlocks, label), documentObject, signal);
        if (!visible(option)) throw new Error(`Block comment menu item is unavailable: ${label}`);
        const optionTravel = await pointer.travelTo(createElementPointerTarget({
            id: plan.kind === 'block-comment-create' ? 'comment-menu:add' : 'comment-menu:remove',
            kind: 'context-menu-item',
            locate: () => option
        }), {clock, signal});
        travels.option = optionTravel;
        if (!optionTravel.completed) {
            ScratchBlocks.ContextMenu.hide();
            return {cancelled: true, frames: [], pointerTravel: combinePointerTravels(travels)};
        }
        const clicked = await activateThroughPointer({
            pointer,
            clock,
            signal,
            activate: () => scope.runWithoutUndo(() => {
                const select = () => dispatchMouseSelection(option, optionTravel.target.point);
                if (plan.kind === 'block-comment-create') {
                    return withGeneratedIds(ScratchBlocks, [plan.commentId], select);
                }
                return select();
            })
        });
        if (!clicked) return {cancelled: true, frames: [], pointerTravel: combinePointerTravels(travels)};
        const commentMatches = plan.kind === 'block-comment-create' ? await waitFor(() => {
            const comment = workspace.getCommentById(plan.commentId);
            return block.comment === comment && comment && comment.blockId === blockId &&
                comment.getText() === plan.text && comment;
        }, documentObject, signal) : await waitFor(
            () => !workspace.getCommentById(plan.commentId) && !block.comment && true,
            documentObject,
            signal
        );
        return {
            frames: [],
            pointerTravel: combinePointerTravels(travels),
            controlsVisible: true,
            menuVisibleBeforeClick: true,
            commentMatches: Boolean(commentMatches),
            resolvedBlockId: blockId
        };
    }
});

export {createScratchBlocksCommentDriver};
