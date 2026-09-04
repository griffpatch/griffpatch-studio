import {
    CAMERA_FIXTURE_GROUP_PREFIX,
    seedLongCameraFixture
} from '../../src/studio/bridge/studio-camera-fixture';

test('seeds three camera regions as separate Scratch Blocks undo groups', async () => {
    const groups = [];
    const blocks = [];
    let pendingType = null;
    const ScratchBlocks = {
        Events: {
            setGroup: group => groups.push(group)
        },
        Xml: {
            textToDom: text => {
                pendingType = text.match(/<block type="([^"]+)"/)[1];
                return {firstElementChild: {text}};
            },
            domToBlock: (xml, targetWorkspace) => targetWorkspace.newBlock(pendingType, xml.text)
        }
    };
    const workspace = {
        newBlock: (type, xml) => {
            const block = {
                type,
                xml,
                moveBy: jest.fn(),
                previousConnection: {},
                nextConnection: {
                    connect: jest.fn()
                }
            };
            blocks.push(block);
            return block;
        }
    };

    await expect(seedLongCameraFixture({
        workspace,
        ScratchBlocks,
        wait: () => Promise.resolve()
    })).resolves.toEqual({stepCount: 19});

    expect(blocks).toHaveLength(19);
    expect(blocks.map(block => block.type)).toEqual([
        'event_whenflagclicked',
        'looks_sayforsecs',
        'event_whenthisspriteclicked',
        'control_wait',
        'motion_movesteps',
        'motion_movesteps',
        'control_wait',
        'motion_movesteps',
        'motion_movesteps',
        'control_wait',
        'motion_movesteps',
        'motion_movesteps',
        'control_wait',
        'motion_movesteps',
        'motion_movesteps',
        'control_wait',
        'event_whenkeypressed',
        'motion_turnright',
        'looks_thinkforsecs'
    ]);
    expect(blocks[0].moveBy).toHaveBeenCalledWith(110, 90);
    expect(blocks[2].moveBy).toHaveBeenCalledWith(110, 250);
    expect(blocks[16].moveBy).toHaveBeenCalledWith(720, 110);
    expect(blocks[1].xml).toContain('<shadow type="text">');
    expect(blocks[3].xml).toContain('<shadow type="math_positive_number">');
    expect(blocks[4].xml).toContain('<shadow type="math_number">');
    expect(groups.filter(Boolean)).toEqual(Array.from(
        {length: 19},
        (_, index) => `${CAMERA_FIXTURE_GROUP_PREFIX}-${index + 1}`
    ));
    expect(groups.filter(group => group === false)).toHaveLength(19);
});
