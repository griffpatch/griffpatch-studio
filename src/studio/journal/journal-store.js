import {parseJournal, serializeJournal} from './journal';

const DEFAULT_JOURNAL_KEY = 'turbowarp-tutorial-studio/journal/v1';

/**
 * Store journals behind the Web Storage interface without coupling the journal
 * model to a browser. Tests and future persistence backends use the same port.
 *
 * @param {object} options store dependencies
 * @param {Storage} options.storage localStorage-compatible storage
 * @param {string} [options.key] storage key
 * @returns {object} journal store
 */
const createJournalStore = ({storage, key = DEFAULT_JOURNAL_KEY}) => ({
    load: () => {
        const text = storage.getItem(key);
        return text === null ? null : parseJournal(text);
    },
    save: journal => storage.setItem(key, serializeJournal(journal)),
    clear: () => storage.removeItem(key)
});

export {
    DEFAULT_JOURNAL_KEY,
    createJournalStore
};
