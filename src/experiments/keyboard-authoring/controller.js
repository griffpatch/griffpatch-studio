import {createCatalogue} from './catalogue';
import {canonicalPosition, deletionPosition, editableFields, fieldAtPosition, firstInput,
    navigate, navigationStops, positionKey, recoverPosition, resolveConnection, valueInputPosition,
    outerScriptBoundary} from './navigation';
import {NavigationSession} from './navigation-session';
import {ExitConfirmation} from './exit-confirmation';
import {createKeyboardHelp} from './keyboard-help';
import {cleanUpAtScript, isCleanUpShortcut} from './cleanup';
import {captureCaret, resolveCaret, getCaretMemory} from './navigation-memory';
import {getNavigationHistory} from '../../addons/libraries/common/cs/navigation-history';
import {getScriptContext} from '../../addons/libraries/common/cs/script-context';
import {workspaceTopInset} from '../../addons/libraries/common/cs/workspace-insets';
import {animateScrollTo, initializeSmoothScrolling, scrollPosFromOffset} from
    '../../addons/libraries/common/cs/block-scrolling';
import {detachedStackPosition, insertBlock, removeBlock, setInputValue, splitStack} from './operations';
import {createDraftPreview} from './draft-preview';
import {revealDelta, scriptFrameDelta, svgClientBounds} from './viewport';
import {completeText, expressionContinuationQuery, isCompactNegativeNumber, numericContinuationPrefix,
    valueContinuationQuery} from './text-completion';
import {compositionLayout} from './composition-layout';
import {completionChoices, isBooleanOnlyConnection} from './completion';
import {comparisonIdentity, comparisonReplacementChoice, implicitComparisonChoices, insertImplicitComparison,
    replaceComparison} from './comparison';
import {canTransformBlock, rankTransformationChoices, transformBlock, transformationChoice} from
    './block-transform';
import {caretOutline, rangeContour, columnCuePosition} from './caret-outline';
import {createVariableCompletion, isVariableCreation, scopeLabel} from './variables';
import {createListCompletion, isListCreation} from './lists';
import {createBroadcastCompletion, isBroadcastCreation} from './broadcast-creation';
import {createProcedureCompletion, isProcedureCreation} from './procedure-declaration';
import refreshProcedurePalette from './procedure-palette';
import {createBroadcastRenamer} from './broadcast-rename';
import {f2Target} from './f2-target';
import {createBlockClipboard} from './block-clipboard';
import {blocksInRange, entireSiblingRange, extendBlockRange, rangeDeletionPosition, rangeFor} from './block-range';
import {moveStatementRange} from './block-range-move';
import {canWrapStatementRange, wrapStatementRange} from './block-range-wrap';
import {wrappingHistoryFocus} from './wrapping-history-focus';
import {canWrapExpression, wrapExpression} from './expression-wrap';
import {compileMultilinePaste} from './multiline-paste';
import {blockIconLabel, loadBlockIconLabel} from './block-icon-labels';
import {categoryLabel} from './category-label';
import {NavigationHandoff} from './navigation-handoff';
import {isTextInput, keyOwner, canReturnFocus, createFocusReturn} from './focus-ownership';
import {attachLiveStackLayout} from './live-stack-layout';
import {resultNavigationDirection} from '../../addons/addons/find-bar/result-navigation';
import {blockAtPointerTarget, updateBlockHover} from './pointer-hover';
import styles from './keyboard-authoring.css';

const stop = event => {
    event.preventDefault();
    event.stopImmediatePropagation();
};

const attachKeyboardAuthoring = ({workspace, ScratchBlocks, vm, session, isVisible, getLocale = () => 'en'}) => {
    // Explicit opt-out remains available for native-editor comparisons.
    if (new URLSearchParams(window.location.search).get('keyboard-authoring') === '0') return null;
    const caretMemory = getCaretMemory(vm);
    const sharedHistory = getNavigationHistory(vm, () => workspace);
    const scriptContext = getScriptContext(vm);
    const make = (tag, className, parent, attributes = {}) => {
        const element = document.createElement(tag);
        if (className) element.className = className;
        Object.keys(attributes).forEach(key => element.setAttribute(key, attributes[key]));
        if (parent) parent.appendChild(element);
        return element;
    };
    const root = make('div', styles.root, document.body, {'data-keyboard-authoring': 'experimental'});
    const bar = make('div', styles.bar, root);
    const toggle = make('button', '', bar, {
        'type': 'button', 'aria-pressed': 'false', 'title': 'Toggle keyboard authoring (Alt+K)'
    });
    toggle.textContent = 'Keyboard';
    const badge = make('button', styles.helpTrigger, bar, {'type': 'button', 'aria-label': 'Keyboard help'});
    badge.textContent = 'Alt+K';
    badge.title = 'Open the keyboard editing guide';
    const surface = make('div', styles.surface, root, {
        'tabindex': '-1', 'role': 'application', 'aria-label': 'Scratch keyboard editor', 'aria-keyshortcuts': 'Alt+S'
    });
    const caret = make('div', styles.caret, root, {'aria-hidden': 'true'});
    const columnCue = make('div', styles.columnCue, root, {'aria-hidden': 'true', 'data-column-cue': ''});
    columnCue.hidden = true;
    const svgNamespace = 'http://www.w3.org/2000/svg';
    const svgElement = tag => document.createElementNS(svgNamespace, tag);
    const caretSvg = svgElement('svg');
    const caretDefs = svgElement('defs');
    const rangeMask = svgElement('mask');
    const rangeMaskId = `keyboard-range-contour-${Math.random().toString(36)
        .slice(2)}`;
    rangeMask.id = rangeMaskId;
    rangeMask.setAttribute('maskUnits', 'userSpaceOnUse');
    rangeMask.setAttribute('maskContentUnits', 'userSpaceOnUse');
    rangeMask.style.maskType = 'luminance';
    const rangeMaskBackground = svgElement('rect');
    rangeMaskBackground.style.fill = 'black';
    const rangeMaskEdges = svgElement('g');
    const rangeMaskFills = svgElement('g');
    rangeMask.append(rangeMaskBackground, rangeMaskEdges, rangeMaskFills);
    caretDefs.appendChild(rangeMask);
    const caretPaths = svgElement('g');
    caretPaths.dataset.caretPaths = 'true';
    caretSvg.append(caretDefs, caretPaths);
    caret.appendChild(caretSvg);
    const draftView = make('div', styles.draft, root);
    const input = make('input', styles.input, draftView, {
        'aria-label': 'Type a Scratch block',
        'role': 'combobox',
        'aria-autocomplete': 'list',
        'aria-expanded': 'false',
        'aria-controls': 'keyboard-block-suggestions',
        'autocomplete': 'off',
        'spellcheck': 'false',
        'maxlength': '256'
    });
    const list = make('div', styles.list, draftView, {role: 'listbox', id: 'keyboard-block-suggestions'});
    const help = make('div', styles.help, draftView);
    const scopePreference = make('label', styles.scopePreference, draftView);
    scopePreference.appendChild(document.createTextNode('New variables'));
    const scopeSelect = make('select', '', scopePreference, {'aria-label': 'Default variable scope'});
    [['uppercase', 'By name: UPPERCASE → all sprites'], ['local', 'This sprite first'], ['global', 'All sprites first']]
        .forEach(([value, label]) => {
            make('option', '', scopeSelect, {value}).textContent = label;
        });
    const scopePreferenceKey = 'tw:keyboard-variable-scope';
    try {
        const saved = window.localStorage.getItem(scopePreferenceKey);
        if (['uppercase', 'local', 'global'].includes(saved)) scopeSelect.value = saved;
    } catch (error) { /* A blocked preference store must not prevent editing. */ }
    const announcement = make('div', styles.announcement, root, {'aria-live': 'polite'});
    let enabled = false;
    const findBarHandoff = new NavigationHandoff();
    const navigationSession = new NavigationSession();
    const exitConfirmation = new ExitConfirmation();
    let position = null;
    let draft = null;
    let results = [];
    let selected = 0;
    let catalogue = null;
    let composing = false;
    let enterHeld = false;
    let editingField = false;
    let pressed = null;
    const nativeDragGroups = new Set();
    let blockRange = null;
    let preferBlockPaste = false;
    let detached = false;
    let hoveredBlock = null;
    let raf = null;
    let previewScale = workspace.scale;
    let caretReadyAt = 0;
    let previousStops = navigationStops(workspace);
    let navigationDirty = false;
    let rangePresentationCache = null;
    let rangePresentationDirty = true;
    let caretPresentationKey = null;
    let caretPresentationRevision = 0;
    let iconLabel = blockIconLabel;
    let iconLabelLocale = null;
    let iconLabelPromise = null;
    const ensureIconLabels = () => {
        const requestedLocale = getLocale();
        if (requestedLocale === iconLabelLocale && !iconLabelPromise) return Promise.resolve();
        if (iconLabelPromise && iconLabelPromise.locale === requestedLocale) return iconLabelPromise;
        const promise = loadBlockIconLabel(requestedLocale).then(label => {
            if (iconLabelPromise !== promise) return;
            iconLabel = label;
            iconLabelLocale = requestedLocale;
            iconLabelPromise = null;
        });
        promise.locale = requestedLocale;
        iconLabelPromise = promise;
        return promise;
    };
    const invalidateRangePresentation = () => {
        rangePresentationDirty = true;
    };
    const wrappingHistory = new Map();
    const preview = createDraftPreview({workspace, ScratchBlocks});
    const stackLayout = attachLiveStackLayout({workspace,
        ScratchBlocks,
        available: () => isVisible() && !(session && session.getState().busy)});
    const onCreateGroup = group => {
        if (session && session.tagEventGroup) session.tagEventGroup(group, {kind: 'keyboard-authoring'});
        return stackLayout.beginEdit();
    };
    const variables = createVariableCompletion({workspace, ScratchBlocks, vm, onGroup: onCreateGroup});
    const lists = createListCompletion({workspace, ScratchBlocks, vm, onGroup: onCreateGroup});
    const broadcastCreation = createBroadcastCompletion({workspace, ScratchBlocks, vm, onGroup: onCreateGroup});
    const procedures = createProcedureCompletion({workspace, ScratchBlocks, vm, onGroup: onCreateGroup});
    const blockClipboard = createBlockClipboard({workspace, ScratchBlocks, vm, onGroup: onCreateGroup});
    const baseChoice = choice => comparisonIdentity(choice) || choice;
    const isExplicitCreation = choice => {
        const base = baseChoice(choice);
        return isVariableCreation(base) || isListCreation(base) || isBroadcastCreation(base) ||
            isProcedureCreation(base);
    };
    const activeTargetId = () => vm.editingTarget && vm.editingTarget.id;
    let targetId = activeTargetId();
    let toolboxTargetId = targetId;
    const busy = () => session && session.getState().busy;
    const announce = text => {
        announcement.textContent = text;
    };
    let broadcastRenamer;
    try {
        broadcastRenamer = createBroadcastRenamer({workspace, ScratchBlocks, vm});
    } catch (error) {
        announce(`Broadcast rename unavailable: ${error.message}`);
    }
    const visibleBounds = () => {
        const rect = workspace.getParentSvg().getBoundingClientRect();
        const metrics = workspace.getMetrics();
        const left = rect.left + (metrics ? metrics.absoluteLeft + metrics.flyoutWidth : 0);
        return {left, top: rect.top + workspaceTopInset(workspace), right: rect.right - 18, bottom: rect.bottom - 52};
    };
    const clientPoint = (x, y) => {
        const point = workspace.getParentSvg().createSVGPoint();
        point.x = x;
        point.y = y;
        return point.matrixTransform(workspace.getCanvas().getScreenCTM());
    };
    const workspacePoint = (x, y) => {
        const point = workspace.getParentSvg().createSVGPoint();
        point.x = x;
        point.y = y;
        return point.matrixTransform(workspace.getCanvas().getScreenCTM()
            .inverse());
    };
    const freshPosition = () => {
        const bounds = visibleBounds();
        let x = bounds.left + 36;
        let y = bounds.top + 54;
        const boxes = workspace.getTopBlocks(false).map(block => block.getSvgRoot().getBoundingClientRect());
        for (let attempt = 0; attempt < boxes.length + 1; attempt++) {
            const currentX = x;
            const currentY = y;
            const occupied = boxes.find(box => currentX < box.right + 24 && currentX + 200 > box.left &&
                currentY < box.bottom + 24 && currentY + 70 > box.top);
            if (!occupied) break;
            if (occupied.bottom + 120 < bounds.bottom) y = occupied.bottom + 40;
            else {
                x = occupied.right + 40; y = bounds.top + 54;
            }
        }
        const point = workspacePoint(x, y);
        return {kind: 'workspace', x: point.x, y: point.y};
    };
    const reconcileNavigation = () => {
        if (!navigationDirty) return;
        const stops = navigationStops(workspace);
        position = recoverPosition(stops, previousStops, canonicalPosition(workspace, position)) || freshPosition();
        previousStops = stops;
        navigationDirty = false;
    };
    const reconcileWrappingHistory = () => {
        if (!navigationDirty) return;
        const records = Array.from(wrappingHistory.values()).reverse();
        for (const record of records) {
            const resolved = wrappingHistoryFocus(workspace, record);
            if (!resolved || resolved.state === record.state) continue;
            record.state = resolved.state;
            blockRange = resolved.range;
            invalidateRangePresentation();
            position = resolved.position;
            navigationDirty = true;
            caretReadyAt = performance.now() + 100;
            announce(resolved.state === 'wrapped' ?
                `Restored the wrapped ${record.sourceBlockId ? 'expression' : 'C block'}.` :
                resolved.range ? `${resolved.range.blockIds.length} unwrapped commands selected.` :
                    'Restored the selected expression.');
            break;
        }
    };
    const defaultAfter = block => {
        if (block.nextConnection) return {kind: 'gap', blockId: block.id};
        const xy = block.getRelativeToSurfaceXY();
        return {kind: 'workspace', x: xy.x, y: xy.y + block.getHeightWidth().height + 48};
    };
    const geometry = (point, measure = element => element.getBoundingClientRect()) => {
        if (!point) return null;
        const block = point.blockId && workspace.getBlockById(point.blockId);
        if (point.kind === 'workspace' || (point.kind === 'after' && block)) {
            const at = point.kind === 'after' ? defaultAfter(block) : point;
            const xy = clientPoint(at.x, at.y);
            return {left: xy.x,
                top: xy.y,
                width: 144 * workspace.scale,
                height: (ScratchBlocks.BlockSvg.MIN_BLOCK_Y + ScratchBlocks.BlockSvg.NOTCH_HEIGHT) * workspace.scale};
        }
        if (!block) return null;
        if (point.kind === 'field') {
            const field = (preview.displayBlock(point.blockId) || block).getField(point.fieldName);
            return field && measure(field.getSvgRoot());
        }
        if (point.kind === 'input') {
            const slot = block.getInput(point.inputName);
            const child = slot && slot.connection && slot.connection.targetBlock();
            const element = child ? child.getSvgRoot() : slot && slot.outlinePath;
            if (element) return measure(element);
        }
        if (point.kind === 'gap' || point.kind === 'before') {
            const receiving = resolveConnection(workspace, point);
            const connection = receiving || block.previousConnection;
            if (!connection) return null;
            const xy = clientPoint(connection.x_ - ScratchBlocks.BlockSvg.NOTCH_WIDTH, connection.y_);
            const height = (ScratchBlocks.BlockSvg.MIN_BLOCK_Y + ScratchBlocks.BlockSvg.NOTCH_HEIGHT) * workspace.scale;
            // A free upper boundary ends at the existing stack's top notch;
            // drawing down from it would cover the block we want to precede.
            const top = point.kind === 'before' && !receiving ?
                xy.y - height + (ScratchBlocks.BlockSvg.NOTCH_HEIGHT * workspace.scale) : xy.y;
            return {left: xy.x, top, width: 144 * workspace.scale, height};
        }
        const box = measure(block.svgPath_);
        if (!box) return null;
        const mouth = block.inputList.find(slot => slot.connection && slot.connection.type === 3);
        if (mouth && point.kind === 'block') {
            // The command row is its header, not the full C shape around all
            // its descendants. Use the renderer's actual mouth connection.
            const bodyStart = clientPoint(mouth.connection.x_, mouth.connection.y_);
            return {
                left: box.left,
                top: box.top,
                width: box.width,
                height: Math.max(1, Math.min(box.height, bodyStart.y - box.top))
            };
        }
        return box;
    };
    const outlineSource = point => {
        const block = point && (preview.displayBlock(point.blockId) || workspace.getBlockById(point.blockId));
        if (!block) return null;
        if (point.kind === 'block') return block.svgPath_;
        if (point.kind === 'input') {
            const slot = block.getInput(point.inputName);
            const child = slot && slot.connection && slot.connection.targetBlock();
            return child ? child.svgPath_ : slot && slot.outlinePath;
        }
        return null;
    };
    const closeDraft = ({keepPreview = false} = {}) => {
        if (!keepPreview) preview.clear();
        if (catalogue) catalogue.dispose();
        catalogue = null;
        draft = null;
        composing = false;
        results = [];
        input.value = '';
        draftView.hidden = true;
    };
    const focusSurface = () => {
        // Custom-procedure dialogs inject their own Blockly workspace. Restore
        // native keyboard ownership too, not only browser DOM focus.
        workspace.markFocused();
        surface.focus({preventScroll: true});
    };
    const focusReturn = createFocusReturn({
        capture: () => ({
            request: sharedHistory.request,
            targetId: activeTargetId(),
            widget: ScratchBlocks.WidgetDiv.owner_,
            dropdown: ScratchBlocks.DropDownDiv.owner_
        }),
        isCurrent: context => !detached && enabled && isVisible() && !busy() && !draft &&
            context.targetId === activeTargetId() && context.request === sharedHistory.request &&
            // Native hide animations retain their owner until the last frame.
            // Return from that same editor immediately, but never steal a newer one.
            (!ScratchBlocks.WidgetDiv.isVisible() || ScratchBlocks.WidgetDiv.owner_ === context.widget) &&
            (!ScratchBlocks.DropDownDiv.isVisible() || ScratchBlocks.DropDownDiv.owner_ === context.dropdown) &&
            !document.querySelector('.ReactModal__Content') &&
            canReturnFocus(document.activeElement, {
                surface,
                body: document.body,
                workspaceSvg: workspace.getParentSvg()
            }),
        restore: () => {
            editingField = false;
            focusSurface();
        },
        requestFrame: callback => window.requestAnimationFrame(callback)
    });
    const clearBlockHover = () => {
        hoveredBlock = updateBlockHover(hoveredBlock, null, styles.hoveredBlock);
    };
    const ensureVisible = () => {
        // Column travel can cull the entire source stack. Use the same native
        // SVG fallback as explicit framing instead of revealing a zero rect.
        const measure = element => svgClientBounds(element, workspace.getCanvas());
        const box = geometry(position, measure);
        if (!box) return;
        const delta = revealDelta(box, visibleBounds());
        if ((delta.x || delta.y) && workspace.scrollbar) {
            // Workspace.scroll is a drag-only API in this Scratch Blocks fork:
            // it requires a gesture's cached startDragMetrics. Use the native
            // scrollbar with current metrics for programmatic caret navigation.
            workspace.resizeContents();
            // Resizing can clamp an off-canvas view back into the native scroll
            // range. The old client-pixel delta is no longer relative to this
            // viewport; measure again before applying the final correction.
            const settled = geometry(position, measure);
            if (!settled) return;
            const {x: dx, y: dy} = revealDelta(settled, visibleBounds());
            if (!dx && !dy) return;
            const metrics = workspace.getMetrics();
            sharedHistory.programmaticScroll(() => workspace.scrollbar.set(
                -workspace.scrollX - dx - metrics.contentLeft,
                -workspace.scrollY - dy - metrics.contentTop));
        }
    };
    const showCurrentScript = async () => {
        const measure = element => svgClientBounds(element, workspace.getCanvas());
        const box = geometry(position, measure);
        const block = position && workspace.getBlockById(position.blockId);
        const script = block && block.getRootBlock();
        const displayed = script && (preview.displayBlock(script.id) || script);
        const head = displayed && measure(displayed.svgPath_);
        const {x, y} = scriptFrameDelta(head, box, visibleBounds());
        if ((!x && !y) || !workspace.scrollbar) return;
        const operation = sharedHistory.beginNavigation(activeTargetId());
        const current = () => !detached && enabled && isVisible() && !busy() &&
            activeTargetId() === operation.targetId && sharedHistory.isCurrent(operation);
        try {
            initializeSmoothScrolling(ScratchBlocks);
            await sharedHistory.programmaticScroll(async () => {
                // Geometry and offsets must describe the same frame. A resize
                // here can clamp the old camera before its delta is applied.
                const metrics = workspace.getMetrics();
                const {sx, sy} = scrollPosFromOffset({left: metrics.viewLeft - x, top: metrics.viewTop - y}, metrics);
                await animateScrollTo(workspace, sx, sy, current);
            });
            if (current()) {
                sharedHistory.finishNavigation(operation);
                announce('Current script framed. Ctrl Left returns to the previous view.');
            }
        } finally {
            if (sharedHistory.operation === operation) sharedHistory.interrupt(false);
        }
    };
    const setEnabled = (value, {reveal = true, preserveNavigation = false, focus = true,
        preservePreference = false} = {}) => {
        focusReturn.cancel();
        if (!preservePreference) caretMemory.enabled = value;
        navigationSession.cancel();
        exitConfirmation.reset();
        if (!preserveNavigation) findBarHandoff.cancel();
        enabled = value;
        scriptContext.caretActive = enabled;
        workspace.getCanvas().classList.toggle(styles.keyboardCanvas, enabled);
        pressed = null;
        clearBlockHover();
        blockRange = null;
        invalidateRangePresentation();
        toggle.setAttribute('aria-pressed', String(value));
        badge.textContent = value ? 'Alt+K · Arrows · Enter · Esc ×2' : 'Alt+K';
        closeDraft();
        editingField = false;
        if (enabled) {
            // A newly created or manually selected sprite can become editable
            // before Scratch emits workspaceUpdate. Binding the mode at its
            // explicit entry point keeps cross-target clipboard identities tied
            // to the VM target which actually owns this visible workspace.
            targetId = vm.editingTarget && vm.editingTarget.id;
            const nativeSelected = ScratchBlocks.selected;
            position = nativeSelected && nativeSelected.workspace === workspace ?
                {kind: 'block', blockId: nativeSelected.id} :
                position || navigationStops(workspace)[0] || freshPosition();
            if (focus) focusSurface();
            if (reveal) ensureVisible();
            announce('Left/right explore inputs and bodies; up/down visit statements. ' +
                'Shift up/down selects sibling commands; Alt up/down moves the selection. ' +
                'Enter inserts below; Shift Enter inserts above; ' +
                'Ctrl Enter explores the selected definition or usages; press Escape twice to leave keyboard mode.');
        } else {
            caret.hidden = true;
            if (document.activeElement === surface) surface.blur();
        }
    };
    const keyboardHelp = createKeyboardHelp({parent: root,
        className: styles.keyboardHelp,
        onClose: () => {
            exitConfirmation.reset();
            if (detached || !isVisible()) return;
            if (enabled) {
                if (draft) input.focus();
                else focusSurface();
            } else badge.focus();
        }});
    badge.addEventListener('click', () => keyboardHelp.open());
    const enableWhenReady = options => ensureIconLabels().then(() => {
        if (!detached) {
            setEnabled(true, options);
            keyboardHelp.open(true);
        }
    });
    const selectPosition = (next, {keepRange = false, focus = true, reveal = true, keepNavigation = false} = {}) => {
        if (!next) return;
        if (!keepNavigation) navigationSession.cancel();
        exitConfirmation.reset();
        clearBlockHover();
        invalidateRangePresentation();
        closeDraft({keepPreview: !draft});
        if (!keepRange) blockRange = null;
        position = canonicalPosition(workspace, next);
        caretReadyAt = performance.now() + 100;
        navigationDirty = true;
        const block = position.blockId && workspace.getBlockById(position.blockId);
        if (block && !block.isShadow()) block.select();
        scriptContext.set(vm.editingTarget?.id, {...position, rootId: block?.getRootBlock().id});
        if (focus) focusSurface();
        if (reveal) ensureVisible();
        announce(block ? `${block.toString()} · ${position.kind}` : 'New script');
    };
    const onBlockDrag = detail => {
        if (!detail || detail.workspaceId !== workspace.id || !detail.group) return;
        if (detail.phase === 'start') {
            // Remember only a native drag which began while this editor owned
            // the workspace. Replays and disabled-mode mouse edits must not
            // acquire Keyboard focus when their asynchronous drop settles.
            if (enabled && isVisible() && !busy() && !editingField) nativeDragGroups.add(detail.group);
            return;
        }
        if (detail.phase !== 'settled' || !nativeDragGroups.delete(detail.group)) return;
        if (!enabled || !isVisible() || busy() || editingField || vm.editingTarget?.id !== targetId) return;
        const block = workspace.getBlockById(detail.blockId);
        // BlockDragger has now completed snapping, bumping, events and VM
        // synchronization. Hand the settled native block back to structural
        // navigation without scrolling the viewport after the user's drop. A
        // cancelled, outside or deleting drag still returns keyboard ownership;
        // its authored position is recovered by the normal navigation model.
        if (block && !block.isShadow()) selectPosition({kind: 'block', blockId: block.id}, {reveal: false});
        else {
            reconcileNavigation();
            focusSurface();
        }
    };
    const extendRange = direction => {
        if (position.kind !== 'block') return false;
        const block = workspace.getBlockById(position.blockId);
        if (!block || block.outputConnection) return false;
        const previousRange = blockRange;
        const nextRange = extendBlockRange(workspace, blockRange, block.id, direction);
        const focusBlockId = nextRange ? nextRange.focusBlockId :
            previousRange ? previousRange.anchorBlockId : block.id;
        blockRange = nextRange;
        selectPosition({kind: 'block', blockId: focusBlockId}, {keepRange: true});
        const focusBlock = workspace.getBlockById(focusBlockId);
        announce(blockRange ? `${blockRange.blockIds.length} blocks selected` :
            `${focusBlock ? focusBlock.toString() : 'Block'} · block`);
        return true;
    };
    const valueTarget = at => {
        const target = at.kind === 'input' && fieldAtPosition(workspace, at);
        return target && target.field instanceof ScratchBlocks.FieldTextInput ? target : null;
    };
    const afterExpression = block => {
        const stops = navigationStops(workspace);
        const ids = new Set(block.getDescendants().map(child => child.id));
        const last = stops.reduce((index, point, i) =>
            (ids.has(point.blockId) && point.kind !== 'after' ? i : index), -1);
        return stops[last + 1] || defaultAfter(block);
    };
    const acceptDraft = (navigationKey = 'Tab', backwards = false) => {
        if (!draft || busy() || draft.targetId !== (vm.editingTarget && vm.editingTarget.id) ||
            draft.paletteTargetId !== toolboxTargetId) return;
        const result = results[selected];
        if (!result) {
            const procedure = results.find(isProcedureCreation);
            announce(procedure && procedure.error ? procedure.error : results.some(isVariableCreation) ?
                'Choose a variable scope with the arrow keys or mouse, then Enter to create it.' :
                results.some(isBroadcastCreation) ?
                    'Choose the new broadcast row with the arrow keys or mouse, then Enter to create it.' :
                    procedure ? 'Choose the custom block row with the arrow keys or mouse, then Enter to create it.' :
                        'No matching suggestion fits at this caret.');
            return;
        }
        if (!result.fits || draft.previewError) {
            help.textContent = draft.previewError || result.error ||
                'This block does not fit here. Move the caret or choose another suggestion.';
            announce(help.textContent);
            return;
        }
        try {
            preview.clear();
            if (result.kind === 'comparison-left') {
                const block = insertImplicitComparison({
                    ScratchBlocks,
                    workspace,
                    vm,
                    position: draft.position,
                    result,
                    expectedTargetId: draft.targetId,
                    onGroup: onCreateGroup
                });
                closeDraft();
                selectPosition({kind: 'block', blockId: block.id});
                announce(`Inserted ${block.toString()}. Choose a comparison operator or press Enter for an input.`);
                return;
            }
            if (result.kind === 'comparison-replace') {
                const sourceBlockId = draft.replaceBlockId;
                const replaced = replaceComparison({
                    ScratchBlocks,
                    workspace,
                    sourceBlockId,
                    instance: result.instance,
                    onGroup: onCreateGroup
                });
                const block = replaced.block;
                closeDraft();
                const requestedInput = result.focusInputName ? block.getInput(result.focusInputName) :
                    Number.isInteger(result.focusInputIndex) && block.inputList[result.focusInputIndex];
                selectPosition(requestedInput && requestedInput.connection && requestedInput.connection.type === 1 ?
                    valueInputPosition(block, requestedInput) :
                    firstInput(block) || {kind: 'block', blockId: block.id});
                announce(`${replaced.changed ? 'Replaced' : 'Kept'} comparison ${block.toString()}`);
                return;
            }
            if (result.kind === 'block-transform') {
                const transformed = transformBlock({
                    ScratchBlocks,
                    workspace,
                    sourceBlockId: result.transformSourceId,
                    instance: result.instance,
                    onGroup: onCreateGroup
                });
                const block = transformed.block;
                closeDraft();
                const focus = result.focusInputName && block.getInput(result.focusInputName);
                selectPosition(focus && focus.connection && focus.connection.type === 3 ?
                    {kind: 'gap', blockId: block.id, inputName: focus.name} :
                    {kind: 'block', blockId: block.id});
                announce(`Changed selected block to ${block.toString()}.`);
                return;
            }
            if (result.kind === 'value') {
                const at = draft.position;
                setInputValue({ScratchBlocks, workspace, position: at, value: result.text, onGroup: onCreateGroup});
                closeDraft();
                selectPosition(navigate(navigationStops(workspace), at, navigationKey, backwards));
                announce(`Value ${result.text || 'empty'} accepted`);
                return;
            }
            if (result.kind === 'variable' || result.kind === 'create-variable') {
                const at = draft.position;
                const block = variables.apply(at, result, draft.targetId, draft.replaceBlockId);
                closeDraft();
                selectPosition(block ? {kind: 'block', blockId: block.id} :
                    navigate(navigationStops(workspace), at, navigationKey, backwards));
                announce(`${result.kind === 'create-variable' ? 'Created' : 'Using'} ${result.text} · ${
                    scopeLabel(result.scope)}`);
                return;
            }
            if (result.kind === 'list' || result.kind === 'create-list') {
                const at = draft.position;
                const block = lists.apply(at, result, draft.targetId, draft.replaceBlockId);
                closeDraft();
                selectPosition(block ? {kind: 'block', blockId: block.id} :
                    navigate(navigationStops(workspace), at, navigationKey, backwards));
                announce(`${result.kind === 'create-list' ? 'Created' : 'Using'} list ${result.listName} · ${
                    scopeLabel(result.scope)}`);
                return;
            }
            if (result.kind === 'broadcast' || result.kind === 'create-broadcast') {
                const at = draft.position;
                broadcastCreation.apply(at, result, draft.targetId);
                closeDraft();
                selectPosition(navigate(navigationStops(workspace), at, navigationKey, backwards));
                announce(`${result.kind === 'create-broadcast' ? 'Created' : 'Using'} broadcast ${result.text}`);
                return;
            }
            if (result.kind === 'create-procedure') {
                const block = procedures.apply(draft.position, result, draft.targetId);
                closeDraft();
                // The prototype shadow describes the signature. Scratch owns
                // the editable procedure body on the definition hat's native
                // next connection, so author the first command there.
                selectPosition(result.insertCall ? firstInput(block) || defaultAfter(block) :
                    {kind: 'gap', blockId: block.id});
                announce(result.insertCall ? `${result.description}: ${result.procCode}` :
                    `Created custom block ${result.procCode}`);
                return;
            }
            let block;
            if (draft.wrapRange) {
                let group = null;
                const range = draft.wrapRange;
                const wrapped = wrapStatementRange({
                    ScratchBlocks,
                    workspace,
                    range,
                    instance: result.instance,
                    onGroup: id => {
                        group = id;
                        return onCreateGroup(id);
                    }
                });
                block = wrapped.block;
                if (group) wrappingHistory.set(group, {wrapperId: block.id, range, state: 'wrapped'});
            } else if (result.kind === 'expression-wrap') {
                let group = null;
                const wrapped = wrapExpression({
                    ScratchBlocks,
                    workspace,
                    sourceBlockId: draft.replaceBlockId,
                    instance: result.instance,
                    onGroup: id => {
                        group = id;
                        return onCreateGroup(id);
                    }
                });
                block = wrapped.block;
                if (group) {
                    wrappingHistory.set(group, {
                        wrapperId: block.id,
                        sourceBlockId: wrapped.sourceBlockId,
                        state: 'wrapped'
                    });
                }
            } else if (result.kind === 'create-variable-command') {
                block = variables.applyCommand(draft.position, result, draft.targetId);
            } else if (result.kind === 'create-list-command') {
                block = lists.applyCommand(draft.position, result, draft.targetId);
            } else if (result.kind === 'create-broadcast-command') {
                block = broadcastCreation.applyCommand(draft.position, result, draft.targetId);
            } else {
                block = insertBlock({
                    ScratchBlocks,
                    workspace,
                    position: draft.position,
                    instance: result.instance,
                    onGroup: onCreateGroup,
                    replacementBlockId: draft.replaceBlockId
                });
            }
            closeDraft();
            if (result.kind === 'expression-wrap') {
                selectPosition({kind: 'block', blockId: block.id});
                announce(`Wrapped the selected expression with ${block.toString()}.`);
                return;
            }
            const requestedInput = Number.isInteger(result.focusInputIndex) && block.inputList[result.focusInputIndex];
            const first = requestedInput && requestedInput.connection && requestedInput.connection.type === 1 ?
                valueInputPosition(block, requestedInput) : firstInput(block);
            if (first) selectPosition(first);
            else if (block.outputConnection) selectPosition({kind: 'block', blockId: block.id});
            else selectPosition(defaultAfter(block));
            announce(`Inserted ${block.toString()}`);
        } catch (error) {
            help.textContent = error.message;
            announce(error.message);
        }
    };
    const updatePreview = () => {
        // A leading creation choice remains unselected until confirmed, but can
        // already show the offered reporter shape without declaring anything.
        const result = results[selected] || (isExplicitCreation(results[0]) ? results[0] : null);
        if (!draft) return;
        draft.previewError = null;
        try {
            if (draft.variable || draft.list || draft.broadcast) preview.clear();
            else if (result && result.kind === 'block-transform') {
                if (result.fits) {
                    preview.presentBlockTransformation(draft.position, result.instance, result.transformSourceId);
                } else {
                    preview.clear();
                }
            } else if (draft.transformBlockId) {
                // A selected statement is a transformation source, not an
                // insertion boundary. Until a compatible replacement exists,
                // leave its native block and outline untouched. A generic
                // statement spacer here would imply a different operation.
                preview.clear();
            } else if (result && result.kind === 'comparison-left') {
                preview.presentImplicitComparison(draft.position, result);
            } else if (result && result.kind === 'comparison-replace') {
                preview.presentComparisonReplacement(draft.position, result.instance, draft.replaceBlockId);
            } else if (result && result.kind === 'create-broadcast-command') {
                preview.presentBroadcast(draft.position, result);
            } else if (result && result.kind === 'create-procedure') {
                if (result.error && result.definitionId) preview.clear();
                else preview.presentProcedure(draft.position, procedures.previewXml(result));
            } else if (result && (result.kind === 'variable' || isVariableCreation(result))) {
                preview.presentVariable(draft.position, result, draft.replaceBlockId);
            } else if (result && (result.kind === 'list' || isListCreation(result))) {
                preview.presentList(draft.position, result, draft.replaceBlockId);
            } else if (result && result.kind === 'value') {
                preview.presentValue(draft.position, result.text);
            } else if (result && result.kind === 'expression-wrap') {
                preview.presentExpressionWrap(draft.position, result.instance, draft.replaceBlockId);
            } else if (draft.wrapRange) {
                if (result && result.fits) preview.presentWrap(draft.position, result.instance, draft.wrapRange);
                else preview.clear();
            } else {
                preview.present(draft.position, result && result.fits ? result.instance : null,
                    draft.replaceBlockId);
            }
        } catch (error) {
            draft.previewError = error.message;
            help.textContent = error.message;
        }
    };
    const updateSelection = index => {
        selected = Math.max(-1, Math.min(results.length - 1, index));
        Array.from(list.children).forEach((option, i) => option.setAttribute('aria-selected', String(i === selected)));
        input.setAttribute('aria-activedescendant', selected >= 0 ? `keyboard-suggestion-${selected}` : '');
        if (list.children[selected]) list.children[selected].scrollIntoView({block: 'nearest'});
        updatePreview();
    };
    const search = () => {
        if (!draft || composing) return;
        const identityDraft = draft.variable || draft.list || draft.broadcast;
        const variableCommands = identityDraft ? [] : catalogue.variableCommands(input.value);
        const listCommands = identityDraft ? [] : catalogue.listCommands(input.value);
        const broadcastCommands = identityDraft ? [] : catalogue.broadcastCommands(input.value);
        const procedureChoices = identityDraft ? [] : procedures.choices(draft.position, input.value);
        const commandChoices = [
            ...variables.commandChoices(draft.position, variableCommands, scopeSelect.value),
            ...lists.commandChoices(draft.position, listCommands, scopeSelect.value),
            ...broadcastCreation.commandChoices(draft.position, broadcastCommands)
        ];
        const listChoices = !variableCommands.length && !broadcastCommands.length && !procedureChoices.length &&
            (input.value.trim() || draft.list) ?
            lists.choices(draft.position, input.value, scopeSelect.value, draft.replaceBlockId) : [];
        const variableChoices = !listChoices.length && !variableCommands.length && !listCommands.length &&
            !broadcastCommands.length && !procedureChoices.length &&
            (input.value.trim() || draft.variable) ?
            variables.choices(draft.position, input.value, scopeSelect.value, draft.replaceBlockId) : [];
        const broadcastChoices = draft.broadcast ? broadcastCreation.choices(draft.position, input.value) : [];
        const compactNegativeValue = draft.value && isCompactNegativeNumber(input.value);
        const parserQuery = draft.value ? valueContinuationQuery(input.value, draft.originalValue) :
            expressionContinuationQuery(input.value, Boolean(draft.replaceBlockId));
        const parsed = identityDraft || compactNegativeValue ? [] : catalogue.search(parserQuery);
        const connection = resolveConnection(workspace, draft.position);
        const hasCompatibleBlock = parsed.some(({instance}) => instance.typeInfo.shape.canBeRound &&
            (!connection || connection.type !== 1 ||
                connection.checkType_(instance.typeInfo.workspaceForm.outputConnection)));
        const operator = input.value.trim();
        const replacement = draft.comparisonReplacement && /^[<=>]$/.test(operator) ?
            comparisonReplacementChoice({
                workspace,
                sourceBlockId: draft.replaceBlockId,
                operator,
                comparison: catalogue.comparison
            }) : null;
        const query = input.value.trim().toLowerCase();
        const adjacent = draft.transformBlockId ||
            (draft.position.kind === 'gap' && !draft.position.inputName && draft.position.blockId);
        const adjacentBlock = adjacent && workspace.getBlockById(adjacent);
        const elseInstance = adjacentBlock && adjacentBlock.type === 'control_if' && query &&
            'else'.startsWith(query) && catalogue.byType('control_if_else');
        const elseChoice = elseInstance && transformationChoice({
            workspace,
            sourceBlockId: adjacentBlock.id,
            result: {instance: elseInstance, text: 'if then else', truncated: query !== 'else'},
            text: 'Add else branch to selected if',
            completionText: 'else',
            focusInputName: 'SUBSTACK2'
        });
        if (draft.transformBlockId) {
            results = rankTransformationChoices([elseChoice, ...parsed.map(result => transformationChoice({
                workspace,
                sourceBlockId: draft.transformBlockId,
                result
            }))].filter(Boolean), input.value);
        } else if (replacement) {
            results = [replacement];
        } else if (draft.booleanLeft && !hasCompatibleBlock) {
            results = implicitComparisonChoices({
                workspace,
                position: draft.position,
                comparison: catalogue.comparison,
                matches: parsed,
                value: input.value,
                search: input.value,
                identityChoices: leftConnection => {
                    const nestedLists = lists.choicesAtConnection(leftConnection, input.value, scopeSelect.value);
                    return nestedLists.length ? nestedLists :
                        variables.choicesAtConnection(leftConnection, input.value, scopeSelect.value);
                }
            });
        } else {
            results = draft.variable ? variableChoices : draft.list ? listChoices :
                draft.broadcast ? broadcastChoices : procedureChoices.length ? procedureChoices :
                    completionChoices(workspace, draft.position, parsed, draft.value ? input.value : null,
                        [...variableChoices, ...listChoices], commandChoices, input.value, draft.replaceBlockId);
        }
        if (elseChoice && !draft.transformBlockId) results.unshift(elseChoice);
        if (draft.replaceBlockId && !draft.wrapRange && !replacement) {
            results = results.flatMap(result => {
                if (result.kind !== 'block' ||
                    !canWrapExpression(workspace, draft.replaceBlockId, result.instance)) return [result];
                return [{
                    ...result,
                    kind: 'expression-wrap',
                    text: `Wrap with ${result.text.trim()}`,
                    fits: true
                }, result];
            });
        }
        if (draft.wrapRange) {
            results = results.filter(result => result.kind === 'block').map(result => ({
                ...result,
                fits: canWrapStatementRange(workspace, draft.wrapRange, result.instance)
            }))
                .sort((a, b) => Number(b.fits) - Number(a.fits));
        }
        scopePreference.hidden = results.filter(choice => isVariableCreation(baseChoice(choice)) ||
            isListCreation(baseChoice(choice)))
            .length < 2;
        while (list.firstChild) list.removeChild(list.firstChild);
        results.forEach((result, index) => {
            const display = baseChoice(result);
            const option = make('div', styles.option, list, {
                'role': 'option',
                'id': `keyboard-suggestion-${index}`,
                'aria-selected': 'false',
                'aria-disabled': String(!result.fits)
            });
            option.dataset.kind = display.kind;
            if (display.scope) option.dataset.scope = display.scope;
            if (isProcedureCreation(display)) option.dataset.warp = String(display.warp);
            option.textContent = display.kind === 'value' ? `Use value: ${JSON.stringify(display.text)}` :
                ['create-variable', 'create-broadcast'].includes(display.kind) ?
                    `Create “${display.text}”` : display.kind === 'create-list' ?
                        `Create “${display.listName}”` : result.text;
            const category = make('span', '', option);
            const scopeDescription = display.kind === 'create-variable-command' ?
                `Create “${display.variableName}”` : display.kind === 'variable' ? 'Variable' :
                    display.kind === 'create-list-command' ? `Create list “${display.listName}”` :
                        display.kind === 'create-list' ? 'Create list' : display.kind === 'list' ? 'List' : '';
            const retainedDescription = result.kind === 'block-transform' && result.retainedBlockCount ?
                `Keeps ${result.retainedBlockCount} nested block${result.retainedBlockCount === 1 ? '' : 's'} · ` : '';
            category.textContent = display.scope ? `${scopeDescription} · ${scopeLabel(display.scope)}` :
                display.kind === 'value' ? 'Literal text or number' :
                    display.kind === 'broadcast' ? 'Broadcast message' :
                        display.kind === 'create-broadcast' ? 'Create broadcast message' :
                            display.kind === 'create-broadcast-command' ?
                                `Create broadcast “${display.broadcastName}”` :
                                display.kind === 'create-procedure' ?
                                    display.error || display.description :
                                    result.kind === 'comparison-replace' ? 'Comparison operator' :
                                        result.kind === 'block-transform' ?
                                            `${retainedDescription}Transform block` :
                                            result.kind === 'expression-wrap' ? 'Wrap selected expression' :
                                                result.fits ?
                                                    categoryLabel(
                                                        display.instance.typeInfo.category.name, ScratchBlocks
                                                    ) :
                                                    'Does not fit at this caret';
            option.addEventListener('mousedown', event => {
                stop(event);
                updateSelection(index);
                acceptDraft();
            });
        });
        input.setAttribute('aria-expanded', String(results.length > 0));
        help.textContent = draft.variable ? '↑ ↓ choose variable and scope · Enter use · Esc cancel' :
            draft.list ? '↑ ↓ choose list and scope · Enter use · Esc cancel' :
                draft.broadcast ? '↑ ↓ choose or create broadcast · Enter use · Esc cancel' :
                    draft.value ? '↑ ↓ choose block or value · Enter accept · Tab/Ctrl+Space complete · Esc cancel' :
                        procedureChoices[0] && procedureChoices[0].error ? procedureChoices[0].error :
                            input.value ? (results.length ?
                                '↑ ↓ choose · Tab/Ctrl+Space complete · Enter insert · Esc cancel' :
                                'No matching block fits here. Try another name; existing blocks are safe.') :
                                'Type a block name · Enter again splits the stack · Esc cancel';
        if (draft.wrapRange) {
            help.textContent = 'Choose a C block · Enter wraps the selected commands · Esc restores the selection';
        } else if (draft.transformBlockId) {
            help.textContent = 'Type to transform the selected block · Enter accepts · Esc keeps the original';
        } else if (draft.booleanLeft && !hasCompatibleBlock) {
            help.textContent = 'Choose the left value · Tab completes or advances · Enter keeps = · Esc cancels';
        } else if (draft.comparisonReplacement && replacement) {
            help.textContent = 'Enter replaces only the comparison operator · operands are preserved';
        }
        // 'define' is an explicit command, so a complete signature is ready for
        // Enter. An unknown variable/list/broadcast name still needs a choice;
        // malformed definitions remain unselected presentation-only previews.
        updateSelection(results[0] && (!isExplicitCreation(results[0]) ||
            (isProcedureCreation(results[0]) && results[0].fits)) ? 0 : -1);
    };
    const beginDraft = (at, text = '', {replaceBlockId = null, transformBlockId = null, wrapRange = null,
        valuePrefix = null} = {}) => {
        if (busy()) return;
        blockRange = null;
        closeDraft({keepPreview: true});
        try {
            catalogue = createCatalogue({ScratchBlocks, vm, workspace, locale: iconLabel});
        } catch (error) {
            announce(`Block catalogue unavailable: ${error.message}`);
            return;
        }
        position = at;
        const value = valueTarget(at);
        const variable = variables.fieldAt(at);
        const listVariable = lists.fieldAt(at);
        const broadcast = broadcastCreation.fieldAt(at);
        const connection = resolveConnection(workspace, at);
        const replacement = replaceBlockId && workspace.getBlockById(replaceBlockId);
        draft = {
            position: {...at},
            targetId,
            paletteTargetId: toolboxTargetId,
            value: Boolean(value),
            variable: Boolean(variable),
            list: Boolean(listVariable),
            broadcast: Boolean(broadcast),
            originalValue: value ? String(value.field.getValue()) : null,
            booleanLeft: !replaceBlockId && isBooleanOnlyConnection(connection),
            comparisonReplacement: Boolean(replacement &&
                ['operator_equals', 'operator_gt', 'operator_lt'].includes(replacement.type)),
            replaceBlockId,
            transformBlockId,
            wrapRange};
        input.value = value && valuePrefix !== null ? valuePrefix : text ||
            (value ? value.field.getValue() : variable ? variable.field.getVariable().name :
                listVariable ? listVariable.field.getVariable().name :
                    broadcast ? broadcast.field.getVariable().name : '');
        draftView.hidden = false;
        ensureVisible();
        search();
        input.focus({preventScroll: true});
        input.setSelectionRange(
            (value && valuePrefix === null) || variable || listVariable || broadcast ? 0 : input.value.length,
            input.value.length);
    };
    const openField = at => {
        const target = fieldAtPosition(workspace, at);
        if (!target || !target.field.showEditor_) return;
        preview.clear();
        blockRange = null;
        position = canonicalPosition(workspace, at);
        editingField = true;
        target.field.showEditor_();
    };
    const finishSemanticEdit = () => focusReturn.schedule();
    const openF2Target = () => {
        const target = f2Target(workspace, ScratchBlocks, position);
        if (!target) return;
        preview.clear();
        if (target.kind === 'field') {
            openField({kind: 'field', blockId: target.block.id, fieldName: target.field.name});
        } else if (target.kind === 'procedure') {
            ScratchBlocks.Procedures.editProcedureCallback_(target.block);
        } else if (target.variable.type === ScratchBlocks.BROADCAST_MESSAGE_VARIABLE_TYPE) {
            if (broadcastRenamer) broadcastRenamer.prompt(target.variable, finishSemanticEdit);
        } else {
            ScratchBlocks.Variables.renameVariable(workspace, target.variable, finishSemanticEdit);
        }
    };
    const exploreSelectedBlock = () => {
        const block = position && position.blockId && workspace.getBlockById(position.blockId);
        if (!block) {
            announce('Select a block, variable, list or broadcast to explore.');
            return;
        }
        const request = new CustomEvent('scratch-addons-find-bar-activate', {
            cancelable: true,
            detail: {exploreBlockId: block.id, followSelection: true}
        });
        if (document.dispatchEvent(request)) {
            announce('This selection has no definition or related usages to open.');
        } else {
            blockRange = null;
            announce('Opened the selected definition or related usages.');
        }
    };
    const insertionPosition = () => {
        if (position.kind === 'after') return defaultAfter(workspace.getBlockById(position.blockId));
        if (position.kind !== 'block' && position.kind !== 'field') return position;
        let block = workspace.getBlockById(position.blockId);
        if (block && block.isShadow()) block = block.getParent();
        if (block && block.outputConnection && block.outputConnection.targetConnection) {
            const parent = block.getParent();
            const slot = parent.inputList.find(item => item.connection === block.outputConnection.targetConnection);
            return {kind: 'input', blockId: parent.id, inputName: slot.name};
        }
        return block ? defaultAfter(block) : freshPosition();
    };
    const contractSelectedVariant = block => {
        if (!block || block.type !== 'control_if_else') return false;
        let localCatalogue;
        try {
            localCatalogue = createCatalogue({ScratchBlocks, vm, workspace, locale: iconLabel});
            const instance = localCatalogue.byType('control_if');
            if (!instance || !canTransformBlock(workspace, block.id, instance)) {
                announce('The else branch contains blocks. Move or delete them before removing else.');
                return true;
            }
            const transformed = transformBlock({
                ScratchBlocks,
                workspace,
                sourceBlockId: block.id,
                instance,
                onGroup: onCreateGroup
            });
            selectPosition({kind: 'block', blockId: transformed.block.id});
            announce('Removed the empty else branch.');
        } catch (error) {
            announce(error.message);
        } finally {
            if (localCatalogue) localCatalogue.dispose();
        }
        return true;
    };
    const onKeyDown = event => {
        if (keyboardHelp.isOpen()) return;
        if (event.key !== 'Escape' || event.target !== surface || draft || editingField) exitConfirmation.reset();
        const navigationRepeat = navigationSession.keyDown(event.key, event.repeat);
        if (navigationSession.pending && (event.key !== navigationSession.pending.key ||
            event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || event.target !== surface)) {
            if (['ArrowLeft', 'ArrowRight'].includes(event.key) && event.target === surface &&
                !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
                navigationSession.cancelBoundary();
            } else navigationSession.cancel();
        }
        if (event.key === 'Escape') findBarHandoff.cancel();
        if (!isVisible() || busy()) return;
        reconcileNavigation();
        const resultDirection = resultNavigationDirection(event);
        // A target switch temporarily blurs the structural surface while native
        // XML is rebuilt. Keep rapid result cycling owned by its pending grant,
        // but never borrow focus from an input, dialog or sprite control.
        const owner = keyOwner(event.target, {surface,
            input,
            body: document.body,
            editingField,
            pendingNavigation: findBarHandoff.pending});
        const ownsResultKey = owner !== 'external';
        if (resultDirection && ownsResultKey && (enabled || findBarHandoff.pending)) {
            stop(event);
            if (draft || editingField) {
                announce('Finish or cancel the current text edit before visiting another result.');
            } else {
                // Finder owns its current collection, order and target changes.
                // Keep any pending grant until the next navigation replaces it.
                const request = new CustomEvent('scratch-addons-find-bar-cycle', {
                    cancelable: true, detail: {direction: resultDirection}
                });
                if (document.dispatchEvent(request)) announce('Choose a result in Finder first.');
            }
            return;
        }
        if (event.altKey && event.key.toLowerCase() === 'k' && !isTextInput(event.target)) {
            stop(event);
            if (enabled) setEnabled(false);
            else enableWhenReady();
            return;
        }
        if (!enabled || event.isComposing || composing) return;
        if (event.target === surface && !draft && !editingField && isCleanUpShortcut(event)) {
            stop(event);
            if (event.repeat || busy()) return;
            sharedHistory.interrupt();
            findBarHandoff.cancel();
            const block = position.blockId && workspace.getBlockById(position.blockId);
            preview.clear();
            const cleaned = cleanUpAtScript(workspace, block);
            announce(cleaned ? 'Clean-up+: layout arranged, current script kept in place.' :
                'Select a script and enable Clean-up+ in Addons first.');
            return;
        }
        const ownsKey = ['surface', 'composer', 'native'].includes(owner);
        if (event.target === surface && !draft && !editingField && event.altKey &&
            !event.ctrlKey && !event.metaKey && !event.shiftKey && event.key.toLowerCase() === 's') {
            stop(event);
            findBarHandoff.cancel();
            showCurrentScript().catch(error => announce(`Could not frame the script: ${error.message}`));
            return;
        }
        const modifierOnly = ['Control', 'Meta', 'Alt', 'Shift'].includes(event.key);
        if (ownsKey && !modifierOnly &&
            !((event.ctrlKey || event.metaKey) && ['ArrowLeft', 'ArrowRight'].includes(event.key))) {
            sharedHistory.interrupt();
        }
        if (ownsKey && !modifierOnly) findBarHandoff.cancel();
        if (ownsKey && event.key === 'Enter') {
            if (event.repeat || enterHeld) {
                stop(event); return;
            }
            enterHeld = true;
        }
        if (editingField) {
            if (event.target.classList.contains('blocklyHtmlInput') && ['Enter', 'Escape', 'Tab'].includes(event.key)) {
                if (event.key === 'Tab') {
                    stop(event);
                    ScratchBlocks.WidgetDiv.hide();
                    ScratchBlocks.DropDownDiv.hideWithoutAnimation();
                    editingField = false;
                    const stops = navigationStops(workspace);
                    const next = navigate(stops, position, 'Tab', event.shiftKey);
                    // Advance to a field or structural boundary; never eat text-editing arrow keys.
                    selectPosition(next);
                    if (fieldAtPosition(workspace, next)) openField(next);
                } else {
                    focusReturn.schedule();
                }
            } else if (event.key === 'Escape') {
                focusReturn.schedule();
            }
            return;
        }
        if (event.target !== input && event.target !== surface) return;
        if ((event.ctrlKey || event.metaKey) && event.code === 'Space' && draft) {
            stop(event);
            const result = results[selected];
            if (!result) {
                announce('No selected completion fits at this caret.');
            } else if (isExplicitCreation(result)) {
                announce('Press Enter to confirm this new Scratch identity.');
            } else if (!completeText(input, result.completionText || result.text, search)) {
                announce('Text completion is unavailable here. Enter still inserts the selected suggestion.');
            }
            return;
        }
        if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'v') {
            // Preserve the browser's default paste dispatch, including while
            // the composition input owns focus, but keep Blockly's document
            // handler from pasting the same native snapshot first.
            event.stopImmediatePropagation();
            return;
        }
        if (!draft && (event.ctrlKey || event.metaKey) && !event.altKey) {
            const command = event.key.toLowerCase();
            if (command === 'home' || command === 'end') {
                stop(event);
                selectPosition(outerScriptBoundary(navigationStops(workspace), position, command === 'end'));
                return;
            }
            if (command === 'enter') {
                stop(event);
                exploreSelectedBlock();
                return;
            }
            if (command === 'a') {
                stop(event);
                const mouth = position.inputName && resolveConnection(workspace, position);
                if (mouth && mouth.type === 3 && !mouth.targetBlock()) {
                    announce('This C mouth has no commands to select.');
                    return;
                }
                const selection = position.blockId && entireSiblingRange(workspace, position.blockId);
                if (!selection) {
                    announce('There is no statement chain at this caret.');
                    return;
                }
                blockRange = selection.blockIds.length > 1 ? selection : null;
                selectPosition({kind: 'block', blockId: selection.focusBlockId}, {keepRange: true});
                announce(selection.blockIds.length > 1 ?
                    `Selected all ${selection.blockIds.length} blocks in this statement chain.` :
                    'Selected the only block in this statement chain.');
                return;
            }
            if (['c', 'x', 'd'].includes(command)) {
                stop(event);
                try {
                    if (command === 'c') {
                        if (blockClipboard.copy(position, activeTargetId(), blockRange)) {
                            preferBlockPaste = true;
                            announce(blockRange ? `Copied ${blockRange.blockIds.length} selected blocks.` :
                                'Copied the selected block and its connected contents.');
                        } else announce('Select a whole movable block to copy.');
                    } else if (command === 'x') {
                        const selectedBlock = position.kind === 'block' && workspace.getBlockById(position.blockId);
                        const next = blockRange ? rangeDeletionPosition(workspace, blockRange) :
                            selectedBlock && selectedBlock.getParent() ?
                                deletionPosition(workspace, position, {backwards: false}) :
                                selectedBlock && {kind: 'workspace', ...selectedBlock.getRelativeToSurfaceXY()};
                        const count = blockRange && blockRange.blockIds.length;
                        if (blockClipboard.cut(position, activeTargetId(), blockRange)) {
                            preferBlockPaste = true;
                            selectPosition(next);
                            announce(count ? `Cut ${count} selected blocks.` :
                                'Cut the selected block and its connected contents.');
                        } else announce('Select a whole movable block to cut.');
                    } else {
                        const count = blockRange && blockRange.blockIds.length;
                        const block = blockClipboard.duplicate(position, activeTargetId(), blockRange);
                        if (block) {
                            selectPosition({kind: 'block', blockId: block.id});
                            announce(count ? `Duplicated ${count} selected blocks.` :
                                'Duplicated the selected block and its connected contents.');
                        } else announce('Select a whole movable block to duplicate.');
                    }
                } catch (error) {
                    announce(error.message);
                }
                return;
            }
        }
        if (!draft && event.altKey && !event.ctrlKey && !event.metaKey &&
            ['ArrowUp', 'ArrowDown'].includes(event.key)) {
            stop(event);
            const moved = moveStatementRange({
                ScratchBlocks,
                workspace,
                blockId: position.kind === 'block' && position.blockId,
                range: blockRange,
                direction: event.key === 'ArrowUp' ? -1 : 1,
                onGroup: onCreateGroup
            });
            if (moved) {
                blockRange = moved.range;
                selectPosition({kind: 'block', blockId: moved.focusBlockId}, {keepRange: true});
                announce(moved.blockIds.length > 1 ?
                    `Moved ${moved.blockIds.length} selected blocks ${event.key === 'ArrowUp' ? 'up' : 'down'}.` :
                    `Moved the selected block ${event.key === 'ArrowUp' ? 'up' : 'down'}.`);
            } else {
                announce('This selection cannot move farther in its statement chain.');
            }
            return;
        }
        if (event.ctrlKey || event.metaKey || event.altKey) {
            if (!draft && (event.ctrlKey || event.metaKey) && ['z', 'y'].includes(event.key.toLowerCase())) {
                preview.clear();
                caretReadyAt = performance.now() + 180;
            }
            return;
        }
        if (draft) {
            if (event.key === 'Escape') {
                stop(event);
                const replacementBlockId = draft.replaceBlockId;
                const wrapRange = draft.wrapRange;
                closeDraft({keepPreview: !input.value});
                if (wrapRange && blocksInRange(workspace, wrapRange).length) {
                    blockRange = wrapRange;
                    selectPosition({kind: 'block', blockId: wrapRange.focusBlockId}, {keepRange: true});
                } else if (replacementBlockId && workspace.getBlockById(replacementBlockId)) {
                    selectPosition({kind: 'block', blockId: replacementBlockId});
                } else {
                    focusSurface();
                }
            } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                stop(event);
                if (results.length === 1 && results[0].kind === 'value') acceptDraft(event.key);
                else updateSelection(Math.max(0, selected + (event.key === 'ArrowDown' ? 1 : -1)));
            } else if (event.key === 'Tab') {
                stop(event);
                const result = results[selected];
                const completion = result && (result.completionText || result.text);
                if (result && ['comparison-left', 'comparison-replace'].includes(result.kind) &&
                    !isExplicitCreation(result) && input.value.trim() === completion.trim()) {
                    acceptDraft('Tab', event.shiftKey);
                } else if (result && result.kind === 'value') {
                    acceptDraft('Tab', event.shiftKey);
                } else if (result && !completeText(input, completion, search)) {
                    announce('Text completion is unavailable here. Enter still inserts the selected suggestion.');
                }
            } else if (event.key === 'Enter') {
                stop(event);
                if (input.value.trim() || draft.value) acceptDraft();
                else if (draft.position.kind === 'input' || draft.variable || draft.list || draft.broadcast) {
                    closeDraft(); focusSurface();
                } else {
                    preview.clear();
                    const newStack = detachedStackPosition(workspace, draft.position);
                    const tail = splitStack({ScratchBlocks, workspace, position: draft.position});
                    if (tail) selectPosition({kind: 'before', blockId: tail.id});
                    else selectPosition(newStack || freshPosition());
                }
            }
            return;
        }
        if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab', 'Home', 'End'].includes(event.key)) {
            stop(event);
            if (event.shiftKey && ['Home', 'End'].includes(event.key)) {
                const stops = navigationStops(workspace);
                const current = stops.find(item => positionKey(item) === positionKey(position));
                const anchor = blockRange ? blockRange.anchorBlockId : current && current.rowId;
                const boundary = navigate(stops, position, event.key);
                const range = anchor && boundary && rangeFor(workspace, anchor, boundary.blockId);
                if (range) {
                    blockRange = range.blockIds.length > 1 ? range : null;
                    selectPosition({kind: 'block', blockId: range.focusBlockId}, {keepRange: true});
                }
                return;
            }
            if (!(event.shiftKey && ['ArrowUp', 'ArrowDown'].includes(event.key) &&
                extendRange(event.key === 'ArrowDown' ? 1 : -1))) {
                const result = navigationSession.move(navigationStops(workspace), position, event.key,
                    {repeat: navigationRepeat, backwards: event.shiftKey, range: blockRange});
                if (result.blocked) announce('Column edge. Release and press again to move to the next column.');
                else selectPosition(result.position, {keepNavigation: true});
            }
        } else if (event.key === 'Escape') {
            stop(event);
            if (exitConfirmation.press(navigationRepeat)) {
                setEnabled(false);
                toggle.focus();
            } else announce('Press Escape again to leave keyboard mode.');
        } else if (event.key === 'Enter') {
            stop(event);
            const target = fieldAtPosition(workspace, position);
            const block = workspace.getBlockById(position.blockId);
            // Acceptance focuses new inputs. Enter on an existing command is
            // a new line; a reporter has no line below, so it visits operands.
            const first = position.kind === 'block' && block.outputConnection && !event.shiftKey && firstInput(block);
            if (first) {
                selectPosition(first);
            } else if (position.kind === 'block' && block.outputConnection) {
                selectPosition(afterExpression(block));
            } else if (event.shiftKey && position.kind === 'block' && !block.previousConnection) {
                announce('This block has no connection above it. Enter inserts below.');
            } else if (position.kind === 'field' ||
                (target && !(target.field instanceof ScratchBlocks.FieldTextInput))) {
                openField(position);
            } else {
                beginDraft(event.shiftKey && position.kind === 'block' ?
                    {kind: 'before', blockId: position.blockId} : insertionPosition());
            }
        } else if (event.key === 'F2') {
            stop(event);
            openF2Target();
        } else if (event.key === 'Delete' || event.key === 'Backspace') {
            if (valueTarget(position) || variables.fieldAt(position) || lists.fieldAt(position) ||
                broadcastCreation.fieldAt(position)) {
                event.stopImmediatePropagation();
                beginDraft(position);
                return;
            }
            if (fieldAtPosition(workspace, position)) {
                event.stopImmediatePropagation();
                openField(position);
                // Just as for the first typed character, the browser edits the
                // newly focused native input. Never turn a field key into a
                // structural deletion or a custom text-history operation.
                if (!document.activeElement.classList.contains('blocklyHtmlInput')) event.preventDefault();
                return;
            }
            stop(event);
            const emptyElseOwner = event.key === 'Backspace' && position.kind === 'gap' &&
                position.inputName === 'SUBSTACK2' && workspace.getBlockById(position.blockId);
            if (!blockRange && contractSelectedVariant(emptyElseOwner)) return;
            if (position.kind === 'block') {
                const selectedBlock = workspace.getBlockById(position.blockId);
                if (event.key === 'Backspace' && !blockRange && contractSelectedVariant(selectedBlock)) return;
                const next = blockRange ? rangeDeletionPosition(workspace, blockRange,
                    {backwards: event.key === 'Backspace'}) :
                    deletionPosition(workspace, position, {backwards: event.key === 'Backspace'});
                preview.clear();
                if (blockRange ? blockClipboard.removeRange(blockRange) :
                    removeBlock({ScratchBlocks, workspace, position})) selectPosition(next);
            }
        } else if (event.key.length === 1) {
            const value = valueTarget(position);
            if (value || variables.fieldAt(position) || lists.fieldAt(position) ||
                broadcastCreation.fieldAt(position)) {
                event.stopImmediatePropagation();
                const currentValue = value && value.field.getValue();
                beginDraft(position, '', {
                    valuePrefix: value ? numericContinuationPrefix(currentValue, event.key) : null
                });
            } else if (fieldAtPosition(workspace, position)) {
                event.stopImmediatePropagation();
                openField(position);
                // Keep the browser's default text insertion. The newly focused
                // native field owns this character and its text-undo boundary.
            } else {
                event.stopImmediatePropagation();
                const block = position.kind === 'block' && workspace.getBlockById(position.blockId);
                const replaceBlockId = block && block.outputConnection &&
                    block.outputConnection.targetConnection ? block.id : null;
                const wrapRange = blockRange && blocksInRange(workspace, blockRange).length ? blockRange : null;
                const transformBlockId = block && !block.outputConnection && !wrapRange ? block.id : null;
                beginDraft(wrapRange ? {kind: 'before', blockId: wrapRange.blockIds[0]} :
                    transformBlockId ? {kind: 'block', blockId: transformBlockId} : insertionPosition(), '',
                {replaceBlockId, transformBlockId, wrapRange});
            }
        }
    };
    const insertMultiline = text => {
        const at = draft ? {...draft.position} : insertionPosition();
        let pasteCatalogue = catalogue;
        let temporaryCatalogue = false;
        if (!pasteCatalogue) {
            pasteCatalogue = createCatalogue({ScratchBlocks, vm, workspace});
            temporaryCatalogue = true;
        }
        let compiled;
        try {
            compiled = compileMultilinePaste(pasteCatalogue, text);
        } finally {
            if (temporaryCatalogue) pasteCatalogue.dispose();
        }
        preview.clear();
        closeDraft();
        const block = blockClipboard.insertXml(at, compiled.xml, activeTargetId());
        selectPosition({kind: 'block', blockId: block.id});
        announce(`Pasted ${compiled.count} Scratch commands as one undoable stack.`);
    };
    const pasteCopiedBlock = () => {
        const at = draft ? {...draft.position} : insertionPosition();
        preview.clear();
        closeDraft();
        const block = blockClipboard.paste(at, activeTargetId());
        selectPosition({kind: 'block', blockId: block.id});
        announce('Pasted the copied Scratch block at the caret.');
    };
    const onAddonPaste = event => {
        if (!enabled || !isVisible()) return;
        event.preventDefault();
        // The deferred pointer drag must not take over any keyboard-owned
        // placement, regardless of document key-listener registration order.
        if (event.type === 'scratch-addons-before-paste-drag') return;
        try {
            if (!busy() && !editingField) pasteCopiedBlock();
        } catch (error) {
            announce(error.message);
        }
    };
    const onPaste = event => {
        if (!enabled || !isVisible() || busy() || editingField) return;
        if (event.target !== surface && event.target !== input) return;
        const text = event.clipboardData && event.clipboardData.getData('text/plain');
        const multiline = /\r?\n/.test(text || '');
        const internalBlock = preferBlockPaste && blockClipboard.hasData();
        if (event.target === input && !multiline && !internalBlock) return;
        stop(event);
        try {
            if (internalBlock) {
                pasteCopiedBlock();
            } else if (event.target === input || multiline) {
                insertMultiline(text);
            } else if (text) {
                preferBlockPaste = false;
                beginDraft(insertionPosition(), text);
                announce('Pasted text into a new block draft. Press Enter to insert it.');
            } else if (blockClipboard.hasData()) {
                pasteCopiedBlock();
            } else {
                announce('Copy a whole block before pasting.');
            }
        } catch (error) {
            announce(error.message);
        }
    };
    const onCopy = () => {
        // Internal block Copy prevents the browser's copy event. Any real DOM
        // copy therefore represents newer text selected in a field or elsewhere.
        preferBlockPaste = false;
    };
    const hitPosition = target => {
        for (const block of workspace.getAllBlocks(false)) {
            for (const field of editableFields(block)) {
                if (field.getSvgRoot().contains(target)) {
                    return {kind: 'field', blockId: block.id, fieldName: field.name};
                }
            }
        }
        // Blockly renders a text/number input as its own rounded shadow block,
        // but the editable field occupies only the text glyphs in the middle.
        // Resolve the painted shadow shell before climbing to the surrounding
        // command, so any point on the actual rounded input has the same edit
        // meaning as its text. Keep this text-input-specific: dropdown and
        // semantic shadow blocks must retain their native pointer behaviour.
        const shadowRoot = target.closest && target.closest('g[data-id]');
        const shadow = shadowRoot && workspace.getBlockById(shadowRoot.getAttribute('data-id'));
        const shadowFields = shadow && shadow.isShadow() && shadow.getSvgRoot() === shadowRoot ?
            editableFields(shadow) : [];
        if (shadowFields.length === 1 && shadowFields[0] instanceof ScratchBlocks.FieldTextInput) {
            return {kind: 'field', blockId: shadow.id, fieldName: shadowFields[0].name};
        }
        const group = target.closest && target.closest('g.blocklyDraggable');
        const block = group && workspace.getAllBlocks(false).find(candidate => candidate.getSvgRoot() === group);
        return block && !block.isShadow() ? {kind: 'block', blockId: block.id} : null;
    };
    const selectPointerPosition = (hit, extend = false) => {
        const targetPosition = canonicalPosition(workspace, hit);
        if (!extend || targetPosition.kind !== 'block') {
            selectPosition(targetPosition);
            return;
        }
        const anchorBlockId = blockRange ? blockRange.anchorBlockId :
            position.kind === 'block' ? position.blockId : null;
        const range = anchorBlockId && rangeFor(workspace, anchorBlockId, targetPosition.blockId);
        if (!range || range.blockIds.length < 2) {
            selectPosition(targetPosition);
            return;
        }
        blockRange = range;
        selectPosition(targetPosition, {keepRange: true});
        announce(`${range.blockIds.length} blocks selected`);
    };
    const onMouseDown = event => {
        exitConfirmation.reset();
        if (!event.target.closest?.('.sa-find-bar')) sharedHistory.interrupt();
        navigationSession.cancel();
        clearBlockHover();
        pressed = null;
        if (!event.target.closest || !event.target.closest('.sa-find-bar') ||
            event.target.closest('.sa-find-input')) findBarHandoff.cancel();
        if (root.contains(event.target)) return;
        const shiftSelection = event.button === 0 && event.shiftKey && !event.ctrlKey &&
            !event.metaKey && !event.altKey && workspace.getCanvas().contains(event.target) &&
            hitPosition(event.target);
        if (!enabled) {
            if (shiftSelection && isVisible() && !busy()) {
                // Shift-click is the pointer entry to structural editing. Stop
                // Blockly before it can execute or begin dragging the block;
                // the asynchronous label load then hands the exact clicked
                // node to the same selection model used by the keyboard.
                stop(event);
                const requested = canonicalPosition(workspace, shiftSelection);
                ensureIconLabels().then(() => {
                    if (detached || !isVisible() || busy()) return;
                    setEnabled(true, {reveal: false});
                    selectPosition(requested);
                    keyboardHelp.open(true);
                });
            }
            return;
        }
        // Find Bar navigation is a companion to the structural editor. Its
        // carousel will publish the resolved block after scrolling, so keep
        // Keyboard mode alive while the user chooses a definition or usage.
        if (event.target.closest && event.target.closest('.sa-find-bar')) return;
        if (event.button === 0 && (event.ctrlKey || event.metaKey) && !event.shiftKey &&
            !event.altKey && workspace.getCanvas().contains(event.target)) {
            // Finder owns Ctrl/Cmd-click in both modes. Do not create a pending
            // structural click: its capture-phase mouseup would otherwise
            // cancel Blockly's definition/usage gesture before it resolves.
            return;
        }
        if (shiftSelection) {
            stop(event);
            closeDraft();
            selectPointerPosition(shiftSelection, true);
            return;
        }
        const bounds = visibleBounds();
        if (event.button === 0 && event.clientX >= bounds.left && event.clientX <= bounds.right &&
            event.clientY >= bounds.top && event.clientY <= bounds.bottom) {
            const hit = preview.hitTest(event.clientX, event.clientY);
            if (hit) {
                stop(event);
                if (hit.kind === 'draft') {
                    if (draft) input.focus({preventScroll: true});
                    else beginDraft(position);
                } else {
                    // A click leaves the pending draft and selects the block
                    // actually shown under the pointer. A subsequent drag uses
                    // the normal live workspace, with no synthetic mouse input.
                    preview.clear();
                    selectPosition(hit);
                    if (hit.kind === 'field') {
                        // Presentation copies retain their source identity.
                        // Apply the same value-edit policy as a live SVG click;
                        // previewing layout must not switch text editors.
                        if (valueTarget(position)) beginDraft(position);
                        else openField(hit);
                    }
                }
                return;
            }
        }
        if (!workspace.getCanvas().contains(event.target)) {
            if (workspace.getParentSvg().contains(event.target) &&
                event.target.classList.contains('blocklyMainBackground')) {
                if (event.button === 0) {
                    closeDraft();
                    const point = workspacePoint(event.clientX, event.clientY);
                    // As with block clicks, acquire focus on release. Focusing
                    // during mousedown loses it again to the browser's default
                    // action, and a background press may still become a pan.
                    pressed = {x: event.clientX,
                        y: event.clientY,
                        position: {kind: 'workspace', x: point.x, y: point.y}};
                }
            } else if (!event.target.closest(
                '.blocklyWidgetDiv, .blocklyDropDownDiv, .ReactModalPortal, [data-workspace-navigation-control]'
            )) {
                setEnabled(false, {preservePreference: true});
            }
            return;
        }
        closeDraft();
        const hit = hitPosition(event.target);
        if (hit && hit.kind === 'field') {
            const canonical = canonicalPosition(workspace, hit);
            if (valueTarget(canonical)) {
                // While Keyboard mode owns the editor, a pointer click on a
                // native text/number shadow is a request to edit that value at
                // its structural input stop. Keeping the composition editor in
                // charge preserves completion, focus and local text Undo. This
                // is intentionally narrower than all Blockly fields: dropdowns
                // and semantic editors retain their native click behaviour.
                stop(event);
                beginDraft(canonical);
                pressed = null;
            } else {
                // A native dropdown still owns the menu interaction, but its
                // field first becomes the structural selection. This clears a
                // stale range, selects the owning Blockly block and gives the
                // exact variable/event/menu stop back to Keyboard mode when
                // DropDownDiv closes. Do not focus yet: the native menu (and
                // optional searchable-dropdown input) must keep its keys.
                selectPosition(canonical, {focus: false, reveal: false});
                editingField = true;
                pressed = null;
            }
        } else {
            pressed = {x: event.clientX, y: event.clientY, position: hit};
        }
    };
    const onMouseUp = event => {
        if (!pressed || event.button !== 0) return;
        const gesture = pressed;
        pressed = null;
        if (enabled && !busy() && isVisible() && !workspace.isDragging() &&
            Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) < 5 && gesture.position) {
            // Cancel only a click, before Blockly runs the script. Drags retain
            // their original Gesture/BlockDragger path without synthesized input.
            workspace.cancelCurrentGesture();
            stop(event);
            selectPosition(gesture.position);
        }
    };
    const onMouseMove = event => {
        if (!enabled || !isVisible() || busy() || pressed || workspace.isDragging() || root.contains(event.target)) {
            clearBlockHover();
            return;
        }
        const next = blockAtPointerTarget(workspace, event.target);
        // The structural caret already gives the selected block a stronger,
        // animated outline. Hover is only an invitation to select another node.
        const selectedBlock = position && position.kind === 'block' && next && position.blockId === next.id;
        hoveredBlock = updateBlockHover(hoveredBlock, selectedBlock ? null : next, styles.hoveredBlock);
    };
    const onWorkspaceChange = event => {
        if (event.type !== 'ui' && !event.isUiEvent) navigationSession.cancel();
        invalidateRangePresentation();
        if (event.type === 'ui') return;
        clearBlockHover();
        refreshProcedurePalette(workspace, event);
        navigationDirty = true;
        if (blockRange && !blocksInRange(workspace, blockRange).length) blockRange = null;
        if (draft && draft.position.blockId && !workspace.getBlockById(draft.position.blockId)) closeDraft();
        if (draft) preview.invalidate();
        else {
            preview.clear();
            caretReadyAt = performance.now() + 100;
        }
    };
    const onFindBarNavigate = event => {
        const detail = event.detail || {};
        const available = !draft && !editingField && isVisible() && !busy();
        if (detail.phase === 'cancel' || !available) {
            findBarHandoff.cancel();
            return;
        }
        if (detail.phase === 'start') {
            findBarHandoff.begin(detail, {enabled, available});
            return;
        }
        if (detail.phase !== 'finish') return;
        const currentTargetId = vm.editingTarget && vm.editingTarget.id;
        const destination = findBarHandoff.finish(detail, currentTargetId);
        const block = destination && workspace.getBlockById(destination.blockId);
        if (block) {
            // Browsing results/carousel updates the real block caret but keeps
            // search text and its arrow navigation usable until Enter. Once the
            // user has returned to editing, carousel clicks return there too.
            const focus = !document.activeElement?.classList.contains('sa-find-input');
            if (!enabled) setEnabled(true, {reveal: false, focus});
            selectPosition({kind: 'block', blockId: block.id}, {focus});
        }
    };
    const onFindBarFocus = event => {
        if ((!enabled && !findBarHandoff.pending) || draft || editingField || !isVisible() || busy()) return;
        // Finder yields DOM focus rather than racing its native SVG focus with
        // this surface. A still-pending navigation retains its identity checks
        // and will select the resolved destination when scrolling finishes.
        event.preventDefault();
        focusSurface();
    };
    const resetContext = () => {
        const nextTargetId = vm.editingTarget && vm.editingTarget.id;
        const saved = captureCaret(workspace, draft ? draft.position : position, blockRange);
        if (targetId && saved) caretMemory.locations.set(targetId, saved);
        findBarHandoff.contextChanged(targetId, nextTargetId);
        targetId = nextTargetId;
        toolboxTargetId = null;
        closeDraft();
        blockRange = null;
        wrappingHistory.clear();
        position = null;
        previousStops = [];
        navigationDirty = true;
        invalidateRangePresentation();
        setEnabled(false, {preserveNavigation: true, preservePreference: true});
    };
    const resetProject = () => {
        findBarHandoff.cancel();
        blockClipboard.clear();
        preferBlockPaste = false;
        resetContext();
        caretMemory.locations.clear();
    };
    const onKeyUp = event => {
        navigationSession.keyUp(event.key);
        if (event.key === 'Enter') enterHeld = false;
    };
    const onBlur = () => {
        focusReturn.cancel();
        exitConfirmation.reset();
        navigationSession.blur();
        findBarHandoff.cancel();
        enterHeld = false;
        clearBlockHover();
        // Copying text in another application supersedes the last internal
        // block-copy preference, while the native snapshot remains available
        // if the returning clipboard event contains no text.
        preferBlockPaste = false;
    };
    const onFocusIn = event => {
        if (event.target !== surface) exitConfirmation.reset();
        if (event.target !== surface) navigationSession.cancel();
    };
    const restoreCaret = (saved, {focus = false, reveal = false} = {}) => {
        if (!caretMemory.enabled || !isVisible() || busy() || detached) return;
        const next = resolveCaret(workspace, saved) || navigationStops(workspace)[0] || freshPosition();
        setEnabled(true, {focus: false, reveal: false, preserveNavigation: true, preservePreference: true});
        selectPosition(next, {focus, reveal});
        if (saved?.range) {
            blockRange = rangeFor(workspace, saved.range.anchorBlockId, saved.range.focusBlockId);
            invalidateRangePresentation();
        }
    };
    const workspaceUpdated = () => {
        if (sharedHistory.operation || findBarHandoff.pending) return;
        // Called by the host after XML, native camera and Undo reset settle.
        // Sprite controls retain DOM focus; clicking Code explicitly resumes it.
        restoreCaret(caretMemory.locations.get(targetId), {
            focus: Boolean(document.activeElement?.closest('[data-studio-target="tab-code"]'))
        });
    };
    const unregisterNavigationHost = sharedHistory.registerHost({
        capture: () => (caretMemory.enabled ?
            captureCaret(workspace, draft ? draft.position : position, blockRange) : null),
        destination: ({blockId}) => (caretMemory.enabled ?
            captureCaret(workspace, {kind: 'block', blockId}) : null),
        restore: (saved, {isCurrent}) => {
            // History already restored the exact saved camera. Revealing here
            // would undo that framing when its saved caret was offscreen.
            if (isCurrent()) restoreCaret(saved, {focus: true, reveal: false});
        },
        unavailable: () => announce('That navigation location is no longer available.')
    });
    const onCodeClick = event => {
        if (!event.target.closest?.('[data-studio-target="tab-code"]') || !caretMemory.enabled) return;
        const request = sharedHistory.request;
        const requestedTarget = activeTargetId();
        window.requestAnimationFrame(() => {
            if (!detached && isVisible() && !sharedHistory.operation && !findBarHandoff.pending) {
                if (request !== sharedHistory.request || activeTargetId() !== requestedTarget) return;
                restoreCaret(captureCaret(workspace, position, blockRange) || caretMemory.locations.get(targetId),
                    {focus: true, reveal: true});
            }
        });
    };
    const svgPathElements = (parent, count) => {
        while (parent.children.length < count) {
            parent.appendChild(svgElement('path'));
        }
        while (parent.children.length > count) parent.lastChild.remove();
        return Array.from(parent.children);
    };
    const caretPathElements = count => svgPathElements(caretPaths, count);
    const syncRangeMask = (outlines, box, mode) => {
        caret.dataset.rangeContour = mode;
        if (mode !== 'silhouette') {
            caretPaths.removeAttribute('mask');
            svgPathElements(rangeMaskEdges, 0);
            svgPathElements(rangeMaskFills, 0);
            return;
        }
        const margin = 8;
        const maskBox = {
            x: -margin,
            y: -margin,
            width: box.width + (margin * 2),
            height: box.height + (margin * 2)
        };
        [rangeMask, rangeMaskBackground].forEach(element => {
            Object.entries(maskBox).forEach(([name, value]) => element.setAttribute(name, value));
        });
        // First admit a wide band around every exact native edge. Painting the
        // filled union black on top removes internal connection seams, leaving
        // only the exterior half of that band, including genuine C mouths and
        // other concavities.
        svgPathElements(rangeMaskEdges, outlines.length).forEach((path, index) => {
            path.setAttribute('d', outlines[index].d);
            path.setAttribute('transform', outlines[index].transform);
            Object.assign(path.style, {
                fill: 'none',
                stroke: 'white',
                strokeWidth: '8px',
                strokeLinejoin: 'round',
                strokeLinecap: 'round',
                vectorEffect: 'non-scaling-stroke',
                animation: 'none'
            });
        });
        svgPathElements(rangeMaskFills, outlines.length).forEach((path, index) => {
            path.setAttribute('d', outlines[index].d);
            path.setAttribute('transform', outlines[index].transform);
            // A one-pixel outward overlap removes anti-aliased hairlines where
            // two native paths meet without changing the visible outer width.
            Object.assign(path.style, {
                fill: 'black',
                stroke: 'black',
                strokeWidth: '2px',
                strokeLinejoin: 'round',
                vectorEffect: 'non-scaling-stroke',
                animation: 'none'
            });
        });
        caretPaths.setAttribute('mask', `url(#${rangeMaskId})`);
    };
    const unionBounds = boxes => ({
        left: Math.min(...boxes.map(box => box.left)),
        top: Math.min(...boxes.map(box => box.top)),
        right: Math.max(...boxes.map(box => box.right)),
        bottom: Math.max(...boxes.map(box => box.bottom)),
        get width () {
            return this.right - this.left;
        },
        get height () {
            return this.bottom - this.top;
        }
    });
    const rangeEnvironment = bounds => [
        workspace.scale,
        workspace.scrollX,
        workspace.scrollY,
        bounds.left,
        bounds.top,
        bounds.right,
        bounds.bottom,
        window.innerWidth,
        window.innerHeight,
        window.devicePixelRatio
    ].join('|');
    const rangePresentation = bounds => {
        if (!blockRange || blockRange.blockIds.length < 2) {
            rangePresentationCache = null;
            rangePresentationDirty = true;
            return null;
        }
        const environment = rangeEnvironment(bounds);
        if (!rangePresentationDirty && rangePresentationCache &&
            rangePresentationCache.range === blockRange &&
            rangePresentationCache.environment === environment) return rangePresentationCache;
        const blocks = blocksInRange(workspace, blockRange);
        const sources = blocks.map(block => block.svgPath_).filter(Boolean);
        if (sources.length !== blockRange.blockIds.length) {
            rangePresentationCache = null;
            rangePresentationDirty = true;
            return null;
        }
        const box = unionBounds(sources.map(source => source.getBoundingClientRect()));
        const contour = rangeContour(sources, box);
        rangePresentationCache = {
            environment,
            range: blockRange,
            box,
            mode: contour.mode,
            outlines: contour.outlines
        };
        rangePresentationDirty = false;
        return rangePresentationCache;
    };
    const renderCaretPresentation = (outlines, box, mode) => {
        const key = [mode, box.width, box.height, ...outlines.flatMap(outline =>
            [outline.source, outline.d, outline.transform])].join('|');
        if (key === caretPresentationKey) return false;
        caretPresentationKey = key;
        syncRangeMask(outlines, box, mode);
        caretPathElements(outlines.length).forEach((path, index) => {
            const outline = outlines[index];
            path.setAttribute('d', outline.d);
            path.setAttribute('transform', outline.transform);
            path.dataset.source = outline.source;
        });
        caret.dataset.renderRevision = String(++caretPresentationRevision);
        return true;
    };
    const frame = () => {
        if (detached) return;
        const visible = isVisible() && workspace.getParentSvg().getBoundingClientRect().width > 0;
        root.hidden = !visible;
        if (visible) {
            // Sprite creation can replace vm.editingTarget without emitting the
            // workspaceUpdate notification this controller normally observes.
            // Reconcile from the authoritative VM identity before accepting a
            // key or clipboard action on the newly visible target.
            if ((vm.editingTarget && vm.editingTarget.id) !== targetId) resetContext();
            // Coalesce native event batches into one structural traversal.
            reconcileWrappingHistory();
            reconcileNavigation();
            if (editingField && !ScratchBlocks.WidgetDiv.isVisible() && !ScratchBlocks.DropDownDiv.isVisible()) {
                editingField = false;
                if (enabled) focusReturn.finish();
            }
            // A dropdown temporarily owns keyboard input, but its native menu
            // is still editing the structurally selected field. Keep that
            // selection visible so pointer entry into every menu feels like a
            // continuation of Keyboard mode. Text editors and modal widgets
            // continue to hide the caret while they own their interaction.
            const dropdownEditing = editingField && ScratchBlocks.DropDownDiv.isVisible();
            if (draft && (previewScale !== workspace.scale || preview.needsRefresh())) {
                previewScale = workspace.scale;
                updatePreview();
            }
            if (!enabled || busy() || (editingField && !dropdownEditing) || pressed || workspace.isDragging()) {
                preview.clear();
            } else if (!draft) {
                try {
                    if (blockRange) preview.clear();
                    else if (performance.now() >= caretReadyAt) preview.presentCaret(position);
                    // The short navigation delay must not close a reservation
                    // that the next insertion point will immediately reuse.
                    else if (preview.needsRefresh() || !preview.requiresSpace(position)) preview.presentCaret(null);
                } catch (error) {
                    announce(`Insertion preview unavailable: ${error.message}`);
                }
            }
            preview.sync();
            const bounds = visibleBounds();
            const hint = enabled ?
                (exitConfirmation.armed ? 'Esc again to exit' : 'Alt+K · Arrows · Enter · Esc ×2') : 'Alt+K';
            if (badge.textContent !== hint) badge.textContent = hint;
            bar.style.left = `${bounds.left + 12}px`;
            const horizontalScrollbar = workspace.scrollbar && workspace.scrollbar.hScroll;
            const scrollbarRect = horizontalScrollbar && horizontalScrollbar.outerSvg_ &&
                horizontalScrollbar.outerSvg_.getBoundingClientRect();
            const scrollbarTop = scrollbarRect && scrollbarRect.height > 0 ? scrollbarRect.top :
                workspace.getParentSvg().getBoundingClientRect().bottom - 14;
            bar.style.top = 'auto';
            bar.style.bottom = `${Math.max(8, window.innerHeight - scrollbarTop + 8)}px`;
            bar.dataset.compact = String(bounds.right - bounds.left < 360);
            const source = preview.path() || outlineSource(position);
            const range = rangePresentation(bounds);
            const sources = range ? [] : source ? [source] : [];
            const sourceBounds = sources.map(item => item.getBoundingClientRect());
            const box = enabled && !busy() && (!editingField || dropdownEditing) &&
                (range ? range.box : sourceBounds.length ? unionBounds(sourceBounds) : geometry(position));
            caret.hidden = !box;
            columnCue.hidden = !box || !navigationSession.pending || document.activeElement !== surface;
            if (!columnCue.hidden) {
                const right = navigationSession.pending.direction === 'right';
                const rowStop = previousStops.find(item => positionKey(item) === positionKey(position));
                const row = rowStop && (preview.displayBlock(rowStop.rowId) || workspace.getBlockById(rowStop.rowId));
                const cue = columnCuePosition(box, row?.svgPath_?.getBoundingClientRect(),
                    navigationSession.pending.direction);
                columnCue.textContent = right ? '›' : '‹';
                columnCue.style.left = `${cue.left}px`;
                columnCue.style.top = `${cue.top}px`;
            }
            draftView.hidden = !draft || busy();
            if (box) {
                caret.dataset.kind = blockRange ? 'range' : position.kind;
                caret.dataset.position = blockRange ? `range:${blockRange.blockIds.join(',')}` : positionKey(position);
                caret.dataset.rangeCount = String(blockRange ? blockRange.blockIds.length : 0);
                caret.dataset.empty = String(Boolean(!blockRange && (preview.isEmptyCaret() || (!source &&
                    ['gap', 'before', 'after', 'workspace'].includes(position.kind)))));
                Object.assign(caret.style, {
                    left: `${box.left}px`,
                    top: `${box.top}px`,
                    width: `${box.width}px`,
                    height: `${box.height}px`,
                    // While coalescing rapid navigation, do not paint a full
                    // ghost over a mouth which has not made room for it yet.
                    opacity: String(!draft && preview.requiresSpace(position) && performance.now() < caretReadyAt ?
                        0 : preview.opacity())
                });
                const outlines = range ? range.outlines : [caretOutline(sources[0], box,
                    ['gap', 'before', 'after', 'workspace'].includes(position.kind),
                    {scale: workspace.scale, renderer: ScratchBlocks.BlockSvg})];
                renderCaretPresentation(outlines, box, range ? range.mode : 'individual');
                caret.style.clipPath = `inset(${Math.max(-5, bounds.top - box.top)}px ` +
                    `${Math.max(-5, box.left + box.width - bounds.right)}px ` +
                    `${Math.max(-5, box.top + box.height - bounds.bottom)}px ` +
                    `${Math.max(-5, bounds.left - box.left)}px)`;
                if (draft) {
                    const layout = compositionLayout({anchor: geometry(draft.position) || box,
                        preview: box,
                        bounds,
                        context: preview.contextBounds(draft.position),
                        scale: workspace.scale,
                        previous: draft.layout});
                    draft.layout = layout;
                    draftView.dataset.placement = layout.side;
                    Object.assign(draftView.style, {
                        left: `${layout.left}px`,
                        width: `${layout.width}px`,
                        top: layout.side === 'above' ? 'auto' : `${layout.edge}px`,
                        bottom: layout.side === 'above' ? `${window.innerHeight - layout.edge}px` : 'auto',
                        maxHeight: `${layout.maxHeight}px`
                    });
                }
            }
        } else preview.clear();
        raf = window.requestAnimationFrame(frame);
    };
    toggle.addEventListener('click', () => {
        if (enabled) setEnabled(false);
        else enableWhenReady();
    });
    input.addEventListener('input', search);
    scopeSelect.addEventListener('change', () => {
        try {
            window.localStorage.setItem(scopePreferenceKey, scopeSelect.value);
        } catch (error) { /* The preference also works for this session only. */ }
        search();
        input.focus({preventScroll: true});
    });
    input.addEventListener('compositionstart', () => {
        composing = true;
    });
    input.addEventListener('compositionend', () => {
        composing = false; search();
    });
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('keyup', onKeyUp, true);
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('click', onCodeClick);
    document.addEventListener('paste', onPaste, true);
    document.addEventListener('copy', onCopy, true);
    workspace.getCanvas().addEventListener('scratch-addons-block-paste', onAddonPaste);
    workspace.getCanvas().addEventListener('scratch-addons-before-paste-drag', onAddonPaste);
    window.addEventListener('blur', onBlur);
    document.addEventListener('mousedown', onMouseDown, true);
    document.addEventListener('mousemove', onMouseMove, true);
    document.addEventListener('mouseup', onMouseUp, true);
    document.addEventListener('scratch-addons-find-bar-navigation', onFindBarNavigate);
    document.addEventListener('scratch-addons-find-bar-focus', onFindBarFocus);
    workspace.addChangeListener(onWorkspaceChange);
    if (typeof workspace.addBlockDragListener === 'function') workspace.addBlockDragListener(onBlockDrag);
    vm.on('workspaceUpdate', resetContext);
    // PROJECT_LOADED belongs to Runtime; VirtualMachine does not re-emit it.
    // Listening on vm silently left Blockly's process-global clipboard alive
    // across File > New and project loads.
    vm.runtime.on('PROJECT_LOADED', resetProject);
    const unsubscribe = session && session.subscribe(state => {
        if (state.busy) closeDraft();
    });
    closeDraft();
    caret.hidden = true;
    frame();
    return {
        workspaceUpdated,
        toolboxUpdated: () => {
            const currentTargetId = vm.editingTarget && vm.editingTarget.id;
            toolboxTargetId = currentTargetId;
            if (!draft || draft.paletteTargetId === currentTargetId) return;
            // workspaceUpdate is emitted before React's zero-delay toolbox
            // refresh. If typing wins that race, rebuild the exact same draft
            // from the now-authoritative palette instead of exposing stale
            // sprite-only blocks on the Stage (or the reverse).
            const resume = {position: {...draft.position}, text: input.value};
            closeDraft();
            if (enabled && targetId === currentTargetId) beginDraft(resume.position, resume.text);
        },
        detach: () => {
            scriptContext.caretActive = false;
            keyboardHelp.dispose();
            focusReturn.cancel();
            const saved = captureCaret(workspace, draft ? draft.position : position, blockRange);
            if (targetId && saved) caretMemory.locations.set(targetId, saved);
            unregisterNavigationHost();
            stackLayout.detach();
            findBarHandoff.cancel();
            detached = true;
            workspace.getCanvas().classList.remove(styles.keyboardCanvas);
            closeDraft();
            window.cancelAnimationFrame(raf);
            document.removeEventListener('keydown', onKeyDown, true);
            document.removeEventListener('keyup', onKeyUp, true);
            document.removeEventListener('focusin', onFocusIn);
            document.removeEventListener('click', onCodeClick);
            document.removeEventListener('paste', onPaste, true);
            document.removeEventListener('copy', onCopy, true);
            workspace.getCanvas().removeEventListener('scratch-addons-block-paste', onAddonPaste);
            workspace.getCanvas().removeEventListener('scratch-addons-before-paste-drag', onAddonPaste);
            window.removeEventListener('blur', onBlur);
            document.removeEventListener('mousedown', onMouseDown, true);
            document.removeEventListener('mousemove', onMouseMove, true);
            document.removeEventListener('mouseup', onMouseUp, true);
            document.removeEventListener('scratch-addons-find-bar-navigation', onFindBarNavigate);
            document.removeEventListener('scratch-addons-find-bar-focus', onFindBarFocus);
            workspace.removeChangeListener(onWorkspaceChange);
            if (typeof workspace.removeBlockDragListener === 'function') {
                workspace.removeBlockDragListener(onBlockDrag);
            }
            vm.removeListener('workspaceUpdate', resetContext);
            vm.runtime.removeListener('PROJECT_LOADED', resetProject);
            if (broadcastRenamer) broadcastRenamer.detach();
            clearBlockHover();
            if (unsubscribe) unsubscribe();
            root.remove();
        }};
};

export {attachKeyboardAuthoring};
