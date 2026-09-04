# Native block interaction contract

27 August 2026. Recovery checkpoint: GUI `a5d3e9e51`.
Scratch Blocks contract commit: `0787d2d6`.

## Ownership

Scratch Blocks owns gestures, connection compatibility, insertion previews,
shadow rendering, and applying the drop. Studio owns the cross-sprite journal,
transaction verification, rollback checkpoints, camera and presentation.
Ordinary history is semantic replay with read-only animation; only realistic
Play drives a native gesture. Neither path replaces `workspace.undo()`.

## Small fork surface

- `workspace.addBlockDragListener(listener)` / `removeBlockDragListener`:
  `start` reports the actual picked-up root and descendants before detachment,
  plus workspace ID and event group. `settled` reports the same identity after
  tracked drag/snap/bump work and its queued events. Observers must not mutate
  the detail or editor; observer errors do not interrupt normal dragging.
- `workspace.whenBlockOperationsComplete(callback)`: a completion barrier for
  registered native block work and event delivery, including listener-enqueued
  events. **Not** a promise that VM/React rendering has painted. Studio retains
  its separate VM/paint settling and graph verification.
- `gesture.setConnectionPreviewTarget(connection)`: ordinary native proximity
  and compatibility checks, restricted to this exact destination. `null`
  suppresses previews; `undefined` restores ordinary unrestricted behaviour.
  The setting also works before the gesture has picked up its block.
- `gesture.getConnectionPreview()`: read-only current local/target connection
  and visibility. It reports the real insertion marker/replacement highlight.

Internally, the optional target travels through the existing connection search.
It does not force a connection, enlarge snap radii, synthesize marker geometry,
or change normal editor proximity behaviour. Snap/bump timers register with the
workspace completion barrier without changing their delays.

## Playback and identity rules

Travel is a continuous eased path. Preview is suppressed during transit and the
intended target is enabled during the final approach, followed by a short native
preview hold before release. Surrounding blocks therefore react using Scratch's
own marker logic, only at the intended zone. A failed target acquisition fails
verification and rolls back; it is not followed by a corrective mouse detour.
Global `SNAP_RADIUS` changes and artificial million-unit manager updates are gone.

New recordings attach actual pickup metadata to grouped events. Old journals and
programmatic fixtures retain inference as a compatibility path; they do not gain
retroactive authoritative gesture metadata.

Recorded-to-live IDs belong to a **workspace generation**, not a Play sequence.
Stopping/ending Play or entering ordinary Undo/Redo does not discard them.
Checkpoint/project replacement and session disposal invalidate them; new authored
creates replace aliases for reused IDs. Successful semantic replay adopts the
same aliases. The existing internal `*SequenceBlockAliases` bridge method names
are retained for compatibility but now have this workspace lifetime.

## Verification

The fork JSUnit suites exercise target-only search, unchanged default search,
distance/type rejection, preview suppression, completion ordering, idempotent
completion and observer isolation. GUI tests cover capture metadata, primary-root
selection, preview evidence, failure-path settling and cross-executor identity.

The 43-step browser matrix covers commands, C-blocks, reporters, Booleans, shadows,
fields, compound moves, timeline traversal, repeated history and reload. Separate
browser tests cover Escape/resume and burst-history branch edits.
`studio-native-drag-contract.test.js` additionally creates four blocks using real
browser pointer drags, reorders the third with its tail, then checks Play,
repeated Undo/Redo and reload. It caught an identity-lifetime defect that the
programmatic matrix did not: the first redo resolved a moved parent through its
post-drag path and skipped a carried tail.

These are bounded acceptance cases, not proof of every Scratch editing workflow.
The earlier lost 14-step user take and the reported empty-journal mismatch have
not been reconstructed by this change and remain separate follow-up cases.

Validated candidate bundle: `bb04936145811f43607e`. GUI Studio suite: 582 tests;
fork Chrome JSUnit suites: 210 vertical and 156 horizontal. Real-browser matrix,
Escape/resume, history-pressure/branching and File/New restart journeys pass.
The real mouse-authored four-block journey also passes ordinary Undo/Redo before
Play and repeated Undo/Redo after Play. Its wait observes the completed drop
event: a new transaction count alone is published earlier, at pickup.
In-app screenshot sequences were inspected through pickup, continuous motion,
native gap opening and release for the final four-command reorder.

### Reused-browser build consistency

The final snapshot handoff caught a separate problem that fresh Selenium profiles
could not expose: local development builds used an unversioned lazy `sb.js`.
The editor could report its current bundle while loading cached, older Blockly
code without the integration contract. Development lazy chunks now include their
content hashes, like production chunks; the real-authoring browser test asserts
the Scratch Blocks script URL is versioned. Missing-contract diagnostics are
also serializable instead of appearing as an empty error object.

Final cache-safe candidate: `119491ea6290fd8b1084`; 583 Studio tests pass.
Both the full matrix and real pointer-authored four-block browser tests pass on
this bundle. The reused in-app browser also completed all 43 Play steps with
the versioned `sb.876db45cd78f934b0278.js`, with no cache clearing or journal reset.

## Shared native history rendering — 27 August 2026

Scratch Blocks `a8aa9f37` adds two presentation-only entry points:

- `workspace.createTransitionWorkspace()` returns an isolated rendered copy
  and an idempotent disposal callback. The copy owns its blocks, variables and
  connections, shares the source camera/styles, and temporarily covers the real
  canvas. Disposal always restores the real canvas, including failure paths.
- `InsertionMarkerManager.previewConnection(local, target)` uses Blockly's real
  insertion marker/replacement highlight without committing a drop. It rejects
  editable workspaces and connections from another workspace. Repeating the same
  request is idempotent; `null, null` clears it.

The history executor still applies and verifies the exact semantic transaction
once. The new `block-transition-presentation-port` animates only the isolated
before-state toward that verified after-state. Owned reporters and shadows remain
real children of their block; the stationary next-stack is detached using graph
ownership, not masked and repositioned as separate SVG fragments. Receiving slots
are rendered by the same native marker machinery used during full Play.

| Control | State authority | Presentation |
| --- | --- | --- |
| Full Play | verified native interaction, with exact semantic fallback | palette/dialogues/pointer plus native block renderer |
| Timeline forward/back, previous/next, keyboard Undo/Redo | exact semantic transaction | one shared native block transition port, no pointer |
| Scrub, labelled jump, Rewind, jump to start/end | exact semantic transaction | immediate catch-up; no intermediate animation |

Full Play and history deliberately retain different **execution** adapters: this
change does not make native mouse gestures authoritative for Undo. They share
Blockly's block/input/preview rendering, the movement clock and final-approach
preview threshold. The disconnected SVG history presentation module has now been
removed. Identity/planning regressions live with the shared planner and native
port; the real-browser tests cover owned inputs, scene disposal and handoff.

History reveals offscreen block transitions before capturing their scene, including
new blocks, but retains an already visible edit's camera. Palette-covered blocks
do not count as fully visible. Camera movement remains outside the copied scene.

Candidate bundle: `0b2aef194d1635a09b8c` (local Scratch Blocks `a8aa9f37`).
Verification: 591 GUI Studio tests; 212 vertical and 158 horizontal fork JSUnit
tests in Chrome. Real-browser journeys cover the full 43-step matrix, mouse-authored
four-block reorder, rapid history/branch edits and Escape/resume. The new
`studio-transition-rendering.test.js` crosses command reorders, nested round
reporters and Boolean inputs through previous/next, keyboard Undo/Redo and selected
range backward/forward. It samples intermediate frames, requires visible actors,
checks owned field positions and the handoff to real blocks, and requires no
leftover presentation workspace or virtual cursor. Screenshots are retained in
`.tmp/transition-rendering/` for manual inspection.

These are bounded tests, not a guarantee for every custom extension, multi-root
edit or zoom level. Wider mouse-authored nesting, interrupted transitions and
performance on large projects remain the next coverage priorities.

### Lifecycle easing and pre-update framing

27 August follow-up, candidate `3a8062219f37d2f781a6`:

- Clarified direction: creation uses cubic ease-out (fast to slow), deletion ease-in (slow to fast),
  and moves symmetric ease-in/out. The effective lifecycle is reversed for Undo,
  so undoing a deletion has the creation curve. Preview activation follows actual
  travelled progress rather than elapsed time on the differently eased paths.
- History field edits now request framing too. Preparation uses the same safe
  composition solver as Play: padded script top/left when it fits, useful room
  below a long script's edited region, and focus on the active input when the
  entire width cannot fit. A comfortable existing shot stays still.
- Frame the actual primary actor and destination, including the short lifecycle
  offset. An exiting block's original flyout pickup is not its destination.
  Use body height for the active block and descendant bounds for stack context.
- Select the sprite before capturing its camera. Complete framing before the
  semantic edit/presentation snapshot; preserve that shot during application,
  rather than reframing underneath the animation. Bulk seek/Rewind retains its
  established immediate, camera-preserving behaviour.

597 Studio tests pass, including actual transition-frame acceleration/deceleration checks.
The browser rendering journey additionally pans a text
edit completely offscreen at 100% and 300%, observes the first actual text change
to prove it is already visible, and repeats Undo/Redo to check the camera stays
fixed. Existing frame checks cover complete entrance/exit bounds, attached inputs
and the final handoff; full matrix and real pointer-authoring remain release gates.

### Mouse-authored copies and input movement — 27 August follow-up

The new `studio-native-complex-authoring.test.js` starts from an empty take and
uses real mouse drags, not XML/connection mutations, to build three nested additions
and move the inner compound reporter between sockets. A second journey types a
custom definition and copies both its round and Boolean arguments into a call.
It crosses history before Play, after Play and after reload/Play, sampling field
attachment and scene-to-editor handoff. These journeys reproduced gaps which the
prepared matrix had not exercised:

- Definition arguments are cloned from a surviving workspace shadow, not the
  palette. The native drag observer now includes `origin: {kind, blockId}` before
  Gesture replaces its source with the clone. Studio adds a durable reference.
  `gesture.getDraggedBlock()` exposes the resulting actor without private-field
  access. Both sources feed the same drag/preview driver. Legacy argument-copy
  transactions without provenance use exact semantic fallback; they do not guess.
- A reporter move restores its old socket's shadow and deletes the destination's
  shadow. Shared transaction classification treats those as owned input shapes,
  not independent animated blocks. After a native drop, regenerated shadow IDs
  are matched through their recorded owning sockets and passed to strict topology
  verification and subsequent history.
- **Undo storage is not editing behaviour.** Blockly's global
  `Events.recordUndo=false` also suppresses normal shadow regeneration. Native
  Play now uses `workspace.suspendUndoRecording()` instead: a workspace-local,
  nestable storage suspension with idempotent release. Events still reach the VM,
  native shadow regeneration stays active, and neither Undo nor Redo storage is
  changed. The existing completion barrier drains pending work before release.
  Literal semantic event replay continues to use Blockly's original flag.

The added fork hooks have small, opt-in contracts and do not replace
`workspace.undo()`, the connection renderer, or normal drag behaviour. Artifact
captures are in `.tmp/native-complex-authoring/`; the two old user reports of
missing-block and empty-journal failure remain open until independently reproduced.

**Release gate passed, 27 August:** after the permission service recovered and
the localhost servers were restored, the final Undo-storage contract passed
real Chrome acceptance. GUI bundle `fda03af3abaf80dd996b` is verified for snapshot
promotion. Scratch Blocks production contract is `48ff25a3`; test checkpoint
`a2250e0a` corrects the new shadow fixture's invalid XML wrapper.

| Browser journey | Verified scope |
| --- | --- |
| Native complex authoring (2 tests) | Real nested additions, compound reporter moves between sockets, round/Boolean definition-argument copies; history before/after Play and reload; intermediate field attachment and handoff |
| Native drag contract | Mouse-authored four-block rearrangement, native Play, then history |
| Transition rendering (2 tests) | Shared history controls, owned fields, no leftover scene/cursor, and pre-edit camera framing at 100%/300% |
| Connection matrix | All 43 transactions, reverse/forward ranges, Play and reload/Play |
| History pressure | Eight Undo/Redo requests, branch replacement, Rewind/Play and reload/Play |
| Escape/resume | Stop at a committed cursor, resume, Undo/Redo and reload/Play |
| Authoring dialogs | Local variable, list, custom definition and broadcast prompt, including typed Play after reload |
| Block clipboard | Real compound-stack copy/paste, Undo/Redo and 44-step Play before/after reload |

All 10 browser tests pass. The fork suites pass **214 vertical / 160 horizontal**,
including Undo-storage isolation with normal shadow regeneration. All **587 GUI
Studio unit tests** pass; both candidate builds and production-source lint passed,
and the changed test files pass their explicit lint check.

The resumed run also repaired test-readiness defects: Escape/resume sampled an
intermediate two-step journal during matrix seeding, and clipboard acceptance
still expected the old 29-step fixture. Matrix-based transport/clipboard tests
now share the explicit full-fixture boundary before deriving later counts.
Failure-artifact capture tolerates a missing journal when navigation fails, so it
does not mask the original load error. These are harness fixes, not relaxed
semantic or animation assertions.

Logs: `.tmp/native-complex-authoring/resumed-run.log`, `release-gates.log` (includes
the first readiness failure), and `readiness-and-clipboard.log` (corrected reruns).
The previous stable snapshot is retained for rollback on promotion. This bounded
gate does not close the two unreproduced user reports above or establish coverage
for arbitrary multi-root/multi-sprite edits.

### Copied substacks and cross-sprite branches — 27 August continuation

The mouse-authored suite now also builds a repeat containing a wait and nested
addition reporters, copies the entire family with Ctrl+C/V, completes TurboWarp's
paste-at-mouse gesture, then transfers the copied substack into the original root.
A separate journey authors on Sprite1 and Apple, starts Undo from the other sprite,
and replaces an abandoned Apple future with a new Sprite1 edit. Each journey
crosses Undo/Redo before Play, after Play and after reload/Play.

An independent VM-tree oracle compares every tested boundary with its authored
meaning, ignoring regenerated IDs but rejecting dangling children, cycles, shared
children and incorrect parents. Frame sampling now compares empty input outlines
as well as text offsets, so slots cannot travel separately from their actor. The
strict Studio endpoint verifier remains enabled; the independent oracle does not
replace it or relax coordinate checks.

This exposed a presentation gap: a clipboard create plus its free placement is
one transaction, but only create-only pastes previously selected native Play.
The compiler now describes that compound paste explicitly. The clipboard driver
uses observed BlockCreate identities and delegates placement to the existing
native drag driver, under the same isolation and verification scope. The final
placement destination uses the existing camera solver with the copied family's
width/height. No new fork hook or separate drag renderer was needed. Connected
pastes and transactions with additional editing effects retain explicit semantic
fallback; unsupported gestures are not guessed.

The browser test requires verified native clipboard frames, not merely a correct
final state, and exercises Escape during placement followed by history/resume.
Unit checks cover paste versus final coordinates, missing copied identities,
cancellation before copy and cancellation during placement. File → New also has
a mouse-authored block journey in addition to its existing sprite-library journey:
fresh edits must remain reversible through Play and persisted reload, with no
blocks or journal identity leaking from the discarded project.

The paste test waits for the actual held gesture before issuing its drop, then
awaits native completion. Waiting for completion *before* the drop races the
addon's asynchronous gesture start and can deadlock the test. Custom definition
typing similarly waits for the displayed field value, not just the HTML widget.

The expanded release run also exposed a genuine native-to-semantic boundary bug.
Clicking the clipboard source hat runs its initial move-10 command; capture can
attach that data change to the preceding reorder. That reorder then uses semantic
Play after earlier native gestures have regenerated IDs. Replay mapped the actor
but not both parent endpoints, so the VM could read `next` from a missing recorded
parent. The replay engine now carries the transaction's workspace and VM parent
identities into both directional locations, and the bridge resolves VM endpoints
before changing the source graph. This is a shared identity fix, not a clipboard
or opcode exception. A unit test reproduced the failure before the fix; forward
and inverse cases also cover distinct workspace/VM parent IDs. Clipboard browser
acceptance now explicitly waits for the move-10 effect and requires the data
boundary, making this previously timing-dependent path repeatable.
The mapping applies only to execution actions; recorded transactions remain
unchanged and no journal migration is required.

#### Repeatable local gate

Build and serve an isolated candidate, then run from `scratch-gui`:

```powershell
npm run test:studio
$env:STUDIO_BROWSER_URL = 'http://127.0.0.1:8603/editor.html'
# Optional: point CHROMEDRIVER_PATH at an installed compatible driver.
npm run test:studio:browser
```

The browser command runs the maintained ten suites serially in fresh headless
profiles. It refuses a missing/non-local URL, rather than letting skipped browser
tests report a successful release check. `-- --listTests` lists the exact suite
inventory. These profiles do not operate the user's open in-app editor or journal.
Keep the verified 8601 snapshot unchanged until the candidate gate passes.

**Continuation gate passed, 27 August:** candidate bundle
`77d15bd5d5cf52c4bf65` passes all **14 browser scenarios across 9 suites** and
**597 Studio unit tests across 68 suites**. The nine-suite run passed eight suites;
the complex suite stopped only because its new cancellation check expected
`false` where Blockly returns `null` for no active gesture. After normalizing that
boolean and adding a workspace/VM non-shadow count check for orphaned rendering,
all four complex journeys passed their complete rerun, including interrupted paste
placement, Undo/Redo and resumed Play. The deterministic native-to-semantic clipboard
regression passes before and after reload. Both File → New journeys pass.

Build, production-source lint and the modified browser-test lint checks pass.
The existing replay-port unit file retains unrelated pre-existing lint debt; its
31 tests pass. No fork changes were needed in this continuation. Logs are
`.tmp/native-complex-authoring/identity-release-gate.log`, `final-complex-gate.log`
and `final-unit-gate.log`. The promoted 499-file build is SHA-256 checked against
the candidate; the previous snapshot remains at
`scratch-gui-working-snapshot/build-before-native-clipboard-20260827a`.

### Outside-drop recording boundary (27 August)

Reported: `Transition actor could not be resolved` at 45/52 in the current
`77d15bd5d5cf` snapshot. The retained diagnostic is
`.tmp/cross-sprite-actor/user-failure.json`. Transaction 45 is a temporary duplicate
of an attached `if/else` stack; transaction 46 shares it to Sprite2. Scratch undoes
the source drag after delivering the GUI drop. Studio had committed that temporary
creation as a separate edit and could capture a project checkpoint before the
source rollback. The animation correctly could not find the nonexistent actor.

A real Alt-dragged attached substack reproduces the extra history step. The fix is
at the recording boundary, not an opcode exception or a missing-actor animation
fallback:

- Buffer each native drag group's snapshots until its settled notification.
  Commit inside drops; discard outside source gestures and non-undoable events
  emitted by Scratch's internal rollback. A cancelled gesture is not a rollback:
  Blockly commits it at its current position (including addon paste-at-mouse).
- Wait for source rollback before both script-share checkpoints. Use the pickup
  reference, including a duplicating addon's original source, not the temporary
  detached block's VM coordinates.
- `Gesture.setDragOrigin` is an optional integration hook for duplicate-on-drag.
  The included block-duplicate addon supplies it without depending on Studio.
- `Workspace.rollbackOutsideDrag(group)` uses only the suspended gesture's events
  during native Play. It cannot consume unrelated user Undo entries. Ordinary
  editing retains the normal grouped Undo path.
- Cross-sprite Play reports actual moving-block rectangles, not just pointer
  frames. Verification rejects a stationary stack even if the pointer arrived.

The new browser test authors an attached C-block with a child, shares by ordinary
and Alt-drag, checks no phantom transaction, and verifies complete Undo/Redo before
and after Play and reload. Frame samples assert the C-block and child travel
together; screenshots show them above the sprite cards outside the code viewport.
The standalone target-operations suite is now in the release gate too.

Old recordings that already contain a rolled-back source creation are preserved,
not silently rewritten or treated as valid. New capture prevents the corruption;
repairing an old take requires proving its checkpoint boundaries independently.
The first expanded release run caught an over-broad cancellation filter in the
new buffer: paste-at-mouse finishes via `Gesture.cancel()` while retaining its
move. The real clipboard regression and a dedicated unit test now enforce that
distinction. Addon provenance uses `workspace-duplicate`, not the native
definition-argument `workspace-copy` kind, to preserve existing replay planning.

Fork commit: `8012dfaf` (compiled bundles included). Fork JSUnit: **215 vertical,
161 horizontal**. GUI unit gate: **604 tests / 68 suites**. Changed production
files and the expanded browser/recorder tests pass lint. Final candidate bundle:
`55c8279289d8f951848a`. Full browser release gate: **18 tests / 10 suites passed**
in 791 seconds, including both attached-stack sharing paths, copied substacks,
43-step connection matrix, held history, interrupted Play, clipboard, rendering,
native drag contract, sprite operations, dialogs and File/New/reopen.
Logs: `.tmp/cross-sprite-actor/release-gate-final.log` and `unit-final2.log`.
The old stable build is retained at
`scratch-gui-working-snapshot/build-before-outside-drop-20260827a` when promoted.

### Code first, then create a sprite and share (27 August)

The follow-up six-step take failed at its fourth transaction with `Source script
is unavailable`, before the copy gesture began. Evidence is retained in
`.tmp/cross-sprite-actor/six-step-user-failure.json`. The original test matrix
created the destination sprite before authoring the source code, missing this
important ordering.

The source was at fractional VM coordinates (247.555..., 146.518...). Switching
sprites fed those numbers through Blockly XML's `parseInt`, producing (247,146).
SB3 checkpoint serialization instead rounded to (248,147). After checkpoint ID
regeneration the source reference could not find the same stack.

- Fork commit `e2d3ccc8` preserves fractional block coordinates when loading XML.
  The two parser changes align the workspace with the VM instead of quantizing
  differently on a sprite switch. The regression includes negative coordinates.
- Shared reference resolution accepts the documented one-unit XML/SB3 rounding
  difference for older recordings only when there is exactly one candidate of
  the recorded root type. It does not choose a nearest block or weaken topology
  verification; even an exact-coordinate candidate is rejected if another root
  falls inside the compatibility bound.
- The new browser scenario authors a hat/wait stack first, creates a painted
  sprite through the real menu, shares the code, and tests Play, Undo/Redo and
  reload. Play completion is explicitly awaited, not inferred from a timeline
  cursor that already matched before playback started.

The same take then exposed a follow-up history error at position 4/6: adding a
repeat around the copied wait used an unresolved parent (the copied root's
recorded y=69 versus restored y=70). This is another caller of the shared bounded
reference resolver, not a reason to patch the VM's `next` assignment. Evidence:
`.tmp/cross-sprite-actor/six-step-wrap-failure.json`.

Extending the genuine mouse-authored scenario to all six steps also reproduced
a distinct full-Play failure: the C-block's outer notch was aimed at the hat,
when native wrapping requires its inner statement connection to meet the wait's
previous connection. `enclosingConnections` derives that pair from the induced
move of the old occupant into the dragged block's recorded input. Flyout
endpoint, movement endpoint and intended-preview gating use that same pair.
There is no opcode whitelist, extra corrective drag, or bypass of preview/state
verification. Unit coverage includes both SUBSTACK and SUBSTACK2, regenerated
IDs, and rejecting ordinary appends or unrelated input moves as wraps.

The six-step browser regression passes full Play, every keyboard Undo/Redo
boundary, 4x forward/backward timeline playback, and the same checks after reload.
Studio unit gate: **609 / 68 suites**; Blockly JSUnit: **216 vertical, 162
horizontal**. The restart interrupted
the previous broad browser run after eight suites; it is not counted as a pass.
The first wrap release run caught a re-resolution regression in matrix step 34:
an existing drag's already-resolved destination was being followed through its
post-gesture path again. Existing-drag preview now retains the resolved connection;
only the pre-clone flyout path resolves the recorded destination. The failed run
was stopped and is not counted as release verification.
Final candidate `74d2895c0ccbfeb924b6` passes **20 browser tests / 10 suites**
in 886 seconds and **609 Studio tests / 68 suites**. Logs:
`.tmp/cross-sprite-actor/wrap-release-final.log` and `wrap-resolved-unit.log`.
Production lint and the changed integration/reference test files pass; the
large existing native-driver unit fixture retains its pre-existing lint findings
and was not reformatted as part of this fix.

**Original six-step take, live verification:** promoted the exact 499-file
candidate to 8601; retained the prior build at
`scratch-gui-working-snapshot/build-before-copy-wrap-20260827a`. The same take
now completes the copy and wrap gestures. Its reported history transition 4->5
passes redo, undo, redo at 4x in the user's in-app tab. The transaction array
remains byte-for-byte equivalent when serialized; the take was not rewritten.

Full Play of this older take still reports a final-state mismatch: its recorded
end expects Sprite2's root y=69, while the operation checkpoint restores y=70.
An exhaustive projected-project comparison finds exactly that one numeric
difference, with all block/connection data matching. Evidence is retained in
`.tmp/cross-sprite-actor/six-step-final-coordinate-check.json`. Do not count this
old take as a full Play pass, weaken state validation, or silently rewrite its
head. A separately repaired copy is the recommended compatibility follow-up,
pending the user's choice. New recordings pass the complete release gate.

### Keep copy presentation separate from editing context (27 August)

The next visual report exposed a gap in the browser assertions: they verified
the shared stack's moving geometry and final project, but not the selected
sprite on each painted frame. The code-first/paint-sprite/copy/wrap journey
reproduced a Sprite2 selection with no pointer click. A project-operation
checkpoint selected the recorded editing target even when no corresponding
selection had been presented, and the restore itself painted the VM's default
Sprite1 before selecting its intended context.

Realistic Play now keeps the editing context established by visible interaction
through project checkpoint reconciliation. Copying changes the destination's
data without opening it. An unsupported snapshot-only creation does not open
the new sprite either; a later block edit selects it with the shared pointer.
Library actions that visibly create/select a sprite retain that result. History
keeps its recorded target selection. Both restore their chosen context before
the existing expected-project-load paint barrier, rather than afterward. The
barrier itself is retained to protect File/New classification.

The native copy also holds the stack at the destination for eight clock frames
before releasing it. This uses the existing speed/cancellation-aware clock and
real Blockly gesture; it is not a second visual clone or a semantic substitute.
Stopping during that beat cancels the gesture without issuing the drop. A
missing visible target selector during Play now reports an error instead of
silently switching through the semantic target port.

The regression samples the selected DOM sprite every playback frame, requires
each switch to follow a click with the visible virtual pointer at that click's
coordinates, and requires the held stack/pointer to reach the destination card.
It exercises both copy-only and copy-then-edit, every Undo/Redo boundary,
forward/backward timeline playback, and repeats after reload. The original
selection assertion failed against the previous bundle and passed after the
fix. Unit gate: **613 tests / 68 suites**. Logs are under
`.tmp/cross-sprite-actor/context-*`. The broader browser gate passed **20 tests
/ 10 suites** in 601 seconds (`context-release-browser.log`). The exact
committed build's final focused check passed both copy-only and copy/edit
journeys (52 seconds), recorded in `context-committed-browser-final.log`.
The committed-source candidate is `2815deedd5facd53d75d`; all 499 files were
hash-checked when promoted to the working snapshot. The preceding snapshot is
retained at `scratch-gui-working-snapshot/build-before-visible-copy-20260827a`.
The user's existing tab was refreshed in place and its six-step recording
completed full Play on that bundle. Its take ID and transaction array were
verified unchanged; no replacement take or compatibility repair was created.

The stricter final DOM assertion also exposed a distinction from an actual
sprite switch: checkpoint loading can briefly unmount all sprite selector cards.
The observer retains the previous sprite identity across those loading frames
and still requires a pointer click if the next selected card differs. This does
not claim that checkpoint loading has become visually atomic; eliminating its
temporary loading frame is separate work from preventing unannounced switches.

### Configurable history cursor (27 August)

The user subsequently requested a visible Undo/Redo cursor, especially for
sprite switches. History now defaults to showing it, with a theme-aware
**Cursor for Undo/Redo** checkbox in the timeline panel. The choice is saved
per browser, independently of the recording; explicit diagnostic query values
`studio-history-pointer=0` or `=1` take precedence on reload. Full tutorial Play
keeps its separate cursor setting and realistic timing.

The isolated Blockly transition renderer follows its primary actor through
arrival, departure and movement. It does not drag the authoritative workspace
or attach the cursor to the stationary receiving blocks. History reuses the
shared target-resolved pointer, sprite-click driver and event scope; travel and
click beats run at three times tutorial speed, while the existing block curves
and timing remain unchanged. An initial sprite change starts at the currently
selected card. Checkpoint history selects an existing destination visibly
before restoring, or retains the current context and clicks a newly restored
sprite afterwards. Instant seeks remain pointer-free; field edits do not gain
typing/dialogue theatre.

The existing command queue still applies every semantic transaction. A newer
queued key aborts pointer travel/click presentation, releases its input scope,
and finishes the active block surface. Intermediate commands skip animation;
the final command can animate normally. Idle reuse cancels the previous fade
timer, and the cursor settles, waits and fades using the shared overlay model.

The dedicated real-mouse-authored browser journey covers a library sprite,
blocks on two sprites, a move, every Undo/Redo boundary, per-frame cursor/actor
alignment, visible clicks for every sprite switch, the disabled checkbox,
persisted reload, queued keys during a block animation and a selector journey,
and unchanged recorded transactions. Existing pointer-free rendering/matrix
journeys explicitly opt out instead of silently weakening their assertions.
Unit checks cover preference persistence, cancellation and scope release,
checkpoint selection order, actor isolation and initial sprite travel.
Evidence is recorded under `.tmp/native-complex-authoring/history-cursor-*`
and `.tmp/history-pointer-*`.

Verification: **623 unit tests / 70 suites** and **21 browser tests / 10 suites**
passed (`history-pointer-unit-final.log`, `history-pointer-browser-gate.log`).
The full browser run took 645 seconds on candidate `aef692cf53b4b1a22f56`.
After the idle-timer reuse correction, final bundle `c7b592f31332480506c6`
passed the cursor journey (including slow movement across the old fade deadline)
and both copy/copy-then-edit journeys in 72 seconds
(`history-pointer-final-browser.log`). Source lint, focused new-test lint and
`git diff --check` pass. No Scratch Blocks fork changes were required.

### Sprite selection is a history stop (27 August)

A required sprite/Stage selection now consumes the entire interactive Undo or
Redo command. It does not change the transaction cursor, apply block/data edits,
load a checkpoint or append a synthetic transaction. The panel says which sprite
was selected and asks for the next press. This is independent of the cursor
checkbox and still counts as a command when queued keys skip presentation.
The next press applies the now-visible edit. Ordinary single-sprite history is
unchanged; exact scrub/jump remains a direct semantic seek.

Automatic timeline traversal treats the same selection as a separate pause,
then continues the edit. Full tutorial Play uses the shared sprite-selector
driver's post-selection barrier, including selections inside costume, sprite,
paint and clipboard interactions. New/deleted targets that cannot be selected
before a checkpoint are handled at the restored boundary, not fabricated early.
Before/after editing-target identity also distinguishes a rename from switching
to another sprite: select the incoming name, then retain that same context under
its outgoing name through checkpoint restoration.

The panel's **Sprite pause** is stored in the take as
`presentation.targetSelectionPauseMs`, defaults to 500 ms for both new and legacy
takes, accepts 0–30000 ms, and scales with playback speed. It is independent of
per-transaction `pauseAfterMs` and the browser's history-cursor preference.
The optional metadata preserves schema-v1 compatibility and never invalidates
the semantic head. Escape cancels a pending playback pause; if no edit has begun,
the cursor remains at its preceding boundary. A manual Undo/Redo selection stop
has no forced timer: it waits for the user's next command.

Regression helpers allow at most one explicit selection-only stop before an
edit; they do not retry arbitrary no-ops or failed commands. The real-mouse
journey independently compares every project's block trees at the first press,
checks cursor-off mode and six queued commands for four edits plus two stops,
reloads the saved pause, and measures selection-to-motion delays in rendered
frames for both timeline traversal and full Play. These are bounded cases, not
a claim of exhaustive Scratch authoring coverage.

Final bundle `366a9a4ce15b82e58fe8` passes **635 unit tests / 71 suites** and
**22 real-browser tests / 11 suites**. The full browser gate took 687 seconds
and includes the rename-selection and Escape-during-pause checks. Logs are
`.tmp/sprite-stops-unit-final.log` and `.tmp/sprite-stops-final-browser-gate.log`;
the focused cursor/lifecycle run is `.tmp/sprite-stops-final-focused.log`.
With an 850 ms authored pause, its rendered-frame samples measured 930 ms
from selection click to timeline motion and 997 ms to the next Play journey.
Source/new-helper lint and `git diff --check` pass. All 499 build files were
hash-checked in staging before promotion; no Scratch Blocks changes were needed.

### Native C-block wrapping previews (27 August)

The six-step copy/wrap take exposed an ownership gap in the history renderer:
only next-chain edges were classified as carried or stationary. Undo therefore
carried the enclosed waits away with their wrapper; Redo previewed a normal
outer-notch insertion, leaving those waits below the C until final handoff.
The final semantic project could match while these intermediate frames were
visibly wrong.

The isolated transition scene now classifies statement-input edges as well.
Surviving released contents reconnect to their verified receiving script; owned
substacks and value inputs still travel with their actor. An arriving wrapper
previews its inner statement socket against the existing child's previous
connection, using Blockly's native surrounding-C marker and layout. The reverse
transition holds that source preview while the wrapper departs, then removes it
through the same native marker contract. Moving an existing wrapper away releases
the source preview once clear, before any destination preview. No opcode list,
hand-drawn C outline, duplicated hidden contents or VM mutation is involved.

Intermediate screenshots also caught the empty actor silhouette overlapping its
contents even with a correct marker. The vertical Scratch Blocks renderer now
exposes `block.setStatementInputPreview(name, size, amount)` solely for empty
statement inputs in read-only workspaces. It interpolates the native input rows,
including the bottom-notch rule, without connections or serialized data. History
grows the C to its native occupied size before the receiving preview and starts
departures at that size before shrinking. Normal editor rendering and full Play's
real gestures do not set this transient geometry. The local-bundle installer
requires the new hook; a fork test guards isolation, interpolation, validation,
empty-input ownership and unchanged XML.

The real-mouse regression records a genuine Scratch wrap as its visual reference,
then compares the enclosed blocks' parentage and relative rendered positions on
every preview frame. It covers repeat, nested if/else, forever at 2x workspace
zoom, and an existing C-block, with two enclosed commands. Keyboard history,
reverse/forward timeline ranges, full Play and history after Play are exercised;
independent VM trees and rendered block counts still verify every boundary.
Unit cases distinguish releasing surviving contents from deleting an entire
owned substack. Browser evidence and screenshots live under
`.tmp/native-complex-authoring/wrap-preview-*`.

The renderer hook is committed in Scratch Blocks as `bfabb50b` and its generated
vertical bundle is installed by `npm run studio:use-local-blocks`. The focused
four-scenario browser run passes on candidate `43a8984ef198bb600fe2` (131 seconds);
Studio unit checks pass **637 tests / 71 suites**, and the fork passes **217
vertical / 162 horizontal tests**, including exact native outline equivalence
for open-ended and capped contents. Logs are `.tmp/c-wrap-shape-browser.log`,
`c-wrap-shape-unit.log` and `c-wrap-blockly-tests-final.log`.

The exact candidate also passes the complete serial release gate: **26 browser
tests / 11 suites** in 821 seconds (`.tmp/c-wrap-release-browser.log`). This
includes the earlier clipboard, cross-sprite selection, held-history, interrupted
Play, connection-matrix and File/New regressions. All 499 files were hash-checked
in snapshot staging. Production and new unit-test lint pass; the large existing
integration fixture retains its six pre-existing `no-shadow` findings outside
the new wrapping cases. This is bounded regression evidence, not a claim of
exhaustive Scratch interaction coverage.

### Sprite arrival and creation pauses (27 August)

Sprite and Stage selection now share an explicit click profile: 12 still
frames before the press, 4 pressed frames, and 12 still frames after release
(200 / 67 / 200 ms at 60 Hz and 1x). The existing saved post-selection pause
is unchanged. History accelerates pointer travel, not this click profile;
the chosen presentation speed still scales both. The shared clock accepts a
per-sequence speed override without changing the following journey's speed.
Cancellation releases a held cursor and cannot activate an uncompleted click.

Library sprite creation uses the same profile for the Add icon and library
item, and awaits creation before its after-click hold. Recordings without
library provenance, including existing painted-sprite takes, now show the
pointer travelling to Add and applying their checkpoint on a virtual click.
This is explicitly reported as `snapshot-sprite-create`, not native picker
replay. It neither invents a library choice nor changes the recording. The
normal transaction safety checkpoint, hash validation, context-selection
rules and cancellation rollback remain authoritative.

The real-browser regression measures rendered arrival/press frames, actual
selector/library clicks, the first visible created sprite and subsequent
cursor motion. At 1x it measured four history arrival pauses of 199.8–200.2 ms.
It also exercises Escape during creation's arrival hold, resumed Play,
selection-only history stops, queued keys, and Undo/Redo after creation.
Timing traces are `.tmp/native-complex-authoring/sprite-*-timing.json`.
The Studio unit suite passes 648 tests across 71 suites; the focused timing
browser run passes both cases (`.tmp/sprite-click-browser2.log`).
The related browser gate also passes 7 tests across 4 suites in 158 seconds,
including code/copy/wrap, target transfer, authoring dialogs and sprite
lifecycle (`.tmp/sprite-click-regression.log`). This is a targeted gate, not a
rerun of the complete release matrix. Production and the new timing helper
pass lint; touched existing test files retain their pre-existing lint findings.

### Creation clicks own the new selection in every animated mode (27 August)

The previous arrival-pause change missed history creation: Redo/timeline still
restored a sprite first, then clicked its newly appeared tile. Full Play did
click Add, but deliberately retained the old context, producing an unnecessary
tile click when the next transaction edited the new sprite. The timing tests
checked cursor position and delay, but not the selected sprite at first paint.

`presentSpriteCreation` is now shared by Play and history. Its Add click owns
both the checkpoint update and the recorded post-creation selection. Copying
code still preserves the source context; creation no longer inherits that rule.
Existing-sprite navigation remains a separate history stop. Cursor-disabled
history and instant seek remain unanimated and select the new sprite directly.
When history catch-up interrupts the gesture, the executor tracks whether its
checkpoint was already applied, so the edit completes exactly once. Full Play
cancellation retains its transaction rollback behavior.

The browser regression now asserts the selected sprite on the first frame in
which it exists, the pointer's position over Add on that frame, and absence of
a click on the new tile. It covers Play, individual Redo, timeline forward,
instant seek, cursor-disabled Redo, and queued Redo before/after the creation
click. The old build fails the selection assertions in Play and both animated
history modes (`.tmp/sprite-create-order-before.log` and
`.tmp/sprite-create-order-history-before.log`). The focused fixed-build run
passes all four cases, and Studio units pass 650 tests across 71 suites.
The final targeted browser gate passes 10 tests across 4 suites in 184 seconds
(`.tmp/sprite-create-order-regression-final.log`), including both code/share
journeys through Play/reload and target reorder, dialogs, and sprite lifecycle.
The keyboard-only queue passes before and after the Add click. A separate
cross-surface queue gap (keyboard during a panel-started command) is recorded
under roadmap Priority 0; it is not covered by the successful keyboard-only
claim. All 499 candidate files were hash-verified before snapshot promotion.

### One queue for explicit history commands (28 August)

The previously separate keyboard and panel queues could not coordinate. A
keyboard Redo arriving during a panel-started sprite creation was silently
ignored. The real-browser regression reproduces that on the previous build
(`.tmp/shared-history-before.log`), without a synthetic event or session call.

`createHistoryCommandQueue` now belongs to the session. Toolbar previous/next,
keyboard shortcuts and workspace context-menu commands all use
`session.requestHistory`. Each request remains a user command, not a cursor
delta: a required sprite selection still consumes one request before an edit.
Incoming commands finish the active presentation; intermediate queued commands
skip animation, and the final command uses its requested presentation speed.
The semantic executor, inverse transactions and Blockly's native Undo are
unchanged. Failure discards dependent pending commands, and disposal prevents
new work from starting after an awaited preparation step.

Queue ownership lasts through the terminal transaction's cleanup, even after
its idle cursor has been published. Only the two history-step buttons stay
enabled during that interval. The panel temporarily sits above the editor's
input shield so physical clicks reach them, while all other transport controls
remain locked and ordinary editor interaction remains shielded. Full Play keeps
the original panel/modal layering. Escape followed immediately by a history key
waits for the stopped playback boundary, rather than racing rollback or losing
the request. The normal editable-input and native Paint keyboard rules remain.

The focused browser run passes five tests across two suites in 134 seconds
(`.tmp/shared-history-browser-focused.log`). It covers both input orders during
creation, both sides of the Add click, repeated same-surface requests, rapid
mixed-direction history, endpoint pressure, sprite-selection stops, attached
input rendering after catch-up, and Escape/Undo followed by Play and reload.
Independent VM-tree checks reject missing children, cycles and incorrect parent
links; live workspace counts reject leftover rendered blocks. The final Studio
unit run passes 659 tests across 72 suites (`.tmp/shared-history-unit-final.log`).
The complete maintained serial browser gate passes **29 tests / 10 suites** in
847 seconds (`.tmp/shared-history-browser-gate.log`) on bundle
`50c23fb06610c1b378a6`. This includes the connection matrix, all complex-authoring
cases, held-key/branch pressure, clipboard, interrupted Play, rendering, target
operations, native drag contract, File/New restart, and authoring dialogues.
All 499 candidate files were hash-verified in snapshot staging. Production and
the new queue tests pass lint; pre-existing findings in the older test fixtures
remain unchanged. No Scratch Blocks fork changes were required.
Recording versions and surgical timeline editing are not part of this change.
