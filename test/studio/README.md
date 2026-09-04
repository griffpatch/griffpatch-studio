# Tutorial Studio contract tests

The first fixture must cover:

- grouped block create, change, move and delete events;
- old/new field values;
- deleted XML and descendant IDs;
- old/new parents, inputs and coordinates;
- Scratch-compatible integer normalization of new and legacy move coordinates;
- portable target references across at least two sprites;
- replay suppression;
- checkpoint reload and repeatable canonical project hashes;
- keyboard and workspace-menu routing to cross-sprite Studio Undo/Redo;
- two-stage cross-sprite history navigation without premature cursor movement;
- structural hashes which ignore runtime values while detecting authored block changes;
- authored-shadow restoration on the first dirty-runtime Undo/Redo command;
- cloud-value exclusion and explicit authored-baseline adoption;
- unconditional canonical checkpoint restoration at cursor zero after final Undo or Rewind, preserving Redo even when a matching hash masks rendered Blockly residue;
- first-path project diagnostics when a canonical head comparison fails;
- redo-branch truncation after recording from an earlier history cursor;
- safe-frame viewport composition around the active edit and other visible scripts, recorded-view fallback, deterministic legacy framing and bounded camera easing;
- predicted incoming palette-block height, cross-scale connection endpoints, notch-adjacent flyout pickup and a compact diagonal path which delays snapping until the final approach;
- visual continuity across sprite workspace scroll-position changes;
- configurable camera-before-create ordering for offscreen destinations;
- single-pass native destination framing plus cancellable and resumable Escape handling during Play;
- delete/restore of a nested stack with a comment.

The same journal must replay successfully 100 consecutive times before the block-journal spike is considered fully proven.

The semantic-core test completes 100 forward/backward cycles through the executor contract. Real take `reliability-20260823-1` also completed 100 consecutive rewind/play cycles through the real Scratch Blocks workspace after a full page reload. Its 13 user steps and 23 internal events cover two sprites, nested statement and Boolean inputs, a field correction, stack detach/reattach and nested delete/restore. Every cycle matched both canonical hashes with no replay exceptions. Attached- and workspace-comment restoration and their realistic create, text, resize, minimize/restore, move and delete presentations now have permanent Chromium lifecycle regressions. The workspace journey also proves that Scratch's semantically empty restore-size notification does not create a second history step. See `docs/studio/SPIKE-5-REAL-WORKSPACE-RELIABILITY.md` and `test/integration/studio-block-comments.test.js`.

The live editor additionally verifies keyboard Undo/Redo across the Sprite1/Abby boundary, context-menu Redo, and `Play` continuing from a partial history cursor. See `docs/studio/SPIKE-6-STUDIO-UNDO-REDO.md`.

The variable lifecycle journey creates and renames a list, creates scalar-variable uses, then renames and
deletes the scalar through Scratch's real dropdown and confirmation controls. It crosses Rewind, realistic
Play and persisted reload while checking exact definitions, disposed use blocks and JSON-safe native
evidence. See `test/integration/studio-variable-lifecycle.test.js`.

Cross-sprite history tests verify that the first command selects the durable target without replaying an event or changing history availability, while the second command performs the Undo or Redo. See `docs/studio/SPIKE-12-TWO-STAGE-SPRITE-HISTORY.md`.

State-projection tests verify that runtime changes to scalars, lists and persisted sprite properties do not alter structural validation, while block changes still do. Authored-state tests cover green-flag, running-thread and clicked-script dirtiness, exact non-cloud restoration, cloud exclusion, explicit adoption and listener cleanup. See `docs/studio/SPIKE-13-AUTHORED-RUNTIME-STATE.md`.

The viewport tests preserve a safe current view, compose fitting visible scripts into useful top-left space, exclude distant scripts, fall back around oversized active edits, follow regenerated nested blocks through durable references, include the complete descendant script width, reserve a missing palette block's height, retain recorded-view fallback, and exercise the legacy framing path. The opt-in long-camera fixture covers a short script, an over-height vertical stack and a script to the right as 19 separately recorded transactions with real default input shadows. Live checks cover ordinary, high and extreme zoom plus the older two-sprite reliability take. See `docs/studio/SPIKE-8-RECORDED-VIEWPORT.md`.

The motion tests cover eased intermediate positions, the imperceptible-movement threshold, cancellation, explicit starting origins and cross-sprite metric conversion. Live playback from a deliberately displaced canvas produced intermediate transforms and retained exact end-state validation. See `docs/studio/SPIKE-10-SMOOTH-VIEWPORT-MOTION.md`.

The pre-create tests cover final-move and legacy XML destinations plus `wait`, `concurrent` and `off` policies. Live sampling confirmed that an empty, displaced workspace reached the target before its first block appeared and did not perform a second correction. See `docs/studio/SPIKE-11-PRECREATE-CAMERA.md`.

The arbitrary-cursor regression uses the exact floating-point coordinate that previously changed canonical `x: 162` into `x: 161`. Live testing undoes and redoes every prefix depth from 1 through 13 across both sprites. See `docs/studio/SPIKE-9-ARBITRARY-CURSOR-RELIABILITY.md`.

Run the current Studio-only suite with:

```powershell
npx --no-install jest --runInBand 'test[\\/]studio'
```

The upstream `npm test` command is not the Studio gate because the pinned baseline has unrelated lint failures and an incompatible ChromeDriver. See `docs/studio/BASELINE.md`.
