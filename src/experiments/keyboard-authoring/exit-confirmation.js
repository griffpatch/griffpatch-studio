// No timing window: two deliberate presses, interrupted by any other action.
// Native menus, dialogs and drafts consume Escape without arming this guard.
export class ExitConfirmation {
    constructor () {
        this.reset();
    }
    reset () {
        this.armed = false;
    }
    press (repeat = false) {
        if (repeat) return false;
        if (this.armed) {
            this.reset(); return true;
        }
        this.armed = true;
        return false;
    }
}
