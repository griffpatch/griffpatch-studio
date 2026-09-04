import {HISTORY_POINTER_STORAGE_KEY, readHistoryPointerPreference, saveHistoryPointerPreference}
    from '../../src/studio/bridge/history-pointer-settings';

test('history cursor defaults on, persists either choice, and accepts explicit diagnostic overrides', () => {
    const values = new Map();
    const storage = {getItem: key => values.get(key), setItem: (key, value) => values.set(key, value)};
    expect(readHistoryPointerPreference(storage)).toBe(true);
    saveHistoryPointerPreference(storage, false);
    expect(values.get(HISTORY_POINTER_STORAGE_KEY)).toBe('0');
    expect(readHistoryPointerPreference(storage)).toBe(false);
    expect(readHistoryPointerPreference(storage, '?studio-history-pointer=1')).toBe(true);
    saveHistoryPointerPreference(storage, true);
    expect(readHistoryPointerPreference(storage)).toBe(true);
    expect(readHistoryPointerPreference(storage, '?studio-history-pointer=0')).toBe(false);
});

test('an unavailable preference store does not break the editor', () => {
    expect(readHistoryPointerPreference(null)).toBe(true);
    expect(() => saveHistoryPointerPreference(null, false)).not.toThrow();
});
