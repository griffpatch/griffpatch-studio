const DIRECTIONS = new Set(['forward', 'backward']);

const createDataStateAction = (delta, direction) => {
    if (!DIRECTIONS.has(direction)) throw new Error(`Unknown replay direction: ${direction}`);
    return {
        kind: 'data-state',
        delta,
        direction
    };
};

export {createDataStateAction};
