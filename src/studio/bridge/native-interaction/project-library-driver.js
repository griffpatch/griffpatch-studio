import {combinePointerTravels, dispatchMouseSelection} from './dom-interaction';
import {createElementPointerTarget} from './pointer-target';
import {activateThroughPointer} from './pointer-activation';
import {placePointerAtCurrentTarget} from './scratch-target-selection-driver';

const TARGET_ATTRIBUTE = 'data-studio-target';
const LIBRARY_KEY_ATTRIBUTE = 'data-studio-library-key';
const SPRITE_NAME_ATTRIBUTE = 'data-studio-sprite-name';

const escapedAttributeValue = value => String(value)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"');
const attributeTarget = (documentObject, attribute, value) => documentObject.querySelector(
    `[${attribute}="${escapedAttributeValue(value)}"]`
);
const studioTarget = (documentObject, value) => attributeTarget(documentObject, TARGET_ATTRIBUTE, value);

const targetName = target => target && (target.getName ? target.getName() :
    target.sprite && target.sprite.name);

const costumeReference = costume => costume && ({
    assetId: costume.assetId,
    dataFormat: costume.dataFormat,
    name: costume.name
});

const sameCostume = (actual, expected) => Boolean(actual && expected &&
    actual.assetId === expected.assetId && actual.dataFormat === expected.dataFormat &&
    actual.name === expected.name);

const soundReference = sound => sound && ({
    assetId: sound.assetId,
    dataFormat: sound.dataFormat,
    name: sound.name,
    rate: sound.rate,
    sampleCount: sound.sampleCount
});

const sameSound = (actual, expected) => Boolean(actual && expected &&
    actual.assetId === expected.assetId && actual.dataFormat === expected.dataFormat &&
    actual.name === expected.name && actual.rate === expected.rate &&
    actual.sampleCount === expected.sampleCount);

const mediaLibraryConfig = plan => ({
    'costume-library-select': {
        openTargetId: 'costume-library-open',
        tabTargetId: 'tab-costumes',
        vmMethod: 'addCostumeFromLibrary',
        itemsOf: target => target.getCostumes(),
        resultKind: 'costume'
    },
    'backdrop-library-select': {
        openTargetId: 'backdrop-library-open',
        tabTargetId: 'tab-costumes',
        vmMethod: 'addBackdrop',
        itemsOf: target => target.getCostumes(),
        resultKind: 'costume'
    },
    'sound-library-select': {
        openTargetId: 'sound-library-open',
        tabTargetId: 'tab-sounds',
        vmMethod: 'addSound',
        itemsOf: target => (target.getSounds ? target.getSounds() : target.sprite.sounds),
        resultKind: 'sound'
    }
}[plan.kind] || null);

const observeVmInvocation = (vm, methodName) => {
    const previous = vm[methodName];
    if (typeof previous !== 'function') throw new Error(`VM library method is unavailable: ${methodName}`);
    let completion = null;
    const wrapper = (...args) => {
        const result = previous.apply(vm, args);
        completion = Promise.resolve(result);
        return result;
    };
    vm[methodName] = wrapper;
    return {
        observation: () => (completion ? {completion} : null),
        restore: () => {
            if (vm[methodName] === wrapper) vm[methodName] = previous;
        }
    };
};

const waitFor = async (locate, documentObject, signal, frameLimit = 180) => {
    for (let frame = 0; frame < frameLimit; frame += 1) {
        const value = locate();
        if (value) return value;
        if (signal && signal.aborted) return null;
        await new Promise(resolve => documentObject.defaultView.requestAnimationFrame(resolve));
    }
    return null;
};

const clickThroughPointer = async ({pointer, clock, signal, scope, id, kind, locate, afterActivate = null}) => {
    const travel = await pointer.travelTo(createElementPointerTarget({id, kind, locate}), {clock, signal});
    if (travel.completed) {
        const completed = await activateThroughPointer({
            pointer,
            clock,
            signal,
            targetKind: kind,
            activate: async () => {
                scope.runWithoutUndo(() => dispatchMouseSelection(travel.target.element, travel.target.point));
                if (afterActivate) await afterActivate();
            }
        });
        return {...travel, completed};
    }
    return travel;
};

const visibleBounds = (element, documentObject) => {
    const rect = element && element.getBoundingClientRect && element.getBoundingClientRect();
    const viewport = documentObject.documentElement || {};
    return Boolean(rect && rect.width > 0 && rect.height > 0 && rect.right > 0 && rect.bottom > 0 &&
        rect.left < (viewport.clientWidth || Infinity) && rect.top < (viewport.clientHeight || Infinity));
};

const soundMimeType = dataFormat => ({
    mp3: 'audio/mpeg',
    wav: 'audio/wav'
}[String(dataFormat).toLowerCase()] || 'application/octet-stream');

const costumeMimeType = dataFormat => ({
    svg: 'image/svg+xml',
    png: 'image/png',
    bmp: 'image/bmp',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
    gif: 'image/gif'
}[String(dataFormat).toLowerCase()] || 'application/octet-stream');

const dispatchFileUpload = ({documentObject, input, asset, uploadFile, addedAsset, mimeType}) => {
    const view = documentObject.defaultView;
    if (!view || typeof view.File !== 'function' || typeof view.Event !== 'function') {
        throw new Error('Browser file APIs are unavailable for media upload');
    }
    const data = asset && asset.data;
    if (!data) throw new Error(`Recorded media asset is unavailable: ${addedAsset.assetId}`);
    const file = new view.File(
        [data],
        `${uploadFile.name}.${addedAsset.dataFormat}`,
        {type: mimeType(addedAsset.dataFormat)}
    );
    Object.defineProperty(input, 'files', {
        configurable: true,
        value: [file]
    });
    input.dispatchEvent(new view.Event('change', {bubbles: true}));
    return file;
};

const createProjectLibraryDriver = ({vm, documentObject, clock, pointer, scope, checkpointPort}) => ({
    cleanup: () => false,
    play: async (plan, signal = null) => {
        const travels = {};
        const recordTravel = (stage, travel) => {
            travels[stage] = travel;
        };
        const mediaConfig = mediaLibraryConfig(plan);
        if (plan.kind === 'sprite-library-select') {
            const placed = await placePointerAtCurrentTarget({vm, documentObject, pointer, clock, signal});
            if (!placed.completed) return {cancelled: true};
        }
        const soundEffectPlan = plan.kind === 'sound-effect-click';
        const soundUploadPlan = plan.kind === 'sound-file-upload';
        const costumeUploadPlan = /^(?:costume|backdrop)-file-upload$/.test(plan.kind);
        const costumePaintPlan = /^(?:costume|backdrop)-paint-create$/.test(plan.kind);
        const costumeCreatePlan = costumeUploadPlan || costumePaintPlan;
        const uploadPlan = soundUploadPlan || costumeUploadPlan;
        const uploadAsset = soundUploadPlan ? plan.addedSound : plan.addedCostume;
        const expectedTarget = plan.targetRef && ((vm.runtime.targets || []).find(target => (
            Boolean(target.isStage) === Boolean(plan.targetRef.isStage) &&
            targetName(target) === plan.targetRef.name
        )));
        const uploadStorage = uploadPlan && vm.runtime.storage;
        const cachedUploadSource = uploadStorage && uploadStorage.get && uploadStorage.get(uploadAsset.assetId);
        const restoredUploadBytes = uploadPlan && !cachedUploadSource && checkpointPort &&
            typeof checkpointPort.readAsset === 'function' ?
            await checkpointPort.readAsset(plan.sourceCheckpointId, plan.sourceAssetMd5) : null;
        const uploadSourceAsset = cachedUploadSource || (restoredUploadBytes ? {data: restoredUploadBytes} : null);
        if (uploadPlan && !uploadSourceAsset) {
            const uploadType = soundUploadPlan ? 'sound' : 'costume';
            throw new Error(`Recorded ${uploadType} asset is unavailable: ${uploadAsset.assetId}`);
        }
        if ((mediaConfig || soundEffectPlan || uploadPlan || costumePaintPlan) && !expectedTarget) {
            throw new Error(`Project target is unavailable: ${plan.targetRef && plan.targetRef.name}`);
        }
        if ((mediaConfig || soundEffectPlan || uploadPlan || costumePaintPlan) && expectedTarget &&
            (!vm.editingTarget || vm.editingTarget.id !== expectedTarget.id)) {
            const selector = () => (plan.targetRef.isStage ? studioTarget(documentObject, 'stage-selector') :
                attributeTarget(documentObject, SPRITE_NAME_ATTRIBUTE, plan.targetRef.name));
            const spriteElement = await waitFor(selector, documentObject, signal);
            if (!spriteElement) throw new Error(`Project selector target is unavailable: ${plan.targetRef.name}`);
            const targetTravel = await clickThroughPointer({
                pointer,
                clock,
                signal,
                scope,
                id: plan.targetRef.isStage ? 'stage-selector' : `sprite:${plan.targetRef.name}`,
                kind: plan.targetRef.isStage ? 'stage-selector' : 'sprite-selector',
                locate: selector
            });
            recordTravel('target', targetTravel);
            if (!travels.target.completed) {
                return {cancelled: true, frames: [], pointerTravel: combinePointerTravels(travels)};
            }
            const selected = await waitFor(
                () => vm.editingTarget && vm.editingTarget.id === expectedTarget.id,
                documentObject,
                signal
            );
            if (!selected) throw new Error(`Project selection did not settle: ${plan.targetRef.name}`);
        }

        if (soundEffectPlan || soundUploadPlan || costumeCreatePlan) {
            const tabTargetId = costumeCreatePlan ? 'tab-costumes' : 'tab-sounds';
            const tab = await waitFor(() => studioTarget(documentObject, tabTargetId), documentObject, signal);
            if (!tab) throw new Error(`Editor tab target is unavailable: ${tabTargetId}`);
            const tabTravel = await clickThroughPointer({
                pointer,
                clock,
                signal,
                scope,
                id: tabTargetId,
                kind: 'editor-tab',
                locate: () => studioTarget(documentObject, tabTargetId)
            });
            recordTravel('tab', tabTravel);
            if (!travels.tab.completed) {
                return {cancelled: true, frames: [], pointerTravel: combinePointerTravels(travels)};
            }
        }

        if (uploadPlan || costumePaintPlan) {
            const mediaType = costumeCreatePlan ? (plan.targetRef.isStage ? 'backdrop' : 'costume') : 'sound';
            const stageCreatePlan = costumeCreatePlan && plan.targetRef.isStage;
            const menuTargetId = `${mediaType}-library-open`;
            const menuButton = await waitFor(
                () => studioTarget(documentObject, menuTargetId), documentObject, signal
            );
            if (!menuButton) throw new Error(`Media action menu is unavailable: ${menuTargetId}`);
            const menuTravel = await pointer.travelTo(createElementPointerTarget({
                id: menuTargetId,
                kind: `${mediaType}-action-menu`,
                locate: () => studioTarget(documentObject, menuTargetId)
            }), {clock, signal});
            recordTravel('menu', menuTravel);
            if (!travels.menu.completed) {
                return {cancelled: true, frames: [], pointerTravel: combinePointerTravels(travels)};
            }
            scope.runWithoutUndo(() => {
                const view = documentObject.defaultView;
                menuButton.dispatchEvent(new view.MouseEvent('mouseover', {
                    bubbles: true,
                    clientX: travels.menu.target.point.x,
                    clientY: travels.menu.target.point.y
                }));
            });

            const actionTargetId = stageCreatePlan ?
                `backdrop-stage-${costumePaintPlan ? 'paint-create' : 'upload-open'}` :
                (costumePaintPlan ? `${mediaType}-paint-create` : `${mediaType}-upload-open`);
            const actionControl = await waitFor(() => {
                const element = studioTarget(documentObject, actionTargetId);
                return visibleBounds(element, documentObject) ? element : null;
            }, documentObject, signal);
            if (!actionControl) throw new Error(`Media creation control did not become visible: ${actionTargetId}`);
            const actionControlVisibleBefore = visibleBounds(actionControl, documentObject);
            const input = uploadPlan ? studioTarget(documentObject, `${actionTargetId}-input`) : null;
            if (uploadPlan && !input) throw new Error('Media upload input is unavailable');
            const items = soundUploadPlan ?
                (expectedTarget.getSounds ? expectedTarget.getSounds() : expectedTarget.sprite.sounds) :
                expectedTarget.getCostumes();
            const beforeCount = items.length;
            const invocation = observeVmInvocation(vm, soundUploadPlan ? 'addSound' :
                (stageCreatePlan ? 'addBackdrop' : 'addCostume'));
            let uploadFile = null;
            try {
                const actionTravel = await clickThroughPointer({
                    pointer,
                    clock,
                    signal,
                    scope,
                    id: actionTargetId,
                    kind: costumePaintPlan ? `${mediaType}-paint` : `${mediaType}-upload`,
                    locate: () => studioTarget(documentObject, actionTargetId)
                });
                recordTravel('action', actionTravel);
                if (!travels.action.completed) {
                    return {cancelled: true, frames: [], pointerTravel: combinePointerTravels(travels)};
                }
                if (uploadPlan) {
                    uploadFile = scope.runWithoutUndo(() => dispatchFileUpload({
                        documentObject,
                        input,
                        asset: uploadSourceAsset,
                        uploadFile: plan.uploadFile,
                        addedAsset: uploadAsset,
                        mimeType: soundUploadPlan ? soundMimeType : costumeMimeType
                    }));
                }
                const observation = await waitFor(invocation.observation, documentObject, signal, 360);
                if (!observation) throw new Error('Media creation did not invoke its VM operation');
                await observation.completion;
            } finally {
                invocation.restore();
            }
            const addedMedia = await waitFor(() => {
                const currentItems = soundUploadPlan ?
                    (expectedTarget.getSounds ? expectedTarget.getSounds() : expectedTarget.sprite.sounds) :
                    expectedTarget.getCostumes();
                const item = currentItems && currentItems[beforeCount];
                return item ? (soundUploadPlan ? soundReference(item) : costumeReference(item)) : null;
            }, documentObject, signal, 360);
            return {
                frames: [],
                pointerTravel: combinePointerTravels(travels),
                ...(uploadPlan ? {
                    uploadControlVisible: actionControlVisibleBefore,
                    fileInputReady: Boolean(uploadFile)
                } : {createControlVisible: actionControlVisibleBefore}),
                ...(soundUploadPlan ? {
                    addedSound: addedMedia,
                    addedSoundMatches: sameSound(addedMedia, plan.addedSound)
                } : {
                    addedCostume: addedMedia,
                    addedCostumeMatches: sameCostume(addedMedia, plan.addedCostume)
                })
            };
        }

        if (soundEffectPlan) {

            const soundTargetId = `sound-item:${plan.soundIndex}:${plan.previousSound.assetId}`;
            const soundItem = await waitFor(
                () => studioTarget(documentObject, soundTargetId), documentObject, signal
            );
            if (!soundItem) throw new Error(`Sound item target is unavailable: ${soundTargetId}`);
            const soundsBeforeEdit = expectedTarget.getSounds ?
                expectedTarget.getSounds() : expectedTarget.sprite.sounds;
            const selectedSound = soundsBeforeEdit && soundsBeforeEdit[plan.soundIndex];
            const selectedSoundMatches = sameSound(soundReference(selectedSound), plan.previousSound);
            if (!selectedSoundMatches) {
                throw new Error(`Recorded sound is unavailable at index ${plan.soundIndex}`);
            }
            const soundVisibleBeforeSelect = visibleBounds(soundItem, documentObject);
            const soundTravel = await clickThroughPointer({
                pointer,
                clock,
                signal,
                scope,
                id: soundTargetId,
                kind: 'sound-item',
                locate: () => studioTarget(documentObject, soundTargetId)
            });
            recordTravel('sound', soundTravel);
            if (!travels.sound.completed) {
                return {cancelled: true, frames: [], pointerTravel: combinePointerTravels(travels)};
            }

            const effectTargetId = `sound-effect:${plan.soundEffect}`;
            const effect = await waitFor(
                () => studioTarget(documentObject, effectTargetId), documentObject, signal
            );
            if (!effect) throw new Error(`Sound effect target is unavailable: ${effectTargetId}`);
            const effectVisibleBeforeClick = visibleBounds(effect, documentObject);
            const invocation = observeVmInvocation(vm, 'updateSoundBuffer');
            try {
                const effectTravel = await clickThroughPointer({
                    pointer,
                    clock,
                    signal,
                    scope,
                    id: effectTargetId,
                    kind: 'sound-effect',
                    locate: () => studioTarget(documentObject, effectTargetId)
                });
                recordTravel('effect', effectTravel);
                if (!travels.effect.completed) {
                    return {cancelled: true, frames: [], pointerTravel: combinePointerTravels(travels)};
                }
                const observation = await waitFor(invocation.observation, documentObject, signal, 360);
                if (!observation) throw new Error('Sound effect did not update its VM buffer');
                await observation.completion;
            } finally {
                invocation.restore();
            }

            const editedSound = await waitFor(() => {
                const sounds = expectedTarget.getSounds ? expectedTarget.getSounds() : expectedTarget.sprite.sounds;
                const sound = sounds && sounds[plan.soundIndex];
                return sameSound(soundReference(sound), plan.editedSound) ? soundReference(sound) : null;
            }, documentObject, signal, 360);
            return {
                frames: [],
                pointerTravel: combinePointerTravels(travels),
                selectedSound: soundReference(selectedSound),
                selectedSoundMatches,
                soundVisibleBeforeSelect,
                effectVisibleBeforeClick,
                editedSound,
                editedSoundMatches: Boolean(editedSound)
            };
        }

        if (mediaConfig) {
            const tab = await waitFor(
                () => studioTarget(documentObject, mediaConfig.tabTargetId), documentObject, signal
            );
            if (!tab) throw new Error(`Editor tab target is unavailable: ${mediaConfig.tabTargetId}`);
            const tabTravel = await clickThroughPointer({
                pointer,
                clock,
                signal,
                scope,
                id: mediaConfig.tabTargetId,
                kind: 'editor-tab',
                locate: () => studioTarget(documentObject, mediaConfig.tabTargetId)
            });
            recordTravel('tab', tabTravel);
            if (!travels.tab.completed) {
                return {cancelled: true, frames: [], pointerTravel: combinePointerTravels(travels)};
            }
        }

        const openTargetId = plan.kind === 'sprite-library-select' ?
            'sprite-library-open' : mediaConfig.openTargetId;
        const openControl = await waitFor(
            () => studioTarget(documentObject, openTargetId), documentObject, signal
        );
        if (!openControl) throw new Error(`Library open target is unavailable: ${openTargetId}`);
        const openTravel = await clickThroughPointer({
            pointer,
            clock,
            signal,
            scope,
            id: openTargetId,
            kind: plan.kind === 'sprite-library-select' ? 'sprite-create' : 'library-open',
            locate: () => studioTarget(documentObject, openTargetId)
        });
        recordTravel('open', openTravel);
        if (!travels.open.completed) {
            return {cancelled: true, frames: [], pointerTravel: combinePointerTravels(travels)};
        }

        const itemLocator = () => attributeTarget(
            documentObject, LIBRARY_KEY_ATTRIBUTE, plan.libraryItem.md5ext
        );
        const item = await waitFor(itemLocator, documentObject, signal);
        if (!item) throw new Error(`Library item is unavailable: ${plan.libraryItem.md5ext}`);
        if (typeof item.scrollIntoView === 'function') item.scrollIntoView({block: 'center', inline: 'center'});
        await waitFor(() => visibleBounds(itemLocator(), documentObject) && itemLocator(), documentObject, signal);
        const libraryVisibleBeforeSelect = visibleBounds(itemLocator(), documentObject);

        const beforeTargetIds = new Set((vm.runtime.targets || []).map(target => target.id));
        const mediaTarget = mediaConfig ? vm.editingTarget : null;
        const mediaCount = mediaTarget && mediaConfig.itemsOf(mediaTarget).length;
        const invocation = observeVmInvocation(
            vm,
            plan.kind === 'sprite-library-select' ? 'addSprite' : mediaConfig.vmMethod
        );
        try {
            const itemTravel = await clickThroughPointer({
                pointer,
                clock,
                signal,
                scope,
                id: `library-item:${plan.libraryItem.md5ext}`,
                kind: plan.kind === 'sprite-library-select' ? 'sprite-create' : 'library-item',
                locate: itemLocator,
                afterActivate: async () => {
                    const observation = await waitFor(invocation.observation, documentObject, signal);
                    if (!observation) throw new Error('Library item did not invoke its VM operation');
                    await observation.completion;
                }
            });
            recordTravel('item', itemTravel);
            if (!travels.item.completed) {
                return {cancelled: true, frames: [], pointerTravel: combinePointerTravels(travels)};
            }
        } finally {
            invocation.restore();
        }

        if (plan.kind === 'sprite-library-select') {
            const createdTarget = await waitFor(() => (vm.runtime.targets || []).find(target => (
                target.isOriginal && !beforeTargetIds.has(target.id)
            )), documentObject, signal);
            if (!createdTarget) throw new Error('Sprite library selection did not create a sprite');
            return {
                frames: [],
                pointerTravel: combinePointerTravels(travels),
                libraryVisibleBeforeSelect,
                selectedLibraryItem: plan.libraryItem,
                createdTarget: {
                    id: createdTarget.id,
                    name: targetName(createdTarget),
                    isStage: Boolean(createdTarget.isStage)
                }
            };
        }

        const addedMedia = await waitFor(() => {
            const items = mediaTarget && mediaConfig.itemsOf(mediaTarget);
            return items && items.length > mediaCount ? items[mediaCount] : null;
        }, documentObject, signal);
        if (!addedMedia) throw new Error(`${mediaConfig.resultKind} library selection did not add an item`);
        if (mediaConfig.resultKind === 'sound') {
            const addedSound = soundReference(addedMedia);
            return {
                frames: [],
                pointerTravel: combinePointerTravels(travels),
                libraryVisibleBeforeSelect,
                selectedLibraryItem: plan.libraryItem,
                addedSound,
                addedSoundMatches: sameSound(addedSound, plan.addedSound)
            };
        }
        const addedCostume = costumeReference(addedMedia);
        return {
            frames: [],
            pointerTravel: combinePointerTravels(travels),
            libraryVisibleBeforeSelect,
            selectedLibraryItem: plan.libraryItem,
            addedCostume,
            addedCostumeMatches: sameCostume(addedCostume, plan.addedCostume)
        };
    }
});

export {createProjectLibraryDriver};
