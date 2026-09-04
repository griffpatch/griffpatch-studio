const TARGET_ATTRIBUTE = 'data-studio-target';
const BRUSH_TARGET = 'paint-brush-tool';
const CANVAS_TARGET = 'paint-canvas';
const BRUSH_SIZE_TARGET = 'paint-brush-size';
const FILL_COLOR_TARGET = 'paint-fill-color';
const COLOR_HEX_TARGET = 'paint-color-hex-input';
const CONVERT_TO_BITMAP_TARGET = 'paint-convert-to-bitmap';
const CONVERT_TO_VECTOR_TARGET = 'paint-convert-to-vector';
const MAX_GESTURE_DURATION_MS = 10000;
const MAX_GESTURE_POINTS = 600;
const MIN_SAMPLE_INTERVAL_MS = 8;
const MIN_SAMPLE_DISTANCE_PX = 0.5;

const finitePoint = point => point && Number.isFinite(point.x) && Number.isFinite(point.y) &&
    Number.isFinite(point.t);

const cloneGesture = gesture => ({
    tool: 'brush',
    durationMs: gesture.durationMs,
    points: gesture.points.map(point => ({...point})),
    ...(gesture.brushStyle ? {brushStyle: {...gesture.brushStyle}} : {})
});

const brushStyle = root => {
    const value = root.getAttribute('data-studio-brush-style');
    if (!value) return null;
    try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (error) {
        return null;
    }
};

const selectedBrush = button => {
    if (!button) return false;
    if (button.getAttribute('aria-pressed') === 'true') return true;
    return String(button.getAttribute('class') || '').includes('is-selected');
};

const normalizedPoint = (event, canvas, startedAt) => {
    const rect = canvas.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return null;
    const elapsed = Math.max(0, Math.min(
        MAX_GESTURE_DURATION_MS,
        Number(event.timeStamp) - startedAt
    ));
    return {
        // Preserve the full normalized coordinate. Even sub-hundredth-pixel
        // rounding changes Paper.js path geometry and therefore the SVG asset
        // hash, so a rounded recording cannot reproduce the authored edit.
        x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
        y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
        t: Math.round(elapsed)
    };
};

const shouldAppendPoint = (points, point, rect) => {
    const previous = points[points.length - 1];
    if (!previous) return true;
    const distance = Math.hypot(
        (point.x - previous.x) * rect.width,
        (point.y - previous.y) * rect.height
    );
    return point.t - previous.t >= MIN_SAMPLE_INTERVAL_MS || distance >= MIN_SAMPLE_DISTANCE_PX;
};

/**
 * Observe the real Scratch Paint controls and retain only a bounded brush
 * gesture for the immediately following vector or bitmap image update.
 *
 * @param {object} options capture dependencies
 * @returns {object} capture lifecycle
 */
const createPaintGestureCapture = ({root}) => {
    const documentObject = root.ownerDocument;
    const view = documentObject.defaultView;
    let brushButton = null;
    let canvas = null;
    let brushActive = false;
    let renderedBrushSelected = null;
    let activeGesture = null;
    let pendingGesture = null;

    const annotateTargets = () => {
        const nextBrush = root.querySelector('[role="button"][title$="(B)"], button[title$="(B)"]');
        const nextCanvas = root.querySelector('canvas[resize="true"]');
        const modeSize = root.querySelector('div[class*="mode-tools_mode-tools_"] input[type="number"]');
        const colors = Array.from(root.querySelectorAll('div[class*="color-button_color-button_"]'));
        // Scratch Paint renders the colour picker in a portal outside the
        // editor root, so modal controls must be discovered from the document.
        const colorHex = documentObject.querySelector('input[placeholder="#123abc"]');
        const conversion = root.querySelector(
            'div[class*="paint-editor_canvas-controls_"] [role="button"]' +
            '[class*="paint-editor_bitmap-button_"]'
        );
        const editFormat = root.getAttribute('data-studio-edit-format');
        const conversionTarget = editFormat === 'svg' ? CONVERT_TO_BITMAP_TARGET :
            editFormat === 'bitmap' ? CONVERT_TO_VECTOR_TARGET : null;
        if (nextBrush && nextBrush.getAttribute(TARGET_ATTRIBUTE) !== BRUSH_TARGET) {
            nextBrush.setAttribute(TARGET_ATTRIBUTE, BRUSH_TARGET);
        }
        if (nextCanvas && nextCanvas.getAttribute(TARGET_ATTRIBUTE) !== CANVAS_TARGET) {
            nextCanvas.setAttribute(TARGET_ATTRIBUTE, CANVAS_TARGET);
        }
        for (const [element, target] of [
            [modeSize, BRUSH_SIZE_TARGET],
            [colors[0], FILL_COLOR_TARGET],
            [colorHex, COLOR_HEX_TARGET]
        ]) {
            if (element && element.getAttribute(TARGET_ATTRIBUTE) !== target) {
                element.setAttribute(TARGET_ATTRIBUTE, target);
            }
        }
        if (conversion && conversionTarget &&
            conversion.getAttribute(TARGET_ATTRIBUTE) !== conversionTarget) {
            conversion.setAttribute(TARGET_ATTRIBUTE, conversionTarget);
        }
        brushButton = nextBrush;
        canvas = nextCanvas;
        const nextRenderedSelected = selectedBrush(brushButton);
        if (renderedBrushSelected === null || nextRenderedSelected !== renderedBrushSelected) {
            renderedBrushSelected = nextRenderedSelected;
            brushActive = nextRenderedSelected;
        }
        if (brushButton) {
            const selectedValue = brushActive ? 'true' : 'false';
            if (brushButton.getAttribute('data-studio-selected') !== selectedValue) {
                brushButton.setAttribute('data-studio-selected', selectedValue);
            }
        }
    };

    const appendPoint = (event, {final = false} = {}) => {
        if (!activeGesture || !canvas) return;
        const point = normalizedPoint(event, canvas, activeGesture.startedAt);
        const rect = canvas.getBoundingClientRect();
        if (!point || !rect) return;
        const points = activeGesture.points;
        if (points.length >= MAX_GESTURE_POINTS) {
            if (final) points[points.length - 1] = point;
            return;
        }
        if (final || shouldAppendPoint(points, point, rect)) points.push(point);
    };

    const handleClick = event => {
        const button = event.target && event.target.closest && event.target.closest('[role="button"], button');
        if (!button || !root.contains(button)) return;
        if (button === brushButton) {
            brushActive = true;
        } else if (/\([A-Z]\)$/.test(button.getAttribute('title') || '')) {
            brushActive = false;
        }
        if (brushButton) brushButton.setAttribute('data-studio-selected', brushActive ? 'true' : 'false');
    };

    const handleKeyDown = event => {
        if (!event.ctrlKey && !event.metaKey && !event.altKey && String(event.key).toLowerCase() === 'b') {
            brushActive = true;
            if (brushButton) brushButton.setAttribute('data-studio-selected', 'true');
        }
    };

    const handleMouseDown = event => {
        annotateTargets();
        if (event.button !== 0 || event.target !== canvas || !brushActive) {
            activeGesture = null;
            pendingGesture = null;
            return;
        }
        const startedAt = Number(event.timeStamp);
        if (!Number.isFinite(startedAt)) return;
        activeGesture = {startedAt, points: [], brushStyle: brushStyle(root)};
        pendingGesture = null;
        appendPoint(event);
    };

    const handleMouseMove = event => {
        if (!activeGesture || !(event.buttons & 1)) return;
        appendPoint(event);
    };

    const handleMouseUp = event => {
        if (!activeGesture || event.button !== 0) return;
        appendPoint(event, {final: true});
        const points = activeGesture.points;
        const durationMs = points.length ? points[points.length - 1].t : 0;
        pendingGesture = points.length >= 2 && points.every(finitePoint) ? {
            tool: 'brush',
            durationMs,
            points,
            ...(activeGesture.brushStyle ? {brushStyle: activeGesture.brushStyle} : {})
        } : null;
        activeGesture = null;
    };

    root.addEventListener('click', handleClick, true);
    root.addEventListener('keydown', handleKeyDown, true);
    root.addEventListener('mousedown', handleMouseDown, true);
    documentObject.addEventListener('mousemove', handleMouseMove, true);
    documentObject.addEventListener('mouseup', handleMouseUp, true);
    const observer = view.MutationObserver ? new view.MutationObserver(annotateTargets) : null;
    if (observer) {
        observer.observe(documentObject.body || root, {
            subtree: true,
            childList: true,
            attributes: true,
            attributeFilter: ['class']
        });
    }
    annotateTargets();

    return {
        consume: () => {
            const gesture = pendingGesture;
            pendingGesture = null;
            return gesture ? cloneGesture(gesture) : null;
        },
        refresh: annotateTargets,
        reset: () => {
            activeGesture = null;
            pendingGesture = null;
        },
        detach: () => {
            if (observer) observer.disconnect();
            root.removeEventListener('click', handleClick, true);
            root.removeEventListener('keydown', handleKeyDown, true);
            root.removeEventListener('mousedown', handleMouseDown, true);
            documentObject.removeEventListener('mousemove', handleMouseMove, true);
            documentObject.removeEventListener('mouseup', handleMouseUp, true);
            activeGesture = null;
            pendingGesture = null;
        }
    };
};

export {
    BRUSH_TARGET,
    BRUSH_SIZE_TARGET,
    CANVAS_TARGET,
    COLOR_HEX_TARGET,
    CONVERT_TO_BITMAP_TARGET,
    CONVERT_TO_VECTOR_TARGET,
    FILL_COLOR_TARGET,
    MAX_GESTURE_DURATION_MS,
    MAX_GESTURE_POINTS,
    createPaintGestureCapture
};
