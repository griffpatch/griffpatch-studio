# Spike 2 semantic replay core

Date: 23 August 2026

## Purpose

Establish the smallest reusable foundation for persistent, editable playback before adding timeline controls or a synthetic pointer.

## Implemented

- versioned JSON journal with immutable append operations;
- adjacent transaction grouping by Scratch Blocks group and target ID;
- injected journal store and reloadable recorder;
- explicit forward and backward action construction for create, delete, change and move events;
- sequential transaction and journal replay;
- one bridge that applies actions through Scratch Blocks and mirrors them to the VM;
- an optional capture sink so the recorder can be connected to persistence without another upstream hook.

The backward path does not use Scratch Blocks' undo stack. It reconstructs the opposite forward action from captured inverse data.

## Verification

The Studio suite contains 6 suites and 21 tests. It covers journal round-tripping, persistence after every snapshot, grouping boundaries, all four block action types, target selection, Scratch Blocks event restoration after failure, VM mirroring, and 100 forward/backward executor cycles.

The 100-cycle test proves the Studio ordering and direction contracts. It does not yet prove 100 cycles through a real Scratch Blocks workspace.

## Reuse decision

TurboWarp's restore-point API is the leading checkpoint backend because it already persists project JSON and deduplicated assets. Studio will not add a second binary-project IndexedDB implementation without first testing whether that API can be extended through a small registered seam.

## Next vertical slice

Connect a fresh browser recording to the journal recorder, create a starting restore point, rewind and replay the journal in the real editor, then compare canonical project state. Only after that passes repeatedly should playback controls and pointer cues be added.
