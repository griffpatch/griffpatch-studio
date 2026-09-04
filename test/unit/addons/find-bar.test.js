import {
    BROADCAST_BLOCKS,
    CLONE_BLOCKS,
    LIST_BLOCKS,
    PROCEDURE_BLOCKS,
    VARIABLE_BLOCKS,
    isBroadcastBlock,
    isCloneBlock,
    isEventBlock,
    isExplorableBlock,
    isListBlock,
    isProcedureBlock,
    isVariableBlock
} from '../../../src/addons/addons/find-bar/blockTypes';
import BlockFlasher from '../../../src/addons/addons/find-bar/blockly/BlockFlasher';
import BlockInstance from '../../../src/addons/addons/find-bar/blockly/BlockInstance';
import BlockItem from '../../../src/addons/addons/find-bar/blockly/BlockItem';

describe('Find Bar block type classification', () => {
    test.each([...VARIABLE_BLOCKS])('%s is a variable block', type => {
        expect(isVariableBlock(type)).toBe(true);
        expect(isExplorableBlock(type)).toBe(true);
    });

    test.each([...LIST_BLOCKS])('%s is a list block', type => {
        expect(isListBlock(type)).toBe(true);
        expect(isExplorableBlock(type)).toBe(true);
    });

    test.each([...BROADCAST_BLOCKS])('%s is a broadcast block', type => {
        expect(isBroadcastBlock(type)).toBe(true);
        expect(isExplorableBlock(type)).toBe(true);
    });

    test.each([...CLONE_BLOCKS])('%s is a clone block', type => {
        expect(isCloneBlock(type)).toBe(true);
        expect(isExplorableBlock(type)).toBe(true);
    });

    test.each([...PROCEDURE_BLOCKS])('%s is a procedure block', type => {
        expect(isProcedureBlock(type)).toBe(true);
        expect(isExplorableBlock(type)).toBe(true);
    });

    test.each([
        'event_whenflagclicked',
        'event_whenkeypressed',
        'event_whenbroadcastreceived',
        'event_whenthisspriteclicked'
    ])('%s is an event block', type => {
        expect(isEventBlock(type)).toBe(true);
        expect(isExplorableBlock(type)).toBe(true);
    });

    test.each([
        ['motion_movesteps', false],
        ['looks_say', false],
        ['event_broadcast', true],
        ['', false],
        [null, false],
        [undefined, false]
    ])('explorable classification for %p is %p', (type, expected) => {
        expect(Boolean(isExplorableBlock(type))).toBe(expected);
    });

    test('a block belongs only to its declared non-event category', () => {
        expect(isVariableBlock('data_listcontents')).toBe(false);
        expect(isListBlock('data_variable')).toBe(false);
        expect(isBroadcastBlock('control_start_as_clone')).toBe(false);
        expect(isCloneBlock('procedures_call')).toBe(false);
        expect(isProcedureBlock('event_whenflagclicked')).toBe(false);
    });
});

describe('Find Bar block references', () => {
    test('BlockInstance keeps stable target and block identities', () => {
        expect(new BlockInstance({id: 'sprite-2'}, {id: 'block-7'})).toEqual({
            targetId: 'sprite-2',
            id: 'block-7'
        });
    });

    test('BlockItem matches its primary block and every duplicate instance', () => {
        const item = new BlockItem('broadcast', 'party time', 'receive-1', 42);
        item.clones = ['send-1', 'send-2'];

        expect(item.matchesID('receive-1')).toBe(true);
        expect(item.matchesID('send-1')).toBe(true);
        expect(item.matchesID('send-2')).toBe(true);
        expect(item.matchesID('unrelated')).toBe(false);
    });

    test('BlockItem stores a normalized search label without changing display text', () => {
        const item = new BlockItem('define', 'Turn Around ()', 'definition', 10);

        expect(item.procCode).toBe('Turn Around ()');
        expect(item.lower).toBe('turn around ()');
    });

    test('BlockFlasher supports both Blockly renderers and shadow fallbacks', () => {
        const newPath = {};
        const oldPath = {};
        const shadowPath = {};

        expect(BlockFlasher.getSvgPath({pathObject: {svgPath: newPath}})).toBe(newPath);
        expect(BlockFlasher.getSvgPath({svgPath_: oldPath})).toBe(oldPath);
        expect(BlockFlasher.getSvgPath({
            getSvgRoot: () => ({querySelector: () => shadowPath})
        })).toBe(shadowPath);
        expect(BlockFlasher.getSvgPath(null)).toBeNull();
    });
});
