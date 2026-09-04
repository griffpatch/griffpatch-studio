import {JSDOM} from 'jsdom';

import {buildStackXml, compileMultilinePaste} from
    '../../../src/experiments/keyboard-authoring/multiline-paste';

const dom = new JSDOM('');
const document = dom.window.document;
const instance = (type, {up = true, down = true, round = false} = {}) => {
    const xml = document.createElement('block');
    xml.setAttribute('type', type);
    return {
        inputs: [],
        typeInfo: {
            domForm: xml,
            inputs: [],
            shape: {canStackUp: up, canStackDown: down, canBeRound: round},
            workspaceForm: {type}
        }
    };
};
const result = (text, value, truncated = false) => ({text, instance: value, truncated});

test('builds exact native next nodes without disturbing nested statement XML', () => {
    const repeat = instance('control_repeat');
    const statementSlot = document.createElement('statement');
    statementSlot.setAttribute('name', 'SUBSTACK');
    const nested = document.createElement('block');
    nested.setAttribute('type', 'looks_say');
    statementSlot.appendChild(nested);
    repeat.typeInfo.domForm.appendChild(statementSlot);
    const xml = buildStackXml([repeat, instance('motion_movesteps'), instance('looks_nextcostume')]);
    expect(xml.querySelector('statement[name="SUBSTACK"] > block').getAttribute('type')).toBe('looks_say');
    expect(xml.querySelector(':scope > next > block').getAttribute('type')).toBe('motion_movesteps');
    expect(xml.querySelector(':scope > next > block > next > block').getAttribute('type')).toBe('looks_nextcostume');
});

test('compiles nonblank exact command lines as one native stack', () => {
    const move = instance('motion_movesteps');
    const say = instance('looks_say');
    const catalogue = {search: query => query === 'move 10 steps' ?
        [result('move 10 steps', move)] : [result('say hello', say)]};
    const compiled = compileMultilinePaste(catalogue, ' move 10 steps \n\n say hello ');
    expect(compiled.count).toBe(2);
    expect(compiled.lines).toEqual(['move 10 steps', 'say hello']);
    expect(compiled.xml.getAttribute('type')).toBe('motion_movesteps');
    expect(compiled.xml.querySelector(':scope > next > block').getAttribute('type')).toBe('looks_say');
});

test('rejects fuzzy, truncated, ambiguous, and reporter lines before creating XML', () => {
    const move = instance('motion_movesteps');
    expect(() => compileMultilinePaste({search: () => [result('move 10 steps', move, true)]}, 'move 10'))
        .toThrow(/line 1.*exactly/i);
    expect(() => compileMultilinePaste({search: () => [
        result('move 10 steps', move), result('move 10 steps', instance('other_move'))
    ]}, 'move 10 steps')).toThrow(/line 1.*ambiguous/i);
    expect(() => compileMultilinePaste({search: () => [result('x position', instance('motion_xposition', {
        up: false, down: false, round: true
    }))]}, 'x position')).toThrow(/line 1.*value block/i);
});

test('rejects a command after a native cap block', () => {
    const stop = instance('control_delete_this_clone', {down: false});
    const move = instance('motion_movesteps');
    const catalogue = {search: query => [result(query, query === 'stop all' ? stop : move)]};
    expect(() => compileMultilinePaste(catalogue, 'stop all\nmove 10 steps')).toThrow(/line 1.*ends a script/i);
});

test('deduplicates identical native interpretations but rejects bounded input overflow', () => {
    const move = instance('motion_movesteps');
    const catalogue = {search: query => [result(query, move), result(query, move)]};
    expect(compileMultilinePaste(catalogue, 'move 10 steps').count).toBe(1);
    expect(() => compileMultilinePaste(catalogue, `${'a'.repeat(257)}\nmove`)).toThrow(/line 1.*256/i);
    expect(() => compileMultilinePaste(catalogue, Array(52).fill('move').join('\n'))).toThrow(/50/i);
});
