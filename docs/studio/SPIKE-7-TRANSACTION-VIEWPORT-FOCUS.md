# Spike 7: transaction viewport focus

Date: 23 August 2026

This report records the first centring experiment. Its camera policy was replaced by recorded viewport restoration and deterministic stack framing in `SPIKE-8-RECORDED-VIEWPORT.md`.

## Result

Studio replay now keeps the block being edited in view after each complete user transaction. Create-and-move groups no longer leave the workspace focused on Scratch's temporary creation position, and Undo/Delete can retain the location of a block after removing it.

## Behaviour

For each replayed Scratch undo group:

1. The last recorded block event identifies the focal block.
2. After the correct sprite workspace is visible, Studio retains the first centre position where that block exists.
3. All internal create, move, change or delete events run without presentation pauses.
4. If the focal block exists at the end, Studio uses Scratch Blocks' `centerOnBlock` method.
5. If it was removed, Studio centres the retained workspace position using the current workspace metrics.

The position is captured once rather than after every internal event. When a create-and-move transaction runs backwards, this preserves the authored destination before Scratch detaches the block, moves it to its temporary creation point and deletes it.

Viewport position is not stored in the journal and does not affect project hashes. It is derived presentation state over the semantic transaction, so future pointer overlays and camera easing can replace the presentation without changing recorded project history.

## Real-editor evidence

Using persisted take `reliability-20260823-1`:

- Full playback finished with the final Sprite1 script centred and the canonical end hash matched.
- The workspace was manually panned until the script was almost outside the bottom-right of the editing canvas.
- Ctrl+Z removed the restored nested `say [Ready!]` and centred the empty slot where the block had been.
- Ctrl+Y recreated the nested block and centred its final position.
- Nine further Undo commands crossed from Sprite1 into Abby, selected Abby and centred her affected `repeat (3)` script.

## Upgrade boundary

The implementation is isolated in `scratch-blocks-viewport-port.js` and generic transaction hooks in `replay-engine.js`. No TurboWarp or Scratch-owned source file changed. The adapter depends on the public Scratch Blocks workspace methods `getBlockById`, `centerOnBlock`, `getMetrics` and the existing scrollbar interface.

## Separate history observation

The viewport checks exposed an intermediate-history integrity case: a deep Undo/Redo path returned a visually identical head with a project-hash mismatch. Spike 9 traced this to floating-point Blockly drag coordinates crossing Scratch's integer serialization boundary, fixed it for new and legacy journals, and verified every cursor depth in the reliability take.

## Next refinement

The current movement is immediate. A timeline presentation layer can later add bounded camera easing, safe margins and an optional manual-camera override through this port without changing replay correctness or journal schema.
