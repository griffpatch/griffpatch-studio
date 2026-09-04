const syncBroadcastVm = (vm, id, name) => {
    const stage = vm.runtime.getTargetForStage();
    const variable = stage && stage.variables[id];
    if (!variable || variable.type !== 'broadcast_msg') return false;
    variable.name = name;
    variable.value = name;
    const containers = new Set(vm.runtime.targets.map(target => target.blocks));
    for (const blocks of containers) {
        for (const block of Object.values(blocks._blocks)) {
            const field = block.fields && block.fields.BROADCAST_OPTION;
            if (field && field.id === id) field.value = name;
        }
        blocks.resetCache();
    }
    return true;
};

const createBroadcastRenamer = ({workspace, ScratchBlocks, vm}) => {
    if (typeof workspace.whenBlockOperationsComplete !== 'function') {
        throw new Error('Scratch Blocks does not expose block-operation completion.');
    }
    const historyListener = event => {
        if (event.type !== 'var_rename') return;
        const variable = workspace.getVariableById(event.varId);
        if (variable && variable.type === ScratchBlocks.BROADCAST_MESSAGE_VARIABLE_TYPE) {
            workspace.whenBlockOperationsComplete(() => {
                const current = workspace.getVariableById(event.varId);
                if (current && current.type === ScratchBlocks.BROADCAST_MESSAGE_VARIABLE_TYPE) {
                    syncBroadcastVm(vm, event.varId, current.name);
                }
            });
        }
    };
    workspace.addChangeListener(historyListener);
    const prompt = (variable, onDone) => {
        const current = workspace.getVariableById(variable.getId());
        const stageVariable = vm.runtime.getTargetForStage().variables[variable.getId()];
        if (!current || current.type !== ScratchBlocks.BROADCAST_MESSAGE_VARIABLE_TYPE || !stageVariable) {
            throw new Error('The selected broadcast no longer exists.');
        }
        const oldName = current.name;
        ScratchBlocks.prompt(
            `Rename all “${oldName}” messages to:`,
            oldName,
            newName => {
                const name = ScratchBlocks.Variables.trimName_(newName);
                const latest = workspace.getVariableById(variable.getId());
                if (name && latest && latest.type === ScratchBlocks.BROADCAST_MESSAGE_VARIABLE_TYPE &&
                    name !== latest.name) {
                    const conflict = workspace.getVariable(name, ScratchBlocks.BROADCAST_MESSAGE_VARIABLE_TYPE);
                    if (conflict && conflict.getId() !== latest.getId()) {
                        ScratchBlocks.alert(`A message named “${name}” already exists.`);
                    } else {
                        workspace.renameVariableById(latest.getId(), name);
                        if (!syncBroadcastVm(vm, latest.getId(), name)) {
                            throw new Error('The broadcast could not be synchronized with the project.');
                        }
                        // The native VarRename event is queued. Do not hand
                        // keyboard control back until it is genuinely the next
                        // Undo operation; otherwise a fast Ctrl+Z can undo the
                        // edit which happened before this dialog instead.
                        if (onDone) workspace.whenBlockOperationsComplete(onDone);
                        return;
                    }
                }
                if (onDone) onDone();
            },
            'Rename Message',
            ScratchBlocks.BROADCAST_MESSAGE_VARIABLE_TYPE
        );
    };
    return {prompt, detach: () => workspace.removeChangeListener(historyListener)};
};

export {createBroadcastRenamer, syncBroadcastVm};
