# Spike 1 live block-capture evidence

Date: 23 August 2026

Branch: `studio/spike-1`
Feature flag: `?studio-capture=1`

## Purpose

Verify that the contained `scratch-gui` seam receives complete live Scratch Blocks events, retains inverse fields omitted from normal event JSON, and associates authored events with the correct VM target across a sprite switch.

## Automated contract tests

Command:

```powershell
npx --no-install jest --runInBand 'test[\\/]studio'
```

Result after the first seam: 2 suites and 11 tests passed.

Covered behaviour:

- complete create/change/move/delete snapshots;
- undefined versus null field values;
- deleted XML and descendant IDs copied before disposal;
- old/new connected and top-level move locations;
- capture disabled by default;
- pause/resume around workspace reload;
- current target ID resolved at event time;
- listener detachment and contained capture errors;
- hidden local-test diagnostics removed on detach.

## Real editor exercise

The development editor was opened locally at:

`http://127.0.0.1:8601/editor.html?studio-capture=1`

Actions and observations:

1. Dragged `move 10 steps` from the Motion flyout into Sprite1's workspace.
   - two snapshots: create and move;
   - move contained old and new floating coordinates;
   - no capture error.
2. Cleared the number field.
   - change snapshot retained `oldValue: "10"` and `newValue: ""`;
   - normal forward JSON contained only the new value, confirming the extra snapshot is necessary.
3. Deleted the block.
   - delete snapshot retained the complete block/shadow XML;
   - descendant IDs contained both the command block and number shadow.
4. Opened the sprite library and added `Abby`.
   - workspace/library loading added no snapshots while the recorder was paused.
5. Dragged another Motion block into Abby's workspace.
   - exactly two further snapshots: create and move;
   - target ID differed from Sprite1;
   - error count remained zero.

Observed final diagnostic summary:

- 6 authored block snapshots;
- 2 distinct stable target IDs;
- 0 capture errors;
- 0 workspace-load events misclassified as authored edits.

## Build result

The production Webpack build passed after the seam was added. Studio-specific ESLint checks passed. The known upstream lint and ChromeDriver baseline issues remain unchanged in [BASELINE.md](BASELINE.md).

## What this proves

- A second workspace listener in `scratch-gui` can capture the missing inverse data without forking `scratch-blocks`.
- One pause/resume hook around TurboWarp's existing workspace reload prevents sprite switches from polluting the source journal.
- The VM's current editing-target ID is sufficient for routing the observed authored events across sprites.
- The feature-off path does not attach a Studio listener.

## What remains unproven

- grouping/coalescing events into user-meaningful transactions;
- persisted append journal and crash recovery;
- checkpoint creation and canonical project hashing;
- event reconstruction and inverse/forward replay;
- global undo/redo routing;
- the 100-run deterministic replay gate;
- comments, variables, custom-block mutations and assets.

The next implementation step is a transaction grouper plus a checkpoint/replay harness. Synthetic pointer work should remain deferred until repeatable semantic replay passes.
