import {compileInteractionPlan} from '../../src/studio/bridge/native-interaction/interaction-plan';

test('explicit keyboard composition uses atomic presentation, not an inferred palette gesture', () => {
    expect(compileInteractionPlan({id: 'typed', targetId: 'sprite', events: [{type: 'create',
        interactionSource: {kind: 'keyboard-authoring'}}]}, 'forward', {presentationMode: 'realistic'}))
        .toMatchObject({kind: 'semantic-only', reason: 'keyboard composition uses atomic native transaction presentation'});
});

const move = ({blockId = 'moving', oldParentId = 'old-parent', newParentId = 'new-parent'} = {}) => ({
    type: 'move',
    blockId,
    blockType: blockId === 'moving' ? 'motion_turnleft' : 'motion_turnright',
    blockRef: {ancestorId: blockId, path: []},
    details: {
        oldLocation: {parentId: oldParentId, inputName: null, coordinate: null},
        newLocation: {parentId: newParentId, inputName: null, coordinate: null}
    }
});

const dropdownChange = () => ({
    type: 'change',
    blockId: 'point-block',
    blockType: 'motion_pointtowards',
    blockRef: {ancestorId: 'point-block', path: []},
    details: {
        element: 'field',
        name: 'TOWARDS',
        oldValue: {kind: 'value', value: '_mouse_'},
        newValue: {kind: 'value', value: '_random_'}
    }
});

test('compiles one existing command-block move without mutating the transaction', () => {
    const transaction = {id: 'transaction-1', targetId: 'sprite-a', events: [move()]};
    const before = JSON.stringify(transaction);

    expect(compileInteractionPlan(transaction, 'forward')).toMatchObject({
        kind: 'existing-block-drag',
        blockId: 'moving',
        blockType: 'motion_turnleft',
        source: {parentId: 'old-parent'},
        destination: {parentId: 'new-parent'},
        presentation: {generated: true, grabOffset: {x: 24, y: 18}}
    });
    expect(JSON.stringify(transaction)).toBe(before);
});

test('uses fast generated motion for history while keeping panel playback realistic', () => {
    const transaction = {id: 'transaction-1', targetId: 'sprite-a', events: [move()]};

    expect(compileInteractionPlan(transaction, 'forward', {presentationMode: 'history'}).presentation)
        .toEqual({
            generated: true,
            grabOffset: {x: 24, y: 18},
            frameCount: 7,
            markerHoldFrames: 1,
            pointerTravel: false
        });
    expect(compileInteractionPlan(transaction, 'forward').presentation)
        .toEqual({
            generated: true,
            grabOffset: {x: 24, y: 18},
            frameCount: 24,
            markerHoldFrames: 12,
            pointerTravel: true
        });
});

test('compiles one realistic field edit in both directions but keeps history semantic', () => {
    const transaction = {id: 'transaction-dropdown', targetId: 'sprite-a', events: [dropdownChange()]};

    expect(compileInteractionPlan(transaction, 'forward')).toMatchObject({
        kind: 'block-field-edit',
        blockId: 'point-block',
        blockType: 'motion_pointtowards',
        fieldName: 'TOWARDS',
        sourceValue: '_mouse_',
        value: '_random_',
        presentation: {pointerTravel: true}
    });
    expect(compileInteractionPlan(transaction, 'backward')).toMatchObject({
        kind: 'block-field-edit',
        sourceValue: '_random_',
        value: '_mouse_'
    });
    expect(compileInteractionPlan(transaction, 'forward', {presentationMode: 'history'})).toMatchObject({
        kind: 'semantic-only'
    });
});

test('does not assume a recorded text field is a dropdown', () => {
    const transaction = {id: 'transaction-text',
        targetId: 'sprite-a',
        events: [{
            type: 'change',
            blockId: 'text-block',
            blockType: 'text',
            details: {
                element: 'field',
                name: 'TEXT',
                oldValue: {kind: 'value', value: ''},
                newValue: {kind: 'value', value: 'smoke'}
            }
        }]};

    expect(compileInteractionPlan(transaction, 'forward')).toMatchObject({
        kind: 'block-field-edit',
        blockId: 'text-block',
        blockType: 'text',
        fieldName: 'TEXT',
        sourceValue: '',
        value: 'smoke'
    });
});

test('compiles the complete native block-comment lifecycle only for realistic forward Play', () => {
    const base = {
        targetId: 'sprite-a',
        blockId: 'recorded-block',
        blockType: 'looks_say',
        blockRef: {ancestorId: 'recorded-block', path: []},
        commentId: 'comment-1'
    };
    const transaction = event => ({id: `transaction-${event.type}`, targetId: 'sprite-a', events: [event]});
    const created = transaction({
        ...base,
        type: 'comment_create',
        details: {state: {text: ''}, xml: '<comment id="comment-1"></comment>'}
    });
    const changed = transaction({
        ...base,
        type: 'comment_change',
        details: {oldContents: {text: ''}, newContents: {text: 'Explain this'}}
    });
    const deleted = transaction({
        ...base,
        type: 'comment_delete',
        details: {state: {text: 'Explain this'}, oldXml: '<comment id="comment-1">Explain this</comment>'}
    });
    const minimized = transaction({
        ...base,
        type: 'comment_change',
        details: {oldContents: {minimized: false}, newContents: {minimized: true}}
    });
    const resized = transaction({
        ...base,
        type: 'comment_change',
        details: {
            oldContents: {width: 160, height: 120},
            newContents: {width: 240, height: 180}
        }
    });
    const moved = transaction({
        ...base,
        type: 'comment_move',
        details: {
            oldCoordinate: {x: 100, y: 80},
            newCoordinate: {x: 220, y: 160}
        }
    });

    expect(compileInteractionPlan(created, 'forward')).toMatchObject({
        kind: 'block-comment-create',
        blockId: 'recorded-block',
        commentId: 'comment-1',
        text: ''
    });
    expect(compileInteractionPlan(changed, 'forward')).toMatchObject({
        kind: 'block-comment-text',
        sourceText: '',
        text: 'Explain this'
    });
    expect(compileInteractionPlan(deleted, 'forward')).toMatchObject({
        kind: 'block-comment-delete',
        commentId: 'comment-1'
    });
    expect(compileInteractionPlan(minimized, 'forward')).toMatchObject({
        kind: 'block-comment-minimize',
        sourceMinimized: false,
        minimized: true
    });
    expect(compileInteractionPlan(resized, 'forward')).toMatchObject({
        kind: 'block-comment-resize',
        sourceSize: {width: 160, height: 120},
        size: {width: 240, height: 180}
    });
    expect(compileInteractionPlan(moved, 'forward')).toMatchObject({
        kind: 'block-comment-move',
        source: {x: 100, y: 80},
        destination: {x: 220, y: 160}
    });
    expect(compileInteractionPlan(created, 'backward')).toMatchObject({kind: 'semantic-only'});
    expect(compileInteractionPlan(changed, 'forward', {presentationMode: 'history'}))
        .toMatchObject({kind: 'semantic-only'});
});

test('does not impersonate an API-created non-empty comment with the empty context-menu action', () => {
    const transaction = {
        id: 'transaction-comment-api',
        targetId: 'sprite-a',
        events: [{
            type: 'comment_create',
            blockId: 'block-1',
            commentId: 'comment-1',
            details: {state: {text: 'already populated'}, xml: '<comment>already populated</comment>'}
        }]
    };

    expect(compileInteractionPlan(transaction, 'forward')).toMatchObject({kind: 'semantic-only'});
});

test('compiles the complete native workspace-comment lifecycle around Scratch default creation', () => {
    const base = {targetId: 'sprite-a', blockId: null, commentId: 'workspace-comment-1'};
    const transaction = (type, details) => ({
        id: `workspace-comment-${type}`,
        targetId: 'sprite-a',
        events: [{...base, type, details}]
    });
    const created = transaction('comment_create', {
        state: {
            text: '',
            coordinate: {x: 180, y: 120},
            width: 200,
            height: 200,
            minimized: false
        }
    });

    expect(compileInteractionPlan(created, 'forward')).toMatchObject({
        kind: 'workspace-comment-create',
        commentOwner: 'workspace',
        commentId: 'workspace-comment-1',
        coordinate: {x: 180, y: 120},
        size: {width: 200, height: 200},
        minimized: false
    });
    expect(compileInteractionPlan(transaction('comment_change', {
        oldContents: {text: ''},
        newContents: {text: 'Scene note'}
    }), 'forward')).toMatchObject({kind: 'workspace-comment-text', text: 'Scene note'});
    expect(compileInteractionPlan(transaction('comment_change', {
        oldContents: {width: 200, height: 200},
        newContents: {width: 280, height: 250}
    }), 'forward')).toMatchObject({kind: 'workspace-comment-resize', size: {width: 280, height: 250}});
    expect(compileInteractionPlan(transaction('comment_change', {
        oldContents: {minimized: false},
        newContents: {minimized: true}
    }), 'forward')).toMatchObject({kind: 'workspace-comment-minimize', minimized: true});
    expect(compileInteractionPlan(transaction('comment_move', {
        oldCoordinate: {x: 180, y: 120},
        newCoordinate: {x: 260, y: 170}
    }), 'forward')).toMatchObject({
        kind: 'workspace-comment-move',
        destination: {x: 260, y: 170}
    });
    expect(compileInteractionPlan(transaction('comment_delete', {
        state: {text: 'Scene note'}
    }), 'forward')).toMatchObject({kind: 'workspace-comment-delete'});

    const nonDefaultCreate = transaction('comment_create', {
        state: {
            text: '',
            coordinate: {x: 180, y: 120},
            width: 260,
            height: 200,
            minimized: false
        }
    });
    expect(compileInteractionPlan(nonDefaultCreate, 'forward')).toMatchObject({kind: 'semantic-only'});
});

test('compiles scalar and list creation for the real prompt only during forward Play', () => {
    const variable = {
        type: 'var_create',
        details: {
            varId: 'recorded-cake',
            varName: 'cake',
            varType: '',
            isLocal: true,
            isCloud: false,
            definition: {after: {targetRef: {name: 'Sprite1', isStage: false}}}
        }
    };
    const transaction = {id: 'transaction-variable', targetId: 'sprite-a', events: [variable]};

    expect(compileInteractionPlan(transaction, 'forward')).toMatchObject({
        kind: 'variable-create-dialog',
        varId: 'recorded-cake',
        varName: 'cake',
        varType: '',
        isLocal: true,
        isCloud: false,
        presentation: {pointerTravel: true}
    });
    expect(compileInteractionPlan({
        ...transaction,
        events: [{...variable, details: {...variable.details, varType: 'list'}}]
    }, 'forward')).toMatchObject({kind: 'variable-create-dialog', varType: 'list'});
    expect(compileInteractionPlan(transaction, 'backward')).toMatchObject({kind: 'semantic-only'});
    expect(compileInteractionPlan(transaction, 'forward', {presentationMode: 'history'}))
        .toMatchObject({kind: 'semantic-only'});
    expect(compileInteractionPlan({
        ...transaction,
        events: [{...variable, details: {...variable.details, varType: 'broadcast_msg'}}]
    }, 'forward')).toMatchObject({kind: 'semantic-only'});
});

test('compiles scalar and list rename through the real variable dropdown and prompt', () => {
    const transaction = {
        id: 'transaction-variable-rename',
        targetId: 'sprite-a',
        events: [{
            type: 'var_rename',
            details: {
                varId: 'cake-id',
                oldName: 'cake',
                newName: 'cupcake',
                definition: {
                    before: {type: '', targetRef: {name: 'Sprite1', isStage: false}},
                    after: {type: '', targetRef: {name: 'Sprite1', isStage: false}}
                }
            }
        }]
    };

    expect(compileInteractionPlan(transaction, 'forward')).toMatchObject({
        kind: 'variable-rename-dialog',
        varId: 'cake-id',
        varType: '',
        oldName: 'cake',
        newName: 'cupcake',
        targetRef: {name: 'Sprite1', isStage: false},
        presentation: {pointerTravel: true}
    });
    expect(compileInteractionPlan({
        ...transaction,
        events: [{
            ...transaction.events[0],
            details: {
                ...transaction.events[0].details,
                definition: {
                    before: {type: 'list'},
                    after: {type: 'list'}
                }
            }
        }]
    }, 'forward')).toMatchObject({kind: 'variable-rename-dialog', varType: 'list'});
    expect(compileInteractionPlan(transaction, 'backward')).toMatchObject({kind: 'semantic-only'});
    expect(compileInteractionPlan(transaction, 'forward', {presentationMode: 'history'}))
        .toMatchObject({kind: 'semantic-only'});
});

test('compiles variable deletion with its disposed uses as one real dropdown action', () => {
    const transaction = {
        id: 'transaction-variable-delete',
        targetId: 'sprite-a',
        events: [{
            type: 'delete',
            blockId: 'set-cake',
            blockType: 'data_setvariableto',
            blockRef: {ancestorId: 'set-cake', path: []},
            details: {oldXml: '<block id="set-cake"></block>', ids: ['set-cake', 'shadow-1']}
        }, {
            type: 'var_delete',
            details: {
                varId: 'cake-id',
                varName: 'cake',
                varType: '',
                isLocal: true,
                isCloud: false,
                definition: {before: {targetRef: {name: 'Sprite1', isStage: false}}}
            }
        }]
    };

    expect(compileInteractionPlan(transaction, 'forward')).toMatchObject({
        kind: 'variable-delete-dropdown',
        varId: 'cake-id',
        varName: 'cake',
        varType: '',
        deletedBlocks: [{blockId: 'set-cake', blockIds: ['set-cake', 'shadow-1']}],
        presentation: {pointerTravel: true}
    });
    expect(compileInteractionPlan(transaction, 'backward')).toMatchObject({kind: 'semantic-only'});
    expect(compileInteractionPlan(transaction, 'forward', {presentationMode: 'history'}))
        .toMatchObject({kind: 'semantic-only'});
    expect(compileInteractionPlan({
        ...transaction,
        events: [...transaction.events, {
            type: 'move',
            blockId: 'unrelated',
            details: {
                oldLocation: {parentId: null, inputName: null, coordinate: {x: 0, y: 0}},
                newLocation: {parentId: null, inputName: null, coordinate: {x: 10, y: 10}}
            }
        }]
    }, 'forward')).toMatchObject({kind: 'semantic-only'});
});

test('compiles one broadcast dropdown-and-dialog gesture only during forward Play', () => {
    const transaction = {
        id: 'transaction-broadcast',
        targetId: 'sprite-a',
        targetRef: {name: 'Sprite1', isStage: false},
        events: [{
            type: 'var_create',
            details: {
                varId: 'message-id',
                varName: 'start game',
                varType: 'broadcast_msg',
                isLocal: false,
                isCloud: false
            }
        }, {
            type: 'change',
            blockId: 'broadcast-menu',
            blockType: 'event_broadcast_menu',
            blockRef: {ancestorId: 'broadcast', path: ['BROADCAST_INPUT']},
            details: {
                element: 'field',
                name: 'BROADCAST_OPTION',
                oldValue: {kind: 'value', value: 'old-message'},
                newValue: {kind: 'value', value: 'message-id'}
            }
        }]
    };

    expect(compileInteractionPlan(transaction, 'forward')).toMatchObject({
        kind: 'broadcast-create-dialog',
        blockId: 'broadcast-menu',
        fieldName: 'BROADCAST_OPTION',
        sourceValue: 'old-message',
        value: 'message-id',
        varId: 'message-id',
        varName: 'start game',
        varType: 'broadcast_msg',
        presentation: {pointerTravel: true}
    });
    expect(compileInteractionPlan(transaction, 'backward')).toMatchObject({kind: 'semantic-only'});
    expect(compileInteractionPlan(transaction, 'forward', {presentationMode: 'history'}))
        .toMatchObject({kind: 'semantic-only'});
});

test('compiles a custom procedure definition for its real dialog only during forward Play', () => {
    const transaction = {
        id: 'transaction-procedure',
        targetId: 'sprite-a',
        targetRef: {name: 'Sprite1', isStage: false},
        events: [{
            type: 'create',
            blockId: 'definition',
            blockType: 'procedures_definition',
            details: {
                ids: ['definition', 'prototype', 'argument'],
                xml: '<block type="procedures_definition"><statement name="custom_block"><shadow ' +
                    'type="procedures_prototype"><mutation proccode="bake %s"></mutation></shadow></statement></block>'
            }
        }, {
            type: 'move',
            blockId: 'definition',
            blockType: 'procedures_definition',
            details: {
                oldLocation: {parentId: null, inputName: null, coordinate: {x: 0, y: 0}},
                newLocation: {parentId: null, inputName: null, coordinate: {x: 44, y: 44}}
            }
        }]
    };

    expect(compileInteractionPlan(transaction, 'forward')).toMatchObject({
        kind: 'custom-procedure-dialog',
        blockId: 'definition',
        blockIds: ['definition', 'prototype', 'argument'],
        destination: {coordinate: {x: 44, y: 44}},
        presentation: {pointerTravel: true}
    });
    expect(compileInteractionPlan(transaction, 'backward')).toMatchObject({kind: 'semantic-only'});
    expect(compileInteractionPlan(transaction, 'forward', {presentationMode: 'history'}))
        .toMatchObject({kind: 'semantic-only'});
});

test('compiles built-in sprite, costume, backdrop and sound operations only for forward realistic Play', () => {
    const sprite = {
        id: 'sprite-library',
        kind: 'project-operation',
        operation: {
            type: 'sprite-create',
            libraryItem: {name: 'Apple', md5ext: 'apple.svg'},
            targetId: 'apple-target',
            targetRef: {name: 'Apple', isStage: false}
        },
        events: []
    };
    const costume = {
        id: 'costume-library',
        kind: 'project-operation',
        operation: {
            type: 'costume-library-add',
            libraryItem: {name: 'Arrow1-a', md5ext: 'arrow.svg'},
            targetId: 'sprite-a',
            targetRef: {name: 'Sprite1', isStage: false},
            addedCostume: {name: 'Arrow1-a', assetId: 'arrow', dataFormat: 'svg'}
        },
        events: []
    };
    const backdrop = {
        id: 'backdrop-library',
        kind: 'project-operation',
        operation: {
            type: 'backdrop-library-add',
            libraryItem: {name: 'Blue Sky', md5ext: 'blue-sky.svg'},
            targetId: 'stage',
            targetRef: {name: 'Stage', isStage: true},
            addedBackdrop: {name: 'Blue Sky', assetId: 'blue-sky', dataFormat: 'svg'}
        },
        events: []
    };
    const sound = {
        id: 'sound-library',
        kind: 'project-operation',
        operation: {
            type: 'sound-add',
            libraryItem: {name: 'Meow', md5ext: 'meow.wav'},
            targetId: 'sprite-a',
            targetRef: {name: 'Sprite1', isStage: false},
            addedSound: {
                name: 'Meow',
                assetId: 'meow',
                dataFormat: 'wav',
                rate: 48000,
                sampleCount: 96000
            }
        },
        events: []
    };
    const soundEffect = {
        id: 'sound-effect',
        kind: 'project-operation',
        operation: {
            type: 'sound-edit',
            targetId: 'sprite-a',
            targetRef: {name: 'Sprite1', isStage: false},
            soundIndex: 0,
            previousSound: {name: 'Meow', assetId: 'meow', dataFormat: 'wav'},
            editedSound: {name: 'Meow', assetId: 'meow-fast', dataFormat: 'wav'},
            soundEffect: 'faster'
        },
        events: []
    };
    const soundUpload = {
        id: 'sound-upload',
        kind: 'project-operation',
        operation: {
            type: 'sound-add',
            targetId: 'sprite-a',
            targetRef: {name: 'Sprite1', isStage: false},
            uploadFile: {name: 'Sneaker'},
            addedSound: {name: 'Sneaker', assetId: 'sneaker', dataFormat: 'wav'}
        },
        events: []
    };
    const costumeUpload = {
        id: 'costume-upload',
        kind: 'project-operation',
        operation: {
            type: 'costume-add',
            targetId: 'sprite-a',
            targetRef: {name: 'Sprite1', isStage: false},
            uploadFile: {name: 'Rocket'},
            addedCostume: {name: 'Rocket', assetId: 'rocket', dataFormat: 'svg'},
            afterCheckpointId: 17
        },
        events: []
    };
    const backdropPaint = {
        id: 'backdrop-paint',
        kind: 'project-operation',
        operation: {
            type: 'backdrop-add',
            targetId: 'stage',
            targetRef: {name: 'Stage', isStage: true},
            createdWith: 'paint',
            addedCostume: {name: 'backdrop2', assetId: 'blank', dataFormat: 'svg'}
        },
        events: []
    };

    expect(compileInteractionPlan(sprite, 'forward')).toMatchObject({
        kind: 'sprite-library-select',
        libraryItem: {name: 'Apple', md5ext: 'apple.svg'},
        targetRef: {name: 'Apple', isStage: false}
    });
    expect(compileInteractionPlan(costume, 'forward')).toMatchObject({
        kind: 'costume-library-select',
        libraryItem: {name: 'Arrow1-a', md5ext: 'arrow.svg'},
        addedCostume: {assetId: 'arrow'}
    });
    expect(compileInteractionPlan(backdrop, 'forward')).toMatchObject({
        kind: 'backdrop-library-select',
        libraryItem: {name: 'Blue Sky', md5ext: 'blue-sky.svg'},
        targetRef: {name: 'Stage', isStage: true},
        addedCostume: {assetId: 'blue-sky'}
    });
    expect(compileInteractionPlan(sound, 'forward')).toMatchObject({
        kind: 'sound-library-select',
        libraryItem: {name: 'Meow', md5ext: 'meow.wav'},
        targetRef: {name: 'Sprite1', isStage: false},
        addedSound: {assetId: 'meow'}
    });
    expect(compileInteractionPlan(soundEffect, 'forward')).toMatchObject({
        kind: 'sound-effect-click',
        soundIndex: 0,
        soundEffect: 'faster',
        previousSound: {assetId: 'meow'},
        editedSound: {assetId: 'meow-fast'}
    });
    expect(compileInteractionPlan(soundUpload, 'forward')).toMatchObject({
        kind: 'sound-file-upload',
        targetRef: {name: 'Sprite1', isStage: false},
        uploadFile: {name: 'Sneaker'},
        addedSound: {assetId: 'sneaker'}
    });
    expect(compileInteractionPlan(costumeUpload, 'forward')).toMatchObject({
        kind: 'costume-file-upload',
        uploadFile: {name: 'Rocket'},
        addedCostume: {assetId: 'rocket'},
        sourceCheckpointId: 17,
        sourceAssetMd5: 'rocket.svg'
    });
    expect(compileInteractionPlan(backdropPaint, 'forward')).toMatchObject({
        kind: 'backdrop-paint-create',
        targetRef: {name: 'Stage', isStage: true},
        addedCostume: {assetId: 'blank'}
    });
    expect(compileInteractionPlan(sprite, 'backward')).toMatchObject({kind: 'semantic-only'});
    expect(compileInteractionPlan(costume, 'forward', {presentationMode: 'history'}))
        .toMatchObject({kind: 'semantic-only'});
});

test('compiles deterministic sound lifecycle operations for forward realistic Play', () => {
    const targetRef = {name: 'Sprite1', isStage: false};
    const sound = {name: 'Pop', assetId: 'pop', dataFormat: 'wav', rate: 48000, sampleCount: 100};
    const duplicated = {...sound, name: 'Pop2'};
    const renamed = {...sound, name: 'Party Pop'};
    const transactions = [{
        id: 'duplicate',
        kind: 'project-operation',
        operation: {
            type: 'sound-duplicate', targetRef, soundIndex: 0, sourceSound: sound, addedSound: duplicated
        },
        events: []
    }, {
        id: 'rename',
        kind: 'project-operation',
        operation: {
            type: 'sound-rename',
            targetRef,
            soundIndex: 0,
            oldSound: sound,
            requestedName: 'Party Pop',
            renamedSound: renamed
        },
        events: []
    }, {
        id: 'delete',
        kind: 'project-operation',
        operation: {type: 'sound-delete', targetRef, soundIndex: 0, deletedSound: sound},
        events: []
    }, {
        id: 'reorder',
        kind: 'project-operation',
        operation: {type: 'sound-reorder', targetRef, soundIndex: 0, newIndex: 1, movedSound: sound},
        events: []
    }];

    expect(transactions.map(transaction => compileInteractionPlan(transaction, 'forward').kind)).toEqual([
        'sound-duplicate-click',
        'sound-rename-input',
        'sound-delete-click',
        'sound-reorder-drag'
    ]);
    expect(transactions.map(transaction => compileInteractionPlan(transaction, 'backward').kind))
        .toEqual(['semantic-only', 'semantic-only', 'semantic-only', 'semantic-only']);
    expect(transactions.map(transaction => compileInteractionPlan(
        transaction, 'forward', {presentationMode: 'history'}
    ).kind)).toEqual(['semantic-only', 'semantic-only', 'semantic-only', 'semantic-only']);
});

test('compiles deterministic sprite lifecycle operations only for forward realistic Play', () => {
    const sourceTargetRef = {name: 'Sprite1', isStage: false};
    const createdTargetRef = {name: 'Sprite2', isStage: false};
    const renamedTargetRef = {name: 'Guide', isStage: false};
    const transactions = [{
        id: 'duplicate-sprite',
        kind: 'project-operation',
        operation: {type: 'sprite-duplicate', sourceTargetRef, targetRef: createdTargetRef},
        events: []
    }, {
        id: 'rename-sprite',
        kind: 'project-operation',
        operation: {
            type: 'sprite-rename',
            targetRef: createdTargetRef,
            requestedName: 'Guide',
            renamedTargetRef
        },
        events: []
    }, {
        id: 'delete-sprite',
        kind: 'project-operation',
        operation: {type: 'sprite-delete', targetRef: renamedTargetRef},
        events: []
    }];

    expect(transactions.map(transaction => compileInteractionPlan(transaction, 'forward'))).toMatchObject([{
        kind: 'sprite-duplicate-click', sourceTargetRef, createdTargetRef
    }, {
        kind: 'sprite-rename-input', targetRef: createdTargetRef, requestedName: 'Guide', renamedTargetRef
    }, {
        kind: 'sprite-delete-click', targetRef: renamedTargetRef
    }]);
    expect(transactions.map(transaction => compileInteractionPlan(transaction, 'backward').kind))
        .toEqual(['semantic-only', 'semantic-only', 'semantic-only']);
    expect(transactions.map(transaction => compileInteractionPlan(
        transaction, 'forward', {presentationMode: 'history'}
    ).kind)).toEqual(['semantic-only', 'semantic-only', 'semantic-only']);
});

test('compiles costume and backdrop lifecycle operations only for forward realistic Play', () => {
    const targetRef = {name: 'Sprite1', isStage: false};
    const stageRef = {name: 'Stage', isStage: true};
    const sourceCostume = {name: 'costume1', assetId: 'one', dataFormat: 'svg'};
    const addedCostume = {...sourceCostume, name: 'costume12'};
    const renamedCostume = {...sourceCostume, name: 'Hero'};
    const transactions = [{
        id: 'duplicate-costume',
        kind: 'project-operation',
        operation: {
            type: 'costume-duplicate', targetRef, costumeIndex: 0, sourceCostume, addedCostume
        },
        events: []
    }, {
        id: 'rename-costume',
        kind: 'project-operation',
        operation: {
            type: 'costume-rename',
            targetRef,
            costumeIndex: 0,
            oldCostume: sourceCostume,
            requestedName: 'Hero',
            renamedCostume
        },
        events: []
    }, {
        id: 'delete-backdrop',
        kind: 'project-operation',
        operation: {
            type: 'backdrop-delete', targetRef: stageRef, costumeIndex: 0, deletedCostume: sourceCostume
        },
        events: []
    }, {
        id: 'reorder-backdrop',
        kind: 'project-operation',
        operation: {
            type: 'backdrop-reorder',
            targetRef: stageRef,
            costumeIndex: 0,
            newIndex: 1,
            movedCostume: sourceCostume
        },
        events: []
    }];

    expect(transactions.map(transaction => compileInteractionPlan(transaction, 'forward'))).toMatchObject([{
        kind: 'costume-duplicate-click', assetKind: 'costume', sourceCostume, addedCostume
    }, {
        kind: 'costume-rename-input',
        assetKind: 'costume',
        sourceCostume,
        requestedName: 'Hero',
        renamedCostume
    }, {
        kind: 'backdrop-delete-click', assetKind: 'backdrop', sourceCostume
    }, {
        kind: 'backdrop-reorder-drag', assetKind: 'backdrop', sourceCostume, newIndex: 1
    }]);
    expect(transactions.map(transaction => compileInteractionPlan(transaction, 'backward').kind))
        .toEqual(['semantic-only', 'semantic-only', 'semantic-only', 'semantic-only']);
    expect(transactions.map(transaction => compileInteractionPlan(
        transaction, 'forward', {presentationMode: 'history'}
    ).kind)).toEqual(['semantic-only', 'semantic-only', 'semantic-only', 'semantic-only']);
});

test('compiles recorded vector brush gestures only for forward realistic Play', () => {
    const paintGesture = {
        tool: 'brush',
        durationMs: 120,
        points: [{x: 0.2, y: 0.3, t: 0}, {x: 0.7, y: 0.8, t: 120}]
    };
    const transaction = {
        id: 'paint-stroke',
        kind: 'project-operation',
        operation: {
            type: 'costume-edit',
            targetRef: {name: 'Sprite1', isStage: false},
            costumeIndex: 0,
            editFormat: 'svg',
            previousCostume: {name: 'costume1', assetId: 'before', dataFormat: 'svg'},
            editedCostume: {name: 'costume1', assetId: 'after', dataFormat: 'svg'},
            paintGesture
        },
        events: []
    };

    expect(compileInteractionPlan(transaction, 'forward')).toMatchObject({
        kind: 'costume-brush-stroke',
        assetKind: 'costume',
        editFormat: 'svg',
        paintGesture
    });
    expect(compileInteractionPlan(transaction, 'backward').kind).toBe('semantic-only');
    expect(compileInteractionPlan(transaction, 'forward', {presentationMode: 'history'}).kind)
        .toBe('semantic-only');

    expect(compileInteractionPlan({
        ...transaction,
        operation: {
            ...transaction.operation,
            editFormat: 'bitmap',
            previousCostume: {name: 'costume1', assetId: 'before', dataFormat: 'png'},
            editedCostume: {name: 'costume1', assetId: 'after', dataFormat: 'png'}
        }
    }, 'forward')).toMatchObject({
        kind: 'costume-brush-stroke',
        editFormat: 'bitmap'
    });
});

test('compiles deterministic Paint format conversions only for forward realistic Play', () => {
    const toBitmap = {
        id: 'to-bitmap',
        kind: 'project-operation',
        operation: {
            type: 'costume-edit',
            targetRef: {name: 'Sprite1', isStage: false},
            costumeIndex: 0,
            editFormat: 'bitmap',
            afterCheckpointId: 9,
            previousCostume: {name: 'costume1', assetId: 'vector', dataFormat: 'svg'},
            editedCostume: {name: 'costume1', assetId: 'bitmap', dataFormat: 'png'}
        }
    };
    const toVector = {
        id: 'to-vector',
        kind: 'project-operation',
        operation: {
            type: 'backdrop-edit',
            targetRef: {name: 'Stage', isStage: true},
            costumeIndex: 1,
            editFormat: 'svg',
            afterCheckpointId: 10,
            previousCostume: {name: 'backdrop2', assetId: 'bitmap', dataFormat: 'png'},
            editedCostume: {name: 'backdrop2', assetId: 'vector', dataFormat: 'svg'}
        }
    };

    expect(compileInteractionPlan(toBitmap, 'forward')).toMatchObject({
        kind: 'costume-convert-to-bitmap',
        assetKind: 'costume',
        editFormat: 'bitmap',
        editedCheckpointId: 9
    });
    expect(compileInteractionPlan(toVector, 'forward')).toMatchObject({
        kind: 'backdrop-convert-to-vector',
        assetKind: 'backdrop',
        editFormat: 'svg',
        editedCheckpointId: 10
    });
    expect(compileInteractionPlan(toBitmap, 'backward').kind).toBe('semantic-only');
    expect(compileInteractionPlan(toVector, 'forward', {presentationMode: 'history'}).kind)
        .toBe('semantic-only');
    expect(compileInteractionPlan({
        ...toBitmap,
        operation: {...toBitmap.operation, editedCostume: {...toBitmap.operation.editedCostume, dataFormat: 'svg'}}
    }, 'forward').kind).toBe('semantic-only');
});

test('compiles sprite reorder and cross-sprite script copy as target-resolved realistic drags', () => {
    const reorder = {
        id: 'reorder',
        kind: 'project-operation',
        operation: {
            type: 'sprite-reorder',
            targetIndex: 2,
            newIndex: 1,
            movedTargetRef: {name: 'Apple', isStage: false}
        }
    };
    const copy = {
        id: 'copy',
        kind: 'project-operation',
        operation: {
            type: 'block-share',
            sourceTargetRef: {name: 'Sprite1', isStage: false},
            targetRef: {name: 'Apple', isStage: false},
            sourceRoot: {
                opcode: 'motion_movesteps',
                blockCount: 2,
                blockRef: {
                    ancestorType: 'motion_movesteps',
                    ancestorCoordinate: {x: 80, y: 90},
                    path: []
                }
            }
        }
    };
    const backpack = {
        id: 'backpack-import',
        kind: 'project-operation',
        operation: {
            type: 'block-import',
            targetRef: {name: 'Sprite1', isStage: false},
            importSource: {kind: 'backpack', id: '17', type: 'script', name: 'code'},
            sourceRoot: {opcode: 'control_repeat', blockCount: 4},
            destinationCoordinate: {x: 180, y: 120}
        }
    };

    expect(compileInteractionPlan(reorder, 'forward')).toMatchObject({
        kind: 'sprite-reorder-drag',
        movedTargetRef: {name: 'Apple'},
        targetIndex: 2,
        newIndex: 1
    });
    expect(compileInteractionPlan(copy, 'forward')).toMatchObject({
        kind: 'cross-sprite-script-drag',
        sourceTargetRef: {name: 'Sprite1'},
        targetRef: {name: 'Apple'},
        copiedBlockCount: 2
    });
    expect(compileInteractionPlan(backpack, 'forward')).toMatchObject({
        kind: 'backpack-script-drag',
        targetRef: {name: 'Sprite1'},
        backpackItem: {id: '17', type: 'script'},
        copiedRootOpcode: 'control_repeat',
        copiedBlockCount: 4,
        destination: {parentId: null, coordinate: {x: 180, y: 120}}
    });
    expect(compileInteractionPlan(reorder, 'backward')).toMatchObject({kind: 'semantic-only'});
    expect(compileInteractionPlan(copy, 'forward', {presentationMode: 'history'}))
        .toMatchObject({kind: 'semantic-only'});
    expect(compileInteractionPlan(backpack, 'backward')).toMatchObject({kind: 'semantic-only'});
});

test('rejects unknown directions, mixed and ambiguous transactions before mutation', () => {
    const transaction = {id: 'transaction-1', targetId: 'sprite-a', events: [move()]};
    expect(compileInteractionPlan(transaction, 'sideways')).toMatchObject({kind: 'semantic-only'});
    expect(compileInteractionPlan({
        ...transaction,
        events: [...transaction.events, {...move(), type: 'change'}]
    }, 'forward')).toMatchObject({kind: 'semantic-only'});
    expect(compileInteractionPlan({
        ...transaction,
        events: [move(), move({blockId: 'other'})]
    }, 'forward')).toMatchObject({kind: 'semantic-only'});
});

test('uses the final semantic location when Blockly emitted internal move noise', () => {
    const transaction = {
        id: 'transaction-1',
        targetId: 'sprite-a',
        events: [
            move({newParentId: null}),
            move({oldParentId: null, newParentId: 'final-parent'})
        ]
    };
    transaction.events[0].details.newLocation.coordinate = {x: 200, y: 100};
    transaction.events[1].details.oldLocation.coordinate = {x: 200, y: 100};

    expect(compileInteractionPlan(transaction, 'forward')).toMatchObject({
        kind: 'existing-block-drag',
        destination: {parentId: 'final-parent'}
    });
    expect(compileInteractionPlan(transaction, 'backward')).toMatchObject({
        kind: 'existing-block-drag',
        source: {parentId: 'final-parent'},
        destination: {parentId: 'old-parent'}
    });
});

test('separates one dominant dragged block from induced stack moves', () => {
    const primaryTopLevel = move({newParentId: null});
    primaryTopLevel.details.newLocation.coordinate = {x: 200, y: 100};
    const primaryFinal = move({oldParentId: null, newParentId: 'final-parent'});
    primaryFinal.details.oldLocation.coordinate = {x: 200, y: 100};
    const induced = move({blockId: 'displaced', oldParentId: 'final-parent', newParentId: 'moving'});
    const plan = compileInteractionPlan({
        id: 'transaction-1',
        targetId: 'sprite-a',
        events: [primaryTopLevel, induced, primaryFinal]
    }, 'forward');

    expect(plan).toMatchObject({
        kind: 'existing-block-drag',
        blockId: 'moving',
        destination: {parentId: 'final-parent'},
        affectedBlocks: [
            {blockId: 'moving', destination: {parentId: 'final-parent'}},
            {blockId: 'displaced', destination: {parentId: 'moving'}}
        ]
    });
    expect(compileInteractionPlan({
        id: 'transaction-1',
        targetId: 'sprite-a',
        events: [primaryTopLevel, induced, primaryFinal]
    }, 'backward')).toMatchObject({
        kind: 'semantic-only',
        reason: 'the inverse requires more than one native drag'
    });
});

test('models moving the bottom of a two-block stack above its former parent as one drag', () => {
    const detachBottom = move({blockId: 'bottom', oldParentId: 'top', newParentId: null});
    detachBottom.details.newLocation.coordinate = {x: 260, y: 180};
    const healFormerTop = move({blockId: 'top', oldParentId: null, newParentId: 'bottom'});
    const transaction = {
        id: 'transaction-two-block-reorder',
        targetId: 'sprite-a',
        events: [detachBottom, healFormerTop]
    };

    expect(compileInteractionPlan(transaction, 'forward')).toMatchObject({
        kind: 'existing-block-drag',
        blockId: 'bottom',
        source: {parentId: 'top'},
        destination: {parentId: null, coordinate: {x: 260, y: 180}},
        topLevelPrepend: true,
        destinationCoordinateIsGesturePickup: true,
        affectedBlocks: [
            {blockId: 'bottom', destination: {parentId: null, coordinate: {x: 260, y: 180}}},
            {blockId: 'top', destination: {parentId: 'bottom'}}
        ]
    });
});

test('recognizes a split-coordinate two-block prepend from its induced root attachment', () => {
    const detachBottom = move({blockId: 'bottom', oldParentId: 'top', newParentId: null});
    detachBottom.details.newLocation.coordinate = {x: 260, y: 276};
    const moveBottom = move({blockId: 'bottom', oldParentId: null, newParentId: null});
    moveBottom.details.oldLocation.coordinate = {x: 260, y: 276};
    moveBottom.details.newLocation.coordinate = {x: 260, y: 180};
    const healFormerTop = move({blockId: 'top', oldParentId: null, newParentId: 'bottom'});

    expect(compileInteractionPlan({
        id: 'transaction-two-block-reorder',
        targetId: 'sprite-a',
        events: [detachBottom, moveBottom, healFormerTop]
    }, 'forward')).toMatchObject({
        kind: 'existing-block-drag',
        blockId: 'bottom',
        destination: {parentId: null, coordinate: {x: 260, y: 180}},
        topLevelPrepend: true,
        destinationCoordinateIsGesturePickup: false
    });
});

test('recognizes the detached coordinate as pickup when a compound substack is prepended', () => {
    const detachSubstack = move({blockId: 'goto', oldParentId: 'move', newParentId: null});
    detachSubstack.details.newLocation.coordinate = {x: 304, y: 225};
    const appendFormerRoot = move({blockId: 'move', oldParentId: null, newParentId: 'turn-left'});
    appendFormerRoot.details.oldLocation.coordinate = {x: 304, y: 177};

    expect(compileInteractionPlan({
        id: 'transaction-four-block-reorder',
        targetId: 'sprite-a',
        events: [detachSubstack, appendFormerRoot]
    }, 'forward')).toMatchObject({
        kind: 'existing-block-drag',
        blockId: 'goto',
        topLevelPrepend: true,
        destinationCoordinateIsGesturePickup: true,
        affectedBlocks: [
            {blockId: 'goto', destination: {parentId: null, coordinate: {x: 304, y: 225}}},
            {blockId: 'move', destination: {parentId: 'turn-left'}}
        ]
    });
});

test('models moving a top-level root into its own remainder as one native drag', () => {
    const remainder = move({blockId: 'point', oldParentId: 'turn-left', newParentId: null});
    remainder.details.newLocation.coordinate = {x: 308, y: 223};
    const draggedRoot = move({blockId: 'turn-left', oldParentId: null, newParentId: 'go-to'});
    draggedRoot.details.oldLocation.coordinate = {x: 308, y: 175};
    const displacedTail = move({blockId: 'glide', oldParentId: 'go-to', newParentId: 'turn-left'});
    const transaction = {
        id: 'transaction-root-to-middle',
        targetId: 'sprite-a',
        events: [remainder, draggedRoot, displacedTail]
    };

    expect(compileInteractionPlan(transaction, 'forward')).toMatchObject({
        kind: 'existing-block-drag',
        blockId: 'turn-left',
        source: {parentId: null, coordinate: {x: 308, y: 175}},
        destination: {parentId: 'go-to'},
        splitSourceRoot: true,
        affectedBlocks: [
            {blockId: 'point', destination: {parentId: null, coordinate: {x: 308, y: 223}}},
            {blockId: 'turn-left', destination: {parentId: 'go-to'}},
            {blockId: 'glide', destination: {parentId: 'turn-left'}}
        ]
    });
});

test('compiles one realistic flyout create-and-drag but keeps history semantic', () => {
    const transaction = {
        id: 'transaction-flyout-create',
        targetId: 'sprite-a',
        events: [{
            type: 'create',
            blockId: 'created',
            blockType: 'motion_movesteps',
            details: {
                xml: '<block type="motion_movesteps"/>',
                ids: ['created', 'number-shadow']
            }
        }, {
            type: 'move',
            blockId: 'created',
            blockType: 'motion_movesteps',
            details: {
                oldLocation: {parentId: null, inputName: null, coordinate: {x: 40, y: 90}},
                newLocation: {parentId: null, inputName: null, coordinate: {x: 300, y: 180}}
            }
        }]
    };

    expect(compileInteractionPlan(transaction, 'forward')).toMatchObject({
        kind: 'flyout-block-drag',
        blockId: 'created',
        blockIds: ['created', 'number-shadow'],
        blockType: 'motion_movesteps',
        prototypeXml: '<block type="motion_movesteps"/>',
        destination: {coordinate: {x: 300, y: 180}},
        affectedBlocks: [{blockId: 'created'}],
        presentation: {grabOffset: {x: 16, y: 18}, frameCount: 24, markerHoldFrames: 12}
    });
    expect(compileInteractionPlan(transaction, 'forward', {presentationMode: 'history'})).toMatchObject({
        kind: 'semantic-only',
        reason: 'history lifecycle uses the fast semantic presentation'
    });
    expect(compileInteractionPlan(transaction, 'backward')).toMatchObject({kind: 'semantic-only'});
});

test('uses recorded workspace clone origin and safely declines unproven legacy argument sources', () => {
    const origin = {kind: 'workspace-copy', blockId: 'definition-argument', blockRef: {ancestorId: 'define', path: []}};
    const transaction = {events: [{
        type: 'create',
        blockId: 'copy',
        blockType: 'argument_reporter_string_number',
        details: {xml: '<block type="argument_reporter_string_number"/>', ids: ['copy']}
    }, {
        type: 'move',
        blockId: 'copy',
        blockType: 'argument_reporter_string_number',
        gesture: {blockId: 'copy', origin},
        details: {oldLocation: {coordinate: {x: 40, y: 40}}, newLocation: {parentId: 'call', inputName: 'arg'}}
    }]};
    expect(compileInteractionPlan(transaction, 'forward')).toMatchObject({kind: 'workspace-block-copy', origin});
    delete transaction.events[1].gesture;
    expect(compileInteractionPlan(transaction, 'forward')).toMatchObject({kind: 'semantic-only'});
});

test('does not mistake a copied command substack for one flyout block', () => {
    const transaction = {
        id: 'transaction-workspace-copy',
        targetId: 'sprite-a',
        events: [{
            type: 'create',
            blockId: 'copied-root',
            blockType: 'motion_movesteps',
            details: {
                xml: '<block type="motion_movesteps"><next><block type="motion_turnright"/></next></block>',
                ids: ['copied-root', 'copied-next']
            }
        }, {
            type: 'move',
            blockId: 'copied-root',
            blockType: 'motion_movesteps',
            details: {
                oldLocation: {parentId: null, inputName: null, coordinate: {x: 205, y: 285}},
                newLocation: {parentId: 'existing-parent', inputName: null, coordinate: null}
            }
        }]
    };

    expect(compileInteractionPlan(transaction, 'forward')).toEqual({
        kind: 'semantic-only',
        reason: 'the flyout gate requires one created command root'
    });
});

test('addon duplicate provenance is not mistaken for a native shadow-argument copy', () => {
    const transaction = {events: [{
        type: 'create', blockId: 'copy', blockType: 'motion_movesteps',
        details: {xml: '<block type="motion_movesteps"/>', ids: ['copy']}
    }, {
        type: 'move', blockId: 'copy', blockType: 'motion_movesteps',
        gesture: {blockId: 'copy', origin: {kind: 'workspace-duplicate', blockId: 'source'}},
        details: {oldLocation: {coordinate: {x: 40, y: 40}}, newLocation: {coordinate: {x: 300, y: 200}}}
    }]};
    expect(compileInteractionPlan(transaction, 'forward').kind).toBe('flyout-block-drag');
});

test('compiles an identified workspace clipboard create as a realistic paste', () => {
    const transaction = {
        id: 'transaction-clipboard-paste',
        targetId: 'sprite-a',
        targetRef: {name: 'Sprite1', isStage: false},
        events: [{
            type: 'create',
            blockId: 'pasted-root',
            blockType: 'control_repeat',
            interactionSource: {
                kind: 'workspace-clipboard',
                sourceBlockType: 'control_repeat',
                sourceBlockRef: {
                    ancestorId: 'source-root',
                    ancestorType: 'control_repeat',
                    ancestorCoordinate: {x: 140, y: 90},
                    path: []
                }
            },
            details: {
                xml: '<block type="control_repeat" x="208" y="216">' +
                    '<next><block type="looks_say"/></next></block>',
                ids: ['pasted-root', 'pasted-child']
            }
        }]
    };

    expect(compileInteractionPlan(transaction, 'forward')).toMatchObject({
        kind: 'clipboard-block-paste',
        targetRef: {name: 'Sprite1', isStage: false},
        sourceBlockType: 'control_repeat',
        sourceBlockRef: {ancestorId: 'source-root'},
        blockIds: ['pasted-root', 'pasted-child'],
        copiedBlockCount: 2,
        destination: {coordinate: {x: 208, y: 216}},
        presentation: {pointerTravel: true}
    });
    expect(compileInteractionPlan(transaction, 'backward')).toMatchObject({kind: 'semantic-only'});
    expect(compileInteractionPlan(transaction, 'forward', {presentationMode: 'history'}))
        .toMatchObject({kind: 'semantic-only'});
    transaction.events.push({
        type: 'move',
        blockId: 'pasted-root',
        blockType: 'control_repeat',
        details: {
            oldLocation: {parentId: null, inputName: null, coordinate: {x: 208, y: 216}},
            newLocation: {parentId: null, inputName: null, coordinate: {x: 420, y: 300}}
        }
    });
    expect(compileInteractionPlan(transaction, 'forward')).toMatchObject({
        kind: 'clipboard-block-paste',
        pasteCoordinate: {x: 208, y: 216},
        destination: {coordinate: {x: 420, y: 300}},
        placement: {
            kind: 'block-drag',
            blockId: 'pasted-root',
            destination: {coordinate: {x: 420, y: 300}},
            affectedBlocks: [{blockId: 'pasted-root'}]
        }
    });
    transaction.events.push({type: 'change', blockId: 'pasted-child'});
    expect(compileInteractionPlan(transaction, 'forward')).toMatchObject({kind: 'semantic-only'});
});
