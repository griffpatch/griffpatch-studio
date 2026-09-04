import React from 'react';
import renderer, {act} from 'react-test-renderer';
import {createStore} from 'redux';
import VM from 'scratch-vm';
import CloudProvider from '../../../src/lib/cloud-provider';
import cloudManagerHOC from '../../../src/lib/cloud-manager-hoc';
import reducer, {LoadingState, onFetchedProjectData, onLoadedProject, setProjectId,
    doneCreatingProject} from '../../../src/reducers/project-state';

jest.mock('scratch-vm', () => class VM {
    constructor () {
        this.runtime = {hasCloudData: () => true};
        this.extensionManager = {isExtensionLoaded: () => false};
        this.on = jest.fn();
        this.off = jest.fn();
        this.setCloudProvider = jest.fn();
    }
});
jest.mock('../../../src/lib/cloud-provider', () => jest.fn().mockImplementation(() => ({
    connection: {}, requestCloseConnection: jest.fn()
})));

const fetched = fromUrl => reducer({projectId: '123', loadingState: LoadingState.FETCHING_WITH_ID},
    onFetchedProjectData('bytes', LoadingState.FETCHING_WITH_ID, fromUrl));
const shown = fromUrl => reducer(fetched(fromUrl), onLoadedProject(LoadingState.LOADING_VM_WITH_ID, false, true));

test('URL provenance is set before VM loading and survives becoming visible and address-ID changes', () => {
    const state = fetched(true);
    expect(state.isProjectFromUrl).toBe(true);
    expect(state.loadingState).toBe(LoadingState.LOADING_VM_WITH_ID);
    expect(shown(true).isProjectFromUrl).toBe(true);
    expect(reducer(shown(true), setProjectId('456')).isProjectFromUrl).toBe(true);
});

test('a genuine Scratch fetch replaces URL provenance with the new bytes', () => {
    const state = {...shown(true), loadingState: LoadingState.FETCHING_WITH_ID};
    expect(reducer(state, onFetchedProjectData('scratch bytes', state.loadingState)).isProjectFromUrl).toBe(false);
});

test.each([LoadingState.LOADING_VM_FILE_UPLOAD, LoadingState.LOADING_VM_NEW_DEFAULT])(
    '%s clears stale URL provenance and is not showing a shared project', loadingState => {
        const state = reducer({...shown(true), loadingState}, onLoadedProject(loadingState, false, true));
        expect(state.isProjectFromUrl).toBe(false);
        expect(state.projectId).toBe('0');
        expect(state.loadingState).toBe(LoadingState.SHOWING_WITHOUT_ID);
    }
);

test.each([LoadingState.CREATING_NEW, LoadingState.CREATING_COPY, LoadingState.REMIXING])(
    'new server identity after %s resets URL provenance', loadingState => {
        const state = reducer({...shown(true), loadingState}, doneCreatingProject('456', loadingState));
        expect(state.isProjectFromUrl).toBe(false);
        expect(state.projectId).toBe('456');
    }
);

test.each(['wss://clouddata.turbowarp.org', 'wss://custom.example.test'])(
    'connected manager blocks URL-derived IDs, disconnects old rooms and resumes genuine IDs on %s', cloudHost => {
        CloudProvider.mockClear();
        const vm = new VM();
        const store = createStore((state = shown(false), action) => reducer(state, action));
        // Use the real Redux mapping, not an injected canUseCloud result.
        const rootStore = {...store, getState: () => ({scratchGui: {
            projectState: store.getState(), mode: {hasEverEnteredEditor: false},
            tw: {cloudHost, cloud: true}
        }})};
        const Child = () => null;
        const Component = cloudManagerHOC(Child);
        let view;
        act(() => {
            view = renderer.create(<Component store={rootStore} vm={vm} cloudHost={cloudHost}
                hasCloudPermission username="player123" />);
        });
        expect(CloudProvider).toHaveBeenCalledTimes(1);
        expect(CloudProvider.mock.calls[0][3]).toBe('123');
        const first = CloudProvider.mock.results[0].value;
        act(() => {
            store.dispatch(setProjectId('456'));
            store.dispatch(onFetchedProjectData('custom bytes', LoadingState.FETCHING_WITH_ID, true));
            store.dispatch(onLoadedProject(LoadingState.LOADING_VM_WITH_ID, false, true));
        });
        expect(first.requestCloseConnection).toHaveBeenCalledTimes(1);
        expect(CloudProvider).toHaveBeenCalledTimes(1);
        expect(view.root.findByType(Child).props.canUseCloud).toBe(false);
        // Changing only an ID cannot release the guard. A subsequent real fetch can.
        act(() => {
            store.dispatch(setProjectId('789'));
            store.dispatch(onFetchedProjectData('scratch bytes', LoadingState.FETCHING_WITH_ID));
            store.dispatch(onLoadedProject(LoadingState.LOADING_VM_WITH_ID, false, true));
        });
        expect(CloudProvider).toHaveBeenCalledTimes(2);
        expect(CloudProvider.mock.calls[1][3]).toBe('789');
        act(() => view.unmount());
    }
);
