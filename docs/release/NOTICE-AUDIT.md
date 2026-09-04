# Notice audit checkpoint, 4 September 2026

Technical evidence, not legal clearance. No deployment, public notices, licence
replacement, dependency change or editor behaviour change was made by this audit.

The public [notice download](../../static/licenses/third-party-notices.txt)
contains the collected notices. See the [README](../../README.md) for the source preview.
The original clean-build audit below is retained as historical evidence.

## Build evidence and scope

Rebuilt the existing clean GUI checkpoint `72f4e9650200f14d094e78860864ca86e22d1557`
with its installed local Blocks bundles, in production mode, to a **new** directory.
The served clean build and all user previews were left untouched. This is a
dependency-audit build of that checkpoint, not a fresh release candidate containing
subsequent cloud/branding changes. Repeat the audit for the actual release.

- Lock SHA256: `7570b4e43d109ce6e0a3e8e917614607100f5f5536e21937e39971068e13b36a`.
- Webpack hash: `2e04b9abd35981fd446c`. Zero build errors; two size warnings.
- Stats SHA256: `84a59c46dfa05f5a40cab42b7eaa2c27334f72de709c3f7215d4fe2e9c7b214c`.
- 167 installed package locations represented by emitted webpack modules.
- 20 of those had initial notice/declaration flags; **ten evidence gaps resolved,
  ten remain**. This is NOT a count of all unresolved release obligations.
- Full lock inventory retains 1,955 packages and 93 flagged entries after the
  supplement, with 1,888 notice records (four excerpts and six upstream notices).

The graph handles concatenated modules and nested/scoped package versions, ignores
loader and issuer chains when identifying the resource, and refuses truncated or
failed statistics. It conservatively includes concatenated children. It does not
prove each export survived minification. Worker/loader child compilations require
separate review. It cannot see all libraries inside
precompiled bundles or assets copied outside the graph. Never use it to discard
notices or corresponding source solely because a package is absent from the map.

## Located and preserved notices

`notice-supplement.json` pins installed versions, source-file SHA256 and exact line
ranges. The collector refuses a changed hash/version, bad range, duplicate entry
or path escaping its package. Original package manifests remain untouched.

Upstream notices are embedded verbatim for offline collection, with a pinned
GitHub commit, notice SHA256, installed manifest hash and locked tarball integrity.
These checks detect changed evidence; they do not establish licence compatibility
or prove that a release tag and npm tarball contain identical source.

| Package | Evidence | Result |
| --- | --- | --- |
| omggif 1.0.9 | omggif.js lines 1–21 | Full MIT notice and Dean McNamee copyright |
| isarray 1.0.0 | README.md lines 38–60 | Full MIT section and Julian Gruber copyright |
| keymirror 0.1.1 | index.js lines 1–16 | Facebook copyright and Apache-2.0 header |
| color-convert 0.5.3 | LICENSE lines 1–21 | MIT terms and Heather Arthur copyright despite absent manifest field |
| format-message-formats, format-message-interpret, format-message-parse 6.2.4 | Repository LICENSE-MIT at npm gitHead ece4dfacbec6af56e98897a3acbf0c99c64c2ed2 | Full MIT notice and Andy VanWagoner copyright |
| babel-runtime 6.26.0 | v6.26.0 resolved to cee4cde53e4f452d89229986b9368ecdb41e00da; package manifest name/version verified | Root MIT licence and Sebastian McKenzie copyright |
| format-message 6.2.1 | v6.2.1 resolved to f1627df6d98232673965c29393393ef5ae99c7f1; package manifest name/version verified | Root MIT licence and Andy VanWagoner copyright |
| lookup-closest-locale 6.2.0 | v6.2.0 resolved to ef02f024d2f3c5c0f0cd21a618f78c7d12d03fb3; package manifest name/version verified | Root MIT licence and Andy VanWagoner copyright |

For keymirror, retain full Apache-2.0 terms as well as its header. The broad
inventory already includes Apache texts; ensure the final selected artifact does
too. Resolving a scanner flag is not an assertion that every licence obligation
or compatibility question has been resolved.

## Remaining directly represented package notices

These need version-matched upstream/header evidence, not a licence guessed from
the npm metadata. Some READMEs contain only the word MIT or a current upstream link.

- get-float-time-domain-data 0.1.0; get-user-media-promise 1.1.4
- grapheme-breaker 0.3.2; linebreak 0.3.0; unicode-trie 0.3.1
- is-in-browser 1.1.3; react-popover 0.5.10; redux-throttle 0.1.1
- to-style 1.3.3; wav-encoder 1.3.0

Conventional licence paths were also checked at the remaining packages' published
gitHead revisions, without locating full notices. A missing file is not permission
to fabricate a copyright notice from an npm author field. Inspect source headers
and versioned ancillary files next; keep unresolved items explicit.

## Outside the direct npm graph: release checks

1. **Fonts:** webpack aliases scratch-render-fonts to
   `src/lib/tw-scratch-render-fonts`. Its seven WOFF2 files are loaded by index.js.
   The adjacent OFL notice names Londrina, which is not one of those seven file
   names. It is not adequate evidence of each file's copyright/terms on its own.
   Trace original font metadata, upstream source and any converted/subset versions
   before deciding whether notices need supplementing. Do not delete or change
   the fonts merely to silence this finding. Files: NotoSans-Medium,
   SourceSerifPro-Regular, handlee-regular, Knewave, Griffy-Regular, Grand9K-Pixel,
   ScratchSavers_b2. Other fonts in CSS/dependencies still need coverage too.
   **Update:** [FONT-NOTICES.md](FONT-NOTICES.md) and `font-evidence.json` now
   preserve all seven embedded font metadata records and hashes. Every file matches
   the pinned upstream font dependency byte-for-byte. Six identify OFL licensing;
   Grand9K-Pixel identifies CC BY-SA 3.0. Inherited Scratch Savers modification
   attribution is retained. Origin/conversion checks and final full terms remain
   separate work; the old Londrina notice was not removed or treated as universal.
2. **Vendored Addons:** preserve the existing GPL header in src/addons/pull.js,
   Addons README attribution, and local Finder provenance recorded in
   `docs/experiments/keyboard-authoring/FIND-BAR-INTEGRATION.md` (import ac898a06).
   A GUI licence does not replace third-party-library notices within Addons.
3. **Chart.js / TinyColor:** vendored Chart.js identifies v3.9.1, 2022 Chart.js
   Contributors and MIT; TinyColor identifies Brian Grinstead and MIT. Preserve
   these headers and locate their matching complete licence texts. Chart.js can
   contain additional embedded libraries; inspect those too. Audited file hashes:
   chart.min.js `fbc45926e6b46845a0f905552a0e0b1331049bff1115ecf94dbe0904d895e710`;
   tinycolor-min.js `02f8915aed24d96d4e7d90af2f3c885d9e1b2b1fa288f4759b49bd28c6a90338`.
   **Update:** [VENDORED-NOTICES.md](VENDORED-NOTICES.md) records an exact match to
   the integrity-checked Chart.js 3.9.1 tarball. Full Chart.js and embedded
   @kurkle/color 0.2.1 notices are preserved in `vendored-notice-evidence.json`.
   TinyColor's exact Addons source and mapped MIT terms are now preserved too,
   without inventing a numeric library version. Unicode tables were compared
   against regenerated official source data at every code point (zero differences),
   and fixtures match official files. Original headers and the retrieved current
   Unicode notice are retained separately in `unicode-data-evidence.json`.
4. **Precompiled libraries:** JSZip, Paper, scratch-storage and compressed Blocks
   appear as compiled resources. Audit embedded notices/dependency sources; outer
   webpack membership alone does not inventory their internals.
5. **Assets:** copy rules include static, Blocks media, high-contrast media and
   example extensions. Trace images/sounds/library assets separately. The default
   project README preserves the old dango creator attribution and identifies the
   current Studio mark. Source releases retain legacy assets even when not used
   at runtime, so they are still in the rights-review scope.
6. **Public artifact:** this audit build's licenses directory contains only GUI
   GPL, fork notice and upstream trademark notice. There are no separately emitted
   JS LICENSE files. Do not claim the public third-party notice bundle is finished.
   Some headers may remain in JS, but that needs inspection rather than assumption.

## Reproduction and verification

Use the clean checkpoint specified in CLEAN-BUILD.md. Build into new, unserved
destinations; the helper refuses existing paths. Run commands from scratch-gui:

```powershell
node scripts/release-webpack-stats.cjs D:/dev/twstudio/.tmp/release-clean-20260904/gui .tmp/notice-build-next .tmp/notice-stats-next.json
node scripts/release-notices.cjs --root=D:/dev/twstudio/.tmp/release-clean-20260904/gui --supplement=docs/release/notice-supplement.json > .tmp/notices-next.json
node scripts/release-notices.cjs --root=D:/dev/twstudio/.tmp/release-clean-20260904/gui --supplement=docs/release/notice-supplement.json --text > .tmp/notices-next.txt
node scripts/release-bundle-audit.cjs .tmp/notice-stats-next.json .tmp/notices-next.json > .tmp/bundle-audit-next.json
node --test test/release/notices.test.cjs test/release/bundle-audit.test.cjs test/release/font-evidence.test.cjs test/release/vendored-evidence.test.cjs test/release/unicode-evidence.test.cjs
```

Twenty-two focused notice tests pass. No editor/browser suite was needed for these offline
tools and documents; no user preview was rebuilt or reloaded. Local evidence:
`.tmp/licence-audit-build.log`, `.tmp/licence-audit-webpack-stats.json`,
`.tmp/bundle-upstream-reviewed-20260904.json`, and `.tmp/notices-upstream-reviewed-20260904.json`.
The inventory is a broad **draft**, not the final public notice artifact.

Next: resolve the ten versioned notices and remaining font provenance, then inspect opaque
bundles/copied assets before producing the final notice selection and About link.
Keep source delivery a separate gate: GNU's
[FAQ](https://www.gnu.org/licenses/gpl-faq.html.en) distinguishes JavaScript
distributed to visitors from a server merely running GPL software. Retain the
exact corresponding source/build instructions; this audit does not replace that
work or professional advice on uncertain rights.
