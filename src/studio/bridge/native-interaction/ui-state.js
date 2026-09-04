const selectedToolboxCategoryId = toolbox => {
    if (!toolbox) return null;
    if (typeof toolbox.getSelectedCategoryId === 'function') {
        try {
            return toolbox.getSelectedCategoryId();
        } catch (error) { // eslint-disable-line no-empty
            // The pinned toolbox throws when it has no current selection.
        }
    }
    const selected = (toolbox.getSelectedItem && toolbox.getSelectedItem()) || toolbox.selectedItem_;
    return (selected && selected.id_) || null;
};

const selectedCategoryId = workspace => selectedToolboxCategoryId(
    (workspace.getToolbox && workspace.getToolbox()) || workspace.toolbox_
);

const categoryIsSelected = (workspace, categoryId) => selectedCategoryId(workspace) === categoryId;

const inputIsFocused = (documentObject, input) => Boolean(
    documentObject && input && documentObject.activeElement === input
);

const inputPoint = (pointer, input) => {
    const current = pointer && typeof pointer.getPosition === 'function' && pointer.getPosition();
    if (current) return current;
    const bounds = input.getBoundingClientRect();
    return {
        x: bounds.left + (bounds.width / 2),
        y: bounds.top + (bounds.height / 2)
    };
};

export {categoryIsSelected, inputIsFocused, inputPoint, selectedCategoryId, selectedToolboxCategoryId};
