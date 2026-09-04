# Spike 5: real-workspace reliability gate

Date: 23 August 2026

## Result

The block journal passed 100 consecutive rewind/play cycles through a real Scratch Blocks workspace. Every rewind matched the canonical base-project hash and every playback matched the persisted end-project hash. No replay exception occurred.

## Fixture

Persisted take `reliability-20260823-1` starts from a checkpoint containing Sprite1 and Abby. Sprite creation happened before `Set Base`, because target lifecycle events remain outside the block journal.

The take contains 13 user steps and 23 internal Scratch events:

- Abby: green-flag event, `repeat (3)` and a nested turn block;
- Sprite1: green-flag event and an `if <touching mouse-pointer?>` containing `say [Ready!]`;
- a field-value correction;
- detaching and reattaching the complete nested `if` stack; and
- deleting and restoring the nested `say` block through Scratch undo.

The block placements were verified structurally: child blocks moved with their parent rather than merely overlapping it.

## Procedure

1. Rewound and played the newly recorded take once.
2. Loaded the persisted take in a fresh editor page and played it to validate the stored end hash.
3. Closed the recording page so only one session owned the take.
4. Ran 100 consecutive cycles. Each cycle required `rewound · 13 steps (23 events)` followed by `played · 13 steps (23 events)`; the run stopped immediately on any other result.

The normal rewind time was approximately 3.86 seconds and normal playback approximately 3.46 seconds. Cycle 64 had one 8.5-second rewind outlier, but its base hash matched, its playback matched the end hash and every later cycle returned to the normal range. Treat this as a performance observation, not a correctness failure.

## Boundary

This proves repeatability for block operations across existing sprites. It does not prove sprite create, duplicate, rename or delete replay; those need explicit semantic timeline events. Comment attachment, assets, paint, sound and pointer presentation also remain outside this gate.

## Next slice

Build the first editable transaction timeline over this proven journal: inspect steps, disable a step and replace a bounded span while retaining immutable source evidence and checkpoint/hash validation.
