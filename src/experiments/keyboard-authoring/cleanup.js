// The addon owns layout and viewport preservation for every entry point.
const cleanUpAtScript = (workspace, block) => {
    const root = block?.getRootBlock();
    if (!root || !workspace.cleanUpPlusLayout) return false;
    return workspace.cleanUpPlusLayout(root);
};

const isCleanUpShortcut = event => event.altKey && event.shiftKey &&
    !event.ctrlKey && !event.metaKey && event.key.toLowerCase() === 'c';

export {cleanUpAtScript, isCleanUpShortcut};
