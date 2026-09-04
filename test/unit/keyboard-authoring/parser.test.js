import WorkspaceQuerier from '../../../src/addons/addons/middle-click-popup/WorkspaceQuerier';
import {
    BlockInputColour, BlockInputBoolean, BlockInputString, BlockInputNumber, BlockShape, BlockTypeInfo
} from '../../../src/addons/addons/middle-click-popup/BlockTypeInfo';
import {createCatalogue} from '../../../src/experiments/keyboard-authoring/catalogue';

const type = (id, shape, label, input) => ({
    id, shape, parts: [label, input], inputs: [input], createBlock: BlockTypeInfo.prototype.createBlock
});

afterEach(() => jest.restoreAllMocks());

test('the shared Addons parser formats a typed hex colour using its original query text', () => {
    const parser = new WorkspaceQuerier();
    parser.indexWorkspace([type('pen_setPenColorToColor', BlockShape.Stack,
        'set pen color to', new BlockInputColour(0, -1))]);
    const results = parser.queryWorkspace('set pen color to #AaBbCc').results;
    expect(results).toHaveLength(1);
    expect(results[0].getBlock().inputs).toEqual(['#AaBbCc']);
    expect(results[0].toText(false)).toBe('set pen color to #AaBbCc');
});

test('a complete string interpretation ranks ahead of a partially typed operator', () => {
    jest.spyOn(BlockTypeInfo, 'getBlocks').mockReturnValue([
        type('looks_say', BlockShape.Stack, 'say', new BlockInputString(0, -1, 'Hello!')),
        type('operator_not', BlockShape.Boolean, 'not', new BlockInputBoolean(0, -1))
    ]);
    const catalogue = createCatalogue({workspace:{getVariablesOfType:()=>[{}]}});
    const results = catalogue.search('say no');
    expect(results[0].instance.inputs[0]).toBe('no');
    expect(results[0].text).toBe('say no');
    expect(results.some(result => result.instance.inputs[0]?.typeInfo?.id === 'operator_not')).toBe(true);
});

test('a block-name prefix ranks ahead of an incidental word in another command', () => {
    const duration = new BlockInputNumber(0, -1, '1');
    const message = new BlockInputString(0, -1, 'message1');
    jest.spyOn(BlockTypeInfo, 'getBlocks').mockReturnValue([
        {...type('event_broadcastandwait', BlockShape.Stack, 'broadcast', message),
            parts: ['broadcast', message, 'and wait']},
        {...type('control_wait', BlockShape.Stack, 'wait', duration), parts: ['wait', duration, 'seconds']}
    ]);
    const results = createCatalogue({workspace:{getVariablesOfType:()=>[{}]}}).search('wai');
    expect(results[0].instance.typeInfo.id).toBe('control_wait');
    expect(results[0].text).toBe('wait ');
    expect(results.some(result => result.instance.typeInfo.id === 'event_broadcastandwait')).toBe(true);
});

test('a short command prefix prefers the shortest leading completion, not a longer phrase', () => {
    const duration = new BlockInputNumber(0,-1,'1');
    const condition = new BlockInputBoolean(0,-1);
    jest.spyOn(BlockTypeInfo,'getBlocks').mockReturnValue([
        type('control_wait_until',BlockShape.Stack,'wait until',condition),
        {...type('control_wait',BlockShape.Stack,'wait',duration),parts:['wait',duration,'seconds']}
    ]);
    const results = createCatalogue({workspace:{getVariablesOfType:()=>[{}]}}).search('wa');
    expect(results[0].instance.typeInfo.id).toBe('control_wait');
    expect(results[0].text.trim()).toBe('wait');
});

test('a unique abbreviated command head retains typed arguments through the existing parser', () => {
    const duration = new BlockInputNumber(0,-1,'1');
    jest.spyOn(BlockTypeInfo,'getBlocks').mockReturnValue([
        {...type('control_wait',BlockShape.Stack,'wait',duration),parts:['wait',duration,'seconds']},
        type('control_wait_until',BlockShape.Stack,'wait until',new BlockInputBoolean(0,-1))
    ]);
    const catalogue = createCatalogue({workspace:{getVariablesOfType:()=>[{}]}});
    expect(catalogue.search('wa 4')[0]).toMatchObject({instance:{typeInfo:{id:'control_wait'},inputs:['4']}});
    expect(catalogue.search('w 4')).toEqual([]);
    expect(catalogue.search('wa banana')).toEqual([]);
});

test('ambiguous abbreviated command heads are not guessed', () => {
    const number = new BlockInputNumber(0,-1,'1');
    jest.spyOn(BlockTypeInfo,'getBlocks').mockReturnValue([
        type('control_wait',BlockShape.Stack,'wait',number),
        type('custom_walk',BlockShape.Stack,'walk',number)
    ]);
    expect(createCatalogue({workspace:{getVariablesOfType:()=>[{}]}}).search('wa 4')).toEqual([]);
});
