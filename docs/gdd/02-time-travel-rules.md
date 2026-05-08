# Time Travel Rules

**Status:** partial

The simulation rules that make the game internally consistent. These rules are non-negotiable. If a feature would require breaking one of these rules, the feature is wrong.

## Core rules

1. **Timelines are written by action.** Once a player has performed actions during a time period, those actions are permanent. They will replay as a past instance any time another instance witnesses that period from outside it.
2. **Past instances replay recorded input exactly.** They cannot be changed. They can only be worked around or physically redirected (knocked out, dragged).
3. **Traveling through a portal does not erase the prior timeline.** It adds to it. The player who steps into a portal continues to exist as a recorded instance in the timeline they just left.
4. **No paradoxes.** A player cannot prevent themselves from having done something they already did. The system must enforce this.
5. **Portals are fixed in location and destination.** A given door always leads to the same other time. Destinations do not change once set.
6. **An unvisited future contains nothing.** A time period that no instance has entered has no recorded events and no instances. Timelines spring into existence the first time they are visited.

## Instance numbering

Each time a new instance enters the room, they are one generation further from the original.

- **You1** is always the first-ever spawn (the seed instance, the one the player starts as in Act 1).
- **You-1** is the instance You1 sees arrive (the first replay).
- **You-2** is the instance You-1 sees arrive (the second-order replay).
- The player always controls the most recently spawned active instance.

## Portal types

- **Lit door.** Enterable. Sends the player to the door's fixed destination time.
- **Dark door.** Spawn-only exit. Other instances emerge from these. The player cannot enter them.

A door's lit/dark state is a function of where instances are arriving from in the recorded timeline, not a discoverable variable. The player learns destinations through experience, not through a label.

## Edge cases that must be addressed

- What happens when two instances enter the same portal in the same frame? (See `OPEN_QUESTIONS.md`.)
- What happens when an instance is unconscious as the recording plays back? (Specified in `09-mechanic-instance-replay.md`.)
- What happens if an instance is killed or removed? (Out of scope for v1; killing is not a mechanic. See `99-out-of-scope.md`.)

### Build log

- 2026-05-08: portal trigger overlap detection lands (REQ-009 deepening). `src/sim/portalTrigger.ts` exports `createPortalTrigger(portal)` (builds an XZ-AABB trigger sized 1.2m wide along the wall, 0.6m deep into the room, centered just inside the door's inward face), `pointInsideTrigger(trigger, x, z)` (pure inclusive containment predicate), and `createPortalTriggerSet(portals)` (aggregates four triggers, tracks per-portal overlap state across ticks, emits edge-triggered `OverlapEvent` with `kind: 'enter' | 'exit'` and a tick number, exposes `onPortalOverlap(callback)` returning an unsubscribe function, plus `isOverlapping(portal)` for inspection). Pure-overlap path chosen over a Rapier sensor collider because the room is single-floor and the door footprint is fully known from `DOOR_DIMENSIONS`. The detector emits for both lit and dark portals in this slice; the next slice gates teleport on `isLit(portal)` at the subscriber. `src/scene/room.ts` now returns `{ group, portals }` (a new `RoomBuild` interface) instead of just a Group so the runtime can wire systems against the same Portal instances. `src/scene/scene.ts` carries `portals` through `SceneContext`. `src/app.ts` builds the trigger set, evaluates `step(x, z, tick)` once per fixed simulation step after `world.step()`, and registers a console-only subscriber that logs portal direction, destination hour, lit flag, and tick. Files: `src/sim/portalTrigger.ts`, `src/scene/room.ts`, `src/scene/scene.ts`, `src/app.ts`, `tests/sim/portalTrigger.test.ts`, `tests/scene/room.test.ts`. PR pending.
- 2026-05-08: portal data structure with destination times and stubbed lit/dark lands. `src/sim/portal.ts` exports `Portal` (a frozen object pairing a Door with a `readonly destinationHours` and a stubbed `isLit` flag), `createPortal` (validates finiteness and `[0, 24)` range), `isLit` (pure predicate), `portalDestinationNormalized` (derives `destinationHours / 24` for `TimeOfDay` consumers), `ACT_ONE_PORTAL_SPECS`, and `createActOnePortals(doors)`. The Act 1 canonical table at the 5:00 timeline state lights South to 12:00 and East to 6:00 (REQ-013 / REQ-014) and leaves North and West dark. `src/scene/door.ts` exports `applyDoorLitState(door, isLit)` plus four visual constants; lit doors get a warm diffuse color plus an emissive boost, dark doors get a near-black diffuse and no emissive. `src/scene/room.ts` consumes `createActOnePortals` at build time and stamps the lit/dark visual on each door. Pure data and stub only. Traversal (REQ-009 send-the-player), collision triggers, and timeline-derived lit/dark (REQ-011) are deferred. Files: `src/sim/portal.ts`, `src/scene/door.ts`, `src/scene/room.ts`, `tests/sim/portal.test.ts`, `tests/scene/door.test.ts`, `tests/scene/room.test.ts`. PR pending.
- 2026-05-08: ghost-replay capsule lands. `createGhost({ recording, originNormalized, scene, world, startPosition })` builds a Three.js mesh and a Rapier dynamic capsule sharing the active player's dimensions; its `advanceTick()` writes `replayAtTick(recording, tickIndex)` onto the body's planar velocity each fixed simulation step (preserving y so gravity is not overwritten) and increments an internal tick counter. Past the end of the recording the ghost writes a zero planar velocity and decelerates to a stop under linear damping. The mesh is tinted once at construction with `applyInstanceTint(originNormalized)` so the ghost reads as a different generation than the active player. The same fixed-step loop in `src/app.ts` that already advances physics and `TimeOfDay` now also calls `ghost.advanceTick()` for every active ghost. Pressing `g` in the running app snapshots the current `InputRecorder` and spawns a ghost from the player's spawn position; the recorder keeps recording afterward. Despawn semantics (cleanup of finished ghosts) and portal-driven recording boundaries are deferred to REQ-003. Files: `src/sim/ghostInstance.ts`, `src/app.ts`, `tests/sim/ghostInstance.test.ts`. PR pending.
- 2026-05-08: per-tick input recording buffer lands as the foundation for REQ-001 / REQ-002. Each fixed simulation step pushes the active player's KeyState plus the current TimeOfDay normalized snapshot into an `InputRecorder`. Snapshots are deeply frozen and defensively copied. A pure `replayAtTick(recording, tick)` returns the recorded planar velocity, or a zero vector for ticks past the end of the recording. Files: `src/sim/inputRecorder.ts`, `src/app.ts`, `tests/sim/inputRecorder.test.ts`. PR #7.
