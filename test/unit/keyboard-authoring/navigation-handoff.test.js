import {NavigationHandoff} from '../../../src/experiments/keyboard-authoring/navigation-handoff';

const request = {requestId: 1, blockId: 'flag-a', targetId: 'sprite-a', followSelection: true};
const ready = {enabled: true, available: true};
const done = {...request, resolved: true};

describe('Find Bar structural focus handoff', () => {
    let handoff;
    beforeEach(() => { handoff = new NavigationHandoff(); });

    test('same-sprite navigation selects exactly the resolved destination once', () => {
        handoff.begin(request, ready);
        expect(handoff.finish(done, 'sprite-a')).toEqual({blockId: 'flag-a', targetId: 'sprite-a'});
        expect(handoff.finish(done, 'sprite-a')).toBeNull();
    });

    test('expected sprite replacement retains the grant while Keyboard mode resets', () => {
        handoff.begin(request, ready);
        handoff.contextChanged('sprite-b', 'sprite-a');
        expect(handoff.finish(done, 'sprite-a')).not.toBeNull();
    });

    test.each([
        ['same-target workspace replacement', 'sprite-a', 'sprite-a'],
        ['unrelated sprite selection', 'sprite-b', 'sprite-c']
    ])('%s cancels the grant', (label, previous, next) => {
        handoff.begin(request, ready);
        handoff.contextChanged(previous, next);
        expect(handoff.finish(done, 'sprite-a')).toBeNull();
    });

    test.each([
        ['disabled keyboard', {enabled: false, available: true}],
        ['draft, field or hidden editor', {enabled: true, available: false}]
    ])('%s cannot acquire ownership', (label, state) => {
        handoff.begin(request, state);
        expect(handoff.finish(done, 'sprite-a')).toBeNull();
    });

    test('rapid navigation can supersede an accepted cross-sprite handoff during reset', () => {
        handoff.begin(request, ready);
        handoff.contextChanged('sprite-b', 'sprite-a');
        const next = {...request, requestId: 2, blockId: 'flag-b', targetId: 'sprite-b'};
        handoff.begin(next, {enabled: false, available: true});
        expect(handoff.finish(done, 'sprite-a')).toBeNull();
        handoff.contextChanged('sprite-a', 'sprite-b');
        expect(handoff.finish({...next, resolved: true}, 'sprite-b'))
            .toEqual({blockId: 'flag-b', targetId: 'sprite-b'});
    });

    test('explicit cancellation cannot be revived by another request while disabled', () => {
        handoff.begin(request, ready);
        handoff.cancel();
        handoff.begin({...request, requestId: 2}, {enabled: false, available: true});
        expect(handoff.pending).toBeNull();
    });

    test('ordinary search follows the exact result while Keyboard mode owns selection', () => {
        handoff.begin(request, ready);
        const search = {...request, requestId: 2, followSelection: false};
        handoff.begin(search, ready);
        expect(handoff.finish(done, 'sprite-a')).toBeNull();
        expect(handoff.finish({...search, resolved: true}, 'sprite-a'))
            .toEqual({blockId: 'flag-a', targetId: 'sprite-a'});
    });

    test('ordinary search cannot enable Keyboard mode or acquire a cancelled handoff', () => {
        const search = {...request, followSelection: false};
        handoff.begin(search, {enabled: false, available: true});
        expect(handoff.pending).toBeNull();
        handoff.begin(search, ready);
        handoff.cancel();
        expect(handoff.finish({...search, resolved: true}, 'sprite-a')).toBeNull();
    });

    test('ordinary carousel can supersede a cross-sprite result while Keyboard mode resets', () => {
        handoff.begin({...request, followSelection: false}, ready);
        handoff.contextChanged('sprite-b', 'sprite-a');
        const next = {...request, requestId: 2, blockId: 'flag-b', targetId: 'sprite-b', followSelection: false};
        handoff.begin(next, {enabled: false, available: true});
        expect(handoff.finish({...done, followSelection: false}, 'sprite-a')).toBeNull();
        handoff.contextChanged('sprite-a', 'sprite-b');
        expect(handoff.finish({...next, resolved: true}, 'sprite-b'))
            .toEqual({blockId: 'flag-b', targetId: 'sprite-b'});
    });

    test.each([
        {resolved: false}, {blockId: 'unrelated'}, {targetId: 'sprite-c'}, {followSelection: false}
    ])('rejects invalid completion %o and consumes its grant', change => {
        handoff.begin(request, ready);
        expect(handoff.finish({...done, ...change}, 'sprite-a')).toBeNull();
        expect(handoff.pending).toBeNull();
    });

    test('completion on a different current sprite cannot restore focus', () => {
        handoff.begin(request, ready);
        expect(handoff.finish(done, 'sprite-b')).toBeNull();
    });
});
