import {typeInputText} from '../../src/studio/bridge/native-interaction/dom-interaction';

test('leaves the shared pointer hidden after simulated typing completes', async () => {
    const pointer = {hide: jest.fn(), hideUntilMove: jest.fn(), show: jest.fn()};
    const replaceValue = jest.fn();
    const result = await typeInputText({
        input: {},
        value: 'Pop',
        point: {x: 10, y: 20},
        pointer,
        framesPerCharacter: 1,
        replaceValue,
        clock: {
            play: async ({points, onFrame}) => {
                points.forEach(onFrame);
                return true;
            }
        }
    });

    expect(result).toEqual({completed: true, intermediateValues: ['P', 'Po', 'Pop']});
    expect(pointer.hideUntilMove).toHaveBeenCalledTimes(1);
    expect(pointer.hide).not.toHaveBeenCalled();
    expect(pointer.show).not.toHaveBeenCalled();
});

test('leaves the shared pointer hidden when simulated typing is cancelled by an error', async () => {
    const pointer = {hide: jest.fn(), hideUntilMove: jest.fn(), show: jest.fn()};
    const failure = new Error('cancelled');

    await expect(typeInputText({
        input: {},
        value: 'Pop',
        point: {x: 10, y: 20},
        pointer,
        replaceValue: jest.fn(),
        clock: {play: jest.fn(async () => {
            throw failure;
        })}
    })).rejects.toBe(failure);

    expect(pointer.hideUntilMove).toHaveBeenCalledTimes(1);
    expect(pointer.hide).not.toHaveBeenCalled();
    expect(pointer.show).not.toHaveBeenCalled();
});
