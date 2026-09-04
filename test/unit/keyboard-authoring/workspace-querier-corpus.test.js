import WorkspaceQuerier from '../../../src/addons/addons/middle-click-popup/WorkspaceQuerier';
import {
    BlockInputBlock,
    BlockInputBoolean,
    BlockInputColour,
    BlockInputEnum,
    BlockInputNumber,
    BlockInputString,
    BlockShape,
    BlockTypeInfo
} from '../../../src/addons/addons/middle-click-popup/BlockTypeInfo';

const input = {
    boolean: index => new BlockInputBoolean(index, -1),
    colour: index => new BlockInputColour(index, -1),
    enum: (index, values) => new BlockInputEnum(values.map(value => [value, value]), index, 0, false),
    number: index => new BlockInputNumber(index, -1, '0'),
    stack: index => new BlockInputBlock(index, -1),
    string: index => new BlockInputString(index, -1, '')
};

const type = (id, shape, parts) => ({
    id,
    shape,
    parts,
    inputs: parts.filter(part => typeof part !== 'string'),
    createBlock: BlockTypeInfo.prototype.createBlock
});

const e = (id, shape, parts, query) => ({type: type(id, shape, parts), query});
const n = input.number;
const s = input.string;
const b = input.boolean;
const c = input.colour;
const k = input.stack;
const menu = input.enum;

// These phrases and shapes mirror the English core Scratch flyout. Dynamic
// project identities are supplied explicitly so this remains a deterministic
// unit corpus rather than a browser snapshot with unstable generated IDs.
const corpus = [
    e('motion_movesteps', BlockShape.Stack, ['move', n(0), 'steps'], 'move 10 steps'),
    e('motion_turnright', BlockShape.Stack, ['turn clockwise', n(0), 'degrees'], 'turn clockwise 15 degrees'),
    e('motion_turnleft', BlockShape.Stack, ['turn anticlockwise', n(0), 'degrees'], 'turn anticlockwise 15 degrees'),
    e('motion_goto', BlockShape.Stack, ['go to', menu(0, ['mouse-pointer', 'random position'])],
        'go to random position'),
    e('motion_gotoxy', BlockShape.Stack, ['go to x:', n(0), 'y:', n(1)], 'go to x: 20 y: -10'),
    e('motion_glideto', BlockShape.Stack,
        ['glide', n(0), 'secs to', menu(1, ['mouse-pointer', 'random position'])],
        'glide 1 secs to mouse-pointer'),
    e('motion_glidesecstoxy', BlockShape.Stack,
        ['glide', n(0), 'secs to x:', n(1), 'y:', n(2)], 'glide 1 secs to x: 20 y: -10'),
    e('motion_pointindirection', BlockShape.Stack, ['point in direction', n(0)], 'point in direction 90'),
    e('motion_pointtowards', BlockShape.Stack,
        ['point towards', menu(0, ['mouse-pointer', 'random direction', 'Sprite 2'])], 'point towards Sprite 2'),
    e('motion_changexby', BlockShape.Stack, ['change x by', n(0)], 'change x by 10'),
    e('motion_setx', BlockShape.Stack, ['set x to', n(0)], 'set x to 25'),
    e('motion_changeyby', BlockShape.Stack, ['change y by', n(0)], 'change y by -5'),
    e('motion_sety', BlockShape.Stack, ['set y to', n(0)], 'set y to 0'),
    e('motion_ifonedgebounce', BlockShape.Stack, ['if on edge, bounce'], 'if on edge, bounce'),
    e('motion_setrotationstyle', BlockShape.Stack,
        ['set rotation style', menu(0, ['left-right', "don't rotate", 'all around'])],
        "set rotation style don't rotate"),
    e('motion_xposition', BlockShape.Round, ['x position'], 'x position'),
    e('motion_yposition', BlockShape.Round, ['y position'], 'y position'),
    e('motion_direction', BlockShape.Round, ['direction'], 'direction'),

    e('looks_sayforsecs', BlockShape.Stack, ['say', s(0), 'for', n(1), 'seconds'], 'say hello for 2 seconds'),
    e('looks_say', BlockShape.Stack, ['say', s(0)], 'say hello'),
    e('looks_thinkforsecs', BlockShape.Stack, ['think', s(0), 'for', n(1), 'seconds'],
        'think Hmm... for 2 seconds'),
    e('looks_think', BlockShape.Stack, ['think', s(0)], 'think Hmm...'),
    e('looks_switchcostumeto', BlockShape.Stack,
        ['switch costume to', menu(0, ['costume1', 'costume 2'])], 'switch costume to costume 2'),
    e('looks_nextcostume', BlockShape.Stack, ['next costume'], 'next costume'),
    e('looks_switchbackdropto', BlockShape.Stack,
        ['switch backdrop to', menu(0, ['backdrop1', 'next backdrop', 'random backdrop'])],
        'switch backdrop to random backdrop'),
    e('looks_switchbackdroptoandwait', BlockShape.Stack,
        ['switch backdrop to', menu(0, ['backdrop1', 'next backdrop']), 'and wait'],
        'switch backdrop to backdrop1 and wait'),
    e('looks_nextbackdrop', BlockShape.Stack, ['next backdrop'], 'next backdrop'),
    e('looks_changeeffectby', BlockShape.Stack,
        ['change', menu(0, ['color', 'fisheye', 'ghost']), 'effect by', n(1)], 'change ghost effect by 10'),
    e('looks_seteffectto', BlockShape.Stack,
        ['set', menu(0, ['color', 'fisheye', 'ghost']), 'effect to', n(1)], 'set color effect to 25'),
    e('looks_cleargraphiceffects', BlockShape.Stack, ['clear graphic effects'], 'clear graphic effects'),
    e('looks_changesizeby', BlockShape.Stack, ['change size by', n(0)], 'change size by 10'),
    e('looks_setsizeto', BlockShape.Stack, ['set size to', n(0), '%'], 'set size to 100 %'),
    e('looks_show', BlockShape.Stack, ['show'], 'show'),
    e('looks_hide', BlockShape.Stack, ['hide'], 'hide'),
    e('looks_gotofrontback', BlockShape.Stack,
        ['go to', menu(0, ['front', 'back']), 'layer'], 'go to front layer'),
    e('looks_goforwardbackwardlayers', BlockShape.Stack,
        ['go', menu(0, ['forward', 'backward']), n(1), 'layers'], 'go backward 2 layers'),
    e('looks_costumenumbername', BlockShape.Round,
        ['costume', menu(0, ['number', 'name'])], 'costume name'),
    e('looks_backdropnumbername', BlockShape.Round,
        ['backdrop', menu(0, ['number', 'name'])], 'backdrop number'),
    e('looks_size', BlockShape.Round, ['size'], 'size'),

    e('sound_playuntildone', BlockShape.Stack,
        ['play sound', menu(0, ['Meow', 'Pop']), 'until done'], 'play sound Meow until done'),
    e('sound_play', BlockShape.Stack, ['start sound', menu(0, ['Meow', 'Pop'])], 'start sound Pop'),
    e('sound_stopallsounds', BlockShape.Stack, ['stop all sounds'], 'stop all sounds'),
    e('sound_changeeffectby', BlockShape.Stack,
        ['change', menu(0, ['pitch', 'pan left/right']), 'effect by', n(1)],
        'change pitch effect by 10'),
    e('sound_seteffectto', BlockShape.Stack,
        ['set', menu(0, ['pitch', 'pan left/right']), 'effect to', n(1)],
        'set pan left/right effect to 50'),
    e('sound_cleareffects', BlockShape.Stack, ['clear sound effects'], 'clear sound effects'),
    e('sound_changevolumeby', BlockShape.Stack, ['change volume by', n(0)], 'change volume by -10'),
    e('sound_setvolumeto', BlockShape.Stack, ['set volume to', n(0), '%'], 'set volume to 100%'),
    e('sound_volume', BlockShape.Round, ['volume'], 'volume'),

    e('event_whenflagclicked', BlockShape.Hat, ['when green flag clicked'], 'when green flag clicked'),
    e('event_whenkeypressed', BlockShape.Hat,
        ['when', menu(0, ['space', 'left arrow', 'any']), 'key pressed'], 'when left arrow key pressed'),
    e('event_whenthisspriteclicked', BlockShape.Hat, ['when this sprite clicked'], 'when this sprite clicked'),
    e('event_whenbackdropswitchesto', BlockShape.Hat,
        ['when backdrop switches to', menu(0, ['backdrop1', 'backdrop 2'])],
        'when backdrop switches to backdrop 2'),
    e('event_whengreaterthan', BlockShape.Hat,
        ['when', menu(0, ['loudness', 'timer']), '>', n(1)], 'when timer > 10'),
    e('event_whenbroadcastreceived', BlockShape.Hat,
        ['when I receive', menu(0, ['message1', 'levelStart'])], 'when I receive levelStart'),
    e('event_broadcast', BlockShape.Stack,
        ['broadcast', menu(0, ['message1', 'levelStart'])], 'broadcast message1'),
    e('event_broadcastandwait', BlockShape.Stack,
        ['broadcast', menu(0, ['message1', 'levelStart']), 'and wait'], 'broadcast levelStart and wait'),

    e('control_wait', BlockShape.Stack, ['wait', n(0), 'seconds'], 'wait 1 seconds'),
    e('control_repeat', BlockShape.Stack, ['repeat', n(0), k(1)], 'repeat 10 say hello'),
    e('control_forever', BlockShape.End, ['forever', k(0)], 'forever say hello'),
    e('control_if', BlockShape.Stack, ['if', b(0), 'then', k(1)], 'if 1 = 1 then say yes'),
    e('control_if_else', BlockShape.Stack,
        ['if', b(0), 'then', k(1), 'else', k(2)], 'if 1 = 1 then say yes else say no'),
    e('control_wait_until', BlockShape.Stack, ['wait until', b(0)], 'wait until mouse down?'),
    e('control_repeat_until', BlockShape.Stack,
        ['repeat until', b(0), k(1)], 'repeat until mouse down? move 10 steps'),
    e('control_stop', BlockShape.End,
        ['stop', menu(0, ['all', 'this script'])], 'stop this script'),
    e('control_start_as_clone', BlockShape.Hat, ['when I start as a clone'], 'when I start as a clone'),
    e('control_create_clone_of', BlockShape.Stack,
        ['create clone of', menu(0, ['myself', 'Sprite 2'])], 'create clone of Sprite 2'),
    e('control_delete_this_clone', BlockShape.End, ['delete this clone'], 'delete this clone'),

    e('sensing_touchingobject', BlockShape.Boolean,
        ['touching', menu(0, ['mouse-pointer', 'edge', 'Sprite 2']), '?'], 'touching edge?'),
    e('sensing_touchingcolor', BlockShape.Boolean, ['touching color', c(0), '?'], 'touching color #12Aa34?'),
    e('sensing_coloristouchingcolor', BlockShape.Boolean,
        ['color', c(0), 'is touching', c(1), '?'], 'color #112233 is touching #AABBCC?'),
    e('sensing_distanceto', BlockShape.Round,
        ['distance to', menu(0, ['mouse-pointer', 'Sprite 2'])], 'distance to Sprite 2'),
    e('sensing_askandwait', BlockShape.Stack, ['ask', s(0), 'and wait'], 'ask What is your name? and wait'),
    e('sensing_answer', BlockShape.Round, ['answer'], 'answer'),
    e('sensing_keypressed', BlockShape.Boolean,
        ['key', menu(0, ['space', 'left arrow', 'any']), 'pressed?'], 'key any pressed?'),
    e('sensing_mousedown', BlockShape.Boolean, ['mouse down?'], 'mouse down?'),
    e('sensing_mousex', BlockShape.Round, ['mouse x'], 'mouse x'),
    e('sensing_mousey', BlockShape.Round, ['mouse y'], 'mouse y'),
    e('sensing_setdragmode', BlockShape.Stack,
        ['set drag mode', menu(0, ['draggable', 'not draggable'])], 'set drag mode draggable'),
    e('sensing_loudness', BlockShape.Round, ['loudness'], 'loudness'),
    e('sensing_timer', BlockShape.Round, ['timer'], 'timer'),
    e('sensing_resettimer', BlockShape.Stack, ['reset timer'], 'reset timer'),
    e('sensing_current', BlockShape.Round,
        ['current', menu(0, ['year', 'month', 'date', 'day of week', 'hour', 'minute', 'second'])],
        'current day of week'),
    e('sensing_dayssince2000', BlockShape.Round, ['days since 2000'], 'days since 2000'),
    e('sensing_username', BlockShape.Round, ['username'], 'username'),

    e('operator_add', BlockShape.Round, [n(0), '+', n(1)], '2 + 3'),
    e('operator_subtract', BlockShape.Round, [n(0), '-', n(1)], '7 - 4'),
    e('operator_multiply', BlockShape.Round, [n(0), '*', n(1)], '6 * 5'),
    e('operator_divide', BlockShape.Round, [n(0), '/', n(1)], '8 / 2'),
    e('operator_random', BlockShape.Round, ['pick random', n(0), 'to', n(1)], 'pick random 1 to 10'),
    e('operator_gt', BlockShape.Boolean, [s(0), '>', s(1)], '10 > 2'),
    e('operator_lt', BlockShape.Boolean, [s(0), '<', s(1)], '2 < 10'),
    e('operator_equals', BlockShape.Boolean, [s(0), '=', s(1)], 'cake = cake'),
    e('operator_and', BlockShape.Boolean, [b(0), 'and', b(1)], 'mouse down? and touching edge?'),
    e('operator_or', BlockShape.Boolean, [b(0), 'or', b(1)], 'mouse down? or touching edge?'),
    e('operator_not', BlockShape.Boolean, ['not', b(0)], 'not mouse down?'),
    e('operator_join', BlockShape.Round, ['join', s(0), s(1)], 'join apple banana'),
    e('operator_letter_of', BlockShape.Round, ['letter', n(0), 'of', s(1)], 'letter 1 of world'),
    e('operator_length', BlockShape.Round, ['length of', s(0)], 'length of world'),
    e('operator_contains', BlockShape.Boolean, [s(0), 'contains', s(1), '?'], 'hello contains ell?'),
    e('operator_mod', BlockShape.Round, [n(0), 'mod', n(1)], '10 mod 3'),
    e('operator_round', BlockShape.Round, ['round', n(0)], 'round 3.14'),
    e('operator_mathop', BlockShape.Round,
        [menu(0, ['abs', 'floor', 'ceiling', 'sqrt', 'sin', 'cos', 'tan', 'ln', 'log']), 'of', n(1)],
        'sqrt of 9'),

    e('data_variable', BlockShape.Round,
        [menu(0, ['score', 'playerScore', 'Player Score'])], 'Player Score'),
    e('data_setvariableto', BlockShape.Stack,
        ['set', menu(0, ['score', 'playerScore', 'Player Score']), 'to', s(1)],
        'set playerScore to 50'),
    e('data_changevariableby', BlockShape.Stack,
        ['change', menu(0, ['score', 'playerScore', 'Player Score']), 'by', n(1)],
        'change Player Score by 1'),
    e('data_showvariable', BlockShape.Stack,
        ['show variable', menu(0, ['score', 'playerScore', 'Player Score'])], 'show variable score'),
    e('data_hidevariable', BlockShape.Stack,
        ['hide variable', menu(0, ['score', 'playerScore', 'Player Score'])], 'hide variable playerScore'),
    e('data_addtolist', BlockShape.Stack,
        ['add', s(0), 'to', menu(1, ['shopping list', 'highScores'])], 'add apples to shopping list'),
    e('data_deleteoflist', BlockShape.Stack,
        ['delete', n(0), 'of', menu(1, ['shopping list', 'highScores'])], 'delete 1 of highScores'),
    e('data_deletealloflist', BlockShape.Stack,
        ['delete all of', menu(0, ['shopping list', 'highScores'])], 'delete all of shopping list'),
    e('data_insertatlist', BlockShape.Stack,
        ['insert', s(0), 'at', n(1), 'of', menu(2, ['shopping list', 'highScores'])],
        'insert cake at 2 of shopping list'),
    e('data_replaceitemoflist', BlockShape.Stack,
        ['replace item', n(0), 'of', menu(1, ['shopping list', 'highScores']), 'with', s(2)],
        'replace item 1 of highScores with 9000'),
    e('data_itemoflist', BlockShape.Round,
        ['item', n(0), 'of', menu(1, ['shopping list', 'highScores'])], 'item 2 of shopping list'),
    e('data_itemnumoflist', BlockShape.Round,
        ['item # of', s(0), 'in', menu(1, ['shopping list', 'highScores'])],
        'item # of cake in shopping list'),
    e('data_lengthoflist', BlockShape.Round,
        ['length of', menu(0, ['shopping list', 'highScores'])], 'length of highScores'),
    e('data_listcontainsitem', BlockShape.Boolean,
        [menu(0, ['shopping list', 'highScores']), 'contains', s(1), '?'],
        'shopping list contains apples?'),
    e('data_showlist', BlockShape.Stack,
        ['show list', menu(0, ['shopping list', 'highScores'])], 'show list highScores'),
    e('data_hidelist', BlockShape.Stack,
        ['hide list', menu(0, ['shopping list', 'highScores'])], 'hide list shopping list')
];

const parserForCorpus = () => {
    const parser = new WorkspaceQuerier();
    parser.indexWorkspace(corpus.map(entry => entry.type));
    return parser;
};

const seededRandom = seed => () => {
    seed = ((seed * 1664525) + 1013904223) >>> 0;
    return seed / 0x100000000;
};

const randomText = (random, maximumLength) => {
    const alphabet = [' abcXYZ019+-*/<>=?()[]{}"', "'\\", ',:.%#_\t\n\u00a0\u2603\ud83c\udf82'].join('');
    const length = Math.floor(random() * (maximumLength + 1));
    let value = '';
    for (let index = 0; index < length; index++) {
        value += alphabet[Math.floor(random() * alphabet.length)];
    }
    return value;
};

describe('Scratch core flyout parser corpus', () => {
    const parser = parserForCorpus();

    test.each(corpus.map(entry => [entry.type.id, entry.query]))(
        'parses the canonical %s phrase', (id, query) => {
            const result = parser.queryWorkspace(query);
            expect(result.results.some(candidate => candidate.getBlock().typeInfo.id === id &&
                candidate.token.isProper && !candidate.isTruncated)).toBe(true);
        });

    test('covers the complete representative core category and shape matrix', () => {
        expect(corpus.length).toBeGreaterThanOrEqual(110);
        expect(new Set(corpus.map(entry => entry.type.id)).size).toBe(corpus.length);
        expect(new Set(corpus.map(entry => entry.type.shape))).toEqual(new Set([
            BlockShape.Round, BlockShape.Boolean, BlockShape.Hat, BlockShape.End, BlockShape.Stack
        ]));
        for (const prefix of ['motion_', 'looks_', 'sound_', 'event_', 'control_', 'sensing_', 'operator_', 'data_']) {
            expect(corpus.some(entry => entry.type.id.startsWith(prefix))).toBe(true);
        }
    });

    test('retains every canonical block under deterministic case and whitespace variation', () => {
        const random = seededRandom(0xc451a9);
        for (const entry of corpus) {
            const varied = [...entry.query].map(character => {
                if (character === ' ') return ' '.repeat(1 + Math.floor(random() * 3));
                if (!/[a-z]/i.test(character)) return character;
                return random() < 0.5 ? character.toLowerCase() : character.toUpperCase();
            }).join('');
            const result = parser.queryWorkspace(varied);
            const found = result.results.some(candidate => candidate.getBlock().typeInfo.id === entry.type.id &&
                candidate.token.isProper && !candidate.isTruncated);
            if (!found) throw new Error(`Did not retain ${entry.type.id} for varied query ${JSON.stringify(varied)}`);
        }
    });

    test('survives a deterministic malformed-input corpus without leaking invalid result objects', () => {
        const random = seededRandom(0x5c4a7c4);
        const warning = jest.spyOn(console, 'warn').mockImplementation(() => {});
        try {
            for (let iteration = 0; iteration < 750; iteration++) {
                const text = randomText(random, 96);
                const result = parser.queryWorkspace(text);
                expect(Array.isArray(result.results)).toBe(true);
                expect(typeof result.limited).toBe('boolean');
                for (const candidate of result.results) {
                    expect(typeof candidate.isTruncated).toBe('boolean');
                    expect(corpus).toContainEqual(expect.objectContaining({type: candidate.getBlock().typeInfo}));
                    expect(typeof candidate.toText(false)).toBe('string');
                }
                if (result.illegalResult) {
                    expect(typeof result.illegalResult.toText(false)).toBe('string');
                }
            }
        } finally {
            warning.mockRestore();
        }
    });

    test('is deterministic for repeated malformed and incomplete queries', () => {
        const random = seededRandom(0xb10c17);
        for (let iteration = 0; iteration < 200; iteration++) {
            const text = randomText(random, 64);
            const summarize = result => ({
                illegal: result.illegalResult && result.illegalResult.toText(false),
                limited: result.limited,
                results: result.results.map(candidate => ({
                    id: candidate.getBlock().typeInfo.id,
                    text: candidate.toText(false),
                    truncated: candidate.isTruncated
                }))
            });
            expect(summarize(parser.queryWorkspace(text))).toEqual(summarize(parser.queryWorkspace(text)));
        }
    });

    test.each([
        '((((((((((((((((((((((((((((((((((((((((((((((((',
        String.raw`say "unterminated \" quote ((( ++++`,
        'if not not not not not not not mouse down? then repeat 10',
        '1 + 2 * 3 / 4 mod 5 - 6 + 7 * 8 / 9 mod 10',
        'set Player Score to join join join apple banana cake',
        '\u00a0\u00a0\u00a0when\u00a0I\u00a0receive\u00a0levelStart\u00a0\u00a0'
    ])('keeps adversarial incomplete query bounded: %j', text => {
        const previousResults = WorkspaceQuerier.MAX_RESULTS;
        const previousTokens = WorkspaceQuerier.MAX_TOKENS;
        const warning = jest.spyOn(console, 'warn').mockImplementation(() => {});
        WorkspaceQuerier.MAX_RESULTS = 500;
        WorkspaceQuerier.MAX_TOKENS = 20000;
        try {
            const result = parser.queryWorkspace(text);
            expect(result.results.length).toBeLessThanOrEqual(500);
            expect(typeof result.limited).toBe('boolean');
        } finally {
            WorkspaceQuerier.MAX_RESULTS = previousResults;
            WorkspaceQuerier.MAX_TOKENS = previousTokens;
            warning.mockRestore();
        }
    });
});
