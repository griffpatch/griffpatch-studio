/* eslint max-len: ["error", 120, {"ignoreStrings": true}] */
const SEEN_KEY = 'griffpatch-studio.keyboard-help-seen';

const sections = [
    ['Quick start', [
        ['Click, then type', 'Click empty space to start a script, or select a block to change it.'],
        ['Enter / Shift+Enter', 'Insert below / above a statement. Enter also accepts a suggestion.'],
        ['Arrow keys', 'Up/down: statements. Left/right: inputs and columns.'],
        ['Tab / Shift+Tab', 'Next / previous input. While typing, Tab completes a suggestion.'],
        ['Ctrl+Z', 'Undo. Ctrl+Shift+Z to redo. Use Cmd on Mac.'],
        ['Escape', 'Cancel an edit. Press twice outside an edit to leave keyboard mode.'],
        ['Alt+K', 'Toggle keyboard mode. Click the hint to reopen this guide.']
    ]],
    ['Move around', [
        ['Left / Right', 'Explore inputs and nested expressions, not the previous or next statement. At a column edge, press again to cross to another column; the chevron previews this. In free space, one press is enough.'],
        ['Up / Down', 'Visit statements and C-block bodies, then nearby stacks in the same column. Up from a stack without a hat offers an insertion above it; Up again continues to the stack above.'],
        ['Tab / Shift+Tab', 'Visit the next / previous editable position, including inputs.'],
        ['Home / End', 'Go to the beginning / end of the current statement chain. Ctrl (Cmd on Mac) reaches the outer script boundary.'],
        ['Alt+S', 'Bring the current script and caret into view.']
    ]],
    ['Type and complete', [
        ['Type a name or expression', 'Try “move 10”, “say hello”, or “score + 1”. Value inputs accept text and numbers as well as blocks.'],
        ['Up / Down in suggestions', 'Choose a completion. Tab completes its text; Enter accepts it. Missing inputs are visited first.'],
        ['Create… suggestions', 'Create variables, lists or broadcast messages where supported. Variable suggestions let you choose sprite-only or all-sprite scope.'],
        ['define name (input)', 'Create a custom block. Suggestions include running without screen refresh. In a stack, a call is inserted here and the definition is created separately.'],
        ['Enter on an empty insertion', 'Split the stack, or start a separate stack below the current one.'],
        ['Escape', 'Cancel the current draft or close a dialog. Outside an edit, two separate Escape presses exit keyboard mode.']
    ]],
    ['Edit and select', [
        ['F2', 'Rename the selected variable, list or broadcast; edit a custom block definition; or edit an ordinary text field.'],
        ['Delete / Backspace', 'Remove the selected block. Delete leaves an insertion where it was; Backspace moves to the previous eligible position. Backspace on if/else offers the simpler if when safe.'],
        ['Shift+Up / Down', 'Extend a selection through neighbouring statements. Shift+Home / End extends to a chain boundary.'],
        ['Alt+Up / Down', 'Move the selected statement or range one position.'],
        ['Alt+Shift+C', 'Clean-up+ layout: arrange this sprite’s scripts. Works from the code workspace in mouse or keyboard mode, even without a selection. Keeps the active script (or the viewport) in place; no blocks or variables are deleted.'],
        ['Ctrl+C / X / V / D', 'Copy, cut, paste at the caret, or duplicate blocks. Use Cmd on Mac.'],
        ['Ctrl+Z / Ctrl+Shift+Z', 'Undo / redo with the editor’s native history. Text fields keep their own text editing shortcuts.']
    ]],
    ['Find and return', [
        ['Ctrl+F', 'Open Finder. Choose a result and return to keyboard editing at that block.'],
        ['F3 / Shift+F3', 'Visit the next / previous match. Finish or cancel a draft first.'],
        ['Ctrl+Enter', 'Jump to a definition or usages of the selected item.'],
        ['Ctrl+Left / Right', 'Go back / forward through navigation history, including sprite changes.'],
        ['Switch sprites', 'Your keyboard position is remembered per sprite. Click Code to return to keyboard editing.']
    ]]
];

// Kept separate from the editing controller: this dialog never changes a block,
// selection or undo event. Native modal focus keeps its keys out of Blockly.
const createKeyboardHelp = ({parent, className, onClose}) => {
    const doc = parent.ownerDocument;
    const dialog = doc.createElement('dialog');
    dialog.className = className;
    dialog.setAttribute('aria-label', 'Keyboard editing guide');
    const title = doc.createElement('h2');
    title.textContent = 'Keyboard guide';
    dialog.appendChild(title);
    const intro = doc.createElement('p');
    intro.textContent = 'Select a block. Explore its inputs. Type to build.';
    dialog.appendChild(intro);
    const close = doc.createElement('button');
    close.type = 'button';
    close.textContent = 'Got it';
    close.autofocus = true;
    close.addEventListener('click', () => dialog.close());
    const tabs = doc.createElement('div');
    tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-label', 'Help topics');
    dialog.appendChild(tabs);
    const panels = [];
    const buttons = [];
    const selectTab = index => {
        buttons.forEach((button, i) => {
            button.setAttribute('aria-selected', String(i === index));
            button.tabIndex = i === index ? 0 : -1;
            panels[i].hidden = i !== index;
            if (i === index) panels[i].scrollTop = 0;
        });
    };
    const names = ['Quick start', 'Navigation', 'Typing', 'Editing', 'Find & return'];
    sections.forEach(([, rows], index) => {
        const tab = doc.createElement('button');
        tab.type = 'button';
        tab.textContent = names[index];
        tab.id = `keyboard-help-tab-${index}`;
        tab.setAttribute('role', 'tab');
        tab.setAttribute('aria-controls', `keyboard-help-panel-${index}`);
        tab.addEventListener('click', () => selectTab(index));
        tab.addEventListener('keydown', event => {
            const next = {ArrowRight: (index + 1) % sections.length,
                ArrowLeft: (index + sections.length - 1) % sections.length,
                Home: 0,
                End: sections.length - 1}[event.key];
            if (typeof next !== 'number') return;
            event.preventDefault();
            event.stopPropagation();
            selectTab(next);
            buttons[next].focus();
        });
        buttons.push(tab);
        tabs.appendChild(tab);
        const section = doc.createElement('section');
        section.id = `keyboard-help-panel-${index}`;
        section.setAttribute('role', 'tabpanel');
        section.setAttribute('aria-labelledby', tab.id);
        section.tabIndex = 0;
        panels.push(section);
        const list = doc.createElement('dl');
        rows.forEach(([keys, description]) => {
            const term = doc.createElement('dt');
            term.textContent = keys;
            const detail = doc.createElement('dd');
            detail.textContent = description;
            list.append(term, detail);
        });
        section.appendChild(list);
        dialog.appendChild(section);
    });
    selectTab(0);
    const footer = doc.createElement('footer');
    footer.appendChild(close);
    dialog.appendChild(footer);
    parent.appendChild(dialog);
    let seen = false;
    let disposed = false;
    try {
        seen = doc.defaultView.localStorage.getItem(SEEN_KEY) === '1';
    } catch (e) { /* Session only. */ }
    dialog.addEventListener('close', () => {
        if (!disposed) onClose();
    });
    return {
        isOpen: () => dialog.open,
        open: (firstUseOnly = false) => {
            if (disposed || dialog.open || (firstUseOnly && seen)) return;
            selectTab(0);
            dialog.showModal();
            seen = true;
            try {
                doc.defaultView.localStorage.setItem(SEEN_KEY, '1');
            } catch (e) { /* Session only. */ }
        },
        dispose: () => {
            disposed = true; dialog.remove();
        }
    };
};

export {createKeyboardHelp, SEEN_KEY};
