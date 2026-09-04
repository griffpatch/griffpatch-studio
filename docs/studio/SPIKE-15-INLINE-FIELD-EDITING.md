# Spike 15: inline field editing as one history step

Date: 23 August 2026

## Outcome

Typing into a Scratch block field now creates one Tutorial Studio history event when the inline editor closes or loses focus. Intermediate Blockly field-change events remain in a small in-memory buffer and are collapsed from the first old value to the final new value. Pressing Enter and clicking elsewhere therefore produce the same durable result.

Dropdowns and other one-click field changes are still committed immediately because they do not use Scratch Blocks' `blocklyHtmlInput` editor. If typing returns the field to its original value, Studio records no event. Detaching the recorder flushes a real pending edit so a final value is not lost during editor teardown.

Studio history and playback commands also flush an accepted pending edit before checking their cursor. This closes the short browser interval between `focusout` and its deferred commit, so clicking a Studio command immediately after typing cannot omit the edit from the operation.

## Containment

Coalescing lives entirely in `src/studio/bridge/block-workspace-port.js`, before snapshots reach the journal. Undo, Redo, playback, persistence and data-boundary handling continue to consume the same version-1 field-change contract; they now receive one `oldValue` to `newValue` event for the complete editing gesture.

The Studio session passes its existing document port into the capture bridge. The bridge observes `focusout` and checks the active Scratch Blocks editor after one deferred turn, allowing the final Blockly change emitted during editor disposal to join the same gesture. No Scratch Blocks, VM or other upstream-owned file is modified.

## Verification

- focused capture and session tests cover multiple keystrokes, focus closure, consecutive edits, immediate one-click changes, no-op edits, listener cleanup and teardown flushing;
- complete Studio suite: 92 tests passing;
- focused lint for all changed JavaScript: passed;
- production webpack build: passed;
- live Scratch editor: typing `123` left the panel at zero steps/events; Enter committed exactly one step/event; typing `456` left the count unchanged until clicking away, which committed exactly one additional step/event;
- live history and persistence: each complete edit round-tripped through one Undo and Redo command; a clean tab restored the base as `ready to play · 2 steps (2 events)` and playback reached `456` as `played`.
- live command-boundary race: after typing `789`, clicking Rewind immediately retained it as exactly one third event, rewound to `0`, and subsequent playback reached `789` as `played · 3 steps (3 events)`.
