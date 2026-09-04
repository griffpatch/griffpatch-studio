import {createTypedVariableCommandParser, bindTypedVariableCommand} from './variable-command';
import {BlockTypeInfo} from '../../addons/addons/middle-click-popup/BlockTypeInfo';

// Scratch omits broadcast blocks from the flyout until a message exists. Probe
// the native event blocks with one private typed variable so the keyboard
// catalogue can still understand "broadcast <new name>" in a blank project.
// The probe is event-silent and never touches the live VM or workspace.
const createEmptyBroadcastTemplates = ({ScratchBlocks, vm, workspace, locale}) => {
    let probe;
    const dispose = () => {
        ScratchBlocks.Events.disable();
        try {
            if (probe) probe.dispose();
            probe = null;
        } finally {
            ScratchBlocks.Events.enable();
        }
    };
    ScratchBlocks.Events.disable();
    try {
        probe = new ScratchBlocks.Workspace();
        const name = ScratchBlocks.Variables.generateUniqueName(probe);
        const variable = probe.createVariable(name, ScratchBlocks.BROADCAST_MESSAGE_VARIABLE_TYPE);
        const root = ScratchBlocks.Xml.textToDom(`<xml>
            <block type="event_whenbroadcastreceived">
                <field name="BROADCAST_OPTION" id="${variable.getId()}">${name}</field>
            </block>
            <block type="event_broadcast">
                <value name="BROADCAST_INPUT">
                    <shadow type="event_broadcast_menu">
                        <field name="BROADCAST_OPTION" id="${variable.getId()}">${name}</field>
                    </shadow>
                </value>
            </block>
            <block type="event_broadcastandwait">
                <value name="BROADCAST_INPUT">
                    <shadow type="event_broadcast_menu">
                        <field name="BROADCAST_OPTION" id="${variable.getId()}">${name}</field>
                    </shadow>
                </value>
            </block>
        </xml>`);
        const types = Array.from(root.children).flatMap(dom => BlockTypeInfo._createBlocks(
            workspace, vm, ScratchBlocks, locale, ScratchBlocks.Xml.domToBlock(dom, probe), dom
        ));
        return {types, dispose};
    } catch (error) {
        dispose();
        throw error;
    } finally {
        ScratchBlocks.Events.enable();
    }
};

// Broadcast-bearing event blocks use the same native FieldVariable descriptor
// as scalar commands, but broadcasts are project-wide identities and hats are
// valid roots too. Only replace that typed menu with a literal proposal; the
// bundled Addons parser still owns localized labels, quoting and expressions.
const createBroadcastCommandParser = (types, ScratchBlocks) => {
    const parse = createTypedVariableCommandParser(types, ScratchBlocks,
        ScratchBlocks.BROADCAST_MESSAGE_VARIABLE_TYPE, type => !type.shape.canBeRound, () => true);
    return query => parse(query).map(command => ({...command,
        broadcastName: command.identityName,
        broadcastInput: command.identityInput}));
};

const bindBroadcastCommand = (command, broadcast) => bindTypedVariableCommand({
    ...command,
    identityInput: command.broadcastInput
}, broadcast);

export {createBroadcastCommandParser, bindBroadcastCommand, createEmptyBroadcastTemplates};
