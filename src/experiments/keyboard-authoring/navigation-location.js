const positionKey = position => position && [
    position.kind, position.blockId || '', position.inputName || '', position.fieldName || ''
].join(':');

const semanticPosition = stop => {
    const position = {kind: stop.kind};
    if (stop.blockId) position.blockId = stop.blockId;
    if (stop.inputName) position.inputName = stop.inputName;
    if (stop.fieldName) position.fieldName = stop.fieldName;
    return position;
};


export {positionKey, semanticPosition};
