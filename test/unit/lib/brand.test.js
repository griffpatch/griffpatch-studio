import fs from 'fs';
import path from 'path';
import {
    APP_NAME, APP_CHANNEL, APP_TITLE, APP_DESCRIPTION, brandManifest, projectPageTitle
} from '../../../src/lib/brand';

describe('preview brand identity', () => {
    test.each([null, '', 'Scratch Project'])('default title ignores placeholder %s', title => {
        expect(projectPageTitle(title, true)).toBe(APP_TITLE);
    });
    test('project titles preserve user text and the preview channel', () => {
        expect(projectPageTitle('My <game> & clones', false))
            .toBe(`My <game> & clones - ${APP_NAME} · ${APP_CHANNEL}`);
        expect(projectPageTitle('', false)).toBe(APP_TITLE);
    });
    test('install metadata shares the brand without changing install behavior', () => {
        const base = JSON.parse(fs.readFileSync(path.resolve('static/manifest.webmanifest'), 'utf8'));
        const snapshot = JSON.stringify(base);
        const branded = brandManifest(base);
        expect(branded).toEqual({...base, name: APP_TITLE, short_name: APP_NAME, description: APP_DESCRIPTION});
        expect(JSON.stringify(base)).toBe(snapshot);
        expect(branded.start_url).toBe('editor');
        for (const icon of branded.icons) {
            const png = fs.readFileSync(path.resolve('static', icon.src));
            expect(png.subarray(1, 4).toString()).toBe('PNG');
            const size = Number(icon.sizes.split('x')[0]);
            expect(png.readUInt32BE(16)).toBe(size);
            expect(png.readUInt32BE(20)).toBe(size);
        }
    });
});
