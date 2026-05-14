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
- **REQ-056: Pause-menu reset placement.** The final hard-reset affordance lives in the pause menu, with a confirmation step before clearing the current run.

## Player-Facing Contract

The prototype must never imply that the timeline model has broken. A failed plan is not a paradox; it is a solved or unsolved physical arrangement.

Allowed recovery copy should speak in concrete terms such as reset, restart, escape, and try again. Avoid abstract warnings like "timeline instability", "paradox detected", or "causality error" unless the fiction later earns them.

## Active Player Unconscious

When the active player is knocked unconscious:

- Movement input no longer moves the active body.
- Punch, pickup, and throw inputs should not create new active-player actions.
- Ghosts and physics may continue to settle.
- Reset remains available from the current keyboard and touch reset surfaces, and from the pause menu once it ships.

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

Hard reset is currently bound to `R` and exposed through the touch reset button. Those bindings are interim prototype shortcuts. The final v1 affordance lives in the pause menu so keyboard and touch players use one recovery surface.

## Pause Menu Reset UX

The pause menu opens from `Escape` on keyboard and from a visible pause button on touch devices. Opening the menu pauses active input capture for gameplay actions, but it must not silently discard the current run. The menu is modal above every fixed app surface, including touch controls, HUD, onboarding text, and win or failure overlays. Background controls must not receive pointer input while the menu is open.

Menu content is intentionally sparse:

- Primary action: `Resume`.
- Secondary action: `Reset run`.
- Optional secondary action after escape: `Play again`.

Selecting `Reset run` opens an in-menu confirmation state instead of resetting immediately. Confirmation copy should stay concrete:

- Title: `Reset run?`
- Body: `Return to the 5:00 start and clear every recorded instance.`
- Confirm action: `Reset to 5:00`.
- Cancel action: `Cancel`.

The confirmation is required because reset destroys authored timeline state. It is not a paradox warning and must not use causal-failure language.

Reset remains available when the active player is unconscious. The unconscious state blocks movement and active combat actions, not pause-menu access. On touch devices, the current reset button may stay as an interim shortcut until the pause menu ships; the final touch surface should route reset through the pause menu confirmation.

Keyboard shortcuts:

- `Escape`: open the pause menu, or close it if no confirmation is active.
- `R`: interim hard-reset shortcut until the pause menu implementation ships. Once the pause menu ships, `R` should open the reset confirmation from the pause menu rather than clearing the run instantly.
- `Enter` and `Space`: activate the focused menu button using normal browser button behavior.

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

- 2026-05-14: F-003 hard-reset UX spec. Added the final pause-menu reset placement, keyboard and touch entry points, in-menu confirmation copy, and unconscious-player availability rules. Runtime behavior is unchanged in this docs-only slice; implementation remains tracked as F-022. Files: `docs/gdd/17-ui-failure-state.md`, `docs/GDD_COVERAGE.json`, `docs/FOLLOWUPS.md`, `docs/PROGRESS_LOG.md`. PR pending.
- 2026-05-14: F-002 spec consolidation. Authored this missing section from the legacy root `GDD.md`, shipped hard-reset behavior, touch reset affordance, win screen behavior, and current out-of-scope rules. This is a docs-only slice; runtime behavior is unchanged. Status is partial because the legacy pause-menu-only reset placement remains open as F-003. Files: `docs/gdd/17-ui-failure-state.md`, `docs/GDD_COVERAGE.json`, `docs/FOLLOWUPS.md`, `docs/PROGRESS_LOG.md`. PR #74.
