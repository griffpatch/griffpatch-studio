# Licence and source release preparation

Status: draft release gate, 4 September 2026. Practical compliance preparation,
not legal advice or confirmation of clearance. Confirmed intended host:
studio.griffpatch.academy using Cloudflare Workers Static Assets. Nothing is deployed.

## Preserve, do not relicense

- Root LICENSE and package.json retain the existing GUI GPL-3.0 declaration.
- FORK-NOTICE.md identifies modifications and preserves upstream notices.
- The installed scratch-blocks package declares GPL-3.0. Local source is the
  sibling scratch-blocks repository at a505b65a427ccd23fe318f0ccbc09dce39da6395.
  Its working tree was clean at inspection. Include that source, not only the
  upstream develop-builds reference from package-lock.json.
- The installed scratch-vm 2.1.46 package declares MPL-2.0. There is no sibling
  scratch-vm checkout here. Its installed package files matched a fresh locked
  installation in the 4 September clean-build check; see CLEAN-BUILD.md for the
  comparison scope and reproducible source/build inputs.
- Bundled Scratch Addons and copied/adapted addon code need their original
  notices and provenance. Do not apply a replacement proprietary GUI licence.
- Library artwork, sounds, extensions and the Griffpatch Studio mark need a
  separate rights/provenance review. A code licence is not brand clearance.

## Exact source delivery gate

1. Tag the GUI release and pin every modified sibling/dependency source.
2. Run scripts/release-inventory.cjs to record the installed direct dependency
   versions, declared licences, source references and available notice files.
   This is an inventory, not a complete transitive licence/compatibility audit.
3. Verify installed dependencies against the lockfile, include local patches and
   native build instructions (including scripts/use-local-studio-scratch-blocks.ps1).
4. Rebuild from a clean separate checkout using the pinned Node/npm versions and
   npm ci, with the documented local Blockly build/link step. Compare output and
   run the release tests. Do not clean the user's development workspace.
5. Publish the exact corresponding source archive/repository and instructions
   with the release, retaining licences and copyright notices. Set the About
   source link to that real destination. Approved repository names are
   griffpatch/griffpatch-studio and griffpatch/griffpatch-studio-blocks, not yet
   published; do not
   substitute the upstream link or claim local commits have been published.
6. Include third-party licence/notice files for all distributed components,
   check source-map content and exclude .tmp, user projects and private material.

Official references: [GPLv3 sections 4–6](https://www.gnu.org/licenses/gpl-3.0.html)
and [GNU licence FAQ](https://www.gnu.org/licenses/gpl-faq.html). Obtain legal
advice for uncertain combinations, artwork rights or trademark use.

## Initial installed-package inspection

The direct runtime inventory contains 66 entries. Legacy `licenses` arrays are
included, not misclassified as absent. balance-text declares Apache 2.0;
keymirror declares Apache 2.0 and carries its notice in index.js; raw-loader
declares MIT and mentions it in its README. omggif has no package licence field
but carries the MIT permission/copyright text in omggif.js. Include source-header
notices as well as standalone LICENSE files in the final notice audit. These
observations do not complete the transitive review or establish compatibility.

## Clean-build gate update

The pinned local Blocks source and fresh GUI checkout built successfully in
production mode, with five focused real-browser smoke cases passing. See
[CLEAN-BUILD.md](CLEAN-BUILD.md) and `clean-build-checkpoint.json`. Java 11 must be
on PATH for the Blocks build, and installing its freshly compiled bundles is a
required explicit step. This does not close source-publication, transitive
notices, privacy or release-regression gates.

The current notice/source preparation is tracked in
[NOTICE-AUDIT.md](NOTICE-AUDIT.md) and the [README](../../README.md):
production module mapping, ten pinned notice supplements, ten remaining directly
represented package flags, and separate font/vendored/copied-asset findings.
[FONT-NOTICES.md](FONT-NOTICES.md) records seven font metadata/hash comparisons.
[VENDORED-NOTICES.md](VENDORED-NOTICES.md) records the exact Chart.js distribution
match, its embedded colour-library notice, exact TinyColor Addons import and
Unicode data comparison. Scanner reports remain draft evidence, not public clearance.
