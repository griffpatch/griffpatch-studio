import {By, Key} from 'selenium-webdriver';

const state = driver => driver.executeScript(`
    const panel=document.getElementById('tw-studio-session-panel');
    return {cursor:Number(document.getElementById('tw-studio-step').value),
        status:panel.querySelector('.tw-studio-panel-status').textContent,
        busy:document.getElementById('tw-studio-speed').disabled,
        target:window.vm.editingTarget?.id};
`);

// Legacy regression scenarios describe semantic edit boundaries. Exercise the
// real keyboard, allowing exactly one explicit selection-only stop before an
// edit. Never retry an arbitrary no-op, mismatch, swallowed key or busy state.
const performStudioHistoryEdit = async (driver, redo = false) => {
    const before = await state(driver);
    const expected = before.cursor + (redo ? 1 : -1);
    let previous = before;
    for (let command = 1; command <= 2; command++) {
        const previousTarget = previous.target;
        await driver.findElement(By.css('body')).sendKeys(
            Key.chord(Key.CONTROL, ...(redo ? [Key.SHIFT, 'z'] : ['z'])));
        const settled = await driver.wait(async () => {
            const current = await state(driver);
            if (/restored|mismatch|reload required/.test(current.status)) throw new Error(current.status);
            if (current.busy) return false;
            return current.cursor === expected || (current.cursor === before.cursor &&
                current.target !== previousTarget && /^selected .+ — press (Undo|Redo) again/.test(current.status)) ?
                current : false;
        }, 30000, 'History key neither applied one edit nor stopped after selecting its sprite');
        if (settled.cursor === expected) return command;
        previous = settled;
    }
    throw new Error('A second history command selected another sprite instead of applying the visible edit');
};

export {performStudioHistoryEdit};
