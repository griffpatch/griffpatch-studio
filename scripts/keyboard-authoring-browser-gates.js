const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// These are the smallest live-browser contracts which together cross every
// native editor boundary in Keyboard Authoring. They deliberately select one
// representative from parameterised matrices; the full variants remain in
// unit tests and in the full browser gate.
const coreContracts = [
    'Show current script frames its hat and exact nested caret and returns to the untouched offscreen view',
    'Escape requires two distinct structural presses and cancellation does not arm exit',
    'Script breadcrumb follows native editing, keyboard branches and offscreen heads without stealing focus',
    'Script breadcrumb links navigate ancestors and pinned heads (keyboard true)',
    'Finder dropdown paints above the caret and closing it preserves structural selection',
    'Shift-click enters Keyboard mode on the exact block without executing it',
    'an explicit middle slot moves the native continuation together and accepts one reversible block',
    'a resting terminal caret reserves neighbouring stacks without edits (repeat, zoom 0.675)',
    'inputs first when accepting say hello, including provided values and native menus',
    'inputs first when accepting if 1 < 2 then, including provided values and native menus',
    'accepting abs focuses its operand, not the chosen operation selector',
    'Delete removes a whole nested reporter and leaves its restored value hole ready for replacement',
    'command removal keeps the right structural destination for Backspace',
    'Delete in the first SUBSTACK2 command preserves its empty C-mouth caret',
    'Delete preserves an empty Boolean hole and Backspace returns from a reporter to its expression owner',
    'Delete at a stack root preserves its replacement site (continuation: true)',
    'a bare say completion focuses its default message and accepts typing without another key',
    'Enter on a completed command set x to 50 starts insertion below without revisiting inputs',
    'Up opens insertion above its own stack for a new hat (second script: true)',
    'Home and End choose whole-stack boundaries without editing (hat false, cap false)',
    'Home and End choose whole-stack boundaries without editing (hat true, cap true)',
    'horizontal arrows keep C headers and bodies on separate rows with deliberate column exits',
    'repeated Down continues from a writable stack end into the next visual script',
    'Down from the last column tail offers an aligned new script and accepts a hat',
    'horizontal arrows preserve inputs and use the complete selection height between scripts',
    'horizontal column exits require two distinct presses but free carets travel immediately',
    'free caret vertical movement meets a native stack head and accepts a hat reversibly',
    'Home and End modifiers distinguish a branch range from its outer script',
    'horizontal arrows leave empty C mouths to vertical navigation and never select their owner',
    'vertical arrows follow nested then and else bodies in visual order in both directions',
    'Left leaves a nested reporter through its owner while Right follows operands',
    'Down continues from a cap while Up still respects the top of a script',
    'types and inserts between commands, preserving the tail through native undo/redo',
    'cancels a draft without edits and splits a stack with a second Enter',
    'creates C-block bodies and typed nested reporters with preserved shadows',
    'focuses the empty condition immediately after accepting if',
    'completes an empty equals condition, fills its first input immediately, then continues into and below the C body',
    'input completion offers reporters and a literal choice but hides command, hat and cap shapes',
    'switching between literal and expression previews then cancelling preserves the original input and native history',
    'typing over a selected reporter previews and commits one native replacement edit',
    'wraps a selected reporter in typed operators while retaining native expression identities',
    'a pointer click on a native number shadow keeps Keyboard composition focus and native history',
    'pointer variable, broadcast, event and control dropdowns return their exact structural focus',
    'a delayed native field return cannot focus a disabled editor after a newer mouse click',
    'native dragging returns its settled block to keyboard editing without running the script',
    'clicks blank space and types immediately in a empty workspace',
    'keeps draft connections out of history and shows real C-mouth expansion before acceptance',
    'uses existing variables through the native creation dialog and typed dropdown arguments',
    'command declaration set fish creates one native edit with fish in local scope',
    'typed broadcast commands and fields create one native project identity with Undo Redo',
    'records accepted keyboard edits in Studio and replays them without recording the draft',
    'defines a native custom block from text and starts authoring its body',
    'a general command transform retains a nested reporter and both stack neighbours',
    'Ctrl Enter follows a custom call and carousel focus returns for F2 editing',
    'Finder shared history returns from a definition to the exact call input with native text editing',
    'Finder search Escape coalesces preview locations and restores its exact origin',
    'Finder per-sprite return remembers nested input focus across Stage and Code without stealing picker focus',
    'continues keyboard editing after undo and creates a clean native history branch',
    'copies cuts pastes and duplicates native subtrees at structural carets with native history',
    'selects an exact sibling range and copies it as one reversible native stack',
    'pastes exact multiline commands through the real clipboard as one atomic history edit',
    'pastes native subtrees across sprites and Stage with Scratch variable-sharing rules',
    'creates scoped lists through typed commands, explicit reporters and native list fields'
];

const featureSelectors = {
    navigation: [
        /Show current script/,
        /Shift-click enters Keyboard mode/,
        /Home and End/,
        /Shift Enter/,
        /horizontal arrows/,
        /horizontal column exits/,
        /horizontal column round trips/,
        /horizontal column hat placement/,
        /horizontal lane memory/,
        /Escape requires two/,
        /Script breadcrumb/,
        /free caret vertical/,
        /a resting terminal caret/,
        /native navigation sizing/,
        /vertical arrows/,
        /Right enters/,
        /Left leaves/,
        /Down continues/,
        /repeated Down/,
        /native dragging returns/,
        /a delayed native field return/
    ],
    authoring: [
        /wide keyboard .* drafts/,
        /resting new-script placeholder leaves/,
        /keyboard previews retain expanded and collapsed Scratch comments/,
        /inputs first/,
        /focuses (its|the empty)/,
        /completion/,
        /creates C-block/,
        /types and inserts/,
        /cancels a draft/,
        /transform/,
        /wraps a selected/,
        /Delete/,
        /Backspace/
    ],
    identities: [/variable/i, /broadcast/i, /list/i, /custom block/i, /defines a native/],
    finder: [/finder/i, /Find Bar/, /carousel/i, /Ctrl Enter/],
    clipboard: [/cop(?:y|ies)/i, /cut/i, /paste/i, /duplicate/i, /sibling range/i],
    ecosystem: [/Studio/i, /addon/i, /native history/i, /undo/i, /redo/i, /theme/i, /dropdown/i],
    visual: [/ghost/i, /draft/i, /outline/i, /hover/i, /caret/i, /narrow/i, /offscreen/i, /minimap/i],
    stress: [/rapid/i, /long/i, /200-block/i, /1000-block/i, /mixed/i]
};

const laneNames = ['core', ...Object.keys(featureSelectors), 'full'];

const selectorsForLane = lane => {
    if (lane === 'full') return [];
    if (lane === 'core') return coreContracts.map(title => new RegExp(`${escapeRegex(title)}$`));
    return featureSelectors[lane] || null;
};

const patternForLane = lane => {
    const selectors = selectorsForLane(lane);
    if (!selectors) return null;
    return selectors.length ? selectors.map(selector => `(?:${selector.source})`).join('|') : '';
};

const titleMatchesLane = (title, lane) => {
    const selectors = selectorsForLane(lane);
    return Boolean(selectors && (!selectors.length || selectors.some(selector => selector.test(title))));
};

module.exports = {
    coreContracts,
    featureSelectors,
    laneNames,
    patternForLane,
    selectorsForLane,
    titleMatchesLane
};
