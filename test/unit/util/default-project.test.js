import defaultProjectGenerator from '../../../src/lib/default-project/index.js';

jest.mock('!arraybuffer-loader!./override-default-project.sb3', () => new ArrayBuffer(0), {virtual: true});
jest.mock('!raw-loader!./cd21514d0531fdffb22204e0ec5ed84a.svg', () => '<svg/>', {virtual: true});
jest.mock('!raw-loader!../../../static/brand/griffpatch-studio.svg', () =>
    require('fs').readFileSync('static/brand/griffpatch-studio.svg', 'utf8'), {virtual: true});

describe('defaultProject', () => {
    test('default sprite asset hash matches the canonical icon and is centred at a modest size', () => {
        const assets = defaultProjectGenerator();
        const sprite = JSON.parse(assets[0].data).targets[1];
        const costume = sprite.costumes[0];
        const bytes = assets.find(asset => asset.id === costume.assetId).data;
        expect(require('crypto').createHash('md5').update(bytes).digest('hex')).toBe(costume.assetId);
        expect([costume.rotationCenterX, costume.rotationCenterY, sprite.size]).toEqual([32, 32, 100]);
    });
    // This test ensures that the assets referenced in the default project JSON
    // do not get out of sync with the raw assets that are included alongside.
    // see https://github.com/LLK/scratch-gui/issues/4844
    test('assets referenced by the project are included', () => {
        const translatorFn = () => '';
        const defaultProject = defaultProjectGenerator(translatorFn);
        const includedAssetIds = defaultProject.map(obj => obj.id);
        const projectData = JSON.parse(defaultProject[0].data);
        projectData.targets.forEach(target => {
            target.costumes.forEach(costume => {
                expect(includedAssetIds.includes(costume.assetId)).toBe(true);
            });
            target.sounds.forEach(sound => {
                expect(includedAssetIds.includes(sound.assetId)).toBe(true);
            });
        });
    });
});
