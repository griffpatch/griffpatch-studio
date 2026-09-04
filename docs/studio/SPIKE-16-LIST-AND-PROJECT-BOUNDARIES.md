# Spike 16: List history and project boundaries

Date: 23 August 2026

## Outcome

Tutorial Studio now records deliberate edits made through a visible Scratch list monitor and can round-trip list creation, rename and deletion. File → New or another external project load no longer leaves stale Undo/Redo controls pointed at the previous project.

## List value history

Scratch's list monitor assigns values through `src/lib/variable-utils.js`; it does not emit a Blockly block event. The optional GUI-003 hook surrounds that existing assignment only while a Studio session is active. Studio stores a prefix/suffix-minimized splice:

- typing does not add a step until the list input commits;
- add, remove and import each add one step;
- Enter's item commit and blank-row insertion share one step; and
- Undo/Redo applies the splice and immediately refreshes the visible monitor.

Runtime script changes still follow the earlier dirty-boundary policy and remain folded into a neighbouring visible action. They are not exposed as a stream of invisible Undo steps.

## List definition history

Scratch Blocks supplies `var_create`, `var_delete` and `var_rename` events, but deletion reaches Studio after the VM has already removed the value and monitor. `list-definition-port.js` therefore holds one compact shadow per list: ID, owner reference, name, value, monitor block and monitor record. Direct and replayed data deltas keep that shadow current.

Creation capture waits one Blockly queue turn so Scratch's automatic visible monitor is included. Replay recreates the Blockly and VM definition first, then restores its value and monitor metadata. Deletion groups naturally with any block-deletion events in Scratch's undo group.

## Project replacement policy

The session attaches its `PROJECT_LOADED` listener only after initialization. Checkpoint repair runs inside an expected-load scope. Any later unscoped load:

1. flushes accepted pending capture;
2. pauses further recording;
3. marks the playback position incompatible;
4. preserves the persisted take and checkpoint; and
5. disables Set Base, Rewind and Play with `project replaced — reload to return to this take`.

Reloading the same `studio-take` URL restores the saved base normally.

## Verification

- Studio unit suite: 103 tests passed.
- Focused Studio lint passed.
- Real editor, fresh take: list create, add and committed `alpha` edit recorded as three steps; Undo changed the visible item to blank and Redo restored `alpha`.
- Real editor, fresh take: full Undo removed the created list; Redo recreated its visible empty monitor and replayed the item history without a state mismatch.
- Real editor, fresh take: deleting the populated `alpha` list added one step; Undo restored the list, monitor and value; Redo removed it cleanly.
- Real editor: File → New preserved the four-step take, displayed the project-replacement status and disabled all three spike controls.

Direct scalar-slider and sprite-property history were completed in later milestones. Adaptive storage for unusually large rewritten lists remains open; media editors and the remaining target properties remain separate semantic slices.
