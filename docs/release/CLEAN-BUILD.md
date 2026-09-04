# Clean production build check

Verified locally on 4 September 2026. This is a source-build and focused smoke
check, not permission to deploy or a completed public-release audit.

## Result

- Fresh, detached local clones of GUI `72f4e9650` and Scratch Blocks
  `a505b65a427ccd23fe318f0ccbc09dce39da6395`; no copied `node_modules`, generated
  assets or existing build directories.
- GUI `npm ci --no-audit --no-fund` passed without changing its lockfile.
- Blocks dependency installation initially failed because Java was absent from
  PATH. With the existing Temurin Java 11 runtime on the command's PATH,
  `npm run prepublish` compiled the pinned source successfully. No source patch
  or dependency upgrade was necessary. A fresh installation should set Java's
  PATH **before** running Blocks `npm ci`.
- Both freshly compiled Blockly bundles match the working installation byte
  for byte. The GUI installer verified the required native hooks and copy hashes.
- Production `npm run build` passed, emitting the application and library builds.
- Five isolated Chrome browser cases passed against the production application:
  compact Keyboard control, typed `say` input, anchored cleanup/Undo/Redo at
  100% and 170%, and mouse context-menu cleanup/Undo/Redo. Screenshot inspection
  also confirmed the branded editor and minimap rendered.

All files in installed `scratch-vm`, `scratch-paint` and `scratch-render` matched
the clean locked installation (excluding nested `node_modules` and `.git`).
For `scratch-blocks`, only the two documented compiled bundles differed from
the locked upstream package before the local install step. This comparison is
not an audit of every transitive package.

## Prerequisites and exact inputs

The tested inputs and hashes are in `clean-build-checkpoint.json`. Toolchain:
Windows, Node 24.18.0, npm 11.16.0, Python 3.13.3, Temurin Java 11.0.32.1+1.
Git and internet access are required for locked dependencies and the GUI's
SHA256-verified micro:bit asset download. npm's cache may be reused; application
dependencies and build output must not be copied from the working checkout.

The GUI lockfile pins upstream Blocks, **not our modified Blocks source**.
Consequently, plain GUI `npm ci && npm run build` does not reproduce this fork.
Keep the Blocks revision and the explicit install step with every release.
Do not replace these with whatever happens to be in the sibling working tree.

## Repeating the build

Create two fresh checkouts at the manifest revisions. A public source location
has not yet been selected; local clones were used for this check. Do not run the
following commands in a directory serving a live review or containing user work.

```powershell
# In the fresh Blocks checkout, after checking out its pinned commit.
# Set these paths to the installed Java 11 and Python 3 runtimes.
$env:Path = '<Java 11 bin>;<Python 3 directory>;' + $env:Path
npm ci --no-audit --no-fund
if ($LASTEXITCODE) { throw 'Blocks installation/build failed' }

# In the fresh GUI checkout at its pinned commit.
npm ci --no-audit --no-fund
if ($LASTEXITCODE) { throw 'GUI installation failed' }
./scripts/use-local-studio-scratch-blocks.ps1 -ScratchBlocksPath '<fresh Blocks checkout>'
$env:NODE_ENV = 'production'
$env:CI = '1'
npm run build
if ($LASTEXITCODE) { throw 'GUI production build failed' }
```

The tested Java executable was
`D:/dev/twstudio/.tools/temurin-jre11/jdk-11.0.32.1+1-jre/bin/java.exe`.
That is a local tool installation, not an application source dependency.
The build uses the locked local Closure compiler, not its old online fallback.
No global PATH or Git configuration was changed.

For the focused browser check, serve `build` on localhost, then run in the GUI
checkout (Chrome installed; Selenium can locate its driver, or set
`CHROMEDRIVER_PATH` to a matching driver):

```powershell
$env:STUDIO_BROWSER_URL = 'http://127.0.0.1:8800/editor.html'
node node_modules/jest/bin/jest.js test/integration/keyboard-authoring.test.js --runInBand --testNamePattern='bare say completion|Clean-up\+|compact Keyboard control'
```

Never overlap browser suites or rebuild the directory being tested.

## Evidence and remaining gates

Local evidence root: `D:/dev/twstudio/.tmp/release-clean-20260904`.
Logs: `gui-install.log`, `blocks-install.log` (initial Java failure),
`blocks-build.log` (successful retry), `gui-production-build.log`, and
`production-browser-smoke.log`. Browser screenshots/JSON are in the isolated
GUI's `.tmp/keyboard-authoring-evidence`. These local test artifacts are not
part of a source distribution. Existing review 8799 was not rebuilt or changed.

Warnings remain: old Browserslist data, deprecated dependencies/plugin APIs,
large production bundles, one Closure JSDoc warning, and npm's unapproved
optional core-js postinstall message. No blanket upgrades or audit fixes were
performed. The build and browser smoke passed despite these warnings.

This proves a fresh source build on this toolchain. It does **not** establish
cross-platform support, bit-identical GUI builds across machines, comprehensive
browser compatibility, security clearance, or a complete release regression run.
Only the two rebuilt Blockly bundles were checked for bit-identical output.

Before release: choose/publish exact corresponding source and build instructions,
complete the transitive notice/artwork audit and privacy/operator/hosting details,
then run the agreed release regression gate against the actual release artifact.
Do not publish `.tmp`, private projects, local clones or tool caches as a shortcut.
