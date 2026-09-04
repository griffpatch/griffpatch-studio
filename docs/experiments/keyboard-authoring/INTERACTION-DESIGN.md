# Scratch keyboard authoring: interaction decisions

This is the keyboard-authoring design record, not a claim that every row below is implemented. See [TESTING.md](TESTING.md) for the regression-test strategy. Private development diaries are not part of the public source preview.

## The organising principle

There is one Scratch project and one set of native block connections. The keyboard adds an authoring method, not a second source language or a second undo engine.

Two kinds of caret are useful:

- A **structural caret** chooses a command, input, field, or insertion boundary. It is anchored by identity and derives pixels from the current block layout.
- A **text caret** edits an actual string in a normal browser input. Selection, clipboard, composition, and text undo remain browser behaviour. The structural caret must not steal these keys.

A structural caret can also occupy **free workspace space**. It is a provisional insertion location in workspace units, not a block, connection, or edit. Spatial arrows move that one caret without creating project data.

A draft is intentionally incomplete. It can preview several interpretations without putting any of them in the project. Acceptance is a single grouped native edit. Cancellation has no project effect.

## Keyboard grammar

| Context | Expected action | Current experiment / next decision |
| --- | --- | --- |
| Command selected, Enter | Open an insertion draft below the command | A new line, not a second visit to inputs; the existing tail stays connected |
| Command selected, End then Enter | Add at the end of the current statement chain | Stops on the final cap when no insertion below is legal; Enter alone still inserts directly below the selected command |
| Command selected, Shift+Enter | Insert before that command | Browser-tested for a middle command and top-level root |
| Insertion boundary, typing | Start a draft there | Implemented |
| Non-empty draft, Enter | Accept the selected compatible completion, then visit its first input | Default and explicitly supplied values both follow inputs-first |
| Empty draft, Enter | Split the continuation off as a new stack | Implemented; undo restores the connection |
| Held Enter | Do not manufacture an extra blank line or split | Implemented with a keyup boundary, not just `event.repeat` |
| Draft, Escape | Cancel the candidate; retain the active structural insertion caret | Project and native history remain unchanged |
| Structural caret, Escape | First press offers exit; second distinct press leaves keyboard mode | No timer; auto-repeat cannot confirm. Another key, click or focus change cancels confirmation. Closing a draft, field, menu or dialog does not arm it. Alt+K/toggle still exits directly |
| Draft, Up/Down | Choose another suggestion | A sole literal-value choice is accepted and navigated vertically instead |
| Draft, Left/Right/Home/End | Move the real text caret | Browser behaviour |
| Draft, Tab | Complete a block name, or accept a literal and advance | Block completion is native undoable text; a literal is a native field edit |
| Structural caret, Left/Right | Explore only the current command's inputs and nested expressions | Never enter or leave C mouths or follow top/bottom connectors; Left on a reporter returns to its expression owner |
| Structural caret, Up/Down | Visit whole commands in visual order | Skip value/Boolean inputs and occupied insertion boundaries; empty mouths and stack ends remain writable |
| Hatless top-level command or its input, Up | Open insertion above that script | The next Up continues to the nearest same-column script above, even when one was already visible |
| Structural caret, Home/End | First command / tail insertion point of the current statement chain | C-mouth branches are separate scopes; nested value inputs use their owning command's chain; a free workspace caret stays put |
| Structural caret, Ctrl/Cmd+Home/End | First command / legal outer tail of the entire current script | Does not stop inside a nested C body; native text editors retain their own Home/End keys |
| Structural caret, Shift+Home/End | Extend a sibling range to the current chain's first/last command | Preserves the anchor; never crosses into a different C mouth |
| Horizontal row boundary, Left/Right | First press shows a small directional cue; second distinct same-direction press crosses columns | Includes commands inside C bodies and insertion carets. No timeout; held auto-repeat cannot confirm; another action or focus change cancels the pending exit |
| Free workspace caret, Left/Right | Move columns immediately | No double press; use existing column anchors or a stable adjacent empty column |
| Free workspace caret, Up/Down | Move 96 workspace units vertically, stopping at a script or neighbouring script-head alignment; reach up to 24 units further if the step falls just short | Same-column legal head/tail insertion wins; hats/caps select the real block instead. Adjacent-column head baselines offer free-space snap points, not a move into that column |
| Structural caret, Tab/Shift+Tab | Traverse blocks and inputs | Skip occupied mouths and between-command gaps; one stop per value/reporter, no duplicate wrapper |
| Field selected, Enter | Open the native field editor | Native menus and text editors remain available |
| Scalar variable field selected, typing or Delete/Backspace | Compose a variable name and scope | Existing name is selected; an explicit choice creates and uses the variable |
| Other non-shadow field selected, printable key | Open the native field editor | Broadcast/list menus and other fields are unchanged |
| Number/text slot selected, printable key or Enter | Compose a value or expression at that same slot | Existing value is selected; compatible reporters and an explicit literal choice share the suggestion list |
| Literal value draft, Enter / Tab | Accept and advance to the next structural stop | No extra shadow-field stop; Shift+Tab goes back |
| Reporter selected, Enter | Visit its first input; an input-free reporter continues after itself | A loose reporter has a final new-script boundary instead of trapping focus |
| Number/text slot selected, F2 or a real field click | Open Scratch's native value editor | Native text editing remains available without the composer |
| Menu/colour slot selected, Enter | Open its native picker | The shadow and its field share one stop |
| Native field editor, Tab | Finish field edit, advance to the next stop | Implemented; native dropdown focus also returns to structural editing |
| Block selected, Delete | Native delete and retain the replacement site | The owning value/Boolean hole, stack boundary, C mouth or original loose-block position stays ready for typing |
| Block selected, Backspace | Native delete and select the previous eligible block | Previous command for statements, previous real block in the same expression row for reporters; no jump to another script |
| Literal slot selected, Delete/Backspace | Start a value draft and delete its selected text | The project remains unchanged until acceptance; cancellation is safe |
| Native field, Delete/Backspace | Native text deletion | Retains Scratch's existing field-history granularity |
| Gap selected, Backspace | Potentially join stacks or select previous command | Deliberately not a silent destructive action yet |
| Ctrl/Cmd+Z in real input | Text undo first | Browser/native field ownership; no project-level interception by this experiment |
| Ctrl/Cmd+Z at structural caret | Existing native or Studio history | Not replaced |
| Finder result, F3 / Shift+F3 | Next / previous instance in the current result carousel | Ctrl/Cmd+G and Ctrl/Cmd+Shift+G are aliases; preserve Finder text focus while searching, structural focus after accepting a result |
| Finder search, Enter | Close search and return to the selected block's structural caret | Works with an already accepted pending cross-sprite navigation; never activates disabled Keyboard mode |
| Finder search, Escape | Clear a nonempty search, then close it on the next press | Full cancellation restores the search origin, including sprite, camera and exact structural location, without adding preview stops to Back/Forward |
| Structural caret, Ctrl/Cmd+Left/Right | Shared Finder/Jump Back/Forward | Return to the exact saved operand/field/gap/range as well as sprite and camera; ordinary local arrows are not history entries; native text editors keep their own meaning |
| Structural caret, Alt+S | Show current script | Smoothly frame the script head at 32px top/left padding; prioritise the complete caret above two-thirds of the usable editor height and keep wide active inputs visible. Preserve zoom, selection and native edit history. Free carets frame their placeholder. Ctrl/Cmd+Left restores the exact previous view, even if the caret was offscreen. Finish or cancel a text draft/native field edit first. |
| Manual sprite/Stage change | Remember each target's structural location | Restore after native workspace loading; keep DOM focus on the picker until Code or the workspace is explicitly chosen |
| Costumes/Sounds then Code | Resume the current sprite's structural location | Explicit Code click restores typing focus; switching panels is not an explicit Keyboard mode-off |
| Draft or native text edit, F3 / Ctrl/Cmd+G | Retain the unfinished edit | Finish or cancel before cycling; no silent acceptance or loss of text |
| Complete `define name`, Enter | Create with screen refresh enabled | A typed declaration is already explicit; the first suggestion is ready for Enter |
| Complete `define name`, second suggestion | Run without screen refresh | Sets the native warp flag; Tab can complete `:: warp`, and a typed suffix makes this variant first |
| Partial `define name (arg`, Enter | Keep the preview without creating anything | Malformed signatures remain disabled; reusing an existing signature retains its existing execution policy |
| Ctrl/Cmd+Space in a draft | Complete the selected candidate's text without inserting it | Uses the browser-undoable text path; creation still requires explicit Enter/click acceptance |
| Block selected, Ctrl/Cmd+C or X | Copy or cut its complete connected subtree | Native XML and native grouped events; cut is one Undoable operation |
| Structural insertion site, Ctrl/Cmd+V | Paste the copied subtree if its native connections fit | Occupied real expression inputs and incompatible statement splices are protected |
| Block selected, Ctrl/Cmd+D | Duplicate its complete connected subtree with a native offset | One grouped native edit; no private block graph |

## Structural cases

### Statements, hats and end caps

Insertion is connection-typed. A reporter cannot be accepted as a statement; a hat cannot attach below a command. A cap such as `stop all` cannot silently discard a continuation. Show the best textual match disabled and say why it does not fit, rather than quietly selecting another command.

At an unconnected top-level boundary, a hat or ordinary statement is valid. New-script placement should avoid other scripts, then pan minimally if needed. Double Enter is a structural split, not a deletion of the lower half.

Up on a hatless root (including one of its inputs) opens its legal before-boundary. Another Up continues to the nearest same-column script above; without one it stays put. Shift+Enter also deliberately opens a before-boundary. Hats cannot offer an attachment they do not have. Down at that boundary returns to its own command, typing inserts above, and horizontal departure uses the same deliberate two-press column rule as other anchored locations. Tab/Shift+Tab retain document-wide traversal. The generic outline ends at the existing stack's upper notch instead of covering the first command. Preview and acceptance use the same native connection alignment, placing the new block above the receiver without moving the existing stack.

### Separate directional paths

Column placement follows the first native text-row baseline, not the top of a
hat's curved outline or the height of a whole C block. Full selection bounds still
choose the neighbouring block; the original row baseline remains in horizontal
lane memory. Preview and acceptance use the same alignment, including a tall
first input. Textless/unrendered blocks fall back to their native origin. A free
caret's vertical steps stop at crossed script-head baselines in the nearest
occupied column on either side; already aligned heads do not trap the next key.
Nested command rows are not extra snap stops, avoiding sticky dense workspaces.
If a step falls just short, it can reach 24 workspace units further in that
direction to finish at the guide or same-column boundary. More distant targets
keep the ordinary step; a nearer crossed target still wins. There is no backwards
magnetism or per-zoom pixel threshold.

Up/Down project the native structure onto whole commands and usable empty boundaries. A simple stack reads: whole command A, whole command B, final insertion. There is no extra stop between connected commands. A C block adds its body commands (or an insertion point if empty) and body-end insertion before its outer continuation; then and else bodies follow native input order. Nested C bodies follow the same rule. A cap has no invented lower connection. From a field or nested expression, vertical movement is relative to the owning command and never enters another expression slot. Down after the final insertion (or on a cap) continues to the next same-column script, or proposes an aligned new script beneath the column. Up from an upper insertion continues to the preceding script's outer tail. Enter/Shift+Enter and End explicitly open occupied boundaries when wanted.

Left/Right follow only the command's inline inputs and expression children. Right enters a real reporter as one block stop before its operands, and continues to the enclosing expression's next operand when available. Left on a selected reporter returns to its immediate expression owner. C mouths are not inline portals: horizontal arrows never enter a body from its header, return from a body command or empty mouth to the owning C block, or choose a following command or insertion boundary. Up/Down handle statement rows and mouths. Tab remains document-wide, also skipping occupied insertion boundaries.

These are two projections of one semantic stop list, not separate navigation states or guessed screen coordinates. Native input connections establish expression ownership, statement connections establish body ownership, and next connections retain the current body owner. The distinction does not depend on block opcode or label.

Once inline traversal has no further destination, horizontal movement can leave the script from any command row, including rows inside C bodies. Its first attempted crossing stays on the current selection and shows a restrained directional cue. A second distinct press in the same direction crosses; holding the key does not. There is no double-click timer. Any other action/focus change clears the pending crossing. Nested reporters can leave their expression owner structurally; body commands do not climb to the C owner first. Whole-selection height determines the best row in the immediately adjacent column; a distant diagonal script does not steal a free-space destination. Column anchors use stable left-edge grouping, and Tab reads those columns top-to-bottom.

A free caret is explicitly exempt from the two-press rule. Left/Right immediately follow existing or remembered empty columns. In a new column, Up/Down move in 96-unit steps and cannot skip a script head/tail encountered along that step. The native root determines whether the encounter is a real block or writable connection. Navigation never inserts a block, changes native Undo, or rearranges stored scripts. The existing presentation-only placeholder can reserve space without changing those stored positions.

Horizontal destination search includes every command row in a column, including
commands nested in then/else and deeper C bodies. It is not restricted to the
outer statement chain used for a script's vertical head/tail. Retain the original
vertical band during both departure and return. When a C and its child share a
centre, prefer the candidate whose full height best matches that band. This keeps
a whole-C selection intact but also lets a nested command return to its own row.
The search uses current geometry, not a saved source ID: moving vertically in
free space starts a new band and can enter a different body row.

Consecutive spatial Left/Right crossings preserve the original selected **vertical band**, including a whole C block or sibling range, in workspace units. A tall intermediate command must not pull the next destination down towards its centre. Reversing horizontal direction retains the band; ordinary inline traversal, Up/Down, Tab/Home/End, mouse selection, focus/context changes and real edits reset it. The two-press boundary gesture still applies separately at each anchored script. Free space retains the band during horizontal moves and resets it on vertical moves.

### Script orientation addon

`script-breadcrumb` is an independent, default-enabled addon in this experimental branch. It shows the current sprite's costume thumbnail/name and the last selected, edited or navigated script with native C-mouth nesting. It works with mouse-only editing too. Keyboard publishes optional semantic locations to a small common addon context service; Finder's existing history captures/restores those presentation identities without creating a second focus/Undo owner.

The label does not follow hover, run-state highlighting or passive panning. When the active script's head is above the viewport but its tail remains below, its title becomes a compact pinned label aligned towards that script's column, sharing one row with the sprite badge. It does not introduce an extra row over the next visible command, switch sprites or automatically recenter the camera. Theme colours come from the current GUI variables. Long labels truncate; the native project remains unchanged.

Click the sprite badge or title to navigate to the script head; click a nesting label to select its owning C block. The pinned label offers the same links. Only these native buttons receive pointer events; the rest of the overlay remains click-through. Shared history restores the exact departure input/view with Back. Keyboard mode resumes at the destination; mouse-only mode remains off. Navigation/reveal reserves an extra 32 CSS pixels at the top while the addon is visible. This is shared workspace-chrome clearance, not an addon-specific camera policy. Finder menus paint above the workspace caret, while the composition panel retains its higher layer.

Context is session-local and keyed by target/native block IDs, with per-sprite memory and project-load clearing. A removed block falls back to the remembered root; no surviving root means sprite-only context. The addon observes native workspace/VM lifecycle and cleans up on workspace remount. Pan frames update placement only; header/thumbnail and full-script height are refreshed on relevant context or model changes, not every camera tick. Only the active script receives a pinned label, not every offscreen stack. Addon settings can disable the overlay; cross-porting its files/common context seam is separate from publishing to Scratch Addons upstream.

Cancelling a Shift+Enter insertion can leave a before-caret on a connected command. Navigation resolves it to that command's actual incoming boundary (the preceding command's bottom connection or its C-mouth), so it is not trapped by the free-root boundary rules. The insertion preview and native operations themselves are unchanged.

Enter distinguishes accepting a new suggestion from acting on an existing command. Acceptance still leads into the new block's inputs. Enter on a selected command such as `set x to (50)` opens the insertion draft below it; Enter on a reporter visits its operands. Typing/Enter at an individual value slot remains value editing, and accepting its final literal advances to the insertion boundary. These are structural contexts, not opcode exceptions.

### C blocks and if/else

Each mouth is a distinct insertion boundary. Accepting a new block visits its first native input in reading order, regardless of whether it is empty, defaulted or explicitly typed. Thus `if` starts at its condition, `if 1 < 2 then` at the condition reporter, `repeat 10` at its count, and `say hello` at its message. A filled expression is one reporter stop, not another wrapper; Enter on that reporter visits its first operand. There is no opcode-specific exception list. A headerless C block such as `forever` goes straight to its mouth.

Value and Boolean connections take priority over inline selector fields on acceptance and reporter entry. Choosing `abs`, `floor` or `sqrt` already determines the operation, so its operand gets focus. The rule is structural, not a list of operation names: `set variable to` also starts at its value. Selectors remain reachable with Tab, Shift+Tab and the mouse; a menu-only block still starts at its field. Ordinary navigation order is unchanged.

Tab traverses the header before reaching the first body command, or the insertion point when empty. End deliberately selects the outer insertion boundary, even if occupied. On an already selected C command, Enter opens an outer insertion draft below it; select its mouth to insert inside. Accepting a fully typed command still visits its supplied values, so End is the shortcut when they are already correct. Shift+Enter inserts before a selected command. Empty mouths remain navigable vertically; a populated else body is reached at its first command, not an additional gap before it. Down from a body's final insertion gap can reach the next branch or the surrounding continuation. Horizontal arrows do not traverse body commands as though they were header inputs.

The native renderer owns mouth expansion and tail displacement. A placeholder must not force us to hand-draw a C shape, move shadow inputs separately, or mutate real blocks to make space.

Deleting a C block currently means native deletion of that block and its owned contents, with continuation healing. An alternative "unwrap but keep the body" operation should be explicit, with its own key/command and tests. It must not be guessed from Backspace.

For whole-block Delete, capture the owning connection before native disposal heals the stack or recreates shadows. A replacement caret belongs to that connection, never to the removed reporter or a shadow ID. A root with a continuation leaves a before-caret on that continuation; a lone root leaves a workspace caret at its original coordinates. Backspace instead selects the preceding eligible whole block in the same script. Statements skip inline expressions; reporters stay within their expression row. With no predecessor, keep the replacement site. These rules do not intercept text deletion in a draft or native field.

### Expressions and holes

Round and Boolean targets keep their native type checks. Existing shadow inputs are defaults, not standalone authored commands. Real expression blocks are protected from accidental replacement by an unrelated completion.

An empty hole has one input stop. A default number/text/menu shadow is the value of that same stop, not a second level to Tab through. A populated expression has one reporter-block stop, followed by its operands; the owning input does not repeat the same outline. Native mouse clicks on shadow fields return to the owning slot as well. This connection-owned identity survives native shadow recreation during Undo. Reporter stops retain their owning boundary as recovery metadata, so undoing an expression returns to its restored value slot rather than jumping out to the command row.

Typing directly on a number/text slot opens the same composer used for expressions, with the current value selected. No extra Enter or Tab is needed to switch from numbers to block completion. A literal choice remains visible even when those words match a reporter, for example `x position`. Compatible reporter matches appear first; the last choice explicitly keeps the query as a value. Number-only queries can be accepted directly. Command, hat and cap shapes are filtered out of value-slot completion by native connection shape and type, not opcode lists. Compatible but occupied real inputs remain visibly protected.

Enter accepts either kind of candidate. Tab completes a block's name as native undoable text, but accepts a selected literal and advances to the next structural stop. If the only choice is a literal, Up/Down also accepts it and follows command-row navigation; otherwise those keys choose suggestions. Escape cancels either preview without editing the project. A literal preview updates only the copied native field; acceptance calls the real field's `setValue` in one native group. A block candidate creates the complete parse tree in one group; native Undo restores the original shadow, not an orphan input.

F2 or a native mouse field click still opens Scratch's real value editor. Its Tab commits and advances, opening the next editable value when appropriate; Enter/Escape return to its single structural stop. Multi-field shadows, if provided by an extension, keep their distinct field stops without a redundant wrapper. Native field inputs do not show the composition menu; the structural slot composer does.

A deliberately selected connected reporter supports two explicit operations in the same completion list. When a candidate has a compatible empty or default-shadow value input, the first row is **Wrap with ...**: the selected native reporter is retained as that input and the candidate becomes its new owner. The ordinary replacement row remains available separately. Candidates with authored nested content are never treated as wrappers by overwriting that content. Native connection checks decide compatibility for round and Boolean shapes.

The isolated preview shows the retained reporter inside the proposed wrapper. Acceptance reconnects that same live object and ID in one native event group, then selects the wrapper so another typed operator can wrap the result. Undo returns the structural selection to the retained reporter; Redo returns it to the wrapper. This is topology-derived focus after ordinary Blockly history, not custom history or event replay. An arbitrary occupied hole is still protected, and typing `+` does not silently destroy or convert its reporter.

### Variables, lists, broadcasts, procedures and extensions

Use the current target's native palette as the vocabulary. Existing names, dropdown options, custom-call mutations, extension blocks and colour fields should come from descriptors, not hand-maintained English command tables.

Scalar variables can be created explicitly from the composition list, either for a number/text hole or loose reporter, or while typing at a scalar variable dropdown. The two rows are **Create “name” / This sprite only** and **Create “name” / All sprites**. Existing variables come first and carry scope labels and native IDs. A matching name is never duplicated; global conflicts include locals in other original sprites, using Scratch's native exact-case rules. The Stage offers only global creation. Boolean holes, statement gaps and occupied expression inputs do not accept scalar reporters.

The default order suggests all sprites for names with cased letters that are entirely uppercase, otherwise this sprite. A small **New variables** selector can instead prefer either scope regardless of spelling. This is only ordering, never scope inference after acceptance: both legal choices remain explicit. It is saved locally for the current origin; a new immutable review on a different port has its own preference. Names retain their spelling and internal spaces, with native leading/trailing whitespace trimming. Numeric literals and expression punctuation do not propose declarations; existing numeric/punctuated variable names are still reusable. Scratch's native dialog remains available for cloud variables and unusual names outside the bounded composer.

Creation-only suggestions start **unselected**. Arrow keys followed by Enter, or clicking a specific row, explicitly confirm the scope. Merely typing, Tab completion, Enter with no selected row, or Escape does not create a variable. Number/text holes still offer **Use value**, so arbitrary literal text stays literal by default when no existing variable/block matches. A variable choice displays Scratch's actual rounded `data_variable` reporter in the isolated read-only scene, including when the creation-only list is still unselected. Its proposed model exists only in that scene's private variable map and is released when the candidate changes or the scene is disposed. Existing variables use the copied native identity; the live registry, VM and history do not change. A scalar dropdown stays a field selection, not a new reporter insertion. Once accepted, native `createVariable` and a field `setValue` or reporter XML import/connection run inside one native event group. Preview and acceptance share the same native reporter XML builder. Undo removes that use before deleting the new variable; Redo restores its identity and scope. Current target, destination, and conflicts are rechecked before commit. A failed import compensates only its newly owned objects, not the project.

Whole variable commands now also offer explicit creation rows: `set fish`, `set fish to 50`, or `change fish by 2 + 3`. Each row shows the parsed command plus **Create “fish” / This sprite only** or **All sprites**. Selecting one creates the native variable and command in a single Undo group. It focuses the first value input (or its already-populated reporter), not the variable selector just chosen. Complete existing block matches keep priority; creation rows beat incomplete alternatives such as `set fisheye effect`. A leading creation row is previewed but remains unselected until explicitly chosen. Tab only completes text and can itself be undone as text.

The command grammar is derived from native scalar `FieldVariable` dropdown descriptors, not English verb matching. Only that descriptor is temporarily treated as a literal-name slot; normal arguments keep the Addons expression grammar. This prevents a proposed name from being consumed as an existing reporter from another sprite. Closed quoted strings are atomic, so a name such as `"fish to fry"` keeps its internal command word. Names still use the same conservative creation eligibility as bare variable suggestions. Existing variables are reused, and first-variable creation works even when Scratch hides its variable-command palette: native DataCategory factories provide four private headless templates, disposed when composition ends. No live dummy variable or custom variable registry is introduced.

The final XML is prepared and bound to a reserved native variable ID **before** native variable creation refreshes the live flyout and disposes its source fields. Only then are native variable creation and XML insertion grouped. Cancellation allocates nothing in the live project. Failure compensates only the new command (with native tail healing) and its variable. Studio retains the keyboard-edit provenance and whole-transaction playback path. Cloud variables and automatic declaration without choosing a creation row remain out of scope.

Lists follow the same explicit identity and scope rule, using Scratch's native typed variable type `list`. `list groceries` and `create list groceries` propose the rounded list reporter with separate **This sprite only / All sprites** rows. Stage offers only global scope. Typed list commands such as `add apple to groceries` come from the current palette's native block descriptors; the list dropdown remains an identity slot even when it follows ordinary value arguments. Existing identities are reused and creation plus reporter/command use is one native event group. A bare unknown word does not silently become a list, and cloud lists are not invented.

The sensing `property of sprite` catalogue includes the editing sprite as an explicit target, although Scratch's palette menu omits it. This reuses every native property and sprite-variable option, its translated label and input order. For clones, `x position of Sprite1` means the original named Sprite1, not the calling clone. Stage's property set is unchanged. This is an opt-in catalogue extension, not a native menu or VM modification.

The structural clipboard is deliberately native rather than text-shaped. Copy serializes the selected block and its connected descendants through Scratch Blocks XML. Paste remaps block and obscured-shadow IDs, imports through Blockly, and connects using the destination's real connection types; duplicate adds the familiar native offset. Cut disposes the selected root as one native operation, preserving the subtree. This keeps native Undo/Redo and shadow restoration authoritative. Occupied real reporter inputs and incompatible statement splices are protected before live import.

While Keyboard mode is active, both Ctrl+V and the workspace Paste menu place copied blocks at the structural caret, including a resting new-stack site or open draft. Editor DevTools exposes two optional, cancelable workspace events: the menu requests block paste, and its deferred mouse-pickup callback checks placement ownership at execution time. Keyboard handles the former through its existing native clipboard and cancels the latter. Mouse-mode defaults and the addon preference remain unchanged; detaching the controller removes both listeners. Native text fields retain their own clipboard handling.

Across sprites and Stage, the clipboard carries only the referenced variable/list/broadcast metadata alongside native XML. Destination locals follow Scratch's name/type merge rule or are created locally; project globals and broadcasts keep identity; a source local pasted to Stage gets Scratch's deterministic `Stage: name` identity. Sprite-click and Stage-click hats translate to the destination form. Connection probing happens in a disposable headless workspace, then identity creation and block placement share one native event group. Clipboard state survives a target change but is cleared on project load. Cross-target custom-procedure/argument fragments are refused because a detached call cannot safely carry its definition context.

Shift+Up/Down owns a contiguous range of direct sibling statements. Reversing direction shrinks through the anchor before growing the other way. It never crosses an outer/C-mouth boundary; selecting the C block itself still includes its nested body. Copy clips only the selected outer `next` chain while retaining every selected block's native fields, inputs, comments and nested statements. Cut/Delete heal through the actual incoming connection, not an inferred previous block, so the first commands of a C mouth stay in that mouth. Delete leaves the replacement boundary and Backspace returns to the preceding structural owner.

Alt+Up/Down moves that selected statement or range by exactly one sibling position. The edit reconnects the live incoming/outgoing native connections around the slice while preserving its internal connections and object IDs. A top-level selection takes the displaced sibling's root coordinate so the stack does not drift. The range remains selected after movement. Movement cannot cross an outer/C-mouth boundary and impossible edge, hat or cap moves are no-ops. One tagged native Blockly event group owns the complete swap, which keeps ordinary Undo/Redo and Studio's transaction, Timeline and Play contracts aligned without a parallel history model.

Ctrl/Cmd+A with no active text composer selects the whole direct-sibling statement chain containing the caret. Typing with a multi-statement range selected starts explicit C-block wrapping rather than ordinary insertion. Only a compatible C shape is eligible. Its disposable native preview reconnects the copied incoming boundary, the same selected objects, the first empty statement mouth and the copied continuation, so the visible proposal is the real connection transform. Acceptance repeats that transform on the live objects in one native event group. Multi-mouth wrappers use the first empty body; no implicit distribution between `then` and `else` is guessed. Hats, reporters, pre-filled mouths, stale ranges and cap blocks with a continuation are ineligible. Native Undo restores the selected statement range; Redo selects the wrapper. This is the statement counterpart of explicit reporter wrapping, with the same topology-derived history-focus rule.

Multiline text paste accepts a bounded flat list of exact, unambiguous existing statement descriptions and builds one native XML stack before touching the live workspace. All lines must compile and connect; failure is atomic. It intentionally does not infer indentation, nested mouths, identity declarations or natural-language repairs. Copying a structural range as editable text remains separate future work.

Broadcast messages follow the same explicit identity rule but are always project-wide. Typed broadcast commands and selected broadcast fields offer a native-shaped **Create broadcast message** row when needed; typing, preview, Tab, unselected Enter and cancellation allocate nothing. Acceptance creates the broadcast and its use in one native event group, preserving identity through Undo/Redo. Existing messages are reused.

At a top-level new-script caret, `define jump (height) if <ready?>` is a bounded declaration for a native custom-block definition. Parentheses become `%s` number/text inputs and angle brackets become `%b` Boolean inputs. The proposal uses Scratch's own mutation schema and a real definition preview in the isolated scene; acceptance creates native argument IDs and begins the body on the definition hat's next connection. The prototype shadow is the signature, not a statement mouth. Creation stays explicit and validates duplicates, brackets, names and size limits before changing the project. F2 retains Scratch's native custom-block editor for renaming or restructuring an existing definition.

### Recording typed creation honestly

The new `tagEventGroup(group, source)` capture seam attaches explicit provenance to native events, including deferred variable creation, without replacing events or history. Keyboard acceptance tags block/variable creation groups as `keyboard-authoring`. These are complete, atomic native edits, not observed palette drags. Studio Play therefore uses its shared complete-transaction presentation for them; mouse-authored and legacy recordings retain their native gesture plans. This avoids replaying a default flyout block in place of a typed template whose input values may differ. The regression case is `say hello`, followed by creating a variable in its message slot: the inferred palette route left a covered `Hello!` default instead of the authored `hello`. Ordinary Undo/Redo was already correct; the explicit source makes Play use the correct existing path as well. Animated re-enactment of the keyboard composition itself is a future presentation feature, not fabricated mouse input.

### Selected-item F2

F2 acts on the selected keyboard item, never the mouse pointer. An ordinary text, number or menu field opens Scratch's native field editor. A selected scalar/list block renames that variable identity; a selected broadcast block renames the message identity rather than choosing another one; a selected custom call, definition or prototype opens Scratch's native custom-block editor. Native prompts select and focus the current name immediately. Escape cancels every route, closes the prompt or modal, preserves identity/history and returns to the same keyboard selection.

## Mouse and focus

- A primary click on blank workspace places a new-script caret and accepts typing immediately. Like a block click, it acquires focus on release, after the browser's default mousedown focus change. A native pan never becomes a caret placement, including an out-and-back drag that finishes at its starting point; use Blockly's own drag state rather than only the final pointer distance.
- Keyboard mode is explicit and opt-in. A click on an existing block in this mode places the caret; it must not also run that script.
- With no insertion presentation active, a genuine drag retains the original native Gesture path.
- While a draft or resting insertion caret displaces the visible tail, clicks target the visible copy by native block identity. The invisible source's old hitboxes are not authoritative presentation.
- Clicking an existing block during that presentation leaves insertion mode and selects the visible block. A subsequent drag operates on the restored real workspace. Clicking the phantom starts/resumes its text input, not a fake executable block. This first-click selection is an explicit tradeoff while a disposable scene owns the visible layout.
- Clicking the palette, sprite list, menu or ordinary page controls should leave keyboard ownership. Changing sprite/project cancels the draft, never transfers it to another target.
- During Studio playback/history transitions, the keyboard presentation steps aside. It must never compete for source opacity or capture editing keys while another transition owns the workspace.
- A native popup owns its text/dropdown keys. Closing it must not leave focus on a detached element or make the next key trigger an unrelated command.
- Actual OS IME, screen-reader and non-Latin/RTL testing remains required. A composition guard alone is not accessibility certification.

## Camera and presentation

The caret is a steadily visible dashed block outline, not a flashing bar or rectangular focus box. Rounded dashes travel slowly around the native path using a linear dash offset (two dash periods every three seconds); neither the block nor its opacity moves. Selected blocks and input slots reuse their actual native SVG path and current screen transform. Unplaced command boundaries use a small generic command contour; typed drafts follow their native candidate shape. Outlines are clipped to the script viewport; reduced-motion preferences leave the dashes stationary. This is only a selection indicator, not a second block renderer. Keep the edited block and a useful amount of continuation visible; don't recenter the whole project per key.

The latest requested trial removes the white keyline completely. A **3px deep-red stroke**, rounded **5-on / 7-off** dashes, and `drop-shadow(0 1px .4px rgba(0,0,0,.5))` provide a small downward separation without a broad halo. The shadow is black at half opacity, offset exactly 1 CSS pixel down, with a tiny blur. Non-scaling strokes keep the width stable at workspace zoom. The loop travels exactly 24 units (two dash periods) over three seconds without a seam; the 12% red insertion fill and reduced-motion behavior remain. This supersedes both the earlier white-glow/keyline trials and the earlier no-shadow preference, following Andy's latest request. Light/dark screenshots and geometry checks accompany the variable-command verification; visual preference still needs day-to-day feedback.

All new draft paint (body, labels, menu fields, nested reporters and their native shadows) uses the same 45% opacity. The former special case drew shadows at 90% fill versus 30% for the block and left labels opaque. Opacity now applies once to each new block's own SVG paint, never its enclosing block root: native block roots contain both inputs and the attached continuation. This avoids compounded fading in nested inputs and leaves the existing receiver/tail and its fields unchanged. The native hierarchy, shapes and connection layout are untouched, with no per-opcode styling exceptions. The helper refuses editable workspaces. Cancellation, source masks and native shadow restoration remain owned by the existing disposable scene.

A C block's visible outline follows the entire silhouette, while its camera target remains its header, using the renderer's mouth connection. An oversized rectangle must have a stable leading-edge preference; alternating left/right or top/bottom corrections cannot make an impossible fit possible. Programmatic scrolling uses the native scrollbar with current metrics, not the legacy drag-only scroll method.

Only the active insertion boundary makes space: a normal one-line native statement height and a restrained 144-unit width, with a 12% red fill and calm dashes. No placeholder label is needed. Empty then/else mouths, body ends and deliberately opened middle gaps reflow in the same read-only native scene used for typed drafts. Navigation waits 100 ms before opening a passive gap, so repeated arrow/Tab keys do not expand every point passed. Opening/closing takes 140 ms; reduced motion skips interpolation. Enter from that caret reuses its scene instead of closing and reopening the space. The project, saved XML, shadows and native history are not edited to achieve this layout.

The ghost's lower edge meets the next block at the native notch, with no additional overlap into its body. Both rendered path bounds and screen-space joins at zoom are tested, not just connection coordinates. The native corner's height must be included in the drawing calculation; adding arbitrary space between connected blocks would hide the geometry error rather than fix it.

Enabling keyboard mode reveals an offscreen selected command before the first painted caret frame. New script is different: use the current view, not the location of an old selection. The composition panel shrinks to the available script area on narrow layouts; a very wide native expression is still allowed to extend beyond that viewport.

When editing within a script, the composition panel uses a stable column beside it if there is room, leaving the continuation and C closing rows visible. It reserves a modest width up front rather than following each candidate's right edge. A genuinely wider draft or narrower viewport can force a one-way fallback to below/above for that composition. Independent script ends retain below/above placement. Below a draft, the panel reserves the tallest shape seen; shorter suggestions do not pull it back up. Near the bottom the input stays on the panel's bottom edge while suggestions grow upwards. Results scroll within available space instead of moving the input as their count changes.

This keeps a fully functional browser text field and lets the candidate take its true Scratch shape. Its tradeoffs are an extra visual step between raw query and preview, slightly more horizontal eye travel when beside the script, and possible coverage of surrounding commands in a narrow editor where side placement cannot fit. The candidate itself stays clear in the tested layouts. A deeply oversized expression still cannot be made to fit a narrow viewport. Gather feedback before adding a second composition widget or token-level text overlay.

An alternative truly in-block text caret would need a mapping from query token spans to native field/label geometry. It should reuse the same structural model, acceptance and history. Do not fake that mapping by rendering a second arbitrary font over block labels or by replacing the entire project with parsed text.

Large scripts need measured latency. The initial per-candidate workspace copy proved slow at 1,000 blocks. The scene persists for a draft and its native insertion boundary is restored between candidates; receiver and tail objects are retained. Only the candidate and any replaced default shadow need allocation. Source-change notifications still invalidate the scene safely. The optional [root-scoped native hook](NATIVE-PRESENTATION-HOOK.md) now copies only the affected complete stack: first-entry time in the many-small-stacks fixture fell from about 112 ms to 19 ms. A single 200-command stack still takes 73–77 ms to open and about 18 ms per subsequent key, down from 56 ms steady before boundary reuse. These are measured fixture samples, not universal latency guarantees. Do not solve the remaining long-root cost with direct transforms of live descendants.

Tab completion must be an undoable browser edit, not `input.value = text`. The isolated adapter uses native `execCommand('insertText')`, which is deprecated but preserves the input undo buffer ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Document/execCommand)). Unsupported engines keep the query untouched and can accept with Enter. The tradeoff is explicit, with a real Chromium Ctrl+Z/Ctrl+Y check; there is no replacement text-history engine.

## Explicitly deferred capabilities

- Copying a selected structural range as editable text, and indentation-aware multiline paste.
- Range selection spanning nested expressions, C-mouth boundaries or noncontiguous blocks.
- Reporter-range movement beyond one selected expression.
- Indent/outdent shortcuts across C boundaries.
- Renaming an existing block by editing its whole natural-language label.
- Implicit variable/list declarations without choosing a creation row.
- Persisting incomplete drafts across project/sprite switches.
- Matching raw query characters to a truly in-block text caret.

These are extensions of the same structural model, not reasons to introduce a second project authority. Browser-tested insertion, focus, history and cancellation come first.
