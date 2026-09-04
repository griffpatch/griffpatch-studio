import {
    DEBUG_ELEMENT_ID,
    attachStudioBlockCapture
} from '../../src/studio/bridge/block-workspace-port';
import {makeChangeEvent, makeWorkspace} from './helpers/block-workspace';

const ScratchBlocks = {
    Xml: {
        domToText: xml => xml.text
    }
};

const makeDocument = () => {
    const listeners = new Map();
    const documentObject = {
        activeElement: null,
        addEventListener: (type, listener) => listeners.set(type, listener),
        removeEventListener: (type, listener) => {
            if (listeners.get(type) === listener) listeners.delete(type);
        },
        beginInlineEdit: () => {
            documentObject.activeElement = {
                classList: {
                    contains: name => name === 'blocklyHtmlInput'
                }
            };
        },
        endInlineEdit: () => {
            documentObject.activeElement = null;
            const listener = listeners.get('focusout');
            if (listener) listener();
        },
        listenerCount: () => listeners.size
    };
    return documentObject;
};

test('is inert when capture is not explicitly enabled', () => {
    const workspace = makeWorkspace();
    const port = attachStudioBlockCapture({
        workspace,
        vm: {editingTarget: {id: 'sprite-a'}},
        ScratchBlocks,
        enabled: false
    });

    expect(port.enabled).toBe(false);
    expect(workspace.listenerCount()).toBe(0);
});

test('persists native pickup identity with its event group and removes lifecycle observers', () => {
    const workspace = makeWorkspace();
    let dragListener;
    workspace.addBlockDragListener = listener => {
        dragListener = listener;
    };
    workspace.removeBlockDragListener = jest.fn();
    const port = attachStudioBlockCapture({
        workspace,
        vm: {editingTarget: {id: 'sprite-a'}},
        ScratchBlocks,
        enabled: true,
        exposeDebug: false
    });
    dragListener({phase: 'start',
        group: 'drag-group',
        blockId: 'block-1',
        blockIds: ['block-1', 'child'],
        origin: {kind: 'workspace-copy', blockId: 'argument'}});
    workspace.fire(makeChangeEvent('10', '20', 'drag-group'));
    expect(port.getSnapshots()).toHaveLength(0);
    dragListener({phase: 'settled', group: 'drag-group'});
    expect(port.getSnapshots()[0].gesture).toMatchObject({
        source: 'scratch-blocks-drag',
        blockId: 'block-1',
        blockIds: ['block-1', 'child'],
        origin: {kind: 'workspace-copy', blockId: 'argument'}
    });
    workspace.fire(makeChangeEvent('20', '30', 'drag-group'));
    expect(port.getSnapshots()[1].gesture).toBeUndefined();
    port.detach();
    expect(workspace.removeBlockDragListener).toHaveBeenCalledWith(dragListener);
});

test('explicit authoring provenance survives deferred events but cannot leak across groups or clear', () => {
    const workspace = makeWorkspace();
    const deferred = [];
    const port = attachStudioBlockCapture({workspace, vm: {editingTarget: {id: 'sprite-a'}},
        ScratchBlocks, enabled: true, exposeDebug: false, defer: action => deferred.push(action)});
    const source = {kind: 'keyboard-authoring'};
    port.tagEventGroup('typed', source);
    source.kind = 'mutated';
    workspace.fire(makeChangeEvent('10', '20', 'typed'));
    workspace.fire(makeChangeEvent('20', '30', 'mouse'));
    expect(port.getSnapshots()[0].interactionSource).toEqual({kind: 'keyboard-authoring'});
    expect(port.getSnapshots()[1].interactionSource).toBeUndefined();
    workspace.fire({type: 'var_create', group: 'typed', varId: 'v', varName: 'cake', varType: '',
        isLocal: true, toJson: () => ({type: 'var_create', group: 'typed', varId: 'v',
            varName: 'cake', varType: '', isLocal: true})});
    deferred.splice(0).forEach(action => action());
    expect(port.getSnapshots()[2].interactionSource).toEqual({kind: 'keyboard-authoring'});
    port.clear();
    workspace.fire(makeChangeEvent('30', '40', 'typed'));
    expect(port.getSnapshots()[0].interactionSource).toBeUndefined();
    port.detach();
    port.tagEventGroup('typed', source);
    expect(workspace.listenerCount()).toBe(0);
});

test.each([{isOutside: true}, {isOutside: true, cancelled: true}])(
    'does not record rolled-back drag %p', outcome => {
        const workspace = makeWorkspace();
        let dragListener;
        workspace.addBlockDragListener = listener => {
            dragListener = listener;
        };
        const onSnapshot = jest.fn();
        const port = attachStudioBlockCapture({workspace,
            vm: {editingTarget: {id: 'sprite-a'}},
            ScratchBlocks,
            enabled: true,
            exposeDebug: false,
            onSnapshot});
        dragListener({phase: 'start', group: 'drag', blockId: 'block-1', blockIds: ['block-1']});
        workspace.fire(makeChangeEvent('10', '20', 'drag'));
        workspace.fire({...makeChangeEvent('20', '10', null), recordUndo: false});
        port.flush();
        expect(onSnapshot).not.toHaveBeenCalled();
        dragListener({phase: 'settled', group: 'drag', ...outcome});
        expect(port.getSnapshots()).toEqual([]);
        expect(onSnapshot).not.toHaveBeenCalled();
    });

test('records a cancelled gesture that Blockly commits at its current position', () => {
    const workspace = makeWorkspace();
    let dragListener;
    workspace.addBlockDragListener = listener => {
        dragListener = listener;
    };
    const port = attachStudioBlockCapture({
        workspace,
        vm: {editingTarget: {id: 'sprite-a'}},
        ScratchBlocks,
        enabled: true,
        exposeDebug: false
    });
    dragListener({phase: 'start', group: 'paste', blockId: 'block-1', blockIds: ['block-1']});
    workspace.fire(makeChangeEvent('10', '20', 'paste'));
    dragListener({phase: 'settled', group: 'paste', isOutside: false, cancelled: true});
    expect(port.getSnapshots()).toHaveLength(1);
    expect(port.getSnapshots()[0].gesture.blockId).toBe('block-1');
});

test('captures the current target and supports pause, resume and detach', () => {
    const workspace = makeWorkspace();
    const vm = {editingTarget: {id: 'sprite-a'}};
    const persisted = [];
    const deferred = [];
    let time = 100;
    const port = attachStudioBlockCapture({
        workspace,
        vm,
        ScratchBlocks,
        enabled: true,
        exposeDebug: false,
        now: () => time++,
        defer: callback => deferred.push(callback),
        onSnapshot: snapshot => persisted.push(snapshot)
    });

    workspace.fire(makeChangeEvent());
    port.pause();
    workspace.fire(makeChangeEvent());
    vm.editingTarget = {id: 'sprite-b'};
    port.resume();
    workspace.fire(makeChangeEvent());
    deferred.shift()();
    workspace.fire(makeChangeEvent());

    expect(port.getSnapshots().map(snapshot => snapshot.targetId)).toEqual([
        'sprite-a',
        'sprite-b'
    ]);
    expect(port.getSnapshots().map(snapshot => snapshot.recordedAtMs)).toEqual([100, 101]);
    expect(persisted).toEqual(port.getSnapshots());

    port.detach();
    workspace.fire(makeChangeEvent());
    expect(workspace.listenerCount()).toBe(0);
    expect(port.getSnapshots()).toHaveLength(2);
});

test('commits one field change when an inline editor loses focus', () => {
    const workspace = makeWorkspace();
    const documentObject = makeDocument();
    const deferred = [];
    const persisted = [];
    let time = 100;
    const port = attachStudioBlockCapture({
        workspace,
        vm: {editingTarget: {id: 'sprite-a'}},
        ScratchBlocks,
        enabled: true,
        exposeDebug: false,
        documentObject,
        now: () => time++,
        defer: callback => deferred.push(callback),
        onSnapshot: snapshot => persisted.push(snapshot)
    });

    documentObject.beginInlineEdit();
    workspace.fire(makeChangeEvent('0', '1'));
    workspace.fire(makeChangeEvent('1', '12'));
    workspace.fire(makeChangeEvent('12', '123'));

    expect(port.getSnapshots()).toEqual([]);
    expect(persisted).toEqual([]);

    documentObject.endInlineEdit();
    deferred.shift()();

    expect(port.getSnapshots()).toHaveLength(1);
    expect(port.getSnapshots()[0].details.oldValue.value).toBe('0');
    expect(port.getSnapshots()[0].details.newValue.value).toBe('123');
    expect(port.getSnapshots()[0].recordedAtMs).toBe(102);
    expect(persisted).toEqual(port.getSnapshots());

    documentObject.beginInlineEdit();
    workspace.fire(makeChangeEvent('123', '1234'));
    documentObject.endInlineEdit();
    workspace.fire(makeChangeEvent('1234', '12345'));
    deferred.shift()();

    expect(port.getSnapshots()).toHaveLength(2);
    expect(port.getSnapshots()[1].details.oldValue.value).toBe('123');
    expect(port.getSnapshots()[1].details.newValue.value).toBe('12345');

    documentObject.beginInlineEdit();
    workspace.fire(makeChangeEvent('12345', '123456'));
    port.flush();
    expect(port.getSnapshots()).toHaveLength(3);
    expect(port.getSnapshots()[2].details.newValue.value).toBe('123456');

    workspace.fire(makeChangeEvent('123456', '1234567'));
    port.detach();
    expect(documentObject.listenerCount()).toBe(0);
    expect(port.getSnapshots()).toHaveLength(4);
    expect(port.getSnapshots()[3].details.newValue.value).toBe('1234567');
});

test('records one-click field changes immediately', () => {
    const workspace = makeWorkspace();
    const documentObject = makeDocument();
    const port = attachStudioBlockCapture({
        workspace,
        vm: {editingTarget: {id: 'sprite-a'}},
        ScratchBlocks,
        enabled: true,
        exposeDebug: false,
        documentObject
    });

    workspace.fire(makeChangeEvent('first', 'second'));

    expect(port.getSnapshots()).toHaveLength(1);
    expect(port.getSnapshots()[0].details.newValue.value).toBe('second');
});

test('drops a field edit that returns to its original value', () => {
    const workspace = makeWorkspace();
    const documentObject = makeDocument();
    const deferred = [];
    const port = attachStudioBlockCapture({
        workspace,
        vm: {editingTarget: {id: 'sprite-a'}},
        ScratchBlocks,
        enabled: true,
        exposeDebug: false,
        documentObject,
        defer: callback => deferred.push(callback)
    });

    documentObject.beginInlineEdit();
    workspace.fire(makeChangeEvent('10', '1'));
    workspace.fire(makeChangeEvent('1', '10'));
    documentObject.endInlineEdit();
    deferred.shift()();

    expect(port.getSnapshots()).toEqual([]);
});

test('contains malformed-event errors instead of breaking the editor listener', () => {
    const workspace = makeWorkspace();
    const port = attachStudioBlockCapture({
        workspace,
        vm: {editingTarget: {id: 'sprite-a'}},
        ScratchBlocks,
        enabled: true,
        exposeDebug: false,
        now: () => 500
    });

    const malformedDelete = makeChangeEvent();
    malformedDelete.type = 'delete';
    malformedDelete.ids = ['block-1'];

    expect(() => workspace.fire(malformedDelete)).not.toThrow();
    expect(port.getSnapshots()).toEqual([]);
    expect(port.getErrors()).toEqual([{
        recordedAtMs: 500,
        type: 'delete',
        message: 'Studio cannot snapshot delete: event XML is missing'
    }]);
});

test('captures a durable semantic reference beside the transient block ID', () => {
    const workspace = makeWorkspace();
    const root = {
        id: 'block-1',
        type: 'data_setvariableto',
        getParent: () => null,
        getRelativeToSurfaceXY: () => ({x: 120.4, y: 99.6})
    };
    workspace.getBlockById = id => (id === root.id ? root : null);
    const port = attachStudioBlockCapture({
        workspace,
        vm: {editingTarget: {id: 'sprite-a'}},
        ScratchBlocks,
        enabled: true,
        exposeDebug: false
    });

    workspace.fire(makeChangeEvent());

    expect(port.getSnapshots()[0].blockRef).toEqual({
        ancestorId: 'block-1',
        ancestorType: 'data_setvariableto',
        ancestorCoordinate: {x: 120, y: 100},
        path: []
    });
});

test('classifies a grouped workspace paste by its durable in-editor source', () => {
    const workspace = makeWorkspace();
    const deferred = [];
    const source = {
        id: 'source-root',
        type: 'control_repeat',
        getParent: () => null,
        getRelativeToSurfaceXY: () => ({x: 140, y: 90})
    };
    workspace.getBlockById = id => (id === source.id ? source : null);
    const originalPaste = jest.fn(() => workspace.fire({
        type: 'create',
        group: 'clipboard-group',
        blockId: 'pasted-root',
        ids: ['pasted-root', 'pasted-child'],
        xml: {text: '<block type="control_repeat"/>'},
        toJson: () => ({type: 'create', blockId: 'pasted-root'})
    }));
    workspace.paste = originalPaste;
    const scratchBlocks = {
        ...ScratchBlocks,
        Events: {getGroup: () => 'clipboard-group'}
    };
    const port = attachStudioBlockCapture({
        workspace,
        vm: {editingTarget: {id: 'sprite-a'}},
        ScratchBlocks: scratchBlocks,
        enabled: true,
        exposeDebug: false,
        defer: callback => deferred.push(callback)
    });
    const wrappedPaste = workspace.paste;

    workspace.paste({tagName: 'block', getAttribute: name => (name === 'id' ? source.id : null)});

    expect(port.getSnapshots()[0].interactionSource).toEqual({
        kind: 'workspace-clipboard',
        sourceBlockRef: {
            ancestorId: 'source-root',
            ancestorType: 'control_repeat',
            ancestorCoordinate: {x: 140, y: 90},
            path: []
        },
        sourceBlockType: 'control_repeat'
    });
    expect(workspace.paste).toBe(wrappedPaste);
    deferred.shift()();
    port.detach();
    expect(workspace.paste).toBe(originalPaste);
});

test('defers list creation until its automatic monitor has been created', () => {
    const workspace = makeWorkspace();
    const deferred = [];
    let monitorVisible = false;
    const port = attachStudioBlockCapture({
        workspace,
        vm: {editingTarget: {id: 'sprite-a'}},
        ScratchBlocks,
        enabled: true,
        exposeDebug: false,
        defer: callback => deferred.push(callback),
        captureVariableDefinition: () => ({
            before: null,
            after: {
                present: true,
                id: 'list-id',
                targetRef: {isStage: true, name: 'Stage'},
                name: 'items',
                value: [],
                monitor: monitorVisible ? {visible: true} : null
            }
        })
    });
    workspace.fire({
        type: 'var_create',
        varId: 'list-id',
        varType: 'list',
        varName: 'items',
        isLocal: false,
        isCloud: false,
        toJson: () => ({type: 'var_create', varId: 'list-id'})
    });

    expect(port.getSnapshots()).toEqual([]);
    monitorVisible = true;
    deferred.shift()();
    expect(port.getSnapshots()[0].details.definition.after.monitor).toEqual({visible: true});
    port.detach();
});

test('records deferred sprite-local scalar variable creation', () => {
    const workspace = makeWorkspace();
    const deferred = [];
    const port = attachStudioBlockCapture({
        workspace,
        vm: {editingTarget: {id: 'sprite-a'}},
        ScratchBlocks,
        enabled: true,
        exposeDebug: false,
        defer: callback => deferred.push(callback),
        captureVariableDefinition: () => null
    });
    workspace.fire({
        type: 'var_create',
        varId: 'cake-id',
        varType: '',
        varName: 'cake',
        isLocal: true,
        isCloud: false,
        toJson: () => ({type: 'var_create', varId: 'cake-id'})
    });

    expect(port.getSnapshots()).toEqual([]);
    deferred.shift()();
    expect(port.getSnapshots()[0]).toMatchObject({
        type: 'var_create',
        details: {
            varId: 'cake-id',
            varName: 'cake',
            isLocal: true,
            definition: null
        }
    });
    port.detach();
});

test('records broadcast creation before its immediate dropdown field change', () => {
    const workspace = makeWorkspace();
    const deferred = [];
    const port = attachStudioBlockCapture({
        workspace,
        vm: {editingTarget: {id: 'sprite-a'}},
        ScratchBlocks,
        enabled: true,
        exposeDebug: false,
        defer: callback => deferred.push(callback),
        captureVariableDefinition: () => null
    });
    workspace.fire({
        type: 'var_create',
        varId: 'message-id',
        varType: 'broadcast_msg',
        varName: 'start game',
        isLocal: false,
        isCloud: false,
        toJson: () => ({type: 'var_create', varId: 'message-id'})
    });

    expect(deferred).toHaveLength(0);
    expect(port.getSnapshots()[0]).toMatchObject({
        type: 'var_create',
        details: {varId: 'message-id', varType: 'broadcast_msg', varName: 'start game'}
    });
    port.detach();
});

test('exposes query-flagged status through a removable hidden DOM element', () => {
    const elements = new Map();
    global.window = {};
    global.document = {
        createElement: () => ({
            dataset: {},
            remove () {
                elements.delete(this.id);
            }
        }),
        body: {
            appendChild: element => elements.set(element.id, element)
        },
        getElementById: id => elements.get(id) || null
    };
    const workspace = makeWorkspace();
    const port = attachStudioBlockCapture({
        workspace,
        vm: {editingTarget: {id: 'sprite-a'}},
        ScratchBlocks,
        enabled: true,
        exposeDebug: true,
        now: () => 700
    });

    workspace.fire(makeChangeEvent());
    const debugElement = document.getElementById(DEBUG_ELEMENT_ID);
    expect(debugElement.hidden).toBe(true);
    expect(debugElement.dataset.snapshotCount).toBe('1');
    expect(JSON.parse(debugElement.textContent).latestSnapshot.targetId).toBe('sprite-a');

    port.detach();
    expect(document.getElementById(DEBUG_ELEMENT_ID)).toBeNull();
    delete global.window;
    delete global.document;
});
