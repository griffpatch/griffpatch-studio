import {createPlaybackEventScope} from '../../src/studio/bridge/native-interaction/playback-event-scope';

const makeDocument = () => {
    const children = [];
    const listeners = new Map();
    return {
        children,
        listeners,
        addEventListener: (type, listener) => listeners.set(type, listener),
        removeEventListener: (type, listener) => {
            if (listeners.get(type) === listener) listeners.delete(type);
        },
        createElement: () => ({
            style: {},
            setAttribute: jest.fn(),
            remove: jest.fn()
        }),
        body: {appendChild: child => children.push(child)}
    };
};

test('isolates Undo storage without disabling native shadow side effects', () => {
    let listener;
    const undoEntry = {};
    const redoEntry = {};
    const release = jest.fn();
    const workspace = {
        suspendUndoRecording: jest.fn(() => release),
        undoStack_: [undoEntry],
        redoStack_: [redoEntry],
        addChangeListener: next => {
            listener = next;
        },
        removeChangeListener: next => {
            if (listener === next) listener = null;
        }
    };
    const ScratchBlocks = {Events: {
        recordUndo: true,
        FIRE_QUEUE_: [{}],
        fireNow_: jest.fn(() => {
            ScratchBlocks.Events.FIRE_QUEUE_.length = 0;
        })
    }};
    const documentObject = makeDocument();
    const scope = createPlaybackEventScope({
        workspace,
        ScratchBlocks,
        documentObject,
        journalCounts: () => ({eventCount: 4, stepCount: 2})
    });

    expect(ScratchBlocks.Events.recordUndo).toBe(true);
    expect(workspace.suspendUndoRecording).toHaveBeenCalledTimes(1);
    scope.flushPendingEvents();
    expect(ScratchBlocks.Events.fireNow_).toHaveBeenCalledTimes(1);
    expect(() => scope.runWithoutUndo(() => {
        expect(ScratchBlocks.Events.recordUndo).toBe(true);
        throw new Error('driver failed');
    })).toThrow('driver failed');
    expect(ScratchBlocks.Events.recordUndo).toBe(true);
    listener({type: 'move'});
    expect(scope.observed).toHaveLength(1);
    expect(scope.verifyIsolation()).toMatchObject({
        journalUnchanged: true,
        undoUnchanged: true,
        redoUnchanged: true,
        undoDepth: 1,
        redoDepth: 1
    });
    const keyboardEvent = {
        preventDefault: jest.fn(),
        stopPropagation: jest.fn(),
        stopImmediatePropagation: jest.fn()
    };
    documentObject.listeners.get('keydown')(keyboardEvent);
    expect(keyboardEvent.preventDefault).toHaveBeenCalledTimes(1);

    scope.detach();
    scope.detach();
    expect(release).toHaveBeenCalledTimes(1);
    expect(ScratchBlocks.Events.recordUndo).toBe(true);
    expect(listener).toBeNull();
    expect(documentObject.listeners.size).toBe(0);
    expect(documentObject.children[0].remove).toHaveBeenCalledTimes(1);
});

test('detects stack and persisted-journal pollution', () => {
    let counts = {eventCount: 1, stepCount: 1};
    const workspace = {
        suspendUndoRecording: () => jest.fn(),
        undoStack_: [],
        redoStack_: [],
        addChangeListener: jest.fn(),
        removeChangeListener: jest.fn()
    };
    const scope = createPlaybackEventScope({
        workspace,
        ScratchBlocks: {Events: {recordUndo: true}},
        documentObject: makeDocument(),
        journalCounts: () => counts
    });
    workspace.undoStack_.push({});
    counts = {eventCount: 2, stepCount: 2};

    expect(scope.verifyIsolation()).toMatchObject({
        journalUnchanged: false,
        undoUnchanged: false,
        redoUnchanged: true
    });
    scope.detach();
});
