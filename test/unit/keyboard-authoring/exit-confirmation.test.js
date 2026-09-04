import {ExitConfirmation} from '../../../src/experiments/keyboard-authoring/exit-confirmation';

test('exit requires two distinct Escape presses without a timer', () => {
    const guard = new ExitConfirmation();
    expect(guard.press()).toBe(false);
    for (let i = 0; i < 20; i++) expect(guard.press(true)).toBe(false);
    expect(guard.armed).toBe(true);
    expect(guard.press()).toBe(true);
    expect(guard.armed).toBe(false);
});

test('an intervening action resets exit confirmation and held keys cannot arm it', () => {
    const guard = new ExitConfirmation();
    expect(guard.press(true)).toBe(false);
    expect(guard.armed).toBe(false);
    guard.press();
    guard.reset();
    expect(guard.press()).toBe(false);
    expect(guard.press()).toBe(true);
});
