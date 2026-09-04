const MIN_DURATION_MS = 180;
const MAX_DURATION_MS = 450;
const PIXELS_PER_MS = 1.5;
const MOVEMENT_THRESHOLD_PX = 2;

const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));

const easeInOutCubic = progress => (progress < 0.5 ?
    4 * progress * progress * progress :
    1 - (Math.pow((-2 * progress) + 2, 3) / 2));

const movementDuration = distance => clamp(
    distance / PIXELS_PER_MS,
    MIN_DURATION_MS,
    MAX_DURATION_MS
);

/**
 * Animate viewport coordinates without depending on Scratch Blocks. Callers
 * supply geometry access and frame scheduling so the policy stays testable.
 *
 * @param {object} options motion dependencies
 * @param {Function} options.read current {x, y} viewport position
 * @param {Function} options.write apply an {x, y} viewport position
 * @param {?Function} [options.requestFrame] animation-frame scheduler
 * @param {?Function} [options.cancelFrame] animation-frame cancellation
 * @param {Function} [options.now] monotonic clock matching frame timestamps
 * @returns {object} viewport motion controller
 */
const createViewportMotion = ({
    read,
    write,
    requestFrame = null,
    cancelFrame = null,
    now = Date.now
}) => {
    let active = null;

    const stop = () => {
        if (!active) return;
        if (cancelFrame && active.frameId !== null) cancelFrame(active.frameId);
        const {resolve} = active;
        active = null;
        resolve(false);
    };

    const moveTo = (x, y, {from = null, speed = 1} = {}) => {
        stop();
        if (!Number.isFinite(speed) || speed <= 0) throw new Error('Camera speed must be positive');
        const start = from || read();
        const deltaX = x - start.x;
        const deltaY = y - start.y;
        const distance = Math.hypot(deltaX, deltaY);

        if (distance <= MOVEMENT_THRESHOLD_PX || !requestFrame) {
            write(x, y);
            return Promise.resolve(distance > MOVEMENT_THRESHOLD_PX);
        }

        const duration = movementDuration(distance) / speed;
        const startedAt = now();
        write(start.x, start.y);
        return new Promise(resolve => {
            const movement = {frameId: null, resolve};
            const step = timestamp => {
                if (active !== movement) return;
                const progress = clamp((timestamp - startedAt) / duration, 0, 1);
                const eased = easeInOutCubic(progress);
                write(
                    start.x + (deltaX * eased),
                    start.y + (deltaY * eased)
                );
                if (progress === 1) {
                    active = null;
                    resolve(true);
                } else {
                    movement.frameId = requestFrame(step);
                }
            };
            active = movement;
            movement.frameId = requestFrame(step);
        });
    };

    const jumpTo = (x, y) => {
        stop();
        write(x, y);
    };

    return {jumpTo, moveTo, stop};
};

export {createViewportMotion};
