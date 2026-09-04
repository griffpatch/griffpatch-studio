import {SPRITE_CLICK_TIMING} from './pointer-controller';

const activateThroughPointer = ({pointer, clock, signal = null, activate, targetKind = null, speed = null}) => {
    if (signal && signal.aborted) return false;
    if (pointer && typeof pointer.click === 'function') {
        const timing = ['sprite-selector', 'stage-selector', 'sprite-create'].includes(targetKind) ?
            SPRITE_CLICK_TIMING : void 0;
        return pointer.click(activate, {clock, signal, timing, speed});
    }
    return Promise.resolve(activate()).then(() => !(signal && signal.aborted));
};

export {activateThroughPointer};
