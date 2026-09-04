// A navigation may temporarily replace the workspace and disable Keyboard mode.
// Only an accepted, still-current request may restore that ownership afterwards.
class NavigationHandoff {
    constructor () {
        this.pending = null;
    }

    cancel () {
        this.pending = null;
    }

    begin (request, {enabled, available}) {
        const mayFollow = available && (enabled || Boolean(this.pending));
        this.cancel();
        // Keyboard mode owns structural selection for ordinary searches too.
        // The producer's followSelection flag describes how exploration began,
        // not whether an already-active structural editor follows its result.
        if (mayFollow && Number.isInteger(request.requestId) &&
            request.blockId && request.targetId) {
            this.pending = {...request};
        }
    }

    contextChanged (previousTargetId, targetId) {
        // Same-target replacement is not a sprite-navigation handoff (e.g. a
        // load or history restore). It must retain the ordinary reset behavior.
        if (!this.pending || previousTargetId === targetId || this.pending.targetId !== targetId) this.cancel();
    }

    finish (result, targetId) {
        const request = this.pending;
        if (!request || request.requestId !== result.requestId) return null;
        this.cancel();
        return result.resolved === true && result.followSelection === request.followSelection &&
            request.blockId === result.blockId && request.targetId === result.targetId &&
            request.targetId === targetId ? {blockId: request.blockId, targetId} : null;
    }
}

export {NavigationHandoff};
