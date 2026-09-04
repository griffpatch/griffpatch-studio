import {blockXml} from './catalogue';

const MAX_MULTILINE_CHARACTERS = 4096;
const MAX_MULTILINE_LINES = 50;
const MAX_LINE_CHARACTERS = 256;

const normalized = value => String(value)
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
const directChild = (element, tagName) => Array.from(element.children || []).find(child =>
    child.tagName.toLowerCase() === tagName);
const serialized = element => element.outerHTML || new XMLSerializer().serializeToString(element);

const exactInstance = (catalogue, line, lineNumber) => {
    const matches = catalogue.search(line).filter(result => !result.truncated &&
        normalized(result.text) === normalized(line));
    const unique = new Map();
    matches.forEach(result => {
        const xml = blockXml(result.instance);
        unique.set(serialized(xml), result.instance);
    });
    if (!unique.size) {
        throw new Error(`Line ${lineNumber} does not exactly match an existing Scratch block: “${line}”.`);
    }
    if (unique.size > 1) {
        throw new Error(`Line ${lineNumber} is ambiguous. Choose the block interactively: “${line}”.`);
    }
    return unique.values().next().value;
};

const buildStackXml = instances => {
    if (!instances.length) throw new Error('Paste at least one Scratch command.');
    const xml = blockXml(instances[0]);
    let current = xml;
    instances.slice(1).forEach(instance => {
        const oldNext = directChild(current, 'next');
        if (oldNext) oldNext.remove();
        const next = current.ownerDocument.createElement('next');
        const child = blockXml(instance);
        next.appendChild(child);
        current.appendChild(next);
        current = child;
    });
    const oldNext = directChild(current, 'next');
    if (oldNext) oldNext.remove();
    return xml;
};

const compileMultilinePaste = (catalogue, text) => {
    if (text.length > MAX_MULTILINE_CHARACTERS) {
        throw new Error(`Multiline paste is limited to ${MAX_MULTILINE_CHARACTERS} characters.`);
    }
    const lines = String(text)
        .split(/\r?\n/)
        .map((line, index) => ({text: line.trim(), number: index + 1}))
        .filter(line => line.text);
    if (!lines.length) throw new Error('Paste at least one Scratch command.');
    if (lines.length > MAX_MULTILINE_LINES) {
        throw new Error(`Multiline paste is limited to ${MAX_MULTILINE_LINES} nonblank commands.`);
    }
    lines.forEach(line => {
        if (line.text.length > MAX_LINE_CHARACTERS) {
            throw new Error(`Line ${line.number} is longer than ${MAX_LINE_CHARACTERS} characters.`);
        }
    });
    const instances = lines.map(line => exactInstance(catalogue, line.text, line.number));
    instances.forEach((instance, index) => {
        const shape = instance.typeInfo.shape;
        if (shape.canBeRound || (index > 0 && !shape.canStackUp)) {
            throw new Error(`Line ${lines[index].number} is a value block, not a stack command.`);
        }
        if (index < instances.length - 1 && !shape.canStackDown) {
            throw new Error(`Line ${lines[index].number} ends a script, so another command cannot follow it.`);
        }
    });
    return {xml: buildStackXml(instances), count: instances.length, lines: lines.map(line => line.text)};
};

export {buildStackXml, compileMultilinePaste, MAX_LINE_CHARACTERS, MAX_MULTILINE_CHARACTERS,
    MAX_MULTILINE_LINES};
