# Spike 13: authored and runtime state

Date: 23 August 2026

## Outcome

Tutorial Studio now distinguishes project structure from values that Scratch scripts can mutate while running. New recordings use a labelled `structural-v1` hash. Existing version-1 recordings without a hash label retain their original full-project validation contract.

An authored-state bridge captures non-cloud scalar values, list contents and persisted target properties at an explicit base boundary. Green-flag starts, running threads and clicked scripts mark that state dirty. The bridge does not wrap data primitives, compiler output or every list mutation.

When Undo or Redo encounters dirty runtime state, its first command:

1. stops the VM and removes clones through the normal VM stop path;
2. restores and verifies the authored shadow;
3. selects and frames the transaction target if necessary;
4. leaves the Studio history cursor unchanged.

The next command performs the history transaction. Full Rewind restores dirty runtime state as part of its existing single operation. `Set Base` stops execution before explicitly adopting the current values as the new authored state.

## State projections

Structural validation retains:

- blocks and comments;
- target, variable, list and broadcast definitions;
- costumes, sounds and project assets;
- monitors, extensions and project metadata.

It excludes:

- scalar and list contents;
- current costume, volume and layer order;
- sprite position, direction, size, visibility, draggability and rotation style;
- persisted stage runtime properties such as tempo and video state.

Those excluded fields form the authored projection. Cloud scalar values are omitted from the authored projection and are never restored.

## Performance boundary

There is no broad `PROJECT_CHANGED` snapshot listener. Such a listener would serialize large lists during ordinary block editing and turn an infrequent checkpoint cost into a hot-path cost. The current shadow is captured only at deliberate boundaries. Future variable, list and property timeline actions will update it through semantic edit ports.

List values are currently cloned in memory at that boundary. Persistent payload storage remains the next data-history slice: ordinary lists can use complete deduplicated snapshots, while large lists can use semantic edits and chunked checkpoints behind the same payload interface.

## Compatibility and seams

The journal schema remains version 1 and gains only an optional `projectHashKind` field. A missing field means `full-project-v1`, preserving existing takes. `Set Base` upgrades a take to the preferred structural hash contract.

All VM event and target-setter access is contained in `src/studio/bridge/authored-state-port.js`. Project projection itself is a pure module under `src/studio/validation/`. No upstream-owned TurboWarp or Scratch file changed in this spike.

## Verification

- Studio suite: 74 tests passing.
- Focused Studio lint: passed.
- Production webpack build: passed.
- Live existing-take compatibility: `reliability-20260823-1` played all 17 steps and 31 events to its recorded head.
- Live dirty-runtime preparation: after starting the project and changing Sprite1's x position from 0 to 123, the first keyboard Undo restored x to 0 and reported `ready to undo` without moving history; the second reported `undone`; Redo returned the take to its head.

Focused tests cover structural-versus-authored projection, runtime mutation restoration, cloud exclusion, explicit adoption, event listener cleanup and the first-command history preparation contract.

## Deliberately deferred

- semantic variable/list/property timeline events;
- adaptive persistent list payloads;
- adopting a selected runtime state as a timeline event;
- cloud-variable history;
- sprite lifecycle and stable Studio target identities.
