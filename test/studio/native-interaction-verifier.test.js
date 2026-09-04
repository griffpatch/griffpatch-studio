import {verifyInteraction} from '../../src/studio/bridge/native-interaction/interaction-verifier';

const destinationEvent = ({blockId = 'moving', parentId = 'new-parent', inputName = null} = {}) => ({
    type: 'move',
    blockId,
    newParentId: parentId,
    newInputName: inputName,
    group: 'transient-blockly-group',
    toJson () {
        return {
            type: this.type,
            blockId: this.blockId,
            newParentId: this.newParentId,
            newInputName: this.newInputName,
            group: this.group
        };
    }
});

const makeHarness = ({
    observed = [destinationEvent()],
    workspaceMovingParent = 'new-parent',
    vmMovingParent = 'new-parent',
    workspaceCoordinate = {x: 420, y: 180},
    synchronized = true,
    markerVisible = true,
    isolation = {}
} = {}) => {
    let moving;
    const newParent = {
        id: 'new-parent',
        inputList: [{name: null, connection: {targetBlock: () => moving}}]
    };
    moving = {
        id: 'moving',
        getParent: () => (workspaceMovingParent === 'new-parent' ? newParent : null),
        getRelativeToSurfaceXY: () => workspaceCoordinate
    };
    const blocks = new Map([['new-parent', newParent], ['moving', moving]]);
    const workspace = {getBlockById: id => blocks.get(id) || null};
    const vm = {
        editingTarget: {
            blocks: {
                getBlock: id => (id === 'moving' ? {id, parent: vmMovingParent} : null)
            }
        }
    };
    const scope = {
        observed,
        getRevision: () => observed.length,
        verifyIsolation: () => ({
            journalUnchanged: true,
            undoUnchanged: true,
            redoUnchanged: true,
            ...isolation
        })
    };
    const plan = {
        kind: 'existing-block-drag',
        blockId: 'moving',
        destination: {parentId: 'new-parent', inputName: null, coordinate: null},
        affectedBlocks: [{
            blockId: 'moving',
            destination: {parentId: 'new-parent', inputName: null, coordinate: null}
        }]
    };
    const driverEvidence = {
        frames: [{
            pointer: {x: 451, y: 207},
            blockly: synchronized ? {x: 451, y: 207} : {x: 452, y: 207},
            markerVisible
        }]
    };
    return {workspace, vm, scope, plan, driverEvidence};
};

beforeAll(() => {
    global.requestAnimationFrame = callback => callback();
});

afterAll(() => {
    delete global.requestAnimationFrame;
});

test('accepts a fully observed native drag and retains useful normalized evidence', async () => {
    const harness = makeHarness();
    harness.driverEvidence.pointerTravel = {
        model: 'natural',
        target: {id: 'workspace-block:moving', kind: 'workspace-block'}
    };
    const result = await verifyInteraction(harness);

    expect(result.matches).toBe(true);
    expect(result.evidence).toMatchObject({
        synchronizedFrames: true,
        pointerTravel: {
            model: 'natural',
            target: {id: 'workspace-block:moving', kind: 'workspace-block'}
        },
        insertionMarkerRequired: true,
        markerFrameCount: 1,
        workspace: [{blockId: 'moving', matches: true}],
        vm: [{blockId: 'moving', matches: true}],
        isolation: {journalUnchanged: true, undoUnchanged: true, redoUnchanged: true}
    });
    expect(result.evidence.observedEvents).toEqual([{
        type: 'move',
        blockId: 'moving',
        newParentId: 'new-parent',
        newInputName: null
    }]);
});

test('rejects a wrong-zone preview even when the final connection is correct', async () => {
    const harness = makeHarness();
    harness.driverEvidence.frames[0].previewTargetMatches = false;
    const result = await verifyInteraction(harness);
    expect(result.matches).toBe(false);
    expect(result.evidence.intendedPreviewOnly).toBe(false);
});

test('rejects a split-root drag when the stationary remainder was picked up too', async () => {
    const harness = makeHarness();
    harness.plan = {
        ...harness.plan,
        blockId: 'root',
        splitSourceRoot: true,
        affectedBlocks: [{
            blockId: 'root',
            source: {parentId: null, coordinate: {x: 420, y: 180}},
            destination: {parentId: 'new-parent', inputName: null, coordinate: null}
        }, {
            blockId: 'remainder',
            source: {parentId: 'root', inputName: null, coordinate: null},
            destination: {parentId: null, inputName: null, coordinate: {x: 420, y: 228}}
        }]
    };
    harness.workspace.getBlockById = id => ({
        root: {id: 'root', getParent: () => ({id: 'new-parent'})},
        remainder: {
            id: 'remainder',
            getParent: () => null,
            getRelativeToSurfaceXY: () => ({x: 420, y: 228})
        },
        'new-parent': {
            id: 'new-parent',
            inputList: [{name: null, connection: {targetBlock: () => ({id: 'root'})}}]
        }
    }[id] || null);
    harness.vm.editingTarget.blocks.getBlock = id => ({
        root: {id: 'root', parent: 'new-parent'},
        remainder: {id: 'remainder', parent: null, x: 420, y: 228}
    }[id] || null);
    harness.scope.observed = [destinationEvent({blockId: 'root'})];
    harness.driverEvidence.draggedBlockIds = ['root', 'remainder'];

    const result = await verifyInteraction(harness);

    expect(result.matches).toBe(false);
    expect(result.evidence).toMatchObject({
        draggedBlockIds: ['root', 'remainder'],
        stationaryRemainderIds: ['remainder'],
        isolatedPickup: false
    });
});

test('verifies a visibly opened dropdown through its emitted language-neutral field value', async () => {
    const observed = [{
        toJson: () => ({
            type: 'change',
            blockId: 'point-block',
            element: 'field',
            name: 'TOWARDS',
            oldValue: '_mouse_',
            newValue: '_random_'
        })
    }];
    const isolation = {journalUnchanged: true, undoUnchanged: true, redoUnchanged: true};
    const result = await verifyInteraction({
        workspace: {
            getBlockById: () => ({getField: () => ({getValue: () => '_random_'})})
        },
        vm: {
            editingTarget: {
                blocks: {
                    getBlock: () => ({fields: {TOWARDS: {value: '_random_'}}})
                }
            }
        },
        plan: {
            kind: 'block-field-edit',
            blockId: 'point-block',
            fieldName: 'TOWARDS',
            value: '_random_'
        },
        scope: {
            observed,
            getRevision: () => observed.length,
            verifyIsolation: () => isolation
        },
        driverEvidence: {
            menuVisibleBeforeClick: true,
            optionIndex: 1,
            optionValue: '_random_',
            pointerTravel: {model: 'natural', target: {kind: 'dropdown-option'}}
        }
    });

    expect(result.matches).toBe(true);
    expect(result.evidence).toMatchObject({
        menuVisibleBeforeClick: true,
        optionIndex: 1,
        optionValue: '_random_',
        workspace: {matches: true, actual: '_random_'},
        vm: {matches: true, actual: '_random_'},
        isolation,
        pointerTravel: {model: 'natural', target: {kind: 'dropdown-option'}}
    });
});

test('verifies variable dropdowns through the Blockly ID and VM name-plus-ID contract', async () => {
    const variable = {name: 'cake', type: '', getId: () => 'variable-cake'};
    const observed = [{toJson: () => ({
        type: 'change',
        blockId: 'change-cake',
        element: 'field',
        name: 'VARIABLE',
        oldValue: 'old-variable',
        newValue: 'variable-cake'
    })}];
    const isolation = {journalUnchanged: true, undoUnchanged: true, redoUnchanged: true};
    const result = await verifyInteraction({
        workspace: {
            getBlockById: () => ({
                getField: () => ({
                    getValue: () => 'variable-cake',
                    getVariable: () => variable
                })
            })
        },
        vm: {
            editingTarget: {
                blocks: {
                    getBlock: () => ({fields: {VARIABLE: {value: 'cake', id: 'variable-cake'}}})
                }
            }
        },
        plan: {
            kind: 'block-field-edit',
            blockId: 'change-cake',
            fieldName: 'VARIABLE',
            value: 'variable-cake'
        },
        scope: {
            observed,
            getRevision: () => observed.length,
            verifyIsolation: () => isolation
        },
        driverEvidence: {
            menuVisibleBeforeClick: true,
            optionIndex: 0,
            optionValue: 'variable-cake',
            pointerTravel: {completed: true, model: 'natural', target: {kind: 'dropdown-option'}}
        }
    });

    expect(result.matches).toBe(true);
    expect(result.evidence).toMatchObject({
        workspace: {
            actual: 'variable-cake',
            variable: {id: 'variable-cake', name: 'cake', type: ''},
            matches: true
        },
        vm: {
            actual: 'cake',
            id: 'variable-cake',
            expected: {value: 'cake', id: 'variable-cake'},
            matches: true
        }
    });
});

test('rejects a variable dropdown when the VM name matches but its stable ID does not', async () => {
    const variable = {name: 'cake', type: '', getId: () => 'variable-cake'};
    const observed = [{toJson: () => ({
        type: 'change',
        blockId: 'change-cake',
        element: 'field',
        name: 'VARIABLE',
        newValue: 'variable-cake'
    })}];
    const result = await verifyInteraction({
        workspace: {
            getBlockById: () => ({
                getField: () => ({getValue: () => 'variable-cake', getVariable: () => variable})
            })
        },
        vm: {
            editingTarget: {
                blocks: {
                    getBlock: () => ({fields: {VARIABLE: {value: 'cake', id: 'different-variable'}}})
                }
            }
        },
        plan: {
            kind: 'block-field-edit',
            blockId: 'change-cake',
            fieldName: 'VARIABLE',
            value: 'variable-cake'
        },
        scope: {
            observed,
            getRevision: () => observed.length,
            verifyIsolation: () => ({journalUnchanged: true, undoUnchanged: true, redoUnchanged: true})
        },
        driverEvidence: {
            menuVisibleBeforeClick: true,
            pointerTravel: {completed: true}
        }
    });

    expect(result.matches).toBe(false);
    expect(result.evidence.vm).toMatchObject({actual: 'cake', id: 'different-variable', matches: false});
});

test('verifies paced inline text editing through the same field contract', async () => {
    const observed = [{toJson: () => ({
        type: 'change',
        blockId: 'text-block',
        element: 'field',
        name: 'TEXT',
        oldValue: '',
        newValue: 'smoke'
    })}];
    const result = await verifyInteraction({
        workspace: {getBlockById: () => ({getField: () => ({getValue: () => 'smoke'})})},
        vm: {editingTarget: {blocks: {getBlock: () => ({fields: {TEXT: {value: 'smoke'}}})}}},
        plan: {kind: 'block-field-edit', blockId: 'text-block', fieldName: 'TEXT', value: 'smoke'},
        scope: {
            observed,
            getRevision: () => observed.length,
            verifyIsolation: () => ({journalUnchanged: true, undoUnchanged: true, redoUnchanged: true})
        },
        driverEvidence: {
            interactionKind: 'text-input',
            editorVisibleBeforeCommit: true,
            intermediateValues: ['s', 'sm', 'smo', 'smok', 'smoke'],
            pointerTravel: {completed: true, model: 'natural', target: {kind: 'block-field'}}
        }
    });

    expect(result.matches).toBe(true);
    expect(result.evidence).toMatchObject({
        interactionKind: 'text-input',
        editorVisibleBeforeCommit: true,
        workspace: {matches: true},
        vm: {matches: true}
    });
});

test('verifies block-comment text through its live block ownership and Blockly newContents event', async () => {
    const comment = {id: 'comment-1', blockId: 'live-block', getText: () => 'Explain this'};
    const block = {id: 'live-block', comment};
    const observed = [{
        type: 'comment_change',
        commentId: 'comment-1',
        blockId: 'live-block',
        newContents_: {text: 'Explain this'},
        toJson: () => ({
            type: 'comment_change',
            commentId: 'comment-1',
            blockId: 'live-block',
            newContents: {text: 'Explain this'}
        })
    }];
    const result = await verifyInteraction({
        workspace: {
            getBlockById: id => id === 'live-block' ? block : null,
            getCommentById: id => id === 'comment-1' ? comment : null
        },
        vm: {},
        plan: {
            kind: 'block-comment-text',
            blockId: 'recorded-block',
            commentId: 'comment-1',
            text: 'Explain this'
        },
        scope: {
            observed,
            getRevision: () => observed.length,
            verifyIsolation: () => ({journalUnchanged: true, undoUnchanged: true, redoUnchanged: true})
        },
        driverEvidence: {
            resolvedBlockId: 'live-block',
            controlsVisible: true,
            commentMatches: true,
            pointerTravel: {completed: true}
        }
    });

    expect(result.matches).toBe(true);
    expect(result.evidence).toMatchObject({
        resolvedBlockId: 'live-block',
        workspaceMatches: true,
        observedEvents: [{
            type: 'comment_change',
            commentId: 'comment-1',
            blockId: 'live-block',
            newContents: {text: 'Explain this'}
        }]
    });
});

test.each([
    {
        name: 'minimize',
        plan: {kind: 'block-comment-minimize', minimized: true},
        comment: {isMinimized_: true},
        event: {type: 'comment_change', newContents: {minimized: true}},
        state: {minimized: true}
    },
    {
        name: 'resize',
        plan: {kind: 'block-comment-resize', size: {width: 240, height: 180}},
        comment: {getHeightWidth: () => ({width: 240, height: 180})},
        event: {type: 'comment_change', newContents: {width: 240, height: 180}},
        state: {width: 240, height: 180}
    },
    {
        name: 'move',
        plan: {kind: 'block-comment-move', destination: {x: 220, y: 160}},
        comment: {getXY: () => ({x: 220, y: 160})},
        event: {type: 'comment_move', newCoordinate: '220,160'},
        state: {x: 220, y: 160}
    }
])('verifies a native block-comment $name event and resulting workspace state', async ({
    plan,
    comment: commentFields,
    event,
    state
}) => {
    const comment = {id: 'comment-1', blockId: 'live-block', ...commentFields};
    const block = {id: 'live-block', comment};
    const observed = [{
        ...event,
        commentId: 'comment-1',
        blockId: 'live-block',
        newContents_: event.newContents,
        newCoordinate_: event.newCoordinate,
        toJson: () => ({
            ...event,
            commentId: 'comment-1',
            blockId: 'live-block'
        })
    }];
    const result = await verifyInteraction({
        workspace: {
            getBlockById: id => id === 'live-block' ? block : null,
            getCommentById: id => id === 'comment-1' ? comment : null
        },
        vm: {},
        plan: {
            ...plan,
            blockId: 'recorded-block',
            commentId: 'comment-1'
        },
        scope: {
            observed,
            getRevision: () => observed.length,
            verifyIsolation: () => ({journalUnchanged: true, undoUnchanged: true, redoUnchanged: true})
        },
        driverEvidence: {
            resolvedBlockId: 'live-block',
            controlsVisible: true,
            commentMatches: true,
            pointerTravel: {completed: true, model: 'natural'}
        }
    });

    expect(result.matches).toBe(true);
    expect(result.evidence).toMatchObject({
        resolvedBlockId: 'live-block',
        workspaceMatches: true,
        commentState: state
    });
});

test.each([
    {
        name: 'create',
        plan: {
            kind: 'workspace-comment-create',
            coordinate: {x: 180, y: 120},
            size: {width: 200, height: 200},
            minimized: false
        },
        event: {type: 'comment_create'},
        state: {
            text: '',
            minimized: false,
            size: {width: 200, height: 200},
            coordinate: {x: 180, y: 120}
        }
    },
    {
        name: 'text',
        plan: {kind: 'workspace-comment-text', text: 'Scene note'},
        event: {type: 'comment_change', newContents: {text: 'Scene note'}},
        state: {text: 'Scene note'}
    },
    {
        name: 'minimize',
        plan: {kind: 'workspace-comment-minimize', minimized: true},
        event: {type: 'comment_change', newContents: {minimized: true}},
        state: {minimized: true}
    },
    {
        name: 'resize',
        plan: {kind: 'workspace-comment-resize', size: {width: 280, height: 250}},
        event: {type: 'comment_change', newContents: {width: 280, height: 250}},
        state: {width: 280, height: 250}
    },
    {
        name: 'move',
        plan: {kind: 'workspace-comment-move', destination: {x: 260, y: 170}},
        event: {type: 'comment_move', newCoordinate: '260,170'},
        state: {x: 260, y: 170}
    }
])('verifies a native workspace-comment $name event and live state', async ({plan, event, state}) => {
    const comment = {
        id: 'workspace-comment-1',
        blockId: null,
        getText: () => plan.text || '',
        isMinimized: () => Boolean(plan.minimized),
        getHeightWidth: () => plan.size || {width: 200, height: 200},
        getXY: () => plan.coordinate || plan.destination || {x: 180, y: 120}
    };
    const observed = [{
        ...event,
        commentId: comment.id,
        blockId: null,
        newContents_: event.newContents,
        newCoordinate_: event.newCoordinate,
        toJson: () => ({...event, commentId: comment.id, blockId: null})
    }];
    const result = await verifyInteraction({
        workspace: {
            getCommentById: id => id === comment.id ? comment : null
        },
        vm: {},
        plan: {
            ...plan,
            commentOwner: 'workspace',
            commentId: comment.id
        },
        scope: {
            observed,
            getRevision: () => observed.length,
            verifyIsolation: () => ({journalUnchanged: true, undoUnchanged: true, redoUnchanged: true})
        },
        driverEvidence: {
            controlsVisible: true,
            commentMatches: true,
            pointerTravel: {completed: true, model: 'natural'}
        }
    });

    expect(result.matches).toBe(true);
    expect(result.evidence).toMatchObject({
        resolvedBlockId: null,
        workspaceMatches: true,
        commentState: state
    });
});

test('verifies native workspace-comment deletion without requiring a block owner', async () => {
    const observed = [{toJson: () => ({
        type: 'comment_delete',
        commentId: 'workspace-comment-1',
        blockId: null
    })}];
    const result = await verifyInteraction({
        workspace: {getCommentById: () => null},
        vm: {},
        plan: {
            kind: 'workspace-comment-delete',
            commentOwner: 'workspace',
            commentId: 'workspace-comment-1'
        },
        scope: {
            observed,
            getRevision: () => observed.length,
            verifyIsolation: () => ({journalUnchanged: true, undoUnchanged: true, redoUnchanged: true})
        },
        driverEvidence: {
            controlsVisible: true,
            commentMatches: true,
            pointerTravel: {completed: true}
        }
    });

    expect(result.matches).toBe(true);
    expect(result.evidence).toMatchObject({resolvedBlockId: null, workspaceMatches: true});
});

test('rejects a comment event or model attached to a different live block', async () => {
    const comment = {id: 'comment-1', blockId: 'other-block', getText: () => 'Explain this'};
    const block = {id: 'live-block', comment};
    const observed = [{toJson: () => ({
        type: 'comment_change',
        commentId: 'comment-1',
        blockId: 'other-block',
        newContents: {text: 'Explain this'}
    })}];
    const result = await verifyInteraction({
        workspace: {
            getBlockById: () => block,
            getCommentById: () => comment
        },
        vm: {},
        plan: {
            kind: 'block-comment-text',
            blockId: 'recorded-block',
            commentId: 'comment-1',
            text: 'Explain this'
        },
        scope: {
            observed,
            getRevision: () => observed.length,
            verifyIsolation: () => ({journalUnchanged: true, undoUnchanged: true, redoUnchanged: true})
        },
        driverEvidence: {
            resolvedBlockId: 'live-block',
            controlsVisible: true,
            commentMatches: true,
            pointerTravel: {completed: true}
        },
        timeoutMs: 0
    });

    expect(result.matches).toBe(false);
    expect(result.evidence.workspaceMatches).toBe(false);
});

test('verifies a real variable prompt against its event, workspace, VM owner and typed evidence', async () => {
    const variable = {
        id: 'live-cake',
        name: 'cake',
        type: '',
        isLocal: true,
        isCloud: false,
        getId: () => 'live-cake'
    };
    const observed = [{
        toJson: () => ({
            type: 'var_create',
            varId: 'live-cake',
            varName: 'cake',
            varType: '',
            isLocal: true,
            isCloud: false
        })
    }];
    const isolation = {journalUnchanged: true, undoUnchanged: true, redoUnchanged: true};
    const result = await verifyInteraction({
        workspace: {getVariableById: id => (id === 'live-cake' ? variable : null)},
        vm: {
            runtime: {
                targets: [{
                    id: 'sprite-a',
                    isStage: false,
                    variables: {
                        'live-cake': {id: 'live-cake', name: 'cake', type: '', isCloud: false}
                    }
                }]
            }
        },
        plan: {
            kind: 'variable-create-dialog',
            targetId: 'sprite-a',
            recordedVarId: 'recorded-cake',
            varId: 'live-cake',
            varName: 'cake',
            varType: '',
            isLocal: true,
            isCloud: false
        },
        scope: {
            observed,
            getRevision: () => observed.length,
            verifyIsolation: () => isolation
        },
        driverEvidence: {
            dialogVisibleBeforeSubmit: true,
            flyoutRefreshSettled: true,
            intermediateValues: ['c', 'ca', 'cak', 'cake'],
            selectedBeforeSubmit: {local: true, global: false, cloud: false},
            pointerTravel: {model: 'natural', target: {kind: 'dialog-confirm'}}
        }
    });

    expect(result.matches).toBe(true);
    expect(result.evidence).toMatchObject({
        dialogVisibleBeforeSubmit: true,
        intermediateValues: ['c', 'ca', 'cak', 'cake'],
        selectedBeforeSubmit: {local: true, global: false, cloud: false},
        workspace: {matches: true, actual: {id: 'live-cake', name: 'cake'}},
        vm: {matches: true, actual: {ownerId: 'sprite-a', ownerIsStage: false}},
        isolation
    });
});

test('accepts the durable sprite reference when restoration replaced the recorded runtime ID', async () => {
    const variable = {
        id: 'live-cake',
        name: 'cake',
        type: '',
        isLocal: true,
        isCloud: false,
        getId: () => 'live-cake'
    };
    const observed = [{toJson: () => ({
        type: 'var_create',
        varId: 'live-cake',
        varName: 'cake',
        varType: '',
        isLocal: true,
        isCloud: false
    })}];
    const result = await verifyInteraction({
        workspace: {getVariableById: () => variable},
        vm: {runtime: {targets: [{
            id: 'restored-sprite-id',
            isStage: false,
            getName: () => 'Sprite1',
            variables: {'live-cake': variable}
        }]}},
        plan: {
            kind: 'variable-create-dialog',
            targetId: 'recorded-sprite-id',
            targetRef: {name: 'Sprite1', isStage: false},
            varId: 'live-cake',
            varName: 'cake',
            varType: '',
            isLocal: true,
            isCloud: false
        },
        scope: {
            observed,
            getRevision: () => observed.length,
            verifyIsolation: () => ({journalUnchanged: true, undoUnchanged: true, redoUnchanged: true})
        },
        driverEvidence: {
            dialogVisibleBeforeSubmit: true,
            flyoutRefreshSettled: true,
            intermediateValues: ['cake'],
            selectedBeforeSubmit: {local: true, global: false, cloud: false}
        }
    });

    expect(result.matches).toBe(true);
    expect(result.evidence.vm).toMatchObject({
        ownerName: 'Sprite1',
        actual: {ownerId: 'restored-sprite-id'},
        matches: true
    });
});

test('verifies a variable rename authored through its dropdown and prompt', async () => {
    const variable = {id: 'cake-id', name: 'cupcake', type: '', getId: () => 'cake-id'};
    const workspace = {getVariableById: () => variable};
    variable.workspace = workspace;
    const observed = [{toJson: () => ({
        type: 'var_rename',
        varId: 'cake-id',
        oldName: 'cake',
        newName: 'cupcake'
    })}];
    const result = await verifyInteraction({
        workspace,
        vm: {runtime: {targets: [{variables: {'cake-id': variable}}]}},
        plan: {
            kind: 'variable-rename-dialog',
            varId: 'cake-id',
            varType: '',
            oldName: 'cake',
            newName: 'cupcake'
        },
        scope: {
            observed,
            getRevision: () => observed.length,
            verifyIsolation: () => ({journalUnchanged: true, undoUnchanged: true, redoUnchanged: true})
        },
        driverEvidence: {
            menuVisibleBeforeClick: true,
            dialogVisibleBeforeSubmit: true,
            intermediateValues: ['c', 'cu', 'cupcake'],
            pointerTravel: {completed: true}
        }
    });

    expect(result.matches).toBe(true);
    expect(result.evidence).toMatchObject({
        menuVisibleBeforeClick: true,
        workspace: {
            variable: {id: 'cake-id', name: 'cupcake', type: ''},
            matches: true
        },
        vm: {ownerCount: 1, matches: true}
    });
    expect(() => JSON.stringify(result)).not.toThrow();
});

test('verifies confirmed variable deletion and every disposed use', async () => {
    const observed = [{toJson: () => ({
        type: 'var_delete',
        varId: 'cake-id',
        varName: 'cake',
        varType: ''
    })}];
    const result = await verifyInteraction({
        workspace: {
            getVariableById: () => null,
            getBlockById: () => null
        },
        vm: {runtime: {targets: [{variables: {}, blocks: {getBlock: () => null}}]}},
        plan: {
            kind: 'variable-delete-dropdown',
            varId: 'cake-id',
            varName: 'cake',
            varType: '',
            deletedBlocks: [{blockId: 'set-cake', blockIds: ['set-cake', 'shadow-1']}]
        },
        scope: {
            observed,
            getRevision: () => observed.length,
            verifyIsolation: () => ({journalUnchanged: true, undoUnchanged: true, redoUnchanged: true})
        },
        driverEvidence: {
            menuVisibleBeforeClick: true,
            useCount: 2,
            confirmationRequired: true,
            confirmationVisibleBeforeSubmit: true,
            pointerTravel: {completed: true}
        }
    });

    expect(result.matches).toBe(true);
    expect(result.evidence).toMatchObject({
        confirmationRequired: true,
        deletedBlocks: {workspaceAbsent: true, vmAbsent: true}
    });
});

test('verifies broadcast creation, selected field, typed prompt and VM stage definition', async () => {
    const variable = {
        id: 'message-id',
        name: 'start game',
        type: 'broadcast_msg',
        getId: () => 'message-id'
    };
    const field = {getValue: () => 'message-id'};
    const observed = [{toJson: () => ({
        type: 'var_create',
        varId: 'message-id',
        varName: 'start game',
        varType: 'broadcast_msg',
        isLocal: false,
        isCloud: false
    })}, {toJson: () => ({
        type: 'change',
        blockId: 'broadcast-menu',
        element: 'field',
        name: 'BROADCAST_OPTION',
        oldValue: 'old-message',
        newValue: 'message-id'
    })}];
    const stageVariable = {id: 'message-id', name: 'start game', type: 'broadcast_msg'};
    const stage = {isStage: true, variables: {'message-id': stageVariable}};
    const isolation = {journalUnchanged: true, undoUnchanged: true, redoUnchanged: true};
    const result = await verifyInteraction({
        workspace: {
            getVariableById: id => id === 'message-id' ? variable : null,
            getBlockById: id => id === 'broadcast-menu' ? {getField: () => field} : null
        },
        vm: {
            runtime: {getTargetForStage: () => stage},
            editingTarget: {
                blocks: {
                    getBlock: () => ({fields: {BROADCAST_OPTION: {value: 'start game', id: 'message-id'}}})
                }
            }
        },
        plan: {
            kind: 'broadcast-create-dialog',
            blockId: 'broadcast-menu',
            fieldName: 'BROADCAST_OPTION',
            sourceValue: 'old-message',
            value: 'message-id',
            varId: 'message-id',
            varName: 'start game',
            varType: 'broadcast_msg',
            isLocal: false,
            isCloud: false
        },
        scope: {
            observed,
            getRevision: () => observed.length,
            verifyIsolation: () => isolation
        },
        driverEvidence: {
            menuVisibleBeforeClick: true,
            dialogVisibleBeforeSubmit: true,
            intermediateValues: ['s', 'start game'],
            pointerTravel: {completed: true, model: 'natural', target: {kind: 'dialog-confirm'}}
        }
    });

    expect(result.matches).toBe(true);
    expect(result.evidence).toMatchObject({
        menuVisibleBeforeClick: true,
        dialogVisibleBeforeSubmit: true,
        workspace: {matches: true, fieldValue: 'message-id'},
        vm: {matches: true, fieldValue: 'start game', fieldId: 'message-id'},
        isolation
    });
});

test('verifies the real custom procedure event pair, mutation, VM blocks and typed dialog evidence', async () => {
    const ids = ['definition', 'prototype', 'argument'];
    const mutation = {
        getAttribute: name => ({
            proccode: 'bake %s',
            argumentids: '["argument-id"]',
            argumentnames: '["height"]',
            argumentdefaults: '[""]',
            warp: 'false'
        })[name]
    };
    const blocks = new Map(ids.map(id => [id, {id}]));
    blocks.set('definition', {
        id: 'definition',
        getRelativeToSurfaceXY: () => ({x: 44, y: 44}),
        getInputTargetBlock: name => name === 'custom_block' ? {mutationToDom: () => mutation} : null
    });
    const observed = [{
        type: 'create',
        blockId: 'definition',
        toJson: () => ({type: 'create', blockId: 'definition', ids})
    }, {
        type: 'move',
        blockId: 'definition',
        newCoordinate: '31,31',
        toJson: () => ({type: 'move', blockId: 'definition', newCoordinate: '31,31'})
    }, {
        type: 'move',
        blockId: 'definition',
        newCoordinate: '44,44',
        toJson: () => ({type: 'move', blockId: 'definition', newCoordinate: '44,44'})
    }];
    const isolation = {journalUnchanged: true, undoUnchanged: true, redoUnchanged: true};
    const definition = {
        proccode: 'bake %s',
        argumentIds: ['argument-id'],
        argumentNames: ['height'],
        argumentDefaults: [''],
        warp: false,
        parts: [
            {kind: 'label', value: 'bake'},
            {kind: 'text-number', id: 'argument-id', value: 'height', defaultValue: ''}
        ]
    };

    const result = await verifyInteraction({
        workspace: {getBlockById: id => blocks.get(id) || null},
        vm: {editingTarget: {blocks: {getBlock: id => blocks.get(id) || null}}},
        plan: {
            kind: 'custom-procedure-dialog',
            blockId: 'definition',
            blockIds: ids,
            destination: {parentId: null, inputName: null, coordinate: {x: 44, y: 44}}
        },
        scope: {
            observed,
            getRevision: () => observed.length,
            verifyIsolation: () => isolation
        },
        driverEvidence: {
            dialogVisibleBeforeSubmit: true,
            flyoutRefreshSettled: true,
            definition,
            typedValues: [
                {kind: 'label', value: 'bake', intermediateValues: ['b', 'bake']},
                {kind: 'text-number', value: 'height', intermediateValues: ['h', 'height']}
            ],
            pointerTravel: {model: 'natural', target: {kind: 'dialog-confirm'}}
        }
    });

    expect(result.matches).toBe(true);
    expect(result.evidence).toMatchObject({
        dialogVisibleBeforeSubmit: true,
        workspace: {matches: true, actual: {ids, coordinate: {x: 44, y: 44}}},
        vm: {matches: true, actualIds: ids},
        isolation
    });
});

test('verifies a real built-in sprite library selection before checkpoint normalization', async () => {
    const isolation = {journalUnchanged: true, undoUnchanged: false, redoUnchanged: false};
    const result = await verifyInteraction({
        workspace: {},
        vm: {runtime: {targets: []}},
        plan: {
            kind: 'sprite-library-select',
            libraryItem: {name: 'Apple', md5ext: 'apple.svg'},
            targetRef: {name: 'Apple', isStage: false}
        },
        scope: {verifyIsolation: () => isolation},
        driverEvidence: {
            libraryVisibleBeforeSelect: true,
            selectedLibraryItem: {name: 'Apple', md5ext: 'apple.svg'},
            createdTarget: {id: 'live-apple', name: 'Apple', isStage: false},
            pointerTravel: {completed: true, model: 'natural'}
        }
    });

    expect(result.matches).toBe(true);
    expect(result.evidence).toMatchObject({projectMatches: true, isolation});
});

test('verifies a built-in costume library addition on its durable sprite', async () => {
    const isolation = {journalUnchanged: true, undoUnchanged: false, redoUnchanged: false};
    const result = await verifyInteraction({
        workspace: {},
        vm: {editingTarget: {isStage: false, getName: () => 'Sprite1'}},
        plan: {
            kind: 'costume-library-select',
            libraryItem: {name: 'Arrow1-a', md5ext: 'arrow.svg'},
            targetRef: {name: 'Sprite1', isStage: false},
            addedCostume: {name: 'Arrow1-a', assetId: 'arrow', dataFormat: 'svg'}
        },
        scope: {verifyIsolation: () => isolation},
        driverEvidence: {
            libraryVisibleBeforeSelect: true,
            selectedLibraryItem: {name: 'Arrow1-a', md5ext: 'arrow.svg'},
            addedCostume: {name: 'Arrow1-a', assetId: 'arrow', dataFormat: 'svg'},
            addedCostumeMatches: true,
            pointerTravel: {completed: true, model: 'natural'}
        }
    });

    expect(result.matches).toBe(true);
    expect(result.evidence).toMatchObject({projectMatches: true, isolation});
});

test('verifies a built-in backdrop library addition on the Stage', async () => {
    const isolation = {journalUnchanged: true, undoUnchanged: false, redoUnchanged: false};
    const result = await verifyInteraction({
        workspace: {},
        vm: {editingTarget: {isStage: true, getName: () => 'Stage'}},
        plan: {
            kind: 'backdrop-library-select',
            libraryItem: {name: 'Blue Sky', md5ext: 'blue-sky.svg'},
            targetRef: {name: 'Stage', isStage: true},
            addedCostume: {name: 'Blue Sky', assetId: 'blue-sky', dataFormat: 'svg'}
        },
        scope: {verifyIsolation: () => isolation},
        driverEvidence: {
            libraryVisibleBeforeSelect: true,
            selectedLibraryItem: {name: 'Blue Sky', md5ext: 'blue-sky.svg'},
            addedCostume: {name: 'Blue Sky', assetId: 'blue-sky', dataFormat: 'svg'},
            addedCostumeMatches: true,
            pointerTravel: {completed: true, model: 'natural'}
        }
    });

    expect(result.matches).toBe(true);
    expect(result.evidence).toMatchObject({projectMatches: true, isolation});
});

test('verifies a built-in sound library addition on its durable sprite', async () => {
    const isolation = {journalUnchanged: true, undoUnchanged: false, redoUnchanged: false};
    const result = await verifyInteraction({
        workspace: {},
        vm: {editingTarget: {isStage: false, getName: () => 'Sprite1'}},
        plan: {
            kind: 'sound-library-select',
            libraryItem: {name: 'Meow', md5ext: 'meow.wav'},
            targetRef: {name: 'Sprite1', isStage: false},
            addedSound: {
                name: 'Meow',
                assetId: 'meow',
                dataFormat: 'wav',
                rate: 48000,
                sampleCount: 96000
            }
        },
        scope: {verifyIsolation: () => isolation},
        driverEvidence: {
            libraryVisibleBeforeSelect: true,
            selectedLibraryItem: {name: 'Meow', md5ext: 'meow.wav'},
            addedSound: {
                name: 'Meow',
                assetId: 'meow',
                dataFormat: 'wav',
                rate: 48000,
                sampleCount: 96000
            },
            addedSoundMatches: true,
            pointerTravel: {completed: true, model: 'natural'}
        }
    });

    expect(result.matches).toBe(true);
    expect(result.evidence).toMatchObject({projectMatches: true, isolation});
});

test('verifies a recorded sound effect against the edited asset', async () => {
    const isolation = {journalUnchanged: true, undoUnchanged: true, redoUnchanged: true};
    const result = await verifyInteraction({
        workspace: {},
        vm: {editingTarget: {isStage: false, getName: () => 'Sprite1'}},
        plan: {
            kind: 'sound-effect-click',
            targetRef: {name: 'Sprite1', isStage: false},
            editedSound: {name: 'Meow', assetId: 'fast', dataFormat: 'wav'}
        },
        scope: {verifyIsolation: () => isolation},
        driverEvidence: {
            selectedSound: {name: 'Meow', assetId: 'meow', dataFormat: 'wav'},
            selectedSoundMatches: true,
            soundVisibleBeforeSelect: true,
            effectVisibleBeforeClick: true,
            editedSound: {name: 'Meow', assetId: 'fast', dataFormat: 'wav'},
            editedSoundMatches: true,
            pointerTravel: {completed: true, model: 'natural'}
        }
    });

    expect(result.matches).toBe(true);
    expect(result.evidence).toMatchObject({projectMatches: true, isolation});
});

test('verifies a recorded sound upload against its exact imported asset', async () => {
    const isolation = {journalUnchanged: true, undoUnchanged: true, redoUnchanged: true};
    const result = await verifyInteraction({
        workspace: {},
        vm: {editingTarget: {isStage: false, getName: () => 'Sprite1'}},
        plan: {
            kind: 'sound-file-upload',
            targetRef: {name: 'Sprite1', isStage: false},
            uploadFile: {name: 'Sneaker'},
            addedSound: {name: 'Sneaker', assetId: 'sneaker', dataFormat: 'wav'}
        },
        scope: {verifyIsolation: () => isolation},
        driverEvidence: {
            uploadControlVisible: true,
            fileInputReady: true,
            addedSound: {name: 'Sneaker', assetId: 'sneaker', dataFormat: 'wav'},
            addedSoundMatches: true,
            pointerTravel: {completed: true, model: 'natural'}
        }
    });

    expect(result.matches).toBe(true);
    expect(result.evidence).toMatchObject({projectMatches: true, isolation});
});

test.each([
    {name: 'hidden upload control', evidence: {
        uploadControlVisible: false, fileInputReady: true, addedSoundMatches: true
    }},
    {name: 'missing file input', evidence: {
        uploadControlVisible: true, fileInputReady: false, addedSoundMatches: true
    }},
    {name: 'wrong imported asset', evidence: {
        uploadControlVisible: true, fileInputReady: true, addedSoundMatches: false
    }}
])('rejects a sound upload with $name', async ({evidence}) => {
    const result = await verifyInteraction({
        workspace: {},
        vm: {editingTarget: {isStage: false, getName: () => 'Sprite1'}},
        plan: {
            kind: 'sound-file-upload',
            targetRef: {name: 'Sprite1', isStage: false},
            uploadFile: {name: 'Sneaker'},
            addedSound: {name: 'Sneaker', assetId: 'sneaker', dataFormat: 'wav'}
        },
        scope: {verifyIsolation: () => ({journalUnchanged: true})},
        driverEvidence: {
            ...evidence,
            pointerTravel: {completed: true, model: 'natural'}
        }
    });

    expect(result.matches).toBe(false);
});

test.each([
    'sprite-reorder-drag',
    'cross-sprite-script-drag',
    'backpack-script-drag',
    'sprite-duplicate-click',
    'sprite-rename-input',
    'sprite-delete-click',
    'costume-duplicate-click',
    'costume-rename-input',
    'costume-delete-click',
    'costume-reorder-drag',
    'backdrop-duplicate-click',
    'backdrop-rename-input',
    'backdrop-delete-click',
    'backdrop-reorder-drag'
])(
    'verifies an exact isolated %s project gesture',
    async kind => {
        const isolation = {journalUnchanged: true, undoUnchanged: true, redoUnchanged: true};
        const result = await verifyInteraction({
            workspace: {},
            vm: {},
            plan: {kind},
            scope: {verifyIsolation: () => isolation},
            driverEvidence: {
                frames: [{x: 10, y: 20, width: 120, height: 160}, {x: 500, y: 400, width: 120, height: 160}],
                controlsVisible: true,
                projectMatches: true,
                pointerTravel: {completed: true, model: 'natural'}
            }
        });

        expect(result.matches).toBe(true);
        expect(result.evidence).toMatchObject({projectMatches: true, isolation});
    }
);

test('rejects a cross-sprite replay that moves only the pointer', async () => {
    const result = await verifyInteraction({workspace: {}, vm: {}, plan: {kind: 'cross-sprite-script-drag'},
        scope: {verifyIsolation: () => ({journalUnchanged: true, undoUnchanged: true, redoUnchanged: true})},
        driverEvidence: {controlsVisible: true, projectMatches: true, pointerTravel: {completed: true},
            frames: [{x: 10, y: 20, width: 120, height: 160}, {x: 10, y: 20, width: 120, height: 160}]}});
    expect(result.matches).toBe(false);
    expect(result.evidence.stackMoved).toBe(false);
});

test.each([
    ['hidden controls', {controlsVisible: false, projectMatches: true}],
    ['wrong project result', {controlsVisible: true, projectMatches: false}],
    ['incomplete pointer', {controlsVisible: true, projectMatches: true, pointerTravel: {completed: false}}],
    ['Undo pollution', {controlsVisible: true, projectMatches: true}, {undoUnchanged: false}]
])('rejects a target-operation gesture with %s', async (_name, evidence, isolationOverride = {}) => {
    const result = await verifyInteraction({
        workspace: {},
        vm: {},
        plan: {kind: 'sprite-reorder-drag'},
        scope: {verifyIsolation: () => ({
            journalUnchanged: true,
            undoUnchanged: true,
            redoUnchanged: true,
            ...isolationOverride
        })},
        driverEvidence: {
            pointerTravel: {completed: true},
            ...evidence
        }
    });

    expect(result.matches).toBe(false);
});

test.each([
    ['missing destination event', {observed: [destinationEvent({parentId: 'wrong-parent'})]},
        evidence => expect(evidence.observedEvents[0].newParentId).toBe('wrong-parent')],
    ['workspace topology mismatch', {workspaceMovingParent: null},
        evidence => expect(evidence.workspace[0].matches).toBe(false)],
    ['VM topology mismatch', {vmMovingParent: null},
        evidence => expect(evidence.vm[0].matches).toBe(false)],
    ['pointer drift', {synchronized: false},
        evidence => expect(evidence.synchronizedFrames).toBe(false)],
    ['missing insertion marker', {markerVisible: false},
        evidence => expect(evidence.markerFrameCount).toBe(0)],
    ['journal growth', {isolation: {journalUnchanged: false}},
        evidence => expect(evidence.isolation.journalUnchanged).toBe(false)],
    ['native Undo growth', {isolation: {undoUnchanged: false}},
        evidence => expect(evidence.isolation.undoUnchanged).toBe(false)],
    ['native Redo growth', {isolation: {redoUnchanged: false}},
        evidence => expect(evidence.isolation.redoUnchanged).toBe(false)]
])('rejects %s before the Studio cursor can advance', async (name, options, checkEvidence) => {
    const result = await verifyInteraction({...makeHarness(options), timeoutMs: -1});
    expect(result.matches).toBe(false);
    checkEvidence(result.evidence);
});

test('verifies every induced move in the rendered workspace and VM', async () => {
    const harness = makeHarness();
    const moving = harness.workspace.getBlockById('moving');
    const displaced = {
        id: 'displaced',
        getParent: () => moving,
        getRelativeToSurfaceXY: () => ({x: 420, y: 220})
    };
    moving.inputList = [{name: null, connection: {targetBlock: () => displaced}}];
    const originalGetWorkspaceBlock = harness.workspace.getBlockById;
    harness.workspace.getBlockById = id => (id === 'displaced' ? displaced : originalGetWorkspaceBlock(id));
    const originalGetVmBlock = harness.vm.editingTarget.blocks.getBlock;
    harness.vm.editingTarget.blocks.getBlock = id => (
        id === 'displaced' ? {id, parent: 'moving'} : originalGetVmBlock(id)
    );
    harness.plan.affectedBlocks.push({
        blockId: 'displaced',
        destination: {parentId: 'moving', inputName: null, coordinate: null}
    });

    const result = await verifyInteraction(harness);
    expect(result.matches).toBe(true);
    expect(result.evidence.workspace).toHaveLength(2);
    expect(result.evidence.vm).toHaveLength(2);
});

test('verifies a top-level coordinate destination without requiring an impossible insertion marker', async () => {
    const event = destinationEvent({parentId: null});
    event.newCoordinate = '420,180';
    const harness = makeHarness({
        observed: [event],
        workspaceMovingParent: null,
        vmMovingParent: null,
        markerVisible: false
    });
    harness.plan.destination = {parentId: null, inputName: null, coordinate: {x: 420, y: 180}};
    harness.plan.affectedBlocks[0].destination = harness.plan.destination;

    const result = await verifyInteraction(harness);
    expect(result.matches).toBe(true);
    expect(result.evidence).toMatchObject({insertionMarkerRequired: false, markerFrameCount: 0});
    expect(result.evidence.workspace[0].actual.coordinate).toEqual({x: 420, y: 180});
    expect(result.evidence.workspace[0].coordinateSource).toBe('workspace');
});

test('uses the exact observed coordinate while a promoted top-level block has no rendered coordinate', async () => {
    const event = destinationEvent({parentId: null});
    event.newCoordinate = '420,180';
    const harness = makeHarness({
        observed: [event],
        workspaceMovingParent: null,
        workspaceCoordinate: null,
        vmMovingParent: null,
        markerVisible: false
    });
    harness.plan.destination = {parentId: null, inputName: null, coordinate: {x: 420, y: 180}};
    harness.plan.affectedBlocks[0].destination = harness.plan.destination;

    const result = await verifyInteraction(harness);
    expect(result.matches).toBe(true);
    expect(result.evidence.workspace[0]).toMatchObject({
        matches: true,
        actual: {parentId: null, coordinate: null},
        coordinateSource: 'observed-event'
    });
});

test('rejects a top-level move event at the wrong coordinate', async () => {
    const event = destinationEvent({parentId: null});
    event.newCoordinate = '421,180';
    const harness = makeHarness({
        observed: [event],
        workspaceMovingParent: null,
        workspaceCoordinate: null,
        vmMovingParent: null,
        markerVisible: false
    });
    harness.plan.destination = {parentId: null, inputName: null, coordinate: {x: 420, y: 180}};
    harness.plan.affectedBlocks[0].destination = harness.plan.destination;

    const result = await verifyInteraction({...harness, timeoutMs: -1});
    expect(result.matches).toBe(false);
    expect(result.evidence.workspace[0]).toMatchObject({matches: false, coordinateSource: null});
});

test('accepts native connection geometry after an exact compound-reorder pickup event', async () => {
    const event = destinationEvent({parentId: null});
    event.newCoordinate = '420,180';
    const harness = makeHarness({
        observed: [event],
        workspaceMovingParent: null,
        workspaceCoordinate: {x: 420, y: 84},
        vmMovingParent: null,
        markerVisible: false
    });
    harness.plan.destination = {parentId: null, inputName: null, coordinate: {x: 420, y: 180}};
    harness.plan.destinationCoordinateIsGesturePickup = true;
    harness.plan.affectedBlocks[0].destination = harness.plan.destination;

    const result = await verifyInteraction(harness);
    expect(result.matches).toBe(true);
    expect(result.evidence.workspace[0]).toMatchObject({
        matches: true,
        actual: {parentId: null, coordinate: {x: 420, y: 84}},
        coordinateSource: 'native-connection'
    });
});
