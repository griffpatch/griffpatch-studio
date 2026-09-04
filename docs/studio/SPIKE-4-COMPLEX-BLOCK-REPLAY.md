# Spike 4: nested and multi-sprite replay

Date: 23 August 2026

## Result

The real editor can record and replay structurally nested blocks. It can also replay block journals across existing sprites. Sprite lifecycle operations are not yet journal events, so a multi-sprite take must currently establish its base after the sprites exist.

## Correct nesting evidence

An earlier browser attempt only overlapped blocks visually and is not counted as a pass. Scratch positions a dragged block relative to its original grab point. The reliable method is therefore:

1. Grab near the source block's top-left corner.
2. Preserve that pointer-to-corner offset during the drag.
3. Align the dragged block's top-left corner with the statement or Boolean input target.
4. Verify attachment by moving the parent C-block, not by judging overlap.

Take `nested-final-20260823-4` recorded an `if <touching mouse-pointer?> then` containing `say [Hello!]`. Moving the `if` moved both children with it. The 11-event journal then produced:

- `rewound · 11 events` against its base hash;
- `played · 11 events` against its end hash;
- `played · 11 events` after a full page reload; and
- three further rewind/play cycles with matching base and end hashes.

The end hash is now persisted in the journal, so the reload result is a real validation rather than an unchecked playback.

Scratch recorded those 11 internal events in six undo groups. Playback now treats the six groups as tutorial steps and applies every event within a group without a presentation delay. This keeps create-and-position event pairs for exact replay without showing the block's temporary creation position as a separate step. The live take reports `6 steps (11 events)` and completes its five 300 ms inter-step gaps in approximately 1.7 seconds.

## Multi-sprite findings

A two-sprite take exposed two bridge timing problems:

- Workspace restoration events queued by Scratch could arrive just after capture resumed and pollute the journal. Resume is now deferred until that queue has flushed.
- Replay selected a target and immediately sent its block event. It now waits for Scratch's `workspaceUpdate` before applying the action.

With those fixes, switching between existing sprites neither adds restoration noise nor sends events to the previous sprite's workspace.

Creating a sprite during a block-only take still causes a rewind hash mismatch because the sprite remains after the blocks rewind. `Set Base` provides an explicit checkpoint boundary for current testing; proper sprite lifecycle events remain required for an editable production timeline.

## Remaining reliability work

- Add semantic events for sprite create, duplicate, rename and delete.
- Cover nested delete/restore and comment attachment in the real editor.
- Add timeline editing without weakening checkpoint and end-hash validation.
