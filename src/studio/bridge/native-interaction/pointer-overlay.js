const POINTER_ID = 'tw-studio-native-pointer';
const POINTER_ART_CLASS = 'tw-studio-native-pointer-art';
const POINTER_GLOW_CLASS = 'tw-studio-native-pointer-glow';
const POINTER_SHAPE_CLASS = 'tw-studio-native-pointer-shape';
const MAX_POINTER_ROLL_DEGREES = 25;
const POINTER_SETTLE_DURATION_MS = 1200;
const POINTER_ART_OFFSET_PX = 10;
const POINTER_ART_SIZE_PX = 24;
const POINTER_GLOW_SIZE_PX = 36;
const POINTER_GLOW_OFFSET_PX = POINTER_ART_OFFSET_PX +
    ((POINTER_ART_SIZE_PX - POINTER_GLOW_SIZE_PX) / 2);
const POINTER_Z_INDEX = 100001;
const POINTER_IDLE_HOLD_MS = 2000;
const POINTER_IDLE_FADE_MS = 320;
const POINTERS_BY_DOCUMENT = new WeakMap();

const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));

const rollForTravel = (from, to) => {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const distance = Math.hypot(dx, dy);
    if (distance < 0.5) return 0;
    return clamp(((dx / distance) * 23) + ((dy / distance) * 18),
        -MAX_POINTER_ROLL_DEGREES, MAX_POINTER_ROLL_DEGREES);
};

const settleKeyframes = startingRoll => Array.from({length: 25}, (_, index) => {
    const progress = index / 24;
    const elapsedSeconds = progress * (POINTER_SETTLE_DURATION_MS / 1000);
    const damping = Math.exp(-3 * elapsedSeconds);
    const oscillation = Math.cos(2 * Math.PI * 2.15 * elapsedSeconds);
    const angle = index === 24 ? 0 : startingRoll * damping * oscillation;
    return {
        transform: `rotate(${angle.toFixed(2)}deg)`,
        offset: progress,
        easing: 'linear'
    };
});

const createPointerOverlay = ({
    documentObject = document,
    idleHoldMs = POINTER_IDLE_HOLD_MS,
    idleFadeMs = POINTER_IDLE_FADE_MS,
    schedule = null,
    cancelSchedule = null
} = {}) => {
    const timerHost = documentObject.defaultView;
    const scheduleTask = schedule || timerHost.setTimeout.bind(timerHost);
    const cancelScheduledTask = cancelSchedule || timerHost.clearTimeout.bind(timerHost);
    const element = documentObject.createElement('div');
    const glow = documentObject.createElement('div');
    const art = documentObject.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const shape = documentObject.createElementNS('http://www.w3.org/2000/svg', 'g');
    const path = documentObject.createElementNS('http://www.w3.org/2000/svg', 'path');
    let lastPoint = null;
    let roll = 0;
    let rollVelocity = 0;
    let motionAnimation = null;
    let pressAnimation = null;
    let glowAnimation = null;
    let idleAnimation = null;
    let idleTimer = null;
    let fadeTimer = null;
    const registry = POINTERS_BY_DOCUMENT.get(documentObject) || new Set();
    if (!POINTERS_BY_DOCUMENT.has(documentObject)) POINTERS_BY_DOCUMENT.set(documentObject, registry);
    const registration = {idle: false, remove: null};

    element.id = POINTER_ID;
    element.setAttribute('aria-hidden', 'true');
    Object.assign(element.style, {
        position: 'fixed',
        left: '0',
        top: '0',
        width: '34px',
        height: '34px',
        pointerEvents: 'none',
        opacity: '1',
        transform: 'translate(-17px, -17px)',
        zIndex: String(POINTER_Z_INDEX)
    });

    glow.setAttribute('class', POINTER_GLOW_CLASS);
    Object.assign(glow.style, {
        position: 'absolute',
        left: `${POINTER_GLOW_OFFSET_PX}px`,
        top: `${POINTER_GLOW_OFFSET_PX}px`,
        width: `${POINTER_GLOW_SIZE_PX}px`,
        height: `${POINTER_GLOW_SIZE_PX}px`,
        borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(255, 35, 56, 0.78) 0%, ' +
            'rgba(255, 35, 56, 0.38) 34%, rgba(255, 35, 56, 0) 72%)',
        filter: 'blur(4px)',
        opacity: '0.82',
        transform: 'translate3d(0, 0, 0)',
        transformOrigin: '50% 50%'
    });

    art.setAttribute('class', POINTER_ART_CLASS);
    art.setAttribute('viewBox', '0 0 28 28');
    art.setAttribute('width', String(POINTER_ART_SIZE_PX));
    art.setAttribute('height', String(POINTER_ART_SIZE_PX));
    Object.assign(art.style, {
        position: 'absolute',
        left: `${POINTER_ART_OFFSET_PX}px`,
        top: `${POINTER_ART_OFFSET_PX}px`,
        overflow: 'visible',
        filter: 'drop-shadow(0 1px 0 rgba(0, 0, 0, 0.62)) ' +
            'drop-shadow(0 2px 1px rgba(0, 0, 0, 0.78))',
        transform: 'rotate(0deg)',
        transformOrigin: '12px 12px',
        willChange: 'transform'
    });
    path.setAttribute('d', 'M5.3 5.3C4.2 4.9 3.2 5.9 3.6 7L9.1 23.4C9.6 24.9 11.6 25 12.3 23.6' +
        'L16.1 16.8L23.2 14.1C24.6 13.6 24.7 11.6 23.3 11.1L5.3 5.3Z');
    path.setAttribute('fill', '#0b0c0f');
    path.setAttribute('stroke', '#ffffff');
    path.setAttribute('stroke-width', '2.45');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');

    shape.setAttribute('class', POINTER_SHAPE_CLASS);
    Object.assign(shape.style, {
        transform: 'scale(1)',
        transformBox: 'fill-box',
        transformOrigin: 'center'
    });
    shape.appendChild(path);
    art.appendChild(shape);
    element.appendChild(glow);
    element.appendChild(art);
    documentObject.body.appendChild(element);

    const cancelMotionAnimation = () => {
        if (motionAnimation && typeof motionAnimation.cancel === 'function') motionAnimation.cancel();
        if (glowAnimation && typeof glowAnimation.cancel === 'function') glowAnimation.cancel();
        motionAnimation = null;
        glowAnimation = null;
    };
    const cancelPressAnimation = () => {
        if (pressAnimation && typeof pressAnimation.cancel === 'function') pressAnimation.cancel();
        if (glowAnimation && typeof glowAnimation.cancel === 'function') glowAnimation.cancel();
        pressAnimation = null;
        glowAnimation = null;
    };
    const cancelIdle = () => {
        if (idleTimer !== null) cancelScheduledTask(idleTimer);
        if (fadeTimer !== null) cancelScheduledTask(fadeTimer);
        if (idleAnimation && typeof idleAnimation.cancel === 'function') idleAnimation.cancel();
        idleAnimation = null;
        idleTimer = null;
        fadeTimer = null;
        delete element.dataset.idle;
        delete element.dataset.fading;
    };
    const activate = () => {
        registration.idle = false;
        [...registry].forEach(other => {
            if (other !== registration && other.idle) other.remove();
        });
    };
    const setRoll = value => {
        roll = value;
        art.style.transform = `rotate(${roll.toFixed(2)}deg)`;
        element.dataset.rotation = roll.toFixed(2);
    };
    const show = () => {
        cancelIdle();
        activate();
        element.style.opacity = '1';
        delete element.dataset.hiddenForTyping;
    };
    const hide = () => {
        cancelIdle();
        activate();
        element.style.opacity = '0';
        element.dataset.hiddenForTyping = 'true';
    };
    const idle = ({preserveHidden = false} = {}) => {
        const remainsHidden = preserveHidden || element.dataset.hiddenForTyping === 'true';
        if (remainsHidden) {
            cancelIdle();
            activate();
            registration.idle = true;
            element.dataset.idle = 'true';
            idleTimer = scheduleTask(() => {
                idleTimer = null;
                delete element.dataset.idle;
                registration.remove();
            }, idleHoldMs + idleFadeMs);
            return;
        }
        show();
        registration.idle = true;
        element.dataset.idle = 'true';
        idleTimer = scheduleTask(() => {
            idleTimer = null;
            delete element.dataset.idle;
            element.dataset.fading = 'true';
            if (typeof element.animate === 'function') {
                idleAnimation = element.animate([
                    {opacity: 1},
                    {opacity: 0}
                ], {
                    duration: idleFadeMs,
                    easing: 'ease-out',
                    fill: 'forwards'
                });
            } else {
                element.style.opacity = '0';
            }
            fadeTimer = scheduleTask(() => {
                fadeTimer = null;
                registration.remove();
            }, idleFadeMs);
        }, idleHoldMs);
    };
    const moveTo = point => {
        cancelMotionAnimation();
        element.style.left = `${point.x}px`;
        element.style.top = `${point.y}px`;
        element.dataset.x = point.x.toFixed(2);
        element.dataset.y = point.y.toFixed(2);
        if (lastPoint) {
            const targetRoll = rollForTravel(lastPoint, point);
            rollVelocity = ((rollVelocity + ((targetRoll - roll) * 0.3)) * 0.7);
            setRoll(clamp(roll + rollVelocity, -MAX_POINTER_ROLL_DEGREES, MAX_POINTER_ROLL_DEGREES));
        }
        lastPoint = {x: point.x, y: point.y};
    };
    const settle = () => {
        const startingRoll = roll;
        rollVelocity = 0;
        setRoll(0);
        if (Math.abs(startingRoll) < 0.1 || typeof art.animate !== 'function') return null;
        motionAnimation = art.animate(settleKeyframes(startingRoll), {
            duration: POINTER_SETTLE_DURATION_MS,
            easing: 'linear',
            fill: 'both'
        });
        return motionAnimation;
    };
    const animateTravel = (from, to, {durationMs, pickupMs = 0} = {}) => {
        cancelMotionAnimation();
        const duration = Math.max(1, durationMs || 1);
        const pickupOffset = clamp(pickupMs / duration, 0, 0.8);
        const travelRoll = rollForTravel(from, to);
        lastPoint = {x: to.x, y: to.y};
        rollVelocity = 0;
        setRoll(0);
        if (typeof art.animate === 'function') {
            motionAnimation = art.animate([
                {transform: 'rotate(0deg)', offset: 0},
                {transform: 'rotate(0deg)', offset: pickupOffset},
                {transform: `rotate(${travelRoll.toFixed(2)}deg)`, offset: Math.max(0.55, pickupOffset + 0.08)},
                {transform: `rotate(${(-travelRoll * 0.12).toFixed(2)}deg)`, offset: 0.92},
                {transform: 'rotate(0deg)', offset: 1}
            ], {duration, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)', fill: 'both'});
        }
        if (typeof glow.animate === 'function') {
            glowAnimation = glow.animate([
                {opacity: 0.72, transform: 'scale(0.92)'},
                {opacity: 0.94, transform: 'scale(1.08)'},
                {opacity: 0.82, transform: 'scale(1)'}
            ], {duration, easing: 'ease-in-out', fill: 'both'});
        }
        return motionAnimation;
    };
    const press = () => {
        cancelPressAnimation();
        element.dataset.pressed = 'true';
        if (typeof shape.animate === 'function') {
            pressAnimation = shape.animate([
                {transform: 'scale(1)'},
                {transform: 'scale(0.82)'}
            ], {duration: 70, easing: 'ease-out', fill: 'both'});
        }
        if (typeof glow.animate === 'function') {
            glowAnimation = glow.animate([
                {opacity: 0.82, transform: 'scale(1)'},
                {opacity: 1, transform: 'scale(0.84)'}
            ], {duration: 70, easing: 'ease-out', fill: 'both'});
        }
    };
    const release = () => {
        cancelPressAnimation();
        delete element.dataset.pressed;
        if (typeof shape.animate === 'function') {
            pressAnimation = shape.animate([
                {transform: 'scale(0.82)'},
                {transform: 'scale(1.06)', offset: 0.62},
                {transform: 'scale(1)'}
            ], {duration: 120, easing: 'cubic-bezier(0.2, 0.85, 0.25, 1)', fill: 'both'});
        }
        if (typeof glow.animate === 'function') {
            glowAnimation = glow.animate([
                {opacity: 1, transform: 'scale(0.84)'},
                {opacity: 0.78, transform: 'scale(1.08)', offset: 0.62},
                {opacity: 0.82, transform: 'scale(1)'}
            ], {duration: 120, easing: 'ease-out', fill: 'both'});
        }
    };

    const remove = () => {
        cancelIdle();
        cancelMotionAnimation();
        cancelPressAnimation();
        registry.delete(registration);
        element.remove();
    };
    registration.remove = remove;
    activate();
    registry.add(registration);

    return {
        moveTo,
        settle,
        animateTravel,
        press,
        release,
        show,
        hide,
        idle,
        remove,
        element
    };
};

export {
    POINTER_ART_CLASS,
    POINTER_GLOW_CLASS,
    POINTER_IDLE_FADE_MS,
    POINTER_IDLE_HOLD_MS,
    POINTER_ID,
    POINTER_SHAPE_CLASS,
    createPointerOverlay
};
