import twTranslations from './generated-translations.json';
import {applyBrandTranslations} from '../brand-translations';

const addAdditionalTranslations = editorMessages => {
    for (const locale of Object.keys(editorMessages)) {
        const toMixIn = twTranslations[locale.toLowerCase()];
        if (toMixIn) {
            Object.assign(editorMessages[locale], toMixIn);
        }
    }

    // We reuse our `es` translations for `es-419` instead of maintaining separate translations.
    Object.assign(editorMessages['es-419'], twTranslations.es);
    applyBrandTranslations(editorMessages);
};

export default addAdditionalTranslations;
