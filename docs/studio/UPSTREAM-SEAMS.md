# Upstream seam register

Upstream base: `TurboWarp/scratch-gui@a2946eeb9a9dca7857d7ab53d766b54288c7a2ff`  
Last full verification: 26 August 2026

All changes outside the owned paths below require a row in the seam table and a focused contract test.

## Owned paths

- `src/studio/**`
- `test/studio/**`
- `docs/studio/**`

## Modified upstream-owned files

| ID | Repository | File and symbol | Hook contract | Why required | Contract test | Fallback | Last verified |
|---|---|---|---|---|---|---|---|
| GUI-001 | `TurboWarp/scratch-gui` | `src/containers/blocks.jsx`: `attachVM`, `detachVM`, `onWorkspaceUpdate` | Attach one query-flagged Studio session beside `vm.blockListener`; pause it during workspace XML reload; detach before workspace disposal | Capture complete live block events with target context without changing VM or Scratch Blocks | `test/studio/block-workspace-port.test.js`; `test/studio/studio-block-session.test.js`; production build | Without `?studio-capture=1` or `?studio-session=1`, the port is inert and normal TurboWarp behaviour remains | 23 August 2026 |
| GUI-002 | `TurboWarp/scratch-gui` | `src/lib/tw-restore-point-api.js`: `createRestorePoint` | Resolve the existing creation promise with its generated restore-point ID | Let Studio reference and restore the exact checkpoint while reusing TurboWarp's project/asset store | `test/studio/restore-point-checkpoint-port.test.js`; production build | Existing callers ignore the resolved value, so non-Studio behaviour is unchanged | 23 August 2026 |
| GUI-003 | `TurboWarp/scratch-gui` | `src/lib/variable-utils.js`: `setVariableValue`, `beginVariableValueEdit`; scalar monitor component/container | Surround direct list assignments and scalar range gestures with an optional Studio callback | Capture list monitor edit/add/remove/import and coalesced non-cloud scalar slider gestures which do not emit Scratch Blocks events | `test/studio/list-value-edit-hook.test.js`; `test/studio/slider-monitor-gesture.test.jsx`; `test/studio/studio-block-session.test.js`; production build | The weakly registered callback is absent outside a query-flagged Studio session; normal assignment and cloud update paths are unchanged | 26 August 2026 |
| GUI-004 | `TurboWarp/scratch-gui` | `src/components/prompt/prompt.jsx`: variable/list prompt controls | Add exact language-neutral `data-studio-target` attributes without changing handlers, labels or layout | Let realistic Play resolve the existing name, scope, cloud, Cancel and OK controls independently of localisation and generated CSS names | `test/studio/prompt-studio-targets.test.js`; `test/studio/native-variable-driver.test.js`; production build | Without realistic Studio Play the attributes are inert; removing the driver restores the upstream dialogue behaviour | 25 August 2026 |
| GUI-005 | `TurboWarp/scratch-gui` | `src/components/custom-procedures/custom-procedures.jsx`: custom-block dialogue controls | Add exact language-neutral `data-studio-target` attributes without changing handlers, labels or layout | Let realistic Play resolve Add Input, Add Boolean, Add Label, warp, Cancel and OK independently of localisation and generated CSS names | `test/studio/custom-procedure-studio-targets.test.js`; `test/studio/native-procedure-driver.test.js`; production build | Outside realistic Studio Play the attributes are inert; removing the driver restores the upstream dialogue behaviour | 25 August 2026 |
| GUI-006 | `TurboWarp/scratch-gui` | action-menu, GUI tabs, library items and sprite-selector components | Add inert language-neutral `data-studio-target`, `data-studio-library-key` and `data-studio-sprite-name` attributes | Let realistic Play resolve live sprite/costume library controls and exact durable asset/sprite identities without CSS classes or translated labels | `test/studio/project-library-studio-targets.test.js`; `test/studio/project-library-driver.test.js`; production build | Attributes do not change handlers or layout; removing the project-library driver leaves normal GUI behaviour unchanged | 25 August 2026 |
| GUI-007 | `TurboWarp/scratch-gui` | `src/containers/blocks.jsx`; `src/components/scratch-blocks-confirm/**` | Route `ScratchBlocks.confirm` through an editor-themed React modal and include its state in the container render filter | Let realistic Play visibly accept Scratch's genuine multi-use variable deletion confirmation without a blocking browser alert | `test/integration/studio-variable-lifecycle.test.js`; production build | Removing the override restores Scratch Blocks' ordinary browser confirmation; non-Studio manual deletion retains the same callback semantics | 26 August 2026 |

## Scratch Blocks native contract (27 August 2026)

The bundled `block-duplicate/module.js` addon now calls optional
`Gesture.setDragOrigin({kind: 'workspace-duplicate', blockId})` before replacing its
actor. This preserves original pickup provenance for cross-sprite copies. Without
the hook the addon's ordinary duplication behaviour is unchanged. The real
Alt-substack share test in `studio-native-complex-authoring.test.js` covers it.

| ID | Files | Contract | Tests |
|---|---|---|---|
| BLOCKS-001 | `core/block_dragger.js`, `workspace.js`, `events.js`, `block_svg.js`, `gesture.js` | Actual pickup identity; tracked drag/snap/bump completion and event-drain callback; normal undo retained | Fork `block_operation_test.js`; GUI capture/settling tests; real mouse-authored four-block regression |
| BLOCKS-002 | `core/gesture.js`, `insertion_marker_manager.js`, `rendered_connection.js`, `connection_db.js` | Optional exact-target native proximity search; real preview before release; default editor behaviour unchanged | Fork connection/marker tests; GUI driver/verifier tests; 43-step browser matrix |
| BLOCKS-003 | `core/gesture.js`, `block_dragger.js`, `workspace.js` | Optional duplicate-origin setter; outside-drop rollback consumes only its gesture group, including during Undo-storage suspension | Fork `block_operation_test.js`; real ordinary/Alt-drag attached substack sharing, full history and reload |
| BLOCKS-004 | `core/xml.js` | Preserve fractional block coordinates when importing VM workspace XML; do not truncate on sprite switches | Fork `xml_test.js`; GUI bounded-reference compatibility tests; code-first/create-sprite/share browser regression |

See [native integration contract](NATIVE-INTEGRATION-CONTRACT.md) for lifetime,
compatibility and rebuild rules. `studio:use-local-blocks` checks both compiled
bundles for the required capabilities before installation.

## Bridge-only integration points

Studio-aware Undo/Redo adds no upstream-owned file change. The query-flagged session already attached by GUI-001 installs a document capture listener and temporarily wraps `ScratchBlocks.ContextMenu.wsUndoOption` and `wsRedoOption`. The wrapper is contained in `src/studio/bridge/studio-history-command-port.js`, restores the original functions on detach and is covered by `test/studio/studio-history-command-port.test.js`. `workspace.undo()` remains untouched so Scratch Blocks' internal correction paths retain their native behaviour.

Inline text-field coalescing also stays behind GUI-001. `block-workspace-port.js` recognizes Scratch Blocks' active `blocklyHtmlInput`, buffers its successive field events and flushes one durable snapshot after document focus leaves the editor. The document listener is removed on detach, non-inline fields remain immediate, and focused port tests cover the lifecycle. If Scratch Blocks changes its editor element, only this bridge and its tests need updating.

Transaction viewport presentation also adds no upstream-owned change. `src/studio/bridge/scratch-blocks-viewport-port.js` uses the public `getBlockById`, block geometry, `getMetrics` and scrollbar interfaces behind one tested adapter. If an upstream upgrade changes those methods, only this bridge and `test/studio/scratch-blocks-viewport-port.test.js` should need revision.

Native interaction playback remains contained under `src/studio/bridge/native-interaction/`. The first decision gate uses the package-level `WorkspaceSvg.getGesture`, `Gesture.forceStartBlockDrag`, `Gesture.handleMove` and `Gesture.handleUp` route. Pinned-build evidence inspection of `workspace.currentGesture_`, `gesture.blockDragger_` and its `draggedConnectionManager_` is contained in `scratch-blocks-drag-driver.js`; it is used only to reject concurrent gestures and prove that a genuine insertion marker was visible. Focused native-interaction tests pin cleanup and isolation, and an upstream Scratch Blocks upgrade must re-run the real-editor marker fixture before this bridge is accepted.

Realistic Play flyout creation is isolated in `scratch-blocks-flyout-port.js`. Its pinned Scratch Blocks seams are `Flyout.categoryScrollPositions`, `Flyout.scrollTarget`, `Flyout.isDragTowardWorkspace`, `Gesture.setStartBlock`, `Gesture.handleFlyoutStart` and the contained post-pickup `gesture.targetBlock_` reference. The first gate resolves only a unique visible block type and fails closed otherwise. `test/studio/scratch-blocks-flyout-port.test.js` pins category selection, scroll settlement, pickup direction and gesture setup; every Scratch Blocks upgrade must also re-run a real-editor create-plus-drop fixture before this bridge is accepted.

Realistic dropdown Play is isolated in `scratch-blocks-dropdown-driver.js`. Its pinned Scratch Blocks seams
are `WorkspaceSvg.getGesture`, `Gesture.setStartField`, `Gesture.handleBlockStart`, `Gesture.handleWsStart`,
`Gesture.handleUp`, `FieldDropdown.getOptions` and `DropDownDiv`. The menu option is selected through the
Closure-compatible hover/down/up/click DOM sequence because a bare DOM `click()` does not activate this
pinned menu implementation. `test/studio/native-dropdown-driver.test.js` pins the gesture and event route;
every Scratch Blocks upgrade must also visibly open and select a real-editor dropdown before acceptance.

Realistic variable/list creation is isolated in `scratch-blocks-variable-driver.js`. It resolves the
Variables category and create button through Blockly's registered category/button callback objects, then
uses GUI-004 for the existing React prompt. The confirmation click temporarily replaces
`ScratchBlocks.utils.genUid` for one returned ID only, copies the original generator's static properties
and restores it synchronously in `finally`; subsequent placeholder IDs use the original generator. Flyout
refresh is observed passively for two paint frames rather than forcing Blockly's private toolbox refresh.
`test/studio/native-variable-driver.test.js`, `test/studio/native-interaction-verifier.test.js` and a real
variable-create Play fixture are required after either Scratch Blocks or prompt changes.

Realistic broadcast-message creation is isolated in `scratch-blocks-broadcast-driver.js`. It composes the
dropdown seam above, selects `ScratchBlocks.NEW_BROADCAST_MESSAGE_ID`, then uses GUI-004's existing prompt
input, Cancel and OK targets. The OK click uses the same synchronous, restoring ID-generator wrapper as
variable creation so the stage broadcast definition retains its recorded ID. `journal.js` owns coalescing
the asynchronous `var_create` plus `BROADCAST_OPTION` pair, while `transaction-effects.js` owns the general
definition-before-dependent-XML replay order. `test/studio/native-broadcast-driver.test.js`, the journal,
replay-order and verifier tests, and a real broadcast-create Play fixture are required after Scratch Blocks
field-variable, prompt or VM broadcast-field changes.

Realistic custom-block creation is isolated in `scratch-blocks-procedure-driver.js`. It resolves the My
Blocks category and `CREATE_PROCEDURE` callback-backed flyout button, parses the recorded prototype mutation,
and uses GUI-005 for the existing React dialogue. Adding text/number or Boolean inputs temporarily supplies
the recorded mutation argument ID. The final OK click delegates the first generator request used for the
event group, then supplies the recorded definition, prototype and reporter IDs in order; all later placeholder
requests delegate to the original generator, whose static properties are preserved. The wrapper is restored
synchronously in `finally`, and failed playback invokes the real Cancel control. `test/studio/native-procedure-driver.test.js`,
`test/studio/native-interaction-verifier.test.js` and a real custom-definition Play fixture are required after
either Scratch Blocks or custom-procedure dialogue changes.

Realistic built-in sprite and costume selection is isolated in `project-library-driver.js`. It uses GUI-006
to operate existing React controls, observes the public `vm.addSprite` or `vm.addCostumeFromLibrary` call
caused by the item click, and awaits the actual returned promise before the exact checkpoint is restored.
Project-operation verification requires the selected durable asset identity, created target or added costume,
completed pointer stages and unchanged Studio journal. `project-state-port.js` owns the versioned
`structural-v3` normalization for save/load-only `md5ext` reconstruction.

Portable block references add no upstream-owned change. `src/studio/bridge/workspace-block-reference.js` contains the Scratch Blocks parent/input/coordinate traversal, while `scratch-blocks-replay-port.js` remains the only adapter that mirrors resolved events to VM block IDs. Focused reference and replay-port tests cover checkpoint-regenerated IDs.

Authored/runtime state separation and boundary data history add no upstream-owned change. `src/studio/bridge/authored-state-port.js` listens to the VM's public execution events and keeps direct variable/list application behind one adapter. Pure data diffing and structural projection remain VM-independent. An upstream serialization, execution-event or target representation change is therefore contained to the authored/project state bridges and their focused tests.

List definitions and monitors are contained in `list-definition-port.js` and `scratch-blocks-replay-port.js`. They adapt Scratch Blocks variable events plus the VM's variable, monitor-block and monitor-state representations. Direct monitor writes cross only GUI-003. If any of those representations change, the focused list-definition, replay-port and authored-state tests identify the bridge contract that needs updating.

The session listens for `PROJECT_LOADED` only after initialization. Studio-owned checkpoint restores
run inside an expected-load scope. Any other load is a hard project boundary: Studio pauses capture,
discards the old journal, adopts the loaded project as a fresh zero-step checkpoint and resumes capture.
Cross-project Undo is intentionally unavailable. This remains behind GUI-001 and requires no additional
upstream modification.

Sprite creation, costume-library addition and cross-target costume sharing add no additional upstream-owned changes. The session temporarily
wraps the VM's public `addSprite`, `addCostumeFromLibrary` and `shareCostumeToTarget` methods in
`project-operation-capture.js`. Exact before/after restore points own assets and generated IDs; the
wrapper preserves return values and detaches only if it still owns the VM method. Focused capture and
session tests pin the contract.

Post-transaction topology recovery is contained in `transaction-topology-verifier.js` and the session.
Recorded move destinations are checked against Blockly parent/input connections and VM block parents
before cursor advancement. A short-lived restore point rolls back any native, semantic or verification
failure, then is deleted. No native Blockly Undo stack is replaced or cleared.

## Upgrade rule

An upstream merge may alter a registered seam only after its contract test has first been run against the old base and then against the proposed new base. Studio-off behaviour must remain equivalent to upstream TurboWarp.
