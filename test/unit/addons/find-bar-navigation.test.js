import Utils from '../../../src/addons/addons/find-bar/blockly/Utils';
import BlockInstance from '../../../src/addons/addons/find-bar/blockly/BlockInstance';
import BlockFlasher from '../../../src/addons/addons/find-bar/blockly/BlockFlasher';

jest.mock('../../../src/addons/addons/find-bar/blockly/BlockFlasher', () => ({selectionEffect: jest.fn()}));

const fixture = () => {
    let targetId = 'a';
    let blocks = {a: {id: 'a'}, b: {id: 'b'}};
    const workspace = {getBlockById: id => id === targetId ? blocks[id] : null};
    const utils = Object.create(Utils.prototype);
    utils.addon = {tab: {traps: {getWorkspace: () => workspace}}};
    utils.getEditingTarget = () => ({id: targetId});
    utils.setEditingTarget = jest.fn(id => { targetId = id; });
    utils.scrollBlockIntoViewIfNeeded = jest.fn(async () => false);
    return {utils, blocks, workspace, replace: () => { blocks = {a: {id: 'a'}, b: {id: 'b'}}; }};
};

describe('Find Bar resolved navigation boundary', () => {
    beforeEach(() => { jest.useFakeTimers(); BlockFlasher.selectionEffect.mockClear(); });
    afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });

    test('returns a same-sprite resolved identity and flashes only the live object', async () => {
        const {utils, blocks} = fixture();
        await expect(utils.scrollBlockIntoView(blocks.a)).resolves.toEqual({blockId: 'a', targetId: 'a'});
        jest.runOnlyPendingTimers();
        expect(BlockFlasher.selectionEffect).toHaveBeenCalledWith(blocks.a);
    });

    test('resolves after cross-sprite replacement and callback', async () => {
        const {utils, blocks} = fixture();
        const callback = jest.fn();
        const pending = utils.scrollBlockIntoView(new BlockInstance({id: 'b'}, blocks.b), false, callback);
        jest.runOnlyPendingTimers();
        await expect(pending).resolves.toEqual({blockId: 'b', targetId: 'b'});
        expect(callback).toHaveBeenCalledTimes(1);
    });

    test('a superseded request cannot switch sprites after cancellation settles', async () => {
        const {utils, blocks} = fixture();
        let current = true;
        utils._cancelAnimation = jest.fn();
        const pending = utils.scrollBlockIntoView(new BlockInstance({id: 'b'}, blocks.b), false, null, () => current);
        current = false;
        jest.runOnlyPendingTimers();
        await expect(pending).resolves.toBeUndefined();
        expect(utils.setEditingTarget).not.toHaveBeenCalled();
    });

    test('a manual sprite change during the switch wait prevents completion', async () => {
        const {utils, blocks} = fixture();
        const pending = utils.scrollBlockIntoView(new BlockInstance({id: 'b'}, blocks.b));
        utils.setEditingTarget('a');
        jest.runOnlyPendingTimers();
        await expect(pending).resolves.toBeUndefined();
        expect(utils.scrollBlockIntoViewIfNeeded).not.toHaveBeenCalled();
    });

    test('workspace replacement during scroll cannot publish a stale block', async () => {
        const {utils, blocks, replace} = fixture();
        utils.scrollBlockIntoViewIfNeeded.mockImplementation(async () => { replace(); return true; });
        await expect(utils.scrollBlockIntoView(blocks.a)).resolves.toBeUndefined();
        jest.runOnlyPendingTimers();
        expect(BlockFlasher.selectionEffect).not.toHaveBeenCalled();
    });

    test('delayed flash is cancelled when the request has been superseded', async () => {
        const {utils, blocks} = fixture();
        let current = true;
        await utils.scrollBlockIntoView(blocks.a, false, null, () => current);
        current = false;
        jest.runOnlyPendingTimers();
        expect(BlockFlasher.selectionEffect).not.toHaveBeenCalled();
    });
});
