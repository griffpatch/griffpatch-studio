import {activationPosition} from '../../../src/experiments/keyboard-authoring/activation-position';

const bounds = {left: 300, top: 100, right: 1100, bottom: 800};
const box = {left: 350, top: 150, width: 140, height: 48};
const choose = overrides => activationPosition({bounds, previous: 'old', selected: 'selected',
    candidates: () => [], measure: () => null, empty: () => 'empty', ...overrides});

test('visible previous input wins over native parent selection without scanning the project', () => {
    expect(choose({measure: () => box, candidates: () => {throw Error('Unnecessary scan');}})).toBe('old');
});
test('offscreen or edge-clipped caret falls back to a visible native selection', () => {
    for (const left of [0, 300, 1090]) {
        expect(choose({measure: at => at === 'old' ? {...box, left} : box})).toBe('selected');
    }
});
test('visible heads are preferred; offscreen heads allow a fully visible statement in a long script', () => {
    const candidates = () => [{position: 'body', head: false}, {position: 'head', head: true}];
    expect(choose({candidates, measure: at => ['body', 'head'].includes(at) ? box : null})).toBe('head');
    expect(choose({candidates, measure: at => at === 'body' ? box : {...box, top: -100}})).toBe('body');
});
test('nearest top-left visible head wins regardless of workspace enumeration order', () => {
    expect(choose({candidates: () => [{position: 'far', head: true}, {position: 'near', head: true}],
        measure: at => at === 'near' ? box : at === 'far' ? {...box, left: 700, top: 500} : null})).toBe('near');
});
test('culled, oversized and missing blocks give a visible free caret', () => {
    for (const measured of [null, {...box, width: 0}, {...box, width: 2000}]) {
        expect(choose({candidates: () => [{position: 'head', head: true}], measure: () => measured})).toBe('empty');
    }
});
