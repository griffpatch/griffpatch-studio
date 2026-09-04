import BackpackBlockDropSession from '../../../src/lib/backpack/block-drop-session';

describe('BackpackBlockDropSession', () => {
    test('recognizes a quick drop without waiting for presentation state', () => {
        const session = new BackpackBlockDropSession();

        session.updateOutsideWorkspace(true);
        expect(session.enterBackpack()).toBe(true);
        expect(session.end()).toBe(true);
        expect(session.end()).toBe(false);
    });

    test('does not accept an enter while the block remains in the workspace', () => {
        const session = new BackpackBlockDropSession();

        expect(session.enterBackpack()).toBe(false);
        expect(session.end()).toBe(false);
    });

    test('cancels a drop after leaving the Backpack', () => {
        const session = new BackpackBlockDropSession();

        session.updateOutsideWorkspace(true);
        session.enterBackpack();
        session.leaveBackpack();

        expect(session.end()).toBe(false);
    });
});
