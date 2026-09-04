import {resolvePlaybackBlockId} from './playback-block-resolver';
import {createElementPointerTarget} from './pointer-target';
import {combinePointerTravels, dispatchMouseSelection} from './dom-interaction';
import {activateThroughPointer} from './pointer-activation';

const eventAt = (type, point, target) => ({
    type,
    button: 0,
    clientX: point.x,
    clientY: point.y,
    target,
    preventDefault: () => {},
    stopPropagation: () => {}
});

const openFieldThroughGesture = ({workspace, block, field, point, scope}) => {
    const target = field.getSvgRoot();
    const downEvent = eventAt('mousedown', point, target);
    const gesture = workspace.getGesture(downEvent);
    if (!gesture) throw new Error('Scratch Blocks refused the field click gesture');
    scope.runWithoutUndo(() => {
        gesture.setStartField(field);
        gesture.handleBlockStart(downEvent, block);
        gesture.handleWsStart(downEvent, workspace);
        gesture.handleUp(eventAt('mouseup', point, target));
    });
};

const createScratchBlocksDropdownDriver = ({workspace, ScratchBlocks, clock, pointer, scope, aliases = new Map()}) => ({
    play: async (plan, signal = null) => {
        if (workspace.currentGesture_) throw new Error('Cannot open a dropdown during an active gesture');
        const blockId = resolvePlaybackBlockId(workspace, plan, aliases);
        const sourceValue = aliases.get(plan.sourceValue) || plan.sourceValue;
        const value = aliases.get(plan.value) || plan.value;
        const block = workspace.getBlockById(blockId);
        if (!block) throw new Error(`Dropdown playback block is missing: ${plan.blockId}`);
        const field = block.getField && block.getField(plan.fieldName);
        if (!field || !(field instanceof ScratchBlocks.FieldDropdown)) {
            throw new Error(`Recorded field is not a dropdown: ${plan.fieldName}`);
        }
        if (field.getValue() !== sourceValue) {
            throw new Error(`Dropdown source value differs: ${plan.fieldName}`);
        }
        const optionIndex = field.getOptions().findIndex(option => option[1] === value);
        if (optionIndex < 0) {
            throw new Error(`Dropdown option is unavailable: ${plan.fieldName}=${value}`);
        }

        const fieldTravel = await pointer.travelTo(createElementPointerTarget({
            id: `field:${blockId}:${plan.fieldName}`,
            kind: 'block-field',
            locate: () => field.getSvgRoot()
        }), {clock, signal});
        if (!fieldTravel.completed) {
            return {cancelled: true, frames: [], resolvedPlan: plan, pointerTravel: fieldTravel};
        }
        const fieldClickCompleted = await activateThroughPointer({
            pointer,
            clock,
            signal,
            activate: () => openFieldThroughGesture({
                workspace,
                block,
                field,
                point: fieldTravel.target.point,
                scope
            })
        });
        if (!fieldClickCompleted) {
            return {cancelled: true, frames: [], resolvedPlan: plan, pointerTravel: fieldTravel};
        }
        const menuVisibleBeforeClick = ScratchBlocks.DropDownDiv.isVisible();
        if (!menuVisibleBeforeClick) throw new Error(`Dropdown did not open: ${plan.fieldName}`);
        const menuItems = ScratchBlocks.DropDownDiv.getContentDiv().querySelectorAll('.goog-menuitem');
        const optionElement = menuItems[optionIndex];
        if (!optionElement) throw new Error(`Dropdown option did not render: ${plan.fieldName}=${plan.value}`);

        const optionTravel = await pointer.travelTo(createElementPointerTarget({
            id: `dropdown-option:${blockId}:${plan.fieldName}:${value}`,
            kind: 'dropdown-option',
            locate: () => optionElement
        }), {clock, signal});
        const pointerTravel = combinePointerTravels({field: fieldTravel, option: optionTravel});
        if (!optionTravel.completed) {
            ScratchBlocks.DropDownDiv.hideWithoutAnimation();
            return {cancelled: true, frames: [], resolvedPlan: plan, pointerTravel};
        }
        const optionClickCompleted = await activateThroughPointer({
            pointer,
            clock,
            signal,
            activate: () => scope.runWithoutUndo(() => dispatchMouseSelection(
                optionElement,
                optionTravel.target.point
            ))
        });
        if (!optionClickCompleted) {
            ScratchBlocks.DropDownDiv.hideWithoutAnimation();
            return {cancelled: true, frames: [], resolvedPlan: plan, pointerTravel};
        }
        return {
            cancelled: false,
            frames: [],
            resolvedPlan: {...plan, blockId, sourceValue, value},
            pointerTravel,
            menuVisibleBeforeClick,
            optionIndex,
            optionValue: value
        };
    }
});

export {createScratchBlocksDropdownDriver};
