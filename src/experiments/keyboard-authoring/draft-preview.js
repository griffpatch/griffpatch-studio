import {insertBlock, placeBlock} from './operations';
import {fieldAtPosition, positionKey, resolveConnection} from './navigation';
import {captureDraftInsertionBoundary} from './draft-insertion-boundary';
import {ghostDraft} from './draft-appearance';
import {variableReporterXml} from './variables';
import {listReporterXml} from './lists';
import {bindVariableCommand, bindListCommand} from './variable-command';
import {bindBroadcastCommand} from './broadcast-command';
import {restoreWrappedStatementRange, wrapStatementRange} from './block-range-wrap';
import {restoreWrappedExpression, wrapExpression} from './expression-wrap';
import {comparisonIdentity, implicitComparisonXml, replaceComparison} from './comparison';
import {transformBlock} from './block-transform';
import {
    captureRootBounds,
    captureStackBounds,
    LIVE_STACK_LAYOUT,
    planProspectiveStackSpacing
} from './live-stack-layout';

const PLACEHOLDER = 'tw_keyboard_draft_statement';

// Reuse Scratch Blocks' existing isolated rendering contract. The authoritative
// workspace is never stretched, reparented or populated with a phantom block.
const createDraftPreview = ({workspace, ScratchBlocks}) => {
    if (!ScratchBlocks.Blocks[PLACEHOLDER]) {
        ScratchBlocks.Blocks[PLACEHOLDER] = {
            init: function () {
                this.jsonInit({extensions: ['colours_more', 'shape_statement']});
            }
        };
    }
    let surface = null;
    let actor = null;
    let actorSourceId = null;
    let key = null;
    let restoreBoundary = null;
    let restoreWrap = null;
    let restoreExpression = null;
    let replacementChild = null;
    let originalIds = null;
    let ownedVariable = null;
    let invalid = false;
    let mode = null;
    let tween = null;
    let spacerHeight = 0;
    let sourceLayout = [];
    let layoutBaselines = new Map();
    let layoutIncluded = new Set();
    let layoutOffsets = new Map();
    let layoutTargets = new Map();
    let layoutAnimation = null;
    let layoutActorId = null;
    let layoutAnchorId = null;
    let layoutPlan = [];
    let workspaceCaret = false;
    const normalHeight = ScratchBlocks.BlockSvg.MIN_BLOCK_Y;
    const spacerWidth = 144;
    const layoutDuration = 160;
    const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const clear = () => {
        if (surface) surface.dispose();
        surface = null;
        actor = null;
        actorSourceId = null;
        key = null;
        restoreBoundary = null;
        restoreWrap = null;
        restoreExpression = null;
        replacementChild = null;
        originalIds = null;
        ownedVariable = null;
        invalid = false;
        mode = null;
        tween = null;
        spacerHeight = 0;
        sourceLayout = [];
        layoutBaselines = new Map();
        layoutIncluded = new Set();
        layoutOffsets = new Map();
        layoutTargets = new Map();
        layoutAnimation = null;
        layoutActorId = null;
        layoutAnchorId = null;
        layoutPlan = [];
        workspaceCaret = false;
    };
    const resizeSpacer = height => {
        spacerHeight = height;
        actor.setStatementSpacerSize(spacerWidth, height);
    };
    const animateSpacer = (height, closing = false) => {
        if (tween && tween.to === height && tween.closing === closing) return;
        tween = {from: spacerHeight, to: height, start: performance.now(), closing};
    };
    const layoutRoot = id => {
        if (!surface) return null;
        const block = surface.workspace.getBlockById(id) || (id === layoutActorId && actor);
        return block && block.getRootBlock();
    };
    const applyLayoutOffsets = (now = performance.now(), hold = false) => {
        if (!surface) return;
        if (layoutAnimation && !hold) {
            const progress = reducedMotion() ? 1 : Math.min(1,
                (now - layoutAnimation.start) / layoutDuration);
            const amount = progress * progress * (3 - (2 * progress));
            const ids = new Set([...layoutAnimation.from.keys(), ...layoutAnimation.to.keys()]);
            for (const id of ids) {
                const from = layoutAnimation.from.get(id) || {dx: 0, dy: 0};
                const to = layoutAnimation.to.get(id) || {dx: 0, dy: 0};
                layoutOffsets.set(id, {
                    dx: from.dx + ((to.dx - from.dx) * amount),
                    dy: from.dy + ((to.dy - from.dy) * amount)
                });
            }
            if (progress === 1) {
                layoutOffsets = new Map(layoutAnimation.to);
                layoutAnimation = null;
            }
        }
        const positioned = new Set();
        for (const id of layoutIncluded) {
            const root = layoutRoot(id);
            const baseline = layoutBaselines.get(id);
            if (!root || !baseline || positioned.has(root.id)) continue;
            positioned.add(root.id);
            const offset = layoutOffsets.get(id) || {dx: 0, dy: 0};
            const xy = root.getRelativeToSurfaceXY();
            const targetX = baseline.x + (surface.workspace.RTL ? -offset.dx : offset.dx);
            const targetY = baseline.y + offset.dy;
            if (targetX !== xy.x || targetY !== xy.y) root.moveBy(targetX - xy.x, targetY - xy.y);
        }
    };
    const updateLayoutPlan = () => {
        if (!surface || !actor || !LIVE_STACK_LAYOUT.enabled) return;
        const now = performance.now();
        const root = actor.getRootBlock();
        layoutActorId = layoutAnchorId || root.id;
        layoutIncluded.add(layoutActorId);
        if (!layoutBaselines.has(layoutActorId)) {
            const xy = root.getRelativeToSurfaceXY();
            layoutBaselines.set(layoutActorId, {x: xy.x, y: xy.y});
            layoutOffsets.set(layoutActorId, {dx: 0, dy: 0});
            layoutTargets.set(layoutActorId, {dx: 0, dy: 0});
        }
        // Candidate replacement can restore the receiver to its native origin.
        // Reapply the currently painted offsets before measuring the new shape.
        applyLayoutOffsets(now, true);
        const current = layoutOffsets.get(layoutActorId) || {dx: 0, dy: 0};
        const prospective = captureRootBounds(surface.workspace, root);
        prospective.id = layoutActorId;
        // captureRootBounds already normalizes RTL to left-to-right coordinates.
        prospective.x -= current.dx;
        prospective.y -= current.dy;
        const previous = sourceLayout.find(block => block.id === root.id);
        const moves = !prospective.reporter && (!previous || prospective.height > previous.height) ?
            planProspectiveStackSpacing(sourceLayout, prospective, LIVE_STACK_LAYOUT.gap) : [];
        const needed = moves.map(move => move.id)
            .filter(id => id !== layoutActorId && !layoutIncluded.has(id) && workspace.getBlockById(id));
        if (needed.length) {
            if (typeof surface.includeRoots !== 'function') {
                throw new Error('Predictive layout needs the incremental Scratch Blocks presentation hook.');
            }
            surface.includeRoots(needed);
            for (const id of needed) layoutIncluded.add(id);
            // The authored candidate remains the visual actor while the
            // surrounding roots move out of its prospective footprint.
            actor.getRootBlock().bringToFront();
        }
        const targets = new Map([...layoutIncluded].map(id => [id, {dx: 0, dy: 0}]));
        for (const move of moves) targets.set(move.id, {dx: move.dx, dy: move.dy});
        const ids = new Set([...layoutTargets.keys(), ...targets.keys()]);
        const changed = [...ids].some(id => {
            const before = layoutTargets.get(id) || {dx: 0, dy: 0};
            const after = targets.get(id) || {dx: 0, dy: 0};
            return before.dx !== after.dx || before.dy !== after.dy;
        });
        layoutPlan = moves.map(move => ({...move}));
        if (!changed) return;
        layoutTargets = targets;
        layoutAnimation = {
            start: now,
            from: new Map([...layoutOffsets].map(([id, offset]) => [id, {...offset}])),
            to: new Map([...targets].map(([id, offset]) => [id, {...offset}]))
        };
    };
    const sync = (replan = false) => {
        if (!surface) return;
        // Replan once per candidate/field update, not on every pointer frame.
        // Measuring its containing root also covers nested values/expressions.
        if (replan) updateLayoutPlan();
        if (tween) {
            const progress = reducedMotion() ? 1 : Math.min(1, (performance.now() - tween.start) / 140);
            // Empty mouths have a native minimum height. Ease into collapse
            // so they do not hit that minimum before the next visible frame.
            const amount = tween.closing ? progress * progress : 1 - Math.pow(1 - progress, 3);
            ScratchBlocks.Events.disable();
            try {
                resizeSpacer(tween.from + ((tween.to - tween.from) * amount));
            } finally {
                ScratchBlocks.Events.enable();
            }
            // A connected empty placeholder is already a proposed structural
            // edit. Replan while its native root opens so neighbouring stacks
            // move with the continuation, before the first character is typed.
            updateLayoutPlan();
            if (progress === 1) {
                if (tween.closing) {
                    clear(); return;
                }
                tween = null;
            }
        }
        applyLayoutOffsets();
        surface.workspace.scale = workspace.scale;
        surface.workspace.getCanvas().setAttribute('transform', workspace.getCanvas().getAttribute('transform') || '');
        surface.workspace.getBubbleCanvas().setAttribute('transform',
            workspace.getBubbleCanvas().getAttribute('transform') || '');
    };
    const hitTest = (x, y) => {
        if (!surface) return null;
        const contains = element => {
            const rect = element.getBoundingClientRect();
            return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
        };
        // The preview can displace an existing tail. Hit-test the visible copy,
        // not the invisible authoritative blocks at their original coordinates.
        const blocks = surface.workspace.getAllBlocks(false).reverse();
        for (const block of blocks) {
            const source = workspace.getBlockById(block.id);
            const point = workspace.getParentSvg().createSVGPoint();
            point.x = x;
            point.y = y;
            for (const input of block.inputList) {
                for (const field of input.fieldRow) {
                    const original = source && source.getField(field.name);
                    if (original && original.EDITABLE && original.isCurrentlyEditable() &&
                        contains(field.getSvgRoot())) {
                        return {kind: 'field', blockId: source.id, fieldName: field.name};
                    }
                }
            }
            if (!block.svgPath_.isPointInFill(point.matrixTransform(block.svgPath_.getScreenCTM().inverse()))) {
                continue;
            }
            if (!source) return {kind: 'draft'};
            if (source.isShadow()) {
                const field = source.inputList.flatMap(input => input.fieldRow)
                    .find(item => item.name && item.EDITABLE && item.isCurrentlyEditable());
                if (field) return {kind: 'field', blockId: source.id, fieldName: field.name};
            } else {
                return {kind: 'block', blockId: source.id};
            }
        }
        return null;
    };
    const prepare = (position, kind, retainCaret = false) => {
        if (typeof workspace.createTransitionWorkspace !== 'function') {
            throw new Error('The keyboard preview needs the local Scratch Blocks presentation hook.');
        }
        const nextKey = `${kind}:${positionKey(position)}:${position.x}:${position.y}:${position.baselineY ?? ''}`;
        if (surface && key === nextKey && !invalid) return false;
        const anchor = position.blockId && workspace.getBlockById(position.blockId);
        const anchorRoot = anchor && anchor.getRootBlock();
        if (retainCaret && !invalid && mode === 'caret' && actor && actor.type === PLACEHOLDER &&
            restoreBoundary && anchorRoot && anchorRoot.id === layoutAnchorId) {
            // A caret relocation within one script transfers the reservation,
            // rather than closing and reopening it. Restore only the old native
            // boundary and retain the scene, spacer height and painted offsets.
            // The planner can then animate directly towards the new footprint.
            applyLayoutOffsets();
            restoreBoundary(actor);
            actor = null;
            tween = null;
        } else {
            clear();
            sourceLayout = captureStackBounds(workspace);
            layoutAnchorId = anchorRoot && anchorRoot.id;
            layoutBaselines = new Map(workspace.getTopBlocks(false).map(block => {
                const xy = block.getRelativeToSurfaceXY();
                return [block.id, {x: xy.x, y: xy.y}];
            }));
            surface = workspace.createTransitionWorkspace(anchorRoot ? [anchorRoot.id] : []);
            layoutIncluded = new Set(anchorRoot ? [anchorRoot.id] : []);
            layoutOffsets = new Map([...layoutIncluded].map(id => [id, {dx: 0, dy: 0}]));
            layoutTargets = new Map([...layoutOffsets].map(([id, offset]) => [id, {...offset}]));
        }
        key = nextKey;
        originalIds = new Set(surface.workspace.getAllBlocks(false).map(block => block.id));
        if (kind === 'block' || kind.startsWith('replace:')) {
            restoreBoundary = captureDraftInsertionBoundary({
                workspace: surface.workspace, ScratchBlocks, position
            });
        }
        return true;
    };
    const presentBlock = (position, createActor, caretOnly = false, replacementBlockId = null) => {
        if (!position || (!createActor && position.kind === 'input')) {
            clear();
            return;
        }
        ScratchBlocks.Events.disable();
        try {
            const fresh = prepare(position, replacementBlockId ? `replace:${replacementBlockId}` : 'block',
                caretOnly && !createActor);
            const sameCaret = !fresh && !createActor && actor && actor.type === PLACEHOLDER;
            if (!fresh && actor && !sameCaret) {
                restoreBoundary(actor);
                if (replacementChild) replacementChild.getSvgRoot().style.display = '';
                actor = null;
                replacementChild = null;
                tween = null;
                if (ownedVariable) surface.workspace.deleteVariableById(ownedVariable.getId());
                ownedVariable = null;
            }
            mode = caretOnly ? 'caret' : 'draft';
            surface.workspace.getCanvas().parentNode.dataset.keyboardPreview = mode;
            if (!sameCaret) {
                layoutActorId = null;
                workspaceCaret = !createActor && position.kind === 'workspace';
                if (createActor) {
                    if (replacementBlockId) {
                        const receiving = resolveConnection(surface.workspace, position);
                        replacementChild = receiving && receiving.targetBlock();
                        if (!replacementChild || replacementChild.isShadow() ||
                            replacementChild.id !== replacementBlockId) {
                            throw new Error('The selected expression no longer owns this input.');
                        }
                        replacementChild.getSvgRoot().style.display = 'none';
                        replacementChild.outputConnection.disconnect();
                    }
                    actor = createActor(surface.workspace);
                } else {
                    // The connected spacer is native, but strictly disposable.
                    // Its size reflows the receiving C and continuation together.
                    actor = surface.workspace.newBlock(PLACEHOLDER);
                    actor.initSvg();
                    // A detached caret reserves one honest command row. Other
                    // empty insertion points start collapsed, except when an
                    // existing caret reservation is transferred within a script.
                    resizeSpacer(workspaceCaret ? normalHeight :
                        (caretOnly ? spacerHeight : resolveConnection(workspace, position) ? 0 : normalHeight));
                    placeBlock(surface.workspace, position, actor);
                }
                ghostDraft(actor, originalIds);
            }
            if (!createActor) {
                // The single overlay supplies the calm moving dashed outline.
                actor.svgPath_.style.strokeOpacity = '0';
                actor.svgPath_.style.fillOpacity = '0';
                if (actor.type === PLACEHOLDER && (spacerHeight !== normalHeight || tween)) {
                    animateSpacer(normalHeight);
                }
            }
            sync(true);
        } catch (error) {
            clear();
            throw error;
        } finally {
            ScratchBlocks.Events.enable();
        }
    };
    const requiresSpace = position => {
        const anchor = position && workspace.getBlockById(position.blockId);
        const connection = position && resolveConnection(workspace, position);
        // An empty outer tail has no connected receiver to reflow, but its
        // prospective row still occupies space above neighbouring scripts.
        // Use the same isolated spacer and layout plan as a middle/body gap.
        return Boolean(anchor && ['gap', 'before'].includes(position.kind) && connection);
    };
    const presentTypedVariable = (position, choice, variableType, bindCommand, reporterXml = variableReporterXml,
        replacementBlockId = null) =>
        presentBlock(position, copy => {
            // Proposed identity models belong only to the isolated native
            // presentation. The live workspace, VM and history remain
            // untouched until the explicit creation row is accepted.
            const identityId = choice.variableId || choice.broadcastId;
            let variable = identityId && copy.getVariableById(identityId);
            if (!variable) {
                ownedVariable = copy.createVariable(choice.variableName || choice.broadcastName || choice.text,
                    variableType, null, choice.scope === 'local', false);
                variable = ownedVariable;
            }
            if (bindCommand) {
                return insertBlock({ScratchBlocks,
                    workspace: copy,
                    position,
                    instance: bindCommand(choice, variable)});
            }
            return placeBlock(copy, position, ScratchBlocks.Xml.domToBlock(reporterXml(variable), copy));
        }, false, replacementBlockId);
    return {
        clear,
        sync,
        hitTest,
        invalidate: () => {
            invalid = true;
        },
        needsRefresh: () => invalid,
        requiresSpace,
        isEmptyCaret: () => actor && actor.type === PLACEHOLDER && !(tween && tween.closing),
        displayBlock: id => surface && (surface.workspace.getBlockById(id) || (id === actorSourceId && actor)),
        layout: () => layoutPlan.map(move => ({...move})),
        contextBounds: position => {
            const anchor = workspace.getBlockById(position.blockId);
            const connection = resolveConnection(workspace, position);
            return actor && anchor && (anchor.getSurroundParent() || position.inputName ||
                (connection && connection.targetBlock())) ?
                actor.getRootBlock().getSvgRoot()
                    .getBoundingClientRect() : null;
        },
        bounds: () => actor && actor.svgPath_.getBoundingClientRect(),
        // Keep the long-standing neutral command outline for a new script. The
        // isolated native placeholder exists only to reserve layout space; it
        // must not make the caret narrower or imply an eventual hat block.
        path: () => actor && !(tween && tween.closing) && !workspaceCaret && actor.svgPath_,
        opacity: () => (actor && actor.type === PLACEHOLDER && !(tween && tween.closing) ?
            Math.max(0, Math.min(1, (spacerHeight - 8) / 16)) : 1),
        presentCaret: position => {
            if (position && position.kind === 'workspace') {
                presentBlock(position, null, true);
                return;
            }
            if (!requiresSpace(position)) {
                if (mode === 'caret' && !invalid && actor && actor.type === PLACEHOLDER) animateSpacer(0, true);
                else if (surface) clear();
                return;
            }
            presentBlock(position, null, true);
        },
        presentBroadcast: (position, choice) => presentTypedVariable(position, choice,
            ScratchBlocks.BROADCAST_MESSAGE_VARIABLE_TYPE, bindBroadcastCommand),
        presentProcedure: (position, xml) => presentBlock(position, copy =>
            placeBlock(copy, position, ScratchBlocks.Xml.domToBlock(xml.cloneNode(true), copy))),
        presentVariable: (position, choice, replacementBlockId = null) => presentTypedVariable(position, choice, '',
            choice.kind === 'create-variable-command' ? bindVariableCommand : null, variableReporterXml,
            replacementBlockId),
        presentList: (position, choice, replacementBlockId = null) => presentTypedVariable(position, choice,
            ScratchBlocks.LIST_VARIABLE_TYPE, choice.kind === 'create-list-command' ? bindListCommand : null,
            listReporterXml, replacementBlockId),
        presentImplicitComparison: (position, result) => presentBlock(position, copy => {
            const left = comparisonIdentity(result);
            const identityChoice = left && ['variable', 'create-variable', 'list', 'create-list'].includes(left.kind) ?
                left : null;
            let identity = null;
            if (identityChoice) {
                const list = ['list', 'create-list'].includes(identityChoice.kind);
                const type = list ? ScratchBlocks.LIST_VARIABLE_TYPE : '';
                const name = list ? identityChoice.listName : identityChoice.text.trim();
                let variable = identityChoice.variableId && copy.getVariableById(identityChoice.variableId);
                if (!variable) {
                    ownedVariable = copy.createVariable(name, type, identityChoice.variableId || null,
                        identityChoice.scope === 'local', false);
                    variable = ownedVariable;
                }
                identity = {list, name, id: variable.getId(), existing: variable};
            }
            const xml = implicitComparisonXml(result.instance, identity);
            return placeBlock(copy, position, ScratchBlocks.Xml.domToBlock(xml, copy));
        }),
        presentComparisonReplacement: (position, instance, sourceBlockId) => {
            ScratchBlocks.Events.disable();
            try {
                const fresh = prepare(position,
                    `comparison-replace:${sourceBlockId}:${instance.typeInfo.workspaceForm.type}`);
                if (!fresh && actor) return;
                mode = 'draft';
                surface.workspace.getCanvas().parentNode.dataset.keyboardPreview = mode;
                actor = replaceComparison({
                    ScratchBlocks,
                    workspace: surface.workspace,
                    sourceBlockId,
                    instance
                }).block;
                actorSourceId = sourceBlockId;
                ghostDraft(actor, originalIds);
                sync(true);
            } catch (error) {
                clear();
                throw error;
            } finally {
                ScratchBlocks.Events.enable();
            }
        },
        presentBlockTransformation: (position, instance, sourceBlockId) => {
            ScratchBlocks.Events.disable();
            try {
                const fresh = prepare(position,
                    `block-transform:${sourceBlockId}:${instance.typeInfo.workspaceForm.type}`);
                if (!fresh && actor) return;
                mode = 'draft';
                surface.workspace.getCanvas().parentNode.dataset.keyboardPreview = mode;
                actor = transformBlock({
                    ScratchBlocks,
                    workspace: surface.workspace,
                    sourceBlockId,
                    instance,
                    allowReadOnly: true
                }).block;
                actorSourceId = sourceBlockId;
                ghostDraft(actor, originalIds);
                sync(true);
            } catch (error) {
                clear();
                throw error;
            } finally {
                ScratchBlocks.Events.enable();
            }
        },
        presentValue: (position, value) => {
            ScratchBlocks.Events.disable();
            try {
                prepare(position, 'value');
                mode = 'draft';
                surface.workspace.getCanvas().parentNode.dataset.keyboardPreview = mode;
                // Presentation fields are deliberately read-only. Resolve the
                // editable source first, then its copied identity, not the
                // copy's isCurrentlyEditable() state.
                const source = fieldAtPosition(workspace, position);
                const block = source && surface.workspace.getBlockById(source.block.id);
                const field = block && block.getField(source.field.name);
                if (!field) throw new Error('The value preview lost its native field.');
                field.setValue(value);
                actor = block;
                sync(true);
            } catch (error) {
                clear();
                throw error;
            } finally {
                ScratchBlocks.Events.enable();
            }
        },
        presentWrap: (position, instance, range) => {
            ScratchBlocks.Events.disable();
            try {
                const fresh = prepare(position, `wrap:${range.blockIds.join(',')}`);
                if (!fresh && actor && restoreWrap) {
                    restoreWrap();
                    actor = null;
                    restoreWrap = null;
                }
                mode = 'draft';
                surface.workspace.getCanvas().parentNode.dataset.keyboardPreview = mode;
                const result = wrapStatementRange({ScratchBlocks, workspace: surface.workspace, range, instance});
                actor = result.block;
                restoreWrap = () => restoreWrappedStatementRange({
                    workspace: surface.workspace,
                    wrapper: actor,
                    range,
                    inputName: result.inputName
                });
                ghostDraft(actor, originalIds);
                sync(true);
            } catch (error) {
                clear();
                throw error;
            } finally {
                ScratchBlocks.Events.enable();
            }
        },
        presentExpressionWrap: (position, instance, sourceBlockId) => {
            ScratchBlocks.Events.disable();
            try {
                const fresh = prepare(position, `expression-wrap:${sourceBlockId}`);
                if (!fresh && actor && restoreExpression) {
                    restoreExpression();
                    actor = null;
                    restoreExpression = null;
                }
                mode = 'draft';
                surface.workspace.getCanvas().parentNode.dataset.keyboardPreview = mode;
                const source = surface.workspace.getBlockById(sourceBlockId);
                const incoming = source && source.outputConnection.targetConnection;
                const result = wrapExpression({
                    ScratchBlocks,
                    workspace: surface.workspace,
                    sourceBlockId,
                    instance
                });
                actor = result.block;
                restoreExpression = () => restoreWrappedExpression({
                    wrapper: actor,
                    sourceBlockId,
                    inputName: result.inputName,
                    incoming
                });
                ghostDraft(actor, originalIds);
                sync(true);
            } catch (error) {
                clear();
                throw error;
            } finally {
                ScratchBlocks.Events.enable();
            }
        },
        present: (position, instance, replacementBlockId = null) => presentBlock(position, instance ? copy =>
            insertBlock({ScratchBlocks, workspace: copy, position, instance}) : null, false, replacementBlockId)
    };
};

export {createDraftPreview};
