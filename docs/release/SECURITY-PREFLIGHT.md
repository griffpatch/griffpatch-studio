# Dependency security preflight

4 September 2026. Initial audit was read-only. The subsequent authorised URL
startup remediation below changes application callers, not package/lock versions.
No deployment, public exploit testing or user-tab interaction.

## Scope and counts

`npm audit --omit=dev --ignore-scripts --json` ran in the separate clean GUI
checkout. Lock SHA256 remains
`7570b4e43d109ce6e0a3e8e917614607100f5f5536e21937e39971068e13b36a`.
Report: `.tmp/release-runtime-audit-20260904.json`.

The npm result flags 68 package entries: 9 critical, 23 high, 28 moderate, 8 low.
These are NOT 68 independently demonstrated browser vulnerabilities. Build tools
are historically declared as production dependencies in this project, and npm
also propagates vulnerable-child findings to parent packages. `--omit=dev` is not
a browser-bundle filter. Version/package matches require API/configuration and
untrusted-input reachability analysis.

The existing emitted-module map identifies 14 matching package locations. None
of the critical package names has a direct match in that map. This does not clear
opaque bundles, workers, build/install tools or future configurations. Keep those
separate from reachable browser issues; do not suppress the audit globally.

## First-pass triage

| Area | Evidence | Action |
| --- | --- | --- |
| URL decoder | decode-uri-component 0.2.2 remains emitted through query-string 5.1.1; startup callers now use native URLSearchParams | Active locale path remediated; retained tutorial HOC also hardened but is disabled in TurboWarp's GUI |
| SVG sanitizer | DOMPurify 3.4.5 emitted; SVG renderer sanitizes string input using SVG profiles | Review patch update and SVG regressions; current call sites do not request IN_PLACE, custom elements or template modes identified in several advisories |
| Lodash/lodash-es | High-severity advisories mention template/omit/unset; emitted modules inspected are flatten/escapeRegExp/isPlainObject and helpers | No matching affected API found in this direct map; inspect other compiled bundles before exemption |
| AJV / scratch-parser | Older AJV present in project parsing | Trace whether attacker controls schema/options rather than only project data; do not equate all validation with the vulnerable configuration |
| qs / uuid / Babel helpers | Package/version matches present | Inspect actual options/functions and input reachability; do not upgrade parent frameworks solely to silence inherited flags |
| Toolchain | Critical/high entries include tar/decompress/request and propagated parents | Separate build/install threat model; no public runtime Node server is proposed |

The URL decoder was measured only in isolated short-lived Node subprocesses,
with a two-second safety timeout and no external traffic. Parsing a dummy query
containing 16, 64 and 128 repeated malformed encoded bytes took approximately
1ms, 73ms and 397ms respectively. These are local timings, not a browser exploit
or hardware-independent threshold. The untrusted query-input path is present in
source; a real-browser bounded regression should accompany remediation.

Primary advisory references checked 4 September:

- [decode-uri-component GHSA-vcc3-ghjq-m6fr](https://github.com/advisories/GHSA-vcc3-ghjq-m6fr): patched release 0.5.0; official workaround is input limits.
- [Lodash template GHSA-r5fr-rjxr-66jc](https://github.com/advisories/GHSA-r5fr-rjxr-66jc).
- [DOMPurify IN_PLACE hook GHSA-55q2-fjhq-7xh7](https://github.com/advisories/GHSA-55q2-fjhq-7xh7).

## Authorised URL startup remediation

The upstream patched decoder 0.5.0 is ESM, while query-string 5.1.1 expects a
CommonJS callable. Rather than override this incompatible dependency or upgrade
the wider framework, the two application parsing callers now use URLSearchParams,
already used elsewhere in this editor. No dependency or lockfile changes.

- `detect-locale.js`: getAll preserves duplicate ordering, locale-before-lang
  precedence, ignored empty values, supported-language checks and saved preference
  precedence. Malformed UTF-8 uses the browser's replacement-character handling;
  it cannot match a supported language accidentally.
- `query-parser-hoc.jsx`: keeps first tutorial value behaviour without the old
  decoder. Correction to the initial triage: `containers/gui.jsx` explicitly
  disables this inherited HOC. It is NOT a second active startup path. It remains
  disabled; isolated component tests protect compatibility if reused.
- `save-project-to-server.js` uses query-string.stringify, not parse. It is
  unchanged. The old package and its audit finding remain; this is a reachable
  caller fix, not a claim that every bundled copy/API is patched.

Focused unit coverage: 36 passing tests across locale detection, the retained
query HOC and tutorial-ID selection. Tests prohibit calling legacy parse and cover
encoded names/values, duplicates, empty values, plus handling, malformed keys and
values, storage denial, and a 4096-byte malformed encoded run.

Real-browser test: `test/integration/url-startup.test.js`, supplied an isolated
production build through URL_STARTUP_BUILD. It starts its own loopback-only static
server and fresh Chrome profiles, closes only those resources, checks actual
language UI, malformed URL startup, project-title text entry and clean navigation.
It also checks that the deliberately disabled tutorial URL feature stays disabled.
The first browser run exposed an incorrect test expectation that tutorials would
open; this was corrected against the existing GUI composition, not by enabling it.

Final verification: all three browser cases passed on production bundle
`ccb7fdd8457387fc244f`, built into `.tmp/url-decoder-native-final-20260904`
(zero build errors, two size warnings). Fresh-profile editor readiness measured
786-856 ms including the malformed cases; subsequent clean navigation took 293 ms.
These are local measurements, not universal performance guarantees. Log:
`.tmp/url-startup-browser-verified-20260904.log`. Production-file lint and
`git diff --check` passed. Existing served snapshots remain unchanged.

## SVG assessment correction

Inspection prompted by https://muffin.ink/blog/scratch-svg-sanitization/ confirmed
that both the installed SVG renderer and @turbowarp/paper contain the upstream
sandboxed iframe implementation: allow-same-origin without allow-scripts and a
restrictive CSP permitting only inline styles and data fonts/images. Sanitisation
is defence in depth, not the only boundary. DOMPurify findings alone do not
establish exploitability or a release blocker. Prioritise an isolated browser
verification of those boundaries and advisory-specific reachability before
requiring a sanitizer upgrade. No SVG runtime changes made in this pass.

Follow-up: [SVG-ISOLATION-VERIFICATION.md](SVG-ISOLATION-VERIFICATION.md) records
four passing browser cases, including an effective unprotected positive control.
The tested script/network/style boundaries held. A separate text-positioning
discrepancy was found visually and is explicitly not covered by the passing pixel
checks. No sanitiser upgrade is justified solely by these tested paths.

## Remaining remediation gate

Continue targeted dependency assessment before public release. Evaluate patched upstream
versions in a separate candidate, retain API/format compatibility, run focused
regressions, then the agreed release gate. Avoid `npm audit fix --force`: suggested
fixes include major Webpack changes and a TurboWarp translation-package downgrade.
Those are not safe incidental release-preparation changes.

Remaining notice/source/privacy work still applies. This document is a preflight,
not a penetration test, security certification or complete reachability analysis.
