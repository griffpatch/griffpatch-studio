import {isCleanUpShortcut} from '../../addons/libraries/common/cs/cleanup-shortcut';

// The addon owns layout and viewport preservation for every entry point.
const cleanUpAtScript = (workspace, block) => {
    const root = block?.getRootBlock();
    if (!workspace.cleanUpPlusLayout) return false;
    return workspace.cleanUpPlusLayout(root);
};

export {cleanUpAtScript, isCleanUpShortcut};
