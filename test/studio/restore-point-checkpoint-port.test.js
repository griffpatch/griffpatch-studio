import {createRestorePointCheckpointPort} from '../../src/studio/bridge/restore-point-checkpoint-port';

test('adapts the existing TurboWarp restore-point lifecycle', async () => {
    const calls = [];
    const vm = {id: 'vm'};
    const restorePointApi = {
        TYPE_MANUAL: 1,
        createRestorePoint: (...args) => {
            calls.push(['create', ...args]);
            return Promise.resolve(42);
        },
        loadRestorePoint: (...args) => calls.push(['restore', ...args]),
        getRestorePointAsset: (...args) => {
            calls.push(['readAsset', ...args]);
            return Promise.resolve(new Uint8Array([1, 2, 3]));
        },
        deleteRestorePoint: id => calls.push(['remove', id])
    };
    const port = createRestorePointCheckpointPort({vm, restorePointApi});

    expect(await port.create('Studio base')).toBe(42);
    await port.restore(42);
    await expect(port.readAsset(42, 'asset.wav')).resolves.toEqual(new Uint8Array([1, 2, 3]));
    await port.remove(42);
    expect(calls).toEqual([
        ['create', vm, 'Studio base', 1],
        ['restore', vm, 42],
        ['readAsset', 42, 'asset.wav'],
        ['remove', 42]
    ]);
});
