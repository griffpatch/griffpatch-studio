# Navigation maintenance follow-through

3 September 2026. Scope approved after the clickable-breadcrumb checkpoint
`ac8322e04`: review input ownership, deferred focus, navigation effects and
mixed editing journeys without redesigning the controls or native Undo.

## Review findings

- The structural/spatial split, shared Finder history and `selectPosition`
  coordinator are useful existing boundaries. No second selection model or
  broad controller rewrite is justified by this review.
- Structural/result key handling repeated the same DOM-owner checks. A small
  `focus-ownership.js` module now classifies surface, composer, native editor,
  pending navigation and external controls once, without changing key bindings.
- Native field Escape/Enter had unconditional next-frame callbacks, independent
  of mode and newer navigation. A real-browser regression reproduced focus
  theft: Escape from an F2 field, then click the project title before frame
  delivery. The title loses focus even though Keyboard mode has been disabled.
  The test delays animation-frame delivery to make that ordering deterministic;
  Escape and the pointer click are genuine browser actions, not dispatched
  synthetic events or direct controller calls.
- Native field close observation, key completion and semantic rename completion
  now share a coalesced focus-return helper. It checks the existing shared
  request and sprite identity, controller lifetime/availability, draft/native
  dialog state and current DOM owner. Mode changes, detach and window blur
  cancel pending returns. Finder and other explicit controls keep their keys.
- Ordinary native text/dropdown dismissal into Finder passed on the old build
  too. Those are characterization tests, not additional claimed product bugs.
- Existing history/breadcrumb/Alt+S paths already validate their async requests
  and preserve native camera ownership. They remain separate explicit journeys,
  not repurposed as the native-field return mechanism.

## Ownership boundaries retained

| Interaction | Owner and completion boundary |
| --- | --- |
| Local arrows, Home/End and structural Tab | Pure structural/spatial policies select a semantic destination; `selectPosition` applies native selection, caret, reveal and announcement. |
| Composition text and native field text | Browser/native text editing remains authoritative, including text Undo. Classification does not route text arrows as structural movement. |
| Native menu/field or rename completion | The coalesced focus-return helper checks the current request, target, mode and DOM owner at delivery. It does not navigate or create history entries. |
| Finder, breadcrumb, Alt+S and Back/Forward | The existing per-VM navigation owner captures/restores the journey and cancels stale requests; the optional keyboard host restores precise caret identity. |
| Sprite/editor-panel changes | GUI workspace-ready and remembered locations remain separate from DOM focus; sprite controls retain their focus until explicit return to Code. |
| Native drag | The existing native drag-settled callback returns the live block without synthetic drag/Undo operations or post-drop camera movement. |

The controller still orchestrates these owners and the composition UI. Its line
count alone is not a reason to split more closures or add a generic command
framework. Any further extraction should remove a demonstrated duplicate policy
or measured cost, not merely move code between files.

## Verification and limits

The isolated old-build reproduction fails at the actual focused element, after
the mode-off assertion has passed. On the corrected checkpoint `822bfa44c`, the
complete Keyboard browser gate passes **267/267**, the complete feature-disabled
Studio gate passes **29/29 in 10 suites**, and source verification passes
**1,484/1,484 in 121 suites**, including 19 ownership/return tests. Both complete
browser gates ran sequentially on the immutable 8770 artifact. Exact publication
and evidence details are in `REVIEW.md`.

The initial complete Keyboard run found **18 failures / 249 passes**. Running
those exact failing cases against unchanged `ac8322e04` separated **14 existing
test/contract-drift failures** from **four regressions introduced by the new
guard**. The failing candidate `f08d1a54f` was frozen for evidence but not
published. The four regressions exposed an important native lifecycle detail:
`WidgetDiv.isVisible()` remains true during its closing animation. Waiting for
it to become false blocked the ordinary next-frame return and allowed native
text Undo to keep the next Ctrl+Z. The corrected guard permits the *same*
closing native owner, but rejects a newer owner. It also recognizes the owning
workspace SVG and consumes frame-observed completion without adding a frame.

The existing tests needed updates for two-Escape exit, allowed passive insertion
carets after cancellation, world-coordinate preservation beneath reserved header
chrome, field-close animation completion, keyboard composition on value clicks,
visible preview targets instead of masked source geometry, current workspace
identity after reload, and mode-preserving zoom/tab switches. Assertions for
native identities, shadows, topology, Undo/Redo and leaked presentation remain.
The mixed three-cycle journey now waits for the restored caret to paint before
locating the next real mouse target. These changes are test maintenance, not
claims that fourteen additional product bugs were fixed.

The immutable 8768 files/server were preserved while testing the separate 8769
candidate. The verified 8770 review replaces only its agent-authored demonstration
tab; the two older edited user projects remain open. No existing server, stable
Studio branch, native Undo implementation or Scratch Blocks source was changed.
This is not a claim
of complete screen-reader/OS-IME certification, nor a reason to add a revision
cache or more keyboard shortcuts without measured need.
