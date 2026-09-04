const EDITOR_SCRIPT_PATTERN = /(?:^|\/)js\/editor\.js\?([^&#"']+)/;
const DEFAULT_CHECK_INTERVAL_MS = 1500;

const buildIdFromScriptUrls = urls => {
    for (const url of urls || []) {
        const match = String(url).match(EDITOR_SCRIPT_PATTERN);
        if (match) return match[1];
    }
    return null;
};

const buildIdFromDocument = documentObject => buildIdFromScriptUrls(
    Array.from((documentObject && documentObject.scripts) || []).map(script => script.src)
);

const buildIdFromHtml = html => {
    const match = String(html || '').match(EDITOR_SCRIPT_PATTERN);
    return match ? match[1] : null;
};

const buildIdFromBuildPage = text => {
    const value = String(text || '').trim();
    const bodyMatch = value.match(/<body>([^<]+)<\/body>/i);
    return (bodyMatch ? bodyMatch[1] : value).trim() || null;
};

const loadBuildId = (url, documentObject, windowObject, fetchObject) => {
    if (typeof fetchObject === 'function') {
        return fetchObject(url, {cache: 'no-store'}).then(response => {
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return response.text().then(text => text.trim() || null);
        });
    }
    return new Promise((resolve, reject) => {
        const frame = documentObject.createElement('iframe');
        frame.style.display = 'none';
        const remove = () => {
            if (frame.parentNode) frame.parentNode.removeChild(frame);
        };
        const timer = windowObject.setTimeout(() => {
            remove();
            reject(new Error('Studio build request timed out'));
        }, 5000);
        frame.onload = () => {
            windowObject.clearTimeout(timer);
            try {
                const buildId = frame.contentDocument.body.textContent.trim();
                remove();
                resolve(buildId || null);
            } catch (error) {
                remove();
                reject(error);
            }
        };
        frame.onerror = () => {
            windowObject.clearTimeout(timer);
            remove();
            reject(new Error('Studio build request failed'));
        };
        frame.src = url;
        documentObject.body.appendChild(frame);
    });
};

const createStudioBuildFreshness = ({
    documentObject = document,
    windowObject = window,
    fetchObject = typeof windowObject.fetch === 'function' ? windowObject.fetch.bind(windowObject) : null,
    intervalMs = DEFAULT_CHECK_INTERVAL_MS
} = {}) => {
    const loadedBuildId = buildIdFromDocument(documentObject);
    const buildIdUrl = new URL('/studio-build-id.html', windowObject.location.href);
    let listener = null;
    let timer = null;
    let pending = null;

    const check = () => {
        if (pending) return pending;
        pending = (async () => {
            if (!loadedBuildId) {
                return {status: 'unavailable', loadedBuildId, currentBuildId: null};
            }
            buildIdUrl.search = `studio-freshness=${Date.now()}`;
            try {
                const currentBuildId = buildIdFromBuildPage(await loadBuildId(
                    buildIdUrl.href,
                    documentObject,
                    windowObject,
                    fetchObject
                ));
                if (!currentBuildId) {
                    return {status: 'unavailable', loadedBuildId, currentBuildId: null};
                }
                return {
                    status: currentBuildId === loadedBuildId ? 'current' : 'stale',
                    loadedBuildId,
                    currentBuildId
                };
            } catch (error) {
                return {
                    status: 'unavailable',
                    loadedBuildId,
                    currentBuildId: null,
                    message: error.message
                };
            }
        })().finally(() => {
            pending = null;
        });
        return pending;
    };

    const notify = () => check().then(result => {
        if (listener) listener(result);
        return result;
    });
    const onFocus = () => void notify();
    const onVisibility = () => {
        if (!documentObject.hidden) void notify();
    };

    return {
        loadedBuildId,
        check,
        watch: callback => {
            listener = callback;
            windowObject.addEventListener('focus', onFocus);
            documentObject.addEventListener('visibilitychange', onVisibility);
            timer = windowObject.setInterval(notify, intervalMs);
            return () => {
                listener = null;
                windowObject.removeEventListener('focus', onFocus);
                documentObject.removeEventListener('visibilitychange', onVisibility);
                if (timer !== null) windowObject.clearInterval(timer);
                timer = null;
            };
        }
    };
};

export {
    DEFAULT_CHECK_INTERVAL_MS,
    buildIdFromDocument,
    buildIdFromHtml,
    buildIdFromScriptUrls,
    createStudioBuildFreshness
};
