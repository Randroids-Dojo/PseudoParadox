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

- 2026-05-08: REQ-031 done. Subtle floor ring under the active player. `src/scene/floorRing.ts` exports `createFloorRing()` (inner 0.5, outer 0.7 RingGeometry on a low-opacity neutral white `MeshBasicMaterial`, rotated flat onto XZ, pinned to y = 0.01 above the floor) and `updateFloorRing(ring, body)` (copies body x/z onto the ring, pins y so a jump or fall cannot drag the ring off the floor). `src/app.ts` wires it: the ring is added to the scene at boot and snapped to the player body once per render frame after `player.syncMeshFromBody()`. The ring is the prototype's SOLE non-diegetic UI element, so it stays neutral-toned (not warm-to-cool) and has no glow, pulse, or animation. Files: `src/scene/floorRing.ts`, `src/app.ts`, `tests/scene/floorRing.test.ts`. PR #13.
- 2026-05-08: REQ-027 deepens. The four doors now read lit vs dark at startup. `src/scene/room.ts` builds the canonical Act 1 portal configuration via `createActOnePortals(doors)` (from `src/sim/portal.ts`) and applies `applyDoorLitState` to each: South and East get a warm diffuse plus an emissive boost; North and West get a near-black diffuse and no emissive. Visual half of REQ-009 / REQ-010; the data half lands in `src/sim/portal.ts`. Files: `src/sim/portal.ts`, `src/scene/door.ts`, `src/scene/room.ts`, `tests/sim/portal.test.ts`, `tests/scene/door.test.ts`, `tests/scene/room.test.ts`. PR pending.
- 2026-05-08: REQ-030 partial. Per-instance warm-to-cool tinting helper landed. `applyInstanceTint(mesh, originNormalized)` stamps a capsule's material color with `interpolateWarmToCool(originNormalized)`, validating finiteness and color-bearing material at the boundary. `createPlayer` now accepts an `originNormalized` option, stamps the capsule at construction, and exposes the value on the returned `Player`. `src/app.ts` passes `timeOfDay.normalized()` at spawn so the active player visibly carries the tint from frame 1. Re-stamping on portal traversal is deferred to the ghost-replay capsule slice. Files: `src/render/instanceTint.ts`, `src/scene/player.ts`, `src/app.ts`, `tests/render/instanceTint.test.ts`, `tests/scene/player.test.ts`. PR #9.
- 2026-05-08: REQ-029 done. `TimeOfDay` is now locked to the deterministic simulation tick. Internal state is an integer `tickIndex` modulo `ticksPerCycle` (default 3600 = 60s * 60Hz). API `advanceTicks(n)` plus `tick()`; the constructor rejects non-tick-aligned cycle configurations. The fixed-step physics loop in `src/app.ts` calls `timeOfDay.advanceTicks(1)` once per step instead of `timeOfDay.advance(deltaMs / 1000)` per render frame, so the same fixed-step count always produces the same normalized output regardless of frame rate. Tests cover the determinism contract (`advanceTicks(N)` equals `N x advanceTicks(1)`, no drift after 1000 cycles, integer-only deltas, non-aligned cycles rejected). Files: `src/sim/timeOfDay.ts`, `src/app.ts`, `tests/sim/timeOfDay.test.ts`. PR #8.
- 2026-05-08: REQ-029 partial. Room background tints across a warm-to-cool spectrum driven by a virtual `TimeOfDay` clock (60s real-time cycle). Anchors: warm `#f6c084`, cool `#5a78b8`. The clock advances on frame delta and the interpolated color is written to `scene.background` each render frame; clock-to-sim-tick binding is deferred to a follow-up dot. Files: `src/sim/timeOfDay.ts`, `src/render/colorTint.ts`, `src/app.ts`, `tests/sim/timeOfDay.test.ts`, `tests/render/colorTint.test.ts`. PR #6.
- 2026-05-08: REQ-027 partial. Four placeholder doors render at the midpoint of each wall, base on the floor, sized 1.2 x 2.2 x 0.12 in a warm color that reads against the cool grey walls. East and west doors rotate 90 degrees about Y so their wide face runs along the wall. Doors are visual-only; collisions and portal traversal are deferred to REQ-001/REQ-005 and lit/dark state to REQ-028. Files: `src/scene/door.ts`, `src/scene/room.ts`, `tests/scene/door.test.ts`, `tests/scene/room.test.ts`. PR #5.
- 2026-05-08: REQ-026 partial. Player capsule spawns at the room center and is keyboard-controllable in world XZ via WASD or arrow keys at 4 m/s, normalized on diagonals, applied as target velocity each fixed physics step. Camera stays fixed; 5:00 timeline anchor not yet wired. Files: `src/input/keyboard.ts`, `src/scene/player.ts`, `src/app.ts`, `tests/input/keyboard.test.ts`. PR (pending: feature/player-capsule).
- 2026-05-08: scaffolded the runtime stack (Vite + TypeScript + Three.js + Rapier3D). Empty placeholder room (10x10x4 units) renders with hemisphere fill plus directional key light at a fixed isometric camera. Files: `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `src/main.ts`, `src/app.ts`, `src/render/renderer.ts`, `src/scene/scene.ts`, `src/scene/room.ts`, `tests/scene/room.test.ts`. PR (pending: feature/vite-scaffold).
