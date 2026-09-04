import {blocksInRange} from './block-range';
import {firstInput} from './navigation';

// Native Blockly keeps the original event group on its history stack, but
// replayed change events do not reliably expose that group. Resolve focus from
// the authoritative topology instead: exactly one of the retained wrapper or
// its original contiguous sibling range can be present after history settles.
const wrappingHistoryFocus = (workspace, record) => {
    if (!record) return null;
    const wrapper = workspace.getBlockById(record.wrapperId);
    if (wrapper) {
        return {
            state: 'wrapped',
            position: record.sourceBlockId ? {kind: 'block', blockId: wrapper.id} :
                firstInput(wrapper) || {kind: 'block', blockId: wrapper.id},
            range: null
        };
    }
    if (record.range && blocksInRange(workspace, record.range).length) {
        return {
            state: 'unwrapped',
            position: {kind: 'block', blockId: record.range.focusBlockId},
            range: record.range
        };
    }
    const source = record.sourceBlockId && workspace.getBlockById(record.sourceBlockId);
    if (source && source.outputConnection && source.outputConnection.targetConnection) {
        return {
            state: 'unwrapped',
            position: {kind: 'block', blockId: source.id},
            range: null
        };
    }
    return null;
};

export {wrappingHistoryFocus};
