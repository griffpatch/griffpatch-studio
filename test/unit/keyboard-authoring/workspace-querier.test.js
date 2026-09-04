import WorkspaceQuerier from '../../../src/addons/addons/middle-click-popup/WorkspaceQuerier';
import {
    BlockInputBlock,
    BlockInputBoolean,
    BlockInputColour,
    BlockInputEnum,
    BlockInputNumber,
    BlockInputString,
    BlockInstance,
    BlockShape,
    BlockTypeInfo
} from '../../../src/addons/addons/middle-click-popup/BlockTypeInfo';

const blockType = (id, shape, parts) => ({
    id,
    shape,
    parts,
    inputs: parts.filter(part => typeof part !== 'string'),
    createBlock: BlockTypeInfo.prototype.createBlock
});

const numberInput = index => new BlockInputNumber(index, -1, '0');
const stringInput = index => new BlockInputString(index, -1, '');
const booleanInput = index => new BlockInputBoolean(index, -1);
const stackInput = index => new BlockInputBlock(index, -1);

const types = () => {
    const xPosition = blockType('motion_xposition', BlockShape.Round, ['x position']);
    const mouseDown = blockType('sensing_mousedown', BlockShape.Boolean, ['mouse down?']);
    const add = blockType('operator_add', BlockShape.Round,
        [numberInput(0), '+', numberInput(1)]);
    const multiply = blockType('operator_multiply', BlockShape.Round,
        [numberInput(0), '*', numberInput(1)]);
    const equals = blockType('operator_equals', BlockShape.Boolean,
        [stringInput(0), '=', stringInput(1)]);
    const greater = blockType('operator_gt', BlockShape.Boolean,
        [stringInput(0), '>', stringInput(1)]);
    const less = blockType('operator_lt', BlockShape.Boolean,
        [stringInput(0), '<', stringInput(1)]);
    const not = blockType('operator_not', BlockShape.Boolean,
        ['not', booleanInput(0)]);
    const join = blockType('operator_join', BlockShape.Round,
        ['join', stringInput(0), stringInput(1)]);
    const say = blockType('looks_say', BlockShape.Stack, ['say', stringInput(0)]);
    const move = blockType('motion_movesteps', BlockShape.Stack,
        ['move', numberInput(0), 'steps']);
    const wait = blockType('control_wait', BlockShape.Stack,
        ['wait', numberInput(0), 'seconds']);
    const repeat = blockType('control_repeat', BlockShape.Stack,
        ['repeat', numberInput(0), stackInput(1)]);
    const ifThen = blockType('control_if', BlockShape.Stack,
        ['if', booleanInput(0), 'then', stackInput(1)]);
    const flag = blockType('event_whenflagclicked', BlockShape.Hat,
        ['when green flag clicked']);
    const stop = blockType('control_stop_all', BlockShape.End, ['stop all']);
    return {xPosition, mouseDown, add, multiply, equals, greater, less, not, join, say, move, wait, repeat,
        ifThen, flag, stop};
};

const query = (blockTypes, text) => {
    const parser = new WorkspaceQuerier();
    parser.indexWorkspace(blockTypes);
    return parser.queryWorkspace(text);
};

const resultFor = (result, id) => result.results.find(item => item.getBlock().typeInfo.id === id);

const inputIds = instance => instance.inputs.map(input => (
    input instanceof BlockInstance ? input.typeInfo.id : input
));

describe('Scratch Addons WorkspaceQuerier contract', () => {
    test('requires an indexed workspace', () => {
        expect(() => new WorkspaceQuerier().queryWorkspace('move')).toThrow('must be indexed');
    });

    test.each(['', ' ', '    '])('returns no suggestion for blank query %j', text => {
        expect(query([types().move], text)).toEqual({results: [], illegalResult: null, limited: false});
    });

    test('clearing the index prevents stale queries', () => {
        const parser = new WorkspaceQuerier();
        parser.indexWorkspace([types().move]);
        expect(parser.queryWorkspace('move').results).not.toHaveLength(0);
        parser.clearWorkspaceIndex();
        expect(() => parser.queryWorkspace('move')).toThrow('must be indexed');
    });

    test('reindexing replaces the searchable catalogue', () => {
        const parser = new WorkspaceQuerier();
        parser.indexWorkspace([types().move]);
        expect(resultFor(parser.queryWorkspace('move'), 'motion_movesteps')).toBeDefined();
        parser.indexWorkspace([types().wait]);
        expect(resultFor(parser.queryWorkspace('move'), 'motion_movesteps')).toBeUndefined();
        expect(resultFor(parser.queryWorkspace('wait'), 'control_wait')).toBeDefined();
    });

    test('indexing does not reorder the caller-owned catalogue array', () => {
        const t = types();
        const catalogue = [t.say, t.add, t.wait, t.multiply];
        const original = [...catalogue];
        const parser = new WorkspaceQuerier();
        parser.indexWorkspace(catalogue);
        expect(catalogue).toEqual(original);
    });

    test('a focused catalogue containing only one recursive operator remains queryable', () => {
        const result = query([types().add], '1 + 2');
        expect(resultFor(result, 'operator_add').getBlock().inputs).toEqual(['1', '2']);
    });

    test.each([
        ['=', 'operator_equals', 'equals'],
        ['>', 'operator_gt', 'greater'],
        ['<', 'operator_lt', 'less']
    ])('can continue a complete reporter through %s without flattening it into text', (operator, id, key) => {
        const t = types();
        const result = resultFor(query([t.xPosition, t[key]], `x position ${operator}`), id);
        expect(result).toBeDefined();
        expect(result.isTruncated).toBe(false);
        expect(inputIds(result.getBlock())[0]).toBe('motion_xposition');
    });

    test('retains a spaced existing variable identity as the left comparison operand', () => {
        const variable = new BlockInputEnum([['Player Score', 'title-spaced']], 0, 0, false);
        const getter = blockType('data_variable', BlockShape.Round, [variable]);
        const comparison = resultFor(query([getter, types().equals], 'Player Score ='), 'operator_equals')
            .getBlock();
        expect(inputIds(comparison)[0]).toBe('data_variable');
        expect(comparison.inputs[0].inputs[0]).toEqual({string: 'Player Score', value: 'title-spaced'});
    });

    test('retains a literal as the left operand while its comparison is still being composed', () => {
        const comparison = resultFor(query([types().equals], '23 ='), 'operator_equals').getBlock();
        expect(comparison.inputs).toEqual(['23', '']);
    });

    test('matches labels case-insensitively while retaining typed literal case', () => {
        const result = query([types().say], 'SAY Hello Andy');
        const instance = resultFor(result, 'looks_say').getBlock();
        expect(instance.inputs).toEqual(['Hello Andy']);
        expect(resultFor(result, 'looks_say').toText(true)).toBe('SAY Hello Andy');
    });

    test('normalizes non-breaking spaces used by localized Blockly labels', () => {
        const result = query([types().move], 'move\u00a010\u00a0steps');
        expect(resultFor(result, 'motion_movesteps').getBlock().inputs).toEqual(['10']);
    });

    test('accepts extra ordinary spaces between tokens', () => {
        const result = query([types().move], 'move   10    steps');
        expect(resultFor(result, 'motion_movesteps').getBlock().inputs).toEqual(['10']);
    });

    test('completes a truncated command without losing the typed prefix', () => {
        const result = query([types().wait], 'wai').results[0];
        expect(result.isTruncated).toBe(true);
        expect(result.toText(false)).toBe('wait ');
        expect(result.getBlock().inputs).toEqual(['0']);
    });

    test.each([
        ['-2.5', '-2.5'],
        ['1e3', '1e3'],
        ['0x10', '0x10'],
        ['Infinity', 'Infinity']
    ])('accepts Scratch-compatible numeric literal %s', (literal, expected) => {
        const result = query([types().move], `move ${literal} steps`);
        expect(resultFor(result, 'motion_movesteps').getBlock().inputs).toEqual([expected]);
    });

    test('ends a number before adjacent native label punctuation', () => {
        const setVolume = blockType('sound_setvolumeto', BlockShape.Stack,
            ['set volume to', numberInput(0), '%']);
        const result = resultFor(query([setVolume], 'set volume to 100%'), setVolume.id);
        expect(result.getBlock().inputs).toEqual(['100']);
        expect(result.isTruncated).toBe(false);
        expect(result.token.isProper).toBe(true);
    });

    test.each([
        ['23+23','+'], ['23 +23','+'], ['23 + 23','+'],
        ['23-23','-'], ['23 -23','-'], ['23 - 23','-']
    ])('keeps adjacent arithmetic %s equivalent to its spaced form', (text, symbol) => {
        const operation = blockType(symbol === '+' ? 'operator_add' : 'operator_subtract', BlockShape.Round,
            [numberInput(0),symbol,numberInput(1)]);
        expect(resultFor(query([operation],text),operation.id).getBlock().inputs).toEqual(['23','23']);
    });

    test.each(['+23','-23'])('a signed number %s in a fresh input remains a literal', text => {
        expect(resultFor(query([types().move],`move ${text} steps`),'motion_movesteps').getBlock().inputs)
            .toEqual([text]);
    });

    test.each(['banana', '2px', '--1'])('rejects invalid number %j in a number-only slot', literal => {
        expect(resultFor(query([types().move], `move ${literal} steps`), 'motion_movesteps')).toBeUndefined();
    });

    test('preserves a complete mixed-case hexadecimal colour', () => {
        const colour = new BlockInputColour(0, -1);
        const setColour = blockType('pen_setPenColorToColor', BlockShape.Stack,
            ['set pen color to', colour]);
        const result = query([setColour], 'set pen color to #Aa10fF');
        expect(resultFor(result, setColour.id).getBlock().inputs).toEqual(['#Aa10fF']);
    });

    test.each(['#fff', '#gg0000', '#1234567'])('rejects malformed colour %j', value => {
        const colour = new BlockInputColour(0, -1);
        const setColour = blockType('pen_setPenColorToColor', BlockShape.Stack,
            ['set pen color to', colour]);
        expect(resultFor(query([setColour], `set pen color to ${value}`), setColour.id)).toBeUndefined();
    });

    test('resolves a localized multiword dropdown to its stable internal value', () => {
        const target = new BlockInputEnum([
            ['random position', '_random_'],
            ['mouse-pointer', '_mouse_'],
            ['Sprite 1', 'sprite-id']
        ], 0, 0, false);
        const point = blockType('motion_pointtowards', BlockShape.Stack,
            ['point towards', target]);
        const instance = resultFor(query([point], 'POINT TOWARDS sprite 1'), point.id).getBlock();
        expect(instance.inputs).toEqual([{string: 'Sprite 1', value: 'sprite-id'}]);
    });

    test.each([
        ['score', 'global-score'],
        ['my score', 'spaced'],
        ['myScore', 'camel'],
        ['Player Score', 'title-spaced'],
        ['playerScore', 'lower-camel'],
        ['SCORE BOARD', 'uppercase-spaced'],
        ['score-board', 'punctuated'],
        ['lives2', 'numbered']
    ])('selects the exact existing variable identity named %j', (name, id) => {
        const variable = new BlockInputEnum([
            ['score', 'global-score'],
            ['my score', 'spaced'],
            ['myScore', 'camel'],
            ['Player Score', 'title-spaced'],
            ['playerScore', 'lower-camel'],
            ['SCORE BOARD', 'uppercase-spaced'],
            ['score-board', 'punctuated'],
            ['lives2', 'numbered']
        ], 0, 0, false);
        const value = stringInput(1);
        const set = blockType('data_setvariableto', BlockShape.Stack,
            ['set', variable, 'to', value]);
        const matches = query([set], `set ${name} to 10`).results
            .map(result => result.getBlock().inputs[0]);
        expect(matches).toContainEqual({string: name, value: id});
    });

    test('distinguishes a spaced name from its camelCase neighbour during partial completion', () => {
        const variable = new BlockInputEnum([
            ['my score', 'spaced'],
            ['myScore', 'camel']
        ], 0, 0, false);
        const value = stringInput(1);
        const set = blockType('data_setvariableto', BlockShape.Stack,
            ['set', variable, 'to', value]);
        const spaced = query([set], 'set my s').results.map(result => result.getBlock().inputs[0].value);
        const camel = query([set], 'set mys').results.map(result => result.getBlock().inputs[0].value);
        expect(spaced).toEqual(['spaced']);
        expect(camel).toEqual(['camel']);
    });

    test('retains case-colliding variable identities instead of silently guessing one', () => {
        const variable = new BlockInputEnum([
            ['score', 'lower'],
            ['Score', 'title'],
            ['SCORE', 'upper']
        ], 0, 0, false);
        const value = stringInput(1);
        const set = blockType('data_setvariableto', BlockShape.Stack,
            ['set', variable, 'to', value]);
        const matches = query([set], 'set SCORE to 1').results
            .map(result => result.getBlock().inputs[0].value);
        expect(matches).toEqual(expect.arrayContaining(['lower', 'title', 'upper']));
        expect(matches).toHaveLength(3);
        expect(matches[0]).toBe('upper');
    });

    test('handles an existing variable name containing connective words and quotes', () => {
        const variable = new BlockInputEnum([
            ['fish to fry', 'connective'],
            ['cake & "icing"', 'quoted']
        ], 0, 0, false);
        const value = stringInput(1);
        const set = blockType('data_setvariableto', BlockShape.Stack,
            ['set', variable, 'to', value]);
        const connective = query([set], 'set fish to fry to 50').results
            .map(result => result.getBlock().inputs[0].value);
        const quoted = query([set], 'set cake & "icing" to 50').results
            .map(result => result.getBlock().inputs[0].value);
        expect(connective).toContain('connective');
        expect(quoted).toContain('quoted');
    });

    test('keeps project-wide broadcast identity stable across sprite-specific catalogues', () => {
        const spriteOneMessages = new BlockInputEnum([
            ['party time', 'broadcast-party'],
            ['levelStart', 'broadcast-level']
        ], 0, 0, false);
        const spriteTwoMessages = new BlockInputEnum([
            ['levelStart', 'broadcast-level'],
            ['party time', 'broadcast-party']
        ], 0, 0, false);
        const spriteOneHat = blockType('event_whenbroadcastreceived', BlockShape.Hat,
            ['when I receive', spriteOneMessages]);
        const spriteTwoHat = blockType('event_whenbroadcastreceived', BlockShape.Hat,
            ['when I receive', spriteTwoMessages]);
        for (const hat of [spriteOneHat, spriteTwoHat]) {
            const party = resultFor(query([hat], 'when I receive party time'), hat.id).getBlock();
            const level = resultFor(query([hat], 'when I receive levelStart'), hat.id).getBlock();
            expect(party.inputs[0]).toEqual({string: 'party time', value: 'broadcast-party'});
            expect(level.inputs[0]).toEqual({string: 'levelStart', value: 'broadcast-level'});
        }
    });

    test('keeps sprite-local variable catalogues isolated while sharing global identities', () => {
        const makeSet = options => {
            const variable = new BlockInputEnum(options, 0, 0, false);
            const value = stringInput(1);
            return blockType('data_setvariableto', BlockShape.Stack,
                ['set', variable, 'to', value]);
        };
        const spriteOne = makeSet([
            ['World Score', 'global-world-score'],
            ['sprite one score', 'sprite-one-local']
        ]);
        const spriteTwo = makeSet([
            ['World Score', 'global-world-score'],
            ['spriteTwoScore', 'sprite-two-local']
        ]);
        const globalOne = resultFor(query([spriteOne], 'set World Score to 5'), spriteOne.id).getBlock();
        const globalTwo = resultFor(query([spriteTwo], 'set World Score to 5'), spriteTwo.id).getBlock();
        expect(globalOne.inputs[0].value).toBe('global-world-score');
        expect(globalTwo.inputs[0].value).toBe('global-world-score');
        expect(resultFor(query([spriteTwo], 'set sprite one score to 5'), spriteTwo.id)).toBeUndefined();
        expect(resultFor(query([spriteOne], 'set spriteTwoScore to 5'), spriteOne.id)).toBeUndefined();
    });

    test('queries a large realistic variable menu without exhausting parser limits', () => {
        const options = Array.from({length: 300}, (_, index) => [
            `player ${String(index).padStart(3, '0')} score`,
            `variable-${index}`
        ]);
        const variable = new BlockInputEnum(options, 0, 0, false);
        const value = stringInput(1);
        const set = blockType('data_setvariableto', BlockShape.Stack,
            ['set', variable, 'to', value]);
        const result = query([set], 'set player 237 score to 99');
        expect(result.limited).toBe(false);
        expect(resultFor(result, set.id).getBlock().inputs[0]).toEqual({
            string: 'player 237 score',
            value: 'variable-237'
        });
    });

    test('filters action-only dropdown rows out of the grammar', () => {
        const variable = new BlockInputEnum([
            ['score', 'score-id'],
            ['Rename variable', 'RENAME_VARIABLE_ID'],
            ['Delete variable', 'DELETE_VARIABLE_ID']
        ], 0, 0, false);
        const show = blockType('data_showvariable', BlockShape.Stack, ['show variable', variable]);
        expect(resultFor(query([show], 'show variable score'), show.id)).toBeDefined();
        expect(resultFor(query([show], 'show variable rename variable'), show.id)).toBeUndefined();
        expect(resultFor(query([show], 'show variable delete variable'), show.id)).toBeUndefined();
    });

    test('parses a quoted string containing command words as one atomic literal', () => {
        const result = resultFor(query([types().say, types().wait], 'say "wait for me"'), 'looks_say');
        expect(result.getBlock().inputs).toEqual(['wait for me']);
        expect(result.toText(true)).toBe('say "wait for me"');
    });

    test('parses escaped quotes inside a quoted string', () => {
        const result = resultFor(query([types().say], 'say "Andy \\"said hi\\""'), 'looks_say');
        expect(result.getBlock().inputs).toEqual(['Andy "said hi"']);
    });

    test('parses an explicitly empty quoted string', () => {
        const result = resultFor(query([types().say], 'say ""'), 'looks_say');
        expect(result.getBlock().inputs).toEqual(['']);
    });

    test('prefers a nested reporter over consuming its syntax as plain text', () => {
        const t = types();
        const result = resultFor(query([t.say, t.add], 'say 1 + 2'), 'looks_say');
        expect(inputIds(result.getBlock())).toEqual(['operator_add']);
        expect(result.getBlock().inputs[0].inputs).toEqual(['1', '2']);
    });

    test('allows a round reporter in a number input', () => {
        const t = types();
        const result = resultFor(query([t.move, t.xPosition], 'move x position steps'), 'motion_movesteps');
        expect(inputIds(result.getBlock())).toEqual(['motion_xposition']);
    });

    test('allows a boolean reporter in a general string input', () => {
        const t = types();
        const result = resultFor(query([t.say, t.mouseDown], 'say mouse down?'), 'looks_say');
        expect(inputIds(result.getBlock())).toEqual(['sensing_mousedown']);
    });

    test('reports a round value in a boolean-only input as an illegal interpretation', () => {
        const t = types();
        const result = query([t.not, t.xPosition], 'not x position');
        expect(result.results).toHaveLength(0);
        expect(result.illegalResult).not.toBeNull();
        expect(result.illegalResult.toText(false)).toBe('not x position');
    });

    test('chooses the shortest completion when several illegal interpretations exist', () => {
        const condition = booleanInput(0);
        const long = blockType('long_check', BlockShape.Boolean,
            ['check', condition, 'with ceremony']);
        const short = blockType('short_check', BlockShape.Boolean, ['check', booleanInput(0)]);
        const result = query([long, short, types().xPosition], 'check x position');
        expect(result.results).toHaveLength(0);
        expect(result.illegalResult.toText(false)).toBe('check x position');
    });

    test('does not place a hat block inside a C-shaped statement input', () => {
        const t = types();
        const result = query([t.repeat, t.flag], 'repeat 2 when green flag clicked');
        expect(resultFor(result, 'control_repeat')).toBeUndefined();
    });

    test('nests a stack command in a C-shaped statement input', () => {
        const t = types();
        const result = resultFor(query([t.repeat, t.say], 'repeat 2 say hello'), 'control_repeat');
        const instance = result.getBlock();
        expect(inputIds(instance)).toEqual(['2', 'looks_say']);
        expect(instance.inputs[1].inputs).toEqual(['hello']);
    });

    test('nests both a boolean condition and a statement body', () => {
        const t = types();
        const result = resultFor(query([t.ifThen, t.equals, t.say], 'if 1 = 1 then say yes'), 'control_if');
        const instance = result.getBlock();
        expect(inputIds(instance)).toEqual(['operator_equals', 'looks_say']);
        expect(instance.inputs[0].inputs).toEqual(['1', '1']);
        expect(instance.inputs[1].inputs).toEqual(['yes']);
    });

    test('honours multiplication precedence inside addition', () => {
        const t = types();
        const result = resultFor(query([t.add, t.multiply], '1 + 2 * 3'), 'operator_add').getBlock();
        expect(inputIds(result)).toEqual(['1', 'operator_multiply']);
        expect(result.inputs[1].inputs).toEqual(['2', '3']);
    });

    test('parentheses override normal arithmetic precedence', () => {
        const t = types();
        const result = resultFor(query([t.add, t.multiply], '(1 + 2) * 3'), 'operator_multiply').getBlock();
        expect(inputIds(result)).toEqual(['operator_add', '3']);
        expect(result.inputs[0].inputs).toEqual(['1', '2']);
    });

    test('equal-precedence arithmetic associates to the left', () => {
        const result = resultFor(query([types().add], '1 + 2 + 3'), 'operator_add').getBlock();
        expect(inputIds(result)).toEqual(['operator_add', '3']);
        expect(result.inputs[0].inputs).toEqual(['1', '2']);
    });

    test('completes a missing closing parenthesis and marks the result truncated', () => {
        const t = types();
        const result = resultFor(query([t.say, t.add], 'say (1 + 2'), 'looks_say');
        expect(result.isTruncated).toBe(true);
        expect(result.toText(false)).toBe('say (1 + 2)');
    });

    test('returns stack, cap, reporter and hat roots from one index', () => {
        const t = types();
        expect(resultFor(query([t.move, t.stop, t.xPosition, t.flag], 'move'), t.move.id)).toBeDefined();
        expect(resultFor(query([t.move, t.stop, t.xPosition, t.flag], 'stop'), t.stop.id)).toBeDefined();
        expect(resultFor(query([t.move, t.stop, t.xPosition, t.flag], 'x pos'), t.xPosition.id)).toBeDefined();
        expect(resultFor(query([t.move, t.stop, t.xPosition, t.flag], 'when green'), t.flag.id)).toBeDefined();
    });

    test('retains both valid interpretations of an ambiguous Scratch command', () => {
        const motionValue = numberInput(0);
        const motionSet = blockType('motion_setx', BlockShape.Stack, ['set x to', motionValue]);
        const variable = new BlockInputEnum([['x', 'variable-id']], 0, 0, false);
        const value = stringInput(1);
        const variableSet = blockType('data_setvariableto', BlockShape.Stack,
            ['set', variable, 'to', value]);
        const result = query([motionSet, variableSet], 'set x to 10');
        expect(result.results.map(item => item.getBlock().typeInfo.id)).toEqual(
            expect.arrayContaining(['motion_setx', 'data_setvariableto']));
    });

    test('keeps separate query calls independent on one cached workspace index', () => {
        const t = types();
        const parser = new WorkspaceQuerier();
        parser.indexWorkspace([t.move, t.wait]);
        const move = parser.queryWorkspace('move 10 steps');
        const wait = parser.queryWorkspace('wait 2 seconds');
        expect(resultFor(move, t.move.id).getBlock().inputs).toEqual(['10']);
        expect(resultFor(wait, t.wait.id).getBlock().inputs).toEqual(['2']);
        expect(resultFor(move, t.wait.id)).toBeUndefined();
    });

    test('sets the limited flag when the configured result budget is exhausted', () => {
        const previous = WorkspaceQuerier.MAX_RESULTS;
        const warning = jest.spyOn(console, 'warn').mockImplementation(() => {});
        WorkspaceQuerier.MAX_RESULTS = 1;
        try {
            const result = query([types().move, types().wait], 'm');
            expect(result.limited).toBe(true);
            expect(warning).toHaveBeenCalledWith('Warning: Workspace query exceeded maximum result count.');
        } finally {
            WorkspaceQuerier.MAX_RESULTS = previous;
        }
    });
});
