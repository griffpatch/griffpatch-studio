import {
    createExtensionLibraryDriver,
    extensionIdForBlockType,
    visibleFlyoutBlock
} from '../../src/studio/bridge/native-interaction/extension-library-driver';

const makeHarness = () => {
    class MouseEvent {
        constructor (type, options) {
            this.type = type;
            Object.assign(this, options);
        }
    }
    const state = {libraryOpen: false, loaded: false};
    const documentObject = {
        defaultView: {
            MouseEvent,
            requestAnimationFrame: callback => callback()
        },
        querySelector: jest.fn()
    };
    const element = (id, click) => ({
        id,
        ownerDocument: documentObject,
        scrollIntoView: jest.fn(),
        getBoundingClientRect: () => ({left: 10, top: 20, width: 80, height: 50}),
        dispatchEvent: event => {
            if (event.type === 'click') click();
            return true;
        }
    });
    const open = element('open', () => {
        state.libraryOpen = true;
    });
    const pen = element('pen', () => {
        state.loaded = true;
    });
    documentObject.querySelector.mockImplementation(selector => {
        if (selector.includes('data-studio-target="extension-library-open"')) return open;
        if (selector.includes('data-studio-library-key="pen"') && state.libraryOpen) return pen;
        return null;
    });
    const vm = {
        extensionManager: {
            isBuiltinExtension: id => id === 'pen',
            isExtensionLoaded: id => id === 'pen' && state.loaded
        }
    };
    const pointer = {
        travelTo: jest.fn(async target => ({
            completed: true,
            model: 'natural',
            target: {id: target.id, element: target.locate(), point: {x: 40, y: 45}},
            frames: [{x: 40, y: 45}]
        })),
        click: async activate => {
            activate();
            return true;
        }
    };
    return {
        driver: createExtensionLibraryDriver({
            vm,
            documentObject,
            clock: {},
            pointer,
            scope: {runWithoutUndo: action => action()}
        }),
        pointer,
        state,
        vm
    };
};

test('derives only built-in extension IDs from block opcodes', () => {
    const {vm} = makeHarness();
    expect(extensionIdForBlockType(vm, 'pen_clear')).toBe('pen');
    expect(extensionIdForBlockType(vm, 'motion_movesteps')).toBeNull();
    expect(extensionIdForBlockType(vm, null)).toBeNull();
});

test('requires the loaded extension block to be visibly rendered in the flyout', () => {
    const hidden = {
        type: 'pen_clear',
        getSvgRoot: () => ({getBoundingClientRect: () => ({width: 0, height: 0})})
    };
    const visible = {
        type: 'pen_clear',
        getSvgRoot: () => ({getBoundingClientRect: () => ({width: 80, height: 40})})
    };
    const workspace = {
        getFlyout: () => ({
            getWorkspace: () => ({getAllBlocks: () => [hidden, visible]})
        })
    };
    expect(visibleFlyoutBlock(workspace, 'pen_clear')).toBe(visible);
    expect(visibleFlyoutBlock(workspace, 'pen_stamp')).toBeNull();
});

test('opens the real extension library once before the first extension block', async () => {
    const {driver, pointer, state} = makeHarness();
    const result = await driver.ensureForBlock('pen_clear');

    expect(result).toMatchObject({cancelled: false, extensionId: 'pen', loaded: true});
    expect(state).toEqual({libraryOpen: true, loaded: true});
    expect(pointer.travelTo.mock.calls.map(call => call[0].id)).toEqual([
        'extension-library-open',
        'extension-library-item:pen'
    ]);

    expect(await driver.ensureForBlock('pen_stamp')).toMatchObject({loaded: false});
    expect(pointer.travelTo).toHaveBeenCalledTimes(2);
});
