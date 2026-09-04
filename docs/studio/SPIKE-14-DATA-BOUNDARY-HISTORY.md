# Spike 14: data at visible history boundaries

Date: 23 August 2026

## Outcome

Tutorial Studio now records runtime changes to non-cloud variables and lists without exposing each script execution as an Undo step. Execution still marks authored data dirty. Studio compares data with its shadow only when the next visible Scratch transaction starts, or immediately before Undo or Rewind.

The resulting delta belongs to the preceding visible transaction. For example, if three authored setter blocks are clicked in turn to produce `30`, `45` and `90`, Undo moves through `45`, `30` and the base value while removing or reverting the corresponding block edit. The journal still reports three visible steps.

Data-only dirtiness no longer consumes a preparation command on the same sprite. Cross-sprite Undo and Redo retain the deliberate two-stage interaction: the first command selects and frames the other sprite; the second changes history.

## Transaction contract

A transaction may contain two optional arrays:

- `beforeDataDeltas`, applied before its block events;
- `afterDataDeltas`, applied after its block events.

Forward replay uses `before`, block events, then `after`. Backward replay reverses that order and each array. Multiple dirty intervals may remain separate internally while the transaction remains one visible tutorial step. Existing journals without either field replay unchanged.

Scalar changes store the exact before and after value. A list change stores one prefix/suffix-minimized splice: its starting index, removed items and inserted items. Deleting an item from the middle therefore does not duplicate the unchanged tail. Replay validates the expected scalar or list segment before mutation and stops on drift.

## Performance and containment

No VM primitive, compiler path or list operation is wrapped. A runtime event sets one dirty flag; `vm.toJSON()` is compared only at a visible boundary and only while dirty. This keeps ordinary block editing and running projects off the snapshot path.

Pure diff/application logic lives in `src/studio/state/data-state-delta.js`. Replay ordering remains VM-independent. Direct VM value application and execution-event listeners remain contained in `src/studio/bridge/authored-state-port.js`, so this slice adds no upstream-owned changes.

Checkpoint restoration can regenerate the complete block-ID graph. New snapshots therefore carry an optional root locator (type and rounded workspace coordinate) followed by named input or next-block steps. Replay uses the current ID as a fast path, otherwise resolves the restored workspace child from that locator and mirrors the current child ID into the VM. The reference is additive for journal compatibility, and ID repair remains contained in the bridges that already know the Scratch representations.

## Compatibility

The journal stays at schema version 1 because the transaction fields are optional and additive. Parsing validates any present data-delta arrays and their own schema version. Cloud variables remain excluded to avoid replay causing network writes. New takes use `structural-v2`: it retains monitor definitions and layout but excludes their runtime `value`, matching the existing exclusion of variable and list contents. Explicit `structural-v1` takes retain their original hash projection for compatibility; `Set Base` upgrades them to the preferred contract.

## Verification

- Studio suite: 89 tests passing.
- Focused Studio lint: passed.
- Production webpack build: passed.
- Live setter/reporter history: recording `30`, `45`, `90` produced three steps and three events. Undo reported `45`, `30`, `0`; Redo reported `30`, `45`, `90` without an extra data-only preparation command.
- Live full-reload playback: a new tab restored the base checkpoint as `ready to play`, then replayed to `played` with both the setter and reporter at `90`.
- Unit coverage includes scalar round trips, middle-list splices with a 1,000-item unchanged tail, definition drift, wrong-state rejection, transaction ordering, persistence, portable restored-block references and the visible-step Undo/Redo contract.

## Deliberately deferred

- direct variable-monitor, slider and list-cell edits as explicit coalesced transactions;
- adaptive content-addressed payloads for large arbitrary list rewrites;
- variable/list definition events;
- sprite lifecycle and stable Studio target identities;
- persisted target properties as semantic timeline actions.
