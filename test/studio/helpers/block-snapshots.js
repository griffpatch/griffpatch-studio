const captured = value => ({kind: 'value', value});

const makeChangeSnapshot = overrides => ({
    schemaVersion: 1,
    recordedAtMs: 100,
    targetId: 'sprite-a',
    targetRef: {
        runtimeId: 'sprite-a',
        name: 'Sprite1',
        isStage: false
    },
    workspaceId: 'workspace-1',
    blockId: 'block-1',
    type: 'change',
    group: 'group-1',
    recordUndo: true,
    forwardJson: {
        type: 'change',
        blockId: 'block-1',
        element: 'field',
        name: 'VALUE',
        newValue: '20'
    },
    details: {
        element: 'field',
        name: 'VALUE',
        oldValue: captured('10'),
        newValue: captured('20')
    },
    ...overrides
});

export {
    captured,
    makeChangeSnapshot
};
