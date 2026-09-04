# Script breadcrumb addon

An independent, default-enabled addon on the Keyboard Lab branch. It also works in an ordinary editor without the `keyboard-authoring` query flag. Stable Studio's branch and fixed build are not changed.

## Behaviour

- Compact current-sprite costume thumbnail and name, followed by the active script's native header and C-mouth nesting.
- Remembers the last selected/edited/navigated script separately for each sprite and Stage. Hover and camera movement do not choose a different script.
- An offscreen head receives an upward-labelled tag, aligned towards its column and sharing the badge's top row. Only the active script is labelled; no second strip covers the next visible command.
- Click the sprite badge or script title to visit the script head; click a nesting label to visit its owning C block. Pinned labels have the same links. Keyboard mode resumes structural editing at that block; ordinary mouse mode stays off. Back/Forward uses the existing shared history, including the exact departure input and view.
- Long labels are truncated, and presentation follows the current TurboWarp theme. Links are native buttons with visible hover/focus states. There are no new navigation shortcuts or project writes.
- While visible, the addon declares a 32-client-pixel header band. Keyboard reveal/framing and shared Finder scrolling reserve it in addition to their normal padding. Disabling the addon releases that space; showing it does not forcibly recenter a manually panned workspace.
- Disable **Script breadcrumb** in Addons to remove the overlay. It can be re-enabled without reloading the editor.

## Boundaries and portability

`src/addons/addons/script-breadcrumb/` contains the manifest, native header/body model, rendering/observation adapter and styles. `src/addons/libraries/common/cs/script-context.js` is a small optional per-VM identity store. It contains only target/block/root/input/kind data, never native block or DOM references.

The ordinary addon follows native workspace selection and edit events, VM target/workspace lifecycle, canvas transforms and size changes. Keyboard Authoring optionally supplies precise operand/body positions. The already-shared Finder/Jump navigation history captures and restores this presentation context, including when no keyboard host exists. Its `navigateToBlock` operation owns click cancellation, smooth scrolling, native selection and optional host restoration. Deleted blocks, changed workspaces, disabled addons and intervening user navigation cannot claim focus on late completion. The breadcrumb is not another focus manager or navigation history.

`workspace-insets.js` reads declared visible workspace chrome without importing an addon into the keyboard experiment or scrolling layer. The same header allowance applies to explicit Alt+S framing, automatic caret reveal and existing Finder scroll positioning. It does not alter native block coordinates or scrollable range.

Native block labels are read from the command's field rows; the renderer does not recursively stringify the script. Full-script height is cached until a relevant native/context change. Pan frames only transform the active script's cached extent and position its tag. Thumbnails are encoded only when the active costume asset changes. Disabled/hidden editors do not render, and workspace remounts dispose observers and listeners before installing a replacement.

For a Scratch Addons port, copy the addon and common context module, register the manifest/runtime with that checkout's normal tooling, and carry across the shared navigation/scroller/inset helpers or map these narrow seams to that checkout's existing equivalents. Optionally connect its Finder/Jump or keyboard host to the context store; native selection/edit tracking works without a keyboard host. Current packaging entries are checked in for this TurboWarp fork. The repository's destructive upstream `pull.js` is not a safe local-addon merge mechanism; do not run it over these edits. No upstream publication or sync was performed.

## Deliberate first-version limits

- It links to ancestors of the active script, not a general script/sprite picker. The sprite badge returns to that script's head; it does not change sprites.
- Only the last active script is labelled, not every offscreen stack. A wholly vertically offscreen script has only the main breadcrumb, not a misleading pinned head tag.
- No editable script aliases, recording overlays/export, or saved project metadata are introduced.
- Labels use native block/menu text. Small addon chrome such as `then`, `Stage` and `Script` currently uses English fallbacks; full localisation and RTL layout certification remain future work.
- A deleted focused block falls back to its remembered root; if that root is also gone, show sprite-only context. Native Undo can restore the same identity. File/New/project load clears session context.

## Verification

Model/lifecycle units cover scope ancestry, label safety, identity-only storage, independent targets/VMs, project clearing, repeated-destination deduplication, mouse-only navigation history, pinned geometry, disabled/re-enabled rendering and disposal. A 30-frame pan sequence performs one script-size measurement and one thumbnail encoding in total.

Real-browser cases cover keyboard then/else context, mouse-only script selection, Stage/sprite and Costumes/Code return, light/dark themes in a narrow editor, offscreen pinning, unchanged context revisions while panning, and native palette drag/Undo/Redo with Keyboard Authoring entirely absent. Ancestor/pinned-head clicks are exercised with Keyboard on/off, including exact operand/view return and unchanged XML/Undo. Finder overlap checks test actual hit-test stacking order with the otherwise click-through caret temporarily hit-testable, paired with screenshots; its paint order is not changed by that probe. Exact checkpoint counts and artifact hashes are recorded in `REVIEW.md`.
