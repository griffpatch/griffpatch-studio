import {JSDOM} from 'jsdom';
import {blockXml, comparisonResult} from '../../../src/experiments/keyboard-authoring/catalogue';
import {blockIconLabel, entryForLocale, loadBlockIconLabel} from
    '../../../src/experiments/keyboard-authoring/block-icon-labels';
import l10nEntries from '../../../src/addons/generated/l10n-entries';
import {BlockInstance, BlockInputType, BlockTypeInfo} from
    '../../../src/addons/addons/middle-click-popup/BlockTypeInfo';

// XML-only DOM, without changing the Node environment used by the shared
// Enzyme setup and other Studio tests.
const dom = new JSDOM('');
afterAll(() => dom.window.close());
const parse = text => new dom.window.DOMParser().parseFromString(text, 'text/xml').documentElement;
const instance = (xml, inputs = [], values = [], names = []) => new BlockInstance({
    domForm: parse(xml), inputs,
    workspaceForm: {type: parse(xml).getAttribute('type'), inputList: names.map(name => ({name}))}
}, ...values);
const field = (type, name, index = 0, fieldIdx = 0) => ({
    type, inputIdx: index, fieldIdx, getField: () => ({name})
});

test('copies block identities but preserves variable field identity and scope', () => {
    const source = instance('<block type="data_setvariableto" id="flyout" x="3" y="4">' +
        '<field name="VARIABLE" id="old-variable" variabletype="">old</field>' +
        '<value name="VALUE"><shadow type="text" id="flyout-shadow"><field name="TEXT">0</field></shadow></value>' +
        '</block>', [field(BlockInputType.ENUM, 'VARIABLE')], [{value:'local-cake-id', string:'cake'}], ['']);
    const result = blockXml(source);
    expect(result.hasAttribute('id')).toBe(false);
    expect(result.hasAttribute('x')).toBe(false);
    expect(result.querySelector('shadow').hasAttribute('id')).toBe(false);
    expect(result.querySelector('field').getAttribute('id')).toBe('local-cake-id');
    expect(result.querySelector('field').textContent).toBe('cake');
    expect(source.typeInfo.domForm.querySelector('field').getAttribute('id')).toBe('old-variable');
});

test('nested reporters preserve default shadows and create fresh copies on each acceptance', () => {
    const child = instance('<block type="operator_add" id="parsed-reporter"/>');
    const source = instance('<block type="motion_movesteps" id="flyout">' +
        '<value name="STEPS"><shadow type="math_number" id="shadow"><field name="NUM">10</field></shadow>' +
        '<block type="old"/></value></block>', [field(BlockInputType.NUMBER, 'NUM', 0, -1)], [child], ['STEPS']);
    const result = blockXml(source);
    expect(result.querySelectorAll('value > shadow')).toHaveLength(1);
    expect(result.querySelectorAll('value > block')).toHaveLength(1);
    expect(result.querySelector('value > block').getAttribute('type')).toBe('operator_add');
    expect(result.querySelector('value > block').hasAttribute('id')).toBe(false);
    expect(blockXml(source).outerHTML).toBe(result.outerHTML);
    expect(source.typeInfo.domForm.querySelector('value > block').getAttribute('type')).toBe('old');
});

test.each([
    [BlockInputType.BOOLEAN, 'CONDITION', 'value', 'operator_lt'],
    [BlockInputType.BLOCK, 'SUBSTACK', 'statement', 'control_wait']
])('creates an absent native input container for input type %s', (type, name, tag, childType) => {
    const source = instance('<block type="control_if"/>', [field(type, '', 0, -1)],
        [instance(`<block type="${childType}"/>`)], [name]);
    const result = blockXml(source);
    expect(result.querySelector(`${tag}[name="${name}"] > block`).getAttribute('type')).toBe(childType);
    expect(source.typeInfo.domForm.children).toHaveLength(0);
});

test('dropdown mutations are made on the result, never on the flyout template', () => {
    const source = instance('<block type="control_stop"><mutation hasnext="false"/>' +
        '<field name="STOP_OPTION">all</field></block>', [field(BlockInputType.ENUM, 'STOP_OPTION')],
    [{value:'other scripts in sprite', string:'other scripts in sprite'}], ['']);
    const result = blockXml(source);
    expect(result.querySelector('mutation').getAttribute('hasnext')).toBe('true');
    expect(result.querySelector('field').textContent).toBe('other scripts in sprite');
    expect(source.typeInfo.domForm.querySelector('mutation').getAttribute('hasnext')).toBe('false');
});

test('icon labels use the active Addons translation with a stable English fallback', () => {
    expect(blockIconLabel('/_general/blocks/green-flag', {
        '_general/blocks/green-flag': 'Flagge'
    })).toBe('Flagge');
    expect(blockIconLabel('/_general/blocks/clockwise', {})).toBe('clockwise');
    expect(blockIconLabel('/unknown/icon', {})).toBe('/unknown/icon');
});

test('icon labels load the exact or base Addons locale without bundling a second translation source', async () => {
    const entries = {
        de: () => Promise.resolve({
            '_general/blocks/green-flag': 'Flagge',
            '_general/blocks/clockwise': 'im Uhrzeigersinn'
        })
    };
    expect(entryForLocale('de-DE', entries)).toBe(entries.de);
    const label = await loadBlockIconLabel('de-DE', entries);
    expect(label('/_general/blocks/green-flag')).toBe('Flagge');
    expect(label('/_general/blocks/clockwise')).toBe('im Uhrzeigersinn');
    expect(label('/_general/blocks/anticlockwise')).toBe('anticlockwise');
});

test('every bundled Addons locale resolves all parser icon labels or the safe English fallback', async () => {
    const ids = [
        '/_general/blocks/green-flag',
        '/_general/blocks/clockwise',
        '/_general/blocks/anticlockwise'
    ];
    for (const locale of Object.keys(l10nEntries)) {
        const label = await loadBlockIconLabel(locale);
        expect(ids.map(label)).toEqual(ids.map(id => expect.stringMatching(/^(?!\/_general\/).+/)));
    }
});

const defaultExtensionBlock = type => ({
    type,
    usesDefaultExtensionColors: true,
    colour_: '#0fbd8c',
    colourSecondary_: '#0da57a',
    colourTertiary_: '#0b8e69'
});

test.each([
    ['music_playNoteForBeats', 'music', 'Musique'],
    ['videoSensing_videoOn', 'videoSensing', 'Détection vidéo']
])('default-colour extension %s retains its live localized category', (type, id, name) => {
    const vm = {runtime: {_blockInfo: [{id, name}]}};
    expect(BlockTypeInfo.getBlockCategory(defaultExtensionBlock(type), vm)).toMatchObject({
        name,
        colorPrimary: '#0fbd8c'
    });
});

test('a missing live extension description falls back to the opcode extension identity', () => {
    expect(BlockTypeInfo.getBlockCategory(defaultExtensionBlock('videoSensing_videoOn'), {}))
        .toMatchObject({name: 'videoSensing'});
});

test('literal text is escaped by the DOM and missing fields fail before live creation', () => {
    const source = instance('<block type="text"><field name="TEXT"/></block>',
        [field(BlockInputType.STRING, 'TEXT')], ['<cake & "ice">'], ['']);
    expect(blockXml(source).querySelector('field').textContent).toBe('<cake & "ice">');
    const malformed = instance('<block type="text"/>', [field(BlockInputType.STRING, 'TEXT')], ['hello'], ['']);
    expect(() => blockXml(malformed)).toThrow('Missing native field TEXT');
});

test('comparison lookup resolves one explicit native operator without manufacturing completion state', () => {
    const operators = {
        '=': 'operator_equals',
        '>': 'operator_gt',
        '<': 'operator_lt'
    };
    const search = text => {
        const operator = text.slice(-1);
        const type = operators[operator];
        return type ? [{
            instance: {typeInfo: {workspaceForm: {type}, inputs: [{inputIdx: 0}, {inputIdx: 2}]}},
            text,
            truncated: false
        }] : [];
    };
    expect(comparisonResult(search, 'Player Score', '>')).toEqual(
        expect.objectContaining({text: 'Player Score >', truncated: false}));
    expect(comparisonResult(search, 'score >', '=')).toBeNull();
    expect(comparisonResult(search, '   ', '=')).toBeNull();
    expect(comparisonResult(search, 'score', '!')).toBeNull();
});
