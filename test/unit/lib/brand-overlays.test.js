import {applyBrandTranslations, APP_IDENTITY_MESSAGES} from '../../../src/lib/brand-translations';
import translations from '../../../src/lib/tw-translations/generated-translations.json';
import {APP_NAME, SHOW_UPSTREAM_NEWS} from '../../../src/lib/brand';
const staticAsset = require('../../../scripts/studio-static-assets.cjs');

test('new upstream literal brand mentions require a deliberate classification at merge time', () => {
    const ids = new Set();
    for (const entries of Object.values(translations)) {
        for (const [id, text] of Object.entries(entries)) {
            if (text.includes('TurboWarp')) ids.add(id);
        }
    }
    expect([...ids].sort()).toEqual([...APP_IDENTITY_MESSAGES].sort());
});

test('identity overlay handles every inherited locale without changing the generated source or other messages', () => {
    const original = JSON.stringify(translations);
    const messages = JSON.parse(original);
    applyBrandTranslations(messages);
    for (const [locale, entries] of Object.entries(translations)) {
        for (const [id, text] of Object.entries(entries)) {
            expect(messages[locale][id]).toBe(APP_IDENTITY_MESSAGES.includes(id) ?
                text.replace(/TurboWarp/g, APP_NAME) : text);
        }
    }
    expect(JSON.stringify(translations)).toBe(original);
    expect(SHOW_UPSTREAM_NEWS).toBe(false);
});

test('overlay is idempotent and accepts missing identity translations', () => {
    const messages = {en: {attribution: 'Based on TurboWarp'}, fr: {
        'tw.gui.crashMessage.description': 'TurboWarp a crashé.'}};
    applyBrandTranslations(messages);
    applyBrandTranslations(messages);
    expect(messages.fr['tw.gui.crashMessage.description']).toBe(`${APP_NAME} a crashé.`);
    expect(messages.en.attribution).toBe('Based on TurboWarp');
});

test('static overlay replaces only the served policy and manifest, preserving other assets', () => {
    const input = Buffer.from('upstream asset');
    expect(staticAsset(input, '/static/brand/griffpatch-studio.svg')).toBe(input);
    const notice = staticAsset(input, '/static/privacy.html');
    expect(notice).toContain(APP_NAME);
    expect(notice).toContain('studio.griffpatch.academy');
    expect(notice).toContain('credits.html#preview-privacy');
    expect(notice).toContain('IndexedDB');
    expect(notice).toContain('some trusted extensions run without a sandbox');
    expect(notice).toContain('Your choices and contact');
    expect(notice).not.toContain('The TurboWarp project respects your privacy');
    expect(JSON.parse(staticAsset(Buffer.from('{"icons":[]}'), '/static/manifest.webmanifest')))
        .toMatchObject({short_name: APP_NAME, icons: []});
});
