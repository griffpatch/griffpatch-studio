# Unmodified upstream baseline

Date: 23 August 2026  
Branch: `studio/spike-1`  
TurboWarp GUI: `a2946eeb9a9dca7857d7ab53d766b54288c7a2ff`

This baseline was captured before adding Tutorial Studio implementation code. Known upstream/toolchain failures are recorded so they are not mistaken for Studio regressions.

## Environment

- Windows 11 build 26200
- Node.js `24.18.0` (matches `.nvmrc` major version)
- npm `11.16.0`
- Google Chrome `151.0.7922.170`
- pinned ChromeDriver `117.0.5938.92`

Exact GUI dependency commits are in [UPSTREAM_BASE.json](UPSTREAM_BASE.json). The GUI lockfile is authoritative for the spike.

## Results

| Check | Result | Notes |
|---|---|---|
| `npm ci` | Pass | 1,926 packages installed; worktree remained clean |
| `npm run test:unit` | Pass | 1 suite, 33 tests |
| production `npm run build` | Pass | Webpack completed with upstream asset-size warnings |
| `npm run test:lint` | Known upstream failure | 38 errors in existing addon/menu/monitor/sound/uploader files |
| `npm run test:integration` | Environment-blocked | All active Selenium suites fail to create a session because ChromeDriver 117 cannot drive Chrome 151 |

The installation audit reports 102 vulnerabilities: 11 low, 32 moderate, 48 high and 11 critical. No automatic audit fix was run because that would change the upstream dependency graph and lockfile. Dependency/security review is separate from proving the Studio event model.

## Studio regression policy

- Studio-owned lint and unit tests must pass even while the recorded upstream lint failures remain.
- A production build must continue to pass.
- Browser contract tests must use a controlled browser/driver pair rather than the currently mismatched upstream Selenium setup.
- Changes must not increase the upstream lint-error allow-list.
- The worktree must remain clean after dependency installation and generated builds.
