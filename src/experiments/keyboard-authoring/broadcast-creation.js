import {fieldAtPosition} from './navigation';
import {accepts, inEventGroup, placeBlock} from './operations';
import {blockXml} from './catalogue';
import {bindBroadcastCommand} from './broadcast-command';

const isBroadcastCreation = choice => choice &&
    ['create-broadcast', 'create-broadcast-command'].includes(choice.kind);

const broadcastFieldAt = (workspace, position, ScratchBlocks) => {
    const target = fieldAtPosition(workspace, position);
    return target && target.field instanceof ScratchBlocks.FieldVariable &&
        target.field.getVariable() &&
        target.field.getVariable().type === ScratchBlocks.BROADCAST_MESSAGE_VARIABLE_TYPE ? target : null;
};

const canCreateBroadcast = (workspace, ScratchBlocks, name) => Boolean(name &&
    !workspace.getVariable(name, ScratchBlocks.BROADCAST_MESSAGE_VARIABLE_TYPE));

const createBroadcastCompletion = ({workspace, ScratchBlocks, vm, onGroup}) => {
    const type = ScratchBlocks.BROADCAST_MESSAGE_VARIABLE_TYPE;
    const fieldAt = position => broadcastFieldAt(workspace, position, ScratchBlocks);
    const choices = (position, query) => {
        if (!fieldAt(position)) return [];
        const name = query.trim();
        const existing = workspace.getVariablesOfType(type)
            .filter(broadcast => !name || broadcast.name.toLowerCase().includes(name.toLowerCase()))
            .sort((a, b) => Number(b.name === name) - Number(a.name === name) || a.name.localeCompare(b.name))
            .slice(0, 6)
            .map(broadcast => ({kind: 'broadcast',
                text: broadcast.name,
                broadcastId: broadcast.getId(),
                fits: true}));
        const create = canCreateBroadcast(workspace, ScratchBlocks, name) ?
            [{kind: 'create-broadcast', text: name, fits: true}] : [];
        return [...existing, ...create];
    };
    const apply = (position, choice, expectedTargetId) => {
        const field = fieldAt(position);
        if (!field || !vm.editingTarget || vm.editingTarget.id !== expectedTargetId) {
            throw new Error('The broadcast destination has changed. Choose it again.');
        }
        const creating = choice.kind === 'create-broadcast';
        const name = choice.text.trim();
        let broadcast = creating ? null : workspace.getVariableById(choice.broadcastId);
        if (creating ? !canCreateBroadcast(workspace, ScratchBlocks, name) :
            !broadcast || broadcast.type !== type) {
            throw new Error('The broadcast choices have changed. Choose an existing message or another name.');
        }
        const oldValue = field.field.getValue();
        return inEventGroup(ScratchBlocks, () => {
            try {
                if (creating) broadcast = workspace.createVariable(name, type, null, false, false);
                field.field.setValue(broadcast.getId());
                return broadcast;
            } catch (error) {
                field.field.setValue(oldValue);
                if (creating && broadcast) workspace.deleteVariableById(broadcast.getId());
                throw error;
            }
        }, onGroup);
    };
    const commandChoices = (position, matches) => matches
        .filter(command => command.broadcastName &&
            accepts(workspace, position, command.instance) &&
            canCreateBroadcast(workspace, ScratchBlocks, command.broadcastName))
        .map(command => ({...command, kind: 'create-broadcast-command', fits: true}));
    const applyCommand = (position, choice, expectedTargetId) => {
        if (!vm.editingTarget || vm.editingTarget.id !== expectedTargetId ||
            !accepts(workspace, position, choice.instance) ||
            !canCreateBroadcast(workspace, ScratchBlocks, choice.broadcastName)) {
            throw new Error('The broadcast command destination or name has changed. Choose it again.');
        }
        const blockId = ScratchBlocks.utils.genUid();
        const broadcastId = ScratchBlocks.utils.genUid();
        const xml = blockXml(bindBroadcastCommand(choice, {
            name: choice.broadcastName,
            getId: () => broadcastId
        }));
        xml.setAttribute('id', blockId);
        let broadcast;
        return inEventGroup(ScratchBlocks, () => {
            try {
                broadcast = workspace.createVariable(choice.broadcastName, type, broadcastId, false, false);
                return placeBlock(workspace, position, ScratchBlocks.Xml.domToBlock(xml, workspace));
            } catch (error) {
                const block = workspace.getBlockById(blockId);
                if (block) block.dispose(true);
                if (broadcast) workspace.deleteVariableById(broadcast.getId());
                throw error;
            }
        }, onGroup);
    };
    return {fieldAt, choices, apply, commandChoices, applyCommand};
};

export {broadcastFieldAt, canCreateBroadcast, createBroadcastCompletion, isBroadcastCreation};
