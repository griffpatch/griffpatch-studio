import {JSDOM} from 'jsdom';
import {completeText, expressionContinuationQuery, isCompactNegativeNumber, numericContinuationPrefix,
    valueContinuationQuery} from '../../../src/experiments/keyboard-authoring/text-completion';

test.each(['+', '*', '/'])('continues a structural numeric value before native insertion of %s', key => {
    expect(numericContinuationPrefix('23',key)).toBe('23 ');
    expect(numericContinuationPrefix(' -2.5 ',key)).toBe('-2.5 ');
    expect(numericContinuationPrefix('1e3',key)).toBe('1e3 ');
});

test('a leading minus does not prefill a selected numeric value', () => {
    expect(numericContinuationPrefix('23','-')).toBeNull();
});

test.each(['-10', '-.5', '-1e3'])('recognizes compact signed replacement %j', value => {
    expect(isCompactNegativeNumber(value)).toBe(true);
});

test.each(['-', '- 10', ' -10', '--10', '-cake', '10'])('does not treat %j as a compact signed replacement', value => {
    expect(isCompactNegativeNumber(value)).toBe(false);
});

test.each([
    ['-', '1', '1 -'],
    ['- 10', '1', '1 - 10'],
    ['-cake', '1', '1 -cake'],
    ['-', 'hello world', 'hello world -'],
    ['- 10', 'hello world', 'hello world - 10'],
    ['-10', '1', '-10'],
    ['-.5', 'hello', '-.5'],
    ['+10', '1', '+10'],
    ['ordinary text', '1', 'ordinary text']
])('derives an ordinary parser query for value edit %j over %j', (query, previous, expected) => {
    expect(valueContinuationQuery(query, previous)).toBe(expected);
});

test.each([
    ['-10', '- 10'], ['+23', '+ 23'], ['*2', '* 2'], ['/2', '/ 2'],
    ['- 10', '- 10'], ['x position', 'x position']
])('normalizes adjacent selected-expression continuation %j only for parsing', (query, expected) => {
    expect(expressionContinuationQuery(query, true)).toBe(expected);
    expect(expressionContinuationQuery(query, false)).toBe(query);
});

test.each(['', ' ', 'hello', '23px', '23 + 2', 'NaN'])(
    'does not reinterpret an empty or textual value %j as an arithmetic operand', value => {
        expect(numericContinuationPrefix(value,'+')).toBeNull();
    });

test.each(['-','2','a','(','Backspace'])('ordinary input %s retains replace-selection behaviour', key => {
    expect(numericContinuationPrefix('23',key)).toBeNull();
});

let dom;
let document;
let input;
beforeEach(() => {
    dom = new JSDOM('<input maxlength="256">');
    document = dom.window.document;
    input = document.querySelector('input');
    input.value = 'wai';
    input.focus();
    input.setSelectionRange(3, 3);
});
afterEach(() => dom.window.close());

test('without a native editing command, completion leaves the value and selection alone', () => {
    const update = jest.fn();
    expect(completeText(input, 'wait ', update)).toBe(false);
    expect(input.value).toBe('wai');
    expect(input.selectionStart).toBe(3);
    expect(update).not.toHaveBeenCalled();
});

test.each([false, true])('restores the selection when a native command is rejected (throws: %s)', throws => {
    document.execCommand = () => {
        if (throws) throw new Error('Unsupported');
        return false;
    };
    input.setSelectionRange(1, 2, 'backward');
    expect(completeText(input, 'wait ', jest.fn())).toBe(false);
    expect(input.value).toBe('wai');
    expect([input.selectionStart, input.selectionEnd, input.selectionDirection]).toEqual([1, 2, 'backward']);
});

test.each([false, true])('notifies exactly once whether native input fires synchronously or not (%s)', firesInput => {
    const update = jest.fn();
    input.addEventListener('input', update);
    document.execCommand = jest.fn((command, ui, value) => {
        expect([command, ui]).toEqual(['insertText', false]);
        expect([input.selectionStart, input.selectionEnd]).toEqual([0, 3]);
        input.value = value;
        if (firesInput) input.dispatchEvent(new dom.window.Event('input'));
        return true;
    });
    expect(completeText(input, 'wait ', update)).toBe(true);
    expect(update).toHaveBeenCalledTimes(1);
    expect(document.execCommand).toHaveBeenCalledTimes(1);
});

test('does not edit another input, exceed the query limit, or create a no-op history entry', () => {
    document.execCommand = jest.fn();
    input.blur();
    expect(completeText(input, 'wait ', jest.fn())).toBe(false);
    input.focus();
    expect(completeText(input, 'x'.repeat(257), jest.fn())).toBe(false);
    expect(completeText(input, 'wai', jest.fn())).toBe(true);
    expect(document.execCommand).not.toHaveBeenCalled();
});
