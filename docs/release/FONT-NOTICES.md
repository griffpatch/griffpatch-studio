# Font attribution preparation

4 September 2026. Evidence for the seven local editor fonts, not a complete
application asset notice bundle. Do not apply a single blanket font licence.
No font binaries were rewritten, renamed, subsetted or converted by this work.

The exact embedded metadata (including original spelling, copyright names,
reserved font names and modification statements) is retained in
`font-evidence.json`, with SHA256 for each file. All seven local WOFF2 files match
the installed `scratch-render-fonts/src` files byte-for-byte. That dependency is
pinned by package-lock to TurboWarp/scratch-render-fonts revision
`7b6768fc6dfef6b343a06f992587b74807043961`, not the different repository URL in
its inherited package.json. The previously checked clean installation matched
the installed dependency; see CLEAN-BUILD.md.

| Font | Embedded attribution | Embedded licence evidence |
| --- | --- | --- |
| Grand9K Pixel | Grand Chaos Productions, 2009–2013; designer Jayvee D. Enaguas (Grand Chaos) | CC BY-SA 3.0 URL |
| Griffy | Font Diner, Inc DBA Neapolitan, 2012; reserved name Griffy | OFL 1.1 |
| Handlee | Admix Designs, 2011; reserved name Handlee; designer Joe Prince | OFL 1.1 |
| Knewave | Tyler Finck, 2011 | OFL marker; verify version against originating release |
| Noto Sans Medium | Google Inc., 2015 | OFL 1.1 |
| Scratch Savers | Pablo Impallari, Rodrigo Fuenzalida and Igino Marini, 2012; reserved name Life Savers; valadaptive modifications, 2024 | OFL 1.1 |
| Source Serif Pro | Adobe Systems Incorporated, 2014–2016; reserved name Source | OFL 1.1 |

The local OFL.txt names Londrina; preserve it, but do not substitute that copyright
line for these fonts' actual authors. The final downloadable notice set must retain
the individual metadata above and appropriate full licence terms. The official
[OFL text](https://openfontlicense.org/open-font-license-official-text/) explains
copyright/licence retention, reserved-name rules and permitted embedding.
Grand9K Pixel's embedded licence is
[CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/), with separate
credit/link and adaptation conditions. Do not relabel it OFL or silently upgrade
it to CC BY-SA 4.0. Its metadata also retains the original creator URL:
http://grandchaos9000.deviantart.com/.

This identifies evidence, not a new licence grant or complete compatibility
opinion. Before marking this gate complete, confirm originating font releases and
inherited conversion/subsetting history (including Knewave's abbreviated OFL
marker), retain suitable source/attribution links, and review other copied fonts
outside this seven-file folder. Existing third-party modification notices must
remain intact, particularly Scratch Savers' metrics/features changes.

## Reproduce

Use audit-only Python packages fonttools 4.59.2 and brotli 1.1.0 in an isolated
environment, not the editor's runtime dependencies. The parser reads font name
tables without saving the fonts:

```powershell
python scripts/release-font-audit.py src/lib/tw-scratch-render-fonts node_modules/scratch-render-fonts/src
node --test test/release/font-evidence.test.cjs
```

Name IDs retained: 0 copyright, 1 family, 3 unique identifier, 5 version,
7 trademark, 8 manufacturer, 9 designer, 11 vendor URL, 12 designer URL,
13 licence description, 14 licence URL. Keep the original strings in the JSON;
the table above is only a readable summary.
