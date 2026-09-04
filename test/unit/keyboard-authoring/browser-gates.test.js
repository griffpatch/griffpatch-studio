const {
    coreContracts,
    laneNames,
    patternForLane,
    titleMatchesLane
} = require('../../../scripts/keyboard-authoring-browser-gates');

describe('Keyboard Authoring browser gates', () => {
    test('the core gate is a unique, bounded list of assembled-editor contracts', () => {
        expect(coreContracts).toHaveLength(63);
        expect(new Set(coreContracts).size).toBe(coreContracts.length);
    });

    test('core contract selectors do not absorb nearby parameter variants', () => {
        const wanted = 'Home and End choose whole-stack boundaries without editing (hat false, cap false)';
        const unwanted = 'Home and End choose whole-stack boundaries without editing (hat true, cap false)';
        expect(new RegExp(patternForLane('core')).test(wanted)).toBe(true);
        expect(new RegExp(patternForLane('core')).test(unwanted)).toBe(false);
    });

    test('feature lanes remain intentionally overlapping and discoverable', () => {
        const title = 'pointer variable dropdowns return their exact structural focus';
        expect(titleMatchesLane(title, 'navigation')).toBe(false);
        expect(titleMatchesLane(title, 'identities')).toBe(true);
        expect(titleMatchesLane(title, 'ecosystem')).toBe(true);
        expect(laneNames).toEqual(expect.arrayContaining(['core', 'navigation', 'visual', 'full']));
    });

    test('the Finder lane includes existing cross-sprite Find Bar variants as well as new Finder cases', () => {
        expect(titleMatchesLane('Find Bar ordinary search follows event usages across sprites', 'finder')).toBe(true);
        expect(titleMatchesLane('Finder shared history returns to an operand', 'finder')).toBe(true);
    });
});
