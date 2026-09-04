# Tutorial Studio roadmap

Date: 28 August 2026

## Product target

Tutorial Studio should record the meaning of normal Scratch authoring, let an editor inspect and seek the
resulting transaction timeline, and render it either as fast reversible history or as a realistic tutorial
performance. Semantic replay remains authoritative; mouse, camera, dialogue and typing tracks are
replaceable presentation models over the same verified transactions.

## Current capability boundary

| Area | Exact semantic history | Realistic forward Play | Important limitation |
| --- | --- | --- | --- |
| Blockly blocks | create, delete, move, field change, variable/list definitions | palette/flyout creation, existing drags, text fields and dropdowns | mixed/multi-root creations can fall back to semantic Play |
| Nested inputs | statement, round reporter, Boolean reporter and owned shadows | native reporter/Boolean insertion | scenario coverage must keep expanding beyond individual regressions |
| Variables/lists | definitions plus gesture-coalesced scalar-slider/list-monitor edits and boundary data deltas | variable/list create and rename dialogues plus real dropdown deletion and confirmation | slider gestures do not yet have realistic Play presentation |
| Broadcasts | definition and selecting field | New Message dialogue with typed text | rename/delete presentation is semantic only |
| Custom blocks | definition/prototype/argument topology | Make a Block dialogue | editing an existing definition is not a realistic interaction |
| Extensions | built-in extension blocks use normal exact Blockly history | clean reload opens the real extension library before the first extension flyout drag | custom URL extensions and hardware connection journeys need separate safety-aware coverage |
| Comments | block/workspace create, edit, resize, minimize/restore, move and delete | both attached and workspace comments use real context-menu, textarea, arrow, resize-handle, top-bar and delete controls | non-default/API-created initial comments deliberately use semantic Play |
| Multiple sprites | project-wide cursor; a required sprite selection consumes one Undo/Redo press before the edit | real sprite/Stage selector clicks, with a saved pause before cross-target block work | clone identities and unusually large sprite lists need broader browser coverage |
| Sprites/costumes | checkpoint-backed sprite lifecycle plus generic/library/upload/Paint add, share, duplicate, rename, delete, reorder and vector/bitmap edit | sprite duplicate/rename/delete, library selection, file upload, blank Paint creation, format conversion and recorded styled vector/bitmap Brush strokes use the real Scratch controls | arbitrary editor changes remain exact semantic Play |
| Backdrops | checkpoint-backed generic/library/upload/Paint add, share, duplicate, rename, delete, reorder and vector/bitmap edit | Stage selection, library, file upload, blank Paint creation, format conversion and recorded styled vector/bitmap Brush strokes use the real Backdrops controls | arbitrary editor changes remain exact semantic Play |
| Sounds | checkpoint-backed add/share/duplicate/rename/delete/reorder and persisted waveform edits | built-in library selection, file upload, duplicate, rename, delete, reorder and recorded editor effects use the real Sounds tab and exact controls | live microphone capture is deliberately outside the current recording envelope; generic/non-effect waveform edits still use exact fallback |
| Target properties | x/y, size, direction, visibility, draggable, rotation style, layer order and explicit costume/backdrop selection as reversible data edits | exact semantic playback | volume, tempo and video settings are runtime state, not GUI authoring actions; recording them would require a separate runtime track |
| Viewport | recorded or heuristic camera with zoom-safe target resolution | smooth safe framing during Play | no editable camera track or shot preview UI |
| Pointer | swappable models; saved Undo/Redo cursor toggle, visible sprite clicks, queued-history catch-up | natural/deterministic travel, click beats, idle hold/fade; vector and bitmap Brush replay use a bounded normalized gesture path | no general recorded-human path model or editable gesture track |
| Persistence | versioned local journal, canonical endpoint projection and restore-point checkpoints | restartable named take URL | no take browser or portable export/import |
| Timeline | one durable edit cursor, separate selection stops, labelled boundary seek and paced reverse/forward ranges | labelled jump control, slider, selected From/To range, saved sprite-pause timing and 0.5×–4× speed | no editable tracks |

The dialogue rows above now share a permanent real-browser acceptance journey. It authors a local scalar,
a global list, a typed custom definition with text/number and Boolean inputs, a real flyout broadcast block,
and a new broadcast message through that block's dropdown. Rewind, 4× realistic Play, reload and 4× Play
all pass while the final evidence proves the natural pointer, visible dropdown and prompt, and the complete
typed `party time` sequence.

## Priority 0 — reliability before surface area

27 August continuation: the mouse-authored regression suite now covers copied
C-block substacks with nested reporters, transfer between independent roots, and
cross-sprite history branching. It compares VM trees independently of recorded
IDs and samples empty slot outlines as well as text attachment. Compound clipboard
placement now reuses the existing native drag driver, including camera framing
and cancellation. The broader gate exposed a separate native-to-semantic replay
bug: actor IDs were preserved but parent endpoint IDs were not. The shared replay
mapping now carries both workspace and VM parent identities in both directions.
The formerly intermittent clipboard journey explicitly waits for its runtime data
change, so this fallback path is a permanent browser regression.
Verified candidate `77d15bd5d5cf52c4bf65` passes 14 browser scenarios across nine
suites (including the corrected complex-authoring rerun) and 597 Studio unit tests.
The previous snapshot is preserved on promotion; neither historical user report
is marked resolved by this bounded gate.

The maintained checks have entry points `npm run test:studio` and
`npm run test:studio:browser`; the latter requires an explicit localhost candidate
URL and runs serial isolated browser profiles. File → New now includes fresh block
history, not only sprite operations. See
[the continuation details](NATIVE-INTEGRATION-CONTRACT.md#copied-substacks-and-cross-sprite-branches--27-august-continuation).

Next reliability cases, before expanding presentation features:

1. Finish reproducing the two historical missing-block/empty-journal reports;
   a similar identity failure is useful evidence, not closure of either report.
2. Exercise clipboard source edits between Copy and Paste, connected paste,
   and distant copied-stack placements at higher zoom. Unsupported native
   clipboard combinations must remain explicit semantic fallback.
3. Combine cross-sprite branch edits with held history keys and interrupted Play;
   keep the existing independent boundary and intermediate rendering checks.
4. Keep cross-surface history queuing in the permanent gate. The 28 August fix
   gives toolbar steps, keyboard shortcuts and workspace context-menu commands
   one session-owned queue. The old build reproducibly lost a keyboard Redo
   during toolbar-started sprite creation. Real-browser coverage now exercises
   both input orders, repeated clicks, before/after the creation click, mixed
   directions, sprite-selection stops, endpoint pressure, and Escape followed
   immediately by Undo. Recording versions and section editing remain deferred.

27 August follow-up: real mouse-authored custom argument copies and nested
reporter moves now have a dedicated browser journey, including history before
and after Play/reload and intermediate field/handoff checks. This exposed missing
clone provenance, shadow-only lifecycle misclassification, and the global Undo
flag suppressing native shadow regeneration. Small fork contracts record clone
origin and isolate Undo storage independently of editing behaviour. The unused
SVG renderer and its disconnected tests have been retired; applicable contracts
were migrated to the shared planner/native tests. See the
[integration details](NATIVE-INTEGRATION-CONTRACT.md#mouse-authored-copies-and-input-movement--27-august-follow-up).
The final native-shadow fix now passes the release gate: 10 real-browser tests,
587 Studio unit tests and 214 vertical / 160 horizontal Blockly tests. The old
clipboard journey is updated and verifies compound-stack copy/paste through
Undo/Redo, Play and reload. Transport tests now wait for the complete matrix
instead of sampling intermediate counts during seeding. Verified bundle:
`fda03af3abaf80dd996b`; the previous snapshot is retained for rollback.
The continuation above adds mouse-authored roots/sprites and copied substacks.
The two missing-block/empty-journal reports remain unreproduced; the successful
bounded gates are not evidence that every wider combination has been solved.

27 August: history controls now share a native Blockly transition workspace,
using the same input and insertion-preview renderer as full Play. Timeline
previous/next is animated Undo/Redo; scrub/jump remains immediate. Frame-level
browser assertions cover attached input text, on-screen motion and final handoff,
alongside the semantic matrix. The follow-up above adds mouse-authored custom
procedures and nested input moves, and retires the disconnected SVG-animation
module after migrating its remaining applicable regression cases. Multiple-root
and wider zoom combinations remain coverage priorities.
See [shared native rendering](NATIVE-INTEGRATION-CONTRACT.md#shared-native-history-rendering--27-august-2026).

27 August: [native integration contract](NATIVE-INTEGRATION-CONTRACT.md) adds
authoritative drag identity, native completion and target-only preview. Keep
real mouse-authored regression tests alongside the programmatic matrix: the new
four-block journey caught lost Play-to-history identity causing a carried tail
to be skipped on redo. IDs now survive presentation boundaries, not project
replacement. Next gates are wider mouse-authored reorder/nesting combinations,
and reconstructing the reported empty-journal mismatch; do not treat the
prepared matrix alone as evidence that all basic editing is sound.

The reusable browser matrix behind `studio-connection-matrix-fixture=1` now authors twenty-nine independent
Scratch/Blockly transactions. It spans a hat and statement chain, both branches and the following stack of
an if/else C-block, nested round reporters with repeated text shadows, nested Booleans with owned menu
shadows, editable fields and an obscured-shadow replacement. The expanded fixture passed every one of its
fifty-eight reverse/forward boundary transitions and full realistic Play in a live editor. That Play pass
also caught a missing default `15`-degree palette shadow in the fixture itself; matching Scratch's genuine
flyout seed fixed the endpoint instead of weakening validation. Project boundary capture canonicalizes
still-referenced obscured-shadow ownership, so recorded and replayed endpoints share one VM graph invariant.

That live check is now a permanent opt-in Selenium acceptance test rather than a manual claim. It asserts
the command/reporter/Boolean opcodes and the repeated `a`/`b`/`c` field edits in the recorded journal,
drives the actual 4× range transport `29 → 0 → 29`, crosses the vulnerable nested-shadow range
`18 → 15 → 18`, returns to the head, rewinds, performs complete realistic Play at 4×, reloads from the
durable base and performs complete Play again. The maintained journey passes without restoration or
endpoint mismatch; the expanded selected-range run completes in 67.7 seconds.

The original twelve-step matrix also has a browser-verified branch-edit pass: four Undo requests truncate the take,
a real palette drag authors a replacement ninth step, and the branched take rewinds and realistically plays
to the same endpoint. Boundary reconciliation removes dangling `next` and input references left by deleted
future blocks, and text-field playback immediately disposes Blockly's animated editor before the following
transaction. Fixture XML deliberately mirrors Scratch flyout defaults (including the equality block's `50`)
so realistic Play is tested against genuine authoring semantics rather than synthetic defaults.

1. Maintain a reusable block/connection matrix covering statement append/insert, C-block substacks,
   nested round reporters, nested Booleans and menus, custom procedures, variables/lists, shadows and
   repeated indistinguishable blocks.
2. Run each important scenario at three levels: pure graph/projection tests, transaction/replay integration,
   and a real-browser fixture which authors, rewinds, plays, alternates Undo/Redo and reloads the take.
3. Canonical endpoint evidence now persists beside its hash and optional compatibility projection. A live
   cross-sprite take retained its Stage, Sprite1 and Apple endpoint projection across a full browser reload;
   the session regression suite proves a drifted post-restart Play still reports the first differing path.
4. Top-level semantic move coordinates retain Blockly's exact floating-point event coordinate instead of
   its rounded `toJson()` display form. A real cross-sprite take with fractional palette-drop coordinates
   passed labelled jumps `4→2→4` and `4→1→4`, then retained an exact canonical endpoint after reload.
5. Structural `v7` retains `v6`'s custom-procedure argument normalization and also canonicalizes an omitted
   empty socket with Scratch VM's equivalent inert `[kind, null]` tuple. Connected blocks, inline/obscured
   shadows, mutation inputs and values remain strict. Older projections remain byte-compatible for existing
   takes; new takes prefer `v7`.
6. Keep branch edits, held Undo/Redo, Escape/resume, zoom/camera changes and cross-sprite navigation in the
   regression matrix. The permanent Chrome pressure journey now bursts eight Undos, eight Redos, then four
   Undos before a real palette branch; it requires abandoned-future truncation, full Rewind/Play and a
   second Play after reload. A separate Chrome journey stops realistic Play with Escape at an intermediate
   committed cursor, resumes to the exact head, traverses Undo/Redo, then repeats Play after reload. Every
   failure must restore a known checkpoint and leave the editor restartable.
7. Sprite duplicate, rename and delete now use the same exact checkpoint-backed project-operation contract
   as library additions. Boundary IDs and target references are frozen before invoking an in-place mutation,
   so renaming `Sprite2` to `Hero` cannot rewrite its own before-state identity. A browser-authored lifecycle
   passed every boundary in both directions (`Sprite1` → `Sprite2` → `Hero` → deleted) and full Play at 2×.
8. Costume duplicate, rename, delete and reorder use the same restore-point contract. Operations whose
   structural before/after hashes are identical are discarded rather than becoming empty timeline steps.
   A real Costumes-tab take passed all five authored boundaries forward and backward and full Play at 2×.
9. Sound add/share/duplicate/rename/delete/reorder use that contract as well. A real Sounds-tab take added
   `Meow` and `Boing` from Scratch's library, duplicated and keyboard-renamed `Meow2` to `Boom`, deleted it,
   and dragged `Boing` above `Meow`. All six boundaries passed arbitrary backward/forward seeks and full
   Play at 2× with an exact structural endpoint. Realistic pointer-driven sound presentation remains a
   separate recording-quality feature; semantic history does not pretend that checkpoint restore is a UI act.
10. Backdrop library additions and lifecycle now use an explicit Stage-targeted contract rather than being
    labelled as sprite costumes. The shared project-library driver selects Stage, opens Backdrops and chooses
    the recorded asset through the real UI. A browser take added `Blue Sky` and `Bedroom 1`, duplicated,
    keyboard-renamed, deleted and reordered them, passed all six boundaries in both directions, and completed
    full 2× Play at its exact endpoint. The live run also caught and fixed target-label precedence when an
    operation targets Stage while the editor was previously on Sprite1.
11. Direct sprite-property controls now create explicit reversible data transactions. The shared authored-state
    delta schema carries scalar target properties alongside variables and lists, while a gesture-aware VM seam
    coalesces all `postSpriteInfo` frames between stage drag start and stop into one `Move sprite` step. A real
    browser take changed x, y, size, direction and visibility, then dragged the sprite from `(42, -15)` to
    `(152, -99)`; fourteen arbitrary seeks reproduced every boundary and full 2× Play restored the exact UI
    values with no diagnostic.
12. Direct non-cloud scalar monitor sliders now use the same authored-data contract. Mouse/touch drags and
    keyboard interaction open one gesture before the normal GUI mutation and commit the final value at the
    matching release, key-up, blur or component teardown boundary; intermediate range input frames do not
    become separate timeline steps. Cloud values remain outside local replay. Component and session tests
    cover multi-frame coalescing, accessibility changes, cloud exclusion, labels and exact Undo/Redo. The live
    editor successfully created and exposed the real slider control, but the current browser controller did
    not move the native range value, so a physical drag confirmation remains an explicit acceptance check.
13. Block and workspace comments now preserve their complete reversible lifecycle. Studio snapshots the
    inverse text, size, minimized state, exact coordinate and XML that Scratch Blocks omits from serialized
    comment events, then restores the private change/move fields before replay and the full created state
    before mirroring to the VM. Live workspace-comment and attached block-comment takes passed every
    create/move/delete boundary backward and forward, including branch replacement. Attached block-comment
    Play now drives Scratch's real context menu, textarea, minimize arrow, resize handle, movable top bar and
    workspace delete icon; each interaction is checked against both the observed Blockly event and live
    comment state. Permanent Chromium journeys author all eight attached and seven workspace boundaries,
    rewind, play, reload and play again. Scratch's restore path emits an extra size `CommentChange` whose old
    and new contents are identical; Studio filters that renderer refresh at capture and when loading older
    journals so one restore click remains one reversible action.
14. Generic costume/backdrop creation and persisted media-editor changes now use the same checkpoint-backed
    operation contract as asset lifecycle actions. Scratch's real Paint control created blank sprite and
    Stage assets, vector brush strokes recorded one `Edit costume` / `Edit backdrop` step, and the sound
    editor's Faster effect recorded `Edit sound`. A six-step live take passed direct Undo/Redo and complete
    Rewind → Play at 2×; sound restoration visibly changed 0.67 s → 0.85 s → 0.67 s. Nested library calls
    retain their specific library operation instead of double-recording the delegated generic add, while
    independent fire-and-forget editor callbacks serialize behind the active checkpoint boundary. A second
    live take issued two brush strokes back-to-back; both became distinct edit steps and the three-boundary
    take passed complete backward/forward traversal and Play at 2×.
15. Bitmap painting and bitmap/vector conversion now wait on Scratch VM's actual `targetsUpdate` emitted
    after asynchronous `canvas.toBlob` asset creation. The capture accepts the completion event even when
    content-addressing produces an unchanged asset, allowing the normal before/after hash filter to discard
    a no-op instead of timing out. A live vector→bitmap conversion followed by two immediate bitmap strokes
    recorded three exact edit steps; all boundaries passed backward/forward and full Play at 2×. Unit
    coverage exercises both sprite-costume and Stage-backdrop targets and verifies listener cleanup.
16. Explicit costume-card and backdrop-card selection now records `currentCostume` at the GUI action
    boundary. Studio deliberately does not wrap `target.setCostume`: runtime Looks blocks call the same VM
    method and must never become authoring history. A mixed live take added a costume, switched away and
    back, repeated the lifecycle on Stage backdrops, passed all six boundaries backward/forward and full
    Play at 2×. Timeline labels present these edits as `Set current costume`.
17. Stage dragging now opens its Studio gesture before Scratch calls `goToFront`. The gesture snapshots the
    dragged sprite's normal editable properties and every original sprite's layer order, then emits one
    multi-target data delta after drop. Undo therefore restores both position and the complete relative
    ordering rather than merely assigning an impossible single layer index. A two-sprite live take moved
    Apple aside, dragged Sprite1 from behind to the front, and passed Undo, Redo and full Play at 2×.
18. Built-in extension blocks now survive a clean persisted-take reload. Before the first extension flyout
    drag, Play derives the built-in extension ID from the recorded opcode, visits Scratch's real Add Extension
    library and item through stable target keys, and waits until that exact flyout block is visibly rendered.
    Extension loading is preparation for the block transaction, not a no-op semantic history step. A Pen
    take proved same-session history, reproduced the old clean-reload failure, then passed clean-reload Play.
19. Blockly context-menu duplication now has live coverage for both a single command and a compound
    two-command stack. Scratch can emit a grouped create/placement followed by a final ungrouped,
    non-undoable move whose block ID is a different member of the cloned topology. The journal keeps that
    induced placement in the creation transaction without absorbing a later genuine user drag. Both clone
    shapes passed direct Undo/Redo, complete Play and persisted-reload Play. A compound clone intentionally
    uses exact semantic presentation because one palette drag cannot truthfully represent multiple created
    command roots.
20. Cancelled outside-workspace drags no longer become phantom history. Blockly represents a snap-back as
    one undoable move outside the workspace followed by an ungrouped, non-undoable inverse settle. Studio
    now removes that adjacent pair only when the same block returns to the exact original parent/input or
    coordinate; float comparison tolerates Blockly's sub-pixel round trip. A multi-event rearrangement or a
    settle anywhere else remains recorded. A live Backpack-bound drag returned to the same pixel while the
    take stayed at one step, and a previously persisted three-step take normalized back to its single real
    creation boundary on reload.
21. The real local Backpack asset path now has exact sprite-import coverage. Studio previously checkpointed
    `addSprite` before the VM's asynchronous internal `renameSprite` made a colliding imported name unique;
    Redo therefore restored two `Sprite1` targets and correctly failed against the live `Sprite1`/`Sprite2`
    endpoint. Captures may now declare a narrowly matched nested VM call which belongs to their active
    operation. `addSprite` admits only `renameSprite` for a target ID absent before creation; edits to an
    existing sprite still serialize as independent author actions. A real Sprite1 → Backpack → sprite-pane
    round trip recorded `Add sprite — Sprite2` and passed Undo/Redo, Play and reload Play.
22. Built-in sound-library additions now retain an explicit GUI source instead of guessing from generic
    `addSound` arguments also used by uploads, recordings and Backpack. Full Play selects Sounds, opens the
    real sound library and clicks the exact stable asset key, then verifies name, asset ID, format, sample
    rate and sample count before accepting the checkpoint. A clean Meow take passed direct history, native
    Play and persisted-reload native Play with exact project hashes.
23. Recorded sound-editor effects now retain their exact named GUI action as well as their before/after
    waveform references. Realistic Play selects the durable target, opens Sounds, clicks the exact original
    sound card and effect control, and waits for Scratch's asynchronous audio processing before accepting the
    edited asset. The verifier requires visible controls, exact input/output media identity, completed pointer
    travel and an unchanged replay journal. A real Meow → Faster take passed direct stepping, full Play and
    persisted-reload Play; its card duration visibly traversed 0.85 s → 0.67 s and the complete Studio gate
    passes 55 suites / 405 tests.
24. Sound uploads now retain their explicit file-source meaning and replay through Scratch's real hidden
    file input. Native Play reads the exact content-addressed WAV bytes from the operation's durable
    after-checkpoint when Rewind or reload has removed that asset from live VM storage. A Selenium test
    uploads the real `sneaker.wav` fixture, rewinds and plays, reloads at the safe base boundary, then plays
    again. This browser test first reproduced the missing-cache failure before the checkpoint-backed fix;
    the final pass completes both journeys without restoration. The maintained Studio gate passes 55
    suites / 419 tests.
25. Sprite-list reorder and cross-sprite script-copy operations now have explicit checkpoint-backed
    contracts and permanent real-browser acceptance coverage. Reorder records the moved target and exact
    before/after index; script copy distinguishes a genuine source-target transfer from Backpack/clipboard
    import and retains the source script's durable ancestor/path even though Scratch regenerates payload
    block IDs. The browser test uncovered an atomicity defect where the structural hash captured the source
    block at its settled coordinate while the restore point captured Blockly's transient off-canvas drag
    coordinate. Checkpoint serialization and structural capture now begin in the same synchronous turn at
    each boundary. Real library creation, sprite-card drag and Blockly-to-sprite drag each pass Undo, Redo,
    Play and persisted-reload Play. Full Play now performs those last two actions through the rendered
    sprite cards: reorder forwards every natural-pointer frame to React's real DOM drag, while script copy
    starts a genuine Blockly gesture, moves it onto the durable destination sprite and lets Scratch's target
    pane complete the transfer. Verification requires visible controls, multi-frame completed pointer travel,
    the exact resulting target order/block counts, and unchanged Studio/Blockly history. The maintained
    Studio gate passes 57 suites / 429 tests, plus both opt-in Chrome journeys.
26. Local Backpack script imports now retain a compact external-source reference (`id`, type, name and
    optional body hash) while the project checkpoint remains exact semantic authority. Full Play opens the
    real Backpack, resolves the recorded item by stable Studio target, and drags it to the recorded workspace
    coordinate through React's normal asset-drag path. If that optional external item is absent, the driver
    declares the presentation unsupported before mutation and the executor uses the exact checkpoint; no
    transient body URL enters the journal. A permanent Chrome journey authors a nested 19-block command,
    reporter, Boolean, dropdown-shadow and C-block script, saves and imports it through the real Backpack,
    passes Undo/Redo, Rewind/4× Play and reload/4× Play. The run also fixed three general boundaries: quick
    Blockly-to-Backpack drops use a synchronous drag-session state machine instead of queued React state;
    short flyouts scroll to an off-screen semantic block target before pickup; and new structural projections
    preserve old hashes while canonicalizing only SB3-equivalent null field IDs, subpixel coordinates and an
    inert kind-3 null-shadow slot. Meaningful field IDs, values, children and real shadows remain strict.
    The maintained gate passes 59 suites / 444 tests plus the 60-second real Chrome journey.
27. Scratch Blocks' deterministic in-editor clipboard is now a realistic Play route. Capture wraps the
    workspace paste boundary only while Studio is active and records a durable source-block reference on the
    grouped create event; it never reads or persists operating-system clipboard contents. Full Play selects
    that source with the natural pointer, delegates copy, ID regeneration, collision avoidance and creation
    back to Scratch Blocks, and publishes the complete recorded-to-live block alias map. The recorded create
    XML owns the final top-level coordinate so subpixel drift in a recreated source cannot become a one-pixel
    paste error. A permanent Chrome journey copies the connection matrix's compound nested hat stack through
    real Ctrl+C/Ctrl+V, crosses Undo/Redo, Rewind/4× Play and reload/4× Play. It also proves Scratch's inert
    obscured-shadow difference between initial paste and Redo remains structurally equivalent rather than
    becoming another connection exception.
28. Variable and list rename/delete now use Scratch's real flyout field dropdown, rename prompt and editor-
    themed deletion confirmation during realistic Play. Verification requires the observed Blockly event,
    exact workspace/VM definition, disposed uses, completed pointer travel and unchanged replay history.
    The lifecycle work also fixed two definition-shadow contracts: recorded deletion now retains its scalar
    or list type, and a verified native gesture advances the same authored/list shadows that semantic replay
    would have advanced. A live six-step take created, renamed and deleted both a list and scalar, then passed
    Rewind, full pointer-driven Play and a second Rewind with zero capture errors. Debug takes now expose the
    capture snapshot/error summary, and verifier evidence projects Blockly variable models to JSON-safe
    primitives instead of retaining their circular workspace reference. The permanent eight-boundary Chrome
    journey additionally creates two genuine scalar uses, accepts the themed multi-use confirmation, completes
    Rewind/4x Play, reloads and completes a second 4x Play. The maintained gate passes 64 suites / 528 tests.
29. Costume and backdrop file uploads now retain their explicit GUI source and reconstruct the exact browser
    `File` from the durable after-checkpoint during Play. Blank Paint creation uses Scratch's real Costumes or
    Backdrops tab or visible Stage menu and their Paint control. A permanent four-step Chrome journey uploads an
    SVG and creates a blank painted asset on both Sprite1 and Stage, rewinds, plays, reloads at the base and plays
    again. That reload exposed a general journal
    migration bug: the legacy Blockly-event normalizer discarded semantic transactions whose `events` array is
    intentionally empty. Project operations and data edits now pass through that block-only migration unchanged.
    The browser journey and complete Studio gate pass, with 64 suites / 539 tests.
30. Vector Brush edits now retain a bounded target-relative gesture rather than pretending every Paint edit can
    be recreated from its endpoint alone. Scratch Paint's actual Brush control and Paper canvas receive stable
    Studio targets at runtime; capture stores at most 600 normalized points over ten seconds and associates the
    one-shot gesture only with the following SVG update. Forward realistic Play selects the durable sprite or
    Stage, opens Costumes/Backdrops, selects the exact asset and Brush, then dispatches the recorded path through
    Paper.js while the shared natural pointer renders a paced overlay. Interpolated presentation frames never
    become authored mouse events. Live browser verification caught that rounding normalized coordinates by even
    a few thousandths of a pixel changes Paper.js geometry and its content-addressed SVG ID; full-precision
    normalized coordinates now reproduce the exact recorded asset. A real stroke passed Rewind/4x Play, then
    reload at the base and a second 4x Play with matching canonical hashes and verified native pointer evidence.
    The maintained Studio gate passes 66 suites / 545 tests.
31. Vector/bitmap format conversion now has a strict forward-only realistic presentation. The planner recognizes
    a conversion only when the recorded before/after asset formats prove the direction; ordinary Paint edits
    remain semantic unless they carry a supported gesture. Play resolves the durable sprite or Stage and exact
    costume/backdrop, then clicks Scratch Paint's language-neutral conversion control with the shared pointer.
    Verification requires the expected VM update, visible control, isolated history and exact asset identity or
    decoded bitmap pixels before the checkpoint executor settles the canonical endpoint. Real-browser acceptance
    covers both costume directions across persisted reloads and Stage backdrop vector-to-bitmap conversion. The
    maintained Studio gate passes 67 suites / 553 tests.

## Priority 1 — timeline transport

The first transport milestone is implemented: `seek(transactionIndex)`, paced backward/forward range
playback, a transaction-boundary slider, an exact labelled jump control (index, semantic action and target),
explicit previous/next/start/end controls, selected From/To boundaries with two-way range playback, and
shared speed scaling for gesture clocks, lifecycle animation, camera motion and inter-step delays. Remaining transport
work is:

Build transport before destructive timeline editing:

1. Preserve the rapid-key policy: a new seek/step request finishes or skips the current presentation and
   animates the terminal requested boundary.

Browser paint barriers after a dialogue or list mutation deliberately remain frame-based rather than
speed-scaled: they are renderer-settlement requirements, not authored pauses. Any future recording pause
track should scale its intentional timing without weakening those correctness boundaries. Semantic mutation
and verification likewise remain unscaled.

Only after transport is trustworthy should the timeline add enable/disable, trimming, grouping and bounded
span replacement.

## Priority 1 — missing full-Scratch semantic actions

These operations currently prevent a claim of full Scratch authoring coverage:

- recording-quality presentation for remaining deterministic media edits. Blank Paint creation, file upload,
  vector/bitmap conversion and styled vector/bitmap Brush strokes are now realistic, as are built-in sound
  library selection, sound upload, duplicate, rename, delete, reorder and recorded effects. Generic additions,
  media-editor changes and non-effect waveform changes retain exact semantic Play. Live microphone capture is
  deliberately deferred rather than partially emulated;
- runtime activity recording remains a separate future track. Volume is mutated by Sound execution, tempo by
  Music extension execution and video settings by Video Sensing execution; the GUI does not expose them as
  ordinary authoring gestures. The authored-state port restores their endpoint values, but Studio must not
  mistake runtime execution for timeline authoring;
- custom URL extensions, hardware connection journeys and extension-specific non-Blockly project mutations;
- arbitrary operating-system clipboard imports remain intentionally unsupported. Scratch's same-editor block
  clipboard and Backpack sprite/nested block-script storage/import are exact and browser-proven.

Each new action needs a compact semantic contract, inverse, target/asset identity, checkpoint fallback and
strict end-state validation before realistic UI performance is attempted.

## Priority 2 — recording-quality realistic Play

- Cross-target block Play now retains the shared pointer, moves to the durable sprite-name or Stage selector
  target, performs a real selector click and verifies the VM editing target before continuing. A live
  four-step take created Apple, authored on Apple, switched to Sprite1 and switched back to Apple; Play at
  2× captured both selector clicks as verified `sprite-selector` interactions and completed 4/4 with no
  diagnostic. Editor-tab movement outside the already supported Costumes workflow still needs expansion.
- Sprite reorder and cross-sprite script copy now use recording-quality target-resolved drags during full
  Play. Their normal Undo/Redo path deliberately remains the faster exact history presentation.
- Add realistic presentations for remaining media libraries, paint-editor operations and the
  bounded non-effect sound-editor operations. Variable/list create, rename and delete are now realistic.
- Add an explicit recording profile: hidden authoring controls, safe frame, pointer on/off, speed, pauses,
  camera policy and deterministic start/end states.
- Make pointer and camera tracks inspectable and replaceable without changing journal semantics.
- Add an optional recorded-human pointer model for gesticulation. It should store normalized target-relative
  paths and fall back to the generated model when a recorded target diverges; it must not become the source
  of editor mutation.
- Add deliberate pause/callout markers for tutorial pacing rather than inferring every pause from mouse
  movement.

## Priority 3 — take management and editing

- take list, rename, duplicate and delete with explicit confirmation;
- portable journal/checkpoint/asset export and import;
- timeline labels, grouping, enable/disable, trim and span replacement;
- editable camera/pointer/pause tracks with preview;
- adaptive content-addressed payloads for unusually large list or media changes;
- compatibility report showing which steps can render realistically and which use exact semantic fallback.

## Deliberate boundaries

- File → New starts another project and does not need to be Undo-recoverable through the previous take.
- Cloud values remain excluded so replay cannot write network state.
- Live microphone capture and nondeterministic hardware/media input are outside the current supported recording
  envelope. Deterministic library assets, uploads and persisted editor operations remain in scope; hardware
  capture can be designed later without weakening journal or checkpoint guarantees.
- The supported block clipboard is Scratch Blocks' in-memory, same-editor clipboard. Studio does not inspect,
  persist or replay arbitrary operating-system clipboard contents.
- Operating-system input injection is unnecessary for correctness; verified DOM/Blockly interaction plus a
  virtual pointer is the portable recording path.
- Unsupported realism must be declared before mutation and use exact semantic replay. It must never guess a
  UI target or weaken project validation merely to keep the animation moving.
