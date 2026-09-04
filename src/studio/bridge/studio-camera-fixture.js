const CAMERA_FIXTURE_GROUP_PREFIX = 'studio-long-camera-fixture';

const INPUT_XML = {
    control_wait: '<value name="DURATION"><shadow type="math_positive_number">' +
        '<field name="NUM">1</field></shadow></value>',
    looks_sayforsecs: '<value name="MESSAGE"><shadow type="text"><field name="TEXT">Hello!</field></shadow></value>' +
        '<value name="SECS"><shadow type="math_number"><field name="NUM">2</field></shadow></value>',
    looks_thinkforsecs: '<value name="MESSAGE"><shadow type="text"><field name="TEXT">Hmm...</field></shadow></value>' +
        '<value name="SECS"><shadow type="math_number"><field name="NUM">2</field></shadow></value>',
    motion_movesteps: '<value name="STEPS"><shadow type="math_number"><field name="NUM">10</field></shadow></value>',
    motion_turnright: '<value name="DEGREES"><shadow type="math_number"><field name="NUM">15</field></shadow></value>'
};

/**
 * Seed a deliberately awkward manual camera test through public Scratch Blocks
 * APIs. Each block creation is its own Undo group so Studio records the same
 * transaction shape as one palette drag and connection.
 *
 * @param {object} options fixture dependencies
 * @returns {Promise<object>} fixture summary
 */
const seedLongCameraFixture = async ({workspace, ScratchBlocks, wait}) => {
    let step = 0;
    const recordStep = async action => {
        step++;
        ScratchBlocks.Events.setGroup(`${CAMERA_FIXTURE_GROUP_PREFIX}-${step}`);
        try {
            action();
        } finally {
            ScratchBlocks.Events.setGroup(false);
        }
        await wait(120);
    };
    const createBlock = type => {
        const xml = ScratchBlocks.Xml.textToDom(
            `<xml xmlns="http://www.w3.org/1999/xhtml"><block type="${type}">${INPUT_XML[type] || ''}</block></xml>`
        );
        return ScratchBlocks.Xml.domToBlock(xml.firstElementChild, workspace);
    };
    const createTopBlock = async (type, x, y) => {
        let block;
        await recordStep(() => {
            block = createBlock(type);
            block.moveBy(x, y);
        });
        return block;
    };
    const appendBlock = async (tail, type) => {
        let block;
        await recordStep(() => {
            block = createBlock(type);
            tail.nextConnection.connect(block.previousConnection);
        });
        return block;
    };

    const shortTail = await createTopBlock('event_whenflagclicked', 110, 90);
    await appendBlock(shortTail, 'looks_sayforsecs');

    let longTail = await createTopBlock('event_whenthisspriteclicked', 110, 250);
    for (let index = 0; index < 13; index++) {
        longTail = await appendBlock(longTail, index % 3 === 0 ? 'control_wait' : 'motion_movesteps');
    }

    let rightTail = await createTopBlock('event_whenkeypressed', 720, 110);
    rightTail = await appendBlock(rightTail, 'motion_turnright');
    await appendBlock(rightTail, 'looks_thinkforsecs');

    return {stepCount: step};
};

export {
    CAMERA_FIXTURE_GROUP_PREFIX,
    seedLongCameraFixture
};
