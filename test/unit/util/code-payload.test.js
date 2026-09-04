jest.mock('../../../src/lib/backpack/block-to-image', () => () => Promise.resolve('block-image'));
jest.mock('../../../src/lib/backpack/thumbnail', () => () => Promise.resolve('thumbnail'));

import codePayload, {backpackScriptSource} from '../../../src/lib/backpack/code-payload';
import {Base64} from 'js-base64';

describe('codePayload', () => {
    test('base64 encodes the blocks as json', () => {
        const blocks = '☁︎❤️🐻';
        const payload = codePayload({
            blockObjects: blocks
        });
        return payload.then(p => {
            expect(
                JSON.parse(Base64.decode(p.body))
            ).toEqual(blocks);
        });
    });

    test('freezes a compact durable reference for a Backpack script', () => {
        expect(backpackScriptSource({
            id: 17,
            type: 'script',
            name: 'code',
            bodyMD5: 'abc123',
            bodyUrl: 'data:application/json;base64,changing-presentation-data'
        })).toEqual({
            kind: 'backpack-script',
            item: {id: '17', type: 'script', name: 'code', bodyMD5: 'abc123'}
        });
        expect(backpackScriptSource({id: 18, type: 'sprite'})).toBeNull();
    });
});
