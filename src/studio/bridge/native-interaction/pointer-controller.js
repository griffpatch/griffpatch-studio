import {createNaturalPointerModel} from './pointer-models';
import {createPointerTargetResolver} from './pointer-target';

const DEFAULT_CLICK_TIMING = {beforePressFrames: 3, pressFrames: 3, afterReleaseFrames: 4};
// Sprite navigation is a readable stop, even when history travel is fast.
const SPRITE_CLICK_TIMING = {beforePressFrames: 12, pressFrames: 4, afterReleaseFrames: 12};

/**
 * Keep pointer position independent of a particular interaction driver.
 * Direct native drag frames still call moveTo; UI-to-UI travel resolves a
 * semantic target and delegates path shape to the swappable model.
 *
 * @param {object} options controller dependencies
 * @returns {object} pointer controller
 */
const createPointerController = ({
    overlay,
    resolver = createPointerTargetResolver(),
    model = createNaturalPointerModel()
}) => {
    let position = null;
    let hiddenUntilMove = false;
    let visible = true;
    const show = () => {
        hiddenUntilMove = false;
        visible = true;
        if (typeof overlay.show === 'function') overlay.show();
    };
    const showForStationaryAction = () => {
        if (!hiddenUntilMove && !visible) show();
    };
    const click = async (activate, {clock, signal = null, timing = DEFAULT_CLICK_TIMING, speed = null} = {}) => {
        if (!position) throw new Error('Cannot click before placing the pointer');
        showForStationaryAction();
        const {beforePressFrames, pressFrames, afterReleaseFrames} = timing;
        const releaseFrame = beforePressFrames + pressFrames;
        const points = Array.from({length: releaseFrame + afterReleaseFrames + 1}, () => ({...position}));
        let activated = false;
        let pressed = false;
        try {
            const completed = await clock.play({
                points,
                signal,
                speed,
                onFrame: async (point, index) => {
                    if (index === beforePressFrames) {
                        pressed = true;
                        if (typeof overlay.press === 'function') overlay.press();
                    }
                    if (index === releaseFrame) {
                        pressed = false;
                        if (typeof overlay.release === 'function') overlay.release();
                        // A checkpoint-backed update may load asynchronously.
                        // Start the after-click hold only once it is visible.
                        await activate();
                        activated = true;
                    }
                }
            });
            return completed && activated;
        } finally {
            if (pressed && typeof overlay.release === 'function') overlay.release();
        }
    };
    return {
        moveTo: point => {
            const moved = !position || Math.hypot(point.x - position.x, point.y - position.y) > 0.01;
            if (moved && hiddenUntilMove) show();
            else showForStationaryAction();
            position = {x: point.x, y: point.y};
            overlay.moveTo(position);
        },
        travelTo: async (target, {clock, signal = null, onFrame = null} = {}) => {
            const resolved = resolver.resolve(target);
            if (!position) {
                showForStationaryAction();
                position = {...resolved.point};
                overlay.moveTo(position);
                if (typeof overlay.settle === 'function') overlay.settle();
                return {
                    completed: true,
                    model: model.name,
                    target: resolved,
                    frames: [{...position}],
                    initialPlacement: true
                };
            }
            const points = model.plan({
                from: position,
                to: resolved.point,
                targetBounds: resolved.bounds,
                target
            });
            const frames = [];
            const completed = await clock.play({
                points,
                signal,
                onFrame: (point, index) => {
                    const moved = Math.hypot(point.x - position.x, point.y - position.y) > 0.01;
                    if (moved && hiddenUntilMove) show();
                    else showForStationaryAction();
                    position = {x: point.x, y: point.y};
                    overlay.moveTo(position);
                    frames.push({...position});
                    if (onFrame) onFrame({...position}, index, resolved);
                }
            });
            if (typeof overlay.settle === 'function') overlay.settle();
            return {completed, model: model.name, target: resolved, frames, initialPlacement: false};
        },
        click,
        press: () => {
            showForStationaryAction();
            return typeof overlay.press === 'function' ? overlay.press() : null;
        },
        release: () => (typeof overlay.release === 'function' ? overlay.release() : null),
        settle: () => (typeof overlay.settle === 'function' ? overlay.settle() : null),
        show,
        hide: () => {
            hiddenUntilMove = false;
            visible = false;
            return typeof overlay.hide === 'function' ? overlay.hide() : null;
        },
        hideUntilMove: () => {
            hiddenUntilMove = true;
            visible = false;
            return typeof overlay.hide === 'function' ? overlay.hide() : null;
        },
        isHiddenUntilMove: () => hiddenUntilMove,
        idle: () => (typeof overlay.idle === 'function' ?
            overlay.idle({preserveHidden: hiddenUntilMove}) : overlay.remove()),
        getPosition: () => (position ? {...position} : null),
        remove: () => overlay.remove(),
        element: overlay.element
    };
};

export {createPointerController, SPRITE_CLICK_TIMING};
