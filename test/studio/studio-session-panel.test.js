import {
    END_ID,
    HISTORY_POINTER_ID,
    NEXT_ID,
    PAUSE_ID,
    PREVIOUS_ID,
    RANGE_BACKWARD_ID,
    RANGE_END_ID,
    RANGE_FORWARD_ID,
    RANGE_START_ID,
    SPEED_ID,
    SPRITE_PAUSE_ID,
    START_ID,
    STEP_ID,
    TIMELINE_ID,
    createStudioSessionPanel
} from '../../src/studio/bridge/studio-session-panel';

const findElements = (element, predicate) => {
    const matches = predicate(element) ? [element] : [];
    for (const child of element.children || []) matches.push(...findElements(child, predicate));
    return matches;
};

const findById = (element, id) => findElements(element, candidate => candidate.id === id)[0] || null;

test('uses TurboWarp theme classes and explicit control hierarchy', () => {
    const previousDocument = global.document;
    const makeElement = tagName => ({
        tagName,
        style: {},
        dataset: {},
        children: [],
        append (...children) {
            this.children.push(...children);
        },
        addEventListener: jest.fn(),
        remove: jest.fn()
    });
    const body = makeElement('body');
    body.appendChild = element => {
        body.children.push(element);
    };
    global.document = {
        body,
        createElement: makeElement
    };

    let publish;
    const session = {
        startNewTake: jest.fn(() => Promise.resolve()),
        rewind: jest.fn(() => Promise.resolve()),
        play: jest.fn(() => Promise.resolve()),
        setHistoryPointerEnabled: jest.fn(),
        setTargetSelectionPause: jest.fn(),
        subscribe: subscriber => {
            publish = subscriber;
            subscriber({status: 'initializing', busy: true, eventCount: 0, stepCount: 0});
            return jest.fn();
        }
    };
    const panel = createStudioSessionPanel(session);
    expect(body.children[0].style.zIndex).toBe('505');
    expect(body.children[0]).toMatchObject({
        className: 'tw-studio-panel',
        dataset: {theme: 'turbowarp'}
    });
    const buttons = findElements(body.children[0], element => element.tagName === 'button');

    expect(buttons).toHaveLength(11);
    buttons.forEach(button => {
        expect(button.disabled).toBe(true);
        expect(button.className).toBe('tw-studio-button');
        expect(button.dataset.state).toBe('disabled');
    });
    expect(buttons.find(button => button.textContent === 'Play').dataset.variant).toBe('primary');
    expect(buttons.find(button => button.textContent === 'Set Base').dataset.variant).toBe('secondary');
    expect(findById(body, TIMELINE_ID).className).toBe('tw-studio-timeline');
    expect(findById(body, STEP_ID).className).toBe('tw-studio-step');
    const historyPointer = findById(body, HISTORY_POINTER_ID);
    expect(historyPointer).toMatchObject({type: 'checkbox', checked: true, disabled: true});
    const spritePause = findById(body, SPRITE_PAUSE_ID);
    expect(spritePause).toMatchObject({type: 'number', value: '500', disabled: true});

    publish({status: 'recording', busy: false, eventCount: 3, stepCount: 2});
    const status = findElements(body, element => element.className === 'tw-studio-panel-status')[0];
    expect(status.textContent).toBe('recording · 2 steps (3 events)');
    expect(buttons.find(button => button.textContent === 'Set Base').dataset.state).toBe('enabled');
    expect(buttons.find(button => button.textContent === 'Rewind').dataset.state).toBe('enabled');
    expect(buttons.find(button => button.textContent === 'Play').dataset.state).toBe('enabled');
    expect(historyPointer.disabled).toBe(false);
    expect(spritePause.disabled).toBe(false);
    historyPointer.checked = false;
    historyPointer.addEventListener.mock.calls.find(([name]) => name === 'change')[1]();
    expect(session.setHistoryPointerEnabled).toHaveBeenCalledWith(false);
    publish({status: 'recording', busy: false, historyPointerEnabled: false});
    expect(historyPointer.checked).toBe(false);
    publish({status: 'timing updated', busy: false, targetSelectionPauseMs: 850});
    expect(spritePause.value).toBe('850');

    publish({
        status: 'state mismatch',
        busy: false,
        eventCount: 3,
        stepCount: 2,
        validation: {difference: {path: '$.targets[0].blocks.a.x', expected: 10, actual: 11}}
    });
    expect(status.textContent).toBe(
        'state mismatch · 2 steps (3 events) · differs at $.targets[0].blocks.a.x (expected 10, actual 11)'
    );

    publish({
        status: 'recording',
        busy: false,
        eventCount: 3,
        stepCount: 2,
        buildFreshness: {status: 'stale', loadedBuildId: 'old-build', currentBuildId: 'new-build'}
    });
    const build = findElements(body, element => element.className === 'tw-studio-panel-build')[0];
    expect(build).toMatchObject({
        textContent: 'bundle old-build · stale; server new-build · reload required',
        dataset: {status: 'stale'}
    });
    buttons.forEach(button => expect(button.disabled).toBe(true));

    panel.detach();
    global.document = previousDocument;
});

test('installs one scoped stylesheet backed by TurboWarp theme variables', () => {
    const previousDocument = global.document;
    const makeElement = tagName => ({
        tagName,
        style: {},
        dataset: {},
        children: [],
        append (...children) {
            this.children.push(...children);
        },
        appendChild (child) {
            this.children.push(child);
        },
        addEventListener: jest.fn(),
        remove: jest.fn()
    });
    const body = makeElement('body');
    const head = makeElement('head');
    body.appendChild = element => body.children.push(element);
    global.document = {
        body,
        head,
        createElement: makeElement,
        getElementById: id => head.children.find(element => element.id === id) || null
    };
    const session = {
        startNewTake: jest.fn(() => Promise.resolve()),
        rewind: jest.fn(() => Promise.resolve()),
        play: jest.fn(() => Promise.resolve()),
        subscribe: subscriber => {
            subscriber({status: 'recording', busy: false, eventCount: 0, stepCount: 0});
            return jest.fn();
        }
    };

    const panel = createStudioSessionPanel(session);
    expect(head.children).toHaveLength(1);
    expect(head.children[0].textContent).toContain('background: var(--ui-modal-background)');
    expect(head.children[0].textContent).toContain('color: var(--text-primary)');
    expect(head.children[0].textContent).toContain('accent-color: var(--looks-secondary)');
    expect(head.children[0].textContent).toContain('input[type="number"]');
    expect(head.children[0].textContent).not.toContain('background: white');

    panel.detach();
    expect(head.children[0].remove).toHaveBeenCalledTimes(1);
    global.document = previousDocument;
});

test('shows optional browser-fixture controls only when the session provides them', () => {
    const previousDocument = global.document;
    const makeElement = tagName => ({
        tagName,
        style: {},
        dataset: {},
        children: [],
        append (...children) {
            this.children.push(...children);
        },
        addEventListener: jest.fn(),
        remove: jest.fn()
    });
    const body = makeElement('body');
    body.appendChild = element => body.children.push(element);
    global.document = {body, createElement: makeElement};
    const session = {
        startNewTake: jest.fn(() => Promise.resolve()),
        rewind: jest.fn(() => Promise.resolve()),
        play: jest.fn(() => Promise.resolve()),
        seedCameraFixture: jest.fn(() => Promise.resolve()),
        seedConnectionMatrixFixture: jest.fn(() => Promise.resolve()),
        subscribe: subscriber => {
            subscriber({status: 'recording', busy: false, eventCount: 0, stepCount: 0});
            return jest.fn();
        }
    };

    createStudioSessionPanel(session);

    const buttons = findElements(body.children[0], element => element.tagName === 'button');
    expect(buttons.slice(0, 3).map(button => button.textContent)).toEqual(['Set Base', 'Rewind', 'Play']);
    expect(buttons.slice(-2).map(button => button.textContent)).toEqual(['Seed Camera', 'Seed Matrix']);
    global.document = previousDocument;
});

test('queues a panel command clicked while the previous command is settling', async () => {
    const previousDocument = global.document;
    const makeElement = tagName => ({
        tagName,
        style: {},
        dataset: {},
        children: [],
        listeners: {},
        append (...children) {
            this.children.push(...children);
        },
        addEventListener (name, listener) {
            this.listeners[name] = listener;
        },
        remove: jest.fn()
    });
    const body = makeElement('body');
    body.appendChild = element => body.children.push(element);
    global.document = {body, createElement: makeElement};
    let finishFirst;
    const first = new Promise(resolve => {
        finishFirst = resolve;
    });
    const session = {
        startNewTake: jest.fn(() => first),
        rewind: jest.fn(() => Promise.resolve()),
        play: jest.fn(() => Promise.resolve()),
        subscribe: subscriber => {
            subscriber({status: 'recording', busy: false, eventCount: 1, stepCount: 1});
            return jest.fn();
        }
    };

    createStudioSessionPanel(session);
    const buttons = findElements(body.children[0], element => element.tagName === 'button');
    buttons.find(button => button.textContent === 'Set Base').listeners.click();
    buttons.find(button => button.textContent === 'Rewind').listeners.click();

    expect(session.startNewTake).toHaveBeenCalledTimes(1);
    expect(session.rewind).not.toHaveBeenCalled();
    finishFirst();
    await Promise.resolve();
    await Promise.resolve();
    expect(session.rewind).toHaveBeenCalledTimes(1);
    global.document = previousDocument;
});

test('binds point and selected-range transport to exact seek and directional playback speed', async () => {
    const previousDocument = global.document;
    const makeElement = tagName => ({
        tagName,
        style: {},
        dataset: {},
        children: [],
        listeners: {},
        append (...children) {
            this.children.push(...children);
        },
        addEventListener (name, listener) {
            this.listeners[name] = listener;
        },
        remove: jest.fn()
    });
    const body = makeElement('body');
    body.appendChild = element => body.children.push(element);
    global.document = {body, createElement: makeElement};
    let publish;
    const session = {
        startNewTake: jest.fn(() => Promise.resolve()),
        rewind: jest.fn(() => Promise.resolve()),
        play: jest.fn(() => Promise.resolve()),
        playHistory: jest.fn(() => Promise.resolve()),
        seek: jest.fn(() => Promise.resolve()),
        undo: jest.fn(() => Promise.resolve()),
        redo: jest.fn(() => Promise.resolve()),
        requestHistory: jest.fn(() => Promise.resolve()),
        setTransactionPause: jest.fn(() => Promise.resolve()),
        getTimeline: jest.fn(() => [
            {index: 1, label: 'Add when flag clicked', target: 'Sprite1', pauseAfterMs: null},
            {index: 2, label: 'Add move steps', target: 'Sprite1', pauseAfterMs: 0},
            {index: 3, label: 'Edit move steps', target: 'Sprite1', pauseAfterMs: null},
            {index: 4, label: 'Move move steps', target: 'Sprite1', pauseAfterMs: 1200}
        ]),
        subscribe: subscriber => {
            publish = subscriber;
            subscriber({
                status: 'recording',
                busy: false,
                eventCount: 9,
                stepCount: 4,
                cursor: 4,
                transactionCount: 4,
                canUndo: true,
                canRedo: false
            });
            return jest.fn();
        }
    };

    createStudioSessionPanel(session);
    const flushCommands = async () => {
        for (let turn = 0; turn < 16; turn += 1) await Promise.resolve();
    };
    const timeline = findById(body, TIMELINE_ID);
    const step = findById(body, STEP_ID);
    const speed = findById(body, SPEED_ID);
    const pauseAfter = findById(body, PAUSE_ID);
    const jumpStart = findById(body, START_ID);
    const previous = findById(body, PREVIOUS_ID);
    const next = findById(body, NEXT_ID);
    const jumpEnd = findById(body, END_ID);
    const rangeStart = findById(body, RANGE_START_ID);
    const rangeEnd = findById(body, RANGE_END_ID);
    const rangeBackward = findById(body, RANGE_BACKWARD_ID);
    const rangeForward = findById(body, RANGE_FORWARD_ID);
    expect(timeline).toMatchObject({min: '0', max: '4', value: '4', step: '1'});
    const status = findElements(body, element => element.className === 'tw-studio-panel-status')[0];
    expect(status.textContent).toBe(
        'recording · 4 steps (9 events) · position 4/4'
    );
    expect(step.value).toBe('4');
    expect(pauseAfter).toMatchObject({
        type: 'number',
        min: '0',
        max: '30000',
        step: '50',
        value: '1200',
        disabled: false
    });
    expect(step.children.map(option => option.textContent)).toEqual([
        '0 · Start',
        '1 · Add when flag clicked — Sprite1',
        '2 · Add move steps — Sprite1',
        '3 · Edit move steps — Sprite1',
        '4 · Move move steps — Sprite1'
    ]);
    expect(jumpStart.disabled).toBe(false);
    expect(previous.disabled).toBe(false);
    expect(next.disabled).toBe(true);
    expect(jumpEnd.disabled).toBe(true);
    expect(rangeStart.children.map(option => option.textContent)).toEqual(['0', '1', '2', '3', '4']);
    expect(rangeStart.value).toBe('0');
    expect(rangeEnd.value).toBe('4');
    expect(rangeBackward.disabled).toBe(false);
    expect(rangeForward.disabled).toBe(false);

    timeline.value = '2';
    timeline.listeners.change();
    await flushCommands();
    expect(session.seek).toHaveBeenCalledWith(2);

    const callsBeforeScrub = session.seek.mock.calls.length;
    timeline.value = '1';
    timeline.listeners.input();
    timeline.value = '2';
    timeline.listeners.input();
    timeline.value = '0';
    timeline.listeners.input();
    await flushCommands();
    // The in-flight destination completes, then catch-up jumps directly to
    // the newest thumb position instead of replaying every stale input value.
    expect(session.seek.mock.calls.slice(callsBeforeScrub)).toEqual([[1], [0]]);

    step.value = '3';
    step.listeners.change();
    await flushCommands();
    expect(session.seek).toHaveBeenCalledWith(3);

    pauseAfter.value = '750';
    pauseAfter.listeners.input();
    await flushCommands();
    expect(session.setTransactionPause).toHaveBeenLastCalledWith(3, 750);
    pauseAfter.value = '';
    pauseAfter.listeners.input();
    await flushCommands();
    expect(session.setTransactionPause).toHaveBeenLastCalledWith(3, null);

    jumpStart.listeners.click();
    previous.listeners.click();
    next.listeners.click();
    jumpEnd.listeners.click();
    await flushCommands();
    expect(session.seek.mock.calls.slice(-2)).toEqual([[0], [4]]);
    expect(session.requestHistory).toHaveBeenCalledWith('undo', {playbackSpeed: 1});
    expect(session.requestHistory).toHaveBeenCalledWith('redo', {playbackSpeed: 1});
    expect(session.undo).not.toHaveBeenCalled();
    expect(session.redo).not.toHaveBeenCalled();

    speed.value = '2';
    findElements(body, element => element.title === 'Play timeline backward')[0].listeners.click();
    findElements(body, element => element.title === 'Play timeline forward')[0].listeners.click();
    await flushCommands();
    expect(session.playHistory).toHaveBeenNthCalledWith(1, {direction: 'backward', speed: 2});
    expect(session.playHistory).toHaveBeenNthCalledWith(2, {direction: 'forward', speed: 2});

    rangeStart.value = '1';
    rangeStart.listeners.change();
    rangeEnd.value = '3';
    rangeEnd.listeners.change();
    rangeForward.listeners.click();
    await flushCommands();
    expect(session.seek).toHaveBeenLastCalledWith(1);
    expect(session.playHistory).toHaveBeenLastCalledWith({direction: 'forward', targetIndex: 3, speed: 2});

    rangeBackward.listeners.click();
    await flushCommands();
    expect(session.seek).toHaveBeenLastCalledWith(3);
    expect(session.playHistory).toHaveBeenLastCalledWith({direction: 'backward', targetIndex: 1, speed: 2});

    rangeStart.value = '4';
    rangeStart.listeners.change();
    expect(rangeEnd.value).toBe('4');
    rangeEnd.value = '2';
    rangeEnd.listeners.change();
    expect(rangeStart.value).toBe('2');

    publish({
        status: 'positioned',
        busy: false,
        eventCount: 9,
        stepCount: 4,
        cursor: 2,
        transactionCount: 4,
        canUndo: true,
        canRedo: true
    });
    expect(timeline.value).toBe('2');
    expect(step.value).toBe('2');
    expect(pauseAfter.value).toBe('0');
    expect(jumpStart.disabled).toBe(false);
    expect(previous.disabled).toBe(false);
    expect(next.disabled).toBe(false);
    expect(jumpEnd.disabled).toBe(false);
    // While any input surface owns the shared history queue, only its two
    // step controls can accept more work, even at an in-flight endpoint.
    publish({status: 'undoing', busy: true, cursor: 4, transactionCount: 4, historyCommandActive: true});
    expect(previous.disabled).toBe(false);
    expect(next.disabled).toBe(false);
    expect(speed.disabled).toBe(true);
    expect(jumpEnd.disabled).toBe(true);
    expect(body.children[0].style.zIndex).toBe('10002');
    // The idle publication within the final transaction cannot unlock Play
    // before the queue releases ownership.
    publish({status: 'undone', busy: false, cursor: 3, transactionCount: 4, historyCommandActive: true});
    expect(speed.disabled).toBe(true);
    publish({status: 'undone', busy: false, cursor: 3, transactionCount: 4, historyCommandActive: false});
    expect(speed.disabled).toBe(false);
    expect(body.children[0].style.zIndex).toBe('505');
    publish({status: 'playing', busy: true, cursor: 3, transactionCount: 4});
    expect(previous.disabled).toBe(true);
    expect(next.disabled).toBe(true);
    expect(body.children[0].style.zIndex).toBe('505');
    global.document = previousDocument;
});
