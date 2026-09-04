const CORE_CATEGORY_MESSAGES = {
    'motion': ['CATEGORY_MOTION', 'Motion'],
    'looks': ['CATEGORY_LOOKS', 'Looks'],
    'sound': ['CATEGORY_SOUND', 'Sound'],
    'events': ['CATEGORY_EVENTS', 'Events'],
    'control': ['CATEGORY_CONTROL', 'Control'],
    'sensing': ['CATEGORY_SENSING', 'Sensing'],
    'operators': ['CATEGORY_OPERATORS', 'Operators'],
    'data': ['CATEGORY_VARIABLES', 'Variables'],
    'more': ['CATEGORY_MYBLOCKS', 'My Blocks'],
    'addon-custom-block': ['CATEGORY_MYBLOCKS', 'My Blocks']
};

// BlockTypeInfo category names are stable internal identities used by Scratch
// Addons for ranking and colour classes. Translate only the Keyboard Lab badge
// so localization cannot change those parser or renderer contracts.
const categoryLabel = (name, ScratchBlocks) => {
    const message = CORE_CATEGORY_MESSAGES[name];
    if (!message) return name;
    const [id, english] = message;
    return ScratchBlocks?.ScratchMsgs?.translate ? ScratchBlocks.ScratchMsgs.translate(id, english) : english;
};

export {categoryLabel, CORE_CATEGORY_MESSAGES};
