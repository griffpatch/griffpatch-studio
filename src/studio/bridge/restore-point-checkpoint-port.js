import RestorePointAPI from '../../lib/tw-restore-point-api';

/**
 * Adapt TurboWarp restore points to the checkpoint contract used by Studio.
 *
 * @param {object} options port dependencies
 * @param {object} options.vm TurboWarp VM
 * @param {object} [options.restorePointApi] injectable TurboWarp API
 * @returns {object} checkpoint port
 */
const createRestorePointCheckpointPort = ({vm, restorePointApi = RestorePointAPI}) => ({
    create: title => restorePointApi.createRestorePoint(vm, title, restorePointApi.TYPE_MANUAL),
    restore: id => restorePointApi.loadRestorePoint(vm, id),
    readAsset: (id, md5ext) => restorePointApi.getRestorePointAsset(id, md5ext),
    remove: id => restorePointApi.deleteRestorePoint(id)
});

export {createRestorePointCheckpointPort};
