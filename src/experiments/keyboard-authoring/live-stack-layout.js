// Adapted from griffpatch's Scratch Addons editor-cleanup-plus live tidy-up,
// feature/editor-cleanup-plus-live-cleanup @ 027746a9 (GPL-3.0).
// Keep its above-first alignment and extend its column cascade, but plan from
// actual native bounds and apply only at an explicit native edit/drop boundary.
import {stackColumns, spaceFollowingColumns} from './stack-column-layout';

const LIVE_STACK_LAYOUT = {enabled: true, gap: 50};

const planStackSpacing = (blocks, rootId, gap = 50, columnGap = Math.max(64, gap)) => {
    const rows = blocks.map(block => ({...block}));
    const root = rows.find(block => block.id === rootId);
    if (!root || root.reporter) return [];
    const originalY = root.y;
    const tight = block => block.x - root.x >= -30 && block.x - root.x <= 50;
    const neighbours = rows.filter(block => block !== root && !block.reporter && tight(block))
        .sort((a, b) => Number(b.y < root.y) - Number(a.y < root.y) ||
            Math.abs(a.y - root.y) - Math.abs(b.y - root.y));
    if (neighbours.length) root.x = neighbours[0].x;
    const columns = stackColumns(rows);
    const column = columns.find(item => item.rows.includes(root));
    const members = new Set(column.rows);
    const above = rows.filter(block => block !== root && !block.reporter && tight(block) && block.y < root.y);
    root.y = Math.max(root.y, ...above.map(block => block.y + block.height + gap));
    let floor = root.y + root.height + gap;
    let lastShift = 0;
    for (const block of rows.filter(item => item !== root && members.has(item) && item.y >= originalY)
        .sort((a, b) => a.y - b.y)) {
        const overlaps = root.x < block.x + block.width && block.x < root.x + root.width;
        if (!tight(block) && !overlaps) continue;
        if (block.reporter || (!tight(block) && lastShift)) {
            block.y += lastShift;
        } else {
            // A slightly offset command can still intersect a new detached
            // stack before any aligned neighbour has established a cascade.
            // Treat that first real collision as the floor, then preserve the
            // relative layout of any loose roots which follow it.
            lastShift = Math.max(0, floor - block.y);
            block.y += lastShift;
            floor = block.y + block.height + gap;
        }
    }
    if (columnGap !== null) spaceFollowingColumns(columns, column, columnGap);
    return rows.flatMap((row, index) => {
        const original = blocks[index];
        return row.x !== original.x || row.y !== original.y ?
            [{id: row.id, dx: row.x - original.x, dy: row.y - original.y}] : [];
    });
};

const captureRootBounds = (workspace, block) => {
    const rect = block.getBoundingRectangle();
    // Reflect the physical bounding box for RTL so column tolerances retain
    // their visual meaning without guessing where a block's origin lies.
    return {id: block.id,
        x: workspace.RTL ? -rect.bottomRight.x : rect.topLeft.x,
        y: rect.topLeft.y,
        width: rect.bottomRight.x - rect.topLeft.x,
        height: rect.bottomRight.y - rect.topLeft.y,
        reporter: Boolean(block.outputConnection)};
};

const captureStackBounds = workspace => workspace.getTopBlocks(false).map(block =>
    captureRootBounds(workspace, block));

const needsStackSpacing = (previous, current) => !current.reporter &&
    (!previous || current.height > previous.height || current.width > previous.width);

// Previews reserve vertical room for the caret and body, but never move other
// columns while typing. Horizontal layout runs once at the native edit boundary.
// This function is pure: no source positions are changed by a draft.
const planProspectiveStackSpacing = (blocks, prospectiveRoot, gap = 50) => {
    if (!prospectiveRoot || prospectiveRoot.reporter) return [];
    const rows = blocks.map(block => ({...block}));
    const existing = rows.findIndex(block => block.id === prospectiveRoot.id);
    if (existing === -1) rows.push({...prospectiveRoot});
    else rows[existing] = {...prospectiveRoot};
    return planStackSpacing(rows, prospectiveRoot.id, gap, null);
};

const attachLiveStackLayout = ({workspace, ScratchBlocks, available}) => {
    const active = () => LIVE_STACK_LAYOUT.enabled && available() && ScratchBlocks.Events.isEnabled() &&
        ScratchBlocks.Events.recordUndo && !workspace.options.readOnly && !workspace.isFlyout &&
        !workspace.isDragging();
    const apply = (block, source) => {
        if (!active()) return false;
        if (source === 'drop') {
            // A delayed native bump must not reapply an undone or superseded
            // edit. Keyboard commits run synchronously before event delivery.
            const group = ScratchBlocks.Events.getGroup();
            const last = workspace.undoStack_[workspace.undoStack_.length - 1];
            if (!group || !last || last.group !== group) return true;
        }
        const moves = planStackSpacing(captureStackBounds(workspace), block.getRootBlock().id, LIVE_STACK_LAYOUT.gap);
        for (const move of moves) {
            workspace.getBlockById(move.id).moveBy(workspace.RTL ? -move.dx : move.dx, move.dy);
        }
        return true;
    };
    workspace.setBlockSpacingHandler(apply);
    return {
        beginEdit: () => {
            if (!active()) return null;
            const before = new Map(captureStackBounds(workspace).map(block => [block.id, block]));
            return () => {
                if (!active()) return;
                const changed = captureStackBounds(workspace).filter(block => {
                    const old = before.get(block.id);
                    return needsStackSpacing(old, block);
                })
                    .sort((a, b) => a.y - b.y);
                for (const block of changed) workspace.applyBlockSpacing(workspace.getBlockById(block.id), 'edit');
            };
        },
        detach: () => workspace.setBlockSpacingHandler(null)
    };
};

export {
    attachLiveStackLayout,
    captureRootBounds,
    captureStackBounds,
    LIVE_STACK_LAYOUT,
    needsStackSpacing,
    planProspectiveStackSpacing,
    planStackSpacing
};
