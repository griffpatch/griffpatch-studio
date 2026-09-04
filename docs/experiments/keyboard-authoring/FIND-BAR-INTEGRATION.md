# Find Bar v2 integration

The Keyboard Lab consumes the embedded TurboWarp Addons runtime. Find Bar remains owned by Scratch Addons rather than being reimplemented in the keyboard-authoring experiment.

## Source

- Repository: `D:\users\andy\SynologyDrive\CloudDrive\dev\scratch\ScratchAddons`
- Branch: `feature/find-bar-v2`
- Imported checkpoint: `ac898a06`
- Imported paths: `addons/find-bar`, `addons/jump-to-def`, `libraries/common/cs/devtools-utils.js`, `libraries/common/cs/block-scrolling.js`, `libraries/common/cs/svg-utils.js`, and the new English runtime messages.

The source preview includes Finder hardening, selected-block Ctrl+Enter integration, and same-sprite/cross-sprite caret handoff. The reusable hardening was also committed in Scratch Addons as `4cf48dfb` on `codex/find-bar-v2-hardening`, based on `feature/find-bar-v2`. Private development diaries and intermediate commit history are not part of this public source preview. The opt-in caret-handoff lifecycle remains a local adaptation.

TurboWarp's generated manifest/runtime entries remain local because its embedded runtime normalizes Scratch Addons manifests separately. Existing TurboWarp-specific Addons and the Keyboard Lab's `middle-click-popup` parser/catalogue changes are deliberately not regenerated.

## Theme compatibility (31 August 2026)

Checkpoint `ac0e6d93e` adds a bounded compatibility section at the end of `addons/find-bar/userstyle.css`. It uses TurboWarp's `--text-primary`, `--ui-modal-background`, `--ui-secondary`, `--ui-tertiary` and `--color-scheme` variables with Scratch light-theme fallbacks. Search/results, selected labels, instance details and table headers, carousel controls, borders, hover states, native checkboxes and scrollbars follow the active editor theme. It does not introduce a separate theme preference or hard-code a dark-mode detector.

Real-browser tests switch the native editor theme and measure at least 4.5:1 foreground/background contrast for details and carousel text in light and dark modes; search and result surfaces are also checked. Screenshots are captured after the existing carousel flash animation settles. Both cases pass on immutable review 8691. The opt-in navigation seam and this compatibility work have not yet been copied into the external Scratch Addons repository. Preserve the adapter when importing upstream CSS; evaluate the same fallback rules in upstream Scratch before backporting theme changes.

## Update contract

1. Make reusable Find Bar changes on `feature/find-bar-v2` first.
2. Stage the exact committed source outside the live Addons tree.
3. Copy only the pinned paths above and review their complete diff.
4. Keep TurboWarp compatibility changes small and feature-detected where possible.
5. Run the supported source gate, production build, and real-browser cross-sprite/definition workflows before advancing this checkpoint.

Keyboard Lab requests semantic exploration with the cancellable `scratch-addons-find-bar-activate` event, an `exploreBlockId`, and `followSelection: true`. Find Bar resolves that fresh ID in the current native workspace and owns all definition/usage rules. Its `scratch-addons-find-bar-navigation` event carries a small lifecycle:

- `start`: requestId, blockId, targetId and followSelection, captured before navigation or sprite switching.
- `finish`: the same identities plus `resolved`, true only after the exact live destination is resolved and scrolling has completed. Superseded requests do not publish a stale finish.
- `cancel`: the carousel was removed; pending structural ownership must be discarded.

The controller grants ownership only from enabled, available Keyboard mode or an already accepted pending handoff. The normal workspace-replacement reset still disables Keyboard mode. Only the expected target change can preserve the request, and only a matching successful finish can restore focus. Manual target selection, project load, same-target replacement, Escape, blur, text editing and explicit mode changes invalidate it. `Utils.scrollBlockIntoView` accepts an optional current-request predicate and returns a resolved `{blockId,targetId}` or no result; delayed effects also verify the live object and target. Keep this seam ID-based; do not import Find Bar internals into the keyboard controller or create another index.

## Search and carousel selection (31 August 2026)

Active Keyboard mode now follows ordinary Finder results as well as explicit Ctrl+Enter exploration. `followSelection` remains producer metadata and must agree at start/finish, but no longer excludes ordinary searches from an already-owned keyboard handoff. A resolved result updates the same native block selection and block-anchored caret used by editing. It does not mutate blocks or the undo stack.

While the Finder text input has focus, navigation updates that selection without moving DOM focus away from the input. Up/Down still choose search results; Left/Right still browse the existing carousel. This also holds across intentional sprite changes. Once editing owns focus, carousel clicks return editing focus to their resolved destination as before.

Enter closes the Finder dropdown and emits the cancellable `scratch-addons-find-bar-focus` event. This is an editor-focus request, not a new block-navigation request or a repeated scroll. An available structural editor with enabled mode or an accepted pending navigation prevents the event's default and focuses its editor surface. Pending navigation still must pass the existing request/block/target checks before selecting its destination. Without that owner, Find Bar retains its ordinary native SVG focus. This explicit seam avoids a timer race between two competing focus calls and has no dependency on Keyboard Lab markup inside Find Bar.

The small reusable focus event is local to the embedded Addons tree until the navigation seam is backported together; do not update the external Scratch Addons branch implicitly. Draft/native-field ownership still blocks a handoff, and manual sprite changes do not automatically re-enable Keyboard mode.

Do not run the general destructive Addons importer over the Keyboard Lab checkout merely to update Find Bar. Do not create another project index inside Keyboard Lab.

## Find-again shortcuts (31 August 2026)

F3 and Shift+F3 move forwards/backwards through the current result carousel. Ctrl+G and Ctrl+Shift+G are alternatives (Command+G variants on macOS). The search input owns these keys while searching; the structural editor forwards them through the cancellable `scratch-addons-find-bar-cycle` event with `direction: 1` or `-1` after the handoff. Find Bar owns refreshing the collection, its order and the existing navigation lifecycle. Ordinary arrows remain text/structural navigation, not global result shortcuts. The carousel control tooltips expose the shortcuts, and the search input has a stable localized accessible name.

Only an enabled structural editor or an accepted pending handoff forwards this request. Rapid repeated shortcuts replace the pending destination without canceling its ownership prematurely. Drafts/native field edits consume the shortcuts with a finish-or-cancel message instead of discarding text. No result is a safe no-op; unrelated inputs and native dialogs are not intercepted. Manual sprite changes still revoke the handoff. The existing block/request/target identity checks are unchanged.

Escape retains Finder's existing two-step behavior: clear a nonempty search first, then close it. Closing now emits the same focus-yield event as Enter, so an available structural editor resumes at its existing caret. Escape still cancels pending navigation; this does not revive a canceled cross-sprite handoff or enable inactive Keyboard mode. Without a structural owner, ordinary Finder retains its existing blur behavior.

These small additions remain in the embedded Addons tree alongside the earlier navigation/focus seam; they have not silently been applied to the external Scratch Addons checkout. Source tests cover shortcut modifiers/composition, and browser coverage checks both focus owners, both shortcut pairs, rapid cross-sprite cycling, editing after arrival, post-rename refresh, unfinished text, no results and native Undo/Redo. The semantic VM comparison retains every identity, connection, value and top-level coordinate; non-top-level `x/y` are excluded because native VM XML serialization intentionally omits them when reloading a sprite.
