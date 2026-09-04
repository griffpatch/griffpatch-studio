# Spike 17 gate 1: existing-workspace command rearrangement

Date: 23 August 2026
Result: pass; the pinned Scratch Blocks package API is sufficient for the first gate
Scope: repeated forward/backward existing-block drags and Play in the real editor; nested inputs, flyout creation and fields were deliberately not started

## Implemented slice

The removable implementation lives under `src/studio/bridge/native-interaction/` and is enabled only by the existing `?studio-session=1` boundary. It adds:

- a transaction planner which accepts one dominant existing-block move and its induced connection moves, while rejecting other transaction shapes before mutation;
- live recorded-to-workspace ID aliasing using block type and durable parent references;
- one animation clock feeding exactly the same client coordinates to the overlay pointer and Blockly gesture;
- the pinned `getGesture` → `forceStartBlockDrag` → `handleMove` → `handleUp` route;
- scoped `Events.recordUndo = false`, restored in `finally` around every synchronous gesture call without disabling event delivery;
- a pointer/keyboard input shield, temporary event observer and deterministic cleanup;
- bounded event settling followed by affected workspace and VM topology checks;
- journal and native Undo/Redo stack identity/depth checks; and
- a Redo cursor gate. Unsupported transactions still select the semantic executor before mutation. A
  mismatch leaves the cursor unchanged and restores the exact pre-command safety boundary; capture
  resumes unless restoration itself fails.

Play and backward history now use the native port for supported single-block drags. An inverse with
induced block moves is rejected before mutation and remains semantic-only because it requires more than
one genuine gesture. Flyout creation, nested reporter/Boolean placement and field interaction remain
semantic-only.

## Repeated traversal extension — 24 August 2026

A two-transaction real-editor fixture moved one tail command block between two connected stacks twice.
Two consecutive Undo commands, two consecutive Redo commands, and panel Play all completed with native
evidence `verified`. History preparation and the transaction now run in the same command, and Play uses
the same per-transaction native-or-semantic route as Redo rather than the journal-wide semantic path.

The extension passed 24 Studio suites / 119 tests, focused Studio ESLint, and the production build.

## Recovery and project-operation extension — 24 August 2026

The shared Undo/Redo/Play route now treats sprite creation and cross-target costume sharing as exact
checkpoint-backed history steps. It also verifies recorded block parent/input topology in both Blockly
and the VM after every block transaction. A mismatch rolls back before control returns to the user.

External project replacement is a deliberate hard reset: File → New becomes the fresh zero-step base,
and the old take is discarded rather than offered as cross-project Undo. Focused verification now
covers 26 Studio suites / 129 tests.

## Real-editor fixture

Take: `native-interaction-gate-20260823e`
URL: `http://127.0.0.1:8601/editor.html?studio-session=1&studio-take=native-interaction-gate-20260823e`

The base contained one three-block command stack with three distinct block types. The bottom turn block was recorded moving into the middle of the stack. Studio semantic Undo restored the base; Ctrl+Shift+Z then ran the forward transaction through the native interaction port.

Final panel state was `redone · 1 steps (4 events)`. Instrumented evidence retained by `#tw-studio-native-evidence` reported:

| Boundary | Evidence |
|---|---|
| shared pointer/Blockly path | 37 frames; 25 distinct positions; first `(423.09, 264.57)`, last `(423.09, 232.17)`; every pair identical |
| genuine connection presentation | `InsertionMarkerManager` marker/highlight present for 37 rendered gesture frames; the captured live frame shows the red Studio pointer over the visible insertion gap |
| normal Blockly events | UI selection, top-level move, end-drag, induced child move and final parent connection observed through the temporary listener |
| workspace topology | dragged block parent matched the recorded top block; displaced block parent matched the dragged block |
| VM topology | the same two parent relations matched in `vm.editingTarget.blocks` |
| Studio capture | remained at 1 step / 4 events before and after playback |
| native Undo/Redo | both stacks remained at depth 0 with unchanged contents |
| cursor/canonical head | native status `verified`; full canonical head validation passed; cursor advanced exactly once |
| Studio-off path | plain `/editor.html` exposed no Studio panel and no native pointer |

## Safeguards exercised while reaching the gate

The failed fixture iterations were kept as separate take IDs and demonstrated the intended stops:

- a four-event rearrangement was initially rejected as ambiguous before native mutation;
- a missing live destination parent stopped before gesture acquisition;
- a post-state block reference selected the wrong pre-state block, which the canonical head rejected;
- an inconsistent affected-parent alias was rejected by both workspace and VM verification before cursor advancement; and
- the final shared recorded-to-live alias map passed both transaction-level and canonical-head checks.

These failures motivated durable parent references, captured semantic block types and one alias map for the whole affected scope. Duplicate live candidates remain unsupported rather than guessed.

## Owned verification

```text
24 Studio suites passed
117 Studio tests passed
focused Studio lint passed
production build passed
```

New focused coverage includes planning and ambiguity rejection, global Undo restoration, journal/stack pollution detection, pointer/Blockly coordinate identity, recorded-to-live affected-parent aliasing, cleanup after cancellation/mismatch, unsupported-before-allocation behaviour, and verified/mismatch cursor gating.

## Decision

Proceed to the handoff's nested-input phase in a later slice. The package-level gesture seam is strong enough: it constructed the real dragger and marker, delivered normal events to the VM and preserved both history systems. No Scratch Blocks fork or upstream hook is justified at this gate.

Stop here as required by the first decision gate. Before expanding, retain the same transaction-level cursor gate and add connection-shape-specific destination resolution for one round reporter and one Boolean reporter independently.
