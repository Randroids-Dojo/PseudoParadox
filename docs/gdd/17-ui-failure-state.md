# UI Failure State

**Status:** partial

This section specifies how the prototype presents failure, dead ends, and recovery. Pseudo Paradox does not use paradox warnings, death screens, or auto-rewind. Failure is intentionally quiet: the player owns the timeline they created.

## Scope

Failure state covers the player-facing recovery path when the current run cannot continue usefully.

In v1, the main recoverable dead ends are:

- The active player is knocked unconscious.
- The active player has created a timeline arrangement that cannot reach the escape sequence.
- The player wants to restart the single-room puzzle from Act 1.

Hard reset is the recovery mechanism. Save/load, checkpoint rewind, undo, and timeline editing are out of scope.

## Core Requirements

- **REQ-045: No paradox warning.** The UI must not warn that a paradox has occurred, because paradoxes are not representable in the ruleset.
- **REQ-046: No auto-rewind.** The game must not automatically rewind or repair an impossible player plan. The player can reset deliberately.
- **REQ-047: Hard reset recovery.** A hard reset returns the run to Act 1 state, clears ghosts and in-flight bodies, resets the active player, and restores the initial timeline state.
- **REQ-048: Dead-end legibility.** If the active player is unconscious or otherwise unable to continue, the reset affordance must remain available.
- **REQ-049: Escape is terminal success.** Once the Act 3 escape resolves, the win surface replaces failure recovery as the primary UI outcome.

## Player-Facing Contract

The prototype must never imply that the timeline model has broken. A failed plan is not a paradox; it is a solved or unsolved physical arrangement.

Allowed recovery copy should speak in concrete terms such as reset, restart, escape, and try again. Avoid abstract warnings like "timeline instability", "paradox detected", or "causality error" unless the fiction later earns them.

## Active Player Unconscious

When the active player is knocked unconscious:

- Movement input no longer moves the active body.
- Punch, pickup, and throw inputs should not create new active-player actions.
- Ghosts and physics may continue to settle.
- Reset remains available from the keyboard and touch reset button.

The UI does not need to open a modal immediately. The quiet failure is intentional. The player can read the body on the floor and choose to reset.

## Hard Reset

Hard reset is the only v1 state operation. It must restore:

- Active timeline: Act 1 start timeline.
- Active instance id: `You1`.
- Active player body, mesh, carry state, consciousness, facing, and recorder.
- Ghost registry and timeline buckets.
- In-flight thrown-body bookkeeping.
- Act progress observer and debug state.
- Door paint and lit-state presentation for the initial timeline.

Hard reset is currently bound to `R` and exposed through the touch reset button. The legacy root GDD says the final affordance should live in the pause menu only. That menu placement is tracked by F-003 and is not finished in this section yet.

## Win State

Escape is not a failure state. Once the player leaves through the final North door, the UI may show a win surface and stop presenting reset as the primary goal. A reset affordance can remain available as a secondary action for replaying the prototype.

## Non-goals

- No checkpoint system.
- No undo stack.
- No timeline scrubber.
- No automatic hint system.
- No death or kill state.
- No save/load of in-progress timelines.

### Build log

- 2026-05-14: F-002 spec consolidation. Authored this missing section from the legacy root `GDD.md`, shipped hard-reset behavior, touch reset affordance, win screen behavior, and current out-of-scope rules. This is a docs-only slice; runtime behavior is unchanged. Status is partial because the legacy pause-menu-only reset placement remains open as F-003. Files: `docs/gdd/17-ui-failure-state.md`, `docs/GDD_COVERAGE.json`, `docs/FOLLOWUPS.md`, `docs/PROGRESS_LOG.md`. PR TBD.
