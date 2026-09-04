# Risk-based verification

Updated 3 September 2026 at Andy's request. Select tests for the behaviour and
dependencies changed, not simply because a checkpoint is being published.
Keep the full suite available; do not delete coverage to shorten everyday runs.

## Default for a bounded change

1. Reproduce a reported fault and keep a focused regression where useful.
2. Run the affected unit files and changed-source lint/diff checks. Include direct
   callers when changing shared logic; do not automatically run every Studio,
   addon and Keyboard unit suite for styling or a local navigation rule.
3. Exercise the changed interaction in a real browser, plus its closest failure
   boundaries: for placement, this means preview/cancel/accept/native Undo/Redo;
   for focus, native field/menu/Finder handoff; for animation, painted frames.
4. Choose representative zoom, shape and nesting variants for the actual risk.
   Run a feature lane when the change spans that feature, or select exact cases
   with Jest's `--testNamePattern` for a smaller fix. Check that cases really ran.
5. Test the final built artifact. An unchanged, hash-identical copy does not need
   the same complete suite again merely because its port or folder changed.
   Smoke-check the served review and leave it available to Andy.

## When to widen the gate

- **Core browser contracts:** shared controller/key ownership, preview lifecycle,
  native event/connection integration, or a group of accumulated changes with
  interacting risks. Core is a representative integration gate, not every fix's
  mandatory companion to a feature lane.
- **Full Keyboard browser suite:** substantial refactors or dependency changes,
  broad behaviour changes, a planned integration/release checkpoint, or failures
  suggesting impact beyond the selected contracts.
- **Feature-disabled Studio suite:** changes to shared GUI/Blockly/VM/addon hooks
  or history paths that can affect ordinary Studio. Do not rerun it for isolated
  opt-in Keyboard geometry or CSS changes with no shared runtime changes.
- **Stress/performance cases:** changes on per-key, per-block, per-frame paths,
  caches or geometry walks. Prefer the existing representative dense fixture to
  unrelated browser workflows.

These are risk decisions, not exemptions from checking correctness. Expand when
evidence finds an unexpected interaction. Record what ran, what did not, and why.
Do not sum overlapping lanes as unique coverage or describe a subset as a full
regression pass. Full sweeps remain useful at deliberate integration checkpoints,
but not after each small edit, formatting pass or documentation update.

## Existing tools and safety

`scripts/run-keyboard-authoring-browser-gate.js list` lists existing lanes. Its
runner locks browser suites and rejects all-skipped runs. A custom Jest selection
must also check for active suites first and inspect the actual selected count.
Never overlap browser suites or rebuild a directory being tested. Preserve fixed
reviews, user projects and their running servers while using a separate candidate.

For the text-row/vertical-guide change, shared topology and free-block placement
justify the focused hat/tall-input/lane-memory/guide tests, a dense geometry check,
and existing structural/caret-spacing neighbours. A new complete Keyboard or
Studio browser sweep is not required. The already completed full source-unit run
is recorded, not repeated merely for publication.
