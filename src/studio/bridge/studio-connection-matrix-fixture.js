const CONNECTION_MATRIX_GROUP_PREFIX = 'studio-connection-matrix';

const INPUT_XML = {
    motion_movesteps: '<value name="STEPS"><shadow type="math_number"><field name="NUM">10</field></shadow></value>',
    motion_goto: '<value name="TO"><shadow type="motion_goto_menu">' +
        '<field name="TO">_random_</field></shadow></value>',
    motion_glideto: '<value name="SECS"><shadow type="math_number"><field name="NUM">1</field></shadow></value>' +
        '<value name="TO"><shadow type="motion_glideto_menu">' +
        '<field name="TO">_random_</field></shadow></value>',
    motion_pointindirection: '<value name="DIRECTION"><shadow type="math_angle">' +
        '<field name="NUM">90</field></shadow></value>',
    motion_turnright: '<value name="DEGREES"><shadow type="math_number"><field name="NUM">15</field></shadow></value>',
    motion_turnleft: '<value name="DEGREES"><shadow type="math_number"><field name="NUM">15</field></shadow></value>',
    control_repeat: '<value name="TIMES"><shadow type="math_whole_number">' +
        '<field name="NUM">10</field></shadow></value>',
    looks_say: '<value name="MESSAGE"><shadow type="text"><field name="TEXT">Hello!</field></shadow></value>',
    operator_join: '<value name="STRING1"><shadow type="text"><field name="TEXT">apple </field></shadow></value>' +
        '<value name="STRING2"><shadow type="text"><field name="TEXT">banana</field></shadow></value>',
    // Match Scratch's real Operators flyout seed exactly: the right operand of
    // the equality block starts at 50. Later edits remain separate recorded
    // transactions, just as they are after a user drags the palette block.
    operator_equals: '<value name="OPERAND1"><shadow type="text"><field name="TEXT"></field></shadow></value>' +
        '<value name="OPERAND2"><shadow type="text"><field name="TEXT">50</field></shadow></value>',
    sensing_touchingobject: '<value name="TOUCHINGOBJECTMENU"><shadow type="sensing_touchingobjectmenu">' +
        '<field name="TOUCHINGOBJECTMENU">_mouse_</field></shadow></value>',
    sensing_keypressed: '<value name="KEY_OPTION"><shadow type="sensing_keyoptions">' +
        '<field name="KEY_OPTION">space</field></shadow></value>',
    looks_think: '<value name="MESSAGE"><shadow type="text"><field name="TEXT">Hmm...</field></shadow></value>'
};

/**
 * Author a compact connection matrix through real Scratch Blocks APIs. Every
 * palette-equivalent create/connect action has its own event group so the
 * resulting journal can exercise realistic Play, history and timeline seek.
 *
 * @param {object} options fixture dependencies
 * @returns {Promise<object>} fixture summary
 */
const seedConnectionMatrixFixture = async ({workspace, ScratchBlocks, wait}) => {
    let step = 0;
    const recordStep = async action => {
        step++;
        ScratchBlocks.Events.setGroup(`${CONNECTION_MATRIX_GROUP_PREFIX}-${step}`);
        try {
            action();
        } finally {
            ScratchBlocks.Events.setGroup(false);
        }
        await wait(120);
    };
    const createBlock = type => {
        const xml = ScratchBlocks.Xml.textToDom(
            `<xml xmlns="http://www.w3.org/1999/xhtml"><block type="${type}">` +
            `${INPUT_XML[type] || ''}</block></xml>`
        );
        return ScratchBlocks.Xml.domToBlock(xml.firstElementChild, workspace);
    };
    const createAndPlace = async (type, connect) => {
        let block;
        await recordStep(() => {
            block = createBlock(type);
            connect(block);
        });
        return block;
    };
    const connectStatement = connection => block => connection.connect(block.previousConnection);
    const connectReporter = connection => block => connection.connect(block.outputConnection);
    const setInputText = async (block, inputName, value) => {
        await recordStep(() => {
            const shadow = block.getInput(inputName).connection.targetBlock();
            if (!shadow) throw new Error(`Fixture input has no shadow: ${block.type}.${inputName}`);
            shadow.setFieldValue(value, 'TEXT');
        });
    };
    const setInputField = async (block, inputName, fieldName, value) => {
        await recordStep(() => {
            const shadow = block.getInput(inputName).connection.targetBlock();
            if (!shadow) throw new Error(`Fixture input has no shadow: ${block.type}.${inputName}`);
            shadow.setFieldValue(value, fieldName);
        });
    };

    const hat = await createAndPlace('event_whenflagclicked', block => block.moveBy(160, 120));
    const move = await createAndPlace('motion_movesteps', connectStatement(hat.nextConnection));
    const repeat = await createAndPlace('control_repeat', connectStatement(move.nextConnection));
    const say = await createAndPlace('looks_say', connectStatement(repeat.getInput('SUBSTACK').connection));
    await createAndPlace('operator_join', connectReporter(say.getInput('MESSAGE').connection));
    const waitUntil = await createAndPlace('control_wait_until', connectStatement(say.nextConnection));
    const equals = await createAndPlace('operator_equals', connectReporter(waitUntil.getInput('CONDITION').connection));
    await setInputText(equals, 'OPERAND1', 'apple');
    await setInputText(equals, 'OPERAND2', 'banana');
    const keyPressed = await createAndPlace(
        'sensing_keypressed',
        connectReporter(equals.getInput('OPERAND1').connection)
    );
    await createAndPlace('sensing_mousedown', connectReporter(keyPressed.getInput('KEY_OPTION').connection));
    await createAndPlace('looks_think', connectStatement(repeat.nextConnection));

    // Repeated text shadows in nested round reporters reproduce the aliasing
    // shape behind the historical expected-b/actual-c mismatch.
    const nestedSay = await createAndPlace('looks_say', block => block.moveBy(520, 120));
    const outerJoin = await createAndPlace('operator_join', connectReporter(nestedSay.getInput('MESSAGE').connection));
    const innerJoin = await createAndPlace('operator_join', connectReporter(outerJoin.getInput('STRING1').connection));
    await setInputText(innerJoin, 'STRING1', 'a');
    await setInputText(innerJoin, 'STRING2', 'b');
    await setInputText(outerJoin, 'STRING2', 'c');

    // Exercise both branches of a C-block independently, then its following
    // stack, rather than assuming one SUBSTACK covers all statement inputs.
    const ifElse = await createAndPlace('control_if_else', block => block.moveBy(160, 520));
    await createAndPlace('sensing_mousedown', connectReporter(ifElse.getInput('CONDITION').connection));
    await createAndPlace('looks_say', connectStatement(ifElse.getInput('SUBSTACK').connection));
    await createAndPlace('looks_think', connectStatement(ifElse.getInput('SUBSTACK2').connection));
    await createAndPlace('motion_turnright', connectStatement(ifElse.nextConnection));

    // Standard nested Boolean sockets and their owned dropdown shadows stay in
    // the matrix beside the deliberately unusual Boolean-in-menu case above.
    const booleanWait = await createAndPlace('control_wait_until', block => block.moveBy(820, 520));
    const and = await createAndPlace('operator_and', connectReporter(booleanWait.getInput('CONDITION').connection));
    const touching = await createAndPlace(
        'sensing_touchingobject',
        connectReporter(and.getInput('OPERAND1').connection)
    );
    const booleanKey = await createAndPlace(
        'sensing_keypressed',
        connectReporter(and.getInput('OPERAND2').connection)
    );
    await setInputField(touching, 'TOUCHINGOBJECTMENU', 'TOUCHINGOBJECTMENU', '_edge_');
    await setInputField(booleanKey, 'KEY_OPTION', 'KEY_OPTION', 'any');

    // A middle-statement move into a later C-slot is resolved before pickup
    // against topology which still contains the moving block. Its recorded
    // destination reference describes the source stack after Blockly heals
    // that gap, so this is the permanent regression for source-healed path
    // resolution (root -> moving -> tail -> if/else becomes root -> tail ->
    // if/else while moving enters SUBSTACK).
    const reorderRoot = await createAndPlace('motion_goto', block => block.moveBy(1120, 120));
    const reorderMoving = await createAndPlace('motion_goto', connectStatement(reorderRoot.nextConnection));
    const reorderTail = await createAndPlace('motion_glideto', connectStatement(reorderMoving.nextConnection));
    const reorderIfElse = await createAndPlace('control_if_else', connectStatement(reorderTail.nextConnection));
    await recordStep(() => {
        reorderMoving.unplug(true);
        reorderIfElse.getInput('SUBSTACK').connection.connect(reorderMoving.previousConnection);
    });

    // Moving the healed outer tail to the bottom of a populated nested stack
    // reproduces the persisted 13-step take's following transaction. The
    // target has neighbouring outer-stack and C-slot statement connections,
    // so Play must hold the first recorded insertion marker it acquires rather
    // than completing a coordinate correction past it.
    const nestedFirst = await createAndPlace(
        'motion_pointindirection',
        connectStatement(reorderIfElse.getInput('SUBSTACK2').connection)
    );
    const nestedLast = await createAndPlace(
        'motion_pointindirection',
        connectStatement(nestedFirst.nextConnection)
    );
    await recordStep(() => {
        reorderTail.unplug(true);
        nestedLast.nextConnection.connect(reorderTail.previousConnection);
    });

    // A genuine compound-substack prepend emits a deceptively small Blockly
    // move for the dragged root: its top-level coordinate is the pickup point,
    // while the former script root is attached beneath the dragged tail. This
    // is the exact four-command topology produced by dragging the second block
    // (and its descendants) above the first block in the editor.
    const prependRoot = await createAndPlace('motion_movesteps', block => block.moveBy(1420, 120));
    const prependMoving = await createAndPlace('motion_goto', connectStatement(prependRoot.nextConnection));
    const prependTurnRight = await createAndPlace(
        'motion_turnright',
        connectStatement(prependMoving.nextConnection)
    );
    const prependTail = await createAndPlace(
        'motion_turnleft',
        connectStatement(prependTurnRight.nextConnection)
    );
    await recordStep(() => {
        prependMoving.unplug(false);
        // Studio enables Scratch Blocks' stationary-stack alignment: the
        // dragged compound stack moves above the former root instead of
        // pushing that root down. Preserve that authored coordinate in the VM
        // as part of the same grouped gesture before attaching the old root.
        prependMoving.moveBy(0, -192);
        prependTail.nextConnection.connect(prependRoot.previousConnection);
    });

    // Moving the current root down into its own four-command stack exposes the
    // former second block as a new top-level remainder. Blockly reports that
    // induced remainder before the actual inserted root, followed by the
    // displaced tail. The gesture must therefore be inferred from connection
    // topology rather than event delivery order.
    await recordStep(() => {
        prependMoving.unplug(true);
        prependTurnRight.nextConnection.connect(prependMoving.previousConnection);
        prependMoving.nextConnection.connect(prependTail.previousConnection);
    });

    return {
        stepCount: step,
        rootId: hat.id,
        blockCount: workspace.getAllBlocks(false).length
    };
};

export {
    CONNECTION_MATRIX_GROUP_PREFIX,
    seedConnectionMatrixFixture
};
