# Spike 10: smooth viewport motion

Date: 23 August 2026

## Result

Recorded viewport restoration and legacy stack framing now move smoothly instead of jumping. The camera also remains visually continuous when a replay transaction changes sprites.

## Motion contract

The viewport adapter still owns the decision about where to look. It passes one final pixel target to a separate Scratch-independent motion controller which:

- uses cubic ease-in/out movement;
- derives duration from travel distance, bounded between 180 and 450 ms;
- snaps movements of at most 2 pixels;
- cancels an active move before accepting a replacement; and
- resolves only when the movement finishes, keeping presentation between complete Scratch transactions.

The policy depends only on injected read, write, clock and animation-frame functions. Scratch Blocks geometry remains contained in `scratch-blocks-viewport-port.js`.

## Sprite-switch continuity

Scratch restores a sprite's cached workspace scroll position when that sprite becomes the editing target. That previously appeared as an unexplained jump before Studio applied its own camera target.

At the start of each transaction, Studio now captures the outgoing visible workspace origin in scale-independent coordinates. After target selection, it converts that origin through the new sprite's content metrics, applies it before the browser's next paint, and eases to the recorded or derived target. This preserves the view across different content bounds without storing more journal data.

## Real-editor evidence

The persisted `reliability-20260823-1` take was loaded in a fresh editor tab and its canvas was deliberately scrolled far from the scripts before playback.

- The first recovery from the displaced view produced 13 sampled intermediate transforms before reaching the transaction target.
- Later moves into and out of the other sprite also produced intermediate transforms rather than one-frame jumps.
- The complete two-sprite playback finished as `played` with all 13 transactions and 23 events, preserving strict project validation.

The longer camera waits also made an existing full-Rewind asymmetry reproducible: repeated Undo repaired an internal base drift from the canonical checkpoint, while Rewind only reported the mismatch. Both routes now share the same strict repair-and-revalidate helper; the first observed divergence was retained in diagnostics as `$.targets[2].blocks.a`.

## Compatibility boundary

This change adds no journal fields and touches no TurboWarp-owned source file. The motion controller is replaceable by a future editable camera track, and environments without animation-frame scheduling retain immediate deterministic positioning.
