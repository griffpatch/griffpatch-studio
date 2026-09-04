import {
    CONNECTION_MATRIX_GROUP_PREFIX,
    seedConnectionMatrixFixture
} from '../../src/studio/bridge/studio-connection-matrix-fixture';

test('authors the expanded connection matrix and compound reorders as forty-three actions', async () => {
    const groups = [];
    const blocks = [];
    let pendingType = null;
    const connection = name => ({name, connect: jest.fn()});
    const ScratchBlocks = {
        Events: {setGroup: group => groups.push(group)},
        Xml: {
            textToDom: text => {
                pendingType = text.match(/<block type="([^"]+)"/)[1];
                return {firstElementChild: {text}};
            },
            domToBlock: xml => {
                const inputs = new Map();
                const block = {
                    id: `block-${blocks.length + 1}`,
                    type: pendingType,
                    xml: xml.text,
                    moveBy: jest.fn(),
                    previousConnection: connection('previous'),
                    nextConnection: connection('next'),
                    outputConnection: connection('output'),
                    unplug: jest.fn(),
                    getInput: name => {
                        if (!inputs.has(name)) {
                            inputs.set(name, {
                                connection: {
                                    ...connection(name),
                                    targetBlock: () => ({setFieldValue: jest.fn()})
                                }
                            });
                        }
                        return inputs.get(name);
                    }
                };
                blocks.push(block);
                return block;
            }
        }
    };
    const workspace = {getAllBlocks: () => blocks};

    await expect(seedConnectionMatrixFixture({
        workspace,
        ScratchBlocks,
        wait: () => Promise.resolve()
    })).resolves.toEqual({stepCount: 43, rootId: 'block-1', blockCount: 32});

    expect(blocks.map(block => block.type)).toEqual([
        'event_whenflagclicked',
        'motion_movesteps',
        'control_repeat',
        'looks_say',
        'operator_join',
        'control_wait_until',
        'operator_equals',
        'sensing_keypressed',
        'sensing_mousedown',
        'looks_think',
        'looks_say',
        'operator_join',
        'operator_join',
        'control_if_else',
        'sensing_mousedown',
        'looks_say',
        'looks_think',
        'motion_turnright',
        'control_wait_until',
        'operator_and',
        'sensing_touchingobject',
        'sensing_keypressed',
        'motion_goto',
        'motion_goto',
        'motion_glideto',
        'control_if_else',
        'motion_pointindirection',
        'motion_pointindirection',
        'motion_movesteps',
        'motion_goto',
        'motion_turnright',
        'motion_turnleft'
    ]);
    expect(blocks[0].moveBy).toHaveBeenCalledWith(160, 120);
    expect(blocks[1].xml).toContain('math_number');
    expect(blocks[17].xml).toContain('<field name="NUM">15</field>');
    expect(blocks[4].xml).toContain('STRING1');
    expect(blocks[6].xml).toContain('<field name="TEXT">50</field>');
    expect(blocks[7].xml).toContain('sensing_keyoptions');
    expect(blocks[23].unplug).toHaveBeenCalledWith(true);
    expect(blocks[24].unplug).toHaveBeenCalledWith(true);
    expect(blocks[29].unplug).toHaveBeenCalledWith(false);
    expect(blocks[29].moveBy).toHaveBeenCalledWith(0, -192);
    expect(blocks[31].nextConnection.connect).toHaveBeenCalledWith(blocks[28].previousConnection);
    expect(blocks[29].unplug).toHaveBeenLastCalledWith(true);
    expect(blocks[30].nextConnection.connect).toHaveBeenCalledWith(blocks[29].previousConnection);
    expect(blocks[29].nextConnection.connect).toHaveBeenCalledWith(blocks[31].previousConnection);
    expect(groups.filter(Boolean)).toEqual(Array.from(
        {length: 43},
        (_, index) => `${CONNECTION_MATRIX_GROUP_PREFIX}-${index + 1}`
    ));
    expect(groups.filter(group => group === false)).toHaveLength(43);
});
