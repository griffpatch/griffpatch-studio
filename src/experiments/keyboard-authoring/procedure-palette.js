const isDefinition = type => type === 'procedures_definition' || type === 'procedures_prototype';

// Refresh the native dynamic category from completed workspace events, not
// just the declaration command. This also covers native Undo/Redo and edits
// to a signature. Call blocks, ordinary field edits and moves do not require
// rebuilding the palette. No live-workspace scan or alternate cache is needed.
const refreshProcedurePalette = (workspace, event) => {
    let changed = false;
    if (event.type === 'create' || event.type === 'delete') {
        const xml = event.type === 'create' ? event.xml : event.oldXml;
        changed = Boolean(xml && (isDefinition(xml.getAttribute('type')) ||
            xml.querySelector('[type="procedures_definition"], [type="procedures_prototype"]')));
    } else if (event.type === 'change' && event.element === 'mutation') {
        const block = workspace.getBlockById(event.blockId);
        changed = Boolean(block && isDefinition(block.type));
    }
    if (changed) workspace.refreshToolboxSelection_();
    return changed;
};

export default refreshProcedurePalette;
