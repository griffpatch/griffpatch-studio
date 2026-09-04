import {createScratchBlocksCommentDriver} from '../../src/studio/bridge/native-interaction/scratch-blocks-comment-driver';

const rect = {left: 100, top: 80, width: 120, height: 40, right: 220, bottom: 120};

class FakeEvent {
    constructor (type, options = {}) {
        this.type = type;
        Object.assign(this, options);
    }
}

class FakeElement {
    constructor (tagName, ownerDocument) {
        this.tagName = tagName;
        this.ownerDocument = ownerDocument;
        this.children = [];
        this.listeners = new Map();
        this.className = '';
        this.textContent = '';
        this.value = '';
    }

    appendChild (child) {
        this.children.push(child);
        return child;
    }

    replaceChildren (...children) {
        this.children = children;
    }

    addEventListener (type, listener) {
        this.listeners.set(type, [...(this.listeners.get(type) || []), listener]);
    }

    dispatchEvent (event) {
        (this.listeners.get(event.type) || []).forEach(listener => listener(event));
        if (event.bubbles) this.ownerDocument.dispatchEvent(event);
        return true;
    }

    focus () {
        this.ownerDocument.activeElement = this;
    }

    querySelectorAll (selector) {
        const matches = [];
        const visit = element => {
            if (selector === '.goog-menuitem' && element.className.split(' ').includes('goog-menuitem')) {
                matches.push(element);
            }
            element.children.forEach(visit);
        };
        this.children.forEach(visit);
        return matches;
    }
}

const makeDocument = () => {
    const listeners = new Map();
    const documentObject = {
        activeElement: null,
        defaultView: {
            Event: FakeEvent,
            InputEvent: FakeEvent,
            MouseEvent: FakeEvent,
            requestAnimationFrame: callback => callback()
        },
        addEventListener: (type, listener) => {
            listeners.set(type, [...(listeners.get(type) || []), listener]);
        },
        removeEventListener: (type, listener) => {
            listeners.set(type, (listeners.get(type) || []).filter(item => item !== listener));
        },
        dispatchEvent: event => {
            (listeners.get(event.type) || []).slice().forEach(listener => listener(event));
            return true;
        }
    };
    documentObject.body = new FakeElement('body', documentObject);
    documentObject.createElement = tagName => new FakeElement(tagName, documentObject);
    return documentObject;
};

const makeHarness = () => {
    const documentObject = makeDocument();
    const comments = new Map();
    const root = documentObject.createElement('g');
    root.getBoundingClientRect = () => rect;
    const background = documentObject.createElement('rect');
    background.getBoundingClientRect = () => ({left: 40, top: 30, width: 800, height: 600});
    const injection = documentObject.createElement('div');
    injection.getBoundingClientRect = () => ({left: 20, top: 10, width: 900, height: 700});
    const block = {
        id: 'live-block',
        type: 'looks_say',
        comment: null,
        getSvgRoot: () => root
    };
    const menu = documentObject.createElement('div');
    const ScratchBlocks = {
        Msg: {ADD_COMMENT: 'Add Comment', REMOVE_COMMENT: 'Remove Comment'},
        WidgetDiv: {DIV: menu},
        ContextMenu: {hide: jest.fn()},
        utils: {genUid: jest.fn(() => 'generated-comment')}
    };
    const makeComment = (id, text = '', {
        attached = true,
        initialSize = {width: attached ? 160 : 200, height: attached ? 120 : 200},
        initialCoordinate = {x: 200, y: 150}
    } = {}) => {
        const textarea = documentObject.createElement('textarea');
        textarea.value = text;
        textarea.getBoundingClientRect = () => ({left: 130, top: 130, width: 180, height: 90});
        documentObject.body.appendChild(textarea);
        const arrow = documentObject.createElement('image');
        const resize = documentObject.createElement('g');
        const topBar = documentObject.createElement('rect');
        const deleteIcon = documentObject.createElement('image');
        let minimized = false;
        let size = {...initialSize};
        let coordinate = {...initialCoordinate};
        arrow.getBoundingClientRect = () => ({left: 200, top: 150, width: 32, height: 32});
        resize.getBoundingClientRect = () => minimized ?
            ({left: 0, top: 0, width: 0, height: 0}) :
            ({left: 344, top: 254, width: 16, height: 16});
        topBar.getBoundingClientRect = () => ({
            left: coordinate.x,
            top: coordinate.y,
            width: minimized ? 120 : size.width,
            height: 32
        });
        deleteIcon.getBoundingClientRect = () => ({
            left: coordinate.x + size.width - 32,
            top: coordinate.y,
            width: 32,
            height: 32
        });
        const comment = {
            id,
            blockId: attached ? block.id : null,
            textarea_: textarea,
            text,
            ...(attached ? {bubble_: {
                minimizeArrow_: arrow,
                resizeGroup_: resize,
                commentTopBar_: topBar
            }} : {
                minimizeArrow_: arrow,
                resizeGroup_: resize,
                svgHandleTarget_: topBar,
                deleteIcon_: deleteIcon
            }),
            getText () {
                return this.text;
            },
            isMinimized () {
                return minimized;
            },
            getHeightWidth () {
                return {...size};
            },
            getXY () {
                return {...coordinate};
            }
        };
        Object.defineProperty(comment, 'isMinimized_', {
            get: () => minimized,
            set: value => {
                minimized = Boolean(value);
            }
        });
        textarea.addEventListener('change', () => {
            comment.text = textarea.value;
        });
        let togglePending = false;
        arrow.addEventListener('mousedown', () => {
            togglePending = true;
        });
        arrow.addEventListener('mouseup', () => {
            if (togglePending) minimized = !minimized;
            togglePending = false;
        });
        let deletePending = false;
        deleteIcon.addEventListener('mousedown', () => {
            deletePending = true;
        });
        deleteIcon.addEventListener('mouseup', () => {
            if (deletePending) comments.delete(comment.id);
            deletePending = false;
        });
        resize.addEventListener('mousedown', event => {
            const start = {x: event.clientX, y: event.clientY};
            const source = {...size};
            const move = moveEvent => {
                size = {
                    width: source.width + ((moveEvent.clientX - start.x) / 2),
                    height: source.height + ((moveEvent.clientY - start.y) / 2)
                };
            };
            const up = () => {
                documentObject.removeEventListener('mousemove', move);
                documentObject.removeEventListener('mouseup', up);
            };
            documentObject.addEventListener('mousemove', move);
            documentObject.addEventListener('mouseup', up);
        });
        topBar.addEventListener('mousedown', event => {
            const start = {x: event.clientX, y: event.clientY};
            const source = {...coordinate};
            const move = moveEvent => {
                coordinate = {
                    x: source.x + ((moveEvent.clientX - start.x) / 2),
                    y: source.y + ((moveEvent.clientY - start.y) / 2)
                };
            };
            const up = () => {
                documentObject.removeEventListener('mousemove', move);
                documentObject.removeEventListener('mouseup', up);
            };
            documentObject.addEventListener('mousemove', move);
            documentObject.addEventListener('mouseup', up);
        });
        if (attached) block.comment = comment;
        comments.set(id, comment);
        return comment;
    };
    block.showContextMenu_ = () => {
        menu.replaceChildren();
        const option = documentObject.createElement('div');
        option.className = 'goog-menuitem';
        option.textContent = block.comment ? ScratchBlocks.Msg.REMOVE_COMMENT : ScratchBlocks.Msg.ADD_COMMENT;
        option.getBoundingClientRect = () => ({left: 230, top: 90, width: 100, height: 28});
        option.addEventListener('click', () => {
            if (block.comment) {
                comments.delete(block.comment.id);
                block.comment = null;
            } else {
                makeComment(ScratchBlocks.utils.genUid(), '');
            }
        });
        menu.appendChild(option);
    };
    root.addEventListener('mousedown', event => {
        if (event.button === 2) block.showContextMenu_(event);
    });
    const workspace = {
        scale: 2,
        RTL: false,
        svgBackground_: background,
        getInjectionDiv: () => injection,
        getOriginOffsetInPixels: () => ({x: 60, y: 40}),
        getBlockById: id => id === block.id ? block : null,
        getCommentById: id => comments.get(id) || null,
        getAllBlocks: () => [block]
    };
    background.addEventListener('mousedown', event => {
        if (event.button !== 2) return;
        menu.replaceChildren();
        const option = documentObject.createElement('div');
        option.className = 'goog-menuitem';
        option.textContent = ScratchBlocks.Msg.ADD_COMMENT;
        option.getBoundingClientRect = () => ({left: 230, top: 90, width: 100, height: 28});
        option.addEventListener('click', () => makeComment(ScratchBlocks.utils.genUid(), '', {
            attached: false,
            initialCoordinate: {
                x: (event.clientX - 20 - 60) / workspace.scale,
                y: (event.clientY - 10 - 40) / workspace.scale
            }
        }));
        menu.appendChild(option);
    });
    let pointerPosition = null;
    const pointer = {
        travelTo: jest.fn(async (target, options = {}) => {
            const element = target.locate();
            const bounds = element.getBoundingClientRect();
            const anchor = (start, length, value) => start + (typeof value === 'number' ?
                value : value === 'start' ? 0 : value === 'end' ? length : length / 2);
            const point = {
                x: anchor(bounds.left, bounds.width, target.anchorX) + (target.offsetX || 0),
                y: anchor(bounds.top, bounds.height, target.anchorY) + (target.offsetY || 0)
            };
            pointerPosition = point;
            if (options.onFrame) options.onFrame(point, 0);
            return {
                completed: true,
                frames: [point],
                model: 'natural',
                target: {...target, point, element}
            };
        }),
        click: jest.fn(activate => {
            activate();
            return true;
        }),
        hide: jest.fn(),
        show: jest.fn(),
        press: jest.fn(),
        release: jest.fn(),
        getPosition: () => pointerPosition || {x: 150, y: 100}
    };
    const clock = {
        play: jest.fn(({points, onFrame}) => {
            points.forEach((point, index) => onFrame && onFrame(point, index));
            return Promise.resolve(true);
        })
    };
    const scope = {runWithoutUndo: callback => callback()};
    const driver = createScratchBlocksCommentDriver({
        workspace,
        ScratchBlocks,
        documentObject,
        clock,
        pointer,
        scope,
        aliases: new Map([['recorded-block', 'live-block']])
    });
    return {block, comments, driver, makeComment, pointer, ScratchBlocks, workspace};
};

const plan = (kind, fields = {}) => ({
    kind,
    blockId: 'recorded-block',
    blockType: 'looks_say',
    commentId: 'comment-1',
    ...fields
});

test('creates and deletes the exact block-owned comment through the context menu', async () => {
    const harness = makeHarness();
    const created = await harness.driver.play(plan('block-comment-create', {text: ''}));

    expect(created).toMatchObject({commentMatches: true, resolvedBlockId: 'live-block'});
    expect(harness.block.comment).toMatchObject({id: 'comment-1', blockId: 'live-block'});
    expect(harness.ScratchBlocks.utils.genUid).toHaveBeenCalledTimes(0);

    const deleted = await harness.driver.play(plan('block-comment-delete'));
    expect(deleted).toMatchObject({commentMatches: true, resolvedBlockId: 'live-block'});
    expect(harness.block.comment).toBeNull();
    expect(harness.comments.has('comment-1')).toBe(false);
});

test('types without a redundant pointer click when the comment textarea already has focus', async () => {
    const harness = makeHarness();
    const comment = harness.makeComment('comment-1', 'before');
    comment.textarea_.focus();

    const result = await harness.driver.play(plan('block-comment-text', {
        sourceText: 'before',
        text: 'after'
    }));

    expect(result).toMatchObject({
        commentMatches: true,
        intermediateValues: ['a', 'af', 'aft', 'afte', 'after']
    });
    expect(harness.pointer.travelTo).not.toHaveBeenCalled();
    expect(harness.pointer.click).not.toHaveBeenCalled();
    expect(comment.getText()).toBe('after');
});

test('toggles minimize through the rendered arrow control', async () => {
    const harness = makeHarness();
    const comment = harness.makeComment('comment-1');

    const minimized = await harness.driver.play(plan('block-comment-minimize', {
        sourceMinimized: false,
        minimized: true
    }));

    expect(minimized).toMatchObject({commentMatches: true, controlsVisible: true});
    expect(comment.isMinimized_).toBe(true);
    expect(harness.pointer.click).toHaveBeenCalledTimes(1);
});

test('resizes through the native corner drag at workspace scale', async () => {
    const harness = makeHarness();
    const comment = harness.makeComment('comment-1');

    const resized = await harness.driver.play(plan('block-comment-resize', {
        sourceSize: {width: 160, height: 120},
        size: {width: 220, height: 170}
    }));

    expect(resized).toMatchObject({commentMatches: true, controlsVisible: true});
    expect(comment.getHeightWidth()).toEqual({width: 220, height: 170});
    expect(harness.pointer.press).toHaveBeenCalledTimes(1);
    expect(harness.pointer.release).toHaveBeenCalledTimes(1);
});

test('moves through the native comment top-bar gesture at workspace scale', async () => {
    const harness = makeHarness();
    const comment = harness.makeComment('comment-1');

    const moved = await harness.driver.play(plan('block-comment-move', {
        source: {x: 200, y: 150},
        destination: {x: 260, y: 210}
    }));

    expect(moved).toMatchObject({commentMatches: true, controlsVisible: true});
    expect(comment.getXY()).toEqual({x: 260, y: 210});
    expect(harness.pointer.press).toHaveBeenCalledTimes(1);
    expect(harness.pointer.release).toHaveBeenCalledTimes(1);
});

test('drives the complete workspace-comment lifecycle through workspace controls', async () => {
    const harness = makeHarness();
    const created = await harness.driver.play(plan('workspace-comment-create', {
        commentOwner: 'workspace',
        coordinate: {x: 180, y: 120},
        size: {width: 200, height: 200},
        minimized: false
    }));
    expect(created).toMatchObject({
        commentMatches: true,
        resolvedBlockId: null,
        menuVisibleBeforeClick: true
    });
    const comment = harness.comments.get('comment-1');
    expect(comment).toBeTruthy();
    expect(comment.blockId).toBeNull();
    expect(comment.getXY()).toEqual({x: 180, y: 120});

    const typed = await harness.driver.play(plan('workspace-comment-text', {
        commentOwner: 'workspace',
        sourceText: '',
        text: 'Scene note'
    }));
    expect(typed).toMatchObject({commentMatches: true});
    expect(comment.getText()).toBe('Scene note');

    const resized = await harness.driver.play(plan('workspace-comment-resize', {
        commentOwner: 'workspace',
        sourceSize: {width: 200, height: 200},
        size: {width: 260, height: 240}
    }));
    expect(resized).toMatchObject({commentMatches: true});
    expect(comment.getHeightWidth()).toEqual({width: 260, height: 240});

    const minimized = await harness.driver.play(plan('workspace-comment-minimize', {
        commentOwner: 'workspace',
        sourceMinimized: false,
        minimized: true
    }));
    expect(minimized).toMatchObject({commentMatches: true});
    expect(comment.isMinimized()).toBe(true);

    await harness.driver.play(plan('workspace-comment-minimize', {
        commentOwner: 'workspace',
        sourceMinimized: true,
        minimized: false
    }));
    const moved = await harness.driver.play(plan('workspace-comment-move', {
        commentOwner: 'workspace',
        source: {x: 180, y: 120},
        destination: {x: 240, y: 180}
    }));
    expect(moved).toMatchObject({commentMatches: true});
    expect(comment.getXY()).toEqual({x: 240, y: 180});

    const deleted = await harness.driver.play(plan('workspace-comment-delete', {
        commentOwner: 'workspace'
    }));
    expect(deleted).toMatchObject({commentMatches: true, resolvedBlockId: null});
    expect(harness.comments.has('comment-1')).toBe(false);
});

test('refuses to mutate a reused comment ID attached to another block', async () => {
    const harness = makeHarness();
    const comment = harness.makeComment('comment-1', 'before');
    comment.blockId = 'other-block';

    await expect(harness.driver.play(plan('block-comment-text', {
        sourceText: 'before',
        text: 'after'
    }))).rejects.toThrow('Comment does not belong to playback block');
    expect(harness.pointer.travelTo).not.toHaveBeenCalled();
    expect(comment.getText()).toBe('before');
});
