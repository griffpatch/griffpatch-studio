// Blockly nests input and continuation block roots inside their owner. Fading
// that owner would fade an existing tail too, and compound opacity in nested
// inputs. Fade each new block's own paint exactly once, leaving block roots
// and the native connection/rendering hierarchy alone.
const ghostDraft = (actor, originalIds) => {
    if (!actor.workspace.options.readOnly) throw new Error('Ghost styling requires an isolated read-only workspace.');
    const blocks = actor.getDescendants();
    const blockRoots = new Set(blocks.map(block => block.getSvgRoot()));
    for (const block of blocks) {
        if (originalIds.has(block.id)) continue;
        for (const element of block.getSvgRoot().children) {
            if (blockRoots.has(element)) continue;
            element.style.opacity = '.45';
            element.dataset.keyboardDraftPaint = 'true';
        }
    }
};

export {ghostDraft};
