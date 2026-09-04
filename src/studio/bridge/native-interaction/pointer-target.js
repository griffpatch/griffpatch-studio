const anchorCoordinate = (start, size, anchor, offset) => {
    if (typeof anchor === 'number') return start + anchor + offset;
    const ratio = anchor === 'start' ? 0 : (anchor === 'end' ? 1 : 0.5);
    return start + (size * ratio) + offset;
};

/**
 * Describe a rendered UI target without freezing its coordinates. Drivers
 * retain the semantic identity; the element is located again immediately
 * before motion so layout, scrolling and target switches cannot stale it.
 *
 * @param {object} options target options
 * @returns {object} lazy pointer target
 */
const createElementPointerTarget = ({
    id,
    kind = 'dom-element',
    locate,
    anchorX = 'center',
    anchorY = 'center',
    offsetX = 0,
    offsetY = 0
}) => ({id, kind, locate, anchorX, anchorY, offsetX, offsetY});

const createPointerTargetResolver = () => ({
    resolve: target => {
        if (!target || typeof target.locate !== 'function') {
            throw new Error('Pointer target has no live element locator');
        }
        const element = target.locate();
        const rect = element && element.getBoundingClientRect && element.getBoundingClientRect();
        if (!rect || rect.width <= 0 || rect.height <= 0) {
            throw new Error(`Pointer target is not visible: ${target.id || target.kind || 'unknown'}`);
        }
        const bounds = {
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height,
            right: typeof rect.right === 'number' ? rect.right : rect.left + rect.width,
            bottom: typeof rect.bottom === 'number' ? rect.bottom : rect.top + rect.height
        };
        const resolved = {
            id: target.id || null,
            kind: target.kind || 'dom-element',
            bounds,
            point: {
                x: anchorCoordinate(bounds.left, bounds.width, target.anchorX, target.offsetX || 0),
                y: anchorCoordinate(bounds.top, bounds.height, target.anchorY, target.offsetY || 0)
            }
        };
        // Drivers need the live element for the immediate click, but evidence
        // is published through JSON. React attaches enumerable circular Fiber
        // references to HTML controls, so keep the native target deliberately
        // non-enumerable while retaining direct driver access.
        Object.defineProperty(resolved, 'element', {value: element, enumerable: false});
        return resolved;
    }
});

export {createElementPointerTarget, createPointerTargetResolver};
