import {createHistoryCommandQueue} from '../../src/studio/bridge/history-command-queue';

const flush = async () => {
    for (let turn = 0; turn < 8; turn++) await Promise.resolve();
};
const deferred = () => {
    let resolve;
    let reject;
    const promise = new Promise((yes, no) => {
        resolve = yes;
        reject = no;
    });
    return {promise, resolve, reject};
};
const harness = ({cursor: initialCursor = 3, prepare = null, canWait = () => false} = {}) => {
    let cursor = initialCursor;
    let busy = false;
    let available = true;
    const calls = [];
    const completions = [];
    const apply = direction => options => {
        expect(busy).toBe(false);
        busy = true;
        const completion = deferred();
        completions.push(completion);
        calls.push({direction, ...options});
        return completion.promise.then(result => {
            if (!result?.prepared) cursor += direction === 'undo' ? -1 : 1;
            return result;
        }).finally(() => {
            busy = false;
        });
    };
    const session = {
        canUndo: () => !busy && cursor > 0,
        canRedo: () => !busy && cursor < 3,
        undo: apply('undo'),
        redo: apply('redo'),
        finishHistoryPresentation: jest.fn(),
        ...(prepare ? {prepareHistoryCommand: prepare} : {})
    };
    const onActiveChange = jest.fn();
    const queue = createHistoryCommandQueue({session, canWait, isAvailable: () => available, onActiveChange});
    return {queue,
        session,
        calls,
        completions,
        onActiveChange,
        cursor: () => cursor,
        invalidate: () => {
            available = false;
        }};
};

test('keeps mixed directions in order, counts selection stops and retains per-request speed', async () => {
    const h = harness();
    const first = h.queue.request('undo', {playbackSpeed: 0.5});
    const second = h.queue.request('undo');
    const third = h.queue.request('redo', {playbackSpeed: 2});
    expect(h.calls).toHaveLength(1);
    expect(h.session.finishHistoryPresentation).toHaveBeenCalledTimes(2);
    h.completions.shift().resolve({prepared: true});
    await first; await flush();
    expect(h.cursor()).toBe(3);
    h.completions.shift().resolve();
    await second; await flush();
    h.completions.shift().resolve();
    await third; await flush();
    expect(h.calls).toEqual([
        {direction: 'undo', playbackSpeed: 0.5, lifecyclePresentation: true},
        {direction: 'undo', lifecyclePresentation: false},
        {direction: 'redo', playbackSpeed: 2, lifecyclePresentation: true}
    ]);
    expect(h.cursor()).toBe(3);
    expect(h.onActiveChange.mock.calls).toEqual([[true], [false]]);
});

test('allows reversing an in-flight final undo even though redo is not available yet', async () => {
    const h = harness({cursor: 1});
    const undo = h.queue.request('undo');
    expect(h.session.canRedo()).toBe(false);
    expect(h.queue.canRequest('redo')).toBe(true);
    const redo = h.queue.request('redo');
    h.completions.shift().resolve(); await undo; await flush();
    h.completions.shift().resolve(); await redo;
    expect(h.cursor()).toBe(1);
});

test.each(['prepare', 'apply'])('clears follow-ups after a %s failure and permits a fresh retry', async phase => {
    const preparation = deferred();
    const prepare = phase === 'prepare' ? jest.fn().mockImplementationOnce(() => preparation.promise) : null;
    const h = harness({prepare});
    const failure = new Error('restored safety boundary');
    const first = h.queue.request('undo').catch(error => error);
    const next = h.queue.request('redo').catch(error => error);
    if (phase === 'prepare') preparation.reject(failure);
    else h.completions.shift().reject(failure);
    expect(await first).toBe(failure);
    expect(await next).toBe(failure);
    expect(h.calls).toHaveLength(phase === 'prepare' ? 0 : 1);
    const retry = h.queue.request('undo'); await flush();
    h.completions.shift().resolve(); await retry;
    expect(h.cursor()).toBe(2);
});

test('holds a request during cancellation until the stopped Play boundary is ready', async () => {
    const stopped = deferred();
    let stopping = true;
    const h = harness({cursor: 0, canWait: () => stopping, prepare: () => stopped.promise});
    h.session.canRedo = () => !stopping;
    const request = h.queue.request('redo');
    expect(h.calls).toHaveLength(0);
    stopping = false;
    stopped.resolve(); await flush();
    expect(h.calls).toHaveLength(1);
    h.completions.shift().resolve(); await request;
    expect(h.cursor()).toBe(1);
});

test('rejects history during unrelated busy work without leaving a delayed command', async () => {
    const h = harness();
    h.session.canUndo = () => false;
    await expect(h.queue.request('undo')).resolves.toBeNull();
    h.session.canUndo = () => true;
    await flush();
    expect(h.calls).toEqual([]);
    expect(h.onActiveChange).not.toHaveBeenCalled();
});

test.each(['detach', 'invalidate'])('never starts queued edits after %s during preparation', async action => {
    const preparation = deferred();
    const h = harness({prepare: () => preparation.promise});
    const first = h.queue.request('undo');
    const second = h.queue.request('redo');
    if (action === 'detach') h.queue.detach();
    else h.invalidate();
    preparation.resolve();
    await Promise.all([first, second]);
    expect(h.calls).toEqual([]);
    await expect(h.queue.request('undo')).resolves.toBeNull();
});

test('clamps excess requests at boundaries without losing a following reversal', async () => {
    const h = harness({cursor: 1});
    const requests = ['undo', 'undo', 'undo', 'redo'].map(direction => h.queue.request(direction));
    h.completions.shift().resolve(); await flush();
    expect(h.calls.map(call => call.direction)).toEqual(['undo', 'redo']);
    h.completions.shift().resolve(); await Promise.all(requests);
    expect(h.cursor()).toBe(1);
});
