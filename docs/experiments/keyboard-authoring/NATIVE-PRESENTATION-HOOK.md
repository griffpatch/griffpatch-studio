# Native keyboard presentation contracts

Implemented in the existing `scratch-blocks` checkout on `experiment/keyboard-authoring`, commit `2ea58d13`. The previous `studio/align-dragged-stack` branch remains at `bfabb50b`. This is an optional extension to an existing presentation hook, not another edit/history path.

## Read-only insertion spacer (`0b8b5722`, outline correction `18e08a2b`)

The space-making caret adds a second small, renderer-owned contract:

```js
spacer.setStatementSpacerSize(144, height);
```

It is permitted only on an empty statement block (previous and next connections, no fields, inputs, output or icons) in a **read-only workspace**. Width must be at least the native statement minimum; dimensions must be finite and height nonnegative. A zero-height spacer leaves the original connection positions unchanged. Increasing its height moves the connected continuation and reflows enclosing C mouths through the native renderer, including their fields and shadows. No serialized attribute, live geometry change or Undo implementation is added. The ordinary renderer path remains unchanged when the hook is unused.

The GUI's one disposable presentation owns either the resting insertion caret or the typed draft. It uses a normal single-line height and restrained 144-unit width, delays passive allocation by 100 ms to coalesce rapid navigation, and opens/closes over 140 ms. Reduced-motion mode skips the interpolation. Empty C mouths have a native minimum height, so closing eases into its collapse rather than spending the visible change in its first frame. Enter from a resting caret retains the same native scene and spacer. Live edits, native history, target/context changes and Studio transitions release ownership; no placeholder enters saved projects or recordings.

Caret-to-caret navigation within one source script transfers that reservation
(`12c0afa01`). The passive delay holds the existing scene instead of beginning
collapse. Once the destination is ready, the isolated insertion boundary is
restored and recaptured there, retaining spacer height, source masks, neighbouring
root copies and current spacing offsets. The planner interpolates directly to
any different footprint; equal footprints produce no neighbouring-stack motion.
Invalidated sources still discard the scene. Crossing source scripts or leaving
insertion sites retains the ordinary disposal lifecycle. No additional framework
hook is needed for this handoff.

Native verification: **222 vertical / 165 horizontal tests pass** (`.tmp/keyboard-spacer-outline-fixed.log` in the GUI checkout). The added test checks zero/mid/full/reversed sizes, connected tail identity, enclosing C height, exact source XML, unchanged serialization, invalid dimensions and rejection in an editable workspace. It now also checks the actual SVG path bounds: the first implementation drew its bottom corner 4 units below the next connection, despite correct layout metadata. The new assertion reproduced that overlap before correcting the right edge to leave room for the native corner. The compiled GUI tests check the visible notch join at default and two higher zooms, and sample opening and closing on successive animation frames. See REVIEW.md for the final compiled-editor gates.

The source hook, compiled vertical bundle and native test are committed together in `0b8b5722`, with the same three artifacts corrected in `18e08a2b`. The GUI installer now checks this method too, so it cannot silently install an older fork that lacks keyboard spacer sizing. Previous immutable Lab and Studio snapshots retain their original bundles.

## Why it was justified

The 1,000-command fixture has 200 separate five-command stacks and 1,000 default shadows. Starting a draft on one of those stacks copied all 2,000 objects: 52.9 ms inside `createTransitionWorkspace()` and 111.5 ms from the initiating key to the next frame. Reusing the insertion boundary had already removed per-key reconstruction, but could not remove this initial whole-workspace cost.

With a root-scoped copy, the same fixture allocates 10 objects. Two compiled-editor runs measured 1.0–1.2 ms in the native copy and 18.9–19.3 ms for the first key. The separate 200-command single-stack fixture still copies its complete root: 73–77 ms first entry, about 18 ms steady. That remains an explicit limitation, not an invitation to fake the hidden tail's geometry.

## Contract

```js
workspace.createTransitionWorkspace(); // Existing full copy and source-canvas mask.
workspace.createTransitionWorkspace([root.id]); // One complete native root.
workspace.createTransitionWorkspace([]); // Empty scene for a new independent script.
const scene = workspace.createTransitionWorkspace([root.id]);
scene.includeRoots([neighbour.id]); // Add another complete native root later.
```

- Root IDs must identify distinct, existing top-level blocks in the source workspace. Validation happens before allocation or masking. A child ID cannot accidentally create a partial script.
- XML serialization/deserialization remains Blockly's. All owned children, default shadows, fields, mutations and attached comments are copied with their native identities into a separate read-only workspace.
- The source variable map is copied independently, including scalar, list and broadcast models. No map or block object is shared.
- Only the requested roots' SVGs and their attached icon bubbles are masked. Unrelated scripts and standalone workspace comments remain visible in the source. There is no live connection mutation or geometry transform.
- Exact fractional root coordinates and original opacity strings are retained. Disposal is idempotent and restores masks even when native deserialization fails. Event enable/disable scopes remain balanced.
- Omitting the argument retains the previous full-workspace path, including its coordinate correction and whole-canvas masking. Studio callers are not changed to the scoped path.
- A scoped scene from commit `cb794bc3` can incrementally include additional distinct top-level roots. The complete request is validated before cloning. A clone failure disposes the whole scene and restores every earlier mask, so the caller cannot retain a partly extended presentation. Full-workspace scenes deliberately reject this optional operation.
- The caller still owns scene disposal and invalidation. The keyboard controller cancels or rebuilds its draft on source edits, target changes and Studio ownership changes.

The implementation adds roughly 50 lines to the existing method, plus native tests. It introduces no keyboard concepts, Scratch opcode special cases, project graph patching, replacement Undo, global stable IDs, or application-level copies of Blockly's layout engine.

## Verification and limits

- Native browser tests: 226 vertical and 168 horizontal passing. Comment-icon presentation is tested in the vertical renderer, which actually supports those icons; it is not fabricated in the horizontal fixture. Incremental roots retain exact fractional coordinates and complete attached comments, and forced deserialization failure restores every source mask.
- Compiled editor: the full keyboard gate has 36 passing real-key/mouse cases. The new integration case authors a second script, moves it with a real drag, adds a real comment through the context menu, types a draft in the first script, then clicks the unrelated live script. It asserts the exact caret identity, no execution, restored comments/masks, unchanged VM topology, and subsequent native Undo/Redo.
- Cleanup assertions now inspect individual block/bubble opacity as well as the whole canvas; a root-scoped mask leak cannot hide behind the old whole-canvas check.
- The complete 29-test feature-disabled Studio gate passes again on the spacer review `da5715b92` (10 suites, 1224.492 seconds). See REVIEW.md for the exact fixed artifact and current keyboard gate.
- A copied attached comment uses the existing read-only renderer's compact text presentation during a draft. Its source text, identity, geometry and visible state are restored. This change does not attempt a new comment editor.
- The presentation hook does not choose a layout. The Keyboard Lab can now use its existing pure live-spacing policy to request and animate only affected neighboring roots; unrelated scripts are not copied or moved. Normal Scratch behavior remains unchanged when no caller uses the optional hook.

## Rebuild and rollback

Use the existing local compiler; no network install or dependency upgrade is required:

```powershell
# From D:\dev\twstudio\scratch-blocks, on experiment/keyboard-authoring
$env:Path = 'D:\dev\twstudio\.tools\temurin-jre11\jdk-11.0.32.1+1-jre\bin;D:\dev\twstudio\scratch-blocks\node_modules\.bin;' + $env:Path
C:\Python313\python.exe build.py

# From D:\dev\twstudio\scratch-gui
./scripts/use-local-studio-scratch-blocks.ps1
node node_modules/webpack/bin/webpack.js --bail --output-path D:/dev/twstudio/scratch-gui/.tmp/keyboard-authoring-candidate
```

Only run this when no browser suite is using the development server. The installer checks required Studio hooks and verifies the copied bundle hashes. The old installed bundles were preserved in `.tmp/keyboard-dependency-before-scoped-roots`; neither the Studio snapshot nor the fixed review directories are rebuilt. Returning to the earlier GUI checkpoint also requires its matching Scratch Blocks bundles. The already-built fixed review is the simplest rollback.
