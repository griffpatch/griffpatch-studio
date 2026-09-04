# Local source-snapshot preparation

Historical packaging verification, 4 September 2026. The public source preview
is described in the [README](../../README.md). Local paths below are evidence
from development, not public downloads or requirements to recreate those paths.

Private release-planning notes are intentionally not included in this source
preview. Build instructions and licence/source evidence remain available here.

## Packaging contract

`scripts/release-source-stage.cjs` accepts an explicit full commit and a new output
directory. It reads the committed tree and raw Git blobs, verifies every object,
creates a ZIP, then reads the ZIP back and verifies every entry's SHA256. The
manifest records the revision, archive hash, per-file hashes/sizes and executable
modes. It never changes the checkout, creates a tag, publishes or includes history.

Raw blobs are intentional: `git archive` on this workstation converts some LF
files to CRLF. Raw object packaging preserves exact committed bytes and does not
apply export-ignore/smudge filters. Build-source files such as Blocks'
`build/gen_blocks.js` must remain; the name `build` is not proof of generated output.
Tracked build/dist paths are flagged, not automatically discarded.

History/cache/node_modules/local-data paths are refused. Symlinks and submodules
require separate review rather than being followed. Existing output directories
are never overwritten. Untracked and modified working files are excluded.

## Verified dry run

Both repositories packaged and round-trip verified successfully:

- GUI b9605013dce86c8294485bf4384d99bfdb9cb1bd: 3,267 files; 68,278,795-byte ZIP.
- Blocks a505b65a427ccd23fe318f0ccbc09dce39da6395: 300 files; 1,561,857-byte ZIP.

Local artifacts are `.tmp/source-review-gui-b9605013d` and
`.tmp/source-review-blocks-a505b65a4`, each containing source.zip and manifest.json.
They are packaging dry runs, not a selected release pair: the GUI snapshot
predates the packaging tool's raw-blob correction and later release notes. Stage
the final approved commit again into a new directory. Preserve existing candidates.

An isolated Git fixture test additionally proves that dirty changes/untracked
files do not leak, export-ignore cannot silently omit source, binary bytes survive,
and an existing destination is rejected. It deliberately enables Windows CRLF
conversion to exercise the failure discovered in the real dry run.

## Publication review remains distinct

- The known-format credential scan found no private-key, GitHub-token, AWS-key,
  Google-API-key or Slack-token matches in these two ZIPs. This is a heuristic
  check, not proof of absence of secrets, personal material or asset restrictions.
- Flagged GUI files are inherited oldtimey audio, the zero-byte default override
  and tracked test projects/audio. Blocks flags are its three build-source files
  and standard click/delete sounds. Preserve them pending rights/source review;
  do not erase files automatically based on extension.
- Check docs and fixtures for publication suitability, asset attribution and
  corresponding dependency source. Repository snapshots intentionally exclude
  node_modules; these two ZIPs alone are not proof of complete dependency source
  delivery. Include the pinned build toolchain/instructions and modified Blocks.
- Nothing has been uploaded or configured in GitHub/Cloudflare. Final source links
  must point to real published releases, not these local candidates.

```powershell
node scripts/release-source-stage.cjs '<repository>' '<full committed SHA>' '<new output directory>'
node --test test/release/source-stage.test.cjs
```
