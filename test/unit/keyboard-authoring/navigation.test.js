import {canonicalPosition, deletionPosition, fieldAtPosition, firstInput, navigate, navigationStops, positionKey, recoverPosition, resolveConnection} from '../../../src/experiments/keyboard-authoring/navigation';
import {accepts, detachedStackPosition, inEventGroup, placeBlock, setInputValue} from
    '../../../src/experiments/keyboard-authoring/operations';

const field = (name, value = '10') => ({name, EDITABLE: true, isCurrentlyEditable: () => true, getValue: () => value});
const block = (id, {fields = [], inputs = [], next = null, shadow = false, reporter = false, hat = false,
    cap = false, bounds = null} = {}) => {
    const instance = {
        id,
        type: id,
        inputList: [{fieldRow: fields}, ...inputs],
        isShadow: () => shadow,
        getNextBlock: () => next,
        getInput: name => inputs.find(input => input.name === name),
        nextConnection: reporter || cap ? null : {type: 3, targetBlock: () => next},
        previousConnection: reporter || hat ? null : {},
        outputConnection: reporter ? {} : null
    };
    if (bounds) {
        instance.getRelativeToSurfaceXY = () => ({x: bounds.x, y: bounds.y});
        instance.getHeightWidth = () => ({width: bounds.width, height: bounds.height});
    }
    return instance;
};
const input = (name, target, type = 1) => ({name, fieldRow: [], connection: {
    type, targetBlock: () => target, checkType_: () => true
}});
const workspace = roots => {
    const all = new Map();
    const visit = item => {
        if (!item || all.has(item.id)) return;
        all.set(item.id, item);
        item.inputList.forEach(slot => {
            const child = slot.connection && slot.connection.targetBlock();
            if (child) child.getParent = () => item;
            visit(child);
        });
        visit(item.getNextBlock());
    };
    roots.forEach(visit);
    return {getTopBlocks: () => roots, getBlockById: id => all.get(id)};
};
const candidate = (up, down, round = false) => ({typeInfo: {
    shape: {canStackUp: up, canStackDown: down, canBeRound: round}, workspaceForm: {outputConnection: {}}
}});

test.each([-16.5, -12.25, 0])('horizontal placement retains the native origin beneath an outline at %s', top => {
    const hat = block('hat', {hat: true, bounds: {x: 100, y: 80, width: 144, height: 300}});
    hat.svgPath_ = {getBBox: () => ({x: 0, y: top, width: 144, height: 48 - top})};
    const stops = navigationStops(workspace([hat]));
    const at = stops.find(stop => stop.kind === 'block');
    expect(at.bounds).toEqual({x: 100, y: 80 + top, width: 144, height: 48 - top, originY: 80});
    expect(navigate(stops, at, 'ArrowRight')).toMatchObject({kind: 'workspace', y: 80});
});

test('a detached script caret stays horizontally aligned with its top-level stack', () => {
    const tail = block('tail');
    tail.nextConnection = {type: 3, targetBlock: () => null};
    tail.getRootBlock = () => tail;
    tail.getRelativeToSurfaceXY = () => ({x: 246.5, y: 91.25});
    tail.getHeightWidth = () => ({width: 104, height: 37.5});
    const ws = workspace([tail]);
    expect(detachedStackPosition(ws, {kind: 'gap', blockId: tail.id})).toEqual({
        kind: 'workspace', x: 246.5, y: 178.75
    });
});

test('a detached script uses its outer C root rather than an indented body tail', () => {
    const tail = block('tail');
    tail.nextConnection = {type: 3, targetBlock: () => null};
    const root = block('root', {inputs: [input('SUBSTACK', tail, 3)]});
    tail.getRootBlock = () => root;
    tail.getRelativeToSurfaceXY = () => ({x: 132, y: 170});
    tail.getHeightWidth = () => ({width: 90, height: 40});
    root.getRelativeToSurfaceXY = () => ({x: 100, y: 50});
    root.getHeightWidth = () => ({width: 180, height: 260});
    expect(detachedStackPosition(workspace([root]), {kind: 'gap', blockId: tail.id})).toEqual({
        kind: 'workspace', x: 100, y: 360
    });
});

test('a detached script caret does not reinterpret occupied or unrelated positions', () => {
    const child = block('child');
    const anchor = block('anchor', {next: child});
    anchor.getRelativeToSurfaceXY = () => ({x: 20, y: 30});
    anchor.getHeightWidth = () => ({width: 80, height: 40});
    const ws = workspace([anchor]);
    expect(detachedStackPosition(ws, {kind: 'gap', blockId: anchor.id})).toBeNull();
    expect(detachedStackPosition(ws, {kind: 'block', blockId: anchor.id})).toBeNull();
    expect(detachedStackPosition(ws, {kind: 'workspace', x: 12, y: 34})).toEqual({
        kind: 'workspace', x: 12, y: 34
    });
});

test('a default shadow and its input have one editable navigation stop', () => {
    const number = block('n', {fields: [field('NUM')], shadow: true, reporter: true});
    const ws = workspace([block('move', {inputs: [input('STEPS', number)]})]);
    expect(navigationStops(ws).map(positionKey)).toEqual([
        'block:move::', 'input:move:STEPS:', 'gap:move::'
    ]);
    const position = {kind: 'input', blockId: 'move', inputName: 'STEPS'};
    expect(fieldAtPosition(ws, position)).toEqual({block: number, field: number.inputList[0].fieldRow[0]});
    expect(canonicalPosition(ws, {kind: 'field', blockId: 'n', fieldName: 'NUM'})).toEqual(position);
});

test('filled reporter slots expose the reporter once, then its operands in reading order', () => {
    const plus = block('plus', {reporter: true, inputs: [
        input('NUM1', block('n', {fields: [field('NUM')], shadow: true})), input('NUM2', null)
    ]});
    const ws = workspace([block('move', {inputs: [input('STEPS', plus)]})]);
    expect(navigationStops(ws).map(positionKey)).toEqual([
        'block:move::', 'block:plus::', 'input:plus:NUM1:', 'input:plus:NUM2:', 'gap:move::'
    ]);
    const filled = {kind: 'input', blockId: 'move', inputName: 'STEPS'};
    expect(canonicalPosition(ws, filled)).toEqual({kind: 'block', blockId: 'plus'});
    expect(fieldAtPosition(ws, filled)).toBeNull(); // Typing cannot overwrite the real expression.
    expect(fieldAtPosition(ws, {kind: 'input', blockId: 'plus', inputName: 'NUM2'})).toBeNull();
});

test('a multi-field shadow keeps each distinct field but no duplicate wrapper stop', () => {
    const value = block('value', {shadow: true, fields: [field('A'), field('B')]});
    const ws = workspace([block('owner', {inputs: [input('VALUE', value)]})]);
    expect(navigationStops(ws).map(positionKey)).toEqual([
        'block:owner::', 'field:value::A', 'field:value::B', 'gap:owner::'
    ]);
    const at = {kind: 'field', blockId: 'value', fieldName: 'B'};
    expect(canonicalPosition(ws, at)).toEqual(at);
    expect(fieldAtPosition(ws, at).field.name).toBe('B');
    expect(fieldAtPosition(ws, {kind: 'input', blockId: 'owner', inputName: 'VALUE'})).toBeNull();
});

test('input-first focus visits the header before C bodies, whether it is empty or already filled', () => {
    const body = input('SUBSTACK', null, 3);
    expect(firstInput(block('if', {inputs: [input('CONDITION', null), body]})))
        .toEqual({kind: 'input', blockId: 'if', inputName: 'CONDITION'});
    const not = block('not', {reporter: true, inputs: [input('OPERAND', null)]});
    expect(firstInput(block('if', {inputs: [input('CONDITION', not), body]})))
        .toEqual({kind: 'block', blockId: 'not'});
    expect(firstInput(block('repeat', {inputs: [input('TIMES', block('n', {shadow: true})), body]})))
        .toEqual({kind: 'input', blockId: 'repeat', inputName: 'TIMES'});
    const complete = block('less', {reporter: true, inputs: [input('A', block('n', {shadow: true}))]});
    expect(firstInput(block('if', {inputs: [input('CONDITION', complete), body]})))
        .toEqual({kind: 'block', blockId: 'less'});
    expect(firstInput(block('forever', {inputs: [body]})))
        .toEqual({kind: 'gap', blockId: 'forever', inputName: 'SUBSTACK'});
});

test('a custom definition treats its prototype as a signature and its native next connection as the body', () => {
    const prototype = block('procedures_prototype', {shadow: true});
    const body = block('move');
    const definition = block('procedures_definition', {
        inputs: [input('custom_block', prototype, 3)],
        next: body,
        hat: true
    });
    expect(firstInput(definition)).toEqual({kind: 'gap', blockId: 'procedures_definition'});
    expect(navigationStops(workspace([definition])).map(positionKey)).toEqual([
        'block:procedures_definition::',
        'gap:procedures_definition::',
        'block:move::',
        'gap:move::'
    ]);
});

test('missing fields, stale positions and cyclic expressions do not create editable targets or loop', () => {
    const b = block('b');
    const ws = workspace([b]);
    const missing = {kind: 'field', blockId: 'b', fieldName: 'gone'};
    expect(fieldAtPosition(ws, missing)).toBeNull();
    expect(canonicalPosition(ws, missing)).toEqual(missing);
    expect(fieldAtPosition(ws, {kind: 'field', blockId: 'gone'})).toBeNull();
    b.inputList.push(input('CYCLE', b));
    expect(firstInput(b)).toEqual({kind: 'block', blockId: 'b'}); // No recursive traversal of corrupted inputs.
    expect(firstInput(null)).toBeNull();
    expect(firstInput(block('next costume'))).toBeNull();
});

test('literal input focus does not depend on blank, default or explicitly supplied values', () => {
    const literal = (id, value) => block(id, {shadow: true, reporter: true, fields: [field('TEXT', value)]});
    const equal = block('equal', {reporter: true, inputs: [
        input('OPERAND1', literal('left', '')), input('OPERAND2', literal('right', ''))
    ]});
    expect(firstInput(equal)).toEqual({kind: 'input', blockId: 'equal', inputName: 'OPERAND1'});
    equal.inputList[1].connection.targetBlock().inputList[0].fieldRow[0] = field('TEXT', '0');
    expect(firstInput(equal)).toEqual({kind: 'input', blockId: 'equal', inputName: 'OPERAND1'});
    const outer = block('if', {inputs: [input('CONDITION', equal), input('SUBSTACK', null, 3)]});
    expect(firstInput(outer)).toEqual({kind: 'block', blockId: 'equal'});
    equal.inputList[2].connection.targetBlock().inputList[0].fieldRow[0] = field('TEXT', 'hello');
    expect(firstInput(equal)).toEqual({kind: 'input', blockId: 'equal', inputName: 'OPERAND1'});
});

test('native fields and multi-field shadows use the same first stop as Tab, not an opcode list', () => {
    const key = block('hat', {fields: [field('KEY_OPTION', 'space')]});
    const colour = block('pen', {inputs: [input('COLOR', block('c', {
        shadow: true, fields: [field('COLOUR', '#ff0000')]
    }))]});
    const multi = block('extension', {inputs: [input('VALUE', block('v', {
        shadow: true, fields: [field('A'), field('B')]
    }))]});
    for (const root of [key, colour, multi]) {
        const stops = navigationStops(workspace([root]));
        expect(positionKey(firstInput(root))).toBe(positionKey(stops[1]));
    }
});

test('value inputs precede inline selectors when entering a block, without hiding selector navigation', () => {
    const operand = input('VALUE', block('number', {shadow: true, fields: [field('NUM')]}));
    // Native renderers can put the dropdown and its value on the same input row.
    operand.fieldRow = [field('OPERATION', 'abs')];
    const operation = block('operation', {reporter: true, inputs: [operand]});
    expect(firstInput(operation)).toEqual({kind: 'input', blockId: 'operation', inputName: 'VALUE'});
    expect(navigationStops(workspace([operation])).map(positionKey)).toContain('field:operation::OPERATION');
    const setter = block('setter', {fields: [field('VARIABLE', 'cake')], inputs: [input('VALUE', null)]});
    expect(firstInput(setter)).toEqual({kind: 'input', blockId: 'setter', inputName: 'VALUE'});
    expect(firstInput(block('menu only', {fields: [field('KEY_OPTION')]})))
        .toEqual({kind: 'field', blockId: 'menu only', fieldName: 'KEY_OPTION'});
});

test('Delete preserves the owning reporter hole while Backspace selects its preceding expression', () => {
    const abs = block('abs', {reporter: true, inputs: [input('NUM', null)]});
    const plus = block('plus', {reporter: true, inputs: [input('A', abs), input('B', null)]});
    const ws = workspace([block('move', {inputs: [input('STEPS', plus)]})]);
    expect(deletionPosition(ws, {kind: 'block', blockId: 'abs'}))
        .toEqual({kind: 'input', blockId: 'plus', inputName: 'A'});
    expect(deletionPosition(ws, {kind: 'block', blockId: 'abs'}, {backwards: true}))
        .toEqual({kind: 'block', blockId: 'plus'});
});

test('Delete selects an ordinary stack boundary and Backspace skips the previous command inputs', () => {
    const second = block('second', {next: block('tail')});
    const ws = workspace([block('first', {next: second, inputs: [input('VALUE', block('reporter', {reporter: true}))]})]);
    expect(deletionPosition(ws, {kind: 'block', blockId: 'second'})).toEqual({kind: 'gap', blockId: 'first'});
    expect(deletionPosition(ws, {kind: 'block', blockId: 'second'}, {backwards: true}))
        .toEqual({kind: 'block', blockId: 'first'});
});

test.each(['THEN', 'ELSE'])('deleting the first %s command retains its mouth boundary', name => {
    const ws = workspace([block('if', {inputs: [input(name, block('body'), 3)]})]);
    expect(deletionPosition(ws, {kind: 'block', blockId: 'body'}))
        .toEqual({kind: 'gap', blockId: 'if', inputName: name});
    expect(deletionPosition(ws, {kind: 'block', blockId: 'body'}, {backwards: true}))
        .toEqual({kind: 'block', blockId: 'if'});
});

test('removing a root leaves an upper boundary or its original workspace position, not another script', () => {
    const root = block('root', {next: block('tail')});
    const single = block('single', {reporter: true});
    single.getRelativeToSurfaceXY = () => ({x: 250.5, y: 91.25});
    const ws = workspace([block('unrelated'), root, single]);
    for (const backwards of [false, true]) {
        expect(deletionPosition(ws, {kind: 'block', blockId: 'root'}, {backwards}))
            .toEqual({kind: 'before', blockId: 'tail'});
        expect(deletionPosition(ws, {kind: 'block', blockId: 'single'}, {backwards}))
            .toEqual({kind: 'workspace', x: 250.5, y: 91.25});
    }
    expect(deletionPosition(ws, {kind: 'block', blockId: 'missing'})).toBeNull();
});

test('a standalone reporter has a final insertion boundary after its last operand', () => {
    const equal = block('equal', {reporter: true, inputs: [input('A', null), input('B', null)]});
    const stops = navigationStops(workspace([equal]));
    expect(stops.map(positionKey)).toEqual([
        'block:equal::', 'input:equal:A:', 'input:equal:B:', 'after:equal::'
    ]);
    for (const key of ['Tab', 'ArrowDown', 'End']) {
        expect(navigate(stops, stops[2], key)).toEqual(stops[3]);
    }
    expect(navigate(stops, stops[3], 'Tab', true)).toEqual(stops[2]);
    expect(navigate(stops, stops[3], 'ArrowUp')).toEqual(stops[0]);
});

test('Down can leave a C-body final gap and continue after the surrounding C block', () => {
    const stops = navigationStops(workspace([block('repeat', {inputs: [input('SUBSTACK', block('wait'), 3)]})]));
    const inside = {kind: 'gap', blockId: 'wait'};
    expect(positionKey(navigate(stops, inside, 'ArrowDown'))).toBe('gap:repeat::');
    expect(positionKey(navigate(stops, inside, 'Tab'))).toBe('gap:repeat::');
    expect(positionKey(navigate(stops, {kind: 'block', blockId: 'wait'}, 'ArrowDown'))).toBe('gap:wait::');
});

test('accepting a literal uses the native field and restores its enclosing event group', () => {
    class TextField {
        constructor() { Object.assign(this, field('TEXT', 'old')); }
        setValue(value) { this.value = value; this.group = group; }
    }
    let group = 'outer';
    const nativeField = new TextField();
    const ws = workspace([block('say', {inputs: [input('MESSAGE', block('text', {
        shadow: true, reporter: true, fields: [nativeField]
    }))]})]);
    const ScratchBlocks = {FieldTextInput: TextField,
        Events: {getGroup: () => group, setGroup: value => { group = value; }}};
    const position = {kind: 'input', blockId: 'say', inputName: 'MESSAGE'};
    const phases = [];
    const onGroup = () => {
        phases.push({value: nativeField.value, group});
        return () => phases.push({value: nativeField.value, group});
    };
    setInputValue({ScratchBlocks, workspace: ws, position, value: 'new text', onGroup});
    expect(nativeField.value).toBe('new text');
    expect(nativeField.group).toBe(true);
    expect(group).toBe('outer');
    expect(phases).toEqual([{value: undefined, group: true}, {value: 'new text', group: true}]);
    expect(() => setInputValue({ScratchBlocks, workspace: ws, position: {...position, blockId: 'gone'}, value: 'x'}))
        .toThrow('no longer accepts');
});

test('vertical movement crosses C bodies but skips nested expression fields', () => {
    const reporter = block('plus', {reporter: true, fields: [field('X')]});
    const move = block('move', {inputs: [input('STEPS', reporter)]});
    const after = block('wait');
    const repeat = block('repeat', {inputs: [input('SUBSTACK', move, 3)], next: after});
    const stops = navigationStops(workspace([repeat]));
    expect(positionKey(navigate(stops, {kind: 'block', blockId: 'repeat'}, 'ArrowDown'))).toBe('block:move::');
    expect(positionKey(navigate(stops, {kind: 'field', blockId: 'plus', fieldName: 'X'}, 'ArrowDown'))).toBe('gap:move::');
    expect(positionKey(navigate(stops, {kind: 'block', blockId: 'wait'}, 'ArrowUp'))).toBe('gap:move::');
    expect(navigate(stops, {kind: 'gap', blockId: 'repeat'}, 'ArrowDown').blockId).toBe('wait');
    expect(navigate(stops, {kind: 'gap', blockId: 'repeat', inputName: 'SUBSTACK'}, 'ArrowDown').blockId).toBe('move');
});

test('horizontal navigation and reverse Tab visit the same structural stops', () => {
    const ws = workspace([block('b', {fields: [field('DIRECTION')]})]);
    const stops = navigationStops(ws);
    expect(navigate(stops, stops[0], 'ArrowRight')).toEqual(stops[1]);
    expect(navigate(stops, stops[1], 'Tab', true)).toEqual(stops[0]);
    expect(navigate(stops, stops[1], 'End')).toEqual(stops[2]);
    expect(navigate(stops, stops[2], 'Home')).toEqual(stops[0]);
});

test('horizontal arrows stop at command boundaries, while Tab still crosses rows', () => {
    const plus = block('plus', {reporter:true, inputs:[input('A', null), input('B', null)]});
    const middle = block('middle', {inputs:[input('N', plus)], next:block('last')});
    const stops = navigationStops(workspace([block('first', {next:middle})]));
    const at = key => stops.find(stop=>positionKey(stop)===key);
    expect(navigate(stops, at('block:middle::'), 'ArrowLeft')).toBe(at('block:middle::'));
    expect(navigate(stops, at('gap:middle::'), 'ArrowRight')).toBe(at('gap:middle::'));
    expect(navigate(stops, at('block:middle::'), 'ArrowRight')).toBe(at('block:plus::'));
    expect(navigate(stops, at('block:plus::'), 'ArrowLeft')).toBe(at('block:middle::'));
    expect(navigate(stops, at('gap:middle::'), 'ArrowLeft')).toBe(at('gap:middle::'));
    expect(navigate(stops, at('input:plus:B:'), 'ArrowRight')).toBe(at('input:plus:B:'));
    expect(navigate(stops, at('block:middle::'), 'Tab', true)).toBe(at('block:first::'));
    expect(navigate(stops, at('gap:middle::'), 'Tab')).toBe(at('block:last::'));
});

test('Tab skips occupied mouths and next boundaries while End reaches the body tail', () => {
    const stops = navigationStops(workspace([block('c', {inputs:[input('N',null),
        input('SUBSTACK',block('first',{next:block('last')}),3),input('SUBSTACK2',null,3)],next:block('after')})]));
    const at = key => stops.find(stop=>positionKey(stop)===key);
    expect(navigate(stops,at('input:c:N:'),'Tab')).toBe(at('block:first::'));
    expect(navigate(stops,at('block:first::'),'Tab')).toBe(at('block:last::'));
    expect(navigate(stops,at('block:last::'),'Tab',true)).toBe(at('block:first::'));
    expect(navigate(stops,at('block:first::'),'End')).toBe(at('gap:last::'));
    expect(navigate(stops,at('gap:first::'),'ArrowDown')).toBe(at('block:last::'));
    expect(navigate(stops,at('gap:first::'),'ArrowUp')).toBe(at('block:first::'));
    expect(navigate(stops,at('gap:last::'),'Tab')).toBe(at('gap:c:SUBSTACK2:'));
    let position=stops[0];
    for(let i=0;i<stops.length;i++) {
        position=navigate(stops,position,'Tab');
        expect(Boolean(position.occupied)).toBe(false);
    }
});

test.each([[false,false],[true,false],[false,true],[true,true]])(
    'Home/End use the current statement chain from every operand and boundary (hat %s, cap %s)', (hat, cap) => {
        const plus = block('plus', {reporter:true,inputs:[input('A',null),input('B',null)]});
        const tail = block('tail',{cap,fields:[field('MODE')]});
        const middle = block('middle',{inputs:[input('N',plus)],next:tail});
        const head = block('head',{hat,next:middle});
        const stops = navigationStops(workspace([block('unrelated'),head,block('other')]));
        const at = key => stops.find(stop=>positionKey(stop)===key);
        for (const position of stops.filter(stop=>stop.scriptId==='head')) {
            const start = navigate(stops,position,'Home');
            const end = navigate(stops,position,'End');
            expect(start).toBe(at('block:head::'));
            expect(end).toBe(at(`${cap?'block':'gap'}:tail::`));
            expect(navigate(stops,start,'Home')).toBe(start);
            expect(navigate(stops,end,'End')).toBe(end);
        }
        expect(navigate(stops,{kind:'before',blockId:'middle'},'Home')).toBe(at('block:head::'));
        expect(navigate(stops,{kind:'before',blockId:'middle'},'End')).toBe(at(`${cap?'block':'gap'}:tail::`));
    });

test('Home/End isolate each nested C mouth, including empty and capped branches', () => {
    const inner = block('inner',{inputs:[input('COUNT',block('number',{shadow:true,fields:[field('NUM')]})),
        input('SUBSTACK',block('deepFirst',{next:block('deepLast')}),3),input('SUBSTACK2',null,3)],
    next:block('thenLast')});
    const outer = block('outer',{inputs:[input('CONDITION',block('bool',{reporter:true,inputs:[input('A',null)]})),
        input('SUBSTACK',block('thenFirst',{next:inner}),3),
        input('SUBSTACK2',block('elseFirst',{next:block('elseCap',{cap:true})}),3)],next:block('after')});
    const stops = navigationStops(workspace([block('hat',{hat:true,next:outer}),block('other')]));
    const scopes = [
        [['block:outer::','block:bool::','input:bool:A:','gap:outer::','block:after::'],'block:hat::','gap:after::'],
        [['gap:outer:SUBSTACK:','block:thenFirst::','block:inner::','input:inner:COUNT:',
            'gap:inner::','block:thenLast::','gap:thenLast::'],'block:thenFirst::','gap:thenLast::'],
        [['gap:inner:SUBSTACK:','block:deepFirst::','block:deepLast::','gap:deepLast::'],
            'block:deepFirst::','gap:deepLast::'],
        [['gap:outer:SUBSTACK2:','block:elseFirst::','block:elseCap::'],'block:elseFirst::','block:elseCap::'],
        [['gap:inner:SUBSTACK2:'],'gap:inner:SUBSTACK2:','gap:inner:SUBSTACK2:']
    ];
    const at = key => stops.find(stop=>positionKey(stop)===key);
    for (const [positions,home,end] of scopes) {
        for (const key of positions) {
            expect(at(key)).toBeDefined();
            expect(navigate(stops,at(key),'Home')).toBe(at(home));
            expect(navigate(stops,at(key),'End')).toBe(at(end));
        }
    }
    expect(navigate(stops,{kind:'before',blockId:'thenFirst'},'Home')).toBe(at('block:thenFirst::'));
    expect(navigate(stops,{kind:'before',blockId:'thenFirst'},'End')).toBe(at('gap:thenLast::'));
});

test('Home/End treat a loose expression as one root and a definition signature as part of its command chain', () => {
    const expr = block('expr',{reporter:true,inputs:[input('VALUE',
        block('nested',{reporter:true,inputs:[input('N',null)]}))]});
    const definition = block('definition',{hat:true,inputs:[input('custom_block',
        block('procedures_prototype',{shadow:true}),3)],next:block('body')});
    const stops = navigationStops(workspace([expr,definition]));
    for (const position of stops) {
        const isExpression = position.scriptId==='expr';
        expect(positionKey(navigate(stops,position,'Home'))).toBe(`block:${isExpression?'expr':'definition'}::`);
        expect(positionKey(navigate(stops,position,'End'))).toBe(isExpression?'after:expr::':'gap:body::');
    }
});

test('Home/End retain a free workspace caret instead of choosing an unrelated stack', () => {
    const stops = navigationStops(workspace([block('unrelated')]));
    const free = {kind:'workspace',x:450,y:200};
    expect(navigate(stops,free,'Home')).toBe(free);
    expect(navigate(stops,free,'End')).toBe(free);
});

test('horizontal navigation never enters C bodies, exits to their owner, or follows a next connector', () => {
    const c = block('c', {inputs:[input('COUNT', null), input('SUBSTACK', block('body', {next:block('tail')}), 3)]});
    const stops = navigationStops(workspace([c, block('other')]));
    expect(positionKey(navigate(stops, {kind:'gap',blockId:'c'}, 'ArrowLeft'))).toBe('gap:c::');
    expect(positionKey(navigate(stops, {kind:'input',blockId:'c',inputName:'COUNT'}, 'ArrowRight'))).toBe('input:c:COUNT:');
    expect(positionKey(navigate(stops, {kind:'gap',blockId:'c',inputName:'SUBSTACK'}, 'ArrowRight'))).toBe('gap:c:SUBSTACK:');
    expect(positionKey(navigate(stops, {kind:'block',blockId:'body'}, 'ArrowLeft'))).toBe('block:body::');
    expect(positionKey(navigate(stops, {kind:'block',blockId:'tail'}, 'ArrowLeft'))).toBe('block:tail::');
    expect(positionKey(navigate(stops, {kind:'block',blockId:'body'}, 'ArrowRight'))).toBe('block:body::');
    expect(positionKey(navigate(stops, {kind:'gap',blockId:'body'}, 'ArrowRight'))).toBe('gap:body::');
    expect(positionKey(navigate(stops, {kind:'block',blockId:'other'}, 'ArrowLeft'))).toBe('block:other::');
});

test('Up exposes a legal insertion above a top-level statement but not a hat, reporter or nested body', () => {
    const roots = [block('first'), block('second', {fields:[field('N')]}), block('hat',{hat:true}),
        block('reporter',{reporter:true}), block('c',{inputs:[input('SUBSTACK',block('body'),3)]})];
    const stops = navigationStops(workspace(roots));
    for (const id of ['first', 'second', 'c']) {
        expect(positionKey(navigate(stops,{kind:'block',blockId:id},'ArrowUp'))).toBe(`before:${id}::`);
    }
    expect(positionKey(navigate(stops,{kind:'field',blockId:'second',fieldName:'N'},'ArrowUp')))
        .toBe('before:second::');
    for (const id of ['hat','reporter','body']) {
        expect(stops.find(stop=>stop.kind==='block'&&stop.blockId===id).canInsertBefore).toBeUndefined();
        expect(navigate(stops,{kind:'block',blockId:id},'ArrowUp').kind).not.toBe('before');
    }
});

test('vertical navigation exposes empty mouths and the else boundary in reading order', () => {
    const after = block('after');
    const condition = block('if', {inputs: [input('SUBSTACK', null, 3), input('SUBSTACK2', null, 3)], next: after});
    const stops = navigationStops(workspace([condition]));
    const first = navigate(stops, stops[0], 'ArrowDown');
    expect(first.inputName).toBe('SUBSTACK');
    const second = navigate(stops, first, 'ArrowDown');
    expect(second.inputName).toBe('SUBSTACK2');
    const outer = navigate(stops, second, 'ArrowDown');
    expect(positionKey(outer)).toBe('block:after::');
    expect(navigate(stops, {kind: 'block', blockId: 'after'}, 'ArrowUp')).toEqual(second);
    expect(navigate(stops, outer, 'ArrowUp')).toEqual(second);
    expect(navigate(stops, second, 'ArrowUp')).toEqual(first);
});

test('else remains a reachable row when both branches contain nested commands', () => {
    const condition = block('if', {inputs: [input('SUBSTACK', block('yes'), 3), input('SUBSTACK2', block('no'), 3)]});
    const stops = navigationStops(workspace([condition]));
    const end = navigate(stops, {kind: 'block', blockId: 'yes'}, 'ArrowDown');
    expect(positionKey(end)).toBe('gap:yes::');
    const boundary = navigate(stops, end, 'ArrowDown');
    expect(positionKey(boundary)).toBe('block:no::');
    expect(navigate(stops, {kind: 'block', blockId: 'no'}, 'ArrowUp')).toEqual(end);
});

test('vertical command and connection traversal is reversible through nested then/else bodies', () => {
    const expression = block('equal', {reporter:true, inputs:[input('A', null), input('B', null)]});
    const inner = block('repeat', {inputs:[input('TIMES', null), input('SUBSTACK', block('move'), 3)]});
    const outer = block('if', {inputs:[input('CONDITION', expression),
        input('SUBSTACK', inner, 3), input('SUBSTACK2', block('say'), 3)], next:block('wait')});
    const stops = navigationStops(workspace([outer]));
    const route = ['block:if::', 'block:repeat::', 'block:move::', 'gap:move::', 'gap:repeat::',
        'block:say::', 'gap:say::', 'block:wait::', 'gap:wait::'];
    let position = {kind:'block',blockId:'if'};
    for (const expected of route.slice(1)) {
        position = navigate(stops, position, 'ArrowDown');
        expect(positionKey(position)).toBe(expected);
    }
    for (const expected of route.slice(0,-1).reverse()) {
        position = navigate(stops, position, 'ArrowUp');
        expect(positionKey(position)).toBe(expected);
    }
    expect(positionKey(navigate(stops, {kind:'input',blockId:'equal',inputName:'B'}, 'ArrowDown')))
        .toBe('block:repeat::');
    expect(positionKey(navigate(stops, {kind:'input',blockId:'repeat',inputName:'TIMES'}, 'ArrowUp')))
        .toBe('block:if::');
});

test('horizontal rows exclude empty and occupied mouths at every nesting depth', () => {
    const inner = block('repeat', {inputs:[input('TIMES', null), input('SUBSTACK', block('move'), 3)]});
    const outer = block('if', {inputs:[input('CONDITION', null),
        input('SUBSTACK', inner, 3), input('SUBSTACK2', null, 3)]});
    const stops = navigationStops(workspace([outer]));
    for (const current of stops) {
        for (const key of ['ArrowLeft', 'ArrowRight']) {
            const next = navigate(stops, current, key);
            expect(next.rowId).toBe(current.rowId);
            // Mouths can be reached by Up/Down or Tab, never inline traversal.
            if (next.kind === 'gap') expect(next).toBe(current);
        }
    }
    expect(positionKey(navigate(stops,{kind:'block',blockId:'repeat'},'ArrowRight'))).toBe('input:repeat:TIMES:');
    expect(positionKey(navigate(stops,{kind:'block',blockId:'repeat'},'ArrowLeft'))).toBe('block:repeat::');
    const empty = {kind:'gap',blockId:'if',inputName:'SUBSTACK2'};
    expect(positionKey(navigate(stops,empty,'ArrowRight'))).toBe(positionKey(empty));
    expect(positionKey(navigate(stops,empty,'ArrowLeft'))).toBe(positionKey(empty));
    expect(positionKey(navigate(stops,{kind:'input',blockId:'if',inputName:'CONDITION'},'ArrowDown')))
        .toBe('block:repeat::');
    expect(positionKey(navigate(stops,{kind:'block',blockId:'repeat'},'ArrowUp'))).toBe('block:if::');
});

test('Left exits a nested expression owner and Right continues through its parent operands', () => {
    const multiply = block('times',{reporter:true,inputs:[input('A',null),input('B',null)]});
    const plus = block('plus',{reporter:true,inputs:[input('A',multiply),input('B',null)]});
    const stops = navigationStops(workspace([block('move',{inputs:[input('STEPS',plus)]})]));
    expect(positionKey(navigate(stops,{kind:'block',blockId:'times'},'ArrowLeft'))).toBe('block:plus::');
    expect(positionKey(navigate(stops,{kind:'input',blockId:'times',inputName:'B'},'ArrowRight')))
        .toBe('input:plus:B:');
    expect(positionKey(navigate(stops,{kind:'input',blockId:'plus',inputName:'B'},'ArrowRight')))
        .toBe('input:plus:B:');
});

test('Down crosses a cap into the next visual script while other arrows respect its closed edge', () => {
    const hat = block('hat',{hat:true,next:block('cap',{cap:true})});
    const stops = navigationStops(workspace([hat,block('other')]));
    const at = id => stops.find(stop=>stop.kind==='block'&&stop.blockId===id);
    expect(navigate(stops,at('hat'),'ArrowUp')).toBe(at('hat'));
    expect(navigate(stops,at('cap'),'ArrowDown')).toBe(at('other'));
    expect(navigate(stops,at('cap'),'ArrowLeft')).toBe(at('cap'));
    expect(navigate(stops,at('cap'),'ArrowRight')).toBe(at('cap'));
    expect(navigate(stops,at('cap'),'Tab')).toBe(at('other'));
    expect(positionKey(navigate(stops,at('other'),'ArrowUp'))).toBe('before:other::');
    expect(positionKey(navigate(stops,{kind:'gap',blockId:'hat'},'ArrowDown'))).toBe('block:cap::');
});

test('repeated Down visits an ordinary tail insertion before continuing to the next script', () => {
    const stops = navigationStops(workspace([block('first'),block('below')]));
    const at = key => stops.find(stop=>positionKey(stop)===key);
    expect(navigate(stops,at('block:first::'),'ArrowDown')).toBe(at('gap:first::'));
    expect(navigate(stops,at('gap:first::'),'ArrowDown')).toBe(at('block:below::'));
    expect(navigate(stops,at('block:below::'),'ArrowDown')).toBe(at('gap:below::'));
    expect(navigate(stops,at('gap:below::'),'ArrowDown')).toBe(at('gap:below::'));
});

test('Down follows a geometric column and offers a reversible new-script placeholder at its end', () => {
    const upper = block('upper',{bounds:{x:40,y:30,width:130,height:42}});
    const right = block('right',{bounds:{x:310,y:35,width:120,height:42}});
    const lower = block('lower',{bounds:{x:44,y:180,width:150,height:42}});
    // Deliberately scramble document order: arrows follow the workspace, not
    // whichever root happened to be serialized first.
    const stops = navigationStops(workspace([right,lower,upper]));
    const at = key => stops.find(stop=>positionKey(stop)===key);
    expect(navigate(stops,at('gap:upper::'),'ArrowDown')).toBe(at('block:lower::'));
    const beforeLower = navigate(stops,at('block:lower::'),'ArrowUp');
    expect(positionKey(beforeLower)).toBe('before:lower::');
    expect(navigate(stops,beforeLower,'ArrowUp')).toBe(at('gap:upper::'));
    const tail = navigate(stops,at('gap:lower::'),'ArrowDown');
    expect(tail).toMatchObject({kind:'workspace',x:44,y:272,spatialDirection:'down'});
    expect(positionKey(navigate(stops,tail,'ArrowUp'))).toBe('gap:lower::');
    expect(navigate(stops,tail,'ArrowDown')).toMatchObject({kind:'workspace',x:44,y:368});
});

test('Up prefers insertion above its own hatless stack even when a capped stack is above', () => {
    const upper = block('upper',{next:block('cap',{cap:true,bounds:{x:42,y:74,width:120,height:42}}),
        bounds:{x:40,y:30,width:150,height:86}});
    const lower = block('lower',{bounds:{x:44,y:180,width:130,height:42}});
    const right = block('right',{bounds:{x:320,y:120,width:130,height:42}});
    const stops = navigationStops(workspace([right,lower,upper]));
    const at = key => stops.find(stop=>positionKey(stop)===key);
    const beforeLower = navigate(stops,at('block:lower::'),'ArrowUp');
    expect(positionKey(beforeLower)).toBe('before:lower::');
    expect(navigate(stops,beforeLower,'ArrowUp')).toBe(at('block:cap::'));
});

test('horizontal edges choose the nearest equivalent row without bypassing local inputs', () => {
    const left = block('left',{inputs:[input('VALUE',null)],bounds:{x:30,y:80,width:140,height:42}});
    const rightTail = block('rightTail',{bounds:{x:330,y:142,width:120,height:42}});
    const right = block('right',{next:rightTail,bounds:{x:330,y:78,width:150,height:106}});
    const stops = navigationStops(workspace([right,left]));
    const at = key => stops.find(stop=>positionKey(stop)===key);
    expect(navigate(stops,at('block:left::'),'ArrowRight')).toBe(at('input:left:VALUE:'));
    expect(navigate(stops,at('input:left:VALUE:'),'ArrowRight')).toBe(at('block:right::'));
    expect(navigate(stops,at('block:right::'),'ArrowLeft')).toBe(at('block:left::'));
});

test('horizontal ranking can use the complete height of a C-shaped selection', () => {
    const body = block('body',{bounds:{x:70,y:125,width:120,height:42}});
    const mouth = input('SUBSTACK',body,3);
    mouth.connection.y_ = 112;
    const left = block('left',{inputs:[mouth],bounds:{x:40,y:80,width:190,height:400}});
    const right = block('right',{bounds:{x:360,y:82,width:140,height:42}});
    const stops = navigationStops(workspace([left,right]));
    const at = key => stops.find(stop=>positionKey(stop)===key);
    expect(navigate(stops,at('block:right::'),'ArrowLeft')).toBe(at('block:left::'));
});

test('horizontal ranking uses a complete multi-selection height rather than only its focused block', () => {
    const leftLow = block('leftLow',{bounds:{x:40,y:285,width:140,height:42}});
    const leftMiddle = block('leftMiddle',{next:leftLow,bounds:{x:40,y:180,width:140,height:42}});
    const left = block('left',{next:leftMiddle,bounds:{x:40,y:75,width:140,height:42}});
    const low = block('low',{bounds:{x:360,y:330,width:140,height:42}});
    const middle = block('middle',{next:low,bounds:{x:360,y:205,width:140,height:42}});
    const high = block('high',{next:middle,bounds:{x:360,y:75,width:140,height:42}});
    const stops = navigationStops(workspace([left,high]));
    const at = key => stops.find(stop=>positionKey(stop)===key);
    const range = {anchorBlockId:'left',focusBlockId:'leftLow',blockIds:['left','leftMiddle','leftLow']};
    expect(navigate(stops,at('block:leftLow::'),'ArrowRight',false,range)).toBe(at('block:middle::'));
});

test('an empty horizontal corridor proposes free space from outer and nested command rows', () => {
    const simpleStops = navigationStops(workspace([
        block('simple',{bounds:{x:40,y:60,width:190,height:42}})
    ]));
    const simple = simpleStops.find(stop=>positionKey(stop)==='block:simple::');
    expect(navigate(simpleStops,simple,'ArrowRight')).toMatchObject({kind:'workspace',x:310,y:60});
    expect(navigate(simpleStops,simple,'ArrowLeft')).toMatchObject({kind:'workspace',x:-230,y:60});

    const nested = block('nested',{bounds:{x:68,y:120,width:100,height:42}});
    const root = block('root',{inputs:[input('SUBSTACK',nested,3)],bounds:{x:40,y:60,width:190,height:150}});
    const stops = navigationStops(workspace([root]));
    const at = key => stops.find(stop=>positionKey(stop)===key);
    expect(navigate(stops,at('block:nested::'),'ArrowRight')).toMatchObject({kind:'workspace',x:310,y:120});
    expect(navigate(stops,at('block:nested::'),'ArrowLeft')).toMatchObject({kind:'workspace',x:-230,y:120});
});

test('no horizontal edge visits an ordinary top or bottom insertion boundary', () => {
    const stops = navigationStops(workspace([block('a', {inputs:[input('N',null),
        input('SUBSTACK',block('body',{next:block('tail')}),3),input('SUBSTACK2',null,3)],next:block('b')})]));
    for (const stop of stops) {
        for (const key of ['ArrowLeft','ArrowRight']) {
            const destination = navigate(stops,stop,key);
            if (destination === stop) continue;
            expect(destination.kind).not.toBe('before');
            expect(destination.kind).not.toBe('after');
            expect(destination.kind==='gap'&&!destination.inputName).toBe(false);
        }
    }
});

test('stale positions recover to a valid stop and cyclic input never loops', () => {
    const b = block('b');
    b.getNextBlock = () => b;
    const stops = navigationStops(workspace([b]));
    expect(stops).toHaveLength(2);
    expect(navigate(stops, {kind: 'block', blockId: 'deleted'}, 'Tab')).toEqual(stops[0]);
});

test('insertion cannot evict a tail with an end-cap, or evict a real reporter', () => {
    const ws = workspace([block('head', {next: block('tail'), inputs: [input('VALUE', block('reporter', {reporter: true}))]})]);
    expect(accepts(ws, {kind: 'gap', blockId: 'head'}, candidate(true, false))).toBe(false);
    expect(accepts(ws, {kind: 'gap', blockId: 'head'}, candidate(true, true))).toBe(true);
    expect(accepts(ws, {kind: 'gap', blockId: 'head'}, candidate(false, true))).toBe(false);
    expect(accepts(ws, {kind: 'input', blockId: 'head', inputName: 'VALUE'}, candidate(false, false, true))).toBe(false);
    expect(resolveConnection(ws, {kind: 'gap', blockId: 'missing'})).toBeNull();
});

test('native event group restores the enclosing context even on failure', () => {
    let group = 'outer';
    const ScratchBlocks = {Events: {getGroup: () => group, setGroup: value => { group = value; }}};
    expect(() => inEventGroup(ScratchBlocks, () => { throw new Error('test'); })).toThrow('test');
    expect(group).toBe('outer');
});

test('inserting above a free stack aligns native connections without displacing the receiver', () => {
    const receiving = {x_:352, y_:147, targetConnection:null};
    const actor = {moveBy:jest.fn(), nextConnection:{x_:32, y_:40, connect:jest.fn()}};
    const ws = {getBlockById:()=>({previousConnection:receiving})};
    expect(placeBlock(ws, {kind:'before',blockId:'root'}, actor)).toBe(actor);
    expect(actor.moveBy).toHaveBeenCalledWith(320,107);
    expect(actor.nextConnection.connect).toHaveBeenCalledWith(receiving);
    expect(receiving).toEqual({x_:352,y_:147,targetConnection:null});
});

test('a split boundary enters its own root and still supports reverse traversal', () => {
    const stops = navigationStops(workspace([block('first'), block('tail')]));
    const before = {kind:'before', blockId:'tail'};
    for (const key of ['ArrowDown', 'Tab', 'Home']) {
        expect(positionKey(navigate(stops, before, key))).toBe('block:tail::');
    }
    expect(navigate(stops, before, 'ArrowUp')).toBe(before);
    expect(navigate(stops, before, 'ArrowLeft')).toBe(before);
    expect(navigate(stops, before, 'ArrowRight')).toBe(before);
    expect(positionKey(navigate(stops, before, 'Tab', true))).toBe('gap:first::');
});

test.each([false,true])('a connected before-caret navigates as its shared incoming connection (mouth: %s)', mouth => {
    const tail = block('tail');
    const owner = block('owner', mouth ? {inputs:[input('SUBSTACK',tail,3)]} : {next:tail});
    const stops = navigationStops(workspace([owner]));
    const before = {kind:'before',blockId:'tail'};
    const boundary = {kind:'gap',blockId:'owner',...(mouth ? {inputName:'SUBSTACK'} : {})};
    for (const key of ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home','End','Tab']) {
        expect(navigate(stops,before,key)).toEqual(navigate(stops,boundary,key));
    }
    expect(positionKey(navigate(stops,before,'ArrowUp'))).toBe('block:owner::');
    expect(positionKey(navigate(stops,before,'ArrowDown'))).toBe('block:tail::');
});

test('undoing the caret owner retains the preceding insertion boundary', () => {
    const previous = navigationStops(workspace([block('first', {next:block('second', {next:block('deleted')})})]));
    const current = navigationStops(workspace([block('first', {next:block('second')})]));
    expect(positionKey(recoverPosition(current, previous, {kind:'gap', blockId:'deleted'}))).toBe('gap:second::');
});

test('undoing an expression restores its owning input without a duplicate navigation stop', () => {
    const times = block('times', {reporter: true, inputs: [input('NUM1', null)]});
    const plus = block('plus', {reporter: true, inputs: [input('NUM2', times)]});
    const previous = navigationStops(workspace([block('move', {inputs: [input('STEPS', plus)]})]));
    const current = navigationStops(workspace([block('move', {
        inputs: [input('STEPS', block('n', {shadow: true, fields: [field('NUM')]}))]
    })]));
    expect(previous.filter(stop => stop.kind === 'input' && stop.blockId === 'move')).toHaveLength(0);
    for (const position of [
        {kind: 'block', blockId: 'plus'}, {kind: 'block', blockId: 'times'},
        {kind: 'input', blockId: 'times', inputName: 'NUM1'}
    ]) {
        expect(positionKey(recoverPosition(current, previous, position))).toBe('input:move:STEPS:');
    }
});

test('removing an input field returns to its surviving structural owner or input slot', () => {
    const previous = navigationStops(workspace([block('b', {fields:[field('DIRECTION')]})]));
    const current = navigationStops(workspace([block('b')]));
    expect(positionKey(recoverPosition(current, previous, {kind:'field', blockId:'b', fieldName:'DIRECTION'})))
        .toBe('block:b::');
    const old = navigationStops(workspace([block('b', {
        inputs:[input('VALUE', block('shadow', {fields:[field('NUM')], shadow:true}))]
    })]));
    const now = navigationStops(workspace([block('b', {inputs:[input('VALUE', null)]})]));
    expect(positionKey(recoverPosition(now, old, {kind:'input', blockId:'b', inputName:'VALUE'})))
        .toBe('input:b:VALUE:');
});

test('navigation recovery retains a free draft location and tolerates an empty project', () => {
    const free = {kind:'workspace', x:25, y:80};
    expect(recoverPosition([], [], free)).toBe(free);
    expect(recoverPosition([], [], {kind:'block', blockId:'deleted'})).toBeNull();
    const current = navigationStops(workspace([block('a')]));
    const before = {kind:'before', blockId:'a'};
    expect(recoverPosition(current, [], before)).toBe(before);
});
