import {resolveConnection} from './navigation';

// A draft changes one connection boundary. Restoring that boundary is enough
// to reuse its receiving stack; recreating every descendant per key is not.
// This operation is deliberately confined to an isolated presentation copy.
const captureDraftInsertionBoundary = ({workspace, ScratchBlocks, position}) => {
    if (!workspace.options.readOnly) throw new Error('Draft restoration requires an isolated read-only workspace.');
    const anchor = position.blockId && workspace.getBlockById(position.blockId);
    const connection = resolveConnection(workspace, position);
    const child = connection ? connection.targetBlock() : position.kind === 'before' ? anchor : null;
    const childXml = child && child.isShadow() ? ScratchBlocks.Xml.blockToDom(child) : null;
    const shadowDom = connection && connection.getShadowDom();
    const root = anchor && anchor.getRootBlock();
    const rootXY = root && root.getRelativeToSurfaceXY();
    return actor => {
        // Temporarily prevent native shadow respawn: the captured child carries
        // its current field value and identity, which the stored default may not.
        if (connection) connection.setShadowDom(null);
        if (child && !childXml) {
            if (workspace.getBlockById(child.id) !== child) throw new Error('The retained draft tail was replaced.');
            const inferior = child.outputConnection || child.previousConnection;
            if (inferior && inferior.isConnected()) inferior.disconnect();
        }
        actor.dispose(false);
        if (connection) {
            const restored = childXml ? ScratchBlocks.Xml.domToBlock(childXml.cloneNode(true), workspace) : child;
            if (restored) connection.connect(restored.outputConnection || restored.previousConnection);
            connection.setShadowDom(shadowDom && shadowDom.cloneNode(true));
        }
        if (root) {
            if (workspace.getBlockById(root.id) !== root) throw new Error('The draft receiver was replaced.');
            const xy = root.getRelativeToSurfaceXY();
            const dx = rootXY.x - xy.x;
            const dy = rootXY.y - xy.y;
            if (dx || dy) root.moveBy(dx, dy);
        }
    };
};

export {captureDraftInsertionBoundary};
