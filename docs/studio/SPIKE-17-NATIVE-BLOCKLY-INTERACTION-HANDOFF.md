# Spike 17 handoff: native Blockly interaction playback

Date: 26 August 2026

Status: native history core, coalesced timeline scrubbing, persisted per-transaction pause timing, responsive traversal, presentation consolidation, rollback gates, realistic Play command/reporter/Boolean flyout creation, swappable target-resolved Play pointer, real dropdown selection, variable/list create/rename/delete, broadcast/custom-block dialogues, built-in libraries and deterministic sprite/sound/costume/backdrop lifecycle verified

Gate evidence and the continuation decision are recorded in
[`SPIKE-17-NATIVE-BLOCKLY-INTERACTION-GATE-1.md`](SPIKE-17-NATIVE-BLOCKLY-INTERACTION-GATE-1.md).

## Pronounced pointer acceleration and deceleration — verified 26 August 2026

Natural pointer travel and both straight and connected block drags now share a cubic ease-in/out time curve.
The spatial path, modest bend, overshoot/recoil, target hotspot and final snap point are unchanged; only the
rate along that path changes. The first and last frame steps are more than eight times smaller than the centre
steps in the fixed-path regression, producing a visibly longer gather/settle with a much faster middle crossing.

The six-step variable/list take completed at normal speed in the real in-app editor and rewound to `0/6` with
no restoration or state mismatch. Pointer, interaction-clock and native-drag tests pass together, including
identical overlay/Blockly coordinates and final-frame snap activation. The complete Studio gate passes 64
suites / 529 tests, focused source lint and `git diff --check` are clean, and the production build succeeds.

## Real costume/backdrop upload and Paint creation — verified 26 August 2026

Costume and backdrop file additions now retain an explicit upload source only when they came through Scratch's
real file control. Full Play selects the durable sprite or Stage, opens Costumes or Backdrops, resolves the exact
hidden file input and reconstructs a browser `File` from the content-addressed asset in the recorded
after-checkpoint. Blank Paint creation similarly uses the real action-menu hover and Paint button. Sprite assets
use the Costumes editor; Stage assets use Scratch's always-visible add-backdrop menu so the pointer never targets
a control clipped below a short Backdrops editor. Generic
API additions and multi-frame imports remain honest semantic presentation rather than being mislabelled as one
file gesture.

The permanent four-step Chrome journey uploads the real SVG fixture and creates a blank painted asset on both
Sprite1 and Stage, rewinds to the one-costume/one-backdrop base, completes natural-pointer Play, reloads the
editor at position zero and completes Play a second time. It verifies the real controls and exact media identity
at all four created boundaries. The first reload
run exposed a general persistence defect: the legacy Blockly ordering migration filtered empty `events` arrays
before checking transaction kind, silently erasing project operations and data edits. Semantic transactions now
bypass that block-only migration unchanged, with a direct journal regression test.

Checkpoint restore capture remains paused through downstream GUI settlement, delayed known base/head project
loads cannot be mistaken for File -> New, failed or no-op project operations preserve the redo branch, and page
exit pauses every capture seam before teardown. The complete Studio gate passes 64 suites / 539 tests, the
production build succeeds, and the persisted real-browser journey passes in 39 seconds.

Volume, tempo and video configuration were also audited. In this editor they are runtime mutations produced by
Sound, Music and Video Sensing block execution, not direct GUI authoring gestures. Their endpoint state is
already restored by the authored-state port. They should not be captured as authoring transactions; a future
execution recording mode needs a separate runtime track so running a project cannot corrupt the edit timeline.

## Variable/list rename and delete — verified 26 August 2026

Realistic Play now opens the live variable/list flyout field menu, chooses Scratch's Rename or Delete
entry, types rename text through the shared pointer model and confirms deletion through an editor-themed
modal when Scratch reports multiple uses. The verifier requires the precise Blockly lifecycle event,
workspace and VM definition state, every recorded use to be absent after deletion, completed pointer
travel and unchanged Studio/Blockly history. Ordinary Undo/Redo keeps the fast semantic presentation.

The browser gate found three general lifecycle defects during this work. A recorded deletion synthesized
an absent authored definition without retaining its scalar/list type, leaving a deleted list in the data
shadow and aborting the next variable creation. Native rename evidence retained Blockly's live
`VariableModel`, whose workspace reference is circular; evidence now contains only durable ID/name/type
primitives. Finally, verified native lifecycle gestures bypass semantic replay and therefore also bypassed
its authored-definition adoption. The transaction executor now advances both definition shadows after a
verified native gesture.

Live take `lifecycle-shadow-clean-20260826a` recorded six real actions: create, rename and delete a global
list, then create, rename and delete a global scalar. It completed Rewind, pointer-driven full Play and a
second Rewind at exact `0/6` and `6/6` boundaries with zero capture errors. The permanent Chromium journey
extends that to eight boundaries by dragging two genuine scalar-use blocks, accepting Scratch's deletion
confirmation, rewinding, playing at 4x, reloading and playing again. It passes in 21 seconds. The confirmation
bridge has its own live probe because the Blocks container's render filter must include confirmation state;
otherwise the callback can run without the modal ever being painted. `studio-debug=1` exposes the capture
snapshot/error summary used to diagnose delivery failures. The complete Studio gate passes 64 suites / 528
tests, focused source and browser-journey lint are clean, `git diff --check` is clean and the production build
succeeds. The permanent Chromium journey is `test/integration/studio-variable-lifecycle.test.js`.

## Interrupted history-exit cleanup — verified 25 August 2026

Fast Undo/Redo now invalidates an in-flight lifecycle presentation synchronously. Previously, calling
`finish()` on a Web Animation left its `finished` promise and proxy cleanup until a later microtask. A
second history keypress could therefore advance verified Blockly state while the SVG copy of an
already-removed block remained visible; an interruption during semantic replay could even start that
stale presentation afterwards. Each captured presentation now carries a generation, interruption
advances that generation, restores hidden/excluded roots and removes every proxy immediately, and a
stale `playAfter` exits without recreating the proxy.

Real-browser verification used the 19-step/38-event long-script take in bundle `4fb927a7279f`. Full Play
completed, ordinary Ctrl+Z traversal reached zero main-workspace blocks with zero hidden roots and zero
proxies, rapid Ctrl+Shift+Z/Ctrl+Z traversal left only the intended terminal animation, and an extra
Ctrl+Z issued 35 ms into the final visible exit removed that proxy before the first 10 ms sample. The
single replacement editor tab is labelled `studio-build=20260825-history-exit-cleanup`. The regression
gate passed 47 Studio suites / 320 tests, focused source ESLint and the production build.

### Play pointer reset — verified 25 August 2026

The interruption marker above is scoped to one fast-history queue. Rapid or surplus Undo/Redo input can
leave that marker set after the queue drains, but full Play is a new presentation sequence and now
clears it before compiling its first native interaction. Without this reset, Play remained semantically
correct but skipped every native driver, so the shared virtual pointer was never created.

Live verification in bundle `5e6caab4ab66` first reproduced a complete 19-step Play with no
`#tw-studio-native-pointer`, then verified the fix over both a complete Play and Play resumed after five
rapid Undo commands. The pointer existed for 493 sampled frames in the full run and 127 sampled frames
in the resumed run, moved through distinct palette/workspace coordinates, and exposed its pressed state
during the Blockly drops. The active tab is labelled `studio-build=20260825-play-pointer-reset`. The
regression gate passed 47 Studio suites / 321 tests, focused source ESLint and the production build.

### Stopped-Play delete identity — verified 25 August 2026

Escape can stop Play after several native flyout interactions have regenerated Blockly IDs. The
subsequent semantic Undo already resolved the live root for its lifecycle animation and `blockId`, but
Blockly's delete event actually iterates its separate `ids[]` descendant list. That list still contained
the recorded root, so each Undo appeared to remove the right block while leaving the real regenerated
block in the workspace until the final canonical-base restore removed everything. Semantic deletion now
substitutes the resolved live root in `ids[]` as well as `blockId`; disposing that root also disposes its
owned regenerated descendants without including separately connected existing blocks.

Live verification in bundle `50f0e83c2d0f` played until the fifth native block appeared, pressed Escape
while that transaction was active, and settled at four verified blocks. Four ordinary Ctrl+Z commands
then reduced the real main-workspace block count `4 → 3 → 2 → 1 → 0`; every settled frame had zero
hidden roots, zero history proxies and no stopped-Play pointer. The active tab is labelled
`studio-build=20260825-stopped-play-delete-root`. The regression gate passed 47 Studio suites / 322
tests, focused source ESLint and the production build.

### Regenerated input-shadow lifecycle — verified 25 August 2026

Native Play regenerates the IDs of the default number/text shadow blocks inside a flyout-created block.
Fast Undo previously compared those live IDs only with the recorded create-event IDs and classified the
shadows as external descendants, so the lifecycle proxy retained labels such as `say for seconds` but
pruned the visible `Hello!` and `2` inputs. Lifecycle capture now treats live shadow descendants as
visually owned by their lifecycle root. Non-shadow descendants are still excluded, preserving the
middle-stack rule that existing lower stacks and separately inserted reporters remain real Blockly
content rather than travelling in the removed block's clone.

Live verification in bundle `85e140525de0` replayed the flyout-created `say [Hello!] for (2) seconds`
block and captured its subsequent Undo proxy. Before the repair its proxy text was `sayforseconds`; after
the repair the same frame contained `Hello!2sayforseconds`, then settled with zero proxies and zero
hidden roots. The active tab is labelled `studio-build=20260825-play-shadow-proxy`. The regression gate
passed 47 Studio suites / 323 tests, focused source ESLint and the production build.

## Repeated history and Play extension — 24 August 2026

The first gate now traverses more than one supported transaction in both directions. `Undo`, `Redo`
and panel `Play` share the same transaction-level native-or-semantic executor. Target selection,
authored-state restoration and viewport preparation complete inside the same history command; a first
keypress is no longer consumed merely to prepare the transaction.

The native planner now compiles a backward existing-block drag from the first recorded old location,
while forward playback continues to use the last recorded new location. Backward transactions with
induced block moves are rejected before any mutation because their inverse needs more than one genuine
Blockly gesture; those transactions use exact semantic replay. Once a native gesture starts, mismatch
still stops playback without fallback or cursor advancement.

The real-editor fixture used two distinct connected stacks and recorded the tail command block moving
between them twice. Live results:

- two consecutive Ctrl+Z commands performed two visible native backward drags;
- two consecutive Ctrl+Shift+Z commands performed two visible native forward drags;
- every direction reported native evidence `verified`;
- panel `Play` rewound and performed both forward drags, finishing as `played · 2 steps (4 events)` with
  native evidence `verified`; and
- the pointer/Blockly coordinates, insertion-marker frames, workspace/VM topology, Studio journal and
  native Undo/Redo isolation gates remained required for every cursor advance.

Post-change verification: 24 Studio suites / 119 tests passed, focused Studio ESLint passed, and the
production build passed.

## Lifecycle and recovery extension — 24 August 2026

Studio history now includes the VM operations which do not emit Blockly events for creating a sprite
and sharing a costume to another target. Each operation is one visible history step backed by exact
before/after TurboWarp restore points, so asset bytes, generated target IDs, costumes and blocks travel
together through Undo, Redo and Play. Blockly transactions on either side remain target-reference based
and reselect the correct sprite inside the same command.

Every history transaction now creates a short-lived safety boundary before mutation. After native or
semantic block replay, Studio verifies each recorded move in both the visible Blockly parent/input
topology and the editing target's VM block graph. A visually overlapping but unconnected stack is a
mismatch. Studio restores the safety boundary, leaves the cursor unchanged, resumes capture, and keeps
the same Undo/Redo choice available instead of stranding the editor in an unknown partial state.

File → New and any other external `PROJECT_LOADED` event are intentionally a hard history boundary.
After the new project finishes loading, Studio automatically discards the prior journal, adopts the
loaded project as a fresh zero-step base, and resumes recording. Undo never crosses that project
boundary; the previous project is not retained as a recoverable Studio step.

Focused extension verification: 26 Studio suites / 129 tests passed and focused Studio ESLint passed.

Live restart evidence used take `native-project-robust-20260824d`: File → New automatically reached
`recording new project · 0 steps (0 events)`; adding the Avery library sprite recorded one project
operation; Ctrl+Z removed it; Ctrl+Shift+Z restored it; and panel Play finished at
`played · 1 steps (1 events)` with the sprite and its asset intact. The costume-share wrapper and exact
checkpoint traversal are covered by focused VM/session tests; the next manual testing pass should keep
the cross-sprite costume-drop fixture as an explicit live check.

The development server was then stopped by its owning process, restarted from a fresh `npm start`, and
left compiled and listening on port 8601. The clean continuation take is:

```text
http://127.0.0.1:8601/editor.html?studio-session=1&studio-take=native-project-ready-20260824e
```

## Scalar variable history repair — 24 August 2026

Studio now retains ordinary scalar-variable definitions as well as lists. Previously
`var_create`/`var_delete`/`var_rename` snapshots were discarded when the definition was not a list;
this allowed the surrounding blocks to enter the journal while a sprite-local variable such as
`cake` was missing during replay. Scalar capture now preserves target ownership, value, cloud state,
monitor block and visible monitor record. Semantic replay restores that metadata through the normal
Blockly event and VM listener path before cursor verification.

Live verification in take `local-variable-verify-20260824b` created a sprite-local `cake` variable.
Ctrl+Z removed the variable and monitor, Ctrl+Shift+Z restored both, and panel Play finished as
`played · 1 steps (1 events)` with no mismatch. The earlier persisted take cannot be repaired because
its journal never contained the discarded variable event; recreate that script in a new take.

Post-repair verification: 26 Studio suites / 135 tests passed, focused Studio ESLint passed, and the
production build passed.

## Flyout-create Undo repair — 24 August 2026

A live five-step script exposed a separate lifecycle error after the scalar-variable repair. Blockly
records a new flyout block as a grouped create-plus-move transaction. Backward replay deletes that
new block, but the topology verifier still required the moved block to exist at its recorded old
location. Replaying the now-redundant inverse move could also ask the VM to detach from a parent which
had already disappeared. Both paths correctly triggered safety rollback, but prevented a valid Undo.

Replay now derives each transaction's final block presence in the requested direction. It skips move
events for blocks which that same transaction will delete, and topology verification checks only blocks
which should survive at the new cursor position. Forward creation/Redo still verifies the recorded
Blockly and VM connection normally, including nested IDs captured in a create event.

Live verification in take `flyout-create-undo-verify-20260824a` reconstructed `when flag clicked → set
cake to 0 → repeat 10 { change cake by 1 }`. Ctrl+Z removed the newly-created `change cake by 1` block,
Ctrl+Shift+Z restored it inside the repeat, and panel Play finished as `played · 6 steps (10 events)`.
The extra step relative to the reported take is a deliberate separate snap used while reconstructing
the fixture; the final flyout create-plus-connect itself remained one two-event transaction.

Post-repair verification: 26 Studio suites / 139 tests passed and focused Studio ESLint passed.

## Two presentation policies — 24 August 2026

History navigation and recorded tutorial playback now have deliberately different presentation goals:

- **Fast Undo/Redo:** correctness and responsiveness are primary. Creating or restoring a block should
  use exact semantic replay, then present a short read-only visual transition near the verified final
  connection. Deletion can use the
  inverse slide/fade. The visual proxy must not become a second mutable Blockly block, and the actual
  workspace/VM topology must remain authoritative throughout. Rapid queued keypresses may snap or skip
  these transitions according to the queued-history policy.
- **Realistic full Play:** teaching and video recording are primary. Playback should select and, when
  needed, scroll the correct palette category; locate the recorded block kind; perform a genuine
  flyout-to-workspace drag; then open real dropdowns or text editors to reach the recorded field values.
  Variable and custom-block creation should eventually use their real dialogues with paced text input.
  Captured semantic intent remains authoritative, while authorable timing and recorded interaction
  metadata control the presentation. A strict video mode should report unsupported realism rather than
  silently substituting a fast history animation.

The fast history transition should be implemented first. It gives immediate legibility without making
Undo/Redo depend on palette layout, flyout scrolling, dialogue state or typing. Genuine flyout creation
and field/dialogue playback then remain the richer Play path rather than an unnecessarily fragile
requirement for ordinary history navigation.

### Fast lifecycle checkpoint — verified 24 August 2026

Fast Undo/Redo lifecycle presentation is now implemented. A block which will disappear is cloned before
semantic replay disposes it; a block which has appeared is cloned only after semantic replay and topology
verification have produced its exact final state. The real rendered block is briefly hidden, while a
read-only SVG proxy presents the transition. Entering blocks now start 40 pixels right and 24 pixels below their
destination, fade from partial opacity, and settle without scaling over 150 ms; they do not travel from an
off-screen flyout edge. Exiting blocks use the exact reverse transition: 40 pixels right and 24 pixels down while
fading over the same 150 ms, with no scaling or flyout-edge travel. Cleanup restores
the real block's visibility even when the browser animation is cancelled or rejects. Create-plus-drop
transactions resolve the recreated block through the transaction's final move reference, which covers
Blockly ID regeneration between Undo and Redo.

Lifecycle proxies are also isolated from connected workspace descendants. When a new block is inserted
in the middle of an existing stack, the proxy contains only IDs created with that lifecycle event (the
new block and its own generated shadows). Existing next/input descendants are pruned from the clone and
kept explicitly visible while the lifecycle root is hidden. Blockly therefore owns the real stack's gap
opening/closing, while only the single inserted or removed block receives the fast diagonal transition.

Only ordinary Undo/Redo enables this port. Rewind and panel Play do not, preserving the separate realistic
Play presentation path. Live verification used a real Motion-palette drag in take
`lifecycle-slide-verify-20260824b`: Ctrl+Z exposed and then removed the slide-out proxy, Ctrl+Shift+Z exposed
the slide-in proxy and restored the block, both proxies were absent after settling, and panel Play finished
as `played · 1 steps (2 events)` with no fast lifecycle proxy. The obsolete editor tab was closed before
this clean-take check. The final regression gate passed 27 Studio suites / 146 tests, focused Studio
ESLint and a production build.

### Fast-history viewport repair — verified 24 August 2026

Fast history no longer restores the transaction's recorded authoring viewport. Semantic Undo/Redo
(create/delete, field changes and similar exact replay) preserves the current logical workspace origin;
after replay it applies an instantaneous correction because Blockly can otherwise recenter when disposing
or recreating the last block changes its content bounds. Move-only history may reveal an off-screen block
because the genuine drag path requires a visible source. Bulk Rewind also preserves the current view,
while full Play alone retains recorded camera movement.

Live verification in take `viewport-history-verify-20260824e` created a real flyout block, panned the
canvas from `translate(310, …)` to `translate(171.9, …)`, and retained `translate(171.9, …)` through both
Ctrl+Z and Ctrl+Shift+Z. Panel Play then intentionally restored `translate(310, …)`, retained the block,
and finished as `played · 1 steps (2 events)`. Only that active verification tab was left open. The final
gate passed 27 Studio suites / 152 tests, focused Studio ESLint and a production build.

### Nearby block entrance refinement — verified 24 August 2026

Fast Redo/restoration no longer brings a newly-present block from the off-screen flyout edge. Once
semantic replay and topology verification have created the real block at its authoritative destination,
the read-only proxy starts 24 pixels right and 24 pixels below that destination, fades from 35% opacity,
and settles without scaling over 150 ms. The small offset makes the restoration legible without implying
that normal history replay performed another palette drag or requiring any workspace camera movement.

Live verification in take `nearby-enter-verify-20260824a` used a real Motion-palette drag. Ctrl+Z removed
the block, Ctrl+Shift+Z exposed the nearby entrance proxy, and the operation settled as
`redone · 1 steps (2 events)` with the proxy removed and the restored block retained. The obsolete
`native-project-ready-20260824e` tab was explicitly claimed and closed; only the working verification take
was marked to remain open. The regression gate passed 27 Studio suites / 152 tests, focused Studio ESLint
and a production build.

The exit was then made the exact reverse of the entrance and the proxy boundary was tightened for middle-
stack insertion. Live take `middle-stack-isolation-verify-20260824a` built `move → turn left → turn right`
by dragging three real Motion flyout blocks, with the middle block inserted last. Ctrl+Z animated only the
inserted `turn left` block while the existing `turn right` block remained real and closed the gap;
Ctrl+Shift+Z animated only `turn left` back into the reopened gap. Both directions cleaned up the proxy and
retained the verified two-/three-block topology respectively. The final gate passed 27 Studio suites / 153
tests, focused Studio ESLint and a production build.

The lower-stack displacement is now a measured second presentation phase rather than an immediate layout
jump. Undo holds a read-only proxy of the surviving lower stack at its old screen position while the
single lifecycle block exits, then slides that stack proxy to Blockly's already-verified final position.
Redo performs the measured stack displacement first to open the gap, then presents the lifecycle block
from 40 pixels right and 24 pixels below. Live take `gap-timing-verify-20260824a` independently exposed
both phases in both directions before settling cleanly at the verified two-/three-block topology. The
final regression gate remained green at 27 Studio suites / 153 tests, focused Studio ESLint and a
production build.

### Reversible rearrangements and responsive history — verified 24 August 2026

Semantic move replay now mirrors Scratch Blocks' complete-group Undo boundary. Blockly can deliver the
initial disconnect and later drag coordinate in separate browser queues even though they share one Undo
group; native Undo filters that complete group again. Studio compacts the same adjacent moves and, for a
move-only semantic fallback, first detaches every affected block before reconnecting final parents in
topological order. This prevents a reverse middle-stack insertion from temporarily trying to connect a
block below one of its own descendants. Non-`Error` exceptions thrown by the pinned Blockly connection
code are also normalized so the safety checkpoint still restores.

Fast lifecycle direction now describes the recorded connection shape. A new command appended at the
bottom arrives from 24 pixels directly below; a command inserted into the middle arrives from 40 pixels
to the right; and a nested input/argument arrives diagonally from 40 pixels right and 24 pixels below.
Undo uses the exact reverse vector. Ordinary native and fast semantic history presentation is pointer-free
by default; the red pointer belongs to recording-quality Play. The diagnostic opt-in
`studio-history-pointer=1` can still show it without changing replay semantics.

Ordinary history and full Play now use separate native timing policies. Undo/Redo generates seven eased
motion frames plus one insertion-marker hold frame, closely matching the 150 ms semantic presentation. Panel
Play retains the slower 24 motion frames plus 12 hold frames for legible tutorial/video playback.
When inverse rearrangement needs semantic replay, a dedicated proxy now follows only the dominant
moved block while the verified surrounding stack settles. The proxy is pinned to the resolved live
block ID across replay rather than re-resolving its recorded stack path afterwards: once two blocks
exchange positions, that old positional path can legitimately identify the neighbour. Descendant roots
connected through `next` are pruned from the clone, so Undo never presents the whole attached lower
stack as the dragged object. Value and statement-input descendants remain in the proxy and hidden in
the verified destination until the motion completes; filled inputs therefore move in and out with their
owning block instead of jumping ahead and appearing twice.

Rearranging the third block upward in a four-command stack has one more induced move than the earlier
bottom-block case: the fourth block heals onto the third block's old parent before the third block is
inserted above the second. Native playback now recognizes that recorded topology, heals the source gap
through Blockly's own `unplug(true)` under Undo isolation, then starts the genuine drag with only the
third block. Generic move actions also resolve their old and new parents through durable references;
this prevents a preceding create-plus-connect step from sending a checkpoint-regenerated parent ID to
Blockly or the VM.

Keyboard Undo/Redo now uses one serialized command queue. A new keypress snaps the active native or fast
presentation to its exact verified endpoint, queued intermediate transactions use semantic replay with
no animation, and the terminal request animates normally. A failure clears requests made against the
operation which did not complete; transactions are never mutated concurrently.

Live take `gap-timing-verify-20260824a`, build `20260824-1930`, replayed the exact previously failing
five-event third-block rearrangement as `played · 5 steps (13 events)`. Undo completed as `undone` with
matching Blockly/VM topology, exposed both the
dedicated primary-block proxy and visible pointer, exposed no generic whole-stack displacement proxy,
and removed both afterwards. Redo reported native evidence `verified` with the fast seven-plus-one frame
policy; the Undo proxy's measured visible interval was approximately 150 ms. At the animation midpoint,
the proxy contained `90 point in direction` as one unit but excluded the following `go to x: y:` block,
with no second destination copy exposed. A three-key Undo burst moved through
all requested states (workspace rendered-block count 113 → 111); three queued Redos returned to the
canonical head (111 → 113) as `redone`, again with no residual pointer or proxy. The final gate passed
28 Studio suites / 166 tests, focused Studio ESLint and a production build.

### Nested reporter shadow replacement repair — verified 24 August 2026

Inserting one `() + ()` reporter into an input of another exposed two replay rules which command-stack
fixtures did not exercise. The recorded final-position reference for the inner reporter temporarily
identifies the number shadow it is about to replace, so replay now prefers the recorded block ID whenever
that ID is still live and uses the durable path only after an ID has genuinely been regenerated. Create
events always retain their XML root ID rather than resolving that absent new block through its future
input path.

Semantic replay now also mirrors Scratch Blocks' complete Undo boundary by setting the package-level
`Events.recordUndo` flag to `false` around each synchronous event run and restoring it in `finally`.
Setting only the individual event's `recordUndo` field was insufficient: Scratch Blocks consults the
global flag to allow a transient top-level shadow during inverse replay and to suppress automatic shadow
respawning while an input is being replaced. Without that boundary, Undo lost the original number shadow
and Redo could move a regenerated shadow instead of the inner reporter.

The regression fixture owns an outer operator and its original shadow, creates an inner operator with two
of its own shadows, replaces the outer input, then runs Redo → Undo → Redo while checking exact ownership.
Live take `gap-timing-verify-20260824a`, build `20260824-2110`, replayed the user's two-step/seven-event
nested expression, settled Undo with only the outer operator and its restored input, and settled Redo with
the same outer/inner operator IDs and both nested inputs. Three additional settled Undo/Redo cycles retained
those exact IDs and left the diagnostic panel empty. The active take is the only editor tab left open. The
final gate passed 28 Studio suites / 167 tests, focused Studio ESLint and a production build.

The first presentation pass still treated the induced deletion/restoration of the outer input's number
shadow as a separate lifecycle animation. That made empty slots slide before the inner reporter appeared.
Shadow-root create/delete events are now presentation-internal: they do not receive an independent proxy.
For a nested reporter or Boolean lifecycle, the containing expression's necessary input reflow runs in
parallel with the reporter proxy rather than as a preceding phase. The reporter proxy retains every ID
owned by its create event, so its two number shadows are cloned, hidden and animated with the green `+`
block as one unit in both directions.

Live build `20260824-2155` exposed the 45 ms midpoint of both Undo and Redo. Each midpoint contained one
reporter lifecycle proxy with exactly the inner operator and its two shadow IDs, no shadow-only lifecycle
proxy, and one concurrent displacement proxy for the surviving outer input. Both directions settled with
the expected operator topology and an empty diagnostic panel; only that active build tab remains open.
The updated gate passes 28 Studio suites / 168 tests, focused Studio ESLint and a production build.

### Identical command-block identity repair — verified 24 August 2026

A later five-event rearrangement exposed an ambiguity which only occurs after checkpoint restoration.
The source block was one of several identical `go to x: y:` commands. Its recorded Blockly ID had been
regenerated, and the native driver rejected the block type as ambiguous before using the transaction's
durable structure. Repeated work from that failed state could leave an extra identical command in the
visible stack even though the safety boundary retained the saved journal.

Native plans now retain the source location for the requested direction: the first old location for
forward playback and the final new location for backward playback. The driver resolves the dragged block
from that current source connection before consulting its final-position reference or the unique-type
fallback. Induced blocks use the same recorded-to-live alias map, so a healed neighbour whose source
parent is the dragged block resolves through the already-established live source ID. The regression
fixture uses `point towards` followed by three identical `go to x: y:` blocks and proves the primary and
healed neighbour resolve from their distinct source connections after every recorded ID is regenerated.

Live build `20260824-2315` reopened take `gap-timing-verify-20260824a` from its saved base rather than
continuing the corrupted rendered state. Panel Play traversed all 11 steps / 39 events; transaction 11
completed through a genuine native drag with synchronized pointer coordinates, nine insertion-marker
frames, matching Blockly/VM topology and unchanged Studio/native Undo history. The canonical head contains
two `go to x: y:` blocks below `point towards`; the spurious third block from the old failed tab was not
recreated. Three additional Ctrl+Z / Ctrl+Shift+Z cycles retained both recorded block IDs and the exact
`point towards -> first go to -> second go to` parent chain. The superseded tab was closed, leaving only
the repaired build at the canonical head. The updated gate passes 28 Studio suites / 169 tests, focused
source ESLint and a production build.

### Semantic pointer pickup visibility — verified 24 August 2026

The optional semantic lifecycle pointer for operator Undo/Redo appeared at the
same instant as the 150 ms movement. On a small reporter the pointer could complete before a user could
visually acquire it, making the drag look cursorless even though midpoint instrumentation found the
overlay moving above the proxy.

When `studio-history-pointer=1` is explicitly requested, fast semantic drags add a 45 ms pickup beat: the
pointer appears at the recorded grab point and holds
there before the existing 150 ms block motion begins. The pointer then follows the same path and finishes
with the block. This applies to lifecycle proxies and semantic primary-block displacement; disabling
`studio-history-pointer` removes the pickup delay as well as the pointer. Queued history interruption can
still finish both animations immediately.

Live build `20260824-2350` replayed take `gap-timing-verify-20260824a` and returned to the exact operator
creation boundary. Midpoint screenshots of both Ctrl+Shift+Z and Ctrl+Z visibly captured the red pointer
above the green operator and its owned input shadows. Position samples confirmed the pointer paused at
the grab point and then travelled with the operator proxy; both presentations cleaned up normally. The
active repaired build is the only editor tab. The gate remains green at 28 Studio suites / 169 tests,
focused source ESLint and a production build.

### Transaction and presentation consolidation — verified 24 August 2026

The accumulated live repairs are now expressed as shared transaction rules rather than parallel edge-
case logic in replay, native planning, topology verification and animation. The pure
`transaction-effects` reducer owns directional presence, compacted replay events, durable source and
destination move effects, dominant/induced move classification and lifecycle ownership. The semantic
replay engine, native interaction planner and topology verifier all consume that same result.

Fast-history presentation has a separate pure plan. It compiles lifecycle direction, append/insert/input
motion, shadow suppression, dominant move identity and parallel input reflow before Blockly is mutated.
The SVG animation port now renders that plan and shares one pointer pickup/path implementation between
lifecycle and rearrangement motion. Presentation policy therefore cannot silently choose a different
block or connection shape from the semantic core.

The complete mutation boundary was also extracted from the session into a transaction executor. It owns
the safety checkpoint, native-versus-semantic decision, topology gate, lifecycle cleanup, exact project-
operation restoration and rollback. The session owns navigation and advances its cursor only after the
executor resolves. Focused executor tests prove that failed native evidence never receives semantic replay
on top, topology mismatches restore the checkpoint with the transaction still available, and project
operations restore the requested target and hash.

Undo and Redo now enter one directional traversal rather than maintaining parallel copies of transaction
selection, target/viewport preparation, executor options, cursor checks, base/head validation, capture
resumption and status publication. Their only remaining differences are explicit direction policies:
Undo seals and validates the recorded head before leaving it and validates the base on arrival; Redo
validates the recorded head on arrival. This removes the structural route by which their presentation or
cursor behaviour previously drifted apart.

Testing now includes recorded-shape contracts for flyout create-plus-connect, third-block/four-block
rearrangement, nested reporter shadow replacement and regenerated identical blocks. The previously thin
native interaction verifier has direct positive and negative coverage for observed destination events,
Blockly and VM topology, induced moves, synchronized pointer coordinates, insertion-marker evidence,
Studio journal isolation and native Undo/Redo isolation. Its focused statement coverage increased from
13.55% to 91.52% (100% functions), while the complete gate increased to 32 Studio suites / 196 tests.

Live take `gap-timing-verify-20260824a`, refreshed onto build label
`20260824-consolidated-0030`, retained the saved 11-step / 39-event journal. Settled Ctrl+Z and
Ctrl+Shift+Z each exposed one lifecycle proxy and the red pointer at the measured midpoint, then removed
all proxies and pointer state. Three rapid Undo keypresses exposed only the terminal displacement/pointer
presentation and settled cleanly; three rapid Redos returned the rendered-block count from 113 to the
canonical 114 with no residue. Panel Play finished as `played · 11 steps (39 events)`, exposed the native
pointer and a genuine `.blocklyInsertionMarker`, showed no fast-history lifecycle proxy, and returned to
the same 114 rendered blocks. Only the consolidated continuation tab remains open.

After that traversal unification, the refreshed live build again completed panel Play, accepted three
rapid Undo commands and three rapid Redo commands, returned to `redone · 11 steps (39 events)` with 114
rendered blocks, and left zero proxy or pointer residue in either direction.

Consolidation commits are `72c15c7cf` (`Unify directional transaction effects`), `e0a5c4483`
(`Separate history presentation planning`), `156b01df7` (`Test native interaction verification gates`)
and `15d9948af` (`Isolate history transaction execution`), followed by `54fee1877` (`Unify directional
history traversal`). Focused Studio ESLint and the production build pass after the live check.

### Compound top-level reorder and pointer symmetry — verified 24 August 2026

The refreshed 11-step take exposed a compact but important Blockly event pattern: moving the bottom block
above the root of a two-command stack records the dragged block's top-level coordinate at pickup, then an
induced move attaches the former root underneath it. That pickup coordinate is not the connected stack's
final root coordinate. Treating it as a durable destination either moved the pointer less than one pixel
and snapped the block back, or rejected Blockly's correct native connection geometry afterwards.

The shared transaction effects now label that compound-reorder coordinate explicitly as gesture-pickup
evidence. Native playback aligns the dragged block's lower statement connection with the displaced root's
upper connection, while both native and transaction-level verifiers require the exact pickup event and the
final parent graph without inventing a post-drop coordinate jump. A newly promoted top-level block may also
briefly return no rendered coordinate; only the exact primary observed event can cover that one-frame gap,
and other affected blocks retain strict workspace and VM checks. Failed Play restores the exact transaction
boundary and now publishes the original stack trace as diagnostic evidence.

History pointer capture now applies the same live-ID-first rule as semantic replay. When a created reporter
still exists during Undo, its exact ID wins over a future structural path which can currently resolve to the
replacement shadow. This repaired the two lifecycle removals which showed a pointer on Redo but not Undo.

Live build `20260824-review-1200` completed panel Play as `played · 11 steps (35 events)`. Eleven settled
Ctrl+Z stages and eleven Ctrl+Shift+Z stages all exposed `#tw-studio-native-pointer` at the 70 ms sample,
settled without topology or canonical-head diagnostics, and returned to `redone · 11 steps (35 events)`.
Three rapid Undo presses and three rapid Redo presses also retained the terminal pointer animation and
returned to the same head. The regression gate is 32 Studio suites / 208 tests.

The repair commits are `ade7aaa27` (top-level retry), `3e698149b` (reorder pointer identity), `1a91c7754`
(post-pickup drag coordinates), `ea5e73fee` (exact failed-Play boundary), `a9f8bac1f` (top-level verifier),
`23443c9cf` (native two-block reorder geometry), `73d33d446` (pickup-coordinate model), and `4f0eda6a2`
(live lifecycle ID pointer capture).

### Split reorder destination coordinates — verified 24 August 2026

A minimal `go to x: y:` followed by `change x by 10` stack exposed the complementary two-block reorder
shape. Blockly first recorded the lower block detaching to `y=332`, then recorded the same block's real
free-drag destination at `y=235`, and finally attached the former root underneath it. The earlier
compound-reorder classifier saw the original parent plus the induced child and incorrectly labelled the
later durable coordinate as pickup-only.

Gesture-pickup classification now requires the dragged block's final move event itself to be a direct
parent-to-coordinate detach. When a later top-level move exists, native playback follows that durable
coordinate instead of replacing it with connection-derived geometry. The exact user take, build
`20260824-split-reorder-1300`, completed as `played · 3 steps (7 events)`; one Ctrl+Z and Ctrl+Shift+Z
both exposed the pointer and settled as `undone` / `redone` with no diagnostic. Commit `e3bb3eaf1`
contains the repair and realistic three-move regression. The gate is 32 Studio suites / 211 tests.

### Exact coordinate settling and bundle freshness — verified 24 August 2026

The same three-step take later exposed a stricter project-state mismatch at
`$.targets[1].blocks.b.y`. Native topology verification had accepted the drop because the rendered
workspace root was within one pixel of the recorded destination, but fractional workspace scaling put
it at `y=134.333...`; Blockly serialized that as `134` while the recorded project required `135`.
For durable top-level destinations, the native driver makes bounded sub-pixel pointer corrections before
mouseup when the block is already within one workspace pixel of the target. The corrections remain part
of the genuine gesture and are recorded in frame evidence.

Live take `gap-timing-verify-20260824a`, URL build label
`20260824-coordinate-settle-1435`, completed as `played · 3 steps (7 events)`, then accepted Ctrl+Z and
Ctrl+Shift+Z as `undone` and `redone`. Commit `5d4655fb5` contains the exact-settle repair and a
fractional-scale driver regression.

Studio tabs no longer trust the human-readable `studio-build` URL label. The editor HTML carries the
actual compilation fingerprint, while every compilation emits a tiny same-origin
`studio-build-id.html`. Each Studio tab compares those values on a timer and on focus/visibility. A
stale or unverifiable tab fails closed: Set Base, Undo, Redo, Rewind and Play are disabled and the panel
shows the loaded/current fingerprints plus `reload required`. This means multiple tabs may exist without
silently testing an obsolete bundle, although pre-guard tabs require one fresh navigation before they
gain this protection. Commits `96ad06930` and `056f933c1` contain the guard, visible status, build
endpoint and no-request-API browser fallback. The combined gate is 33 Studio suites / 220 tests, focused
lint, production build, and live Play/Undo/Redo.

### Stationary-stack connection alignment — verified 24 August 2026

The final two-block reorder jump was inside the pinned Scratch Blocks connection commit, not Studio's
viewport or replay code. On mouseup, `InsertionMarkerManager` connected two nearby but non-coincident
statement connections. Blockly's generic connection code moves the inferior block to the superior
connection; when the dragged block's lower connection was superior, that meant moving the former root
and its whole stationary stack at the last frame.

The sibling checkout `D:\dev\twstudio\scratch-blocks` now branches from the exact installed baseline
`4113c5348e6b4c76da9071a1800a62ab96ef793f` as `studio/align-dragged-stack`. Commit `ab643a92` adds one
opt-in Scratch Blocks option, `snapDraggedBlockToConnection`. Immediately before the normal drag move
event and connection commit, the insertion-marker manager aligns the dragged stack's local connection
with the stationary candidate while Blockly events are disabled. The subsequent native `connect()` is
therefore a zero-displacement topology change: the dragged block settles where the insertion marker
previewed it, the stationary stack does not jump, and the user gesture still owns one normal move event.
No global `Connection.connect_` behaviour was changed.

Tutorial Studio enables this option only while its session is attached and restores the previous
workspace value on detach. Normal TurboWarp sessions retain the pinned default (`false`). The local GUI
checkout installs the committed generated horizontal and vertical bundles with:

```powershell
npm run studio:use-local-blocks
```

That command verifies the patch marker and SHA-256 equality after copying. Restart `npm start` afterwards:
webpack deliberately does not watch dependency files. Publishing the Scratch Blocks branch and replacing
the GUI's Git dependency is a separate external integration step; until then, `npm ci` must be followed by
the local install command above.

Five focused Scratch Blocks tests pass in both the vertical and horizontal real browser suites: default
off, explicit option parsing, exact delta alignment, no movement when already aligned, and event-state
restoration after a failed move. The legacy pinned suites remain at 204/205 vertical and 150/151
horizontal because their pre-existing `test_parent_tooltip_when_inline` fixture lacks
`procedureReturnsWillChange`; every new alignment test is individually green.

Live take `blockly-stationary-stack-20260824a`, actual bundle `7df79fde211f`, used the minimal reported
fixture `go to x: y: -> change x by 10`. After setting that stack as the base, the lower block was dragged
above the root as one three-event transaction. The old root stayed at the same screen position on the
manual drop. Ctrl+Z settled as `undone`, Ctrl+Shift+Z as `redone`, Rewind as `rewound`, and panel Play as
`played · 1 steps (3 events)`. Undo and Play exposed the red pointer during the genuine drag; all four
paths finished without topology or canonical-state diagnostics. Only that current take remains open.
The integrated GUI gate passes 33 Studio suites / 221 tests, focused Studio ESLint and a production
build against the patched dependency bundles.

### History animation easing — verified 24 August 2026

Ordinary Studio Undo/Redo now chooses its timing curve from the visual role of the block. Added blocks
use an ease-out curve so they slow as they arrive; deleted blocks use an ease-in curve so they accelerate
away; displaced and semantically moved blocks use ease-in-out. The virtual pointer uses the same curve as
the block proxy, preventing pointer drift during a transition. Genuine native Blockly drag paths retain
their existing symmetric quadratic ease-in-out sampling. Durations, interruption/skip behaviour and
semantic replay are unchanged.

The regression gate explicitly checks lifecycle proxy and pointer curves, semantic inverse movement,
and the generated native pointer path. The integrated Studio gate is 33 suites / 222 tests plus focused
Studio ESLint and a production build. Live take `animation-curves-20260824a`, actual bundle
`0ebb9af843a3`, captured the block and pointer during create Undo/Redo, then isolated a top-level move as
one step / one event. Its Undo and Redo showed the genuine pointer drag without a diagnostic, and Rewind
then Play completed as `played · 1 steps (1 events)`.

### Post-Play top-level coordinate stability — verified 24 August 2026

A one-block take exposed a second fractional-scale boundary after the easing verification. Blockly could
show the correct drag preview, then shift the top-level block by a fraction of a workspace pixel during
the mouse-up commit. That fraction crossed the serializer's rounding boundary, so a journal destination
of `x = 501` became project state `x = 502`; a later Undo/Redo could consequently fail its topology gate.

The native driver now repeats nearby pre-drop correction within a small fixed limit. If Blockly's mouse-up
still introduces a sub-one-pixel rounding mismatch, the driver finishes with one ordinary Blockly
`moveBy` event under the existing no-Undo playback scope. That keeps the visible workspace and VM on the
same recorded integer coordinate, adds nothing to the Studio journal or native Undo stacks, and leaves
larger discrepancies to fail closed as before.

Live take `single-block-post-drop-fixed-20260824a`, actual bundle `b02f834661d3`, records one isolated
top-level block move as one step / one event. Rewind and Play completed as `played`; the subsequent
Undo, Redo and second Undo completed as `undone`, `redone` and `undone` with no topology or project-state
diagnostic. Focused regressions cover both partial pre-drop correction and the mouse-up shift. The
integrated gate passes 33 Studio suites / 224 tests, focused Studio ESLint and a production build.

### Compound substack inverse alias stability — verified 24 August 2026

A persisted six-step / thirteen-event take exposed a false topology failure while undoing a real
three-event substack insertion. The semantic inverse correctly detached the dragged substack and restored
the displaced tail, but the final verifier resolved each regenerated block ID *after* rebuilding the
topology. At that point the recorded starting path either pointed at the block now occupying that path or
no longer existed, so correct workspace and VM state was rejected and rolled back.

Move-only semantic replay now returns the recorded-to-live block aliases it resolved before the first
detach. The transaction executor carries those aliases into topology verification, including affected
destination parents, so verification follows the same live blocks across the atomic inverse instead of
reinterpreting stale paths. A realistic regression reconstructs the regenerated root, dragged substack
and displaced tail and proves that path-only post-mutation resolution fails while the pre-mutation aliases
verify both Blockly and VM connections.

The original persisted take `single-block-post-drop-fixed-20260824a` was reopened on actual bundle
`6400109551c5`. Panel Play completed all six steps, the exact previously failing Undo completed as
`undone`, Redo completed as `redone`, and a second Undo completed as `undone`. The remaining five Undos
and all six Redos then traversed the whole recorded stack/copy history without a diagnostic. The integrated
gate passes 33 Studio suites / 226 tests, focused Studio ESLint and a production build.

### Held-key directional topology resolution — verified 24 August 2026

Holding Undo or Redo exposed the complementary side of the compound-substack alias repair. Queued history
steps deliberately skip presentation, so a forward compound insertion can use semantic replay from its
inverse topology. The completed-topology `blockRef` cannot identify the dragged substack or displaced tail
there. The final animated request had a related timing boundary: Blockly made the correct induced tail
connection, but verification tried to resolve that destination parent before the native drop had created
its recorded path.

Directional workspace lookup is now shared by native and semantic playback. Semantic move replay resolves
each affected block from the transaction's current `source` location before detaching anything, then
resolves non-affected destination parents progressively as preceding moves establish their paths. Native
replay retains its pre-drop aliases but re-resolves induced destination parents after mouse-up. Both alias
sets are carried into the final transaction topology gate.

The original persisted take had grown to 17 steps / 24 events. On actual bundle `985d3b6cfbaa`, panel Play
reached the head; a burst of 24 Undo key repeats traversed all 17 steps to the base; 24 Redo repeats returned
to the head; and a second 20-press Undo/Redo stress cycle also completed with an empty diagnostic. Excess
repeats were consumed safely. The integrated gate passes 33 Studio suites / 229 tests, focused Studio
ESLint and a production build.

### Adjacent healed-stack reorder arc — verified 24 August 2026

Moving a custom command down by one position exposed a native presentation fault even though topology
verification succeeded. The drag driver healed the source stack before pickup, but
`forceStartBlockDrag` immediately created Blockly's insertion marker in that old gap. Live geometry
showed the intended destination at workspace `y = 429` immediately after healing, then at `y = 477`
after pickup: exactly one command-block height lower. Measuring after pickup therefore made the block
overshoot by 32.4 screen pixels and snap back on mouse-up.

Measuring only the healed destination was not sufficient. The adjacent move is 48 workspace units, less
than Blockly's 68-unit connecting snap radius, so a straight drag to the correct endpoint never leaves
the old insertion marker and fails verification. The first implementation used a visible rightward arc
to clear that marker. The consolidated implementation keeps the visible block and virtual pointer on the
direct ease-in-out path. At 60% progress it gives the active `InsertionMarkerManager` one invisible,
far-away preview update to release the old source marker; the next genuine `Gesture.handleMove` evaluates
the healed geometry and acquires the adjacent destination. No connection is applied directly and other
native drag kinds retain the same direct path.

The realistic driver regression mutates the target connection after forced pickup, proving that the
pre-marker endpoint is retained, the internal preview releases at the intended frame, the target returns
to healed geometry and every visible pointer coordinate remains on the direct path. On the earlier live take
`single-block-post-drop-fixed-20260824a`, actual bundle `973b7573bf3c`, panel Play completed all 10 steps /
24 events as `played`. Ordinary Undo completed as `undone`; ordinary Redo completed as `redone` in about
105 ms. Frame sampling showed the custom block travel from screen `y = 344.5` to `y = 376.9` through a
53-pixel rightward arc, with only the final approximately one-pixel marker/drop settling difference rather
than the prior one-block snap. The root remained exactly at screen `y = 279.7` throughout. The integrated
gate passes 33 Studio suites / 229 tests, focused Studio ESLint and a production build.

### Branched-history recycled-ID guard — code-verified 24 August 2026

Undo/Redo followed by a new authored block and another Undo exposed an ID-reuse boundary. The failed
transaction recorded block ID `a` as `motion_movesteps` at top-level coordinate `(175, 246)`, while the
restored workspace now used ID `a` for a nested `argument_reporter_string_number`. Native resolution
trusted the matching string, picked up its custom-block parent `c`, observed moves for unrelated blocks
and correctly rolled the project back with `Native interaction did not match the recorded transaction`.

Direct IDs are now accepted only when their live type still matches the recorded block type. Durable
ancestor references likewise reject an ancestor ID whose type has changed, and source/destination parent
resolution prefers the transaction alias or validated structural reference before a raw ID. The exact
failure shape is covered by a regression with recycled `a`, live motion block `h`, the recorded source
coordinate and the expected `a -> h` alias. A companion workspace-reference test covers recycled root
IDs. The integrated gate passes 33 Studio suites / 231 tests, focused source ESLint and a production build.
Live retry of the persisted failed take requires refreshing the existing editor onto the current bundle;
the browser freshness guard correctly leaves the stale tab fail-closed until then.

### Nested displacement-shadow masking — code-verified 24 August 2026

Undoing the point-towards insertion exposed a presentation-only leak while semantic state and topology
remained correct. Frame sampling on bundle `48fe2d528f0b` showed the surviving wait block settle from screen
`y = 409.3` to `y = 376.9`. Its displacement proxy correctly retained a complete copy at the old location,
but the settled live wait block's number shadow remained explicitly `visible` after the exiting lifecycle
proxy had excluded it. Hiding only the live wait root therefore left its `(1)` visible in the new gap before
the complete proxy arrived.

Displacement capture now records and hides every rendered descendant block root contained by the moving
root while its proxy owns the visual. Cleanup restores each exact prior visibility before the enclosing
lifecycle capture restores its own exclusions. The realistic lower-stack regression now includes a nested
number shadow, proves that both the live command and shadow are hidden during lifecycle and displacement
animation, and verifies that both visibility values and all proxies are restored afterwards. The integrated
gate passes 33 Studio suites / 231 tests and focused source ESLint.

### Custom-argument copy transaction repair — code-verified 24 August 2026

Dragging the `cake` argument reporter from a custom-block definition into a `wait (1) seconds` input
exposed a Scratch Blocks grouping boundary which Studio had interpreted as two user actions. The persisted
live journal recorded transaction 11 as an ungrouped create of
`argument_reporter_string_number H;c.C}fM!9hmcOp0:]uB` at `(648, 293)`, then transaction 12 as the grouped
move from that coordinate through `(559, 405)` into the wait's `DURATION` input. One Undo consequently
returned the real copied reporter to its pickup coordinate, directly over the definition's surviving
`cake` argument, and only a second Undo removed it. This was a journal-boundary error rather than an
animation proxy or an invented replay block.

An immediately adjacent ungrouped create now adopts the following non-empty drag group when that group's
first move owns the same block and target. The remaining induced shadow deletion and final input attachment
therefore remain one visible gesture. Recorder startup applies the same conservative coalescing rule to
already-saved split journals, so the persisted take is repaired on reload as well as future captures.

Fast lifecycle presentation now retains the recorded pickup coordinate. If exactly one surviving same-type
workspace block occupies that coordinate, Redo animates the copied reporter smoothly from that source into
the input and Undo follows the same path back before removing it. Palette-created blocks and ambiguous or
missing origins retain the existing short directional slide. The regression models the two-stage move and
checks both motion directions; journal tests cover new capture and persisted-take migration. The integrated
gate passes 33 Studio suites / 234 tests and focused source ESLint.

### Realistic Play flyout-creation gate — verified 24 August 2026

Full tutorial Play can now compile one forward create-plus-move transaction into a genuine Scratch
Blocks flyout gesture. The narrow first gate requires exactly one non-shadow created block, one durable
destination and an unambiguous visible flyout block type. It selects the recorded category, waits for
flyout scrolling to settle, starts the target workspace's normal flyout gesture and crosses Blockly's
pickup threshold before driving the cloned live block along the generated path. Recorded-to-live ID
aliasing then feeds the existing destination, topology, VM, pointer and Undo/Redo-isolation verifiers.

This does not change ordinary Undo/Redo. History mode continues to restore create/delete transactions
semantically and presents them with the fast lifecycle slide; backward full Play also remains semantic
until a real reverse creation interaction is intentionally designed. Unsupported, missing or ambiguous
flyout shapes fail closed before workspace mutation.

The gate now distinguishes one palette command from a copied workspace substack by requiring exactly
one non-shadow command root in the create XML. A copied substack therefore stays on exact semantic Play
instead of being misrepresented as a palette action. Post-drop verification also preserves the live
destination parent resolved before insertion; following its recorded path after insertion could otherwise
resolve to the newly inserted block itself. The flyout pickup is 16 pixels into the block, placing the
pointer close to the statement notch while the connection endpoint remains exact.

Live same-tab verification used take `single-block-post-drop-fixed-20260824a` on bundle
`284110f863c1`. Transaction 1 cloned a real `move (10) steps` flyout block and reported native evidence
`verified`: 38 synchronized pointer/Blockly frames, 19 insertion-marker frames, observed create/end-drag/
move events, matching workspace and VM parentage, and unchanged Studio journal plus native Undo/Redo
stacks. The later copied substack was rejected before native mutation and replayed semantically. The full
take finished `played · 3 steps (6 events)` without a diagnostic, and the sampled drag showed the cursor
inside the command rather than at its left edge. The integrated gate passes 34 Studio suites / 240 tests,
focused source ESLint and the production build.

### Target-resolved, swappable Play pointer — verified 25 August 2026

Realistic Play now retains one pointer controller for the complete panel sequence rather than creating a
new overlay for every transaction. Each native driver supplies a semantic lazy target such as
`flyout:motion_setx` or `workspace-block:<live-id>`. The target resolves its current rendered element and
bounds immediately before travel, so flyout scrolling, viewport preparation and regenerated block IDs do
not leave stale coordinates. Native drag frames continue to drive the pointer and Blockly from the same
clock after pickup. Fast history deliberately disables this UI-to-UI travel and keeps its established
short timing.

Pointer path shape is now a replaceable model behind the controller. `natural` is the default: a bounded
Fitts-law duration and slight endpoint-exact Bezier bend produce readable travel between targets.
`deterministic` uses the fixed generated path for repeatable captures and tests. The query flag
`studio-pointer-model=natural|deterministic` selects either model without changing transaction planning;
an injected future recorded-path model can implement the same `plan({from, to, targetBounds})` contract.
The verifier retains the selected model, live target identity, resolved bounds and travel frames alongside
the synchronized drag evidence.

Live natural-model verification on bundle `29274fbedb92` first used the older three-step take
`gap-timing-verify-20260824a`. Its first two transactions both verified genuine flyout gestures and the
second visibly travelled from the completed workspace drop to `flyout:motion_setx` over 23 curved frames
before pickup. Both native drops retained synchronized pointer/Blockly frames, insertion-marker evidence,
matching workspace/VM topology and unchanged Studio journal plus native Undo/Redo depths. The third
transaction correctly failed closed because that take predates the stationary-stack Blockly patch and
records the replaced whole-stack coordinate semantics; it is retained as an explicit legacy-compatibility
fixture rather than being treated as current interaction evidence.

The current-semantics gate used take `blockly-stationary-stack-20260824a`. Natural mode completed as
`played · 2 steps (5 events)` with the native flyout transaction verified and its mixed semantic step
handled normally. Reopening the same take with `studio-pointer-model=deterministic` also completed and the
native evidence explicitly reported model `deterministic`. The final gate is 36 Studio suites / 248 tests,
focused source ESLint, a clean diff check and the production build.

### Real dropdown selection — verified 25 August 2026

One exact field-change transaction can now compile to realistic `dropdown-field-select` Play. The driver
resolves the current block through the shared durable block-reference resolver, confirms the live field is
a `FieldDropdown` at the recorded source value, and matches the destination by its language-neutral option
value. It moves the sequence pointer to the live field, opens the editor through Scratch Blocks' normal
field gesture, waits for `DropDownDiv`, then moves to the rendered menu item and emits the Closure-compatible
hover/down/up/click sequence at the pointer endpoint. Direct `element.click()` was deliberately rejected by
the live gate because it bypasses Closure's mouse-down/active/mouse-up action path.

Verification requires the expected observed field event, exact workspace and VM values, a menu that was
visible before selection, both pointer stages, and unchanged Studio journal plus native Undo/Redo depths.
The current-semantics take `blockly-stationary-stack-20260824a` on bundle `f9d2fdb56434` visibly opened the
`point towards` menu, travelled from its field to `random direction`, emitted the expected `TOWARDS` change
from `_mouse_` to `_random_`, and finished `played · 2 steps (5 events)` with every isolation gate true.

### Real variable-creation dialogue — verified 25 August 2026

A forward scalar or list `var_create` transaction can now compile to realistic
`variable-create-dialog` Play. The sequence pointer selects the real Variables category, waits for its
registered Create Variable/List flyout button to settle onscreen, clicks it, targets the existing Scratch
prompt and types the recorded name at five animation frames per character. Local/global and cloud choices
use exact language-neutral prompt targets, while the visible labels and native React handlers remain
unchanged. The final OK action invokes the real callback.

The restored base can assign a different runtime sprite ID and Blockly normally generates a fresh variable
ID. Verification therefore resolves the durable target reference by sprite name/stage flag and the OK click
temporarily supplies the recorded variable ID. That wrapper is one-shot: any synchronous flyout placeholder
request delegates to Blockly's original generator, including its static `soup_` character table, and the
original function is restored before the click returns. The flyout is allowed to refresh naturally; forcing
its private refresh created DOM and variable-type races in the pinned build. Later transactions consume the
verified variable alias map just as they consume regenerated block aliases.

Failed or interrupted dialogue playback now invokes the real Cancel control during driver cleanup, so a
checkpoint restore cannot leave a modal blocking the editor. Separately, semantic Rewind applies recorded
`var_delete` events through the silent internal deletion path, preventing Scratch Blocks' user-facing
confirmation from blocking automated playback without changing manual variable deletion.

Live same-tab verification used take `local-variable-ready-20260824c` on bundle `f865561b77f5`. Rewind
completed twice with no JavaScript dialogue. Both Play runs visibly opened the real prompt, moved the red
pointer through its targets, exposed the paced values `c`, `ca`, `cak` and `cake`, selected the sprite-local
scope, and finished `played · 5 steps (9 events)`. There were no ID-generator or variable-type console
errors. The integrated gate passes 39 Studio suites / 260 tests, focused source ESLint and the production
build.

### Real broadcast-message dialogue — verified 25 August 2026

Selecting New Message from a broadcast field produces an ungrouped `broadcast_msg` variable create followed
by the field selection because Scratch Blocks closes the dropdown event group before the prompt callback.
Studio now records the broadcast definition immediately and coalesces those two events as one user action;
older journals with the historical deferred order are normalized on load. Broadcast definitions are kept
out of authored scalar/list state, so they no longer produce `Cannot diff authored data with changed list
definitions`. Ordinary Undo removes the new message and restores the prior selection without displaying a
deletion confirmation; Redo restores both as one fast step.

Forward realistic Play compiles the pair to `broadcast-create-dialog`. The shared pointer opens the recorded
broadcast field through its actual Scratch Blocks gesture, selects the language-neutral
`NEW_BROADCAST_MESSAGE_ID` menu option, travels to GUI-004's prompt input, types at the existing paced text
rate and clicks OK while supplying the recorded broadcast ID. The semantic executor dependency-orders
variable definitions before block XML which references them and deletes definitions only after dependent
blocks, preventing Scratch Blocks from inventing an alias ID during Rewind/Play.

Live verification used take `broadcast-dialog-live-20260825a` on actual bundle `9b9d9567f6f9`. Recording a
real Events-palette broadcast block and creating `party time` produced 2 steps / 5 events. Ctrl+Z restored
`message1` with no prompt or diagnostic, and Ctrl+Shift+Z restored `party time`. Rewind then Play visibly
opened New Message, showed the red pointer across dropdown, input and OK targets, exposed every intermediate
value from `p` through `party time`, and finished `played · 2 steps (5 events)` with native evidence
`verified`. Blockly's variable/field IDs, the VM stage broadcast definition, the VM field name plus ID, and
Studio/native history isolation all matched. The integrated gate passes 44 Studio suites / 286 tests,
focused source ESLint, a clean diff check and the production build.

### Centre-hotspot pointer artwork and click beat — verified 25 August 2026

The Studio pointer is now a compact, stemless north-west-facing black pointer head with a crisp white
outline, a tight two-layer contact shadow and a soft red radial underglow. Its root coordinate is the
centre click target; the artwork rotates around its own centre independently of that target. Velocity-led
roll is capped at 25 degrees. Horizontal travel contributes up to 23 degrees and vertical travel up to 18,
so clear up/down movement leans in its own direction without looking as strong as side-to-side movement.
When travel stops, its remaining momentum seeds a 1.2 second damped harmonic
settle: roughly two clearly visible rocks occupy the first second, followed by a smaller residual wobble
which decays below one degree before neutral. Fast history receives the same short internal travel roll
while retaining its existing block/pointer path and duration.

Target-based Play clicks now share one interruptible clock sequence: a short arrival pause, a 70 ms press
to 82 percent scale, real control activation, a 120 ms overshooting release and a short departure pause.
Variable, broadcast and custom-block dialogues, dropdowns and sprite/costume library controls all consume
that common activation contract. Native Blockly drags show the matching press/release state at mouse-down
and mouse-up but add no waiting frames to synchronized pointer/block geometry.

Real-browser verification replayed `broadcast-dialog-live-20260825a` on final bundle `4059d7208ccb`.
Sampling the complete run observed the 24 px stemless artwork, pressed frames reaching approximately 82
percent scale, centre root transform `translate(-17px, -17px)`, artwork origin `12px 12px`, the 25-degree
lean cap, repeated sign changes while stationary, and computed contact shadows at one and two pixels.
The refreshed vertical-down travel sample built smoothly through 4.63, 11.26, 17.70 and 22.47 degrees
before the diagonal path reached the shared 25-degree cap; focused direction tests cover the equal-and-opposite
upward path and confirm pure vertical roll remains below pure horizontal roll. The real dropdown, New Message
prompt, paced `party time` input and OK click completed as `played · 2 steps (5 events)`. The preceding
live Undo/Redo round trip also completed as `undone` then `redone`. The integrated gate passes 45 Studio
suites / 291 tests, focused source ESLint and the production build.

### Real custom-block definition dialogue — verified 25 August 2026

A forward `procedures_definition` create followed by its grouped top-level move now compiles to realistic
`custom-procedure-dialog` Play. The sequence pointer selects My Blocks, clicks the registered Make a Block
flyout button, then operates the actual Scratch custom-procedure modal. Recorded prototype mutation data is
parsed into ordered literal labels, text/number inputs and Boolean inputs; the driver uses the real Add Input,
Add Boolean and Add Label controls, types every Blockly HTML editor at five frames per character, matches the
recorded warp setting and submits through the real OK action.

Scratch Blocks allocates persistent IDs at two different interaction boundaries. Add Input/Boolean receives
the recorded mutation argument ID on its first generator request. OK first requests an event-group ID, which
delegates to the normal generator, then receives the recorded definition, prototype and argument-reporter IDs
in order. Both wrappers preserve `genUid` static data, delegate all unowned requests and restore the original
function synchronously. Verification requires the observed create and move, all workspace and VM IDs, the
exact prototype mutation, final `(44, 44)` coordinate, dialogue and typed-value evidence, and unchanged Studio
journal plus native Undo/Redo depths. Failure cleanup clicks the real Cancel control.

The real-browser gate reused take `custom-block-uid-order-20260825d` on bundle `8fa2e6f388f9`. Two complete
same-tab Rewind/Play cycles visibly typed `bake` and `height`, created the definition through the actual modal,
and finished `played · 1 steps (2 events)` with native evidence `verified`. The initial live run also caught
and repaired a false readiness assumption: ReactModal did not forward the proposed wrapper ID, so readiness is
now proved by the rendered Studio-targeted OK control and active Blockly editor. The integrated gate passes
41 Studio suites / 265 tests, focused source ESLint and the production build.

### Zoom-independent custom-block placement — verified 25 August 2026

The retained seven-step replay exposed a scale-dependent Scratch Blocks default: at main-workspace scale
`0.972`, submitting the real Make a Block dialogue created the definition at `(31, 31)` instead of the
recorded `(44, 44)`. Its IDs, mutation and VM state were correct, but the native transaction verifier rightly
rejected the differing top-level coordinate.

The procedure driver now settles a newly created top-level definition in workspace coordinates while the
real OK activation is still completing and before the browser's next paint. It measures the live block with
`getRelativeToSurfaceXY()`, applies the exact recorded delta through Blockly's `moveBy()`, then confirms the
result after creation. This is not a scale-specific pixel offset: zoom may change Blockly's provisional
coordinate, but the final native move and workspace position must both reach the recorded coordinate. The
verifier accepts the provisional native move only when a subsequent move and the final workspace state match.

Real-browser verification used bundle `dc241d5aa8a4`. The complete take played successfully at scale `0.972`
and again at `1.1664`, both ending `played · 7 steps (12 events)`. On the second run Scratch Blocks first
reported approximately `(25.72, 25.72)` / native `(26, 26)`; the driver applied `(18.28, 18.28)`, observed a
genuine native move to `(44, 44)`, and both workspace and VM verification passed. The integrated gate passes
46 Studio suites / 297 tests, focused source ESLint, a clean diff check and the production build.

### Minimal safe-frame camera at arbitrary zoom — verified 25 August 2026

Realistic Play now keeps the current viewport unchanged while the next edited stack remains inside a safe
working frame. When a correction is required, the camera also considers the other top-level scripts already
intersecting the outgoing viewport. If that visible-context union fits, the whole shot is composed at 64-pixel
top/left margins instead of leaving technically safe but wasted space there. Distant offscreen scripts cannot
pull the camera away. The active edit retains working room below and the complete descendant script prefers a
64-pixel right margin. When an extreme zoom makes the context or both script sides physically impossible to
show, framing falls back to the active stack/right edge rather than leaving the edit offscreen.

The frame follows real workspace geometry rather than recorded screen pixels. Its horizontal extent unions
the root's complete descendant tree; recreated shadows and reporters resolve through their durable ancestor
and connection path; not-yet-created drag blocks frame from their recorded destination or destination parent.
Recorded authoring viewports remain a compatibility fallback only when no live geometry can be resolved.

Dialog-created custom definitions are deliberately phase-aware. Their future `(44, 44)` destination does not
move the workspace while the pointer selects My Blocks or completes the modal. Only after the real OK action
has created and verified the definition may the camera frame its rendered bounds. Flyout drag creation keeps
the earlier destination preparation because its connection target must be visible before the gesture begins.

The original live failure reproduced at scale `2.902376448` as an invisible broadcast-dropdown pointer target.
On final bundle `712833a6a200`, scale `1.679616` completed `played · 7 steps (12 events)` with both the broadcast
script and custom definition fully visible: the upper script sat approximately one safe margin from the
workspace top and left, leaving the rest of the frame available for the definition below. The canvas remained
fixed throughout the broadcast-to-custom-dialog interval and reframed only when the definition was committed.
The extreme `2.902376448` fallback also completed `played · 7 steps (12 events)` while prioritising the active
edit when both scripts could not fit. Every native dialogue, drag, flyout creation and regenerated inline field
verified. Focused tests cover no movement while safe, fitting visible-context composition, distant-script
exclusion, fallback clamping, deferred custom definitions, created destinations, regenerated block references
and complete descendant width. The integrated gate passes 46 Studio suites / 304 tests, source ESLint, a clean
diff check and the production build.

### Long-script camera composition at 290% — verified 25 August 2026

An opt-in `studio-camera-fixture=long-script` stress take now records 19 normal Scratch Blocks Undo groups:
a two-block script, a fourteen-block vertical script below it, and a three-block script well to the right.
The fixture includes the same standard input shadows as palette-created blocks, so canonical head validation
tests the replay rather than a programmatic-fixture shortcut. The control and `Seed Camera` button exist only
under that query flag.

The first live run at Blockly scale `2.902376448` found two genuine high-zoom defects. Pre-create framing only
measured the existing destination stack, leaving no safe room for the incoming block. The camera now unions a
flyout prototype's rendered footprint below a statement destination before starting the drag. Separately, a
flyout canvas remained at scale `0.675` while the workspace was at `2.902376448`; connection deltas could not
be mixed between those coordinate systems. Connected flyout endpoints now map the source and target through
their own SVG screen transforms. Their drag follows a smooth side-approach Bézier around the visible root,
preventing Blockly's insertion marker from latching onto an earlier connection while travelling down a long
stack.

Final real-browser take `viewport-long-script-20260825e` on bundle `47c0f1773cd6` completed
`played · 19 steps (38 events)`. Every native interaction verified and the canonical final project matched.
The camera preserved the useful left composition while the long stack fit, advanced downward in bounded
steps as its tail reached the lower safe margin, then made one composed upward/right transition to the third
script. The final script occupied the available frame near the preferred top and left working margins. The
integrated gate passes 47 Studio suites / 308 tests, source ESLint, a clean diff check and the production build.

### Long-script camera composition at 290% — verified 25 August 2026

An opt-in `studio-camera-fixture=long-script` stress take now records 19 normal Scratch Blocks Undo groups:
a two-block script, a fourteen-block vertical script below it, and a three-block script well to the right.
The fixture includes the same standard input shadows as palette-created blocks, so canonical head validation
tests the replay rather than a programmatic-fixture shortcut. The control and `Seed Camera` button exist only
under that query flag.

The first live run at Blockly scale `2.902376448` found two genuine high-zoom defects. Pre-create framing only
measured the existing destination stack, leaving no safe room for the incoming block. The camera now unions a
flyout prototype's rendered footprint below a statement destination before starting the drag. Separately, a
flyout canvas remained at scale `0.675` while the workspace was at `2.902376448`; connection deltas could not
be mixed between those coordinate systems. Connected flyout endpoints now map the source and target through
their own SVG screen transforms. Their drag follows a smooth side-approach Bézier around the visible root,
preventing Blockly's insertion marker from latching onto an earlier connection while travelling down a long
stack.

Final real-browser take `viewport-long-script-20260825e` on bundle `47c0f1773cd6` completed
`played · 19 steps (38 events)`. Every native interaction verified and the canonical final project matched.
The camera preserved the useful left composition while the long stack fit, advanced downward in bounded
steps as its tail reached the lower safe margin, then made one composed upward/right transition to the third
script. The final script occupied the available frame near the preferred top and left working margins. The
integrated gate passes 47 Studio suites / 308 tests, source ESLint, a clean diff check and the production build.

### Real inline field editing and retained UI state — verified 25 August 2026

Realistic Play now compiles a recorded Blockly field change as a generic `block-field-edit`. The live field
type chooses the presentation: `FieldDropdown` retains the real menu route, while `FieldTextInput` opens the
real `blocklyHtmlInput`, types each visible prefix at the shared five-frame pace and commits with Enter.
Every intermediate input event remains visible to Blockly and the VM but is constructed with native Undo
recording disabled, so tutorial playback cannot grow Blockly's Undo/Redo stacks.

Dialog drivers now retain confirmed UI state. They do not click a toolbox category which is already selected,
do not move or click back into an input which the real dialog has already focused, and do not re-click an
already-selected variable scope, cloud option or procedure warp option. Pointer coordinates alone never
justify a skip; the decision comes from the toolbox selection, active element or control state.

The retained seven-step user journal replayed on final bundle `d4b1849a69fb` as
`played · 7 steps (12 events)`. Its `TEXT: "" → "smoke"` and following inline text transaction both reported
verified workspace and VM values with journal and native Undo/Redo isolation unchanged. Live pointer evidence
showed broadcast creation stages `dropdown → ok` and custom procedure stages
`category → button → part buttons → warp → ok`: the automatically focused broadcast/custom inputs produced no
redundant pointer stages, while the My Blocks category click remained because another category was selected.
The integrated gate passes 46 Studio suites / 294 tests, focused source ESLint, a clean production build and
the exact real-browser failure fixture.

### Tip-adjacent fixed hotspot and restrained arrival overshoot — verified 25 August 2026

The pointer root remains the authoritative, rotation-independent screen coordinate used by every click and
native drag. The 24 px artwork is offset ten pixels right and down inside that root instead of five, placing
the neutral arrow tip approximately 3–4 screen pixels from the fixed hotspot. Roll and damped settle still
transform only the artwork; they never move or recalculate the semantic click coordinate. The 36 px red
underglow is offset four pixels right and down, giving it the same internal centre as the arrow artwork rather
than the hotspot.

The swappable `natural` pointer model now adds a small endpoint-exact arrival spring. Its forward overshoot is
the smallest of six pixels, four percent of travel distance and 18 percent of the target's narrow dimension.
The fast approach ends at that overshoot, then a separate six-frame smooth-step recoil decelerates onto the
exact resolved target. The `deterministic` model remains linear and overshoot-free.

Real-browser verification replayed the retained seven-step journal on bundle `f412b55f940a` as
`played · 7 steps (12 events)`. Fourteen real click arrivals covered Blockly categories and fields, dropdowns,
the broadcast prompt and custom-procedure controls. Long target-based moves measured a six-pixel overshoot
followed by six progressively smaller return positions and an exact final click; shorter moves scaled down to
the target and travel size. Across 835 live samples the arrow and glow centres differed by less than 0.001 px,
while the root transform remained `translate(-17px, -17px)`, artwork offsets remained `10px 10px`, glow offsets
remained `4px 4px` and the artwork origin remained `12px 12px`, including while it rolled. The integrated gate passes
46 Studio suites / 296 tests, focused source ESLint, a clean production build and the exact real-browser
failure fixture.

Typing now hides the complete pointer overlay immediately after a real input receives focus. The next pointer
travel, direct movement, press or click restores it automatically, so modal options and confirmation actions
still begin with a visible cursor while characters remain unobscured. Follow-up real-browser verification on
bundle `68c2cd07a0d9` observed seven distinct hidden intervals across the broadcast prompt, custom-procedure
labels and arguments, and inline Blockly fields. Every sampled typing frame had pointer opacity zero, later
travel restored opacity one, and the replay completed as `played · 7 steps (12 events)`. The integrated gate
passes 46 Studio suites / 297 tests.

The pointer overlay sits at z-index 100,001, immediately above Blockly's 99,999 HTML field editor and
100,000 tooltip layers. It remains `pointer-events: none`, so the higher presentation layer cannot intercept
the real interaction. Follow-up real-browser verification on bundle `4a8fcd24a86e` observed 220 frames where
an input and the still-visible pre-typing pointer coexisted: the pointer remained at 100,001 above Blockly's
99,999 widget and Scratch's 510 modal before hiding normally for 240 sampled typing frames. The replay again
completed as `played · 7 steps (12 events)`.

### Real built-in sprite and costume libraries — verified 25 August 2026

Forward project operations now retain durable library metadata and can compile to `sprite-library-select`
or `costume-library-select` realistic Play. The driver moves the shared pointer through the real sprite
selector, Costumes tab, library buttons and exact asset cards using language-neutral targets. Costume Play
can first select the recorded sprite card, so travel between sprites is part of the same target-resolved
pointer sequence rather than a cached coordinate shortcut. The item click invokes the existing React/VM
path; Studio observes and awaits the actual `addSprite` or `addCostumeFromLibrary` promise before validating.
Ordinary Undo/Redo and Rewind continue to use the fast exact checkpoint path.

The first live run exposed two issues that unit-only testing had not proved: asynchronous costume work could
outlive the checkpoint restore, and Scratch omits a fresh costume's redundant `md5ext` before save but
reconstructs it after load. The driver now awaits the real VM completion. New `structural-v3` takes exclude
that redundant field while retaining `assetId` and `dataFormat`; v1/v2 projection behavior remains explicit
for older takes.

Live verification used take `project-library-v3-20260825a` on bundle `e07758edcc18`. Recording created the
built-in Apple sprite and added `Arrow1-a` through the real costume library. Rewind completed with no modal.
Two complete Play cycles visibly traversed both libraries, verified the created sprite and costume, preserved
journal/native isolation, and finished `played · 2 steps (2 events)` with exact matching structural hashes
and no diagnostic. The integrated gate passes 43 Studio suites / 277 tests, focused source ESLint, a clean
diff check and the production build.

### Stoppable Play, single-pass camera framing and canonical Rewind — verified 25 August 2026

Escape now stops an active realistic Play synchronously, cancels its current interaction clock and rolls
the incomplete transaction back without advancing the Studio cursor. A later Play resumes from that cursor
with its recorded-to-live aliases retained. Additional Play from the recorded head first performs a guarded
Rewind and refuses to continue unless the canonical base and cursor zero are both confirmed.

Native block drags now own one destination-framing request immediately before pointer travel. The session
does not first pan to the recorded authoring viewport and then pan back to the predicted destination. At
290% zoom this removed the visible left/right/left correction: the long stack advanced monotonically down,
then made one intentional move to the separate right-hand script. Flyout motion is predominantly diagonal
with a bounded S bend, connection snapping is enabled only for the final approach, and the 16-by-18-pixel
pickup keeps the cursor near the statement connection instead of releasing visibly to its right.

Cursor zero is also a hard visual boundary. Rewind and final Undo always restore the canonical base
checkpoint even when the VM project hash already matches; this prevents native Blockly SVG state from being
accepted as an empty base merely because the semantic hash is equivalent. Live build `6e4677dfaf4d` played
all 21 steps / 44 events of take `viewport-long-script-20260825e` at scale `2.902376448`, rewound to zero
main-workspace blocks, stopped via Escape after five seconds, resumed and completed as `played`.

### Decisive camera heuristics and full-viewport parking room — verified 25 August 2026

Studio Play now treats camera movement as composition rather than edge chasing. A fitting active script can
retain other scripts which are already useful visible context. Once the active script itself is too tall or
wide, surrounding scripts stop influencing the shot: the active stack owns the horizontal frame and the
current edit owns the vertical frame. Oversized vertical stacks place the active edit above the midpoint,
reserving 48 percent of the visible height for subsequent coding, and retain that shot until the edit crosses
the safe band. Decisive horizontal shots use 32 pixels of padding, balance the remaining space when a stack
nearly fills the viewport, and align a truly over-wide stack directly to the left edge. Vertical composition
retains the larger 64-pixel working margin.

The Studio session also installs a reversible expanded-metrics adapter matching the local Scratch Addons
`expandWorkspace` policy: another half-viewport is added on each side of Scratch Blocks' normal bounded
content region, including the toolbox-width allowance. The resulting full viewport of parking space outside
the blocks lets the camera select the composed shot without scrollbar clamping when connection geometry
changes. The adapter is removed when the Studio session detaches and never changes saved script coordinates.
Automatic stack arrangement remains deliberately separate; adopting its authoring behaviour would require an
explicit opt-in design rather than being a side effect of tutorial playback.

The retained `viewport-long-script-20260825e` journal had grown to 21 steps / 44 events. Live tracing proved
that its two final pans occurred only after all 19 fixture block creations had completed: they were two extra
recorded transactions in the old journal, not camera corrections. A fresh take
`viewport-camera-heuristic-clean-20260825a` recorded the canonical 19 steps / 38 events and was the acceptance
fixture. At scale `1.39968`, the long stack made one horizontal shot, later vertical-only correction, one
transition to the separate right-hand script, and no end pan. At scale `2.902376448`, it made three sizeable
vertical advances while retaining exactly one horizontal position, then one diagonal transition to the right
script. Final build `7a92a12f39a4` held canvas x `-1747.71104256` through both remaining drops and completion;
the finished script occupied approximately 32 pixels of left padding and 29 pixels of right padding. Both
runs completed `played · 19 steps (38 events)` with native verification and exact project-head validation.

## Prioritized continuation backlog

Priority follows the dependency chain: preserve exact project state first, prove the missing teaching
interactions next, then improve playback responsiveness and presentation.

1. **P0 — keep the verified history core robust.** Retain checkpoint rollback, cross-sprite target
   preparation, File → New reset semantics, topology checks, Play parity and clean restart coverage as
   gates for every later slice. Keep the actual-bundle freshness fail-closed guard enabled so an obsolete
   tab cannot mutate or replay a take.
2. **P0 integration — publish and pin the Scratch Blocks patch.** The isolated dependency commit and
   reproducible local installer are complete. Before CI or distribution, publish that branch to the
   chosen fork, replace the GUI Git dependency with its immutable commit and run a clean-install gate.
3. **Complete — fast lifecycle animation for history.** The short visual-proxy slide/fade now covers
   block create/delete Undo/Redo while semantic replay owns state and the topology gate. Keep the live
   create-plus-drop, regenerated-ID and Play-isolation checks as regression gates.
4. **Complete — realistic Play flyout creation.** The narrow code path selects and scrolls the category,
   clones one unambiguous command through the real flyout gesture, aliases its live ID and passes the
   pinned native event, VM, pointer, final-state and Undo/Redo-isolation gates. Copied substacks remain
   semantic until a separate workspace-copy presentation is designed.
5. **Complete — target-resolved, swappable Play pointer.** Realistic Play retains one pointer across its
   sequence, resolves each live UI target just before travel and selects `natural` or `deterministic`
   motion through `studio-pointer-model`. Keep the older pre-stationary-stack take as an explicit legacy
   compatibility fixture, not a current-semantics gate.
6. **Complete — realistic Play reporter and Boolean placement.** Native Play now drags round and
   hexagonal reporters through their genuine flyout and connection paths, retains destination-parent
   aliases across regenerated IDs, and validates the final semantic graph independently of transient
   Blockly IDs. Keep the post-Play inverse-shadow and two-cycle browser fixture as regression gates.
7. **Complete — realistic dropdown, variable, custom-block and inline field playback.** Real dropdown
   selection, paced variable/list creation, custom-block definition and ordinary Blockly text editing through
   the existing UI are live-verified. Retain confirmed focus/category/control state to avoid performative
   clicks, and keep these realistic interactions out of fast history.
8. **Complete — built-in sprite and costume library playback.** Forward realistic Play uses the existing
   GUI and target-resolved pointer; fast history retains exact checkpoints. Keep two-cycle real-browser
   Apple plus Arrow1-a coverage as the acceptance fixture.
9. **Complete — responsive queued history commands.** Additional Undo/Redo requests now snap the active
   presentation, traverse intervening commands without animation and animate the terminal request. Keep
   the rapid mixed-direction, checkpoint rollback and single-mutation queue tests as regression gates.
10. **P2 — richer presentation authoring, in progress.** Per-transaction pause timing is now editable,
   persisted and speed-scaled in both timeline directions and realistic Play. Captured pointer paths and
   richer interaction-specific pacing remain later presentation work; renderer-settlement barriers must
   remain separate from authored pauses.

The older “Suggested implementation order” below remains the detailed engineering breakdown; this
backlog is the current product-priority view.

## Safe starting point

The File/New and list-history slice is complete on branch `studio/spike-1` at
`d068835ab66ddfc1d73b4db674919b8a81278ae7` (`Record list history and guard project loads`). The worktree was clean after that commit.

That baseline has:

- 103 passing Studio tests;
- passing focused Studio lint and production build;
- live list create/edit/delete Undo/Redo coverage; and
- a hard, non-destructive boundary for File → New and other external project loads.

The exact dependency baseline is recorded in `UPSTREAM_BASE.json`. The installed TurboWarp Scratch Blocks
baseline remains `4113c5348e6b4c76da9071a1800a62ab96ef793f`; the Studio-only sibling patch is commit `ab643a92`
directly on top of it. Do not update unrelated dependencies as part of this spike.

## Goal

Prove that a Studio transaction can be presented by Blockly's real interaction machinery while the recorded semantic transaction remains authoritative. The browser should visibly show genuine:

- flyout block creation;
- block dragging, insertion markers and connection reactions;
- command-stack insertion and rearrangement;
- round reporter and Boolean input placement;
- dropdown opening and selection; and
- inline text editing with the real `blocklyHtmlInput` visible as characters appear.

An overlaid Studio pointer follows the same path supplied to Blockly. The operating-system cursor may be hidden over the editor during playback, but the overlay must have `pointer-events: none` and must never become the source of editor state.

The spike must not turn into coordinate-only browser automation. Coordinates describe presentation and motion; block references, fields and connections describe intent.

## Non-goals

- Do not replace the semantic journal with mouse recordings.
- Do not patch generated files or `node_modules`.
- Do not fork Scratch Blocks until an adapter against the pinned build has been tried and measured.
- Do not silently fall back after a native interaction has begun mutating the project.
- Do not attempt animated native paint, sound, arbitrary uploads or unsupported sprite lifecycle actions
  in this spike. Built-in sprite creation and costume-library addition are supported forward Play cases;
  other asset/project operations remain exact checkpoint-backed history transactions.
- Do not make backward playback look like a reversed video. If an inverse native interaction is unsupported, decide that before mutation and use the existing semantic executor.

## Current architecture to preserve

`studio-block-session.js` owns the persisted journal, history cursor and busy/failure state. Its Undo,
Redo and Play paths pause `block-workspace-port.js` capture, prepare the target and viewport, select
native or semantic execution before mutation, and increment the cursor only after the selected executor
resolves and verification passes.

`replay-engine.js` owns event and data-delta ordering but knows nothing about Scratch Blocks. `scratch-blocks-replay-port.js` is the current semantic executor: it reconstructs an event, runs it with Blockly events disabled, then mirrors the event to `vm.blockListener`. This remains the exact, fast executor and fallback for transaction kinds the native driver rejects before mutation.

The visible workspace's listener order is important:

1. TurboWarp attaches `vm.blockListener`.
2. Studio attaches its capture listener beside it.
3. The flyout workspace separately owns `vm.flyoutBlockListener` and `vm.monitorBlockListener`.

A native interaction should therefore allow normal Blockly events to reach the existing VM listener. Studio capture is paused, so those same events must not be appended to the journal. A short-lived verification observer may inspect them without becoming another recorder.

`studio-history-command-port.js` owns only user Ctrl/Cmd+Z, Redo and workspace-menu commands. It deliberately does not replace `workspace.undo()`, because Scratch Blocks uses that internally for invalid drags and procedure checks. Preserve that boundary.

The current structural hash validates canonical base and head states. It is not sufficient for cursor advancement in the middle of a native playback run; this spike needs a transaction-level verification contract.

## Important change in execution granularity

The native driver must consume a complete Studio transaction, not one event at a time. A normal flyout drag is commonly recorded as a grouped create plus move. Executing those as two separate native gestures would reproduce the temporary placement the transaction model intentionally hides.

Add a transaction planner which converts one semantic transaction and direction into either:

- one supported native interaction plan;
- a semantic-only plan selected before any mutation; or
- an explicit unsupported result.

Examples:

| Semantic transaction | Native plan |
|---|---|
| grouped create + move | select flyout entry, clone through the flyout, drag and drop once |
| move to parent/input | drag the existing block to the resolved connection |
| top-level move | drag the block/stack to the recorded workspace coordinate |
| field change on dropdown | open the real dropdown and activate the option by semantic value |
| coalesced text field change | open the real editor, type the final text visibly, then commit |
| unsupported mixed transaction | reject before mutation or use exact semantic replay |

## Proposed contained modules

Keep the implementation under `src/studio/bridge/native-interaction/` until evidence requires a registered upstream seam.

```text
native-interaction/
  interaction-playback-port.js      orchestration and capability contract
  interaction-plan.js               pure transaction-to-plan compiler
  scratch-blocks-drag-driver.js      Gesture/BlockDragger adapter
  scratch-blocks-field-driver.js     dropdown and text-editor adapter
  scratch-blocks-flyout-port.js      category and flyout-block resolution
  playback-event-scope.js            capture/Undo isolation and observation
  interaction-verifier.js            normalized event and affected-state checks
  pointer-overlay.js                 presentation-only pointer
  interaction-clock.js               one requestAnimationFrame clock
```

Prefer small injected ports so the planner, clock, verifier and pointer path can be unit-tested without a browser. Do not duplicate field coalescing, block-reference resolution, viewport motion or event normalization: extract a pure shared helper from the existing module if both capture and verification need it.

A suitable orchestration contract is:

```js
const result = await interactionPlayback.play({
    transaction,
    direction,
    expectedProjection,
    signal
});

// result.status: 'verified' | 'unsupported' | 'mismatch' | 'cancelled'
// Cursor movement is allowed only for 'verified'.
```

The port should own planning, selection of the correct target, input locking, native drive, settling and verification. The session remains the only owner of `history.cursor`.

## Blockly seams in the pinned build

These are adapter seams, not permissions to call private methods throughout Studio.

| Behaviour | Current seam | Stability | Notes |
|---|---|---|---|
| acquire a gesture | `WorkspaceSvg.getGesture(event)` | package API | Refuses a second active gesture; wait for an idle workspace rather than cancelling user input. |
| force an existing block drag | `Gesture.forceStartBlockDrag(fakeEvent, block)` | package API | Calls the genuine `BlockDragger`; event-shaped objects need correct `clientX`, `clientY`, type and mouse-button properties. |
| animate and finish drag | `Gesture.handleMove(event)`, `Gesture.handleUp(event)` | package API | Feed both from the same animation clock as the overlay pointer. |
| connection previews | `BlockDragger` → `InsertionMarkerManager.update/applyConnections` | internal, reached indirectly | Never call the marker manager directly. Its real preview and connection code is the feature being tested. |
| create from flyout | `Flyout.blockMouseDown_`, `Flyout.createBlock`, `Flyout.placeNewBlock_` | mixed package/private | Prefer the normal flyout mousedown/gesture route. Contain any direct fallback in `scratch-blocks-flyout-port.js`. |
| select toolbox category | `Toolbox.selectCategoryById` / `setSelectedCategoryById` | package API | Category IDs may change with extensions/localisation; recorded metadata should include a semantic fallback. |
| open a text field | field click → `FieldTextInput.showEditor_` → `WidgetDiv` | private, reached through normal field click | Drive the real `blocklyHtmlInput`; do not call `field.setValue` for presentation playback. |
| open/select dropdown | field click → `FieldDropdown.showEditor_` → `DropDownDiv`; menu action → `onItemSelected` | private, reached through normal field click | Match the option's language-neutral value, not displayed/localised text. |
| event delivery | `Events.fire` → queued `fireNow_` → `workspace.fireChangeListener` | mixed public/private | Do not call `Events.disable()` across native playback; the VM must receive the real events. |
| native Undo admission | `Events.recordUndo` copied by `Events.Abstract` | global package state | Set false only around synchronous driver calls that construct events, restore in `finally`, and block concurrent author input. |

The particularly useful seam is `Gesture.forceStartBlockDrag`: it creates the real `BlockDragger`, whose constructor creates the real `InsertionMarkerManager`. `dragBlock` updates previews on every move and `endBlockDrag` applies the chosen connection. This is materially stronger and less brittle than dispatching untrusted DOM `MouseEvent`s at SVG nodes.

Flyout dragging needs separate proof. The normal flyout mousedown obtains the target workspace's gesture and marks the flyout as the source; cloning then occurs through the flyout's own `createBlock/placeNewBlock_` path before the same native dragger takes over.

## Coordinate and pointer policy

Capture or author an optional interaction presentation record beside the semantic transaction. At minimum a block drag needs:

- source kind: flyout or current workspace;
- durable source block reference or flyout block signature;
- pointer-to-block-top-left grab offset;
- timecoded path points in workspace or editor coordinates; and
- semantic destination: parent block reference, input name/connection role, or top-level coordinate.

The semantic destination chooses the connection. The driver resolves current connection coordinates after target selection, viewport movement, zoom and rendering. It then derives a final block translation which puts compatible Blockly connections inside the actual snap radius. The pointer position is that translated top-left plus the recorded grab offset.

This explicitly avoids the earlier error of treating the mouse cursor as the block's top-left corner. The overlay pointer must show the real grab point while Blockly receives the same pointer delta.

For an older take with no path, the planner may generate a clear eased path with a short approach and a one- or two-frame connection hold. Generated presentation data must remain separate from the recorded semantic transaction and must be replaceable later.

## Capture, native Undo and concurrency isolation

The native machinery must emit normal Blockly events so `vm.blockListener` updates the VM. Isolation is therefore selective:

1. Flush pending authored capture and enter the existing `recordingPaused` scope.
2. Confirm there is no user gesture or active field editor. Lock editor pointer/keyboard input for the short playback operation.
3. Attach a temporary read-only event observer for verification.
4. Before each synchronous native driver call that may construct an event, save `ScratchBlocks.Events.recordUndo`, set it to `false`, call the native method, and restore the original value in `finally`.
5. Do not disable Blockly events. Do not remove `vm.blockListener`. Do not call `workspace.clearUndo()`.
6. Let the queued events reach the VM and verification observer. Await a defined settle condition.
7. Verify the semantic transaction and affected state.
8. Detach the observer, release the editor lock and resume Studio capture only after the event queue is quiet.

The global Undo flag is copied into each event when its constructor runs. It does not prevent event delivery; `workspace.fireChangeListener` merely skips adding an event whose `recordUndo` is false to `undoStack_` and avoids clearing `redoStack_`. Holding the global flag false for an entire animated drag would be unsafe, so scope it around gesture start/move/up calls and prevent concurrent author input.

Tests may inspect private `undoStack_` and `redoStack_` lengths as a pinned-build contract. Production code must not rewrite or snapshot those arrays.

Use a unique replay observation token outside Blockly's user-facing group identity. Blockly's actual group should remain free to model the gesture normally; verification can collect events by listener lifetime plus workspace/target identity. Never use group IDs as durable transaction IDs.

## Settling and semantic verification

`Events.fire` queues a zero-delay `fireNow_`; field editors and Scratch GUI target changes add further deferred work. Returning from `handleUp` is not proof that Blockly, the VM and rendered UI agree.

The first implementation should define `settle()` as:

- wait until the expected event shape has been observed;
- wait one quiet macrotask with no further relevant event;
- wait at least one animation frame for rendered geometry; and
- verify the workspace and VM affected scope agree.

Do not poll indefinitely. Use a bounded timeout which reports the plan, observed normalized events and first affected-state difference.

Verification has two complementary parts:

1. **Observed semantic events.** Normalize the temporary Blockly event batch into Studio snapshots. Coalesce text keystrokes and internal move noise with the same pure rules used by capture. Ignore transient group IDs and map live block IDs to recorded durable references.
2. **Affected-state projection.** Compare the block/stack topology, fields, shadow state and relevant VM block records touched by the transaction against an expected post-transaction projection.

Do not store a full project copy per cursor. Add an optional per-transaction affected-scope projection/hash, or compute it once while recording from the touched root(s), parent input(s), definitions and authored data. Full canonical base/head hashes remain the outer safety net.

Flyout creation may allocate live IDs which differ from the recorded create event. Maintain a playback-local recorded-to-live ID map, populated by matching the created XML topology and durable block reference. Use that map for later transactions and for verification; do not guess when duplicate candidates are indistinguishable.

Only a verified result may resolve the executor promise. `studio-block-session.js` can then perform its existing cursor consistency check and increment `history.cursor`. On mismatch:

- leave the cursor unchanged;
- restore the short-lived pre-transaction safety checkpoint;
- resume Studio capture with the same history command still available;
- publish an actionable mismatch and retain the observed evidence; and
- mark playback unknown only if exact safety restoration itself fails.

Never run the semantic executor on top of a partially applied native interaction.

## Field playback details

Dropdown playback should resolve the field by durable block reference plus field name, open it through the normal click/editor route, wait until `DropDownDiv` is visible, locate the option by its language-neutral value, visibly move/click the overlay pointer, and let the real menu action invoke the validator and `setValue`.

Text playback should open the normal `WidgetDiv`, confirm a visible `.blocklyHtmlInput`, then update that input as characters are typed and dispatch the native input/key events its existing handlers consume. Commit with the recorded gesture (Enter or blur) where available. The durable journal should still contain one coalesced semantic field change, not one transaction per character.

Composition/IME, paste, variable/procedure name dialogs and invalid validator responses are explicit later cases. The first spike should use ordinary Latin text and number fields.

## Suggested implementation order

1. **Harness and isolation.** Add the transaction-level port, fake clock, event observer, Undo suppression scope, editor lock and cursor-gating tests. Prove zero Studio-journal growth and unchanged native Undo/Redo depths.
2. **Existing workspace drag.** Rearrange a command stack through `Gesture.forceStartBlockDrag`; prove the genuine marker is visible before drop and the VM follows Blockly.
3. **Nested inputs.** Place a reporter in a round input and a Boolean in a hexagonal input using resolved connection geometry.
4. **Flyout creation.** Select a category, identify one unambiguous flyout block, create it through the real flyout path and drop it into a stack/input.
5. **Fields.** Open/select a dropdown, then visibly type and commit one text/number field edit.
6. **Transaction verification.** Add affected-scope hashes, ID aliasing, bounded settle diagnostics and mismatch recovery. Wire the port into Play/Redo only after all prior isolation tests pass.
7. **Direction policy.** Add native inverse plans individually. Unsupported Undo transactions must choose semantic execution before mutation.

Keep every phase independently removable. If a private seam is unavoidable, expose it through one adapter, add it to `UPSTREAM-SEAMS.md`, and give it a focused contract test before using it elsewhere.

## Test plan

### Pure/unit tests

- transaction planner collapses grouped create + move into one flyout drag;
- planner distinguishes command, reporter and Boolean connections;
- coordinate conversion preserves grab offset at zoom levels 0.5, 1 and 2;
- live/recorded block ID aliasing maps a created subtree and rejects ambiguity;
- event normalization coalesces visible typing to one expected field change;
- Undo suppression restores the previous global flag after success, throw and cancellation;
- unsupported plans are rejected before mutation;
- mismatch restores the exact pre-command state, leaves the cursor unchanged and resumes capture;
- successful verification advances exactly one transaction;
- detach/cancel removes overlay, observer, input lock and scheduled frames.

### Pinned Scratch Blocks contract tests

- forced gesture constructs a real `BlockDragger` and uses `InsertionMarkerManager`;
- flyout gesture clones through the real flyout and emits create/move events;
- native events reach a VM-listener spy while `recordUndo` is false;
- workspace Undo/Redo stacks and the persisted Studio journal are unchanged;
- real `DropDownDiv` and `blocklyHtmlInput` become visible;
- observer settling includes queued events generated after mouseup/field commit.

### Real-browser fixtures

Use a fixed base with at least two sprites and these independent transactions:

1. drag `say [Hello!]` from the flyout to an empty workspace;
2. attach a command block below an existing stack;
3. insert a command block into the middle of a stack;
4. rearrange an existing stack segment;
5. place an oval reporter into a round input, replacing its shadow;
6. place a Boolean reporter into a hexagonal input;
7. expand a dropdown and choose a non-current option;
8. open a text/number field, visibly type several characters, then commit;
9. change sprite and replay one supported native interaction after the existing first-press navigation preparation; and
10. force a deliberate mismatch and prove the next cursor is not entered.

Run each drag fixture repeatedly at more than one workspace scale. Keep screenshots or instrumented frame evidence for marker/menu/input visibility; a final project hash alone cannot prove interaction presentation.

## Acceptance criteria

The spike is acceptable only when all of the following are demonstrated in the real editor:

- The Studio overlay pointer and Blockly drag use the same frame-by-frame coordinates and recorded grab offset.
- At least one command-stack insertion displays Blockly's genuine insertion marker for a rendered frame before drop.
- Reporter and Boolean fixtures connect to the recorded parent/input, not merely overlap visually; moving the parent moves the nested child.
- A flyout block is cloned by the real flyout path and then dragged, rather than materialized by replaying a create event.
- A dropdown is visibly open before the real option action changes the field.
- `.blocklyHtmlInput` is visibly open and shows intermediate characters before a single committed semantic change.
- Normal Blockly events update both the visible workspace and VM.
- The observed normalized transaction and affected-scope projection match the recorded semantic transaction before the Studio cursor advances.
- A mismatch leaves the cursor unchanged, restores the pre-command state, stops further playback and
  produces useful evidence.
- The persisted Studio event/step counts do not grow during playback.
- Native `undoStack_` and `redoStack_` contents/depths are unchanged by playback.
- Studio capture remains paused until all generated events have settled, including deferred field/flyout work.
- Cancelling or detaching leaves no gesture, event observer, pointer overlay, input shield, timer or altered global event flag behind.
- With `?studio-session=1` absent, normal TurboWarp behaviour and bundle integration remain unchanged.
- Studio tests, focused lint and production build pass; new browser evidence covers each accepted interaction kind.

## Risks and containment

| Risk | Containment |
|---|---|
| Scratch Blocks private APIs change | One adapter directory, pinned-build contract tests and seam register; no calls from journal/replay core. |
| Synthetic DOM events are untrusted or browser-dependent | Prefer direct package gesture methods with event-shaped coordinates; use DOM events only where the real HTML input/menu consumes them. |
| Incorrect grab offset misses nested inputs | Resolve semantic connections and calculate block translation first; derive pointer from top-left plus recorded offset. |
| Pointer overlay drifts from Blockly | One animation clock and one coordinate conversion feed both. |
| Playback pollutes native Undo | Scoped `Events.recordUndo = false`, input lock, stack-depth assertions; never clear or rewrite stacks. |
| Playback records itself | Existing capture pause plus journal-count assertions and a separate temporary observer. |
| VM lags behind rendered Blockly | Keep `vm.blockListener`, use bounded settling, compare both representations. |
| Flyout IDs/categories differ after upgrade | Match semantic type/XML signature, store optional category metadata and maintain ID aliases; reject ambiguity. |
| Extra native events differ from the compact journal | Normalize at transaction level and verify affected final topology as well as event intent. |
| Partial mutation fails verification | Cursor gate, no silent fallback, restore the last verified boundary before retry. |
| User input races global event state | Playback mutex and editor input shield; restore globals in `finally` around every synchronous call. |
| Camera movement changes geometry mid-drag | Complete target/viewport preparation before resolving connection coordinates; freeze automatic camera policy during the gesture. |

## Launch and verification commands

From `D:\dev\twstudio\scratch-gui`:

```powershell
npm start
```

After `npm ci`, or whenever the installed Scratch Blocks package has been replaced, first install the
committed local fork bundles and then start a fresh webpack process:

```powershell
npm run studio:use-local-blocks
npm start
```

Open a fresh, explicitly named take:

```text
http://127.0.0.1:8601/editor.html?studio-session=1&studio-take=native-interaction-<unique-id>
```

Use a new take ID for each destructive fixture. Do not reuse the list-history verification take.
Keep only the active take being discussed open in the browser. Close obsolete verification, failed and
blank tabs as soon as a replacement take is handed off; multiple similarly named editor tabs are too
easy to confuse during live testing. The panel must say `bundle <fingerprint> · current` before any
Studio control is used; `stale` or `unavailable` is a hard reload/navigation gate, regardless of the
human-readable `studio-build` label.

Run the owned checks before and after each integrated slice:

```powershell
npx --no-install jest --runInBand 'test[\\/]studio'
npx --no-install eslint src/studio src/containers/blocks.jsx src/lib/variable-utils.js src/lib/tw-restore-point-api.js
npm run build
```

The repository-wide lint and Selenium baselines have pre-existing upstream/toolchain failures described in `BASELINE.md`; do not broaden their allow-list or mistake them for native-driver results.

## First decision gate

Begin with one existing workspace command-block rearrangement, not flyout creation. It exercises the most valuable common path—real `Gesture`, `BlockDragger`, `InsertionMarkerManager`, overlay timing, VM delivery, Undo suppression and verification—without flyout identity/category complications.

Stop after that fixture and inspect the event batch, Undo stacks, pointer/marker frames and VM topology. Proceed to nested inputs only if all four boundaries are clean. This is the cheapest point to discover whether the pinned Scratch Blocks package API is sufficient or whether a single upstream hook is justified.

## 2026-08-25: completed Play followed by the first Undo

The first Undo immediately after a completed native Play could advance the Studio history cursor while leaving the newest regenerated block in the workspace. Later Undos could still work, which made the failure look like animation leakage rather than a semantic delete miss. Redoing from that false boundary then produced a state mismatch.

The root cause was reference ownership across a grouped flyout transaction. The create snapshot is recorded before Blockly moves the new block into its final stack, so its `blockRef` can describe the transient pickup location. Native Play may generate a different live block ID. Inverse replay correctly removes the redundant move and emits only a delete, but the delete then had neither the live ID nor the transaction's durable final location.

`replayTransaction` now derives lifecycle references from the shared transaction-effects analysis and attaches the matching final move reference to inverse delete actions. The Scratch Blocks replay port still prefers a direct live ID when it exists. This distinction is important for nested reporters: by the time a reverse delete runs, a restored input shadow may already occupy the final recorded input, so globally preferring the location reference would delete the shadow instead of the reporter.

Regression coverage now proves both sides:

- inverse flyout creation skips its redundant move and carries the final move reference into the delete action; and
- the existing nested-reporter round trip still restores its original input shadow rather than deleting it.

Real-browser verification used the single current tab with bundle `65879f161066` and take `viewport-camera-heuristic-clean-20260825a`:

1. Play completed three native flyout interactions, producing `when flag clicked` → `say [Hello!] for (2) seconds` → `repeat (10)`.
2. The first Undo immediately removed `repeat (10)` while its exit proxy animated; the settled real Blockly count changed from three to two.
3. The next two Undos changed two → one → zero.
4. Three Redos restored zero → one → two → three.
5. Every settled boundary had zero lifecycle proxies, and the panel remained `bundle 65879f161066 · current` without a topology/state mismatch.

Owned verification passed: 47 Studio suites / 323 tests, focused Studio lint, and the production build.

## 2026-08-25: native reporter/Boolean Play and inverse input ownership

The remaining realistic Play gate is complete. A native flyout drag can now create and connect both a
round reporter and a hexagonal Boolean reporter without treating regenerated Blockly IDs as authored
project differences.

Three ownership boundaries were required:

- the native drag driver resolves and aliases every destination parent before the gesture mutates its
  input topology, so transaction verification can still identify the containing command block;
- new takes use `structural-v4`, which deterministically canonicalizes block object keys and every
  parent/next/input/procedure reference while retaining coordinates, fields, mutation content and graph
  shape. Older takes keep their recorded structural hash version;
- semantic inverse replay resolves every exiting live block before earlier inverse events restore an
  input shadow. The Studio replay wrapper forwards that prepared identity through to the eventual delete,
  so the restored shadow cannot displace the reporter and then be mistaken for the reporter to remove.

Follow-up live testing exposed one incomplete case in the first implementation: a Boolean flyout drag can
record more than one move. Backward lifecycle analysis retained the first pickup reference instead of the
last forward move's connected-input reference. Undo therefore detached the regenerated reporter but could
not resolve it for deletion, leaving a top-level `touching?`; Redo then created a second reporter and failed
structural validation at its missing `TOUCHINGOBJECTMENU`. Backward exiting lifecycles now always retain the
final forward move reference. The regression fixture includes distinct pickup, approach and connected
references so a single-move command case cannot hide this failure again.

The final real-browser fixture is take `reporter-boolean-postfix-20260825e` on bundle `c268a9cd2483`.
Its baseline contained `say [Hello!]` and `wait until <>`; two real user gestures then placed the Sensing
`answer` reporter into the round input and `touching [mouse-pointer]?` into the Boolean input. The journal
contained 2 steps / 8 events.

Acceptance evidence from the single retained current tab:

1. Play visibly used the Studio pointer and completed `played · 2 steps (8 events)` with both reporters
   connected to their recorded inputs.
2. The first Undo removed only `touching [mouse-pointer]?`; after animation settled, no top-level or proxy
   copy remained and `answer` was still connected to `say`.
3. The second Undo removed `answer` and restored the original `Hello!` input shadow.
4. Two Redos rebuilt `say (answer)` and then `wait until <touching [mouse-pointer]?>` without mismatch.
5. A second complete Rewind → Play cycle again reached `played · 2 steps (8 events)` with the pointer
   visible and the same settled topology.
6. At 120 ms into the first Undo, while the panel still said `undoing`, the real Blockly canvas already
   contained no `touching?` reporter. An immediate Redo restored exactly one connected reporter.
7. An 80 ms alternating Undo → Redo → Undo → Redo burst settled at `redone · 2 steps (8 events)` with
   exactly one `touching?` reporter and no state mismatch.

The realistic regression test reconstructs the harder identity boundary directly: inverse shadow
restoration first displaces a reporter whose ID was regenerated by Play, then the prepared live identity
deletes the reporter rather than the newly restored shadow. Owned Studio tests, focused lint and the
production build are required gates for this slice.

## 2026-08-25: real VM tuple identity and idle pointer ownership

A seven-step live replay later reached the correct visible topology but structural validation reported
`$.targets[1].blocks.block-1.inputs.MESSAGE.1 (expected "b", actual "c")`. This was not a field-value
change. Scratch VM project JSON represents many inputs as tuples such as `[1, shadowId]` and
`[3, blockId, shadowId]`; `structural-v4` canonicalized Blockly's object-form input references but left
those tuple IDs raw.

The corrected projection now understands all of the relevant serialized input forms:

- shadow-only tuples;
- live reporter plus obscured-shadow tuples;
- nested reporter tuples; and
- inline primitive shadows, which are retained byte-for-byte rather than mistaken for block IDs.

This correction is versioned as `structural-v5`. The exact v4 projection remains available for reopening
existing take/checkpoint hashes, while every new take selects v5. Tests prove regenerated tuple IDs compare
equal, repeated command blocks remain deterministic, inline literals remain unchanged, and a genuine swap
between the live reporter and shadow positions still fails structural validation.

The virtual pointer now has an explicit idle lifecycle. This section's original shared full-Play/fast-history
behaviour was superseded on 26 August 2026: history is pointer-free by default and dismisses any still-idling
Play cursor at its command boundary.
It remains fully visible for 2000 ms after the last interaction, fades out over 320 ms, and removes its DOM
overlay. Any new pointer activity cancels that retirement. A document-scoped ownership registry removes a
previous idle/fading pointer when Play, Undo or Redo takes over, without suppressing genuinely parallel
active pointers.

Real-browser verification used take `reporter-boolean-postfix-20260825e` with the expanded seven-step,
21-event journal on bundle `b287e0ca24be`:

1. The saved take reopened under its original v4 hash contract and completed `played · 7 steps (21 events)`.
2. At playback completion and after 1200 ms the pointer was present, fully opaque and marked idle.
3. Just after 2000 ms it was fading; by roughly 2300 ms the overlay was removed.
4. A consecutive Undo → Redo pair each settled with exactly one idle pointer, never overlapping cursors,
   while the panel reached `undone` and then `redone` without a state mismatch.

Owned verification passed: all 47 Studio suites / 332 tests, focused Studio lint, and `git diff --check`.

## 2026-08-26: reversible comments and media-editor operations

Scratch Blocks comment JSON is not a sufficient inverse record: create/delete omit live text, size,
minimized state and coordinates, while change/move decoding drops private fields used by `run()`. Studio
now snapshots those values explicitly for block and workspace comments, reconstructs the private event
state (including RTL workspace width), and restores complete created state before mirroring the event to
the VM. Timeline labels distinguish add/edit/move/delete. Real workspace and attached block comments
passed create, move and delete at every boundary in both directions; focused tests cover text/resize state.

Non-Blockly media authoring now has explicit checkpoint-backed contracts beyond library lifecycle:

- the generic `addCostume` route records blank, uploaded or otherwise supplied sprite costumes and Stage
  backdrops without double-recording nested library calls;
- `updateSvg` records persisted vector costume/backdrop edits; and
- `updateSoundBuffer` records only successfully encoded waveform edits, not Scratch GUI's transient
  failed-encode path.

Paint and sound callbacks do not await the VM methods they invoke. The shared capture port therefore tracks
one active asynchronous checkpoint: synchronous VM delegation stays inside that operation, but a separate
author callback queues until the first before/after boundary is sealed. A rejected capture also rejects the
queued mutation rather than silently applying it outside history.

The fresh queue stress take `media-queued-strokes-20260826a` on bundle `53803a01e5c7` drew two vector
brush strokes back-to-back without waiting for the first capture UI to settle. Studio recorded `Add costume`,
`Edit costume`, `Edit costume`; all three boundaries passed backward and forward, followed by full Play at
2×. This is the acceptance check for the serialized callback boundary, not only a mocked promise test.

The real browser take `media-edit-lifecycle-20260826a` on bundle `ac4cde544a13` used Scratch's Paint menu
for a blank costume and blank backdrop, drew a brush stroke into each vector editor, added Meow from the
sound library, and applied Faster in the waveform editor. Its six labelled transactions passed direct
Undo/Redo and full Rewind → Play at 2×. The sound boundary visibly restored duration from 0.67 seconds to
0.85 seconds and forward to 0.67 seconds.

The follow-up bitmap slice makes `canvas.toBlob` completion explicit. `updateBitmap` capture subscribes to
Scratch VM's `targetsUpdate` before invoking the editor mutation, waits until the new asset is installed,
and removes its listener on success, failure or a bounded timeout. An unchanged asset still completes and
flows into the existing no-op hash filter. Take `bitmap-edit-lifecycle-20260826a` on bundle
`e22a2d75abff` converted the default vector costume to bitmap and drew two bitmap strokes back-to-back.
Studio recorded three `Edit costume` transactions; complete backward/forward traversal and Play at 2×
passed without stale bytes, swallowed strokes or a project mismatch.

### Explicit costume and backdrop selection — verified 26 August 2026

Costume selection cannot be captured by globally wrapping `target.setCostume`: Scratch runtime Looks
blocks invoke that same VM method. Studio instead exposes its semantic target-property edit boundary to the
Costumes container and invokes it only around a genuine costume/backdrop card click. The transaction stores
the selected target reference and before/after `currentCostume`; direct runtime calls remain invisible to
the authoring journal. Detach restores the uninstrumented GUI path, and unchanged selections remain no-ops.

The real browser take `costume-selection-20260826a` on bundle `bb6b9a7fb0fc` used Scratch's Paint menu to
add a second sprite costume, selected costume 1 then costume 2, selected Stage, added a second backdrop and
selected backdrop 1 then backdrop 2. Studio recorded six semantic boundaries. Every boundary passed in
both directions (`6→0→6`) and full Play at 2× completed at the exact head without a diagnostic. Focused
tests additionally prove a direct runtime-style `setCostume` call creates no history, and the complete
Studio gate now passes 54 suites / 386 tests.

### Reversible Stage drag layer order — verified 26 August 2026

Scratch's Stage container calls `target.goToFront()` before `vm.startDrag`. Capturing only the later
`postSpriteInfo` frames therefore loses the genuine pre-gesture order, and changing one sprite's stored
layer index cannot restore the peer indices shifted by bringing it forward. The Stage now opens an explicit
Studio target gesture before `goToFront`, snapshots every original sprite's layer order alongside the
dragged sprite properties, and completes one multi-target data transaction after the normal stop-drag path.
Runtime Looks blocks which call `goToFront` are untouched.

The real browser take `stage-layer-drag-20260826a` on bundle `6a6ab9c9304b` added Apple in front of Sprite1,
moved Apple aside, then dragged the visible Sprite1 to a new Stage position. Studio recorded one combined
`Edit sprite properties — Sprite1` boundary for the drag. Direct Undo and Redo both passed strict authored
project validation, including the two reversed layer indices, and full Play at 2× completed at 3/3. The
complete Studio gate passes 54 suites / 388 tests; focused coverage proves the gesture emits one multi-target
snapshot and the delta retains only properties that actually changed.

### Built-in extension preparation on clean reload — verified 26 August 2026

Built-in extension selection is editor preparation, not a reversible project mutation: adding Pen changes
the available toolbox but the meaningful authored transaction is the first `pen_*` block. Same-session
Rewind → Play already passed because Scratch retained Pen in the extension manager. A clean reload of the
same persisted take reproduced the real gap: the base checkpoint contained no Pen opcode, so native Play
reported `Native flyout block is not visible: pen_clear` and restored 0/1.

The GUI Add Extension control and generic library items now expose stable Studio keys. Before a flyout block
drag, the driver derives a candidate prefix from its opcode and asks the VM whether it is a built-in
extension. If it is not loaded, the shared pointer opens the real extension library, selects the exact item,
waits for the extension manager, and then waits for that block's SVG to have non-zero visible bounds. This
last readiness gate matters: the first fix waited only for `isExtensionLoaded`, which became true before the
category selection and flyout paint had settled and reproduced the same hidden-block failure.

The real take `extension-pen-20260826a` on bundle `8ad31a579647` was authored through Scratch's Pen library
and contained one `pen_clear` transaction (two grouped Blockly events). Direct Undo/Redo and same-session
Play passed first. After a fresh tab reload at position 0/1, Play at 2× visibly traversed
`extension-library-open`, `extension-library-item:pen` and `flyout:pen_clear`, then completed at 1/1 with
verified native evidence. The full gate passes 55 Studio suites / 391 tests.

### Context-menu single and compound duplication — verified 26 August 2026

Blockly may finish a context-menu duplicate with an ungrouped `recordUndo: false` move after the grouped
create and initial placement events. For a compound clone that finishing move can name a different member
of the created topology. Treating it as a new transaction produced a visible extra history step and could
leave Play resolving a clone member against the wrong recorded ID. The journal now recognizes only this
adjacent, non-undoable placement tail and retains it in the creation transaction. A later grouped,
undoable user drag remains a separate transaction.

Real-browser coverage used two clean Pen workflows. Take `duplicate-stack-clean-20260826a` duplicated the
bottom `pen down` from an `erase all → pen down` stack. Its single clone boundary passed direct Undo/Redo,
two consecutive complete Plays, and reload followed by complete Play. Take
`duplicate-stack-compound-20260826a` then targeted the root block path and duplicated the complete two-block
stack. One Undo removed both cloned blocks and Redo restored both; complete Play and persisted-reload Play
ended with the original stack, the single clone and the compound clone and no diagnostic. The compound
transaction correctly reported `semantic-only`: there is no honest single flyout drag for multiple created
command roots, so exact reconstruction is preferable to invented native evidence.

Focused journal coverage also proves the non-undoable tail is coalesced even when it names another clone
member, while a later ordinary drag is not. The complete Studio gate passes 55 suites / 394 tests.

### Cancelled outside-workspace drag normalization — verified 26 August 2026

Dragging a block toward an external drop surface such as Backpack can end without a successful drop.
Blockly then emits an undoable move to a far outside-workspace coordinate followed by an ungrouped,
`recordUndo: false` move which restores the original location. Studio previously displayed those as two
separate moves even though the authored project was unchanged; one reproduced take moved a block to about
`(504, 1648)` and immediately returned it to about `(125, 203)`.

The journal now recognizes the adjacent inverse pair by target, block ID and complete structural location.
Top-level coordinates compare with a tiny tolerance for Blockly's floating-point round trip, while nested
locations must restore the same parent and input. Only a one-event move transaction can be cancelled: a
multi-event stack rearrangement, an undoable follow-up, or a settle at a different location remains visible.
The same normalization runs while parsing older stored journals.

The persisted browser take `backpack-compound-import-20260826a` initially contained `Add move steps`, an
off-screen `Move move steps`, and the inverse settle. Reopening it on bundle `b300179d5c32` reduced the
timeline to its one real two-event creation. Repeating the cancelled Backpack-bound drag under that bundle
left the block at the identical browser coordinate and the journal at 1/1. Focused coverage adds top-level,
nested-input, changed-destination, multi-event and persisted-pair cases; the complete Studio gate passes
55 suites / 399 tests.

### Backpack sprite import and asynchronous name ownership — verified 26 August 2026

Scratch VM's `addSprite` installs the imported target and then calls `renameSprite` asynchronously inside
`installTargets` to make its name unique. Studio's independent-operation queue previously saw that nested
call after the synchronous invocation frame had returned and delayed it until the active `addSprite`
checkpoint was sealed. A real Backpack import therefore captured two targets named `Sprite1`; the editor
then normalized the new target to `Sprite2`, and Redo rejected the checkpoint hash.

Project-operation captures can now declare a predicate for nested VM calls owned by the active operation.
Sprite creation admits only `renameSprite` for an ID which did not exist before `addSprite`; that internal
normalization runs before the after-checkpoint and contributes to the one `sprite-create` transaction. A
rename of any pre-existing sprite still waits and becomes its own captured action. Other asynchronous
author callbacks retain the existing serialized queue.

The real local Backpack was exercised through Scratch's asset-drag Redux path: Sprite1 was dragged into the
open Backpack without changing project history, then the stored item was dragged into the sprite pane.
The first take reproduced `Add sprite — Sprite1` followed by the exact checkpoint mismatch. The corrected
clean take `backpack-sprite-roundtrip-20260826a` on bundle `d4bd8a875d66` recorded one
`Add sprite — Sprite2` boundary with matching target and editing-target references. Direct Undo removed
Sprite2, Redo restored it, complete Play passed, and reload followed by complete Play passed again. Unit
coverage proves both the internal normalization and the still-serialized pre-existing-target rename; the
complete Studio gate passes 55 suites / 401 tests.

### Realistic built-in sound-library selection — verified 26 August 2026

`addSound` is shared by the built-in library, file upload, recording and Backpack, so its arguments alone
cannot safely authorize a realistic library journey. SoundLibrary now opens a short-lived GUI source
context around its real VM call. Project capture copies the exact name and `md5ext` only from that context;
generic sound additions remain exact checkpoint operations without invented presentation metadata.

The Sounds tab, its primary library control and sound-library items expose language-neutral Studio targets.
Sound items retain `_md5` internally for preview behavior, so the generic library key now explicitly falls
back to `_md5`. The project-library driver generalizes its media contract across Costumes, Backdrops and
Sounds: it selects the durable target when needed, clicks the correct editor tab and library control, waits
for the observed VM promise, and verifies the added media reference. Sound verification includes asset ID,
format, name, sample rate and sample count.

The real take `sound-library-realistic-20260826a` on bundle `a610fea2d69e` selected Meow through Scratch's
Sounds library and recorded one `Add sound — Sprite1` checkpoint with durable key
`83c36d806dc92327b9e7049a565c6bff.wav`. Direct Undo and Redo passed. Full Play produced verified pointer
stages `tab-sounds`, `sound-library-open` and the exact library item, while its resulting structural hash
matched the recorded endpoint. Reload followed by full Play repeated the same verified native journey.
The complete Studio gate passes 55 suites / 403 tests; focused lint is clean apart from Scratch's existing
`react/no-did-mount-set-state` baseline in `sound-library.jsx` when that entire legacy file is linted.

### Recording-quality sound-editor effects — verified 26 August 2026

Persisted waveform edits already had exact checkpoint history, but Play restored their after-checkpoint
without showing the Scratch action that made it. `SoundEditor` now supplies a short-lived `sound-effect`
source context only around its genuine `updateSoundBuffer` call. The recorded operation therefore retains
the named effect plus exact before/after sound references; generic buffer updates do not acquire invented UI
meaning.

The sound cards and all ten editor effects expose stable, language-neutral Studio targets. The project-media
driver selects the durable sprite or Stage, visits Sounds, clicks the card whose asset ID matches the recorded
input, then clicks the exact effect. It observes the real asynchronous VM invocation and waits for the
recorded output asset, rate and sample count. Its verifier has a distinct editor-effect contract: the input
sound must match before editing, both controls must be visible, pointer travel must complete, the output must
match, and replay may not modify the journal. It does not falsely demand an asset-library modal.

The existing real take `sound-library-realistic-20260826a` was extended under bundle `30bc2ba068ae` by
clicking Faster on Meow. The second transaction retained input asset
`83c36d806dc92327b9e7049a565c6bff` at 37,376 samples and output asset
`3a5b153d17077f8bee18c393d5a2fab1` at 29,665 samples. Direct previous/next traversal visibly restored
0.85 s → 0.67 s. Complete Rewind → Play verified both the library journey and effect journey at the exact
endpoint. A full browser reload followed by another Rewind → Play passed again with no diagnostic. The
complete Studio gate passes 55 suites / 405 tests and focused source lint is clean.

### Procedure argument identity projection — 26 August 2026

Scratch regenerates the IDs used simultaneously by custom-procedure prototype mutations, procedure-call
mutations and their dynamic input keys. Treating those strings as authored input names produced false
endpoint differences even when a definition and every call were semantically unchanged. Structural `v6`
normalizes those keys by argument position during graph fingerprinting, traversal and final projection.
It still detects swapped or missing argument connections. Structural `v5` is unchanged for persisted-take
compatibility, while new takes prefer `v6`.

The graph matrix now includes a definition, prototype, string and Boolean argument reporters, a call with
a text shadow and nested touching/menu Boolean, regenerated IDs shared between prototype and call, and a
deliberately rewired call. Focused projection/session tests pass, followed by the complete Studio gate.

### Real sound-upload source and browser regression — 26 August 2026

Sound upload authoring marks only the genuine Sound-tab file input route, then stores the filename and exact
added sound reference on its checkpoint-backed operation. Play selects the durable sprite, visits Sounds,
reveals the real action menu, clicks Upload, reconstructs a browser `File`, dispatches the normal input
change and waits for Scratch's asynchronous `addSound` path. Verification requires the visible control,
ready input, completed pointer journey, exact asset/rate/sample count and an unchanged journal.

A new opt-in Selenium test exposed the important missing case that mocks did not: Rewind removes an uploaded
asset from live VM storage before native Play needs its bytes. The restore-point API now reads one asset only
when that exact content-addressed key belongs to the operation's after-checkpoint. No bytes are duplicated in
the journal or diagnostics. `test/integration/studio-sound-upload.test.js` uploads the real `sneaker.wav`,
passes Rewind → Play, reloads the persisted take at position `0/1`, and passes Play again in Chrome. The
driver path is supplied through `CHROMEDRIVER_PATH`, so no machine-specific executable path is committed.

Owned verification: the real browser test passes in 5.8 seconds; all 55 Studio suites / 419 tests pass;
focused source lint and `git diff --check` are clean.

### Sprite reorder and cross-sprite script-copy browser boundary — 26 August 2026

Studio now wraps `reorderTarget` and `shareBlocksToTarget` as distinct, checkpoint-backed project
operations. Reorder freezes the moved sprite and requested indices. Script transfer records `block-share`
only when the source and destination targets differ; same-target or source-less payloads remain
`block-import`. Scratch creates fresh IDs for the serialized drag payload, so the target pane also supplies
the original top-block ID. Capture walks that live source block to its durable ancestor and records the
complete `next`/named-input path for later interaction planning.

The first genuine browser Undo exposed a boundary race hidden by unit mocks. `BLOCK_DRAG_END` starts the
copy while Blockly still owns a temporary off-canvas move frame. Structural projection had already
snapshotted the settled source coordinate, but asynchronous restore-point persistence serialized the
temporary coordinate, so loading the nominal before-checkpoint could never match its hash. Restore-point
project bytes are now taken before opening IndexedDB, and project-operation checkpoint serialization and
structural capture both begin in the same synchronous turn. This makes each checkpoint/hash pair one atomic
logical frame without weakening comparison or special-casing coordinates.

`test/integration/studio-target-operations.test.js` uses Scratch's real sprite library, React sprite-card
drag handling and Blockly flyout/workspace drag handling. One journey reorders Apple before Sprite1; the
other drags a real `move 10 steps` script onto Apple. Both pass Ctrl+Z, Ctrl+Shift+Z, Rewind, full Play,
reload at the safe base boundary and full Play again. Focused semantic/session tests pass, all 55 Studio
suites / 419 tests pass, focused source lint is clean and the two real Chrome journeys pass in 19.7 seconds.

### Real GUI presentation for target operations — 26 August 2026

The semantic target-operation boundary above is now also a recording-quality Play boundary. Forward
realistic `sprite-reorder` compiles to `sprite-reorder-drag`: the shared natural pointer visits the moved
sprite card, presses it, forwards every generated path frame as the DOM drag and releases over the card at
the recorded index. Forward realistic `block-share` compiles to `cross-sprite-script-drag`: Play first
selects the durable source target when necessary, resolves the recorded script through its ancestor/path
reference, starts Scratch Blocks' genuine `Gesture` and moves it onto the durable destination sprite card.
Backward playback and ordinary fast history remain semantic/checkpoint presentation; they do not pretend to
be a user repeating the original GUI action.

The pointer controller exposes a frame callback rather than teaching either operation a second motion
model. This keeps velocity, overshoot and future recorded-human models swappable while the driver owns only
the real DOM/Blockly gesture. Both verifiers require visible source/destination controls, completed pointer
travel, the exact target order or source/destination block counts, and unchanged journal plus native
Undo/Redo queues. Playback still restores the exact after-checkpoint after presentation, so presentation IDs
never become project authority.

The permanent Selenium acceptance test now rejects a merely successful semantic fallback: after each Play
and reload Play it inspects the published native evidence and requires the expected target-operation plan,
the natural model, more than one pointer frame, visible controls and a matching project. Both real Chrome
journeys pass in 23.4 seconds. Direct driver tests cover DOM frame forwarding and the genuine Blockly
gesture, a pointer-controller test covers the reusable frame callback, the independent real sound-upload
journey still passes, and the complete Studio gate passes 57 suites / 429 tests.

### Permanent real-browser connection matrix — 26 August 2026

`test/integration/studio-connection-matrix.test.js` turns the existing 29-transaction connection fixture
into a repeatable browser acceptance boundary. It asserts that the recorded journal actually contains the
expected statement, C-block, nested round-reporter, Boolean, menu-shadow and field-edit opcodes rather than
merely trusting the fixture's final step count. It also requires the distinct nested reporter values `a`,
`b` and `c`, which directly guards the prior `MESSAGE.1 expected "b", actual "c"` aliasing failure.

The Chrome journey first uses the actual transport controls and shared speed selector for
`29 → 0` backward and `0 → 29` forward playback at 4×. It then seeks `29 → 18 → 15 → 18 → 29`, fully
rewinds, completes realistic Play at 4×, reloads the persisted take at its safe base, then completes
realistic Play again. Every transition retains the
normal strict topology and project endpoint checks; the test fails immediately with native evidence,
diagnostic and serialized journal context if Studio restores. The maintained selected-range run passes in
67.7 seconds.
This browser layer complements rather than replaces the pure `structural-v6` connection scenarios and the
transaction/session unit gates.

### Permanent variable, list, procedure and broadcast dialogue journey — 26 August 2026

`test/integration/studio-authoring-dialogs.test.js` exercises four previously manual recording-quality
families through the real editor. It creates a sprite-local scalar named `cake`, a global list named
`ingredients`, and a custom definition `bake %s %b` whose visible inputs are typed as `amount` and `ready?`.
It then drags a genuine `broadcast [message1]` block from Events into the workspace, opens its real dropdown,
chooses New Message and types `party time` in Scratch's prompt.

The test asserts five distinct recorded transactions and their important scope/type/mutation/message data,
then performs complete Rewind → 4× Play, reloads the persisted take at position `0/5`, and repeats complete
Play. The final native evidence must be a verified `broadcast-create-dialog` with a visible dropdown and
dialogue, completed natural-pointer travel and the full paced typing sequence ending at `party time`; a
semantic checkpoint fallback cannot pass the assertion. The real Chrome journey passes in 16.6 seconds.

### Selected transaction-range transport — 26 August 2026

The temporary Studio panel now exposes explicit From/To transaction boundaries and separate forward and
backward range buttons. A range command first uses the existing exact `seek` contract to reach the selected
entry boundary when necessary, then calls the existing paced `playHistory` contract with the opposite
boundary as `targetIndex` and the shared speed. There is no parallel replay engine and backward remains a
sequence of verified inverse transactions, never reversed video. The controls preserve their selection as
the journal grows, follow a previously selected end boundary to the new head, clamp after branch changes and
keep start/end ordered when either selection crosses the other.

Panel tests cover the endpoint-following, ordering and exact `seek`/`playHistory` calls. The real Chrome
connection matrix selects `15..18`, plays the range forward to 18 and backward to 15 at 4×, in addition to
its full-boundary, arbitrary-seek, realistic-Play and reload-Play gates.

Running the independent target-operation journey then exposed a presentation-layer regression: the taller
panel's former `z-index: 10000` covered a sprite-library tile at 1024×768 and intercepted the Apple click.
The panel now sits at 505—above ordinary editor and stage-header chrome, but below Scratch's documented
modal/library layer at 510—and the range row uses compact icon buttons. The exact previously intercepted
sprite-library/reorder and script-copy journeys both pass again; tests retain the original viewport so they
cannot hide the product bug by moving the click.

### Queued-history branch pressure and empty-input equivalence — 26 August 2026

`test/integration/studio-history-pressure.test.js` makes the held-key and branch-edit boundary permanent on
the complete 29-transaction connection matrix. It sends eight Undo requests in one keyboard chord, returns
with eight Redos, sends four more Undos, then authors a real palette block. The test requires the abandoned
future to be replaced by one 26th transaction, rewinds, performs complete 4× Play, reloads the persisted take
at its safe base and performs complete Play again.

The first valid run exposed a semantic serialization difference at the new head. Removing both children of
an `operator_and` left inert `[1, null]` input tuples in the recorded VM project; recreating the identical
empty block through Scratch's real flyout omitted those tuples. The opcode/mutation owns the visible sockets,
so those representations are authored-equivalent. Structural `v7` normalizes only empty two-item tuples
whose kind is 1 or 2 and whose payload is null. It continues to compare connected reporters, inline primitive
shadows, obscured shadows, dynamic procedure inputs and all field values exactly. Existing takes retain their
recorded projection version; new takes prefer `v7`.

The real Chrome pressure journey now passes both same-page and reload Play in 54.2 seconds. Focused
projection, connection-scenario and session suites pass 60 tests. The out-of-bounds palette drop used during
initial test construction was corrected to a genuine workspace target; no speculative event-queue drain was
retained.

### Permanent Escape/resume browser boundary — 26 August 2026

`test/integration/studio-playback-stop-resume.test.js` exercises cancellation as a complete persistent
workflow on the 29-transaction connection matrix. It rewinds to zero, starts 0.5× realistic Play, waits until
at least one transaction has committed while the cursor is still below the head, then sends Escape through
the real document keyboard route. Acceptance requires `stopped` at a safe intermediate cursor with no
restore, state mismatch or stale-build diagnostic.

The same page resumes from that retained cursor at 4× and reaches the exact 29-step head. One ordinary Undo
and Redo then cross the final boundary before a full page reload returns the take to its safe base; another
complete 4× Play must match the endpoint. The maintained Chrome journey passes in 57.0 seconds. This turns
the prior unit-only AbortController coverage into a user-level recording and restart guarantee.

### Durable Backpack script imports and supported capture boundary — 26 August 2026

Backpack script imports are now a first-class recorded project operation rather than an anonymous VM
mutation. The GUI boundary records a compact, durable source identity (`id`, type, name and optional body
hash), the destination sprite and the exact authored workspace coordinate. Replay selects the real sprite,
opens the real Backpack when necessary and performs the real drag through the editor. The checkpoint remains
semantic authority: if the external Backpack item is no longer available, replay reports the presentation
route as unsupported before mutating the project and restores the exact recorded checkpoint. Transient
Backpack download URLs are deliberately not persisted.

The original Backpack drop handling also had an ordering race between Blockly's synchronous UPDATE event,
the Backpack mouse-enter notification and React state publication. A small synchronous drop-session state
machine now owns that protocol; React state is presentation only. Unit tests cover each ordering, including
UPDATE-before-enter and END-before-enter, so a fast real drop cannot be lost.

The realistic Chrome fixture authors the 29-step connection matrix, stores a genuine script in the local
Backpack, imports its nested 19-block stack and crosses the import with Undo, Redo, Rewind, 4× Play, reload
and another complete Play. It also retains the authentic source-move transaction caused by putting the
original into the Backpack. The journey exposed and permanently covers four representation boundaries:
nullable field IDs, Scratch-rounded top-level coordinates, inert null shadow slots and short-flyout semantic
scrolling. New takes use structural projection `v10`; earlier projection versions remain available for
existing journals. The Backpack journey and the independent sprite/cross-sprite target-operation journey
pass together in real Chrome (3 tests, 92.6 seconds), while the complete focused Studio/unit gate passes 59
suites and 444 tests.

The supported recording envelope is intentionally bounded to deterministic Scratch editor authoring and
project-state operations: blocks and connections, fields/dropdowns, variables/lists/broadcasts/procedures,
sprites, costumes, deterministic sounds, Backpack scripts, camera/pointer presentation and timeline
transport. Live microphone capture and other nondeterministic hardware-input sessions are deferred. They are
not silently treated as recordable: adding them later requires an explicit media/timing authority design,
artifact persistence and real-device acceptance tests.

### Deterministic same-editor block clipboard — 26 August 2026

Scratch's block Copy/Paste is an internal Blockly clipboard rather than the operating-system clipboard. Studio
now treats that narrow path as supported and leaves arbitrary OS clipboard input out of scope. While capture
is attached, the workspace paste boundary associates its grouped create event with a durable reference to the
source block. The wrapper is restored on detach and stores neither clipboard XML nor external clipboard data;
the create event and exact project checkpoint remain semantic authority.

Realistic Play selects the recorded source with the natural pointer, asks Scratch Blocks to copy it and calls
the normal workspace paste path. Scratch therefore continues to own cloned IDs, obscured shadows, collision
avoidance and the native create event. The driver returns the ordered recorded-to-live ID aliases for topology
verification. It also pins the clipboard XML to the create event's recorded top-level coordinate before paste:
this prevents `parseInt` from turning a replayed source coordinate such as `159.999…` into a one-pixel drift,
without replacing Scratch's placement logic.

The maintained Chrome journey performs real Ctrl+C/Ctrl+V on the connection matrix's compound nested hat
stack, then Undo, Redo, Rewind, natural-pointer 4× Play, reload and another complete Play. It exposed two
authentic boundaries now kept in the test: initial authoring can retain two inert obscured shadows outside the
public BlockCreate ID list, while Blockly Redo recreates the public semantic tree; and native Play must publish
all regenerated block aliases before topology verification. The complete journey passes in 56.6 seconds.

### Recording-quality deterministic sound lifecycle — 26 August 2026

Forward Play now performs sound duplicate, rename, delete and reorder through Scratch's real Sounds-tab UI.
Sound-card targets combine list index with asset ID because a genuine duplicate deliberately shares its source
asset ID; asset ID alone would resolve the first card and make the next rename or delete ambiguous. Duplicate
opens the real context menu, rename selects and types into the visible buffered name input, delete clicks the
selected card's delete control, and reorder forwards every natural-pointer frame through the asset-list drag
recognizer. Each driver operation observes the corresponding VM call and verifies the expected sound result;
the project checkpoint remains the final authority.

The maintained take `sound-lifecycle-20260826a` contains six real operations: library add, duplicate, rename,
delete, a second library add and reorder. Natural-pointer 4× Play reached 6/6 with matching canonical project
hash and verified `sound-reorder-drag` evidence. The same sole browser tab was then reloaded in place, rewound
to 0/6 and played to 6/6 again; native interaction, pointer completion and the final Boing/Meow order all
verified. Live microphone capture remains deliberately outside the supported recording envelope.

### Recording-quality deterministic sprite lifecycle — 26 August 2026

Forward Play now performs sprite duplicate, rename and delete through Scratch's real editor controls. Sprite
cards derive durable Studio targets from their displayed Scratch names, duplicate uses the real context menu,
rename selects the sprite and types into the visible buffered name input, and delete clicks the selected
sprite's visible delete control. Every operation observes the corresponding VM call and verifies the durable
source or resulting target identity; the recorded project checkpoint remains semantic authority.

The maintained browser take `sprite-lifecycle-realistic-20260826b` records three genuine operations:
duplicate Sprite1 as Sprite2, rename Sprite2 to Guide, then delete Guide. Natural-pointer Play reached 3/3
with an exact canonical project match and unchanged Studio journal, Undo and Redo depths. Scrubbing through
positions 3, 2, 1, 0 and back to 3 produced the exact Sprite1/Guide/Sprite2 lifecycle without a virtual
pointer, preserving the separation between realistic Play and fast history presentation. A full reload at
position 0 retained the take and a second complete Play again reached the exact endpoint. The complete Studio
gate passes 62 suites and 470 tests.

That manual take is now preserved as `test/integration/studio-sprite-lifecycle.test.js`. The permanent journey
authors all three operations through the rendered sprite card, context menu, buffered name input and delete
button; traverses each boundary backward and forward; then completes natural-pointer 4x Play before and after a
persisted base reload. It verifies the final `sprite-delete-click` controls, target state and multi-frame pointer
travel. The maintained journey passes in 7.9 seconds against the current 64-suite / 539-test Studio gate.

### Costume/backdrop lifecycle, settled asset reorders and Play-only cursor — 26 August 2026

Forward realistic Play now covers costume and backdrop duplicate, rename, delete and reorder through the
real Costumes-tab controls. Asset-card targets combine list index with asset ID because Scratch duplicates
share their source asset. Duplicate opens the context menu, rename selects the card and types into the
visible paint-editor name input, delete uses the card control, and reorder forwards every natural-pointer
frame through Scratch's sortable-list drag recognizer. Each action observes the exact VM call and validates
the resulting asset identity before the recorded checkpoint remains final project authority.

Real playback exposed a GUI settlement race shared by costume, backdrop and sound lists. The sortable HOC
previously mutated its parent during `componentWillReceiveProps`; React could absorb the parent refresh into
the drag-end render, leaving old card labels over the already-reordered VM array. The HOC now snapshots only
the final drop index before the render and commits `onDrop` in `componentDidUpdate`. The Scratch Addons
folders patch composes that lifecycle instead of replacing it, and successful media reorders publish a
non-project-changing target refresh. There is no timing delay or asset-specific repair.

The take `costume-lifecycle-realistic-20260826a` records eight genuine operations across Sprite1 and Stage.
Natural-pointer Play on bundle `a659b4a48a43` reached 8/8 with the exact Hero/Night endpoint. An immediate
history step removed Play's still-idling pointer, and rail scrubs `7 -> 2 -> 8` used the shared semantic
Undo/Redo executor with zero pointer overlays. The input connection matrix independently played its nested
reporter/shadow range `18 -> 15 -> 18`; coordinated input proxies were visible during motion and settled
with zero hidden Blockly roots, proxy residue or cursor residue. The rail continues to coalesce intermediate
drag values into one latest-destination catch-up command, so scrubbing cannot build a stale seek backlog.

The regression gate adds post-render sortable settlement, exact costume/backdrop plan-driver-verifier
coverage and explicit history-pointer dismissal. All 64 Studio suites / 486 tests pass before the production
build and snapshot rotation.

### Permanent costume/backdrop lifecycle and scrub boundary — 26 August 2026

`test/integration/studio-costume-lifecycle.test.js` now makes the eight-operation manual lifecycle take a
maintained browser acceptance boundary. The journey duplicates the default sprite costume, types `Hero`,
reorders and deletes it, then repeats duplicate, typed `Night`, reorder and delete on the Stage backdrop.
Both duplicates deliberately retain their source asset ID, so the test requires index-plus-asset targeting
and would fail if the visually wrong duplicate were selected after a reorder.

After recording, the journey performs complete Rewind and natural-pointer Play at 4x, requires verified
`backdrop-delete-click` evidence, then scrubs `8 -> 3 -> 8` through the real timeline rail. Position 3 must
show `Hero` before the original costume while the Stage is untouched; position 8 must restore both original
asset lists. The still-idling Play pointer must be removed as soon as the first rail seek begins and remain
absent for both history directions. The take is finally rewound, reloaded at its safe base and played again
to the exact endpoint.

The browser run also corrected a stale Selenium-3 assumption in the existing sound lifecycle journey:
right-click uses `ActionSequence.click(element, Button.RIGHT)`, and both media tests choose the displayed
context-menu instance rather than a hidden React menu with the same semantic target. The two independent
media lifecycle journeys pass together (2 tests, 32.6 seconds). The complete Studio gate remains 64 suites /
486 tests; focused source lint and `git diff --check` are clean.

### File New journal replacement boundary — 26 August 2026

`test/integration/studio-file-new-restart.test.js` makes the deliberate non-recoverable File -> New boundary
permanent. The real browser journey first adds Apple and proves that the old journal contains one sprite-create
transaction, accepts Scratch's New-project confirmation, then requires a new journal ID, a new base checkpoint,
an empty transaction list and a `0/0` timeline on the default Stage/Sprite1 project. It adds Apple again to the
new project, crosses Rewind and natural-pointer Play, reloads at the safe base and performs another complete Play.

This gate specifically prevents a replaced project's operations, cursor or checkpoint identity from leaking into
the new take. It passes against both the stable snapshot and the working live build.

### Theme-aware Studio transport panel — 26 August 2026

The temporary panel no longer mixes a hard-coded white surface, purple buttons, browser-default dark selects and
fixed grey disabled states. Its scoped styles now consume TurboWarp's live GUI variables for modal and input
surfaces, primary text, borders, shadow, accent, success and error states. Theme changes therefore update the
panel immediately without a Studio-specific dark-mode switch or duplicated palette. All buttons, selects, the
timeline rail, hover/focus treatment and disabled states share the same colour and contrast model.

The layout now presents a compact Tutorial Studio header, status/build freshness, a three-action row with Play as
the semantic primary action, and a labelled Timeline section containing speed, point transport, scrub rail, exact
step selection and selected-range playback. Transport glyphs share one compact button treatment and browser
fixture controls remain visually subordinate. IDs, button labels and session command contracts stay stable for
browser automation and future React replacement.

The panel was inspected in the real editor in both dark and light GUI modes, then with a populated one-step
timeline so enabled and disabled transport states were both visible. Computed surfaces and text match the active
TurboWarp variables in each mode. The complete Studio gate passes 64 suites / 487 tests, and the new File -> New
journey plus the costume/backdrop lifecycle journey pass together against the styled live build (2 browser tests,
23.6 seconds).

### Speed-scaled camera and permanent idle-pointer retirement gate — 26 August 2026

Timeline speed now reaches every camera route rather than stopping at gesture, lifecycle and inter-step timing.
The session passes the selected speed through history preparation, semantic fallback and native interaction
framing; the viewport port applies it to recorded-view, safe-frame and destination corrections; and the camera
motion primitive scales duration without changing endpoints or easing. A focused test proves 2x and 0.5x
durations and rejects a non-positive speed. Session and executor tests also prevent a semantic fallback from
quietly reintroducing the default camera speed.

Dialogue and list paint waits remain real `requestAnimationFrame` barriers by design. They establish rendered
controls and refreshed flyouts before the next target is resolved, so treating them as authored pauses and
dividing them by playback speed would weaken correctness. A future editable pause track may scale intentional
dramatic timing independently of these renderer-settlement frames.

The costume/backdrop Chrome journey now verifies the pointer's complete retirement lifecycle after persisted-
reload Play: it must remain present at full opacity in the idle state, may not start fading materially before
the two-second hold, must expose the fade state, and must leave the DOM after the 320 ms ease-out. Its earlier
immediate scrub still proves history dismisses the live Play pointer synchronously and remains pointer-free.
That journey and the full nested connection matrix pass together (2 browser tests, 97.2 seconds). The complete
Studio gate passes 64 suites / 489 tests.

### Source-healed nested statement reorder — 26 August 2026

A recorded middle-statement move can describe its destination through the stack as it exists after Blockly
heals the source gap. Resolving that path before pickup used to stop one statement early: in the reported
13-step take the native drag therefore approached the wrong vertical connection and the transaction was
restored. Durable statement-path resolution can now exclude the primary moving block only when the same
transaction contains the matching induced tail-heal move. Compound stack moves, which do not contain that
evidence, retain their existing identity rules.

Nearby statement connections also cannot be distinguished safely by a coordinate offset alone. Before
mouse-up the native driver now compares Blockly's live insertion-marker target with the recorded connection
object. If Blockly has acquired an adjacent outer-stack or sibling C-slot connection, the same pressed
pointer makes a short eased correction toward the intended connection. The correction stops on the first
frame where Blockly exposes the recorded insertion marker, rather than continuing past it as neighbouring
connections reflow. This preserves a genuine `Gesture -> BlockDragger -> InsertionMarkerManager`
interaction and avoids hard-coded block-height or slot-position cases.

The permanent connection matrix is now 37 steps. It includes the realistic three-event transformation
`root -> moving -> tail -> if/else` to `root -> tail -> if/else`, with `moving` placed in the first
`SUBSTACK`, then moves that healed outer tail to the bottom of a populated second C-slot. In the live in-app
browser both isolated transactions reached their recorded endpoint; the preceding 34-step matrix also ran
backward, forward, across repeated nested-input timeline seeks, through a full Rewind, persisted reload and
natural-pointer 4x Play without restoration. The complete Studio gate passes 64 suites / 491 tests and the
production build succeeds.

### Final-frame connection snapping and typing-hidden pointer — 26 August 2026

Connected flyout and existing-block drags now share one scoped Blockly snap gate. Blockly's ordinary and
connecting snap radii remain zero throughout generated travel and are restored only for the final path frame,
after which both flyout and existing-block drivers use the same exact recorded-target correction to acquire the
intended insertion marker. This final correction matters for close nested reporter targets: one enabled travel
frame alone can identify a neighbouring connection without giving Blockly enough geometry updates to settle on
the recorded one. Existing-block pickup still establishes Blockly's genuine source-gap preview before the gate
closes, so source healing and gap presentation remain native. The gate restores both original radii on success,
cancellation and failure; top-level coordinate drags are unchanged.

Simulated text entry now places the shared Play pointer in a durable hidden-until-movement state. Completing,
cancelling or retiring a typing transaction cannot flash the stationary cursor back over an input, and resuming
the same pointer does not reveal it early. Stationary press/click calls remain hidden. The first pointer frame
whose coordinates genuinely change reveals the existing overlay immediately before moving it; a sequence that
ends after typing stays invisible until its normal idle retirement removes it.

The live in-app connection matrix played from 33 through the final nested reorder and reached the exact
`37/37` endpoint without restoration. A separate persisted variable-dialog take replayed at 0.5x: the pointer
remained at opacity zero throughout text entry and the following stationary interval, reappeared only as its
next journey began, reached `1/1`, and retired normally. Focused cancellation tests prove snap-radius cleanup,
and pointer controller, overlay and sequence-resume tests cover the hidden state. The complete Studio gate
passes 64 suites / 495 tests and the production build succeeds.

### Semantic shadow identity across full-sequence Play — 26 August 2026

The original 13-step mixed connection take exposed a distinction that an isolated final-step replay could not:
Scratch Blocks regenerates an ID when the same ID is present in its flyout, while the VM can retain the recorded
ID. Later input restoration can also create a shadow implicitly, without a matching explicit create event in the
next transaction. Semantic replay now captures both workspace and VM aliases before any transaction event moves
or detaches a participant, preferring the block at the recorded directional source location and falling back to
the durable block reference. Explicit creates additionally report their complete recorded-to-live descendant map.
Those aliases remain scoped to the transaction and are supplied to later events and topology verification; no
project-wide ID rewrite or block-type special case is involved.

This also fixes the paired outgoing-shadow failure. A reporter replacement can detach the old shadow before its
delete event runs, at which point its parent path is no longer available. The replay port now resolves the exiting
shadow's workspace and VM identities from its source input at transaction start, so the later delete removes the
correct VM primitive instead of leaving an unexpected top-level orphan.

The persisted `verified-snapshot-8bc48ee41` take was run from `0 -> 13` at 4x in the real in-app editor and reached
`played · 13 steps (34 events) · position 13/13`; the same live tab then completed `13 -> 0` as
`rewound · position 0/13`. This is the full sequence that previously restored at step 13 or ended with an extra
canonical block, not an isolated-step substitute. Regression coverage includes regenerated create descendants,
surviving semantic moves, separate workspace/VM aliases and an exiting shadow resolved before detach.

### Session-wide semantic create aliases — 26 August 2026

The semantic action adapter now returns the alias maps produced by low-level block creation instead of
discarding them at its wrapper boundary. The session can therefore merge regenerated workspace and VM child
identities into the active replay context before later actions and topology verification consume them. This is
one general transaction contract for command, reporter, Boolean and shadow descendants; it does not special-case
block types or rewrite the persisted journal. Focused adapter/session tests cover the returned maps and their use
by following actions. Commit `02ee1ae71` is the independently reviewable checkpoint.

### Persisted per-transaction pause timing — 26 August 2026

Each recorded transaction can now carry optional presentation metadata `presentation.pauseAfterMs`. The value is
bounded from 0 through 30000 ms, survives journal serialization and deliberately does not change the semantic
project head. Blank means automatic pacing, while explicit zero suppresses the inter-transaction pause. The
timeline panel exposes the selected transaction's value as a TurboWarp-theme-aware `Pause after` number control
and persists edits immediately as the input changes. This avoids relying on a deferred browser `change` event,
which live testing proved unreliable in the embedded editor.

Forward and backward timeline playback apply the authored pause after the transaction that just completed and
divide it by the selected speed. Realistic Play uses the same authored value in place of its default 300 ms
inter-transaction pause. Render and dialogue settlement frames are unchanged: they remain correctness barriers,
not editable dramatic timing. Explicit programmatic `stepDelayMs` still retains its prior exact override
semantics for deterministic tests and callers.

The complete Studio gate passes 64 suites / 504 tests, focused source lint is clean, `git diff --check` is clean
and the production build succeeds. Real in-app verification used the persisted
`verified-snapshot-8bc48ee41` take on bundle `234fc85e86e4`. A 3000 ms pause authored after transaction 12
survived a full editor reload. Playing range `11 -> 13` at 1x took 3777 ms with that pause and 954 ms after
keyboard-clearing it back to automatic pacing, a measured 2823 ms difference after browser/animation overhead.
The active handoff tab is the sole editor tab, uses cache label `1f5045034`, and is rewound to position `0/13`.

### Native attached block-comment lifecycle — 26 August 2026

Realistic Play now covers the complete attached block-comment lifecycle rather than falling back to semantic
mutation after creation. The planner recognizes text, exact width/height changes, minimize/restore and coordinate
moves as distinct presentation intents. The driver resolves the durable block/comment identity, then uses
Scratch's rendered context-menu item, textarea, minimize arrow, resize handle or top bar as appropriate. Resize
and move are genuine held mouse gestures; release targets the live control and bubbles through Blockly's normal
document cleanup path. This matters because `ScratchBubble` emits its grouped resize `CommentChange` from the
handle's own mouse-up listener, not from the global drag cleanup.

Verification requires the matching observed Blockly event and the final live owner, text, size, minimized state
or coordinate. It will not accept visual motion which mutated the wrong comment, an event-only result with stale
workspace state, or a reused comment ID attached to another block. Ordinary Undo/Redo remains the fast semantic
history path; these native controls are used by full Play.

The permanent Chromium journey in `test/integration/studio-block-comments.test.js` authors eight real boundaries:
add a block, add its comment, type text, resize, minimize, restore, move and delete. It inspects the captured event
shapes, rewinds to zero, completes 4x Play, reloads from the persisted base and completes 4x Play again. The test
uses real Scratch Blocks DOM listeners over multiple animation frames; this also avoids Selenium 3's unreliable
headless SVG button-hold endpoint while still exercising the browser implementation rather than a unit mock.

### Native workspace-comment lifecycle — 26 August 2026

Workspace comments now use the same verified realistic-Play contract without pretending that they belong to a
block. Creation moves the natural pointer to the recorded workspace coordinate, opens Scratch Blocks' real
workspace context menu and selects `Add Comment` while preserving the recorded comment ID. Text, size,
minimize/restore and position changes use the rendered textarea, resize handle, arrow and movable top bar; delete
uses the rendered delete control. Workspace coordinates are converted through the live injection bounds, origin
offset and scale, so zoom and camera state do not turn a recorded workspace point into a screen-space guess.

The planner requires Scratch's genuine default empty 200x200 comment state before offering native creation;
non-default or API-created initial state remains an honest semantic fallback. Verification requires both the
matching Blockly event and the live unowned comment's text, size, minimized state or coordinate. A reused ID on an
attached block is rejected.

Live authoring exposed an important Scratch Blocks quirk: restoring a minimized workspace comment emits the real
minimized-state change and then a second width/height `CommentChange` even though old and new sizes are identical.
Studio now drops semantically null comment changes both during capture and when normalizing persisted journals.
That keeps one restore click as one timeline action and repairs takes recorded by the earlier build.

The permanent Chromium suite now contains independent attached- and workspace-comment journeys. The seven-step
workspace take creates, types, resizes, minimizes, restores, moves and deletes through real controls, then proves
Rewind, 4x Play, reload and a second 4x Play. Together the two journeys pass all fifteen comment boundaries without
restoration, state mismatch or phantom history steps. The complete Studio gate passes 64 suites / 520 tests;
focused source lint and `git diff --check` are clean, and the production build succeeds.

### Target-relative styled vector and bitmap Brush replay — verified 26 August 2026

Forward realistic Play now reproduces a bounded Scratch Paint vector or bitmap Brush gesture through the editor that
authored it. The Paint wrapper annotates Scratch Paint's rendered Brush role-button and Paper canvas at runtime,
captures only a genuine selected-Brush mouse gesture, and attaches that one-shot source to the immediately
following `updateSvg` or `updateBitmap` project operation. A gesture is normalized to the live canvas, capped at
600 points and ten seconds, and stored beside the exact before/after costume identities. The compact style contract
stores only the settings the Brush actually uses: size and fill colour. Every paint update without a genuine Brush
source remains on the existing exact semantic path.

The realistic driver resolves the durable sprite or Stage, opens Costumes/Backdrops, selects the exact asset and
Brush only when necessary, restores a changed size and colour through Scratch Paint's visible inputs and colour
picker, moves the shared natural pointer to the recorded canvas start, and dispatches the recorded mouse path into
Paper.js. Presentation interpolation is deliberately separate from authored input:
additional overlay frames make the pointer motion legible, but Paper receives only the original recorded points.
The verifier requires the exact SVG asset or decoded bitmap pixels, completed pointer travel, visible controls, an
unchanged journal and the canonical endpoint hash. The transaction executor then settles to the recorded checkpoint,
so a visually identical bitmap with different PNG serialization cannot leak a divergent asset identity into the
timeline. Ordinary Undo/Redo remains the fast semantic history route.

Real in-app-browser testing caught two defects hidden by the initial unit model. Scratch Paint renders its Brush as
a `span[role=button]`, not necessarily a `button`, and rounding normalized points to five decimal places moved a
reconstructed event by roughly 0.002 pixels. That sub-pixel difference was enough to change Paper.js geometry and
the SVG asset ID. The runtime target accepts role-buttons and captured coordinates now retain full floating-point
precision; a focused regression reconstructs the original browser pixels at twelve decimal places.

The styled/bitmap extension exposed three more browser-only details and now has explicit guards for each. Scratch
Paint portals its colour picker outside the editor root, synthetic clicks do not perform the browser's default focus
action, and `updateBitmap` can return before the costume asset changes. Studio observes the document-level picker,
focuses buffered inputs, leaves one render frame before blur, and waits for the asynchronous bitmap asset transition.
Bitmap evidence additionally compares decoded checkpoint pixels; byte identity remains a fast path but is not used as
a false proxy for visual identity.

The final live vector and bitmap takes each recorded one genuine four-segment canvas drag as one `costume-edit`
transaction with five bounded points and a non-default size/colour. Rewind followed by 4x Play restored deliberately
changed controls and reproduced the canonical project hash with verified `costume-brush-stroke`,
`recorded-paint-gesture`, `brushStyleMatches` and (for bitmap) `bitmapVisualMatches` evidence. Rewinding to the base,
reloading the editor and playing again produced the same verified endpoints. Focused paint tests pass and the
production build succeeds; the maintained Studio gate passes 67 suites / 550 tests. The permanent Selenium journey is
`test/integration/studio-paint-brush-gesture.test.js`; its local Chrome process could not be started on this host,
so the equivalent browser acceptance was completed in the real in-app editor rather than misreported as a
headless pass.

### Native vector/bitmap conversion through Scratch Paint — verified 26 August 2026

Forward realistic Play now presents deterministic costume and backdrop format conversions through Scratch
Paint's real `Convert to Bitmap` or `Convert to Vector` control. This is not inferred merely from an
`updateBitmap` or `updateSvg` call: the interaction planner requires the recorded previous and edited asset
formats to prove a genuine cross-format transition, rejects Paint gestures on the conversion path, and offers
the presentation only in the forward realistic mode. Ordinary Undo/Redo and reverse timeline traversal retain
the exact checkpoint-backed semantic route.

The Paint wrapper exposes the current editor format and the runtime annotator assigns one language-neutral target
to the live conversion role-button. Play resolves the durable sprite or Stage, opens Costumes/Backdrops, selects
the exact asset, installs an invocation observer before clicking, and waits for both the expected VM method and
the asynchronous asset transition. Verification requires a visible control, completed natural-pointer journey,
unchanged journal and Blockly history, and either the exact recorded asset or decoded bitmap-pixel equality.
The transaction executor then restores the recorded checkpoint and validates the canonical project endpoint.

The initial real-browser pass caught a false unit assumption before commit: Scratch Paint renders the conversion
control as a `role="button"` element rather than an HTML `button`, so the first selector never annotated it. The
runtime and fixture now share the actual rendered role contract. Live costume vector-to-bitmap and
bitmap-to-vector takes each passed Rewind, 4x Play, persisted reload and a second verified 4x Play. A separate
Stage take recorded and replayed `backdrop-convert-to-bitmap`, including a pointer journey from the Stage selector
to the conversion control. All three reached exact canonical hashes; bitmap cases also produced
`bitmapVisualMatches: true`. The permanent browser journey now contains five cases, focused lint and
`git diff --check` are clean, the production build succeeds, and the maintained Studio gate passes
67 suites / 553 tests.

### Semantic ordinary history and bounded Paint edit visits — verified 26 August 2026

Ordinary Studio Undo/Redo now always applies the recorded semantic transaction with the existing fast lifecycle
presentation. It no longer attempts a second native Blockly gesture merely because the same transaction is also
eligible for realistic Play. Full tutorial Play retains the pointer-, flyout-, field- and dialogue-driven native
path. This separation keeps Studio's cross-sprite/project history authoritative without replacing Blockly's own
workspace history or exposing native-gesture recovery failures to ordinary editing.

Scratch Paint now owns Ctrl+Z/Ctrl+Shift+Z while its current visit has native Paint history. Each visit starts with
a fresh Paint undo baseline; after that stack is exhausted, the same keys cross the recorded Studio boundary. The
visit is coalesced into one `costume-edit-session` or `backdrop-edit-session` transaction when the user leaves the
editor or changes target. Realistic Play applies that bounded asset update semantically instead of replaying every
internal Paint operation. This intentionally excludes an unbounded recreation of the complete costume editor while
preserving normal Paint editing and reversible project history.

Real in-app-browser journeys covered both a sprite costume and the Stage backdrop: native Paint undo/redo before
exit, one Studio transaction after exit, fresh Paint history on re-entry, boundary-crossing Studio undo/redo, and
exact Rewind/Play endpoints without a virtual pointer for the semantic edit. The maintained Studio gate passes
68 suites / 569 tests, focused source lint and `git diff --check` are clean, and the production build succeeds. The
Selenium copy of the journey could not start because this checkout's bundled ChromeDriver 117 cannot launch the
host's current Chrome; that environment failure is recorded rather than represented as an automated browser pass.

### Native root-into-own-remainder reorder — verified 26 August 2026

The final move in the four-block connection-matrix fixture exposed a real presentation discontinuity: moving the
current top-level root into its own three-block remainder was classified as semantic-only. The first five fixture
transactions therefore used native gestures, while the last one instantly rebuilt topology and made the whole
script appear to jump by exactly one command-block height.

The planner now identifies this top-level case explicitly. At pickup the native driver disconnects only the root
with Blockly events suppressed, leaves the former second block and its descendants stationary, and performs one
real Blockly drag of the detached root into the recorded descendant connection. Nested forms that cannot be
represented by one genuine gesture remain honest semantic fallbacks.

In the rebuilt in-app browser, the final transaction completed with verified `existing-block-drag` evidence and
`splitSourceRoot: true`. The pointer and Blockly gesture remained synchronized over 38 frames, an insertion marker
was visible, the journal and history depths were unchanged, and workspace/VM/canonical project state all matched.
A page-side frame trace showed the stationary remainder fixed at `translate(1420,24)` throughout and the Blockly
canvas transform fixed at `translate(-616.5,80.2) scale(0.675)` apart from floating-point noise. The permanent
connection-matrix journey now asserts this native plan and verified result.
