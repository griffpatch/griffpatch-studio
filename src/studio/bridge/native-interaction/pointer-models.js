import {generatedPath, movementEaseInOut} from './interaction-clock';

const FRAME_MS = 1000 / 60;
const DEFAULT_MAXIMUM_OVERSHOOT_PX = 6;
const DEFAULT_RECOIL_FRAMES = 6;
const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
const distanceBetween = (from, to) => Math.hypot(to.x - from.x, to.y - from.y);
const smoothStep = progress => progress * progress * (3 - (2 * progress));

const cubicPoint = (from, first, second, to, progress) => {
    const inverse = 1 - progress;
    const inverseSquared = inverse * inverse;
    const progressSquared = progress * progress;
    return {
        x: (inverseSquared * inverse * from.x) + (3 * inverseSquared * progress * first.x) +
            (3 * inverse * progressSquared * second.x) + (progressSquared * progress * to.x),
        y: (inverseSquared * inverse * from.y) + (3 * inverseSquared * progress * first.y) +
            (3 * inverse * progressSquared * second.y) + (progressSquared * progress * to.y)
    };
};

const createDeterministicPointerModel = ({frameCount = 12} = {}) => ({
    name: 'deterministic',
    plan: ({from, to}) => generatedPath(from, to, frameCount)
});

/**
 * Generate a human-readable, endpoint-exact mouse route. Timing follows a
 * bounded Fitts-law estimate while a small perpendicular Bezier bend avoids
 * the mechanical straight-line look. Injected randomness makes the model
 * reproducible in tests and replaceable by a recorded-path model later.
 *
 * @param {object} options model tuning
 * @returns {object} natural pointer model
 */
const createNaturalPointerModel = ({
    random = Math.random,
    minimumFrames = 8,
    maximumFrames = 32,
    baseDurationMs = 90,
    fittsSlopeMs = 70,
    maximumBendPx = 36,
    maximumOvershootPx = DEFAULT_MAXIMUM_OVERSHOOT_PX,
    recoilFrames = DEFAULT_RECOIL_FRAMES
} = {}) => ({
    name: 'natural',
    plan: ({from, to, targetBounds = null}) => {
        const distance = distanceBetween(from, to);
        if (distance < 0.01) return [{...to}];
        const targetWidth = targetBounds ?
            Math.max(8, Math.min(targetBounds.width, targetBounds.height)) : 18;
        const duration = baseDurationMs + (fittsSlopeMs * Math.log2((distance / targetWidth) + 1));
        const frameCount = clamp(Math.round(duration / FRAME_MS), minimumFrames, maximumFrames);
        const unit = {x: (to.x - from.x) / distance, y: (to.y - from.y) / distance};
        const perpendicular = {x: -unit.y, y: unit.x};
        const bend = Math.min(maximumBendPx, distance * 0.12) * ((random() * 2) - 1);
        const first = {
            x: from.x + ((to.x - from.x) * 0.32) + (perpendicular.x * bend),
            y: from.y + ((to.y - from.y) * 0.32) + (perpendicular.y * bend)
        };
        const second = {
            x: from.x + ((to.x - from.x) * 0.78) - (perpendicular.x * bend * 0.2),
            y: from.y + ((to.y - from.y) * 0.78) - (perpendicular.y * bend * 0.2)
        };
        const overshootDistance = Math.max(0,
            Math.min(maximumOvershootPx, distance * 0.04, targetWidth * 0.18));
        const overshoot = {
            x: to.x + (unit.x * overshootDistance),
            y: to.y + (unit.y * overshootDistance)
        };
        const normalizedRecoilFrames = Math.max(1, Math.round(recoilFrames));
        return [
            ...Array.from({length: frameCount + 1}, (_, index) => (
                cubicPoint(from, first, second, overshoot, movementEaseInOut(index / frameCount))
            )),
            ...Array.from({length: normalizedRecoilFrames}, (_, index) => {
                const progress = smoothStep((index + 1) / normalizedRecoilFrames);
                return {
                    x: overshoot.x + ((to.x - overshoot.x) * progress),
                    y: overshoot.y + ((to.y - overshoot.y) * progress)
                };
            })
        ];
    }
});

const createPointerModelByName = (name = 'natural', options = {}) => {
    if (name === 'natural') return createNaturalPointerModel(options);
    if (name === 'deterministic') return createDeterministicPointerModel(options);
    throw new Error(`Unknown pointer model: ${name}`);
};

export {
    createDeterministicPointerModel,
    createNaturalPointerModel,
    createPointerModelByName
};
