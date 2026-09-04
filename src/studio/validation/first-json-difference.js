const describe = value => {
    if (Array.isArray(value)) return `[array:${value.length}]`;
    if (value && typeof value === 'object') return '{object}';
    return value;
};

const difference = (path, expected, actual) => ({
    path,
    expected: describe(expected),
    actual: describe(actual)
});

/**
 * Locate the first semantic difference between two JSON values. Object keys
 * are compared in sorted order so diagnostics remain stable across runtimes.
 *
 * @param {*} expected canonical reference value
 * @param {*} actual value produced by replay
 * @param {string} [path] current diagnostic path
 * @returns {?object} first difference or null
 */
const firstJsonDifference = (expected, actual, path = '$') => {
    if (Object.is(expected, actual)) return null;
    if (Array.isArray(expected) || Array.isArray(actual)) {
        if (!Array.isArray(expected) || !Array.isArray(actual)) {
            return difference(path, expected, actual);
        }
        if (expected.length !== actual.length) {
            return difference(`${path}.length`, expected.length, actual.length);
        }
        for (let index = 0; index < expected.length; index++) {
            const nested = firstJsonDifference(expected[index], actual[index], `${path}[${index}]`);
            if (nested) return nested;
        }
        return null;
    }
    const expectedObject = expected && typeof expected === 'object';
    const actualObject = actual && typeof actual === 'object';
    if (!expectedObject || !actualObject) return difference(path, expected, actual);

    const keys = [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort();
    for (const key of keys) {
        const childPath = `${path}.${key}`;
        if (!Object.prototype.hasOwnProperty.call(expected, key)) {
            return difference(childPath, '[missing]', actual[key]);
        }
        if (!Object.prototype.hasOwnProperty.call(actual, key)) {
            return difference(childPath, expected[key], '[missing]');
        }
        const nested = firstJsonDifference(expected[key], actual[key], childPath);
        if (nested) return nested;
    }
    return null;
};

export {firstJsonDifference};
