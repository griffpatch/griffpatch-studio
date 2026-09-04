import {compositionLayout} from '../../../src/experiments/keyboard-authoring/composition-layout';

const bounds = {left:300, top:90, right:1100, bottom:850};
const anchor = {left:347, top:180, width:170, height:38};
const layout = (preview, previous, options = {}) => compositionLayout({
    anchor, preview: {...anchor, ...preview}, bounds, previous, ...options
});

test('wide candidates do not move the input sideways or change its side', () => {
    const initial = layout({width:80});
    const wider = layout({width:700}, initial);
    expect(wider).toEqual(initial);
    expect(initial.side).toBe('below');
    expect(initial.edge).toBe(228);
});

test('only taller previews claim more room; shorter suggestions do not pull the input back', () => {
    const initial = layout({});
    const taller = layout({height:76}, initial);
    expect(taller.edge - initial.edge).toBe(38);
    expect(layout({height:38}, taller)).toEqual(taller);
    expect(layout({height:38}).edge).toBe(initial.edge); // A new draft releases the reserve.
});

test('near the bottom the popup opens above, anchored by its input-side edge', () => {
    const low = {...anchor, top:740};
    const initial = layout(low, null, {anchor:low});
    expect(initial.side).toBe('above');
    expect(initial.edge).toBe(730);
    expect(layout({...low, height:100}, initial, {anchor:low}).edge).toBe(730);
});

test('pan and zoom follow the structural anchor without confusing pixels and workspace units', () => {
    const initial = layout({height:76});
    const moved = {...anchor, left:447, top:260};
    const zoomed = layout({...moved, height:152}, initial, {anchor:moved, scale:2});
    expect(zoomed.left - initial.left).toBe(100);
    expect(zoomed.edge).toBe(422);
    expect(zoomed.clearance).toBe(76);
});

test('narrow bounds shrink the panel and keep it away from the editor edges', () => {
    const narrow = layout({width:500}, null, {bounds:{...bounds, right:560}});
    expect(narrow.left).toBe(308);
    expect(narrow.width).toBe(244);
    expect(narrow.left + narrow.width).toBe(552);
});

test('a genuinely taller candidate may force the panel above, but shrinking it does not flip back', () => {
    const initial = layout({});
    const huge = layout({height:650}, initial);
    expect(huge.side).toBe('above');
    const smaller = layout({}, huge);
    expect(smaller.side).toBe('above');
    expect(smaller.edge).toBe(huge.edge);
});

test('a continuation gets a stable side column with room for ordinary typing', () => {
    const context = {right:520};
    const initial = layout({}, null, {context, scale:0.7});
    expect(initial.side).toBe('beside');
    expect(initial.left).toBe(581);
    const taller = layout({height:160,width:220}, initial, {context:{right:560},scale:0.7});
    expect(taller.left).toBe(initial.left);
    expect(taller.edge).toBe(initial.edge);
    expect(taller.side).toBe('beside');
});

test('a continuation uses a compact side panel instead of covering its opened gap', () => {
    const compact = layout({}, null, {
        bounds: {...bounds, right: 781},
        context: {right: 457},
        scale: 0.675
    });
    expect(compact.side).toBe('beside');
    expect(compact.left).toBe(573);
    expect(compact.width).toBe(200);
    expect(compact.left + compact.width).toBe(773);
});

test('a continuation contracts its empty gutter before abandoning the side panel', () => {
    const compact = layout({}, null, {
        bounds: {...bounds, right: 760},
        context: {right: 457},
        scale: 0.675
    });
    expect(compact.side).toBe('beside');
    expect(compact.left).toBe(556);
    expect(compact.width).toBe(196);
    expect(compact.left + compact.width).toBe(752);
});

test('a side column yields once for a wide draft or narrow editor, without chasing candidate widths', () => {
    const initial = layout({},null,{context:{right:500},scale:0.7});
    const wide = layout({width:600},initial,{context:{right:947},scale:0.7});
    expect(wide.side).toBe('below');
    expect(layout({},wide,{context:{right:500},scale:0.7}).side).toBe('below');
    const narrow = layout({},initial,{context:{right:500},scale:0.7,bounds:{...bounds,right:720}});
    expect(narrow.side).not.toBe('beside');
    expect(narrow.left+narrow.width).toBeLessThanOrEqual(712);
});
