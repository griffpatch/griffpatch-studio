# Spike 9: arbitrary cursor reliability

Date: 23 August 2026

## Result

Every Undo depth in the 13-transaction, two-sprite reliability take now redoes to the exact canonical head. Partial `Play` from the previously failing deep cursor also validates.

## Cause

Transaction 10 detaches Sprite1's nested `if` stack and records its live Blockly position as `x: 161.629629...`. Scratch Blocks normally serializes a move event with `Math.round`, and Scratch project JSON therefore stores the top-level script at `x: 162`.

Studio's first snapshot copied the live floating-point coordinate. Its replay adapter then reconstructed that float instead of Scratch Blocks' serialized integer contract. A deep backward/forward sequence produced a visually indistinguishable script at canonical `x: 161`, so strict project hashing correctly rejected the head.

## Fix

- Snapshot capture rounds top-level move coordinates exactly as `Blockly.Events.Move.toJson()` does.
- Action creation repeats the normalization so already persisted floating-point takes are repaired during replay.
- Parent and input identity remain unchanged; connected moves have no coordinate to normalize.
- Hash validation remains strict.

The exact legacy value from the failing take is retained in a focused regression test and must produce replay coordinate `162,243`.

## Diagnostics

The project-state port can now retain a canonical head snapshot for the active session. On a mismatch, Studio reports the first differing JSON path and compact values; the diagnosis for this issue was:

```text
$.targets[2].blocks.g.x: expected 162, actual 161
```

The extra snapshot is session-only and is not added to the persisted journal.

## Real-editor evidence

Using persisted take `reliability-20260823-1`, which still contains its original floating-point coordinates:

1. Full base-to-head Play validated all 13 transactions and 23 events.
2. Undo 10 followed by partial Play reached the canonical head.
3. Complete Undo 13 followed by Redo 13 reached the canonical head across Abby and Sprite1.
4. Independent Undo/Redo round trips at every depth from 1 through 12 also reached the canonical head.

This covers every possible prefix cursor in the current fixture without rewriting its stored source journal.
