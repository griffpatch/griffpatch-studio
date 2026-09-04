import {categoryLabel, CORE_CATEGORY_MESSAGES} from '../../../src/experiments/keyboard-authoring/category-label';

test('uses Scratch native category translations without changing internal identities', () => {
    const translate = jest.fn((id, english) => ({
        CATEGORY_MOTION: '動き',
        CATEGORY_EVENTS: 'イベント',
        CATEGORY_VARIABLES: '変数',
        CATEGORY_MYBLOCKS: 'ブロック定義'
    })[id] || english);
    const ScratchBlocks = {ScratchMsgs: {translate}};

    expect(categoryLabel('motion', ScratchBlocks)).toBe('動き');
    expect(categoryLabel('events', ScratchBlocks)).toBe('イベント');
    expect(categoryLabel('data', ScratchBlocks)).toBe('変数');
    expect(categoryLabel('more', ScratchBlocks)).toBe('ブロック定義');
    expect(categoryLabel('addon-custom-block', ScratchBlocks)).toBe('ブロック定義');
    expect(categoryLabel('Musique', ScratchBlocks)).toBe('Musique');
    expect(translate).toHaveBeenCalledTimes(5);
});

test('every core identity has a readable English fallback', () => {
    for (const name of Object.keys(CORE_CATEGORY_MESSAGES)) {
        expect(categoryLabel(name)).toMatch(/^[A-Z].+/);
    }
});
