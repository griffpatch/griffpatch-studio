import englishMessages from '../../addons/addons-l10n/en.json';
import l10nEntries from '../../addons/generated/l10n-entries';

const englishFallback = {
    '/_general/blocks/green-flag': 'green flag',
    '/_general/blocks/clockwise': 'clockwise',
    '/_general/blocks/anticlockwise': 'anticlockwise'
};

const blockIconLabel = (id, messages = englishMessages) => {
    // BlockTypeInfo follows Scratch Addons' locale callback convention and
    // includes a leading slash. The generated locale JSON stores the same ids
    // without it, so normalize at this small adapter boundary rather than
    // changing either shared source.
    const messageId = String(id).replace(/^\/+/, '');
    return messages[messageId] || messages[id] || englishFallback[id] || id;
};

const entryForLocale = (locale, entries = l10nEntries) => {
    const normalized = String(locale || 'en').toLowerCase();
    if (entries[normalized]) return entries[normalized];
    return entries[normalized.split('-')[0]] || null;
};

const loadBlockIconLabel = async (locale, entries = l10nEntries) => {
    const entry = entryForLocale(locale, entries);
    if (!entry) return blockIconLabel;
    const loaded = await entry();
    const messages = loaded.default || loaded;
    return id => blockIconLabel(id, messages);
};

export {blockIconLabel, entryForLocale, loadBlockIconLabel};
