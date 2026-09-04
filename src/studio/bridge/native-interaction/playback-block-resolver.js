import {blockAtWorkspaceLocation, resolveWorkspaceBlockId} from '../workspace-block-reference';

const resolvePlaybackBlockId = (
    workspace,
    {blockId, blockRef = null, blockType = null, source = null},
    aliases = new Map()
) => {
    const directBlock = workspace.getBlockById(blockId);
    if (directBlock && (!blockType || directBlock.type === blockType)) return blockId;
    const sourceBlock = source && blockAtWorkspaceLocation(workspace, source, aliases);
    if (sourceBlock && (!blockType || sourceBlock.type === blockType)) return sourceBlock.id;
    const referencedId = resolveWorkspaceBlockId(workspace, blockRef, null);
    const referencedBlock = referencedId && workspace.getBlockById(referencedId);
    if (referencedBlock && (!blockType || referencedBlock.type === blockType)) return referencedId;
    if (blockType && workspace.getAllBlocks) {
        const candidates = workspace.getAllBlocks(false).filter(block => block.type === blockType);
        if (candidates.length === 1) return candidates[0].id;
        if (candidates.length > 1) {
            throw new Error(`Native interaction block type is ambiguous: ${blockType}`);
        }
    }
    return resolveWorkspaceBlockId(workspace, blockRef, blockId);
};

export {resolvePlaybackBlockId};
