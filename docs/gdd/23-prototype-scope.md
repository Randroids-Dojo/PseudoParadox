# Prototype Scope

**Status:** not_started

The prototype covers exactly Acts 1-3 in a single room. It is the minimal vertical slice that proves the core loop. Anything not on this list is out of scope for v1 and lives in `99-out-of-scope.md`.

## Success criteria

The prototype is shippable when all of the following are demonstrably true:

- [ ] Player spawns in the room at 5:00, controllable.
- [ ] Four doors are present. Lit/dark state correctly reflects portal availability per the time travel rules.
- [ ] Room color tints across a warm-to-cool spectrum over time.
- [ ] Traveling through a lit door records player input from spawn to entry, and a replaying instance respawns at the next visit to that timeline.
- [ ] Past instances tint to the room color at the time they last traveled.
- [ ] The active player instance shows a subtle floor ring underfoot.
- [ ] Thought-bubble icons appear above past instances before key actions (door enter, fight, sleep).
- [ ] Knockouts produce ragdoll on the receiving instance.
- [ ] Unconscious bodies can be picked up, dragged, and thrown through doors.
- [ ] The Act 1 to Act 3 sequence is completable end to end.
- [ ] Hard reset is available in the pause menu and returns the simulation to a clean Act 1 state.

## Definition of "shippable"

A demo build deploys to web (no install required), loads in under 10 seconds on a typical broadband connection, runs at 60fps on a 2020-era laptop, and supports the full Act 1-3 puzzle without crashes or timeline desync.

## Non-goals for the prototype

- Multi-room or multi-level content.
- Multiplayer.
- AI-attribute tracking per instance (anger, energy, strength).
- Decades-scale narrative.
- Portal variability (destinations that change after thresholds).

These items are listed in `99-out-of-scope.md` with rationale.

## Reference checklist

This section mirrors the original GDD prototype scope. The atomic-row coverage in `docs/GDD_COVERAGE.json` is what the loop tracks. This list is a human-readable double check.

### Build log
