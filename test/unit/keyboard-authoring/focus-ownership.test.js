import {JSDOM} from 'jsdom';
import {isTextInput, keyOwner, canReturnFocus, createFocusReturn} from
    '../../../src/experiments/keyboard-authoring/focus-ownership';

let document;
let dom;
beforeEach(() => {
    dom = new JSDOM('<!doctype html><body></body>');
    document = dom.window.document;
});
afterEach(() => dom.window.close());

const fixture = () => {
    document.body.innerHTML = '<div id="surface"></div><input id="composer">' +
        '<div class="blocklyWidgetDiv"><input id="field"></div>' +
        '<div class="blocklyDropDownDiv"><button id="menu">Item</button></div>' +
        '<input class="sa-find-input" id="finder"><button id="sprite">Sprite</button>';
    const get = id => document.getElementById(id);
    return {get, context: {surface: get('surface'), input: get('composer'), body: document.body,
        editingField: true, pendingNavigation: true}};
};

test.each([
    ['surface', 'surface'], ['composer', 'composer'], ['field', 'native'], ['menu', 'native'],
    ['finder', 'external'], ['sprite', 'external']
])('event target %s is owned by %s even during a sprite handoff', (id, expected) => {
    const {get, context} = fixture();
    expect(keyOwner(get(id), context)).toBe(expected);
});

test('body requires a pending navigation and native UI requires an active native edit', () => {
    const {get, context} = fixture();
    expect(keyOwner(document.body, context)).toBe('navigation');
    expect(keyOwner(document.body, {...context, pendingNavigation: false})).toBe('external');
    expect(keyOwner(get('field'), {...context, editingField: false})).toBe('external');
    expect(keyOwner(null, context)).toBe('external');
});

test('a native return accepts the temporary body/native owner but never Finder or sprite controls', () => {
    const {get, context} = fixture();
    const workspaceSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    expect(canReturnFocus(workspaceSvg, {...context, workspaceSvg})).toBe(true);
    expect(canReturnFocus(document.createElementNS('http://www.w3.org/2000/svg', 'svg'),
        {...context, workspaceSvg})).toBe(false);
    for (const element of [document.body, get('surface'), get('field'), get('menu')]) {
        expect(canReturnFocus(element, context)).toBe(true);
    }
    for (const element of [get('composer'), get('finder'), get('sprite'), null]) {
        expect(canReturnFocus(element, context)).toBe(false);
    }
});

test.each(['INPUT', 'TEXTAREA', 'SELECT'])('native %s retains text key ownership', tagName => {
    expect(isTextInput({tagName})).toBe(true);
});

test('contenteditable is a text owner; ordinary buttons and missing targets are not', () => {
    expect(isTextInput({tagName: 'DIV', isContentEditable: true})).toBe(true);
    expect(isTextInput({tagName: 'BUTTON'})).toBe(false);
    expect(isTextInput(null)).toBe(false);
});

const returns = () => {
    const frames = [];
    let current = {request: 1, target: 'sprite1', available: true};
    const restore = jest.fn();
    const controller = createFocusReturn({
        capture: () => ({...current}),
        isCurrent: saved => current.available && saved.request === current.request && saved.target === current.target,
        restore,
        requestFrame: callback => frames.push(callback)
    });
    return {controller, restore, flush: () => frames.splice(0).forEach(frame => frame()),
        change: values => { current = {...current, ...values}; }};
};

test('native completion and frame observation coalesce into a single current return', () => {
    const f = returns();
    f.controller.schedule(); f.controller.schedule();
    expect(f.restore).not.toHaveBeenCalled();
    f.flush();
    expect(f.restore).toHaveBeenCalledTimes(1);
    f.flush();
    expect(f.restore).toHaveBeenCalledTimes(1);
});

test.each([{request: 2}, {target: 'sprite2'}, {available: false}])(
    'delayed return yields when its current context changes to %j', changed => {
        const f = returns();
        f.controller.schedule(); f.change(changed); f.flush();
        expect(f.restore).not.toHaveBeenCalled();
    });

test('cancellation fences callbacks after detach or mode changes without blocking a later return', () => {
    const f = returns();
    f.controller.schedule(); f.controller.cancel(); f.flush();
    expect(f.restore).not.toHaveBeenCalled();
    f.controller.schedule(); f.flush();
    expect(f.restore).toHaveBeenCalledTimes(1);
});

test('observing native close consumes the pending return in this frame, without a second focus', () => {
    const f = returns();
    f.controller.schedule();
    f.controller.finish();
    expect(f.restore).toHaveBeenCalledTimes(1);
    f.flush();
    expect(f.restore).toHaveBeenCalledTimes(1);
});

test('native close observation does not refresh a stale pending request', () => {
    const f = returns();
    f.controller.schedule(); f.change({request: 2}); f.controller.finish(); f.flush();
    expect(f.restore).not.toHaveBeenCalled();
});
