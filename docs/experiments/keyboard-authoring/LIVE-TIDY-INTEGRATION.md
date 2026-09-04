# Live stack tidy-up integration

31 August 2026, extended 4 September 2026. Opt-in Keyboard Lab only; stable Studio is not changed.

## Source and scope

Adapted from Andy/griffpatch's local Scratch Addons branch
`feature/editor-cleanup-plus-live-cleanup`, commit
`027746a9d8b379bf503a623774689efc65dd2ccb`, specifically
`addons/editor-cleanup-plus/userscript.js` (GPL-3.0).
The source checkout was inspected read-only. Its checked-out branch and files
were not changed. This is a focused adaptation of the live spacing algorithm,
not an import of the full add-on, a replacement of TurboWarp's add-on bundle,
or a change to the manual Clean up menu.

The preserved policy prefers alignment to a neighbouring stack above the edited
stack, restores a 50-workspace-unit gap, and cascades displaced stacks downward
within the same column. Loosely overlapping roots follow a displaced column.
Width growth now shifts entire following columns to the right (mirrored for
RTL), preserving their Y positions and internal offsets. A pure companion
planner uses Cleanup+'s 128-unit grouping tolerance with fixed anchors rather
than a drifting average, and a horizontal gap of at least 64 units. The minimum
column advance retains distinct columns even with very narrow blocks. A cascade
stops at available room: unrelated later overlaps are not cleaned up. Loose
reporters follow an owning column without initiating or widening columns.
The hidden `LIVE_STACK_LAYOUT` constant can
disable the policy or change its gap without removing the integration.

## Native boundary rather than global monkeypatches

Upstream wraps `BlockSvg.initSvg` and `BlockSvg.bumpNeighbours_` globally and
tracks new blocks across animation frames. Here a small, optional
`Workspace.setBlockSpacingHandler` / `applyBlockSpacing` hook runs at the
existing scheduled native drop boundary. With no registered handler, the
original `bumpNeighbours_` path is unchanged. Only the opt-in Lab controller
registers a handler; its native mouse editing retains it when Keyboard mode
is toggled off. Controller disposal clears it.

Keyboard edits use the same policy synchronously inside their native Blockly
event group, after the insertion/wrap/paste has completed. The new `onGroup`
finalizer captures the previous root bounds, identifies newly added or enlarged
statement roots and spaces those roots only. Ordinary native move events record
any displacement. Undo and Redo restore those recorded positions; layout does
not recompute during history replay. Failed edits do not run the finalizer.

Before acceptance, candidates reserve vertical space only. Width-only typing
does not run the spacing planner or copy neighbouring columns. Horizontal
spacing runs once when a new or enlarged block is accepted/placed, including
literal input text, nested reporters, replacements and wrapping.
A plain value edit now uses the existing native event-group finalizer too, so
its field change and layout are one Undo step. Floating reporter roots still
do not initiate spacing. A draft uses the same pure planner against
its native rendered bounds. A scoped transition scene incrementally includes
only roots which the plan displaces, then moves those copied native roots over
160 ms while their authoritative counterparts are masked but untouched. This
also covers detached new scripts and slightly offset roots which physically
intersect the prospective stack. Changing to a smaller candidate can animate
the copies home; Escape disposes the scene and restores the original view.
Acceptance remains the sole editable operation and commits both layout axes
inside its existing native event group, so one native Undo reverses both the
block edit and spacing. The incremental presentation contract is Scratch
Blocks commit `cb794bc3`; it adds no layout policy to the framework.

The scheduled drop handler checks the captured native event group against the
latest recorded group, so an undone or superseded delayed bump cannot tidy a
later state. Read-only previews, flyouts, active gestures, disabled events and
unrecorded history replay are excluded. Busy Studio transitions suspend the Lab
policy. Native Undo is neither intercepted nor replaced.

## Deliberate adaptations

- Use native bounding rectangles, including their reflection in RTL, rather
  than assuming the block origin is the physical left edge.
- Preserve the edited root's original Y before moving it below an upper stack.
  Otherwise it can jump past a lower stack and accidentally exclude that stack
  from the cascade.
- Floating reporters do not initiate tidy-up or act as column alignment
  targets, but may follow a nearby displaced lower stack.
- Keep the layout planner pure. No temporary detach, XML replacement, synthetic
  gesture, alternate identity map or custom Undo storage is introduced.

## Bounds and review points

This is downward stack and rightward column spacing, not a whole-workspace layout engine. It does not
pull stacks upward after deletion, compact a loaded project on activation,
ensure every distant root is in view, or import upstream unused-variable prompts.
The synchronous keyboard hook covers the existing grouped creation, insertion,
paste and wrapping paths. Arbitrary resizing from every native text-field edit
is not claimed. The gap is currently a hidden constant, not a preference UI.

Tests cover the pure two-axis column policy, stable grouping, idempotence with
narrow blocks, RTL bounds/mirrored moves, one-group native history,
read-only/replay gates, stale scheduled drops, keyboard insertion into a C mouth
and an actual native mouse drop. Predictive coverage additionally checks
existing-root growth, detached scripts, offset collision cascades, cancellation,
acceptance and native Undo. Width-growth browser cases additionally check whole
column movement, same-Y preservation, cascading, long literal and nested-reporter
drafts, narrowing/cancelling and exact preview-to-commit positions at two zooms.
Consult `REVIEW.md` for the precise tested checkpoint,
browser gate results and immutable review URL.

The pre-integration dependency bundles are retained in
`.tmp/keyboard-pre-spacing-blocks-backup`. Rollback should use the corresponding
committed GUI/native pair or a preserved immutable review, not rebuild an older
published directory.

The native hook is committed as `72090966` on the Blocks experiment branch.
`scripts/use-local-studio-scratch-blocks.ps1` checks for both spacing methods,
alongside the earlier required Studio and keyboard presentation capabilities,
before copying and hash-verifying the local native bundles. Use that installer
after rebuilding the native fork; a plain dependency reinstall is not sufficient
for this experiment branch.
