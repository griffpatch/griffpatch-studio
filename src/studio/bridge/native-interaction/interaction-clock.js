const defaultRequestFrame = callback => requestAnimationFrame(callback);
const defaultCancelFrame = handle => cancelAnimationFrame(handle);
const CONNECTION_PREVIEW_PROGRESS = 0.72;
const movementEaseIn = value => value * value * value;
const movementEaseOut = value => 1 - Math.pow(1 - value, 3);

// A deliberately pronounced S-curve: the pointer has time to visibly gather
// and shed momentum while crossing the otherwise mechanical middle quickly.
const movementEaseInOut = value => (
    value < 0.5 ? (4 * value * value * value) : 1 - (Math.pow((-2 * value) + 2, 3) / 2)
);

const generatedPath = (start, end, frameCount, easing = movementEaseInOut) =>
    Array.from({length: frameCount + 1}, (_, index) => {
        const progress = easing(index / frameCount);
        return {
            x: start.x + ((end.x - start.x) * progress),
            y: start.y + ((end.y - start.y) * progress)
        };
    });

/**
 * One animation-frame clock shared by the visible pointer and native driver.
 *
 * @param {object} options clock dependencies
 * @returns {object} animation clock
 */
const createInteractionClock = ({
    requestFrame = defaultRequestFrame,
    cancelFrame = defaultCancelFrame
} = {}) => {
    let scheduled = null;
    let scheduledResolve = null;
    let cancelled = false;
    let fastForward = false;
    let speed = 1;

    const nextFrame = () => new Promise(resolve => {
        scheduledResolve = resolve;
        scheduled = requestFrame(() => {
            scheduled = null;
            scheduledResolve = null;
            resolve();
        });
    });

    const releaseScheduledFrame = () => {
        if (scheduled !== null) cancelFrame(scheduled);
        scheduled = null;
        if (scheduledResolve) scheduledResolve();
        scheduledResolve = null;
    };

    return {
        play: async ({points, holdFrames = 0, onFrame, signal = null, speed: sequenceSpeed = null}) => {
            if (sequenceSpeed !== null && (!Number.isFinite(sequenceSpeed) || sequenceSpeed <= 0)) {
                throw new Error('Playback speed must be positive');
            }
            cancelled = false;
            fastForward = false;
            const frames = [
                ...points.map(point => ({...point, hold: false})),
                ...Array.from({length: holdFrames}, () => ({...points[points.length - 1], hold: true}))
            ];
            let frameDebt = 0;
            for (let index = 0; index < frames.length; index++) {
                if (cancelled || (signal && signal.aborted)) return false;
                if (index > 0 && !fastForward) {
                    frameDebt += 1 / (sequenceSpeed === null ? speed : sequenceSpeed);
                    while (frameDebt >= 1) {
                        if (fastForward) break;
                        await nextFrame();
                        frameDebt -= 1;
                    }
                }
                if (cancelled || (signal && signal.aborted)) return false;
                await onFrame(frames[index], index);
            }
            return true;
        },
        cancel: () => {
            cancelled = true;
            releaseScheduledFrame();
        },
        finish: () => {
            fastForward = true;
            releaseScheduledFrame();
        },
        setSpeed: value => {
            if (!Number.isFinite(value) || value <= 0) throw new Error('Playback speed must be positive');
            speed = value;
        }
    };
};

export {CONNECTION_PREVIEW_PROGRESS, createInteractionClock, generatedPath,
    movementEaseIn, movementEaseOut, movementEaseInOut};
