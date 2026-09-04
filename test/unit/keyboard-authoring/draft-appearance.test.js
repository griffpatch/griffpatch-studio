import {JSDOM} from 'jsdom';
import {ghostDraft} from '../../../src/experiments/keyboard-authoring/draft-appearance';

const dom = new JSDOM('');
afterAll(() => dom.window.close());
const element = tag => dom.window.document.createElementNS('http://www.w3.org/2000/svg', tag);
const block = id => {
    const root = element('g');
    const path = root.appendChild(element('path'));
    const field = root.appendChild(element('g'));
    const text = field.appendChild(element('text'));
    return {id, workspace: {options: {readOnly: true}}, getSvgRoot: () => root, root, path, field, text};
};

test('ghosts body, field and nested input paint once without fading the attached old tail', () => {
    const actor = block('new'), input = block('new-input'), nested = block('new-nested'), tail = block('old');
    actor.root.appendChild(input.root);
    input.root.appendChild(nested.root);
    actor.root.appendChild(tail.root);
    actor.getDescendants = () => [actor, input, nested, tail];
    ghostDraft(actor, new Set(['old']));
    for (const b of [actor, input, nested]) {
        expect(b.path.style.opacity).toBe('0.45');
        expect(b.field.style.opacity).toBe('0.45');
        expect(b.root.style.opacity).toBe('');
        expect(b.text.style.opacity).toBe('');
        expect(b.path.style.fillOpacity).toBe('');
        expect(b.path.dataset.keyboardDraftPaint).toBe('true');
    }
    expect(tail.root.style.opacity).toBe('');
    expect(tail.path.style.opacity).toBe('');
    expect(tail.field.style.opacity).toBe('');
    expect(input.root.parentNode).toBe(actor.root);
    expect(nested.root.parentNode).toBe(input.root);
    expect(tail.root.parentNode).toBe(actor.root);
    ghostDraft(actor, new Set(['old']));
    expect(input.field.style.opacity).toBe('0.45');
});

test('refuses to apply ghost presentation to editable project blocks', () => {
    const actor = block('live');
    actor.workspace.options.readOnly = false;
    expect(() => ghostDraft(actor, new Set())).toThrow('read-only');
    expect(actor.path.style.opacity).toBe('');
});
