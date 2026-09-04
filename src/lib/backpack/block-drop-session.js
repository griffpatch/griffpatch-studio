/**
 * Synchronous state for the ordering-sensitive Blockly-to-Backpack drop path.
 * React state remains responsible for rendering only: its queued updates can
 * commit after BLOCK_DRAG_UPDATE, mouseenter and BLOCK_DRAG_END have all fired.
 */
class BackpackBlockDropSession {
    constructor () {
        this.outsideWorkspace = false;
        this.overBackpack = false;
    }

    updateOutsideWorkspace (outsideWorkspace) {
        this.outsideWorkspace = outsideWorkspace;
    }

    enterBackpack () {
        if (!this.outsideWorkspace) return false;
        this.overBackpack = true;
        return true;
    }

    leaveBackpack () {
        this.overBackpack = false;
    }

    end () {
        const shouldDrop = this.overBackpack;
        this.outsideWorkspace = false;
        this.overBackpack = false;
        return shouldDrop;
    }
}

export default BackpackBlockDropSession;
