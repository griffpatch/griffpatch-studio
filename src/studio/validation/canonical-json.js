const normalize = value => {
    if (Array.isArray(value)) return value.map(normalize);
    if (!value || typeof value !== 'object') return value;

    return Object.keys(value)
        .sort()
        .reduce((result, key) => {
            result[key] = normalize(value[key]);
            return result;
        }, {});
};

const canonicalJson = value => JSON.stringify(normalize(value));

export {canonicalJson};
