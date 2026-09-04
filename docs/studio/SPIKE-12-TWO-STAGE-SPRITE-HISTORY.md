# Spike 12: two-stage cross-sprite history

Date: 23 August 2026

## Result

Undo and Redo no longer switch sprites and mutate the project in the same command. When the next Studio transaction belongs to another sprite, the first command selects that sprite and frames the transaction's recorded editing view. Repeating the command applies the transaction.

Commands whose transaction already belongs to the selected sprite still apply immediately. The history cursor does not move during preparation, so the existing validation and redo-branch rules remain unchanged.

## Design

Target lookup and selection now live in one Scratch Blocks target port shared by replay and preparatory navigation. Runtime IDs are still preferred, with the existing stage/name reference used after checkpoint restoration.

The session determines preparation from current editor state rather than a second history cursor:

1. inspect the transaction immediately before or after the Studio cursor;
2. if its target is already selected, apply it normally;
3. otherwise pause capture, begin the transaction's viewport lifecycle, select the target and restore its view; and
4. resume capture without replaying an event or moving the cursor.

This remains contained in Studio-owned modules. It does not replace Scratch Blocks' internal `workspace.undo()` and adds no journal field or upstream seam.

## Expected interaction

- Cross-sprite Undo: first press navigates, second press undoes.
- Cross-sprite Redo: first press navigates, second press redoes.
- Same-sprite Undo or Redo: the first press applies immediately.
- Switching away after preparation: the next command navigates back again before applying.

## Real-editor evidence

The current `reliability-20260823-1` take contained 17 transactions and 31 Scratch events during this check. Starting from its validated head:

- the first 13 keyboard Undo commands affected Sprite1 normally;
- command 14 selected Abby, restored its canvas transform and reported `ready to undo` without applying the transaction;
- command 15 applied the transaction and reported `undone` while remaining on Abby;
- after manually selecting Sprite1, the first Redo selected Abby and reported `ready to redo`;
- the second Redo reported `redone`; and
- `Play` from that partial cursor returned to `played · 17 steps (31 events)` at the canonical head.
