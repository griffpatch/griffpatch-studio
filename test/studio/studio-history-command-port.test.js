import {attachStudioHistoryCommands} from '../../src/studio/bridge/studio-history-command-port';
import {createHistoryCommandQueue} from '../../src/studio/bridge/history-command-queue';

const attachCommands = options => {
    const queue = createHistoryCommandQueue({session: options.session});
    options.session.requestHistory = queue.request;
    options.session.canRequestHistory = queue.canRequest;
    const port = attachStudioHistoryCommands(options);
    return {detach: () => {
        port.detach();
        queue.detach();
    }};
};

const makeEvent = overrides => ({
    key: 'z',
    ctrlKey: true,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    target: {tagName: 'DIV'},
    preventDefault: jest.fn(),
    stopImmediatePropagation: jest.fn(),
    ...overrides
});

test('routes keyboard and context-menu commands through Studio and restores Scratch', async () => {
    let keydown;
    const documentObject = {
        addEventListener: (type, listener, capture) => {
            expect([type, capture]).toEqual(['keydown', true]);
            keydown = listener;
        },
        removeEventListener: jest.fn()
    };
    const originalUndoOption = jest.fn();
    const originalRedoOption = jest.fn();
    const ScratchBlocks = {
        ContextMenu: {
            wsUndoOption: originalUndoOption,
            wsRedoOption: originalRedoOption
        },
        Msg: {UNDO: 'Undo', REDO: 'Redo'},
        hideChaff: jest.fn()
    };
    const session = {
        canUndo: jest.fn(() => true),
        canRedo: jest.fn(() => true),
        undo: jest.fn(() => Promise.resolve()),
        redo: jest.fn(() => Promise.resolve()),
        stopPlayback: jest.fn(() => true)
    };

    const port = attachCommands({documentObject, ScratchBlocks, session});
    const undoEvent = makeEvent();
    keydown(undoEvent);
    expect(session.undo).toHaveBeenCalledTimes(1);
    expect(undoEvent.preventDefault).toHaveBeenCalled();
    expect(undoEvent.stopImmediatePropagation).toHaveBeenCalled();

    keydown(makeEvent({key: 'Z', shiftKey: true}));
    keydown(makeEvent({key: 'y'}));
    await Promise.resolve();
    await Promise.resolve();
    expect(session.redo).toHaveBeenCalledTimes(2);

    const undoOption = ScratchBlocks.ContextMenu.wsUndoOption();
    expect(undoOption).toMatchObject({text: 'Undo', enabled: true});
    undoOption.callback();
    await Promise.resolve();
    expect(session.undo).toHaveBeenCalledTimes(2);

    keydown(makeEvent({target: {tagName: 'INPUT'}}));
    expect(session.undo).toHaveBeenCalledTimes(2);

    const escapeEvent = makeEvent({key: 'Escape', ctrlKey: false, target: {tagName: 'INPUT'}});
    keydown(escapeEvent);
    expect(session.stopPlayback).toHaveBeenCalledTimes(1);
    expect(escapeEvent.preventDefault).toHaveBeenCalled();
    expect(escapeEvent.stopImmediatePropagation).toHaveBeenCalled();

    port.detach();
    expect(documentObject.removeEventListener).toHaveBeenCalledWith('keydown', keydown, true);
    expect(ScratchBlocks.ContextMenu.wsUndoOption).toBe(originalUndoOption);
    expect(ScratchBlocks.ContextMenu.wsRedoOption).toBe(originalRedoOption);
});

test('queues rapid history keys, snaps the active presentation and animates only the terminal request', async () => {
    let keydown;
    const documentObject = {
        addEventListener: (type, listener) => {
            keydown = listener;
        },
        removeEventListener: jest.fn()
    };
    const ScratchBlocks = {
        ContextMenu: {},
        Msg: {UNDO: 'Undo', REDO: 'Redo'}
    };
    const operations = [];
    const pending = [];
    let cursor = 4;
    let concurrent = 0;
    let maximumConcurrent = 0;
    const undo = jest.fn(options => {
        operations.push({direction: 'undo', ...options});
        concurrent++;
        maximumConcurrent = Math.max(maximumConcurrent, concurrent);
        return new Promise(resolve => pending.push(() => {
            cursor--;
            concurrent--;
            resolve();
        }));
    });
    const session = {
        canUndo: () => cursor > 0 && concurrent === 0,
        canRedo: () => cursor < 4 && concurrent === 0,
        undo,
        redo: jest.fn(),
        finishHistoryPresentation: jest.fn()
    };
    const port = attachCommands({documentObject, ScratchBlocks, session});

    keydown(makeEvent());
    keydown(makeEvent());
    keydown(makeEvent());
    expect(undo).toHaveBeenCalledTimes(1);
    expect(session.finishHistoryPresentation).toHaveBeenCalledTimes(2);

    pending.shift()();
    await Promise.resolve();
    expect(undo).toHaveBeenCalledTimes(2);
    pending.shift()();
    await Promise.resolve();
    expect(undo).toHaveBeenCalledTimes(3);
    pending.shift()();
    await Promise.resolve();

    expect(operations).toEqual([
        {direction: 'undo', lifecyclePresentation: true},
        {direction: 'undo', lifecyclePresentation: false},
        {direction: 'undo', lifecyclePresentation: true}
    ]);
    expect(maximumConcurrent).toBe(1);
    port.detach();
});

test('consumes unavailable Studio history instead of falling through to native stacks', () => {
    let keydown;
    const documentObject = {
        addEventListener: (type, listener) => {
            keydown = listener;
        },
        removeEventListener: jest.fn()
    };
    const ScratchBlocks = {
        ContextMenu: {},
        Msg: {UNDO: 'Undo', REDO: 'Redo'}
    };
    const session = {
        canUndo: () => false,
        canRedo: () => false,
        undo: jest.fn(),
        redo: jest.fn()
    };
    const port = attachCommands({documentObject, ScratchBlocks, session});
    const event = makeEvent();

    keydown(event);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(session.undo).not.toHaveBeenCalled();
    expect(ScratchBlocks.ContextMenu.wsUndoOption().enabled).toBe(false);
    port.detach();
});

test('leaves keyboard history untouched while the active editor native stack owns it', () => {
    let keydown;
    const documentObject = {
        addEventListener: (type, listener) => {
            keydown = listener;
        },
        removeEventListener: jest.fn()
    };
    const ScratchBlocks = {
        ContextMenu: {},
        Msg: {UNDO: 'Undo', REDO: 'Redo'},
        hideChaff: jest.fn()
    };
    const session = {
        canUndo: () => true,
        canRedo: () => true,
        nativeHistoryOwns: jest.fn(() => true),
        undo: jest.fn(),
        redo: jest.fn()
    };
    const port = attachCommands({documentObject, ScratchBlocks, session});
    const event = makeEvent();

    keydown(event);

    expect(session.nativeHistoryOwns).toHaveBeenCalledWith('undo');
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(event.stopImmediatePropagation).not.toHaveBeenCalled();
    expect(ScratchBlocks.hideChaff).not.toHaveBeenCalled();
    expect(session.undo).not.toHaveBeenCalled();
    port.detach();
});

test('finalizes a pending editor boundary before deciding whether Studio can undo it', async () => {
    let keydown;
    const documentObject = {
        addEventListener: (type, listener) => {
            keydown = listener;
        },
        removeEventListener: jest.fn()
    };
    const ScratchBlocks = {
        ContextMenu: {},
        Msg: {UNDO: 'Undo', REDO: 'Redo'}
    };
    let boundaryOpen = true;
    let canUndo = false;
    const session = {
        canUndo: () => canUndo,
        canRedo: () => false,
        hasPendingHistoryBoundary: () => boundaryOpen,
        prepareHistoryCommand: jest.fn(async () => {
            boundaryOpen = false;
            canUndo = true;
        }),
        undo: jest.fn(() => Promise.resolve()),
        redo: jest.fn()
    };
    const port = attachCommands({documentObject, ScratchBlocks, session});
    const event = makeEvent();

    keydown(event);
    await Promise.resolve();
    await Promise.resolve();

    expect(event.preventDefault).toHaveBeenCalled();
    expect(session.prepareHistoryCommand).toHaveBeenCalledWith('undo');
    expect(session.undo).toHaveBeenCalledWith({lifecyclePresentation: true});
    port.detach();
});
