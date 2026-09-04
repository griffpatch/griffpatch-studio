# Tutorial Studio

This directory owns the Tutorial Studio implementation.

## Boundary rule

Only modules under `src/studio/bridge/` may depend directly on unstable TurboWarp GUI, VM or Scratch Blocks internals. Journal, checkpoint, replay, validation and pointer modules should consume versioned Studio contracts instead.

Existing upstream-owned files must contain only small calls into the bridge. Every such call is registered in `docs/studio/UPSTREAM-SEAMS.md` and protected by a focused test under `test/studio/`.

## Implemented slices

- Live capture copies complete, invertible block events before Scratch Blocks discards inverse fields.
- The semantic core groups events into user transactions, serializes a versioned journal and converts either replay direction into forward-running editor actions.
- Playback paces Scratch undo groups as user steps; internal events within a group execute atomically.
- A checkpoint-backed browser session can record nested block edits, rewind to its canonical base state and play forward with persisted end-state validation after a separate editor load.
- Target selection waits for Scratch's workspace update before applying an event, and queued workspace events remain suppressed while switching sprites.
- `Set Base` starts a clean take from the current project through the existing session contract.
- A persisted 13-step, two-sprite fixture completes 100 real-workspace rewind/play cycles with exact base and end hashes.
- Scratch user Undo/Redo commands traverse the persisted transaction journal, preparing a cross-sprite target and view on the first command before applying it on the second.
- New takes validate structural state separately from runtime-mutated values; existing full-hash takes remain compatible.
- Runtime execution dirties an authored shadow without per-variable/list instrumentation, and the first Undo/Redo restores that shadow before history moves.
- Direct scalar-slider and list-monitor edits become compact gesture-coalesced visible history steps, while list create, rename and delete events retain the definition, value and monitor needed for round trips.
- Loading or creating another project invalidates the active take without clearing it; reloading returns to its checkpoint.
- Every cursor depth in the 13-step reliability take round-trips to the canonical head.
- Keyboard and workspace context-menu commands are adapted without replacing Scratch Blocks' internal `workspace.undo()` method.
- Realistic Play preserves a safe current viewport; when a correction is required it composes the active stack with other currently visible scripts at useful top-left margins, excludes distant scripts, and falls back to active-edit framing when the context cannot fit.
- Missing palette blocks reserve their rendered footprint before camera movement; connected flyout drags map independent flyout/workspace scales into client pixels and approach around the visible stack instead of crossing intermediate connections.
- Camera movement preserves the outgoing view across sprite workspace switches, scales with the selected timeline speed and remains replaceable by a future editable camera track.
- Native drags perform one destination camera correction before pointer travel; Escape stops realistic Play at a rollback-safe cursor and a later Play resumes from it.
- Offscreen block creation can wait for the camera, move concurrently or disable pre-create movement without changing recorded takes.
- Reaching cursor zero restores the canonical base checkpoint even when the project hash already matches, so Rewind is also a rendered-workspace reset.
- Browser, VM and Scratch Blocks dependencies remain behind bridge ports.

The implementation does not yet claim persisted adaptive list payloads, arbitrary paint/waveform editing or operating-system input injection. It now includes exact labelled timeline seek/transport, sprite/costume/backdrop/sound lifecycle history, reversible sprite-property edits and direct non-cloud scalar-slider gestures; several of those semantic operations still need recording-quality UI presentation. Realistic Play currently covers centre-targeted pointer presentation with spring rotation, click compression and a two-second idle hold followed by a short fade, flyout block creation, dropdowns, variable, broadcast-message and custom-block dialogues, built-in sprite/costume/backdrop/sound library selection, sound file upload/effects/duplicate/rename/delete/reorder and supported target switching. The floating controls remain a disposable spike UI over the session contract.

The prioritized capability audit and implementation sequence are maintained in
`docs/studio/ROADMAP.md`.

For manual camera stress testing only, add `studio-camera-fixture=long-script` to a fresh take and use the optional `Seed Camera` control. It creates three separate script regions as 19 ordinary recorded steps, including a vertical stack which exceeds the viewport near 300% zoom.

## Current continuation

The native Blockly interaction work and its browser evidence are in
`docs/studio/SPIKE-17-NATIVE-BLOCKLY-INTERACTION-HANDOFF.md`. Semantic replay remains authoritative;
the next product slice is verified timeline transport over that existing cursor, followed by the missing
full-Scratch semantic actions listed in the roadmap.
