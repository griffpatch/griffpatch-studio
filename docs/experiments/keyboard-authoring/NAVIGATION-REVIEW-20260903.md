# Keyboard navigation: experience and architecture review

3 September 2026. Review of `experiment/keyboard-authoring`, HEAD `4c275c22b`, implementation checkpoint `9514ef9f8`.

This began as a design proposal and source review. Andy approved implementation on 3 September, with the spatial-caret clarification below. The immutable review on port 8756 and stable Studio remain untouched until a replacement is verified.

## Approved implementation plan and spatial-caret clarification

**Later clarification, 3 September:** Andy rejected horizontal entry/exit through
C mouths. Left/Right now mean inline inputs/reporters on the current command row,
then the deliberate two-press column exit, including from body commands. Up/Down
own statement and C-mouth traversal. The earlier C-mouth portal interpretation
below is historical, not the current contract. `INTERACTION-DESIGN.md` is updated
to this clarified rule.

1. Checkpoint this review, then extract native topology/geometry, spatial policy and key-boundary state into independently testable modules. Keep native Undo and existing local structural traversal.
2. Implement spatial workspace carets and a sticky horizontal boundary: when leaving a script, the first attempted Left/Right crossing stays put and shows a restrained directional cue; a second distinct press in that direction crosses. Auto-repeat cannot confirm. Any different action or focus/context change clears the pending crossing. There is no timeout. **A caret already in free workspace space is exempt: Left/Right change columns immediately.**
3. Follow stable existing columns or propose an adjacent empty column. A free caret moves vertically in coarse workspace-unit steps, stopping at the first encountered script's legal head/tail boundary. Hats and caps select the real block instead of inventing connections. Navigation changes no project data and creates only one provisional caret. Use current geometry without feeding temporary ghost reflow into column decisions.
4. Normalize vertical movement from inputs, make Ctrl/Cmd+Home/End address the outer script, and add Shift+Home/End sibling-range extension. Preserve native text keys and Ctrl/Cmd+Left/Right Finder history.
5. Extend the existing shared Finder/Jump history with optional semantic location capture/restore and per-sprite caret retention. Preserve mouse-only behaviour, native camera ownership, explicit draft cancellation and latest-request-wins focus handoff. Coalesce Finder exploration; fully cancelling it returns to its origin, after the existing first-Escape-clears-query step.
6. Verify units, sequence/invariant cases, real keyboard/mouse browser journeys, dense-workspace geometry cost, and feature-disabled regression checks. Commit reviewable checkpoints and publish a separate immutable replacement only after verification. Leave the current working review available throughout.

Later polish initially remained separate. On 3 September Andy approved the next bounded slice below; a richer sprite/script picker and new page/region shortcuts remain deferred.

### Approved follow-up: height memory, script breadcrumb and two-stage Escape

After the verified Alt+S framing checkpoint `e24abcca5`, implement persistent original selection height across consecutive spatial column crossings, longer native/model sequences, and a compact breadcrumb as an independent addon. It should also follow ordinary mouse editing and Finder, show the sprite thumbnail/name, and pin the active script title when its head leaves the viewport, inspired by Andy's tutorial overlays. Preserve the two-press column-exit/free-space exception. Add a separate two-distinct-press Escape confirmation at the structural surface; existing cancellation inside text/completion/menus/dialogs keeps priority and does not count towards exit.

Keep the 8764 review and earlier edited projects intact during verification. Reuse the existing shared navigation owner and native UI/model events. No native Undo replacement, stable Studio changes, automatic layout changes, extra region shortcuts or upstream deployment are part of this slice. Exact verification/publication results belong in `REVIEW.md`.

### Approved maintenance follow-through

After clickable breadcrumbs, Andy approved a bounded consolidation of keyboard
ownership and deferred focus, followed by complete Keyboard and feature-disabled
Studio browser gates. This is maintenance of the agreed interaction model, not a
new navigation redesign. The review retained the existing structural/spatial
policy modules, the key-session boundary, `selectPosition` effects and the shared
Finder history. Only duplicated DOM-owner classification and the demonstrated
stale native-field return were extracted/corrected. Findings, baseline comparison,
native closing-animation behaviour and test-maintenance rationale are recorded in
[Navigation maintenance](NAVIGATION-MAINTENANCE-20260903.md). Final published
artifact and gate results remain in `REVIEW.md`.

### Implementation checkpoint: structural and spatial navigation

Steps 1–4 are implemented as the first reviewable slice. Native topology/row geometry, spatial column policy, semantic location helpers, and the small deliberate-crossing session now have separate modules. The existing `navigation.js` remains the structural-policy facade, preserving its callers. The controller applies navigation effects; native editing and Undo have not been replaced.

Fresh development verification: **23 real-Chrome navigation cases**, **1,393 unit/regression tests across 115 suites**, changed-source lint, and diff checks pass. The browser test caught repeated keydowns without `event.repeat`; a tracked keyup boundary now protects the crossing regardless of that flag. Updated assertions retain real input actions and compare complete native IDs, including commas, rather than parsing IDs from an ambiguous delimiter. Native XML and Undo counts remain unchanged during the new spatial journeys. Head insertion, free-space column reversal, native hat acceptance/Undo/Redo, C-mouth scopes, sibling Home/End ranges and outer-script Home/End are exercised.

The native 200-command benchmark measures **41,000 → 400 `getHeightWidth()` calls per key sample** between the previous immutable 8756 build and this development candidate. Both run the same actual held-arrow sequence in isolated Chrome. Excluding the first sample, key-to-frame means were approximately **18.7 → 14.7 ms**; six samples are evidence of reduced work, not a universal latency guarantee. The old build deliberately fails the new 800-call work bound. Its server was initially unavailable and was restarted from the unchanged immutable directory after checking its recorded SHA256; no review files were rebuilt.

**At that checkpoint, still next:** step 5, shared Finder/Jump semantic history and per-sprite return, implemented in the second slice below. The first extraction did not add a revision-scoped navigation snapshot cache, retain a vertical lane across unequal-height selected blocks, or change Finder cancellation. These were not implied by the passing structural gate.

Publication verification: implementation `5a3c5eefa`, immutable `.tmp/keyboard-authoring-review-5a3c5eefa-dev` on port 8759, passes **23/23 focused navigation**, **53/53 Keyboard core** and **29/29 Studio browser regressions**. The dense benchmark now reaches its imported root with Tab/Home instead of clicking a source SVG displaced by the initial caret preview; the final artifact retains the 400-call bound. See `REVIEW.md` for hashes, inspected screenshots and the separately retained, unpromoted production-format probe. Step 5 was explicitly left for the second checkpoint rather than silently considered complete here.

### Second implementation slice: shared return locations

Step 5 is implemented in `15ef6e212`, with the separately reviewable refocused-search guard in `0f7a853de`. `navigation-history.js` is the single per-VM owner used by Finder and Jump. It replaces the old module-global viewport arrays and per-client scrolling flags rather than introducing a Keyboard-only history. Entries contain target ID, native camera offset/scale and an optional serializable host payload. `navigation-memory.js` captures and resolves Keyboard block, input, field, gap, range and workspace locations using native identities. The shared addon has no dependency on the Keyboard controller or its presentation.

Back/Forward refresh the departure location after ordinary local arrow movement without recording every arrow as a journey. Finder previews retain one origin and accepted destination. Enter commits that exploration; first Escape still clears the query, and the next Escape restores the origin without altering the existing forward branch. Deleted sprites are skipped; deleted selected blocks recover through saved local native boundaries or their former workspace point. File/New and project load clear history and caret memory.

Per-sprite caret retention is distinct from Back/Forward. Switching a sprite or returning from Costumes restores its semantic location after the GUI finishes loading native XML and camera state. The sprite picker keeps DOM focus. Clicking Code explicitly resumes keyboard input. An explicit mode-off stays off; visiting another editor panel only suspends ownership. The existing native Undo, camera storage and Finder result ordering remain authoritative.

One optional GUI `workspaceUpdated()` presentation callback is invoked after native XML, camera and Undo initialization. This avoids guessing when a sprite is ready. A shared request token prevents late scrolls/focus from overriding a newer click, result or return. The existing Finder handoff retains a narrowly scoped grant while a sprite rebuild temporarily leaves page focus, so rapid F3/Ctrl+G can continue; native text fields, dialogs and sprite controls are not commandeered. Modifier-only keydowns do not cancel that grant or an in-flight Back/Forward journey.

Browser testing found and fixed two real handoff gaps: Code after Costumes could restore the correct caret but not typing focus, and rapid F3 could lose its second press during a cross-sprite rebuild. It also exposed two test assumptions: remembered mode requires an explicit Code click before fixture typing, and an interrupted intermediate preview is not necessarily a completed visit to remember. The fixtures now distinguish those cases and assert completed operand visits and rapid latest-result behavior separately. The Finder lane now includes the `Find Bar`-named variants previously missed by `/finder/` alone. Final artifact verification is recorded in `REVIEW.md`.

Deliberate limits: locations are session/project-local, not persisted recordings; unfinished text drafts are cancelled rather than stored per sprite; absent semantic hosts retain viewport-only navigation. This slice does not add the deferred revision cache, preferred vertical lane, script/sprite picker or extra shortcuts. Ordinary Scratch may still clear its own Undo stack when changing sprites; navigation does not replace that native policy.

Two bounded presentation fixes accompany this slice. The shared scroll animator now removes its capturing scrollbar listeners with the same capture flag used to register them; six adapter/lifecycle tests protect completion, cancellation and superseding animations. Andy's first-press Right chevron now sits 6 CSS pixels beyond the complete native command row, including its nested inputs and trailing labels, not merely beyond the selected operand. It reuses the topology's row identity and displayed native path, without scanning the whole workspace or measuring the following tail. The browser reproduction measured the old chevron 33 pixels inside the enclosing command; the corrected case also covers a wider following row and zoom.

Publication verification: the exact immutable `0f7a853de` artifact on 8762 passes 56 core, 18 Finder and 24 navigation browser cases; these lanes overlap. Source tests pass 1,431/1,431 across 118 suites. The complete 29-case feature-disabled Studio gate passed on the immediately preceding `15ef6e212` artifact, before the narrow search-refocus correction. The new in-app review visibly demonstrates the row-edge chevron. Andy's edited 8759 project remains in its original tab because export could not be verified; no original tab or review server was discarded. Full artifact hashes, logs and limits are in `REVIEW.md`.

## Original review verdict and findings

The following preserves the initial pre-implementation review. Its source references, missing-feature findings and initial test counts are historical; the implementation checkpoints above and current `REVIEW.md` supersede them.

The structural foundation is good. Semantic block/input/connection positions, native Blockly operations, input-first acceptance, and separate presentation code are the right ingredients. We should not restart or replace native Undo.

However, the experience is not yet a fully coherent project-navigation system. It has grown through useful local improvements. Boundaries between structural movement, spatial movement, text editing, Finder, and sprite changes now deserve an explicit shared design before more shortcuts are added.

Most importantly, **navigation history already exists**. Finder and Jump to Definition share a viewport-history utility. My initial description of history as missing was too broad. The opportunity is to extend and integrate this existing facility, not add a competing history stack inside Keyboard Authoring.

## 1. Establish the model before refactoring

There are four distinct locations:

1. A text caret in an actual input/editor.
2. A structural selection: block, operand, field, C mouth, or insertion boundary.
3. A spatial location among scripts in the current sprite.
4. A project location: sprite/Stage plus script and structural position.

These should cooperate without pretending to be the same thing. Plain arrows should never unexpectedly switch sprites. A navigation return must not undo an edit. Moving the camera alone must not silently change the editing selection.

The existing Up/Down-for-statements and Left/Right-for-inline-structure distinction is sound. Modern Blockly also uses a structural cursor with vertical line navigation and horizontal inline navigation. Its precise shortcuts differ from ours; this is supporting evidence for the model, not a reason to transplant its implementation into this older Scratch fork. [Blockly keyboard navigation](https://docs.blockly.com/guides/configure/keyboard-nav/)

### Proposed key contract

These are recommendations, not newly implemented bindings. Structural rules apply only while the structural surface owns focus; real text editors, menus, composition, and dialogs retain their own keys.

| Key/context | Current behaviour | Recommendation |
| --- | --- | --- |
| Up/Down | Command rows, nested bodies, empty mouths/tails, then same-column scripts | Keep. Normalize input positions to their command before applying the same boundary rules. |
| Up at a hatless script head | First Up opens insertion above; second Up visits the script above | Keep, including when another script is already above. Never invent a connector on a hat or reporter. |
| Down at the end of a column | End insertion, then new-script placeholder when appropriate | Keep. Reverse navigation must return to the originating boundary. |
| Left/Right | Inputs, nested reporters and C-mouth entry/exit; spatial neighbors at eligible outer edges | Structure first. Crossing out of a script requires two distinct presses; then visit an existing column or a provisional new-script caret. No traversal through statement connectors. |
| Arrow from a free workspace caret | Falls through to the first navigation stop | Left/Right change columns immediately, without the two-press rule. Up/Down take coarse spatial steps and stop at encountered legal script boundaries. |
| Home/End | Beginning/end of the current sibling statement chain; nested C bodies are separate scopes | Keep this explicit scope. End may be a legal insertion point; a cap stays a cap. Show the scope clearly. |
| Ctrl/Cmd+Home/End | Not assigned by Keyboard Authoring | Propose outermost current script head/tail. Do not unexpectedly switch sprite. Native text meaning still wins in inputs. |
| Tab/Shift+Tab | Linear structural traversal, skipping occupied insertion gaps and duplicate shadow wrappers | Keep the productive authoring traversal. Specify script order instead of inheriting an incidental native sort. |
| Enter/Shift+Enter on command | Insert below/above | Keep. Typing on a whole selected block remains transformation, not implicit insertion. |
| Enter on reporter/value | Enter operands or edit the value | Keep input-first acceptance; preserve native field editing where explicitly requested. |
| Tab in composer | Complete a suggestion's text; accept a literal and advance | Keep distinct from structural Tab and preserve browser text Undo. |
| Up/Down in composer | Suggestions; an only-literal result can be accepted and leave vertically | Retain for now, but make the single-literal exception explicit in help/tests. It is a context-sensitive shortcut, not ordinary structural movement. |
| Shift+Up/Down | Extend/shrink a contiguous sibling selection | Keep, bounded by the current chain/body. Do not accidentally span scripts. |
| Shift+Home/End | Currently ordinary navigation, not range extension | Add selection to the current chain boundary once the scope contract is settled. |
| Alt+Up/Down | Move selected commands/range | Keep as an edit, with native grouped Undo, separate from navigation. |
| Ctrl/Cmd+Left/Right | Finder viewport Back/Forward | Preserve these existing commands and enhance their destination information. Do not reassign them to spatial script movement. |
| Ctrl/Cmd+Enter; F3/Shift+F3 | Explore definition/usages; next/previous Finder result | Keep the existing Finder implementation and handoff. Ctrl/Cmd+G aliases remain. |
| F2 | Edit selected literal/menu, rename selected identity, or edit custom definition | Keep selected-item semantics and reliable dialog return. |
| Escape | Cancel composer/dialog; structural Escape disables Keyboard; Finder clears query then closes | Preserve cancellation and a reliable exit. Retain location when leaving Keyboard. Consider collapsing a range before exiting as a separate UX decision. |
| Delete/Backspace | Distinct structural deletion/recovery; native text editing when appropriate | Keep. Deletion recovery and navigation history must share semantic identity rules but not an undo stack. |
| Page keys / explicit next-script command | No general Keyboard contract | Lower priority. Define the commands first, then select bindings after checking browser, addon, and OS conflicts. |

Home/End have no universally obvious meaning in a two-dimensional nested program. Our current branch-local interpretation is defensible, but it needs an explicit outer-script command and a visible sense of scope. I would not change it silently to a different interpretation.

### Spatial navigation should be forgiving, not magical

Use the real selected silhouette, including its whole height, when finding a horizontal neighbor. Prefer overlap in height, then proximity; avoid large diagonal jumps. Keep a consistent intended height across consecutive spatial moves rather than progressively drifting through staggered columns. Reset that preference after a local structural move or deliberate mouse selection.

Use one shared notion of columns for Up/Down and script ordering, with deterministic tie-breaking. Native root ordering currently uses a shallow diagonal scan; it is not a column-by-column authoring order. Overlapping or ragged scripts cannot have an objectively perfect neighbor in every direction. At a confirmed horizontal script exit, use the nearest plausible candidate or a free caret in the adjacent column. Do not rearrange scripts merely to make navigation possible.

An opposite arrow need not retrace every prior operand. **Back** is the command that should return to the exact prior editing location.

## 2. Build on existing Finder history

### What is already present

- Finder handles Ctrl/Cmd+Left and Right with `navigationHistory.goBack()` / `goForward()`.
- Jump to Definition imports the same `Utils` module. Its module-level `views` and `forward` arrays are intentionally shared.
- The utility records viewport movement around jumps and tracks scrolling. Entries contain `left` and `top` only. Despite one comment mentioning zoom, `storeView()` does not save scale.
- Finder's carousel workspace-change handler clears history when it detects a sprite change.
- Keyboard Authoring has a separate, carefully guarded **pending focus handoff**, not a Back/Forward history. It rejects stale or unrelated Finder completions.
- Normal keyboard context reset clears the structural position and disables Keyboard mode. The GUI separately saves/restores per-target scroll and scale.

Evidence: [Finder keys](D:/dev/twstudio/scratch-gui/src/addons/addons/find-bar/userscript.js:542), [shared history](D:/dev/twstudio/scratch-gui/src/addons/addons/find-bar/blockly/Utils.js:6), [stored entry](D:/dev/twstudio/scratch-gui/src/addons/addons/find-bar/blockly/Utils.js:338), [sprite-switch clearing](D:/dev/twstudio/scratch-gui/src/addons/addons/find-bar/userscript.js:1945), [Jump to Definition reuse](D:/dev/twstudio/scratch-gui/src/addons/addons/jump-to-def/userscript.js:1), [Keyboard context reset](D:/dev/twstudio/scratch-gui/src/experiments/keyboard-authoring/controller.js:1586), [existing camera restoration](D:/dev/twstudio/scratch-gui/src/containers/blocks.jsx:529).

### The missing integration

Extend the existing shared history to support semantic destinations alongside view-only entries. A semantic destination needs a project-generation identity, target ID, block/input/field or insertion-boundary reference, and optional camera context. Resolve native objects only when returning; do not retain live block/SVG references across sprite rebuilds.

The history utility should accept a small optional host adapter for capturing/restoring semantic focus. Keyboard Authoring can provide it, while the addon continues to work independently. Keep shared code in the common addon layer, not imported from the experiment. This also respects future cross-porting and upstream synchronization.

Use the existing GUI per-sprite camera ownership rather than maintain a rival camera store. Restore the saved frame, then minimally reveal a target if edits/layout changes require it. Back must restore the **operand**, not merely scroll near its block.

Keep two concepts separate:

- **Last place in each sprite:** switching A → B → A resumes A's last committed structural position, with Keyboard preference preserved. The sprite picker retains focus while the user is still choosing; returning to Code restores editing focus.
- **Back/Forward journey:** following a definition or crossing to another sprite records a meaningful departure. Back returns to that exact place, including within the same sprite. It must not require stepping through every arrow, scroll frame, or transient result preview.

VS Code explicitly supports navigation across edit locations and displays a location hierarchy; IntelliJ also distinguishes navigation Back/Forward from returning to the last edit. Those are the useful IDE concepts to adapt, not every desktop key binding. [VS Code navigation](https://code.visualstudio.com/docs/editing/editingevolved), [IntelliJ navigation](https://www.jetbrains.com/help/idea/navigating-through-the-source-code.html)

Recommended safety rules:

- Never silently commit an unfinished draft when leaving. Preserve the existing cancel policy initially; retained per-sprite drafts are a separate feature.
- Coalesce exploration: one origin for a Finder browsing session, not one history stop per highlighted result. Enter commits the chosen destination.
- Consider restoring the origin when a Finder session is fully cancelled, while preserving its first-Escape-clears-query behaviour. This would change current semantics and should be agreed before implementation.
- A deleted destination falls back to its surviving owning input/body or local chain, then that sprite's remembered frame. A deleted sprite is skipped. File/New or project load clears the appropriate project generation.
- The latest request wins. A late animation, timer, modal, or sprite-load callback cannot pull focus back after the user has moved elsewhere.
- Ordinary mouse-only users must keep view-history behaviour when the keyboard adapter is absent.

An explicit sprite/Stage picker and a script outline/filter in the existing Finder would be useful later. Reuse its project index and native IDs, rather than add another competing search system.

## 3. Focus, discoverability, and visual polish

A compact context hint could say `Sprite1 > when flag clicked > repeat > then`, with only the relevant branch/input emphasized. It should help explain scope without adding a permanently busy toolbar. A faint inactive selection can mark where editing will resume while Finder or a dialog owns focus; it must not look like two active carets.

Provide a discoverable route between Code, Finder, sprite selection, and other controls. Structural Tab is intentionally an authoring feature, so it cannot also be the only route out. Preserve Escape/Alt+K and expose an accessible return-to-Code action; decide any region-cycling shortcut only after host testing.

WAI guidance distinguishes focus from selection, recommends predictable focus restoration, and warns against shortcuts replacing ordinary keyboard access. Our application surface and live announcements are useful but do not, by themselves, demonstrate screen-reader accessibility. [WAI keyboard-interface guidance](https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/)

Do not let hover, minimap panning, passive ghost reflow, or scrolling change the semantic selection. Reveal a destination before interaction and avoid recentring on every key. Page/viewport movement deserves its own command rather than overloading the structural arrows further.

## 4. Source review: strengths and concrete findings

### Keep these foundations

- `navigation.js` uses semantic locations rather than cursor pixels. Default shadows resolve to their input owner, avoiding duplicate Tab stops and surviving shadow recreation.
- Native connection topology controls legal insertion. C bodies and ordinary continuation have distinct ownership metadata.
- Range selection/movement, focus handoff, viewport calculations, and edit operations already have independent modules and tests.
- Native field text handling and Undo are not replaced by a parallel keyboard history engine.
- Finder handoff validates request, target, and live block identity before restoring structural focus.

### Findings, ordered by impact on this review

1. **Project return is incomplete, not absent.** Existing view history cannot restore a selected input or target because it does not store them. A normal context reset forgets Keyboard's location. Extend the existing owner as described above.
2. **Free-caret directional movement loses its spatial meaning.** In `navigate()`, a workspace position without `sourcePosition` reaches the unmatched-position fallback. A model probe placed it beside a right-hand script; Up, Down, Left, Right, and Tab all selected the first script. This is confirmed pure-model behaviour, not a newly observed browser reproduction. [Workspace fallback](D:/dev/twstudio/scratch-gui/src/experiments/keyboard-authoring/navigation.js:341)
3. **Root boundary behaviour depends on whether its input or its whole block is selected.** The head-placeholder condition requires `current === anchor`. With an upper script present, Up from a lower root's operand jumps to the upper tail, while Up from the lower whole block opens its head placeholder. The model probe confirms this inconsistency. Decide one command-row normalization rule. [Vertical movement](D:/dev/twstudio/scratch-gui/src/experiments/keyboard-authoring/navigation.js:398)
4. **Geometry collection does unnecessary repeated tail traversal.** `blockBounds()` first calls `nativeBounds()`, which calls `getHeightWidth()` even when a direct SVG silhouette is available. This bundled native method recursively measures all following blocks. For one long chain, collecting every block's bounds therefore performs quadratic recursive sizing work. A call-count model using that native recursion produced 20,300 sizing calls for 200 blocks and 501,500 for 1,000 blocks. This is not a browser timing measurement. Prefer direct row geometry and calculate full-script bounds once per snapshot; benchmark native browser latency before/after. [Bounds adapter](D:/dev/twstudio/scratch-gui/src/experiments/keyboard-authoring/navigation.js:8), [native recursion](D:/dev/twstudio/scratch-gui/node_modules/scratch-blocks/core/block_render_svg_vertical.js:613)
5. **Navigation dispatch and presentation coordination are too concentrated.** The controller is 1,929 lines and the navigation module 512. Size alone is not the fault: key interpretation, focus ownership, draft acceptance, range edits, geometry, and context resets meet in the same closure. `navigationStops()` is rebuilt in reconciliation and again in key routing, while `navigate()` repeatedly filters the same flattened snapshot. A revision-scoped topology index can simplify both reasoning and cost. [Reconciliation](D:/dev/twstudio/scratch-gui/src/experiments/keyboard-authoring/controller.js:229), [routing](D:/dev/twstudio/scratch-gui/src/experiments/keyboard-authoring/controller.js:1215)
6. **The written contract has drifted.** Earlier paragraphs still say arrows stop at script ends and Up stays on the first block, despite later spatial-navigation changes. Keep the historical review log, but replace contradictory active design rules with a single current matrix. [Older rules](D:/dev/twstudio/scratch-gui/docs/experiments/keyboard-authoring/INTERACTION-DESIGN.md:73)

Additional audit target, not a reproduced failure: shared history arrays coexist with per-`Utils` scroll-suppression flags and a first-installer-only workspace hook. Finder and Jump to Definition each construct a utility instance. Before extending this code, test ownership and lifecycle under both addon load orders, disable/re-enable, cancelled scrolling, and workspace replacement. Shared storage alone does not guarantee shared coordination.

### A proportionate architecture

Use a thin command pipeline:

`key + focus context → named intent → pure navigation policy → destination/effects → native focus and presentation`

Keep these responsibilities independently testable:

- Native topology adapter: canonical nodes, parents, bodies, sibling chains, stable keys, and separately versioned geometry.
- Structural policy: inline traversal, statement rows, Home/End, Tab and insertion boundaries.
- Spatial policy: script order, column neighbors, full-selection height and tie-breaking.
- Existing shared history: view/semantic destinations, per-target return, and request cancellation through host adapters.
- Input ownership/keymap: structural surface versus text, completion, Finder, native dropdown/dialog, drag, or suspended context.
- Effect coordinator: focus, reveal, announcements, and ghost presentation. Editing commands continue through existing native operation modules.

This is an incremental extraction, not a generic graph framework or full rewrite. Preserve behaviour with characterization tests first, then change only the explicitly agreed transitions. Do not introduce new framework hooks unless an identified lifecycle boundary cannot be expressed safely through the current integrations.

## 5. Verification and next steps

Freshly run in this review: **170 passing tests across 10 suites**. These cover navigation, handoff, sibling range, viewport, wrapping-history focus, F2, and the four Finder suites. Two additional in-memory behavioural probes and one sizing-call-count probe are described above. No new real-browser navigation run, screen-reader trial, or performance timing was performed. Earlier review notes record a broader browser gate, but that is not fresh evidence from this review.

The passing count is not proof that the UX contract is complete. The new probes found meaningful gaps without any existing test failing. The Finder suites exercise destination resolution, result keys, and scrolling, but the inspected unit/integration sources contain no direct tests of the viewport history's Back/Forward methods.

Recommended order:

1. Agree the key/scope matrix and return semantics, particularly Finder cancellation and sprite focus ownership. Keep the existing productive keys.
2. Add sequence and invariant tests, then extract structural/spatial/key ownership policies without changing behaviour. Fix free-caret and normalized-head-boundary behaviour as named changes.
3. Extend the existing Finder/Jump history with a Keyboard semantic-location adapter and per-sprite return. Add native browser tests for A → B → A, definition → Back, operand return, manual interruptions, and stale async results.
4. Remove repeated geometry work and profile long single stacks, many short stacks, nested C blocks, and wide reporters using held keys in a real browser.
5. Add small orientation aids, explicit script/sprite picking, and boundary selection shortcuts after the core is stable.

Test contracts should include: no model/XML/Undo change from navigation; every result resolves or is a legal workspace caret; consistent shadow ownership; no impossible hat/cap connections; branch-local ranges; translation/zoom-invariant spatial choices; stable repeated/reverse boundary sequences; deletion/Undo recovery; correct text and IME ownership; no unintended sprite switches; and one settled focus owner after dialogs/Finder/drag. Generate bounded legal topology/layout combinations, and pair them with a small set of real mouse/keyboard journeys. Do not replace browser checks with mock-only confidence or remove tests merely because the count is high.
