# SVG isolation verification

4 September 2026. Scoped local browser verification, not a security certification.
No runtime, dependency, SVG sanitiser or user-project changes.

## Build and method

- Production bundle `ccb7fdd8457387fc244f`, application checkpoint `6f91a1a44`.
- Existing immutable build `.tmp/url-decoder-native-final-20260904`; not rebuilt.
- Installed @turbowarp/scratch-svg-renderer 1.1.0 and @turbowarp/paper 0.13.0.
- Four passing Chrome browser cases in `test/integration/svg-isolation.test.js`.
- Fresh isolated browser profiles; separate ephemeral loopback servers for the
  editor and request receiver. HTTPS/WebSocket traffic blocked for safety. The
  local receiver was deliberately NOT blocked, so the test could observe leaks.
- Added raw test SVG bytes through VM.addCostume, then clicked the actual Costumes
  tab to exercise Paper import. Missing viewBox forces the renderer's measurement
  path. This is not a full SB3 archive-upload or file-picker test.
- The second test puts active probes directly into each existing sandbox, bypassing
  sanitisation only in test code. It then runs the same probes in an unprotected
  test iframe as a positive control. No public exploit endpoints or real user data.

## Results

1. Hostile costume content containing script, HTML event handling, external image,
   CSS import, image-set, nested CSS and editor-targeted styling produced no requests
   to the receiver, no script marker changes and no sentinel-style changes.
2. Both real library iframes had sandbox `allow-same-origin` without allow-scripts,
   and CSP `default-src 'none'; style-src 'unsafe-inline' data:; font-src data:; img-src data:`.
3. Direct active probes were blocked in both sandboxes, even without DOMPurify.
   Browser logs recorded sandbox/CSP violations. In the unprotected control,
   scripts executed and all four expected image/script/stylesheet/image-set
   requests reached the receiver. This rules out a disconnected receiver or
   universally inert probes as the explanation for the negative results.
4. Benign gradients, shapes and text loaded. Automated shape-dimension and coloured
   paint-pixel checks passed. Screenshots were also inspected: see the separate
   rendering limitation below before claiming complete visual fidelity.

Log: `.tmp/svg-isolation-browser-final-20260904.log`.
Per-case browser logs, request lists and screenshots: `.tmp/svg-isolation-evidence/`.
The normal fixtures produced no requests to the receiver. The unprotected control's
requests are intentional and distinguishable in its evidence file.

## Separate visual finding

The benign test SVG's text has a different vertical position on the stage and in
the costume editor. Both ordinary SVG x/y positioning and transform-based text
show an offset (the transform variant places text partly below the shape).
Gradients and other shapes remain visible. The passing automated pixel check does
NOT cover text-baseline fidelity, and must not be described as a complete visual
pass. This was observed with unchanged rendering code; its exact cause and scope
were not established during the first pass. The follow-up below establishes the
relevant import rule; do not change sanitisation to address it.

### Text-import follow-up

Inspection of the installed Paper bundle's text importer (around line 15141),
and the [upstream source](https://github.com/TurboWarp/paper.js/blob/develop/src/svg/SvgImport.js),
finds an intentional Scratch compatibility rule:

- Text x/y attributes are ignored to accommodate Scratch multiline text.
- Plain text without child elements is shifted down by one leading value for
  Scratch 2 compatibility, before applying its explicit font size.
- Scratch 3 text uses tspan children and takes the separate multiline path;
  text-before-edge alignment receives its own adjustment.

This explains both original fixtures: x/y positioning is discarded in the first;
the second retains its transform but also receives the legacy vertical shift.
Calling the second fixture "Scratch-style" was imprecise: transformed plain text
alone is not the normal Scratch 3 tspan representation. The test label is corrected.

A third benign fixture uses the same graphic and a transformed tspan. The one
new browser case passed and its screenshot was inspected: text sits below the
circle and within the rectangle in both the stage and paint editor as intended.
Log: `.tmp/svg-text-tspan-browser-20260904.log`; screenshot:
`.tmp/svg-isolation-evidence/SVG-sandbox-boundaries-in-the-real-editor-Scratch-3-tspan-text-retains-shape-dimensions-and-visible-paint-pixels.png`.
Only this added case was run in the follow-up; the preceding four were not rerun.

Decision: retain the inherited import behaviour for this release preparation,
recording generic SVG text positioning as a compatibility limitation rather than
a security regression. A future fix should distinguish standard SVG text from
legacy Scratch 2 text at an appropriate import boundary, with legacy and Scratch 3
multiline fixtures, font sizing, transforms and baseline checks. Removing the
offset unconditionally or replacing the whole importer would risk existing
costumes. No runtime/dependency files were changed in this investigation.

## Decision and limits

These results support retaining TurboWarp's existing layered sandbox design.
No demonstrated need for a DOMPurify upgrade or additional CSS sanitisation was
found by these tests. Keep advisory-specific review and routine dependency
maintenance separate from this result; DOMPurify is still defence in depth.

Coverage is current Chrome, these probes and these two paths. It does not clear
all browser engines, SVG features, compiled dependency APIs, malformed resource
exhaustion cases or future browser behaviour. Tests observe requests over a bounded
settling period; they are not proof of absence of every possible delayed leak.

Reproduce against an explicit unmodified candidate using SVG_ISOLATION_BUILD and
the existing isolated Selenium setup. Never target a user's profile or replace
their editor project. The suite closes only its own browsers and servers.
