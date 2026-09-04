// Legacy export format because this is used by some build-time scripts stuck in the past.
const APP_NAME = 'Griffpatch Studio';
const APP_CHANNEL = 'Preview';
const APP_TITLE = `${APP_NAME} · ${APP_CHANNEL}`;
const APP_DESCRIPTION =
    'A playground for griffpatch\'s TurboWarp experiments and new ideas for the development interface.';

// eslint-disable-next-line import/no-commonjs
module.exports = {
    APP_NAME,
    APP_CHANNEL,
    APP_TITLE,
    APP_DESCRIPTION,
    SHOW_UPSTREAM_NEWS: false,
    APP_TAGLINE: 'A playground for TurboWarp ideas.',
    APP_ABOUT_PATH: 'credits.html',
    APP_FEEDBACK_PATH: 'credits.html#feedback',
    APP_SOURCE_PATH: 'credits.html#source',
    APP_PRIVACY_PATH: 'credits.html#preview-privacy',
    projectPageTitle: (title, isDefault) => (isDefault || !title ? APP_TITLE : `${title} - ${APP_TITLE}`),
    // Keep the install identity and page metadata together. No origin, storage
    // keys or project identifiers change when the display name changes.
    brandManifest: manifest => ({
        ...manifest,
        name: APP_TITLE,
        short_name: APP_NAME,
        description: APP_DESCRIPTION
    })
};
