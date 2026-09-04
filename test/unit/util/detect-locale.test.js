import {detectLocale} from '../../../src/lib/detect-locale.js';

jest.mock('query-string', () => ({parse: () => { throw new Error('Legacy decoder used'); }}));

const supportedLocales = ['en', 'es', 'pt-br', 'de', 'it'];

// This utility only needs browser location, language and storage, not a DOM.
const previousWindow = global.window;
const previousLocation = global.location;
const previousStorage = global.localStorage;
global.window = {location: {}, navigator: {}};
global.location = window.location;
global.localStorage = {getItem: jest.fn(() => null)};
afterAll(() => {
    global.window = previousWindow;
    global.location = previousLocation;
    global.localStorage = previousStorage;
});

Object.defineProperty(window.location,
    'search',
    {value: '?name=val', configurable: true}
);
Object.defineProperty(window.navigator,
    'language',
    {value: 'en-US', configurable: true}
);

describe('detectLocale', () => {
    beforeEach(() => {
        Object.defineProperty(window.location, 'search', {value: '', configurable: true});
        Object.defineProperty(window.navigator, 'language', {value: 'en-US', configurable: true});
        localStorage.getItem.mockReset().mockReturnValue(null);
    });

    test.each([
        ['?lang=it&locale=de', 'de'],
        ['?locale&locale=&lang=it', 'it'],
        ['?%6Cocale=%64%65', 'de'],
        ['?locale=de+DE&lang=it', 'en'],
        ['?locale=%FF&lang=de', 'en'],
        [`?unused=${'%FF'.repeat(4096)}&locale=de`, 'de']
    ])('handles URL input %s', (search, expected) => {
        Object.defineProperty(window.location, 'search', {value: search});
        expect(detectLocale(supportedLocales)).toBe(expected);
    });

    test('retains saved language precedence and tolerates unavailable storage', () => {
        Object.defineProperty(window.location, 'search', {value: '?locale=de'});
        localStorage.getItem.mockReturnValue('it');
        expect(detectLocale(supportedLocales)).toBe('it');
        localStorage.getItem.mockImplementation(() => { throw new Error('denied'); });
        expect(detectLocale(supportedLocales)).toBe('de');
    });
    test('uses locale from the URL when present', () => {
        Object.defineProperty(window.location,
            'search',
            {value: '?locale=pt-br'}
        );
        expect(detectLocale(supportedLocales)).toEqual('pt-br');
    });

    test('is case insensitive', () => {
        Object.defineProperty(window.location,
            'search',
            {value: '?locale=pt-BR'}
        );
        expect(detectLocale(supportedLocales)).toEqual('pt-br');
    });

    test('also accepts lang from the URL when present', () => {
        Object.defineProperty(window.location,
            'search',
            {value: '?lang=it'}
        );
        expect(detectLocale(supportedLocales)).toEqual('it');
    });

    test('ignores unsupported locales', () => {
        Object.defineProperty(window.location,
            'search',
            {value: '?lang=sv'}
        );
        expect(detectLocale(supportedLocales)).toEqual('en');
    });

    test('ignores other parameters', () => {
        Object.defineProperty(window.location,
            'search',
            {value: '?enable=language'}
        );
        expect(detectLocale(supportedLocales)).toEqual('en');
    });

    test('uses navigator language property for default if supported', () => {
        Object.defineProperty(window.navigator,
            'language',
            {value: 'pt-BR'}
        );
        expect(detectLocale(supportedLocales)).toEqual('pt-br');
    });

    test('ignores navigator language property if unsupported', () => {
        Object.defineProperty(window.navigator,
            'language',
            {value: 'da'}
        );
        expect(detectLocale(supportedLocales)).toEqual('en');
    });

    test('works with an empty locale', () => {
        Object.defineProperty(window.location,
            'search',
            {value: '?locale='}
        );
        expect(detectLocale(supportedLocales)).toEqual('en');
    });

    test('if multiple, uses the first locale', () => {
        Object.defineProperty(window.location,
            'search',
            {value: '?locale=de&locale=en'}
        );
        expect(detectLocale(supportedLocales)).toEqual('de');
    });
});
