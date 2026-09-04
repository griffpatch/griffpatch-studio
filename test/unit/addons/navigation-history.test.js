import EventEmitter from 'events';
import {getNavigationHistory} from '../../../src/addons/libraries/common/cs/navigation-history';
import * as Scrolling from '../../../src/addons/libraries/common/cs/block-scrolling';
import {getScriptContext} from '../../../src/addons/libraries/common/cs/script-context';

jest.mock('../../../src/addons/libraries/common/cs/block-scrolling', () => ({
    animateScrollTo: jest.fn(async (workspace, x, y, current) => {
        if (current()) workspace.scrollbar.set(x, y);
    }),
    scrollPosFromOffset: (view, metrics) => ({sx: view.left - metrics.contentLeft, sy: view.top - metrics.contentTop})
}));

const fixture = () => {
    const vm = new EventEmitter();
    vm.runtime = new EventEmitter();
    const targets = new Map(['a', 'b', 'c'].map(id => [id, {id}]));
    vm.runtime.getTargetById = id => targets.get(id);
    vm.editingTarget = targets.get('a');
    let view = {viewLeft: 0, viewTop: 0, contentLeft: 0, contentTop: 0};
    const workspace = {scale: 1, getMetrics: () => view, resize: jest.fn(),
        setScale: jest.fn(scale => {workspace.scale = scale;}),
        scrollbar: {set: jest.fn((left, top) => { view = {...view, viewLeft: left, viewTop: top}; })}};
    let liveWorkspace = workspace;
    const getWorkspace = () => liveWorkspace;
    const history = getNavigationHistory(vm, getWorkspace);
    let focus = {position: {kind: 'input', blockId: 'move-a', inputName: 'STEPS'}};
    const host = {capture: () => focus,
        destination: ({blockId}) => ({position: {kind: 'block', blockId}}),
        restore: jest.fn(saved => { focus = saved; })};
    history.registerHost(host);
    vm.setEditingTarget = jest.fn(id => {
        vm.editingTarget = targets.get(id);
        vm.emit('targetsUpdate');
        view = {...view, viewLeft: 600, viewTop: 500};
        vm.emit('workspaceUpdate');
    });
    const visit = (id, blockId = `block-${id}`) => {
        const operation = history.beginNavigation(id);
        if (vm.editingTarget.id !== id) vm.setEditingTarget(id);
        history.finishNavigation(operation, {targetId: id, blockId});
        focus = host.destination({blockId});
    };
    return {vm, workspace, history, host, targets, visit,
        setFocus: value => {focus = value;}, getWorkspace,
        replaceWorkspace: value => {liveWorkspace = value;}};
};

describe('shared semantic Finder and Jump history', () => {
    beforeEach(() => {jest.useFakeTimers(); Scrolling.animateScrollTo.mockClear();});
    afterEach(() => {jest.clearAllTimers(); jest.useRealTimers();});

    test('breadcrumb jumps select their ancestor and share exact operand/view return history', async () => {
        const {history, host, workspace} = fixture();
        const ancestor = {id: 'head', select: jest.fn(), getRootBlock: () => ancestor};
        workspace.getBlockById = id => id === 'head' ? ancestor : null;
        const origin = host.capture();
        const scroll = async (ws, block, x, y, instant, current) => {
            expect(block).toBe(ancestor);
            expect(current()).toBe(true);
            ws.scrollbar.set(12, 64);
        };
        expect(await history.navigateToBlock('head', {scroll})).toBe(true);
        expect(ancestor.select).toHaveBeenCalledTimes(1);
        expect(host.capture().position).toEqual({kind: 'block', blockId: 'head'});
        expect(history.entries).toHaveLength(2);
        await history.goBack();
        expect(host.capture()).toEqual(origin);
        expect(workspace.getMetrics().viewTop).toBe(0);
        await history.goForward();
        expect(workspace.getMetrics().viewTop).toBe(64);
        expect(host.capture().position.blockId).toBe('head');
    });

    test.each(['interrupted', 'deleted', 'disabled', 'workspace changed'])(
        'late breadcrumb navigation cannot steal selection after %s', async cause => {
            const {history, host, workspace, replaceWorkspace} = fixture();
            let available = true;
            let exists = true;
            const ancestor = {select: jest.fn()};
            workspace.getBlockById = () => exists ? ancestor : null;
            let finish;
            const pending = history.navigateToBlock('head', {isAvailable: () => available,
                scroll: () => new Promise(resolve => {finish = resolve;})});
            if (cause === 'interrupted') history.interrupt();
            if (cause === 'deleted') exists = false;
            if (cause === 'disabled') available = false;
            if (cause === 'workspace changed') replaceWorkspace({...workspace});
            finish();
            expect(await pending).toBe(false);
            expect(ancestor.select).not.toHaveBeenCalled();
            expect(host.restore).not.toHaveBeenCalled();
            expect(history.entries).toHaveLength(0);
            expect(history.programmatic).toBe(0);
        }
    );

    test('camera-only navigation retains the exact input at both ends of one return journey', async () => {
        const {history, host, workspace} = fixture();
        const origin = host.capture();
        const operation = history.beginNavigation('a');
        workspace.scrollbar.set(300, 500);
        expect(history.finishNavigation(operation)).toBe(true);
        expect(history.entries).toHaveLength(2);
        expect(history.entries.map(entry => entry.focus)).toEqual([origin, origin]);
        await history.goBack();
        expect(workspace.getMetrics().viewLeft).toBe(0);
        expect(host.capture()).toEqual(origin);
        await history.goForward();
        expect(workspace.getMetrics().viewTop).toBe(500);
        expect(host.capture()).toEqual(origin);
    });

    test('both clients share one owner and one workspace hook regardless of registration order', () => {
        const {vm, workspace, history, getWorkspace} = fixture();
        const hook = workspace.scrollbar.set;
        expect(getNavigationHistory(vm, getWorkspace)).toBe(history);
        expect(workspace.scrollbar.set).toBe(hook);
        expect(vm.listenerCount('workspaceUpdate')).toBe(1);
        expect(vm.runtime.listenerCount('PROJECT_LOADED')).toBe(1);
        expect(getNavigationHistory(new EventEmitter(), getWorkspace)).not.toBe(history);
    });

    test('same-frame definition and Back restore the exact operand, then Forward restores the destination', async () => {
        const {history, host, visit} = fixture();
        const origin = host.capture();
        visit('a', 'definition');
        expect(history.entries).toHaveLength(2);
        await history.goBack();
        expect(host.restore).toHaveBeenLastCalledWith(origin, expect.any(Object));
        await history.goForward();
        expect(host.restore).toHaveBeenLastCalledWith({position: {kind: 'block', blockId: 'definition'}}, expect.any(Object));
    });

    test('local caret moves update departure but are not extra Back stops', async () => {
        const {history, host, visit, setFocus} = fixture();
        const origin = host.capture();
        visit('a', 'definition');
        const operand = {position: {kind: 'input', blockId: 'definition', inputName: 'ARG'}};
        setFocus(operand);
        await history.goBack();
        expect(host.capture()).toEqual(origin);
        await history.goForward();
        expect(host.capture()).toEqual(operand);
        expect(history.entries).toHaveLength(2);
    });

    test('cross-sprite Back/Forward retain target IDs and native camera scale', async () => {
        const {history, vm, workspace, visit, host} = fixture();
        workspace.scale = 1.5;
        const origin = history.capture();
        visit('b');
        workspace.scale = .75;
        await history.goBack();
        expect(vm.editingTarget.id).toBe('a');
        expect(workspace.scale).toBe(1.5);
        expect(workspace.getMetrics().viewLeft).toBe(origin.view.left);
        expect(host.capture()).toEqual(origin.focus);
        await history.goForward();
        expect(vm.editingTarget.id).toBe('b');
        expect(workspace.scale).toBe(.75);
    });

    test('a manual target switch captures before native workspace replacement', async () => {
        const {history, vm, workspace} = fixture();
        vm.setEditingTarget('b');
        jest.runOnlyPendingTimers();
        expect(history.entries.map(entry => entry.targetId)).toEqual(['a', 'b']);
        expect(history.entries[0].view.left).toBe(0);
        expect(history.entries[1].view.left).toBe(600);
        await history.goBack();
        expect(workspace.getMetrics().viewLeft).toBe(0);
    });

    test('search previews coalesce into a single accepted journey', async () => {
        const {history, host, visit} = fixture();
        const origin = host.capture();
        history.beginExploration();
        visit('b'); visit('c'); visit('b', 'last');
        expect(history.entries).toHaveLength(0);
        history.commitExploration();
        expect(history.entries.map(entry => entry.targetId)).toEqual(['a', 'b']);
        await history.goBack();
        expect(host.capture()).toEqual(origin);
    });

    test('Enter before the last preview settles commits the original search origin', async () => {
        const {history, vm, host} = fixture();
        const origin = host.capture();
        history.beginExploration();
        const pending = history.beginNavigation('b');
        vm.setEditingTarget('b');
        history.commitExploration();
        expect(history.entries).toHaveLength(0);
        history.finishNavigation(pending, {targetId: 'b', blockId: 'last'});
        expect(history.entries).toHaveLength(2);
        expect(history.entries[0].focus).toEqual(origin);
        expect(history.exploration).toBeNull();
    });

    test('full search cancellation restores the exact origin without a history edit', async () => {
        const {history, vm, host, visit} = fixture();
        const origin = history.capture();
        history.beginExploration();
        visit('b'); visit('c');
        await history.cancelExploration();
        expect(vm.editingTarget.id).toBe('a');
        expect(host.capture()).toEqual(origin.focus);
        expect(history.entries).toHaveLength(0);
    });

    test('cancelled search cannot accept a late preview', async () => {
        const {history} = fixture();
        history.beginExploration();
        const old = history.beginNavigation('b');
        await history.cancelExploration();
        expect(history.finishNavigation(old, {targetId: 'b', blockId: 'late'})).toBe(false);
        expect(history.entries).toHaveLength(0);
    });

    test('removed sprites are skipped and File New clears the project generation', async () => {
        const {history, vm, targets, visit} = fixture();
        visit('b'); visit('c');
        targets.delete('b');
        await history.goBack();
        expect(vm.editingTarget.id).toBe('a');
        const stale = history.capture();
        vm.runtime.emit('PROJECT_LOADED');
        expect(await history.restore(stale)).toBe(false);
        expect(history.entries).toHaveLength(0);
        expect(await history.goForward()).toBe(false);
    });

    test('a new journey after Back discards only the forward navigation branch', async () => {
        const {history, visit} = fixture();
        visit('b'); visit('c'); await history.goBack(); visit('a', 'other');
        expect(history.entries.map(entry => entry.targetId)).toEqual(['a', 'b', 'a']);
        expect(await history.goForward()).toBe(false);
    });

    test('interruption during animated return cannot steal focus or move again', async () => {
        const {history, host, visit} = fixture();
        visit('b');
        let finish;
        Scrolling.animateScrollTo.mockImplementationOnce((workspace, x, y, current) => new Promise(resolve => {
            finish = () => {if (current()) workspace.scrollbar.set(x, y); resolve();};
        }));
        const returning = history.goBack();
        await Promise.resolve(); await Promise.resolve();
        history.interrupt(); finish();
        expect(await returning).toBe(false);
        expect(host.restore).not.toHaveBeenCalled();
        expect(history.programmatic).toBe(0);
    });

    test('a failed scrolling operation always releases shared suppression', async () => {
        const {history, visit} = fixture();
        visit('b');
        const warning = jest.spyOn(console, 'warn').mockImplementation(() => {});
        Scrolling.animateScrollTo.mockRejectedValueOnce(new Error('removed workspace'));
        await expect(history.goBack()).resolves.toBe(false);
        expect(history.programmatic).toBe(0);
        expect(history.operation).toBeNull();
        expect(history.index).toBe(1);
        warning.mockRestore();
    });

    test('focusing a new search supersedes an animated return before it can restore editor focus', async () => {
        const {history, host, visit} = fixture();
        visit('b');
        let finish;
        Scrolling.animateScrollTo.mockImplementationOnce(() => new Promise(resolve => {finish = resolve;}));
        const returning = history.goBack();
        await Promise.resolve(); await Promise.resolve();
        history.beginExploration();
        finish();
        expect(await returning).toBe(false);
        expect(host.restore).not.toHaveBeenCalled();
        expect(history.exploration).not.toBeNull();
    });

    test('rapid Back then Forward cannot replace a not-yet-restored operand with transient focus', async () => {
        const {history, host, visit} = fixture();
        const origin = host.capture();
        visit('b');
        const destination = host.capture();
        let finish;
        Scrolling.animateScrollTo.mockImplementationOnce(() => new Promise(resolve => {finish = resolve;}));
        const back = history.goBack();
        await Promise.resolve(); await Promise.resolve();
        const forward = history.goForward();
        finish(); await back; await forward;
        expect(history.index).toBe(1);
        expect(host.capture()).toEqual(destination);
        expect(history.entries[0].focus).toEqual(origin);
        await history.goBack();
        expect(host.capture()).toEqual(origin);
    });

    test('superseding an unfinished jump keeps its real origin, not the intermediate sprite', () => {
        const {history, host, vm} = fixture();
        const origin = host.capture();
        const old = history.beginNavigation('b'); vm.setEditingTarget('b');
        const next = history.beginNavigation('c'); vm.setEditingTarget('c');
        expect(history.finishNavigation(old, {targetId: 'b', blockId: 'old'})).toBe(false);
        expect(history.finishNavigation(next, {targetId: 'c', blockId: 'next'})).toBe(true);
        expect(history.entries.map(entry => entry.targetId)).toEqual(['a', 'c']);
        expect(history.entries[0].focus).toEqual(origin);
    });

    test('search cancellation restores the previous forward branch intact', async () => {
        const {history, visit} = fixture();
        visit('b'); visit('c'); await history.goBack();
        const entries = JSON.stringify(history.entries);
        history.beginExploration(); visit('a', 'preview'); await history.cancelExploration();
        expect(JSON.stringify(history.entries)).toBe(entries);
        expect(history.index).toBe(1);
        await history.goForward(); expect(history.index).toBe(2);
    });

    test('programmatic scrolls from either addon do not leak manual view stops', async () => {
        const {history, workspace} = fixture();
        await history.programmaticScroll(async () => workspace.scrollbar.set(200, 300));
        jest.runOnlyPendingTimers();
        expect(history.entries).toHaveLength(0);
        workspace.scrollbar.set(400, 500);
        workspace.scrollbar.set(500, 600);
        jest.runOnlyPendingTimers();
        expect(history.entries.map(entry => entry.view.left)).toEqual([200, 500]);
    });

    test('workspace replacement releases the old hook and ignores its pending timer', () => {
        const {history, workspace, replaceWorkspace} = fixture();
        workspace.scrollbar.set(200, 300);
        const oldHook = workspace.scrollbar.set;
        const next = {...workspace, scrollbar: {set: jest.fn()}};
        replaceWorkspace(next); history.ensureWorkspace();
        expect(workspace.scrollbar.set).not.toBe(oldHook);
        const newHook = next.scrollbar.set;
        history.ensureWorkspace(); expect(next.scrollbar.set).toBe(newHook);
        jest.runOnlyPendingTimers(); expect(history.entries).toHaveLength(0);
    });

    test('unregistering an obsolete host cannot remove the replacement host', () => {
        const {history} = fixture();
        const old = history.registerHost({capture: () => 'old'});
        const next = {capture: () => 'next'};
        history.registerHost(next); old();
        expect(history.host).toBe(next);
    });

    test('without a Keyboard host the same service retains view-only navigation', async () => {
        const {history, workspace, visit} = fixture();
        history.host = null;
        visit('a', 'destination');
        workspace.scrollbar.set(200, 300); jest.runOnlyPendingTimers();
        await history.goBack();
        expect(workspace.getMetrics().viewLeft).toBe(0);
        expect(history.entries.every(entry => entry.focus === null)).toBe(true);
    });

    test('a mouse-only journey restores its breadcrumb without introducing keyboard focus', async () => {
        const {vm, history, visit} = fixture();
        history.host = null;
        const context = getScriptContext(vm);
        context.set('a', {blockId: 'origin', rootId: 'hat'});
        visit('a', 'definition');
        expect(context.get('a').blockId).toBe('definition');
        await history.goBack();
        expect(context.get('a').blockId).toBe('origin');
        await history.goForward();
        expect(context.get('a').blockId).toBe('definition');
        expect(history.entries.every(entry => entry.focus === null)).toBe(true);
    });

    test('repeating a mouse-only destination does not duplicate its normalized context entry', () => {
        const {history, visit} = fixture();
        history.host = null;
        visit('a', 'definition');
        const length = history.entries.length;
        visit('a', 'definition');
        expect(history.entries).toHaveLength(length);
    });
});
