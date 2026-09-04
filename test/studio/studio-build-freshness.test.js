import {
    buildIdFromDocument,
    buildIdFromHtml,
    createStudioBuildFreshness
} from '../../src/studio/bridge/studio-build-freshness';

const makeEnvironment = loadedBuildId => {
    const listeners = new Map();
    const documentObject = {
        hidden: false,
        scripts: [{src: `http://127.0.0.1:8601/js/editor.js?${loadedBuildId}`}],
        addEventListener: (event, listener) => listeners.set(event, listener),
        removeEventListener: (event, listener) => {
            if (listeners.get(event) === listener) listeners.delete(event);
        }
    };
    const windowObject = {
        location: {href: 'http://127.0.0.1:8601/editor.html?studio-session=1'},
        addEventListener: (event, listener) => listeners.set(event, listener),
        removeEventListener: (event, listener) => {
            if (listeners.get(event) === listener) listeners.delete(event);
        },
        setInterval: jest.fn(() => 17),
        clearInterval: jest.fn(),
        setTimeout: jest.fn(() => 23),
        clearTimeout: jest.fn()
    };
    return {documentObject, listeners, windowObject};
};

test('extracts the real compilation fingerprint instead of trusting the URL label', () => {
    expect(buildIdFromDocument({scripts: [{src: '/js/editor.js?loaded-123'}]})).toBe('loaded-123');
    expect(buildIdFromHtml('<script src="/js/editor.js?current-456"></script>')).toBe('current-456');
});

test.each([
    ['current', 'build-a'],
    ['stale', 'build-b']
])('reports a %s loaded build against fresh editor HTML', async (status, currentBuildId) => {
    const environment = makeEnvironment('build-a');
    const fetchObject = jest.fn(() => Promise.resolve({
        ok: true,
        text: () => Promise.resolve(currentBuildId)
    }));
    const freshness = createStudioBuildFreshness({...environment, fetchObject});

    await expect(freshness.check()).resolves.toEqual({
        status,
        loadedBuildId: 'build-a',
        currentBuildId
    });
    expect(fetchObject).toHaveBeenCalledWith(
        expect.stringContaining('/studio-build-id.html?studio-freshness='),
        {cache: 'no-store'}
    );
});

test('extracts a build ID when the build page is exposed as plain text', async () => {
    const environment = makeEnvironment('build-a');
    const freshness = createStudioBuildFreshness({
        ...environment,
        fetchObject: () => Promise.resolve({
            ok: true,
            text: () => Promise.resolve('<!doctype html><body>build-a</body>')
        })
    });

    await expect(freshness.check()).resolves.toMatchObject({
        status: 'current',
        currentBuildId: 'build-a'
    });
});

test('fails closed when the current compilation fingerprint cannot be verified', async () => {
    const environment = makeEnvironment('build-a');
    const freshness = createStudioBuildFreshness({
        ...environment,
        fetchObject: () => Promise.reject(new Error('server unavailable'))
    });

    await expect(freshness.check()).resolves.toMatchObject({
        status: 'unavailable',
        loadedBuildId: 'build-a',
        currentBuildId: null,
        message: 'server unavailable'
    });
});

test('uses a same-origin frame when the editor runtime does not provide request APIs', async () => {
    const environment = makeEnvironment('build-a');
    const frame = {
        style: {},
        contentDocument: {body: {textContent: 'build-a'}},
        parentNode: null
    };
    environment.documentObject.createElement = jest.fn(() => frame);
    environment.documentObject.body = {
        appendChild: jest.fn(child => {
            child.parentNode = environment.documentObject.body;
            child.onload();
        }),
        removeChild: jest.fn(child => {
            child.parentNode = null;
        })
    };
    const freshness = createStudioBuildFreshness({...environment, fetchObject: null});

    await expect(freshness.check()).resolves.toMatchObject({
        status: 'current',
        loadedBuildId: 'build-a',
        currentBuildId: 'build-a'
    });
    expect(frame.src).toContain('/studio-build-id.html?studio-freshness=');
    expect(environment.documentObject.body.appendChild).toHaveBeenCalledWith(frame);
    expect(environment.documentObject.body.removeChild).toHaveBeenCalledWith(frame);
    expect(environment.windowObject.clearTimeout).toHaveBeenCalledWith(23);
});

test('checks again on focus and removes every watcher cleanly', async () => {
    const environment = makeEnvironment('build-a');
    const fetchObject = jest.fn(() => Promise.resolve({
        ok: true,
        text: () => Promise.resolve('build-a')
    }));
    const freshness = createStudioBuildFreshness({...environment, fetchObject});
    const listener = jest.fn();
    const detach = freshness.watch(listener);

    environment.listeners.get('focus')();
    await Promise.resolve();
    await Promise.resolve();
    expect(fetchObject).toHaveBeenCalledTimes(1);

    detach();
    expect(environment.windowObject.clearInterval).toHaveBeenCalledWith(17);
    expect(environment.listeners.size).toBe(0);
});
