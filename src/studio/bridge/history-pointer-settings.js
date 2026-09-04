const HISTORY_POINTER_QUERY = 'studio-history-pointer';
const HISTORY_POINTER_STORAGE_KEY = 'turbowarp-tutorial-studio/history-pointer';

const readHistoryPointerPreference = (storage, search = '') => {
    const requested = new URLSearchParams(search).get(HISTORY_POINTER_QUERY);
    if (requested === '0' || requested === '1') return requested === '1';
    try {
        return storage.getItem(HISTORY_POINTER_STORAGE_KEY) !== '0';
    } catch (error) {
        return true;
    }
};

const saveHistoryPointerPreference = (storage, enabled) => {
    try {
        storage.setItem(HISTORY_POINTER_STORAGE_KEY, enabled ? '1' : '0');
    } catch (error) { // eslint-disable-line no-empty
        // A blocked preference store must not prevent changing the current view.
    }
};

export {HISTORY_POINTER_QUERY, HISTORY_POINTER_STORAGE_KEY,
    readHistoryPointerPreference, saveHistoryPointerPreference};
