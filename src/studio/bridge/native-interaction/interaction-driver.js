import {createScratchBlocksDragDriver} from './scratch-blocks-drag-driver';
import {createScratchBlocksBroadcastDriver} from './scratch-blocks-broadcast-driver';
import {createScratchBlocksFieldDriver} from './scratch-blocks-field-driver';
import {createScratchBlocksProcedureDriver} from './scratch-blocks-procedure-driver';
import {createScratchBlocksVariableDriver} from './scratch-blocks-variable-driver';
import {createScratchBlocksClipboardDriver} from './scratch-blocks-clipboard-driver';
import {createProjectLibraryDriver} from './project-library-driver';
import {createProjectTargetOperationDriver} from './project-target-operation-driver';
import {createSoundLifecycleDriver} from './sound-lifecycle-driver';
import {createSpriteLifecycleDriver} from './sprite-lifecycle-driver';
import {createCostumeLifecycleDriver} from './costume-lifecycle-driver';
import {createScratchBlocksCommentDriver} from './scratch-blocks-comment-driver';
import {createPaintGestureDriver} from './paint-gesture-driver';

const isCommentPlan = kind => /^(?:block|workspace)-comment-(?:create|text|delete|minimize|resize|move)$/.test(kind);

const createInteractionDriver = options => {
    const blockDriver = createScratchBlocksDragDriver(options);
    const broadcastDriver = createScratchBlocksBroadcastDriver(options);
    const fieldDriver = createScratchBlocksFieldDriver(options);
    const libraryDriver = createProjectLibraryDriver(options);
    const targetOperationDriver = createProjectTargetOperationDriver(options);
    const soundLifecycleDriver = createSoundLifecycleDriver(options);
    const spriteLifecycleDriver = createSpriteLifecycleDriver(options);
    const costumeLifecycleDriver = createCostumeLifecycleDriver(options);
    const commentDriver = createScratchBlocksCommentDriver(options);
    const paintGestureDriver = createPaintGestureDriver(options);
    const procedureDriver = createScratchBlocksProcedureDriver(options);
    const variableDriver = createScratchBlocksVariableDriver(options);
    const clipboardDriver = createScratchBlocksClipboardDriver({...options, blockDriver});
    return {
        cleanup: plan => {
            if (plan.kind === 'variable-create-dialog' || plan.kind === 'variable-rename-dialog' ||
                plan.kind === 'variable-delete-dropdown') return variableDriver.cleanup();
            if (plan.kind === 'broadcast-create-dialog') return broadcastDriver.cleanup();
            if (plan.kind === 'custom-procedure-dialog') return procedureDriver.cleanup();
            if (plan.kind === 'block-field-edit') return fieldDriver.cleanup();
            if (isCommentPlan(plan.kind)) return commentDriver.cleanup();
            return false;
        },
        play: (plan, signal = null) => {
            if (plan.kind === 'sprite-library-select' || plan.kind === 'costume-library-select' ||
                plan.kind === 'backdrop-library-select' || plan.kind === 'sound-library-select' ||
                plan.kind === 'sound-effect-click' || plan.kind === 'sound-file-upload' ||
                /^(?:costume|backdrop)-(?:file-upload|paint-create)$/.test(plan.kind)) {
                return libraryDriver.play(plan, signal);
            }
            if (plan.kind === 'sound-duplicate-click' || plan.kind === 'sound-rename-input' ||
                plan.kind === 'sound-delete-click' || plan.kind === 'sound-reorder-drag') {
                return soundLifecycleDriver.play(plan, signal);
            }
            if (plan.kind === 'sprite-duplicate-click' || plan.kind === 'sprite-rename-input' ||
                plan.kind === 'sprite-delete-click') {
                return spriteLifecycleDriver.play(plan, signal);
            }
            if (/^(costume|backdrop)-(duplicate-click|rename-input|delete-click|reorder-drag)$/.test(plan.kind)) {
                return costumeLifecycleDriver.play(plan, signal);
            }
            if (/^(costume|backdrop)-(?:brush-stroke|convert-to-(?:bitmap|vector))$/.test(plan.kind)) {
                return paintGestureDriver.play(plan, signal);
            }
            if (isCommentPlan(plan.kind)) {
                return commentDriver.play(plan, signal);
            }
            if (plan.kind === 'sprite-reorder-drag' || plan.kind === 'cross-sprite-script-drag' ||
                plan.kind === 'backpack-script-drag') {
                return targetOperationDriver.play(plan, signal);
            }
            if (plan.kind === 'block-field-edit') return fieldDriver.play(plan, signal);
            if (plan.kind === 'broadcast-create-dialog') return broadcastDriver.play(plan, signal);
            if (plan.kind === 'variable-create-dialog' || plan.kind === 'variable-rename-dialog' ||
                plan.kind === 'variable-delete-dropdown') return variableDriver.play(plan, signal);
            if (plan.kind === 'custom-procedure-dialog') return procedureDriver.play(plan, signal);
            if (plan.kind === 'clipboard-block-paste') return clipboardDriver.play(plan, signal);
            return blockDriver.play(plan, signal);
        }
    };
};

export {createInteractionDriver};
