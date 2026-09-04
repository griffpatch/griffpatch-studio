const dispatchMouseSelection = (element, point) => {
    const eventOptions = {
        bubbles: true,
        cancelable: true,
        view: element.ownerDocument.defaultView,
        button: 0,
        buttons: 1,
        clientX: point.x,
        clientY: point.y
    };
    const MouseEventConstructor = element.ownerDocument.defaultView.MouseEvent;
    element.dispatchEvent(new MouseEventConstructor('mouseover', eventOptions));
    element.dispatchEvent(new MouseEventConstructor('mousedown', eventOptions));
    element.dispatchEvent(new MouseEventConstructor('mouseup', {...eventOptions, buttons: 0}));
    element.dispatchEvent(new MouseEventConstructor('click', {...eventOptions, buttons: 0}));
};

const combinePointerTravels = stages => {
    const namedStages = Object.entries(stages).filter(([, travel]) => Boolean(travel));
    const travels = namedStages.map(([, travel]) => travel);
    const last = travels[travels.length - 1] || null;
    return {
        completed: travels.every(travel => travel.completed),
        model: last ? last.model : null,
        target: last ? last.target : null,
        frames: travels.flatMap(travel => travel.frames || []),
        initialPlacement: travels.length ? travels[0].initialPlacement : false,
        stages: Object.fromEntries(namedStages)
    };
};

const replaceInputValue = (input, value, insertedCharacter) => {
    const view = input.ownerDocument.defaultView;
    const descriptor = Object.getOwnPropertyDescriptor(view.HTMLInputElement.prototype, 'value');
    if (descriptor && descriptor.set) descriptor.set.call(input, value);
    else input.value = value;
    const options = {bubbles: true, cancelable: false};
    if (view.InputEvent) {
        input.dispatchEvent(new view.InputEvent('input', {
            ...options,
            data: insertedCharacter,
            inputType: 'insertText'
        }));
    } else {
        input.dispatchEvent(new view.Event('input', options));
    }
};

const typeInputText = async ({
    input,
    value,
    clock,
    signal = null,
    point,
    pointer = null,
    framesPerCharacter = 5,
    replaceValue = replaceInputValue
}) => {
    if (pointer && typeof pointer.hideUntilMove === 'function') pointer.hideUntilMove();
    else if (pointer && typeof pointer.hide === 'function') pointer.hide();
    const intermediateValues = [];
    const points = Array.from({length: (value.length * framesPerCharacter) + 1}, () => point);
    const completed = await clock.play({
        points,
        signal,
        onFrame: (_point, index) => {
            if (!index || index % framesPerCharacter !== 0) return;
            const characterCount = index / framesPerCharacter;
            const nextValue = value.slice(0, characterCount);
            replaceValue(input, nextValue, value[characterCount - 1]);
            intermediateValues.push(nextValue);
        }
    });
    // Typing deliberately leaves the pointer hidden. The shared pointer
    // controller reveals itself only when the next genuine move or travel
    // begins, avoiding a stationary flash over the committed input.
    return {completed, intermediateValues};
};

const withGeneratedIds = (ScratchBlocks, ids, action, {skip = 0} = {}) => {
    if (!ScratchBlocks.utils || typeof ScratchBlocks.utils.genUid !== 'function') {
        throw new Error('Scratch Blocks ID generator is unavailable for deterministic replay');
    }
    const previousGenUid = ScratchBlocks.utils.genUid;
    let callCount = 0;
    let idIndex = 0;
    const replayGenUid = () => {
        callCount += 1;
        if (callCount <= skip || idIndex >= ids.length) return previousGenUid();
        const id = ids[idIndex];
        idIndex += 1;
        return id;
    };
    // Blockly reads static data (notably `soup_`) through the currently
    // installed function object when a replay call delegates to the original.
    Object.assign(replayGenUid, previousGenUid);
    ScratchBlocks.utils.genUid = replayGenUid;
    try {
        return action();
    } finally {
        ScratchBlocks.utils.genUid = previousGenUid;
    }
};

export {
    combinePointerTravels,
    dispatchMouseSelection,
    replaceInputValue,
    typeInputText,
    withGeneratedIds
};
