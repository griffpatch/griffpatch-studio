# Griffpatch Studio: local preview identity

4 September 2026. Approved working name: **Griffpatch Studio**.
This is a local preview implementation, not name clearance or a public release.

## First pass

### Upstream merge boundary

The remaining identity cleanup uses small overlays rather than changing generated
upstream data. Advanced now uses the local neutral `studio-advanced.svg`. The
settings description uses the existing APP_NAME parameter convention. The two
inherited message IDs that literally name the running app are rewritten by
`src/lib/brand-translations.js` after translations are merged, including es-419.
Do not edit generated-translations.json for fork branding. A focused test flags
new literal TurboWarp mentions there for classification during an upstream merge.

`SHOW_UPSTREAM_NEWS` in brand.js explicitly disables the upstream news component
at its call site. Its current applicability predicate was already false; this
guard prevents a later upstream announcement from speaking on behalf of the fork.
The upstream component and its attribution are retained unchanged.

`scripts/studio-static-assets.cjs` replaces the served privacy.html with a preview
notice pointing to About's existing privacy explanation. The inherited source
policy stays unchanged for merging and is not presented as this fork's policy.
This is not a completed public-release privacy policy. The same build adapter
retains the manifest branding behaviour.

After merging upstream, check the translation hook, menu import/news guard,
settings placeholder and static-copy transform, then run brand-overlays.test.js,
brand.test.js and the focused studio-brand browser tests. No URLs, project IDs,
storage keys, compatibility reporter names or external service names are renamed.
The approved TurboWarp-experiments introduction and upstream credits remain.
These narrow edits reduce merge friction, but cannot guarantee conflict-free merges.

Verified: nine branding unit checks and three targeted real-browser checks
(Advanced in light/dark mode, served privacy notice, metadata/credits/licences).

- Name and **Preview** channel in one shared `src/lib/brand.js` definition.
- Approved pixel-eyes mark (Andy's variant B) on the red rounded-square tile,
  promoted unchanged to the single canonical `static/brand/griffpatch-studio.svg`.
  The separate A/B SVG files have been removed from shipped assets. Raster app
  icons are generated from that SVG with `node scripts/generate-studio-icons.cjs`
  using the existing Selenium/Chrome dependency and a disposable profile.
- Compact menu identity opens About in another tab, preserving the editor.
  Below 1124px it uses just the icon; the title and accessible label retain
  the full name and Preview channel. The inherited 1024px editor minimum remains.
- Browser/editor/project/embedded/settings titles, metadata, favicon, app
  manifest, touch icon and loading splash share the identity.
- The About page preserves upstream credits, links the retained GUI licence
  and trademark notice, and explains the local preview status.
- Feedback no longer goes to the TurboWarp maintainer. Public support is pending.
  The inherited TurboWarp privacy page is not presented as this fork's policy.

The chosen mark and tagline “A playground for TurboWarp ideas.” do not imply
an officially registered brand. The editor remains familiar:
native blocks, colours, themes, keyboard controls and existing projects are not
redesigned. No changes to parser, layout, navigation, playback or native Undo.

## Product description and exposed tools

Describe this as griffpatch's playground for TurboWarp development-UI experiments,
not as a tutorial-recording product. Current examples are keyboard block editing,
Find/jump integration, the resizable minimap and script breadcrumbs.

Do not mention cross-UI visual undo/redo in public-facing descriptions for now.
It exists in this branch but is a separate opt-in experiment,
not enabled in the standard keyboard preview. `src/containers/blocks.jsx` calls
`attachStudioBlockSession`; `src/studio/bridge/studio-block-session.js` only enables
the session/history panel with `studio-session=1`. Without it, the fallback capture
port is also inert unless its separate debug capture flag was explicitly requested.
The current keyboard preview has no Studio panel. Do not advertise recording or
tutorial creation in the About page, homepage, app description or tagline. This
copy correction does not enable, remove or otherwise alter the gated tools.

## Compatibility and attribution boundary

No renaming of package names, module/API identifiers, `tw:` storage keys,
project formats, query parameters, service-worker scope or service endpoints.
No copying projects between origins or resetting user settings. Existing
`LICENSE`, `TRADEMARK`, contributor lists and source copyright notices stay intact.
Old source artwork remains in the repository for historical modes and provenance;
the new primary UI uses its own mark. The default sprite is unchanged.

The upstream source links on About are explicitly not this modified build's
corresponding source. Only an upstream Git remote currently exists. Publishing
an exact source archive/repository is a release requirement, not completed work.

## Before public distribution

1. Confirm name/mark availability and intended relationship to Griffpatch Academy.
   Obtain appropriate legal advice for any uncertain trademark/commercial use.
2. Publish this fork's corresponding source, build instructions, pinned sibling
   modifications and required licence notices; audit each dependency's actual
   pinned licence. This GUI's GPL notice is not a blanket licence for all assets.
3. Audit default/library/tutorial/extension artwork, mascots and third-party
   marks separately. Decide on original default sprite and final icon assets.
4. Identify operator/contact, public support URL, hosting/domain and intended
   audience. Audit inherited network calls, telemetry flags, cloud services,
   extension execution, permissions, local persistence and retention. Write
   an accurate privacy notice before publishing. Localhost is not an offline guarantee.
5. Review inherited external documentation, embedding examples, featured-project
   links, desktop/packager paths and translated copy. New preview copy currently
   falls back to English; changing legacy translation IDs indiscriminately would
   risk regressions and misattribute upstream work.
6. Review with Andy and verify the release build. No remote deployment, domain
   purchase, external account change or claim of legal clearance is authorized
   by this cosmetic local preview pass.

## Verification scope

Run `test/unit/lib/brand.test.js` for the shared title/manifest contract and PNG
dimensions. With `STUDIO_BROWSER_URL` pointing at a separately built preview,
run `test/integration/studio-brand.test.js` for light/dark actual keyboard
creation, native project-title editing, compact menu bounds, opening About
without losing the edit, built icons/metadata/licence links and Addons title.
Screenshots and logs are local artifacts under `.tmp/studio-brand-*`.
These are risk-based branding checks, not a claim of complete Studio regression
or production/compliance readiness. Fixed review details are in the Keyboard
Lab `REVIEW.md`. Existing served snapshots must never be overwritten or stopped.
