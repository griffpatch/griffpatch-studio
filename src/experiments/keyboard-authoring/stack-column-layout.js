// Cleanup+ groups script heads within 128 workspace units. Keep fixed anchors
// rather than a running average: growing a script must not regroup its column.
const COLUMN_TOLERANCE = 128;

const stackColumns = rows => {
    const columns = [];
    for (const row of rows.filter(item => !item.reporter)
        .sort((a, b) => a.x - b.x || a.y - b.y || a.id.localeCompare(b.id))) {
        let column = columns[columns.length - 1];
        if (!column || row.x - column.x >= COLUMN_TOLERANCE) {
            column = {x: row.x, right: row.x + row.width, rows: []};
            columns.push(column);
        }
        column.rows.push(row);
        column.right = Math.max(column.right, row.x + row.width);
    }
    // Loose reporters travel with the column whose footprint contains their
    // origin, but neither establish columns nor make them wider themselves.
    for (const row of rows.filter(item => item.reporter)) {
        const column = columns.find((item, index) => row.x >= item.x - 30 &&
            row.x < Math.min(item.right, columns[index + 1]?.x ?? Infinity));
        if (column) column.rows.push(row);
    }
    return columns;
};

// Mutates only the planner's copied rows, never native blocks. Move each whole
// affected column by one delta, preserving its alignment and every vertical gap.
// Stop at spare room instead of tidying unrelated overlaps further to the right.
const spaceFollowingColumns = (columns, activeColumn, gap) => {
    // Keep distinct anchors distinct even for exceptionally narrow blocks.
    // Cleanup+ uses the same minimum advance to avoid merging on the next edit.
    const followingEdge = column => Math.max(column.right + gap, column.x + COLUMN_TOLERANCE);
    let edge = followingEdge(activeColumn);
    for (const column of columns.slice(columns.indexOf(activeColumn) + 1)) {
        const dx = Math.max(0, edge - column.x);
        if (!dx) break;
        for (const row of column.rows) row.x += dx;
        edge = followingEdge(column) + dx;
    }
};

export {stackColumns, spaceFollowingColumns};
