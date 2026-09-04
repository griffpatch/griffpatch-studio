# Vendored and generated-data notice evidence

4 September 2026. Local audit only. No dependencies, served previews or copied
library code were changed. This does not close the complete asset/source gate.

## Chart.js and its embedded colour library

`src/addons/libraries/thirdparty/cs/chart.min.js` is byte-for-byte identical to
`package/dist/chart.min.js` in the published Chart.js **3.9.1** npm tarball. The
tarball's SHA512 integrity was verified against version-specific registry metadata
before inspection. Files were read in memory, not installed or executed. Its
SHA256 is `fbc45926e6b46845a0f905552a0e0b1331049bff1115ecf94dbe0904d895e710`.

`vendored-notice-evidence.json` retains:

- Registry URL, metadata hash, tarball URL/integrity and exact file comparison.
- Chart.js 3.9.1's full MIT text from the tarball, also identical to LICENSE.md at
  npm gitHead `5ea4b3adffcea61c7ec256ac3976927c5619c17a`.
- The embedded **@kurkle/color 0.2.1** header, and full MIT text retrieved at its
  version-specific npm gitHead `7f441c91cb3a6e578680e63e448a6acca2e68f56`.
- Original headers, source URLs and full-text hashes. The generated colour-library
  header says 2022; its upstream licence says 2018–2021. Both are preserved exactly,
  not merged into a fabricated attribution.

These records belong in the eventual public notice artifact, including the
embedded library's notice. They are separate from the direct npm graph and are
not currently published via About. The matched Chart.js distribution establishes
the copied bundle's provenance; it is not a replacement for corresponding source.

Offline verification:

```powershell
node --test test/release/vendored-evidence.test.cjs
```

## TinyColor import resolved, without guessing a release number

`src/addons/libraries/thirdparty/cs/tinycolor-min.js` is readable, locally adapted
ES-module source despite its filename. Its header identifies Brian Grinstead and
MIT but does not state a version. Hash:
`02f8915aed24d96d4e7d90af2f3c885d9e1b2b1fa288f4759b49bd28c6a90338`.
It matches `TurboWarp/addons` revision
`965a016a106356610eadb71ede21581965f71c05` byte-for-byte. This expands the short
revision in `src/addons/generated/upstream-meta.json`. At that same revision,
`libraries/license-info.json` maps tinycolor2 to MIT and `libraries/licenses/MIT.txt`
provides the full permission/warranty terms. Those texts and their hashes are now
preserved alongside Brian Grinstead's existing header in the vendored evidence.
The exact imported source is known; a numeric tinycolor2 release is not inferred.
No original attribution or module adaptation was rewritten.

## Unicode-derived data is a separate component

The legacy text-breaking packages declare MIT, but their generators and fixtures
also identify upstream Unicode data:

| Installed package | Source evidence | Data version |
| --- | --- | --- |
| grapheme-breaker 0.3.2 | src/generate_data.coffee downloads auxiliary/GraphemeBreakProperty.txt; test/GraphemeBreakTest.txt retains Unicode copyright 1991–2015 | Unicode 8.0.0 |
| linebreak 0.3.0 | src/generate_data.coffee downloads LineBreak.txt; test/LineBreakTest.txt retains Unicode copyright 1991–2014 | Unicode 7.0.0 |

Both test fixtures match the official versioned Unicode files byte-for-byte.
The inspected installed generators were run with the official versioned property
data, intercepting network calls and file writes in memory. GraphemeBreak's trie
and class map reproduced byte-for-byte. LineBreak's compressed bytes differed,
but all **1,114,112 code points** matched the installed table. Both tables had zero
value mismatches. This proves data correspondence, not identical compression.
The audit did not run newly downloaded code or modify installed dependencies.

`unicode-data-evidence.json` preserves input/generator/table hashes, original
copyright headers, fixture comparisons and the retrieved current Unicode licence.
The [official terms](https://www.unicode.org/copyright.html), checked 4 September,
define data under Public/ as Unicode Data Files and apply Unicode License v3 unless
a specific exception is identified. These files refer to Unicode's terms page;
no separate restriction was identified in their headers. The current full notice
is preserved as an additional notice, not presented as a 2014/2015 text and not
used to erase the original copyright years. This is a documented attribution
basis for review, not a general rights opinion about other Unicode materials.
The surrounding packages' own missing MIT notices remain separate issues.

Local regeneration evidence: `.tmp/verify-unicode-provenance.cjs` and versioned
source-data files. No private data is involved. The official URLs and exact input
hashes are retained in tracked evidence for independent reproduction.

## Remaining older npm notice gaps

Follow-up evidence is preserved separately in `later-notice-evidence.json` for
LineBreak, Unicode Trie, is-in-browser and redux-throttle. These licence files were
introduced after the installed package revisions, so they are labelled later
evidence and have not silently cleared the original historical notice flags.
The local review draft includes their full text with that qualification.

For all ten packages listed in NOTICE-AUDIT.md, complete recursive GitHub trees
were inspected at their recorded npm gitHead revisions. None contained a path
matching licence/copying/copyright/notice names. Local JS/CoffeeScript/README
header scans did not locate full permission texts. This is bounded evidence of
missing notice files, not a claim that those projects are unlicensed.

Two README badges (get-float-time-domain-data and wav-encoder) point to the author's
`mohayonao.mit-license.org` page. That is a concrete lead for the next pass; preserve
the versioned README link and verify the target's historical applicability before
using it as notice evidence. Other packages may need source-history or upstream
clarification. No maintainers have been contacted and no package upgrades were made.

Local retrieval evidence: `.tmp/release-upstream-followup.json` (tree URLs,
revisions and response hashes), `.tmp/chart-tarball-evidence.json`. Relevant
positive notice text is preserved in tracked `vendored-notice-evidence.json`;
the temporary folder is not a source-publication input.
