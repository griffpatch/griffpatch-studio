import {
    attachStudioProjectEditSessionController,
    beginStudioProjectEditSession,
    createStudioProjectEditSessionController,
    endStudioProjectEditSession,
    runStudioProjectEditMutation
} from '../../src/studio/bridge/project-edit-session';

const makeController = ({beforeCapture, completeOperation} = {}) => {
    const order = [];
    const captures = [];
    const controller = createStudioProjectEditSessionController({
        beforeCapture: beforeCapture || (() => {
            order.push('before');
        }),
        captureOperation: async (operation, invoke, complete) => {
            order.push(`capture:${operation.targetId}`);
            const result = await invoke();
            order.push(`closed:${operation.targetId}`);
            const metadata = await complete(result);
            captures.push({operation, metadata});
            return metadata;
        },
        completeOperation: completeOperation || (operation => ({editedTargetId: operation.targetId}))
    });
    return {captures, controller, order};
};

test('coalesces serial editor mutations into one operation which closes after the final mutation', async () => {
    const {captures, controller, order} = makeController();
    const operation = {type: 'costume-edit-session', targetId: 'sprite-a'};
    const token = controller.begin(operation);
    const first = controller.mutate(token, async () => {
        order.push('mutate:first');
    });
    const second = controller.mutate(token, async () => {
        order.push('mutate:second');
    });

    await Promise.all([first, second, controller.end(token)]);

    expect(order).toEqual([
        'before',
        'capture:sprite-a',
        'mutate:first',
        'mutate:second',
        'closed:sprite-a'
    ]);
    expect(captures).toEqual([{
        operation,
        metadata: {editedTargetId: 'sprite-a'}
    }]);
    expect(controller.hasOpen()).toBe(false);
});

test('serializes a new target session after the previous target boundary', async () => {
    const {controller, order} = makeController();
    const firstToken = controller.begin({type: 'costume-edit-session', targetId: 'sprite-a'});
    const firstMutation = controller.mutate(firstToken, () => {
        order.push('mutate:sprite-a');
    });
    const secondToken = controller.begin({type: 'costume-edit-session', targetId: 'sprite-b'});
    const secondMutation = controller.mutate(secondToken, () => {
        order.push('mutate:sprite-b');
    });

    await Promise.all([firstMutation, secondMutation, controller.end(secondToken)]);

    expect(order).toEqual([
        'before',
        'capture:sprite-a',
        'mutate:sprite-a',
        'closed:sprite-a',
        'before',
        'capture:sprite-b',
        'mutate:sprite-b',
        'closed:sprite-b'
    ]);
});

test('rejects queued mutations promptly when the before-boundary cannot be captured', async () => {
    const failure = new Error('checkpoint unavailable');
    const {controller} = makeController({beforeCapture: () => Promise.reject(failure)});
    const token = controller.begin({type: 'backdrop-edit-session', targetId: 'stage'});
    const mutate = jest.fn();
    const mutation = controller.mutate(token, mutate);
    const finish = controller.end(token);

    await expect(mutation).rejects.toBe(failure);
    await expect(finish).rejects.toBe(failure);
    expect(mutate).not.toHaveBeenCalled();
    expect(controller.hasOpen()).toBe(false);
});

test('holds queued editor mutations behind a deferred Studio history boundary', async () => {
    let releaseBoundary;
    const boundary = new Promise(resolve => {
        releaseBoundary = resolve;
    });
    const {controller, order} = makeController({beforeCapture: () => boundary});
    const token = controller.begin({type: 'costume-edit-session', targetId: 'sprite-a'});
    const mutation = controller.mutate(token, () => {
        order.push('mutate:after-history');
    });
    const finish = controller.end(token);

    await Promise.resolve();
    await Promise.resolve();
    expect(order).toEqual([]);

    releaseBoundary();
    await Promise.all([mutation, finish]);
    expect(order).toEqual([
        'capture:sprite-a',
        'mutate:after-history',
        'closed:sprite-a'
    ]);
});

test('propagates a failed mutation through the capture so the checkpoint owner can roll it back', async () => {
    const failure = new Error('paint update failed');
    const captureFailure = jest.fn();
    const controller = createStudioProjectEditSessionController({
        captureOperation: async (operation, invoke) => {
            try {
                await invoke();
            } catch (error) {
                captureFailure(error);
                throw error;
            }
        }
    });
    const token = controller.begin({type: 'costume-edit-session', targetId: 'sprite-a'});
    const mutation = controller.mutate(token, () => Promise.reject(failure));
    const finish = controller.end(token);

    await expect(mutation).rejects.toBe(failure);
    await expect(finish).rejects.toBe(failure);
    expect(captureFailure).toHaveBeenCalledWith(failure);
});

test('does not run a stale mutation after its editor session has begun closing', async () => {
    const {controller} = makeController();
    const token = controller.begin({type: 'costume-edit-session', targetId: 'sprite-a'});
    const finish = controller.end(token);
    const staleMutation = jest.fn();

    await controller.mutate(token, staleMutation);
    await finish;

    expect(staleMutation).not.toHaveBeenCalled();
});

test('registry routes live editor calls to its VM controller and falls back cleanly after detach', async () => {
    const vm = {};
    const {controller, order} = makeController();
    const attachment = attachStudioProjectEditSessionController(vm, controller);
    const token = beginStudioProjectEditSession(vm, {
        type: 'costume-edit-session',
        targetId: 'sprite-a'
    });

    await runStudioProjectEditMutation(vm, token, () => {
        order.push('registry-mutation');
    });
    await endStudioProjectEditSession(vm, token);
    attachment.detach();
    await runStudioProjectEditMutation(vm, token, () => {
        order.push('fallback-mutation');
    });

    expect(order).toContain('registry-mutation');
    expect(order).toContain('fallback-mutation');
    expect(beginStudioProjectEditSession(vm, {targetId: 'sprite-a'})).toBeNull();
});
