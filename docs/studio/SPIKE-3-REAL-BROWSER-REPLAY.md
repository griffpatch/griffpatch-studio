# Spike 3: checkpoint-backed browser replay

Date: 23 August 2026

## Result

The real TurboWarp editor can now record a block drag, rewind it, and play it forward. The persisted take also restores its base checkpoint in a separate editor tab. Spike 4 adds persisted end-state validation after reload.

Enable the temporary vertical slice with:

```text
http://127.0.0.1:8601/editor.html?studio-session=1&studio-take=<take-id>
```

The take ID keeps experiments separate. The journal is stored in local storage; its base project uses TurboWarp's existing IndexedDB restore-point store.

## Evidence

The live take `live-20260823-3` performed this sequence:

1. Dragged `move 10 steps` into the scripting workspace: `recording · 2 events`.
2. Rewound to the hashed base checkpoint: `rewound · 2 events`.
3. Replayed the edit: `played · 2 events`.
4. Opened the same take in a separate editor tab, restored its checkpoint, replayed, then rewound again with a matching base hash.

The separate load matters because Scratch runtime target IDs are regenerated when an `.sb3` is restored.

## Problems found in the real editor

- Session initialization originally ran before the default project's assets had loaded. It now waits for the VM's project-ready boundary.
- Scratch Blocks serializes “no parent” as `null`, while the VM move handler expects `undefined`. The replay bridge translates that boundary convention.
- Persisted events originally addressed only transient runtime target IDs. Snapshots now also carry the sprite name and stage flag, and the bridge resolves the current target on replay.
- A replay exception could leave the controls busy. The session now publishes the error, clears busy state and treats the current position as unknown.

Each fix is contained in `src/studio/bridge/`; the journal and replay core remain independent of TurboWarp internals.

## What this proves

- An exact base checkpoint can be created, referenced and restored without a second asset database.
- Block create/move actions can cross the capture, persistence, checkpoint and semantic replay boundaries.
- Canonical project hashes can verify both the base state and a previously observed end state.
- The same persisted take can replay after a fresh editor load. This spike did not yet persist the end hash, so only the later Spike 4 reload proves the replayed end state matched.

## Still to prove

- A 100-cycle reliability run in a real workspace.
- Complete create/change/move/delete coverage for nested stacks and comments in the browser.
- Cross-sprite operations involving rename, delete and duplication.
- Timeline cuts, replacement takes, pointer overlay and presentation timing.
- Paint, costume, sound and other editor surfaces.

The next useful slice is an editable timeline over this session API, starting with transaction-level enable/disable and replacement while keeping pointer data as a separate presentation track.
