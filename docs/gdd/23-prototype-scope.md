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

- 2026-05-08: REQ-029 partial. Room background tints across a warm-to-cool spectrum driven by a virtual `TimeOfDay` clock (60s real-time cycle). Anchors: warm `#f6c084`, cool `#5a78b8`. The clock advances on frame delta and the interpolated color is written to `scene.background` each render frame; clock-to-sim-tick binding is deferred to a follow-up dot. Files: `src/sim/timeOfDay.ts`, `src/render/colorTint.ts`, `src/app.ts`, `tests/sim/timeOfDay.test.ts`, `tests/render/colorTint.test.ts`. PR (pending: feature/req-029-color-tint).
- 2026-05-08: REQ-027 partial. Four placeholder doors render at the midpoint of each wall, base on the floor, sized 1.2 x 2.2 x 0.12 in a warm color that reads against the cool grey walls. East and west doors rotate 90 degrees about Y so their wide face runs along the wall. Doors are visual-only; collisions and portal traversal are deferred to REQ-001/REQ-005 and lit/dark state to REQ-028. Files: `src/scene/door.ts`, `src/scene/room.ts`, `tests/scene/door.test.ts`, `tests/scene/room.test.ts`. PR #5.
- 2026-05-08: REQ-026 partial. Player capsule spawns at the room center and is keyboard-controllable in world XZ via WASD or arrow keys at 4 m/s, normalized on diagonals, applied as target velocity each fixed physics step. Camera stays fixed; 5:00 timeline anchor not yet wired. Files: `src/input/keyboard.ts`, `src/scene/player.ts`, `src/app.ts`, `tests/input/keyboard.test.ts`. PR (pending: feature/player-capsule).
- 2026-05-08: scaffolded the runtime stack (Vite + TypeScript + Three.js + Rapier3D). Empty placeholder room (10x10x4 units) renders with hemisphere fill plus directional key light at a fixed isometric camera. Files: `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `src/main.ts`, `src/app.ts`, `src/render/renderer.ts`, `src/scene/scene.ts`, `src/scene/room.ts`, `tests/scene/room.test.ts`. PR (pending: feature/vite-scaffold).
