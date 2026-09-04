const makeWorkspace = () => {
    const listeners = new Set();
    return {
        id: 'workspace-1',
        options: {},
        addChangeListener: listener => listeners.add(listener),
        removeChangeListener: listener => listeners.delete(listener),
        fire: event => listeners.forEach(listener => listener(event)),
        listenerCount: () => listeners.size
    };
};

const makeChangeEvent = (oldValue = '10', newValue = '20', group = 'group-1') => ({
    type: 'change',
    group,
    recordUndo: true,
    workspaceId: 'workspace-1',
    blockId: 'block-1',
    element: 'field',
    name: 'VALUE',
    oldValue,
    newValue,
    toJson: () => ({type: 'change', blockId: 'block-1', newValue})
});

export {
    makeChangeEvent,
    makeWorkspace
};
