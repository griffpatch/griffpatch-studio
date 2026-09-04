import {APP_NAME} from './brand';

// Only these upstream messages identify the running app. Do not rewrite
// attribution, remote service names, compatibility blocks or message IDs.
const APP_IDENTITY_MESSAGES = [
    'tw.settingsModal.storeProjectOptionsHelp',
    'tw.gui.crashMessage.description'
];

const applyBrandTranslations = messages => {
    for (const entries of Object.values(messages)) {
        for (const id of APP_IDENTITY_MESSAGES) {
            if (typeof entries[id] === 'string') {
                entries[id] = entries[id].replace(/TurboWarp/g, APP_NAME);
            }
        }
    }
};

export {applyBrandTranslations, APP_IDENTITY_MESSAGES};
