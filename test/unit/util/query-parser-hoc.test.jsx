import React from 'react';
import renderer from 'react-test-renderer';
import QueryParserHOC from '../../../src/lib/query-parser-hoc.jsx';

jest.mock('react-redux', () => ({connect: () => Component => Component}));
jest.mock('../../../src/lib/analytics', () => ({event: jest.fn()}));
jest.mock('../../../src/lib/libraries/decks/index.jsx', () => ({intro: {urlId: 'one'}}));
// Catch accidental reintroduction even on well-formed URLs.
jest.mock('query-string', () => ({parse: () => { throw new Error('Legacy decoder used'); }}));

const previousLocation = global.location;
afterAll(() => { global.location = previousLocation; });
const Component = QueryParserHOC(() => null);

test.each([
    ['', null],
    ['?tutorial', null],
    ['?tutorial=', null],
    ['?tutorial=unknown', null],
    ['?tutorial=all', 'all'],
    ['?tutorial=one', 'intro'],
    ['?tutorial=one&tutorial=all', 'intro'],
    ['?tutorial=&tutorial=all', null],
    ['?%74utorial=%6Fne', 'intro'],
    ['?tutorial=one+two', null],
    ['?tutorial=one%2Btwo', null],
    ['?tutorial=%FF', null],
    [`?unused=${'%FF'.repeat(4096)}&tutorial=one`, 'intro']
])('startup tutorial selection for %s', (search, expected) => {
    global.location = {search};
    const open = jest.fn();
    const activate = jest.fn();
    const tree = renderer.create(<Component onOpenTipsLibrary={open} onUpdateReduxDeck={activate} />);
    expect(open.mock.calls).toEqual(expected === 'all' ? [[]] : []);
    expect(activate.mock.calls).toEqual(expected && expected !== 'all' ? [[expected]] : []);
    tree.unmount();
});
