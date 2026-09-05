// Activation is a focus decision, not a camera operation. Measure command rows
// (not complete C-block tails) in the same client coordinates as the viewport.
const activationPosition = ({previous, selected, candidates, bounds, measure, empty}) => {
    const fits = (box, padding) => box && box.width > 0 && box.height > 0 &&
        box.left >= bounds.left + padding && box.top >= bounds.top + padding &&
        box.left + box.width <= bounds.right - padding &&
        box.top + box.height <= bounds.bottom - padding;
    if (previous && fits(measure(previous), 24)) return previous;
    if (selected && fits(measure(selected), 12)) return selected;
    const visible = candidates().map(candidate => ({...candidate, box: measure(candidate.position)}))
        .filter(candidate => fits(candidate.box, 12));
    // A nearby head is easier to understand than an arbitrary operand. If the
    // head has scrolled away, a fully visible statement remains a useful start.
    visible.sort((a, b) => Number(b.head) - Number(a.head) ||
        Math.hypot(a.box.left - bounds.left, a.box.top - bounds.top) -
        Math.hypot(b.box.left - bounds.left, b.box.top - bounds.top));
    return visible.length ? visible[0].position : empty();
};

export {activationPosition};
