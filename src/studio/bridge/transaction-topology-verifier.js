import {connectedInputName, resolveWorkspaceBlockId} from './workspace-block-reference';
import {analyzeTransactionEffects} from '../replay/transaction-effects';

const expectedMoves = (transaction, direction) => (
    analyzeTransactionEffects(transaction, direction).survivingMoves.map(move => ({
        blockId: move.blockId,
        blockType: move.blockType,
        blockRef: move.blockRef,
        source: move.source,
        destination: move.destination,
        ...(move.destinationCoordinateIsGesturePickup ? {destinationCoordinateIsGesturePickup: true} : {})
    }))
);

const aliasFor = (aliases, blockId) => aliases && (
    typeof aliases.get === 'function' ? aliases.get(blockId) : aliases[blockId]
);

const resolveDestination = (workspace, destination, blockAliases) => {
    if (!destination.parentId) return destination;
    const aliasedParentId = aliasFor(blockAliases, destination.parentId);
    return {
        ...destination,
        parentId: aliasedParentId || (workspace.getBlockById(destination.parentId) ? destination.parentId :
            resolveWorkspaceBlockId(workspace, destination.parentRef, destination.parentId)
        )
    };
};

const verifyMove = (workspace, vm, expected, blockAliases) => {
    const aliasedBlockId = aliasFor(blockAliases, expected.blockId);
    const blockId = aliasedBlockId || (workspace.getBlockById(expected.blockId) ? expected.blockId :
        resolveWorkspaceBlockId(workspace, expected.blockRef, expected.blockId)
    );
    const block = workspace.getBlockById(blockId);
    if (!block) return {blockId, matches: false, reason: 'workspace block missing'};
    const destination = resolveDestination(workspace, expected.destination, blockAliases);
    const parent = block.getParent && block.getParent();
    const workspaceActual = {
        parentId: parent ? parent.id : null,
        inputName: parent ? connectedInputName(parent, block) || null : null,
        coordinate: parent ? null : block.getRelativeToSurfaceXY()
    };
    const workspaceMatches = destination.parentId ?
        workspaceActual.parentId === destination.parentId &&
            workspaceActual.inputName === (destination.inputName || null) :
        !workspaceActual.parentId && destination.coordinate &&
            (expected.destinationCoordinateIsGesturePickup ||
                (Math.abs(workspaceActual.coordinate.x - destination.coordinate.x) < 1 &&
                Math.abs(workspaceActual.coordinate.y - destination.coordinate.y) < 1));
    const vmBlocks = vm.editingTarget && vm.editingTarget.blocks;
    const vmBlock = vmBlocks && (vmBlocks.getBlock(blockId) || vmBlocks.getBlock(expected.blockId));
    const vmActual = vmBlock ? {parentId: vmBlock.parent || null} : null;
    const vmMatches = Boolean(vmBlock) && vmActual.parentId === (destination.parentId || null);
    return {
        blockId,
        matches: workspaceMatches && vmMatches,
        expected: destination,
        workspace: workspaceActual,
        vm: vmActual,
        reason: workspaceMatches ? (vmMatches ? null : 'VM topology differs') : 'workspace topology differs'
    };
};

const elementName = element => (element && (element.localName || element.nodeName || '')).toLowerCase();

const directBlockChildren = container => Array.from((container && container.childNodes) || [])
    .filter(node => elementName(node) === 'block' || elementName(node) === 'shadow');

const activeInputChild = container => {
    const children = directBlockChildren(container);
    return children.find(child => elementName(child) === 'block') || children[0] || null;
};

const createdTreeRelationships = (transaction, direction, ScratchBlocks) => {
    if (!ScratchBlocks || !ScratchBlocks.Xml || typeof ScratchBlocks.Xml.textToDom !== 'function') return [];
    const effects = analyzeTransactionEffects(transaction, direction);
    const relationships = [];
    const effectiveCreateType = direction === 'forward' ? 'create' : 'delete';
    for (const event of transaction.events || []) {
        if (event.type !== effectiveCreateType) continue;
        const xml = event.details && (event.type === 'create' ? event.details.xml : event.details.oldXml);
        if (!xml) continue;
        let root;
        try {
            const dom = ScratchBlocks.Xml.textToDom(xml);
            const scope = dom.documentElement || dom;
            root = elementName(scope) === 'block' || elementName(scope) === 'shadow' ? scope :
                activeInputChild(scope);
        } catch (error) {
            continue;
        }
        if (!root) continue;
        const visit = parent => {
            for (const container of Array.from(parent.childNodes || [])) {
                const kind = elementName(container);
                if (kind !== 'value' && kind !== 'statement' && kind !== 'next') continue;
                const parentId = parent.getAttribute && parent.getAttribute('id');
                const children = directBlockChildren(container);
                for (const child of children) {
                    const childId = child.getAttribute && child.getAttribute('id');
                    if (childId && parentId && effects.presence.get(childId) !== false) {
                        relationships.push({
                            parentId,
                            childId,
                            inputName: kind === 'next' ? null : container.getAttribute('name') || null,
                            childType: child.getAttribute('type') || null,
                            role: elementName(child) === 'shadow' ? 'shadow' : 'block'
                        });
                    }
                }
                const activeChild = activeInputChild(container);
                if (activeChild) visit(activeChild);
            }
        };
        visit(root);
    }
    return relationships;
};

const targetInputBlock = (parent, inputName) => {
    if (inputName === null) return parent.getNextBlock ? parent.getNextBlock() : null;
    const input = (parent.inputList || []).find(candidate => candidate.name === inputName);
    return input && input.connection && input.connection.targetBlock ? input.connection.targetBlock() : null;
};

const verifyCreatedTree = (workspace, vm, relationships, blockAliases) => {
    const aliases = new Map();
    if (blockAliases) {
        const entries = typeof blockAliases.entries === 'function' ?
            blockAliases.entries() : Object.entries(blockAliases);
        for (const [recordedId, liveId] of entries) aliases.set(recordedId, liveId);
    }
    return relationships.map(expected => {
        const liveParentId = aliases.get(expected.parentId) || expected.parentId;
        const parent = workspace.getBlockById(liveParentId);
        if (!parent) return {...expected, matches: false, reason: 'created-tree parent missing'};
        const vmBlocks = vm.editingTarget && vm.editingTarget.blocks;
        const vmParent = vmBlocks && vmBlocks.getBlock(liveParentId);
        const vmInput = vmParent && expected.inputName !== null && vmParent.inputs &&
            vmParent.inputs[expected.inputName];
        const liveChildId = expected.inputName === null ? vmParent && vmParent.next :
            vmInput && vmInput[expected.role];
        if (!liveChildId) {
            return {...expected, liveParentId, matches: false, reason: 'created-tree child missing'};
        }
        const child = workspace.getBlockById(liveChildId);
        const vmChild = vmBlocks && vmBlocks.getBlock(liveChildId);
        aliases.set(expected.childId, liveChildId);
        const actualType = (child && child.type) || (vmChild && vmChild.opcode) || null;
        const typeMatches = !expected.childType || actualType === expected.childType;
        const activeChildId = expected.inputName === null ? liveChildId : vmInput && vmInput.block;
        const activeWorkspaceChild = targetInputBlock(parent, expected.inputName);
        const workspaceMatches = typeMatches && (
            (expected.role === 'shadow' && activeChildId !== liveChildId) ||
            (activeWorkspaceChild && activeWorkspaceChild.id === liveChildId)
        );
        const vmMatches = Boolean(vmChild) && (vmChild.parent || null) === liveParentId;
        return {
            ...expected,
            liveParentId,
            liveChildId,
            actualType,
            matches: workspaceMatches && vmMatches,
            reason: workspaceMatches ? (vmMatches ? null : 'created-tree VM topology differs') :
                (typeMatches ? 'created-tree workspace topology differs' : 'created-tree block type differs')
        };
    });
};

/**
 * Verify every durable move destination represented by one transaction.
 * This catches blocks which overlap visually but are not connected in both
 * Blockly and the VM before the Studio cursor may advance.
 *
 * @param {object} options verifier dependencies
 * @returns {object} topology evidence
 */
const verifyTransactionTopology = ({
    workspace,
    vm,
    transaction,
    direction,
    blockAliases = null,
    ScratchBlocks = null
}) => {
    const moves = expectedMoves(transaction, direction);
    const moveResults = moves.map(expected => verifyMove(workspace, vm, expected, blockAliases));
    const treeResults = verifyCreatedTree(
        workspace,
        vm,
        createdTreeRelationships(transaction, direction, ScratchBlocks),
        blockAliases
    );
    const results = [...moveResults, ...treeResults];
    return {
        matches: results.every(result => result.matches),
        checked: results.length,
        results
    };
};

export {createdTreeRelationships, expectedMoves, verifyTransactionTopology};
