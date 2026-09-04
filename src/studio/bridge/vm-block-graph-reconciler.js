/**
 * Restore the local ownership invariants implied by VM connection references.
 * Scratch VM can keep an obscured shadow top-level after a native move, or
 * retain a `next`/input reference after the referenced block was deleted.
 * Boundary hashing must not preserve either transient representation.
 *
 * @param {object} vm Scratch VM
 * @returns {object} reconciliation evidence
 */
const reconcileVmBlockGraph = vm => {
    const repairs = [];
    for (const target of (vm.runtime && vm.runtime.targets) || []) {
        const container = target.blocks;
        const blocks = container && container._blocks;
        if (!blocks) continue;
        let targetRepaired = false;
        const adoptChild = (parent, child, kind, inputName = null) => {
            if (child.parent === parent.id && !child.topLevel &&
                typeof child.x === 'undefined' && typeof child.y === 'undefined' &&
                (!Array.isArray(container._scripts) || !container._scripts.includes(child.id))) {
                return false;
            }
            child.parent = parent.id;
            child.topLevel = false;
            delete child.x;
            delete child.y;
            if (Array.isArray(container._scripts)) {
                const scriptIndex = container._scripts.indexOf(child.id);
                if (scriptIndex !== -1) container._scripts.splice(scriptIndex, 1);
            }
            repairs.push({targetId: target.id, parentId: parent.id, inputName, blockId: child.id, kind});
            targetRepaired = true;
            return true;
        };
        for (const parent of Object.values(blocks)) {
            if (parent.next) {
                const next = blocks[parent.next];
                if (next) {
                    adoptChild(parent, next, 'next-ownership');
                } else {
                    parent.next = null;
                    repairs.push({
                        targetId: target.id,
                        parentId: parent.id,
                        inputName: null,
                        blockId: null,
                        kind: 'dangling-next'
                    });
                    targetRepaired = true;
                }
            }
            for (const [inputName, input] of Object.entries(parent.inputs || {})) {
                const shadowId = input && input.shadow;
                const shadow = shadowId && blocks[shadowId];
                if (shadowId && !shadow) {
                    input.shadow = null;
                    repairs.push({
                        targetId: target.id,
                        parentId: parent.id,
                        inputName,
                        blockId: null,
                        kind: 'dangling-shadow'
                    });
                    targetRepaired = true;
                }
                if (shadow) adoptChild(parent, shadow, 'shadow-ownership', inputName);

                const blockId = input && input.block;
                const block = blockId && blocks[blockId];
                if (blockId && !block) {
                    input.block = shadow ? shadow.id : null;
                    repairs.push({
                        targetId: target.id,
                        parentId: parent.id,
                        inputName,
                        blockId: shadow ? shadow.id : null,
                        kind: 'dangling-input'
                    });
                    targetRepaired = true;
                } else if (block) {
                    adoptChild(parent, block, 'input-ownership', inputName);
                }
            }
        }
        if (targetRepaired && typeof container.resetCache === 'function') container.resetCache();
    }
    return {repaired: repairs.length, repairs};
};

export {reconcileVmBlockGraph};
