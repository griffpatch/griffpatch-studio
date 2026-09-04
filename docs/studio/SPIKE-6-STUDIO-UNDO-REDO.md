# Spike 6: Studio-aware Undo and Redo

Date: 23 August 2026

## Result

Scratch's user-facing Undo and Redo commands now traverse Tutorial Studio's persisted transaction journal rather than the currently visible sprite's transient Blockly undo stack. The 13-step reliability take was driven backwards from Sprite1 into Abby and forwards into Sprite1 again through the real editor.

Supported commands while an explicit Studio session is active:

- Ctrl/Cmd+Z: previous Studio transaction;
- Ctrl/Cmd+Shift+Z and Ctrl/Cmd+Y: next Studio transaction; and
- Scratch workspace context-menu Undo and Redo.

Editable text and number controls retain their normal browser editing shortcuts.

## Integration boundary

`studio-history-command-port.js` intercepts keyboard commands at the document capture phase and temporarily wraps the two Scratch Blocks workspace-menu option factories. It does not override `workspace.undo()`: Scratch Blocks calls that method internally when correcting invalid drags and procedure edits, so replacing it would couple Studio history to implementation details and risk corrupting the journal.

The adapter is active only for `?studio-session=1`. Detach removes its listener and restores the exact context-menu functions it received. If another integration has replaced a wrapper later, detach does not overwrite that later change.

## History model

The session holds a cursor between journal transactions:

- Undo applies the transaction before the cursor backwards, selecting its recorded target first.
- Redo applies the transaction at the cursor forwards.
- A new captured transaction at a partial cursor removes the abandoned redo suffix, then appends the replacement.
- Rewind applies only the prefix currently represented by the cursor.
- Play continues from a partial cursor; at the head it still rewinds before a complete replay.

The cursor is session state, while the transaction source and end hash remain persisted. The first Undo from the recorded head stores or validates the canonical end-project hash. Returning to the head validates it again; reaching the base validates the checkpoint hash.

If the last backward transaction looks correct but leaves a different internal project hash, Studio reloads its recorded base checkpoint and validates that canonical state. It reports the repair in the validation result. Redo remains enabled only after the restored checkpoint matches exactly; surplus Undo commands at the base are then harmless no-ops.

## Real-editor evidence

Using persisted take `reliability-20260823-1`:

1. Played all 13 transactions to the validated head.
2. Ctrl+Z removed the final restored nested `say [Ready!]` block.
3. Ctrl+Shift+Z restored it inside the `if` statement.
4. Ten consecutive Undo commands moved the cursor from the head to transaction 3, selected Abby and left her `repeat (3)` without the nested turn block.
5. Two Ctrl+Y commands restored Abby's nested turn and crossed forward to Sprite1's green-flag transaction.
6. The workspace context menu exposed Studio-aware Undo and Redo; selecting Redo restored the final nested block.
7. From one transaction behind the head, Play applied only the remaining transaction and finished with the recorded end hash matched.
8. A later regression test drove all 13 transactions backwards, pressed Undo five more times, then redid all 13 transactions. The final backward event initially exposed an internal base-state drift; canonical checkpoint repair kept the cursor at a validated base and the complete redo reached the recorded head.

The branch-replacement rule is covered at the recorder and session contract levels so the original persisted reliability take did not need to be destructively altered during the browser test.

## Boundaries and next work

This slice covers block transactions on targets that already exist. Sprite create, duplicate, rename and delete remain outside the block journal. A future timeline UI should expose the same cursor and branch operations instead of introducing a second history model. Pointer presentation can reference these transactions independently and does not need to synthesize mouse input to make history reliable.
