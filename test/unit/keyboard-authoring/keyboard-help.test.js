import {createKeyboardHelp, SEEN_KEY} from '../../../src/experiments/keyboard-authoring/keyboard-help';
import {JSDOM} from 'jsdom';

let document;
let localStorage;
let HTMLDialogElement;
let Event;
let Storage;

beforeEach(() => {
    ({document, localStorage, HTMLDialogElement, Event, Storage} = new JSDOM('', {url: 'http://localhost'}).window);
    document.body.innerHTML = '';
    localStorage.clear();
    HTMLDialogElement.prototype.showModal = function () { this.open = true; };
    HTMLDialogElement.prototype.close = function () {
        this.open = false;
        this.dispatchEvent(new Event('close'));
    };
});

test('first use persists, reopening is explicit and closing returns focus through the host', () => {
    const onClose = jest.fn();
    const help = createKeyboardHelp({parent: document.body, onClose});
    help.open(true);
    expect(help.isOpen()).toBe(true);
    expect(localStorage.getItem(SEEN_KEY)).toBe('1');
    document.querySelector('footer button').click();
    expect(onClose).toHaveBeenCalledTimes(1);
    help.open(true);
    expect(help.isOpen()).toBe(false);
    help.open();
    expect(help.isOpen()).toBe(true);
    help.dispose();
    expect(document.querySelector('dialog')).toBeNull();
    expect(onClose).toHaveBeenCalledTimes(1);
});

test('a new host remembers acknowledgement and blocked storage stays usable', () => {
    localStorage.setItem(SEEN_KEY, '1');
    const first = createKeyboardHelp({parent: document.body, onClose: jest.fn()});
    first.open(true);
    expect(first.isOpen()).toBe(false);
    first.dispose();
    const read = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    const write = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    const help = createKeyboardHelp({parent: document.body, onClose: jest.fn()});
    expect(() => help.open(true)).not.toThrow();
    document.querySelector('footer button').click();
    help.open(true);
    expect(help.isOpen()).toBe(false);
    read.mockRestore();
    write.mockRestore();
});
