import {completionChoices, completionChoicesForConnection} from
    '../../../src/experiments/keyboard-authoring/completion';

const match = (text, canStackUp, canStackDown, canBeRound, type = 'Number') => ({text, instance: {typeInfo: {
    shape: {canStackUp, canStackDown, canBeRound}, workspaceForm: {outputConnection: {type}}
}}});
const matches = [match('move', true, true, false), match('when flag', false, true, false),
    match('stop', true, false, false), match('x position', false, false, true),
    match('equals', false, false, true, 'Boolean')];
const fixture = (type, child = null, check = () => true, check_ = null) => {
    const connection = {type, targetBlock: () => child, checkType_: check, check_};
    return {getBlockById: () => ({getInput: () => ({connection}), nextConnection: connection})};
};
const position = {kind: 'input', blockId: 'move', inputName: 'STEPS'};

test('value slots hide command, hat and cap blocks but retain compatible reporters', () => {
    const choices = completionChoices(fixture(1), position, matches, 'hello');
    expect(choices.map(choice => choice.text)).toEqual(['x position', 'equals', 'hello']);
    expect(choices.map(choice => choice.kind)).toEqual(['block', 'block', 'value']);
    expect(choices.every(choice => choice.fits)).toBe(true);
});

test('Boolean slots use the native connection check rather than an opcode whitelist', () => {
    const choices = completionChoices(fixture(1, null, output => output.type === 'Boolean'), position, matches);
    expect(choices.map(choice => choice.text)).toEqual(['equals']);
});

test('an explicit nested connection exposes the same value choices without weakening a Boolean destination', () => {
    const value = match('score', false, false, true, 'String');
    const booleanWorkspace = fixture(1, null, output => output.type === 'Boolean', ['Boolean']);
    expect(completionChoices(booleanWorkspace, position, [value], null, [], [], 'score')).toEqual([]);
    const nested = {type: 1, checkType_: output => output.type === 'String'};
    expect(completionChoicesForConnection(nested, 'input', [value], 'score', [], [], 'score')
        .map(choice => [choice.kind, choice.text])).toEqual([
        ['block', 'score'],
        ['value', 'score']
    ]);
});

test('a populated reporter is protected even if another reporter has the right shape', () => {
    const choices = completionChoices(fixture(1, {id: 'old', isShadow: () => false}), position, matches);
    expect(choices).toHaveLength(2);
    expect(choices.every(choice => !choice.fits)).toBe(true);
});

test('an explicitly selected reporter may be replaced but no neighbouring child may be evicted', () => {
    const child = {id: 'old', isShadow: () => false};
    const replacing = completionChoices(fixture(1, child), position, matches, null, [], [], '', child.id);
    expect(replacing.map(choice => choice.text)).toEqual(['x position', 'equals']);
    expect(replacing.every(choice => choice.fits)).toBe(true);
    const staleSelection = completionChoices(fixture(1, child), position, matches, null, [], [], '', 'other');
    expect(staleSelection.every(choice => !choice.fits)).toBe(true);
});

test('empty and ambiguous literals remain explicit choices without filling statement gaps with values', () => {
    expect(completionChoices(fixture(1), position, [], '')).toEqual([{kind: 'value', text: '', fits: true}]);
    const choices = completionChoices(fixture(3), {kind: 'gap', blockId: 'move'}, matches);
    expect(choices.map(choice => choice.kind)).toEqual(matches.map(() => 'block'));
    expect(choices.map(choice => choice.fits)).toEqual([true, true, false, false, false]);
});

test('short queries lead with candidates which fit the structural connection', () => {
    const reporter = match('mouse x', false, false, true);
    const command = match('move 10 steps', true, true, false);
    const hat = match('mouse down?', false, true, false);
    const choices = completionChoices(fixture(3, {}), {kind: 'gap', blockId: 'move'},
        [reporter, hat, command]);
    expect(choices.map(choice => choice.text)).toEqual(['move 10 steps', 'mouse x', 'mouse down?']);
    expect(choices.map(choice => choice.fits)).toEqual([true, false, false]);
});

test('an exact command remains selected when it cannot fit so insertion explains the structural conflict', () => {
    const cap = match('stop all', true, false, false);
    const alternative = match('stop other scripts in sprite', true, true, false);
    const choices = completionChoices(fixture(3, {}), {kind: 'gap', blockId: 'move'},
        [alternative, cap], null, [], [], 'stop all');
    expect(choices.map(choice => choice.text)).toEqual(['stop all', 'stop other scripts in sprite']);
    expect(choices.map(choice => choice.fits)).toEqual([false, true]);
});

test('a new-script caret prefers attachable commands over loose reporters for an equally short prefix', () => {
    const reporter = match('mod', false, false, true);
    const command = match('move 10 steps', true, true, false);
    const choices = completionChoices(fixture(3), {kind: 'workspace'}, [reporter, command]);
    expect(choices.map(choice => choice.text)).toEqual(['move 10 steps', 'mod']);
});

test('a new-script caret keeps parser relevance between commands and hats while demoting reporters', () => {
    const reporter = match('mouse down?', false, false, true, 'Boolean');
    const hat = match('when mouse down', false, true, false);
    const command = match('move 10 steps', true, true, false);
    const choices = completionChoices(fixture(3), {kind: 'workspace'}, [reporter, hat, command]);
    expect(choices.map(choice => choice.text)).toEqual(['when mouse down', 'move 10 steps', 'mouse down?']);
    expect(choices.every(choice => choice.fits)).toBe(true);
});

test('the literal choice is never crowded out by many reporter matches', () => {
    const many = Array.from({length: 20}, (_, i) => match(`reporter ${i}`, false, false, true));
    const choices = completionChoices(fixture(1), position, many, 'text');
    expect(choices).toHaveLength(7);
    expect(choices[6]).toEqual({kind: 'value', text: 'text', fits: true});
});

test('a complete numeric literal leads truncated numeric-looking blocks without changing text completion', () => {
    const power = {...match('10 ^ of', false, false, true), truncated: true};
    const complete = {...match('10 mod 3', false, false, true), truncated: false};
    expect(completionChoices(fixture(1), position, [power], '10', [], [], '10')
        .map(choice => [choice.kind, choice.text])).toEqual([
        ['value', '10'],
        ['block', '10 ^ of']
    ]);
    expect(completionChoices(fixture(1), position, [complete, power], '10', [], [], '10')
        .map(choice => [choice.kind, choice.text])).toEqual([
        ['block', '10 mod 3'],
        ['value', '10'],
        ['block', '10 ^ of']
    ]);
    expect(completionChoices(fixture(1), position, [power], 'ten', [], [], 'ten')[0])
        .toMatchObject({kind: 'block', text: power.text});
    expect(completionChoices(fixture(1), position, [power], '10 ^', [], [], '10 ^')[0])
        .toMatchObject({kind: 'block', text: power.text});
});

test('scope-labelled variables lead matches without losing the literal or either creation scope', () => {
    const getter = match('old', false, false, true);
    getter.instance.typeInfo.workspaceForm.type = 'data_variable';
    const variables = [{kind: 'variable', text: 'older', variableId: 'id', scope: 'local', fits: true},
        {kind: 'create-variable', text: 'old', scope: 'local', fits: true},
        {kind: 'create-variable', text: 'old', scope: 'global', fits: true}];
    const choices = completionChoices(fixture(1), position, [getter, ...matches], 'old', variables);
    expect(choices.map(c => c.kind)).toEqual(['variable', 'block', 'block', 'value', 'create-variable', 'create-variable']);
    expect(choices[0].variableId).toBe('id');
    expect(choices.slice(-2).map(c => c.scope)).toEqual(['local', 'global']);
});

test('explicit command declarations beat incomplete alternatives but never a complete existing block', () => {
    const partial={...match('set fisheye effect to',true,true,false),truncated:true};
    const complete={...match('set x to 10',true,true,false),truncated:false};
    const declarations=['local','global'].map(scope=>({kind:'create-variable-command',text:'set fish to',scope}));
    const at={kind:'workspace'};
    const choices=completionChoices(fixture(3),at,[complete,partial],null,[],declarations);
    expect(choices.map(c=>c.kind)).toEqual(['block','create-variable-command','create-variable-command','block']);
    expect(choices[0].text).toBe(complete.text);
    expect(completionChoices(fixture(3),at,[partial],null,[],declarations)[0]).toBe(declarations[0]);
});
