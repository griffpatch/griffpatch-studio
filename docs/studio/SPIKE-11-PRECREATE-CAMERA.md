# Spike 11: camera before offscreen creation

Date: 23 August 2026

## Result

When replay is about to create a block outside the current editing view, Studio can move the camera to the authored destination before revealing the block. On-screen creations keep the normal transaction flow.

## Destination resolution

The pre-create camera runs after the correct sprite workspace is selected but before the Scratch create event. It resolves the intended anchor in this order:

1. the block's final move destination in the current replay direction;
2. the destination parent block for a nested insertion; or
3. the top-level `x` and `y` retained in Scratch's serialized create XML.

The transaction's recorded viewport is the preferred camera target. Older takes without viewport data frame the resolved anchor from the existing safe margin.

## Presentation policy

`createScratchBlocksViewportPort` accepts an explicit `preCreateMode`:

- `wait` moves first and applies the create event after the camera arrives; this is the current default;
- `concurrent` starts the movement without delaying creation, but finishes it before the next transaction; and
- `off` leaves creation timing unchanged and uses only normal after-transaction framing.

This setting is passed through the Studio session boundary and is not persisted in the take. A later timeline or export profile can therefore choose it without migrating journals.

## Scratch workspace resizing

Creating a top-level block changes Scratch Blocks' content bounds and scrollbar geometry. Retaining the pre-create scrollbar pixels therefore caused both insertion jitter and a second correction. Studio instead retains the chosen scale-independent workspace origin, converts it through the new bounds after insertion and re-anchors it synchronously.

Legacy fallback framing also preserves the outgoing view whenever the affected block is already fully visible. This prevents small safe-margin adjustments from becoming unexplained movement between nearby edits.

## Real-editor evidence

The canvas in `reliability-20260823-1` was manually moved far away while its base workspace contained no blocks. During playback:

- multiple sampled intermediate camera positions occurred while the workspace block count remained zero;
- the first block appeared only after the camera reached the destination;
- the canvas remained at that target when the block appeared, with no insertion snap;
- every later sampled create, delete and edit retained the identical canvas transform; and
- the complete 13-transaction, 23-event playback still finished as `played` under strict project validation.

## Compatibility boundary

The feature adds no journal field and changes no TurboWarp-owned source file. Offscreen detection and policy live entirely in the viewport bridge, while interpolation and exact re-anchoring remain in the Scratch-independent motion controller.
