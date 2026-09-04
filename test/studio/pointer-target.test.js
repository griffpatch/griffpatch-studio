import {
    createElementPointerTarget,
    createPointerTargetResolver
} from '../../src/studio/bridge/native-interaction/pointer-target';

test('resolves a lazy element target at click time with a safe semantic anchor', () => {
    let rect = {left: 10, top: 20, width: 100, height: 40};
    const element = {getBoundingClientRect: () => rect};
    const target = createElementPointerTarget({
        id: 'variable-dialog:confirm',
        kind: 'dialog-action',
        locate: () => element,
        anchorX: 'end',
        anchorY: 'center',
        offsetX: -12
    });
    rect = {left: 30, top: 50, width: 120, height: 36};

    const resolved = createPointerTargetResolver().resolve(target);
    expect(resolved).toMatchObject({
        id: 'variable-dialog:confirm',
        kind: 'dialog-action',
        point: {x: 138, y: 68},
        bounds: {left: 30, top: 50, right: 150, bottom: 86}
    });
    expect(resolved.element).toBe(element);
    expect(JSON.parse(JSON.stringify(resolved))).not.toHaveProperty('element');
});

test('rejects a stale or hidden target instead of clicking remembered coordinates', () => {
    const target = createElementPointerTarget({
        id: 'sprite:missing',
        locate: () => ({getBoundingClientRect: () => ({left: 10, top: 10, width: 0, height: 0})})
    });

    expect(() => createPointerTargetResolver().resolve(target)).toThrow(
        'Pointer target is not visible: sprite:missing'
    );
});
