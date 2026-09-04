# Spike 8: recorded viewport and stable stack framing

Date: 23 August 2026

## Result

Camera movement now has an explainable priority: restore how the author was viewing the transaction when that information exists; otherwise frame the edited stack consistently. Replay no longer centres whichever individual block happened to be the final event.

## Viewport contract

Each new transaction may store the visible workspace origin as `viewLeft` and `viewTop` in scale-independent workspace coordinates. Grouped Scratch events keep the viewport captured with their final event, after a dragged block has reached its authored destination. Replay converts that origin through the current scale and content metrics, so resizing the editor does not turn the stored values into fixed screen pixels.

Viewport data is optional presentation state. It does not affect Scratch project hashes, block action inversion or the version-1 journal compatibility boundary.

## Older-take fallback

Existing recordings have no viewport field. If their focal edit is already fully visible, replay preserves the outgoing view. Otherwise the focal block is resolved to its root stack and the root is placed 64 pixels from the top-left of the editing view. If the edited block would extend below or to the right of a 64-pixel safe margin, the root is allowed to move out of view only as far as needed to reveal that edit.

Undo and Delete retain the first root-and-focus frame observed before replay. This avoids following Scratch's temporary create position when reversing a grouped create-and-move action.

## Real-editor evidence

Persisted take `reliability-20260823-1` has no recorded viewport data:

- Full playback placed the final Sprite1 stack at the stable upper-left margins rather than in the canvas centre.
- Undo removed the nested `say [Ready!]` without changing that framing.
- Continuing Undo selected Abby and placed her `repeat (3)` stack at the same margins.

Fresh take `viewport-capture-20260823-1` recorded two grouped create-and-move transactions:

1. The canvas was deliberately panned between the two edits.
2. After the second edit, it was manually panned to a different location.
3. Undo removed the second block and restored that transaction's authoring viewport.
4. Redo recreated it in the same restored viewport.

## Smooth movement

Both recorded restoration and fallback framing calculate one final scrollbar target. Spike 10 adds bounded easing and preserves the outgoing view across sprite workspace switches without altering the journal or replay engine. See `SPIKE-10-SMOOTH-VIEWPORT-MOTION.md`.

## Upgrade boundary

The implementation remains contained in `scratch-blocks-viewport-port.js`, with optional viewport attachment in the Studio-owned journal and session modules. It uses public Scratch Blocks geometry, metrics and scrollbar interfaces and adds no TurboWarp-owned seam.

## High-zoom safe-frame refinement — 25 August 2026

Realistic Play now treats the current viewport as authoritative while the active stack remains inside a safe
editing frame. It does not return to a transaction's recorded authoring origin merely because one exists.
When live geometry breaches the frame, the camera unions the active stack with other top-level scripts which
already intersect the outgoing viewport. If that visible context fits, it composes the complete shot against
64-pixel top and left margins, retains editing room below and prefers a 64-pixel right margin. This avoids
wasting large safe-but-empty bands above or beside the scripts. Distant offscreen scripts are excluded. If the
context or complete active script cannot fit, the active/right edge wins and the root side may leave the frame.

Horizontal bounds use the union of the root's complete descendant tree rather than the root block's own
width. Regenerated reporters and shadows resolve through their durable ancestor/path reference, and a block
which does not exist yet normally frames from its recorded destination or destination parent. A custom
definition is the phase-aware exception: its future coordinate cannot move the camera during My Blocks and
modal interaction, so it frames only after the real OK action has created the rendered definition. Recorded
viewports remain the fallback when no live block or destination geometry can be resolved.
