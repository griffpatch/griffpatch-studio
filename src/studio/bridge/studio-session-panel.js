import {DEFAULT_TARGET_SELECTION_PAUSE_MS, MAX_TRANSACTION_PAUSE_MS} from '../journal/journal';

const PANEL_ID = 'tw-studio-session-panel';
const NATIVE_EVIDENCE_ID = 'tw-studio-native-evidence';
const DIAGNOSTIC_ID = 'tw-studio-diagnostic';
const TIMELINE_ID = 'tw-studio-timeline';
const STEP_ID = 'tw-studio-step';
const SPEED_ID = 'tw-studio-speed';
const PAUSE_ID = 'tw-studio-pause-after';
const HISTORY_POINTER_ID = 'tw-studio-history-pointer';
const SPRITE_PAUSE_ID = 'tw-studio-sprite-pause';
const START_ID = 'tw-studio-start';
const PREVIOUS_ID = 'tw-studio-previous';
const NEXT_ID = 'tw-studio-next';
const END_ID = 'tw-studio-end';
const RANGE_START_ID = 'tw-studio-range-start';
const RANGE_END_ID = 'tw-studio-range-end';
const RANGE_BACKWARD_ID = 'tw-studio-range-backward';
const RANGE_FORWARD_ID = 'tw-studio-range-forward';
const JOURNAL_DEBUG_ID = 'tw-studio-journal-debug';
const PANEL_STYLE_ID = 'tw-studio-session-panel-style';
const PANEL_STYLE_TEXT = `
#${PANEL_ID} {
    position: fixed;
    right: 12px;
    top: 88px;
    z-index: 505;
    width: min(372px, calc(100vw - 24px));
    overflow: hidden;
    border: 1px solid var(--ui-tertiary);
    border-top: 3px solid var(--looks-secondary);
    border-radius: 12px;
    background: var(--ui-modal-background);
    color: var(--text-primary);
    box-shadow: 0 8px 24px var(--shadow);
    color-scheme: var(--color-scheme);
    font: 13px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

#${PANEL_ID},
#${PANEL_ID} * {
    box-sizing: border-box;
}

#${PANEL_ID} .tw-studio-panel-header {
    padding: 11px 13px 10px;
    border-bottom: 1px solid var(--ui-tertiary);
    background: var(--ui-secondary);
}

#${PANEL_ID} .tw-studio-panel-title-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 5px;
}

#${PANEL_ID} .tw-studio-panel-title {
    color: var(--text-primary);
    font-size: 14px;
    font-weight: 700;
    letter-spacing: 0.01em;
}

#${PANEL_ID} .tw-studio-panel-badge {
    padding: 2px 7px;
    border-radius: 999px;
    background: var(--looks-light-transparent);
    color: var(--looks-secondary);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
}

#${PANEL_ID} .tw-studio-panel-status {
    overflow: hidden;
    color: var(--text-primary);
    font-size: 12px;
    text-overflow: ellipsis;
}

#${PANEL_ID} .tw-studio-panel-build {
    margin-top: 2px;
    color: var(--text-primary-transparent, var(--text-primary));
    font-size: 10.5px;
}

#${PANEL_ID} .tw-studio-panel-build[data-status="current"] {
    color: var(--pen-primary);
}

#${PANEL_ID} .tw-studio-panel-build:not([data-status=""]):not([data-status="current"]) {
    color: var(--red-primary);
    font-weight: 700;
}

#${PANEL_ID} .tw-studio-panel-actions,
#${PANEL_ID} .tw-studio-panel-section {
    padding: 10px 12px;
}

#${PANEL_ID} .tw-studio-panel-actions {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 6px;
    border-bottom: 1px solid var(--ui-tertiary);
}

#${PANEL_ID} .tw-studio-panel-section {
    background: var(--ui-modal-background);
}

#${PANEL_ID} .tw-studio-section-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    margin-bottom: 6px;
}

#${PANEL_ID} .tw-studio-section-label,
#${PANEL_ID} .tw-studio-control-label {
    color: var(--text-primary-transparent, var(--text-primary));
    font-size: 10.5px;
    font-weight: 700;
    letter-spacing: 0.05em;
    text-transform: uppercase;
}

#${PANEL_ID} .tw-studio-control-label {
    display: inline-flex;
    align-items: center;
    gap: 5px;
}

#${PANEL_ID} .tw-studio-button {
    min-height: 30px;
    padding: 5px 9px;
    border: 1px solid var(--ui-tertiary);
    border-radius: 6px;
    background: var(--ui-primary);
    color: var(--text-primary);
    font: inherit;
    font-weight: 650;
    line-height: 1;
    cursor: pointer;
    transition: background-color 80ms ease, border-color 80ms ease, transform 80ms ease, opacity 80ms ease;
}

#${PANEL_ID} .tw-studio-button:hover:not(:disabled) {
    border-color: var(--looks-secondary);
    background: var(--ui-tertiary);
}

#${PANEL_ID} .tw-studio-button:active:not(:disabled) {
    transform: translateY(1px);
}

#${PANEL_ID} .tw-studio-button[data-variant="primary"] {
    border-color: var(--looks-secondary);
    background: var(--looks-secondary);
    color: var(--ui-modal-header-foreground);
}

#${PANEL_ID} .tw-studio-button[data-variant="primary"]:hover:not(:disabled) {
    border-color: var(--looks-secondary-dark);
    background: var(--looks-secondary-dark);
}

#${PANEL_ID} .tw-studio-button[data-compact="true"] {
    width: 30px;
    min-width: 30px;
    padding: 4px;
    font-size: 15px;
}

#${PANEL_ID} .tw-studio-button:disabled {
    border-color: var(--ui-tertiary);
    background: var(--ui-secondary);
    color: var(--text-primary);
    cursor: default;
    opacity: 0.42;
}

#${PANEL_ID} button:focus-visible,
#${PANEL_ID} select:focus-visible,
#${PANEL_ID} input:focus-visible {
    outline: 2px solid var(--looks-secondary);
    outline-offset: 2px;
}

#${PANEL_ID} select,
#${PANEL_ID} input[type="number"] {
    min-height: 28px;
    padding: 3px 24px 3px 7px;
    border: 1px solid var(--ui-tertiary);
    border-radius: 6px;
    background-color: var(--input-background);
    color: var(--text-primary);
    font: inherit;
}

#${PANEL_ID} input[type="number"] {
    width: 86px;
    padding-right: 7px;
}

#${PANEL_ID} select:disabled,
#${PANEL_ID} input:disabled {
    cursor: default;
    opacity: 0.48;
}

#${PANEL_ID} .tw-studio-timeline-row {
    display: flex;
    align-items: center;
    gap: 4px;
}

#${PANEL_ID} .tw-studio-timeline {
    width: 100%;
    min-width: 92px;
    height: 24px;
    margin: 0 2px;
    accent-color: var(--looks-secondary);
    cursor: pointer;
}

#${PANEL_ID} .tw-studio-step {
    display: block;
    width: 100%;
    margin-top: 7px;
}

#${PANEL_ID} .tw-studio-range-row {
    display: grid;
    grid-template-columns: auto 48px auto 48px 30px 30px;
    align-items: center;
    gap: 5px;
    margin-top: 7px;
}

#${PANEL_ID} .tw-studio-range-row select {
    width: 48px;
    padding-right: 5px;
}

#${PANEL_ID} .tw-studio-range-copy {
    color: var(--text-primary-transparent, var(--text-primary));
    font-size: 11px;
}

#${PANEL_ID} .tw-studio-timing-row {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 6px;
    margin-top: 7px;
}

#${PANEL_ID} .tw-studio-timing-unit {
    color: var(--text-primary-transparent, var(--text-primary));
    font-size: 11px;
}

#${PANEL_ID} .tw-studio-pointer-setting {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 9px;
    color: var(--text-primary);
    font-size: 11px;
    cursor: pointer;
}

#${PANEL_ID} .tw-studio-pointer-setting input {
    margin: 0;
    accent-color: var(--looks-secondary);
}

#${PANEL_ID} .tw-studio-fixtures {
    display: flex;
    gap: 6px;
    padding: 0 12px 10px;
}

#${PANEL_ID} .tw-studio-fixtures .tw-studio-button {
    flex: 1;
}

@media (max-width: 760px) {
    #${PANEL_ID} {
        right: 8px;
        top: 78px;
        width: min(352px, calc(100vw - 16px));
    }
}
`;

const installPanelStyles = () => {
    if (!document.head || !document.createElement) return null;
    const existing = document.getElementById && document.getElementById(PANEL_STYLE_ID);
    if (existing) return null;
    const style = document.createElement('style');
    style.id = PANEL_STYLE_ID;
    style.textContent = PANEL_STYLE_TEXT;
    document.head.appendChild(style);
    return style;
};

const createButton = (label, action, {variant = 'secondary', compact = false} = {}) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.className = 'tw-studio-button';
    button.dataset.variant = variant;
    button.dataset.compact = String(compact);
    button.addEventListener('click', action);
    return button;
};

const setButtonDisabled = (button, disabled) => {
    button.disabled = disabled;
    button.dataset.state = disabled ? 'disabled' : 'enabled';
};

const journalDebugRequested = () => typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('studio-debug') === '1';

/**
 * Render temporary controls for the real-editor replay spike. The eventual
 * timeline UI can replace this panel without changing session contracts.
 *
 * @param {object} session Studio block session
 * @returns {object} panel lifecycle
 */
const createStudioSessionPanel = session => {
    const ownedStyle = installPanelStyles();
    // A session publishes its terminal cursor before all presentation cleanup
    // and busy-state subscribers have necessarily settled. Serialize panel
    // commands at this boundary so a click on that visible endpoint cannot
    // race the preceding operation and disappear into the session busy guard.
    let commandActive = false;
    const commandQueue = [];
    const runNextCommand = () => {
        if (commandActive || !commandQueue.length) return;
        commandActive = true;
        const action = commandQueue.shift();
        let operation;
        try {
            operation = action();
        } catch (error) {
            operation = Promise.reject(error);
        }
        Promise.resolve(operation)
            .catch(() => {
                // The session publishes the actionable error to the panel state.
            })
            .then(() => {
                commandActive = false;
                runNextCommand();
            });
    };
    const runPlayback = action => {
        commandQueue.push(action);
        runNextCommand();
    };
    const panel = document.createElement('aside');
    panel.id = PANEL_ID;
    panel.className = 'tw-studio-panel';
    panel.dataset.theme = 'turbowarp';
    Object.assign(panel.style, {
        position: 'fixed',
        right: '12px',
        top: '88px',
        // Remain above ordinary editor chrome (including the stage header at
        // 500) but below Scratch's modal/library layer at 510. Studio must
        // never intercept the UI action it is recording or replaying.
        zIndex: '505'
    });

    const header = document.createElement('div');
    header.className = 'tw-studio-panel-header';
    const titleRow = document.createElement('div');
    titleRow.className = 'tw-studio-panel-title-row';
    const title = document.createElement('strong');
    title.className = 'tw-studio-panel-title';
    title.textContent = 'Tutorial Studio';
    const badge = document.createElement('span');
    badge.className = 'tw-studio-panel-badge';
    badge.textContent = 'Replay';
    titleRow.append(title, badge);
    const status = document.createElement('div');
    status.className = 'tw-studio-panel-status';
    const build = document.createElement('div');
    build.className = 'tw-studio-panel-build';
    header.append(titleRow, status, build);
    const nativeEvidence = document.createElement('output');
    nativeEvidence.id = NATIVE_EVIDENCE_ID;
    nativeEvidence.hidden = true;
    const diagnostic = document.createElement('output');
    diagnostic.id = DIAGNOSTIC_ID;
    diagnostic.hidden = true;
    const journalDebug = journalDebugRequested() ? document.createElement('output') : null;
    if (journalDebug) {
        journalDebug.id = JOURNAL_DEBUG_ID;
        journalDebug.hidden = true;
    }
    const setBase = createButton('Set Base', () => runPlayback(session.startNewTake));
    const rewind = createButton('Rewind', () => runPlayback(session.rewind));
    const speed = document.createElement('select');
    speed.id = SPEED_ID;
    speed.title = 'Playback speed';
    for (const value of [0.5, 1, 2, 4]) {
        const option = document.createElement('option');
        option.value = String(value);
        option.textContent = `${value}×`;
        option.selected = value === 1;
        speed.append(option);
    }
    speed.value = '1';
    const selectedSpeed = () => Number(speed.value) || 1;
    let currentCursor = 0;
    let currentTransactionCount = 0;
    const play = createButton('Play', () => runPlayback(() => session.play({speed: selectedSpeed()})), {
        variant: 'primary'
    });
    const playBackward = createButton('◀', () => runPlayback(() => session.playHistory({
        direction: 'backward',
        speed: selectedSpeed()
    })), {compact: true});
    playBackward.title = 'Play timeline backward';
    const playForward = createButton('▶', () => runPlayback(() => session.playHistory({
        direction: 'forward',
        speed: selectedSpeed()
    })), {compact: true});
    playForward.title = 'Play timeline forward';
    const jumpStart = createButton('↤', () => runPlayback(() => session.seek(0)), {compact: true});
    jumpStart.id = START_ID;
    jumpStart.title = 'Jump to start';
    // Step requests go directly to the session's shared history queue. Keeping
    // them behind the panel's transport queue would hide them from keyboard
    // catch-up until the preceding animation had already finished.
    const requestHistory = direction => session.requestHistory(direction, {playbackSpeed: selectedSpeed()})
        .catch(() => {}); // The session publishes history failures.
    const previous = createButton('‹', () => requestHistory('undo'), {
        compact: true
    });
    previous.id = PREVIOUS_ID;
    previous.title = 'Previous transaction';
    const next = createButton('›', () => requestHistory('redo'), {
        compact: true
    });
    next.id = NEXT_ID;
    next.title = 'Next transaction';
    const jumpEnd = createButton('↦', () => runPlayback(() => session.seek(currentTransactionCount)), {compact: true});
    jumpEnd.id = END_ID;
    jumpEnd.title = 'Jump to end';
    const timeline = document.createElement('input');
    timeline.id = TIMELINE_ID;
    timeline.type = 'range';
    timeline.min = '0';
    timeline.max = '0';
    timeline.step = '1';
    timeline.value = '0';
    timeline.title = 'Timeline position';
    timeline.className = 'tw-studio-timeline';
    // Range input can publish dozens of intermediate values during one drag.
    // Keep exactly one serialized catch-up command alive and continuously
    // replace its pending destination. The session still owns every semantic
    // Undo/Redo step, while the UI never builds a stale seek backlog.
    let scrubTarget = null;
    let scrubCommandQueued = false;
    let scrubActive = false;
    const drainScrub = async () => {
        try {
            while (scrubTarget !== null) {
                const target = scrubTarget;
                scrubTarget = null;
                if (target !== currentCursor) await session.seek(target);
            }
        } finally {
            scrubCommandQueued = false;
            scrubActive = false;
            timeline.value = String(currentCursor);
        }
    };
    const requestScrub = () => {
        scrubTarget = Number(timeline.value);
        scrubActive = true;
        if (scrubCommandQueued) return;
        scrubCommandQueued = true;
        runPlayback(drainScrub);
    };
    timeline.addEventListener('input', requestScrub);
    timeline.addEventListener('change', requestScrub);
    const step = document.createElement('select');
    step.id = STEP_ID;
    step.title = 'Jump to transaction';
    step.className = 'tw-studio-step';
    step.addEventListener('change', () => runPlayback(() => session.seek(Number(step.value))));
    const rangeStart = document.createElement('select');
    rangeStart.id = RANGE_START_ID;
    rangeStart.title = 'Selected range start';
    rangeStart.value = '0';
    const rangeEnd = document.createElement('select');
    rangeEnd.id = RANGE_END_ID;
    rangeEnd.title = 'Selected range end';
    rangeEnd.value = '0';
    const normalizeRange = changed => {
        const start = Number(rangeStart.value);
        const end = Number(rangeEnd.value);
        if (start <= end) return;
        if (changed === rangeStart) rangeEnd.value = rangeStart.value;
        else rangeStart.value = rangeEnd.value;
    };
    rangeStart.addEventListener('change', () => normalizeRange(rangeStart));
    rangeEnd.addEventListener('change', () => normalizeRange(rangeEnd));
    const playSelectedRange = direction => async () => {
        const start = Number(rangeStart.value);
        const end = Number(rangeEnd.value);
        const entry = direction === 'forward' ? start : end;
        const exit = direction === 'forward' ? end : start;
        if (currentCursor !== entry) await session.seek(entry);
        return session.playHistory({direction, targetIndex: exit, speed: selectedSpeed()});
    };
    const rangeBackward = createButton('◀', () => runPlayback(playSelectedRange('backward')), {compact: true});
    rangeBackward.id = RANGE_BACKWARD_ID;
    rangeBackward.title = 'Play selected range backward';
    const rangeForward = createButton('▶', () => runPlayback(playSelectedRange('forward')), {compact: true});
    rangeForward.id = RANGE_FORWARD_ID;
    rangeForward.title = 'Play selected range forward';
    const rangeRow = document.createElement('div');
    rangeRow.className = 'tw-studio-range-row';
    const rangeLabel = document.createElement('span');
    rangeLabel.className = 'tw-studio-section-label';
    rangeLabel.textContent = 'Range';
    const toLabel = document.createElement('span');
    toLabel.className = 'tw-studio-range-copy';
    toLabel.textContent = 'to';
    rangeRow.append(rangeLabel, rangeStart, toLabel, rangeEnd, rangeBackward, rangeForward);
    const timingRow = document.createElement('div');
    timingRow.className = 'tw-studio-timing-row';
    const pauseLabel = document.createElement('label');
    pauseLabel.className = 'tw-studio-control-label';
    pauseLabel.textContent = 'Pause after';
    const pauseAfter = document.createElement('input');
    pauseAfter.id = PAUSE_ID;
    pauseAfter.type = 'number';
    pauseAfter.min = '0';
    pauseAfter.max = String(MAX_TRANSACTION_PAUSE_MS);
    pauseAfter.step = '50';
    pauseAfter.value = '';
    pauseAfter.placeholder = 'Auto';
    pauseAfter.title = 'Pause after selected transaction in milliseconds; leave blank for automatic pacing';
    pauseLabel.append(pauseAfter);
    const timingUnit = document.createElement('span');
    timingUnit.className = 'tw-studio-timing-unit';
    timingUnit.textContent = 'ms';
    timingRow.append(pauseLabel, timingUnit);
    pauseAfter.addEventListener('input', () => {
        const position = Number(step.value);
        if (!Number.isInteger(position) || position < 1) return;
        const value = pauseAfter.value === '' ? null : Number(pauseAfter.value);
        runPlayback(() => session.setTransactionPause(position, value));
    });
    const spriteTimingRow = document.createElement('div');
    spriteTimingRow.className = 'tw-studio-timing-row';
    const spritePauseLabel = document.createElement('label');
    spritePauseLabel.className = 'tw-studio-control-label';
    spritePauseLabel.textContent = 'Sprite pause';
    const spritePause = document.createElement('input');
    spritePause.id = SPRITE_PAUSE_ID;
    spritePause.type = 'number';
    spritePause.min = '0';
    spritePause.max = String(MAX_TRANSACTION_PAUSE_MS);
    spritePause.step = '50';
    spritePause.title = 'Playback pause after switching sprites, saved with this take (milliseconds at 1× speed)';
    spritePauseLabel.append(spritePause);
    const spriteTimingUnit = document.createElement('span');
    spriteTimingUnit.className = 'tw-studio-timing-unit';
    spriteTimingUnit.textContent = 'ms';
    spriteTimingRow.append(spritePauseLabel, spriteTimingUnit);
    spritePause.addEventListener('change', () => {
        if (spritePause.value === '') return;
        runPlayback(() => session.setTargetSelectionPause(Number(spritePause.value)));
    });
    let stepFingerprint = null;
    let rangeTransactionCount = 0;
    const transport = document.createElement('div');
    transport.className = 'tw-studio-panel-section';
    const sectionHeading = document.createElement('div');
    sectionHeading.className = 'tw-studio-section-heading';
    const timelineLabel = document.createElement('span');
    timelineLabel.className = 'tw-studio-section-label';
    timelineLabel.textContent = 'Timeline';
    const speedLabel = document.createElement('label');
    speedLabel.className = 'tw-studio-control-label';
    speedLabel.textContent = 'Speed';
    speedLabel.append(speed);
    sectionHeading.append(timelineLabel, speedLabel);
    const timelineRow = document.createElement('div');
    timelineRow.className = 'tw-studio-timeline-row';
    timelineRow.append(jumpStart, previous, playBackward, timeline, playForward, next, jumpEnd);
    const pointerLabel = document.createElement('label');
    pointerLabel.className = 'tw-studio-pointer-setting';
    pointerLabel.title = 'Show the cursor during history changes; skip animation when queued commands need to catch up';
    const historyPointer = document.createElement('input');
    historyPointer.id = HISTORY_POINTER_ID;
    historyPointer.type = 'checkbox';
    historyPointer.addEventListener('change', () => session.setHistoryPointerEnabled(historyPointer.checked));
    const pointerText = document.createElement('span');
    pointerText.textContent = 'Cursor for Undo/Redo';
    pointerLabel.append(historyPointer, pointerText);
    transport.append(sectionHeading, timelineRow, step, rangeRow, timingRow, spriteTimingRow, pointerLabel);
    const seedCamera = typeof session.seedCameraFixture === 'function' ?
        createButton('Seed Camera', () => runPlayback(session.seedCameraFixture)) : null;
    const seedMatrix = typeof session.seedConnectionMatrixFixture === 'function' ?
        createButton('Seed Matrix', () => runPlayback(session.seedConnectionMatrixFixture)) : null;
    const actions = document.createElement('div');
    actions.className = 'tw-studio-panel-actions';
    actions.append(setBase, rewind, play);
    panel.append(header, actions, transport, nativeEvidence, diagnostic);
    if (journalDebug) panel.append(journalDebug);
    if (seedCamera || seedMatrix) {
        const fixtures = document.createElement('div');
        fixtures.className = 'tw-studio-fixtures';
        if (seedCamera) fixtures.append(seedCamera);
        if (seedMatrix) fixtures.append(seedMatrix);
        panel.append(fixtures);
    }
    document.body.appendChild(panel);

    const unsubscribe = session.subscribe(state => {
        const difference = state.validation && state.validation.difference;
        const differenceValues = difference &&
            Object.prototype.hasOwnProperty.call(difference, 'expected') &&
            Object.prototype.hasOwnProperty.call(difference, 'actual') ?
            ` (expected ${JSON.stringify(difference.expected)}, actual ${JSON.stringify(difference.actual)})` : '';
        const differenceText = difference ? ` · differs at ${difference.path}${differenceValues}` : '';
        const positionText = Number.isInteger(state.cursor) && Number.isInteger(state.transactionCount) ?
            ` · position ${state.cursor}/${state.transactionCount}` : '';
        status.textContent = `${state.status} · ${state.stepCount} steps (${state.eventCount} events)` +
            `${positionText}${differenceText}`;
        const freshness = state.buildFreshness;
        if (freshness) {
            const loaded = freshness.loadedBuildId ? freshness.loadedBuildId.slice(0, 12) : 'unknown';
            const current = freshness.currentBuildId ? freshness.currentBuildId.slice(0, 12) : 'unknown';
            build.textContent = freshness.status === 'current' ?
                `bundle ${loaded} · current` :
                `bundle ${loaded} · ${freshness.status}; server ${current} · reload required`;
            build.dataset.status = freshness.status;
        } else {
            build.textContent = '';
            build.dataset.status = '';
        }
        nativeEvidence.textContent = state.nativeInteraction ? JSON.stringify(state.nativeInteraction) : '';
        nativeEvidence.dataset.status = state.nativeInteraction ? state.nativeInteraction.status : '';
        diagnostic.textContent = state.diagnostic ? JSON.stringify(state.diagnostic) : '';
        if (journalDebug) {
            journalDebug.textContent = JSON.stringify({
                journal: session.getJournal(),
                validation: state.validation || null
            });
        }
        const historyUnavailable = Boolean(
            state.status === 'initializing' || state.projectReplaced ||
            (freshness && freshness.status !== 'current')
        );
        const historyActive = Boolean(state.historyCommandActive) && !historyUnavailable;
        const buttonsDisabled = historyUnavailable || state.busy || historyActive;
        // Only the two queue-aware step buttons remain usable during history.
        // Lift the panel above the editor input shield without exposing any
        // authoring controls or changing modal stacking during full Play.
        panel.style.zIndex = historyActive ? '10002' : '505';
        setButtonDisabled(setBase, buttonsDisabled);
        setButtonDisabled(rewind, buttonsDisabled);
        setButtonDisabled(play, buttonsDisabled);
        setButtonDisabled(playBackward, buttonsDisabled || !state.canUndo);
        setButtonDisabled(playForward, buttonsDisabled || !state.canRedo);
        currentCursor = state.cursor || 0;
        currentTransactionCount = state.transactionCount || 0;
        setButtonDisabled(jumpStart, buttonsDisabled || currentCursor === 0);
        setButtonDisabled(previous, !historyActive && (buttonsDisabled || currentCursor === 0));
        setButtonDisabled(next, !historyActive && (buttonsDisabled || currentCursor === currentTransactionCount));
        setButtonDisabled(jumpEnd, buttonsDisabled || currentCursor === currentTransactionCount);
        // Keep accepting a newer destination while the current semantic
        // catch-up is running. Other playback operations still lock the rail.
        timeline.disabled = buttonsDisabled && !scrubActive;
        timeline.max = String(state.transactionCount || 0);
        if (!scrubActive) timeline.value = String(state.cursor || 0);
        const descriptors = typeof session.getTimeline === 'function' ? session.getTimeline() :
            Array.from({length: state.transactionCount || 0}, (_, index) => ({
                index: index + 1,
                label: `Step ${index + 1}`,
                target: null
            }));
        const nextFingerprint = JSON.stringify(descriptors);
        if (stepFingerprint !== nextFingerprint) {
            const previousStart = Math.min(Number(rangeStart.value) || 0, state.transactionCount || 0);
            const rangeFollowedEnd = Number(rangeEnd.value) === rangeTransactionCount;
            const previousEnd = rangeFollowedEnd ? (state.transactionCount || 0) :
                Math.min(Number(rangeEnd.value) || 0, state.transactionCount || 0);
            stepFingerprint = nextFingerprint;
            for (const control of [step, rangeStart, rangeEnd]) {
                if (typeof control.replaceChildren === 'function') control.replaceChildren();
                else control.children = [];
            }
            const start = document.createElement('option');
            start.value = '0';
            start.textContent = '0 · Start';
            step.append(start);
            for (const control of [rangeStart, rangeEnd]) {
                const option = document.createElement('option');
                option.value = '0';
                option.textContent = '0';
                control.append(option);
            }
            for (const descriptor of descriptors) {
                const option = document.createElement('option');
                option.value = String(descriptor.index);
                option.textContent = `${descriptor.index} · ${descriptor.label}${
                    descriptor.target ? ` — ${descriptor.target}` : ''
                }`;
                step.append(option);
                for (const control of [rangeStart, rangeEnd]) {
                    const rangeOption = document.createElement('option');
                    rangeOption.value = String(descriptor.index);
                    rangeOption.textContent = String(descriptor.index);
                    control.append(rangeOption);
                }
            }
            rangeStart.value = String(Math.min(previousStart, previousEnd));
            rangeEnd.value = String(Math.max(previousStart, previousEnd));
            rangeTransactionCount = state.transactionCount || 0;
        }
        step.value = String(state.cursor || 0);
        step.disabled = buttonsDisabled;
        const selectedDescriptor = descriptors.find(descriptor => descriptor.index === Number(step.value));
        pauseAfter.value = selectedDescriptor && Number.isFinite(selectedDescriptor.pauseAfterMs) ?
            String(selectedDescriptor.pauseAfterMs) : '';
        pauseAfter.disabled = buttonsDisabled || !selectedDescriptor;
        spritePause.value = String(Number.isFinite(state.targetSelectionPauseMs) ?
            state.targetSelectionPauseMs : DEFAULT_TARGET_SELECTION_PAUSE_MS);
        spritePause.disabled = buttonsDisabled;
        speed.disabled = buttonsDisabled;
        historyPointer.checked = state.historyPointerEnabled !== false;
        historyPointer.disabled = buttonsDisabled;
        rangeStart.disabled = buttonsDisabled;
        rangeEnd.disabled = buttonsDisabled;
        const rangeEmpty = Number(rangeStart.value) === Number(rangeEnd.value);
        setButtonDisabled(rangeBackward, buttonsDisabled || rangeEmpty);
        setButtonDisabled(rangeForward, buttonsDisabled || rangeEmpty);
        if (seedCamera) setButtonDisabled(seedCamera, buttonsDisabled);
        if (seedMatrix) setButtonDisabled(seedMatrix, buttonsDisabled);
    });

    return {
        detach: () => {
            unsubscribe();
            panel.remove();
            if (ownedStyle) ownedStyle.remove();
        }
    };
};

export {
    DIAGNOSTIC_ID,
    END_ID,
    HISTORY_POINTER_ID,
    SPRITE_PAUSE_ID,
    JOURNAL_DEBUG_ID,
    NEXT_ID,
    NATIVE_EVIDENCE_ID,
    PAUSE_ID,
    PANEL_ID,
    PREVIOUS_ID,
    RANGE_BACKWARD_ID,
    RANGE_END_ID,
    RANGE_FORWARD_ID,
    RANGE_START_ID,
    SPEED_ID,
    START_ID,
    STEP_ID,
    TIMELINE_ID,
    createStudioSessionPanel
};
