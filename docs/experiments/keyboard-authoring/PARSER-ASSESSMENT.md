# Keyboard authoring parser assessment

Assessed 30 August 2026 on `experiment/keyboard-authoring`.

## Verdict

The bundled Scratch Addons `WorkspaceQuerier` is fit for purpose as the keyboard author's **text-to-block grammar engine**. It should remain the foundation rather than being replaced with a second parser. It already handles native block enumeration, localized labels, partial commands, dropdown values, nested reporters and statements, quoted literals, connection-shape legality, ambiguity and Scratch-style operator precedence.

It is not fit to own the complete editor experience by itself. Caret context, native connection validation, project identity creation, suggestion presentation, preview lifecycle and final native Blockly mutation correctly remain in the Keyboard Lab adapter. Keeping that boundary makes the parser reusable and prevents textual matching from silently deciding structural edits.

## Evidence

The direct parser contract now contains **190 passing tests** across three suites. It combines 59 focused `WorkspaceQuerier` cases, three earlier catalogue/parser cases and a 128-test realistic core corpus. Focused coverage of `WorkspaceQuerier.js` is **95.13% statements, 92.33% branches, 95.71% functions and 96.07% lines**. The separately lower figure for `BlockTypeInfo.js` is expected because its live Blockly/flyout enumeration belongs to browser integration rather than this synthetic grammar suite.

The matrix covers:

- indexed, cleared and replaced catalogues, including repeated independent queries;
- empty input, case folding, ordinary and non-breaking whitespace, prefixes and truncation;
- decimal, signed, exponent, hexadecimal and Infinity number forms, plus invalid numbers;
- exact six-digit colours and malformed colours;
- localized multiword dropdown labels, stable internal values and filtered action rows;
- existing variable identities with spaces, camelCase, uppercase, punctuation, digits, connective words and embedded quotes;
- partial disambiguation of `my score` from `myScore`, plus explicit retention of names differing only by case;
- exact-case ranking among otherwise identical variable identities;
- project-wide broadcast IDs preserved across differently ordered sprite catalogues;
- sprite-local variable isolation alongside one shared global identity;
- a 300-entry realistic variable menu without exhausting parser limits;
- plain, quoted, escaped and empty string literals;
- round and Boolean reporters nested in compatible inputs;
- illegal round-to-Boolean placement and selection of the shortest useful illegal diagnostic;
- C-block statement bodies, Boolean conditions, hats excluded from mouths, and root hats/caps;
- multiplication precedence, parentheses and left association;
- incomplete closing parentheses;
- ambiguous commands that must retain both valid interpretations;
- query result limits and a focused catalogue containing a recursive operator.
- 118 representative core blocks across Motion, Looks, Sound, Events, Control, Sensing, Operators and Data;
- a proper, non-truncated parse of every canonical corpus phrase, not merely a fuzzy opcode match;
- every corpus phrase repeated with seeded case and internal-whitespace variation;
- 750 seeded malformed inputs, 200 repeated-query determinism checks and six explicit adversarial inputs;
- adjacent native punctuation such as `set volume to 100%`, while retaining punctuation inside authored text.

The complete supported source gate passes **1119/1119 tests across 101 suites**. The Keyboard Lab unit directory passes **425/425 tests across 28 suites**.

The live-catalogue boundary now has real-editor coverage across Pen, Music and Video Sensing. Pen exposes four real flyout templates; Music exposes drum, rest, note, instrument and tempo templates. Video Sensing adds a hat, reporter, dropdown command and numeric command. The keyboard author parses these without a second extension vocabulary. German and French editors both parse ordinary rendered labels and icon-bearing labels. All five Music commands were authored in the mutable candidate. The exact immutable build separately authored drum and rest as one stack, passed native Undo/Redo, authored French green-flag and clockwise blocks, then passed a translated French Music menu/history workflow and the mixed-shape Video Sensing matrix. The corresponding Selenium cases are committed, but a standalone run could not acquire its Chrome driver in the restricted network and is not claimed as a pass or a product failure.

All 18 bundled locale loaders are covered directly. English and ten generated non-English locales supply the complete three-icon message set; seven generated locales do not contain those upstream messages and correctly use the established English fallback. This verifies the loader contract without inventing translations the bundled source does not provide.

Suggestion-category presentation also uses Scratch's existing locale messages. Internal parser identities remain stable English IDs for ranking and colour semantics; only the Keyboard Lab badge is translated. Japanese `10 歩動かす` and the icon-bearing `緑の旗 が押されたとき` parse, insert and retain exact native history with `動き` and `イベント` badges. This is evidence for non-Latin parser matching and browser input, not certification of an operating-system IME.

A separate non-gating performance probe used 127 block templates, 300 variable identities and 80 broadcast identities. Across 1,000 alternating exact variable/event queries on this machine, indexing took **2.008 ms**, average query time was **0.254 ms**, p95 was **0.357 ms**, maximum was **4.282 ms**, and no query reached a parser limit. These are local measurements, not timing assertions, but they do not support replacing the parser for speed.

## Defects found and corrected

The test programme demonstrated eight contained parser or catalogue-boundary defects and prediction weaknesses:

1. `QueryResult.isTruncated` could become numeric `1` because Boolean state used bitwise OR. It now remains Boolean.
2. The shortest illegal completion was never selected because a number was compared with the candidate string rather than the previous string length.
3. Operator ordering mutated the caller's catalogue and could insert an `undefined` provider when a valid focused catalogue was shorter than the full Scratch flyout. The parser now arranges a private copy and retains the supplied position when no reserved operator position exists.
4. Case-colliding identities such as `score`, `Score` and `SCORE` were all retained safely, but were ordered by flyout position. Otherwise equivalent matches now put the exact typed case first while retaining every case-insensitive alternative.
5. A number immediately followed by native label punctuation could not complete properly, so Scratch's natural `set volume to 100%` required an artificial space. Number tokens now stop at adjacent label punctuation while string literals retain both interpretations.
6. Proper matching of a multiword localized label required its exact internal spacing even though fuzzy matching already normalized the same words. Proper label and menu matching now uses those existing word parts, accepting harmless extra spaces without losing truncation semantics.
7. `BlockTypeInfo` asks its locale callback for icon labels with a leading slash, while the existing Addons locale JSON stores the same identifiers without that slash. Ordinary German text therefore worked while green-flag and rotation-icon blocks silently remained English. A small adapter now normalizes that established boundary and lazily loads the active existing Addons locale chunk; it does not add another translation table.
8. The bundled `BlockTypeInfo` treated any extension using default extension colours as Pen, so Music suggestions were labelled `pen`. Category identity now comes from the extension opcode and the VM's localized live extension metadata, with the extension ID as a safe fallback. There is no per-extension mapping table.

These are compatibility-preserving corrections. They do not change the native block catalogue, the supported grammar, project state or Blockly history.

## Strengths worth preserving

- **Native vocabulary:** `BlockTypeInfo` derives candidates from the actual flyout instead of maintaining a parallel opcode dictionary.
- **Localization:** matching uses rendered labels and dropdown strings, not English-only command tables.
- **Compositional grammar:** nested reporters, Boolean expressions and statement bodies use the same block metadata recursively.
- **Ambiguity retention:** multiple legitimate interpretations survive for the UI to present; the parser does not guess project intent.
- **Bounded work:** explicit result, token and string-form ceilings prevent an unbounded search.
- **Native output model:** a successful result produces `BlockInstance` trees which the adapter can translate into one native XML operation.

## Code-quality finding

The parser is more capable than its previous test count suggested. It is not a simplistic word completer: it builds recursive token providers, retains ambiguous parse trees, applies Scratch-specific precedence and understands native field descriptors. The measured identity-heavy workload is comfortably fast.

The concern is maintainability rather than basic competence. Correctness depends on provider order and cache behaviour, several responsibilities live in one large file, and the relevance score is deterministic grammar heuristics rather than a modern predictive model. That makes changes harder to review and explains why small defects survived. The new contract substantially reduces that risk, but it does not make the internal design easy.

## Limits and better implementation opportunities

The implementation is clever but ordering-sensitive and difficult to reason about. Provider caching is part of correctness as well as performance, so a wholesale cleanup risks subtle precedence and nesting regressions. Replacing it now would trade mature Scratch coverage for a new collection of edge cases.

The worthwhile improvements are incremental:

1. Put the parser behind the existing catalogue adapter and treat that adapter as the swappable interface. This is already substantially true.
2. Eventually replace the operator-position swapping algorithm with an explicit, stable provider-order construction. Do this only with the new corpus plus full live-catalogue equivalence checks; the current defensive correction intentionally avoids that behavioural rewrite.
3. Add structured match metadata such as exact/prefix/fuzzy status, consumed spans and incompatibility reason. Today the Keyboard Lab has to derive part of that from text and connection shape.
4. Keep editor context out of the grammar. Rank and filter by caret connection, selected identity and protected topology in the completion layer, as now.
5. Keep the new bounded property/fuzz corpus and the representative live-flyout browser equivalence checks when changing enumeration. The committed unit corpus deliberately covers stable core grammar and every bundled locale-loader fallback; more extension families and renderer-specific fields remain browser responsibilities.
6. Keep local changes to the bundled add-on small and separately documented so upstream Scratch Addons updates remain easy to compare and merge.

If suggestion quality later needs more sophistication, improve or replace only the **ranking policy**, not the grammar. A contextual ranker can consume the parser's candidate trees plus caret shape, exact-case identity, recent use and project scope. That is lower risk than teaching a new parser every Scratch block and localization rule.

## Decision

Do not rewrite the parser. Continue using it as a mature, localized candidate grammar behind a narrow adapter. Improve its diagnostics and provider ordering incrementally when a measured editor need justifies the risk. A future alternative parser can be evaluated behind the same adapter against this contract suite, without rewriting the keyboard navigation or native-editing system.
