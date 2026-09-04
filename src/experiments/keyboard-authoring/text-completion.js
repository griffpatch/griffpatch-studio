const numericText = value => {
    const text = String(value).trim();
    return text && !Number.isNaN(Number(text)) ? text : null;
};

// An unambiguous binary operator at a structural numeric slot continues its
// current value. A leading minus deliberately does not: `-10` is the ordinary
// signed replacement for the selected literal. Subtracting from a literal can
// still be written explicitly as `1 - 10`.
const numericContinuationPrefix = (value, key) => {
    const text = numericText(value);
    return /^[+*/]$/.test(key) && text ? `${text} ` : null;
};

const isCompactNegativeNumber = value => {
    const text = String(value);
    return text.startsWith('-') && !/\s/.test(text) && Boolean(numericText(text));
};

// A selected native value field has no reporter block for expression wrapping.
// Keep the user's text untouched, but give the parser its previous literal as
// the left operand while a leading minus is incomplete or spaced. Once the
// text becomes a compact signed number (`-10`), it is an ordinary replacement.
const valueContinuationQuery = (value, previousValue) => {
    const text = String(value);
    if (!text.startsWith('-') || isCompactNegativeNumber(text)) return text;
    return `${String(previousValue)} ${text}`;
};

// A selected reporter makes a leading operator a wrap instruction. Normalize
// only the parser query, not the user's native text input, so adjacent `-10`
// behaves like `- 10` while retaining browser text selection and Undo.
const expressionContinuationQuery = (value, selectedExpression) => {
    if (!selectedExpression) return value;
    return String(value).replace(/^(\s*[+\-*/])(?=(?:\d|\.\d))/, '$1 ');
};

// Keep completion inside the browser's text-undo history. Direct value writes
// and setRangeText do not create an undoable edit. execCommand is deprecated,
// but insertText remains the native undo-preserving option for a plain input.
// This adapter deliberately has no value-assignment fallback: unsupported
// browsers keep the query intact and can still accept the suggestion with Enter.
const completeText = (input, text, onChange) => {
    const document = input.ownerDocument;
    if (document.activeElement !== input || typeof document.execCommand !== 'function' ||
        (input.maxLength >= 0 && text.length > input.maxLength)) return false;
    if (input.value === text) return true;
    const selection = [input.selectionStart, input.selectionEnd, input.selectionDirection];
    let receivedInput = false;
    const observeInput = () => {
        receivedInput = true;
    };
    input.addEventListener('input', observeInput);
    try {
        input.select();
        try {
            document.execCommand('insertText', false, text);
        } catch (error) {
            input.setSelectionRange(...selection);
            return false;
        }
        if (input.value === text) {
            // Chromium dispatches input synchronously. Other engines may not;
            // keep the preview in sync without requesting a second native edit.
            if (!receivedInput) onChange();
            return true;
        }
        input.setSelectionRange(...selection);
        return false;
    } finally {
        input.removeEventListener('input', observeInput);
    }
};

export {completeText, expressionContinuationQuery, isCompactNegativeNumber, numericContinuationPrefix,
    valueContinuationQuery};
