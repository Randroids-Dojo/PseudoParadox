---
title: "implement: throw with portal traversal for ballistic bodies (REQ-036)"
status: open
priority: 5
issue-type: task
created-at: "2026-05-08T22:20:46.159240-05:00"
---

Spec: docs/gdd/30-combat-and-interaction.md section 7 (Throw).
Consumes: Q-002 (key bindings, default T for throw), Q-007 (facing default before first movement, default north), Q-008 (trajectory preservation, default linvel rotated zero degrees), Q-009 (thrown-body determinism, default trust Rapier).

Goal: ship REQ-036 end-to-end. While carrying, pressing T detaches the body and applies a throw impulse. A thrown body crossing a LIT portal trigger teleports to the destination time and continues its arc.
Status target: REQ-036 not_started -> done.

Affected files:
- src/input/keyboard.ts: extend KeyState with throw boolean; map KeyT to it.
- src/sim/inputRecorder.ts: snapshot path already deep-copies KeyState; verify throw propagates.
- src/sim/throw.ts (NEW): export THROW_IMPULSE_N = 14, THROW_UP_IMPULSE_N = 4; pure helper computeThrowImpulse(facing) returning { x, y, z } impulse; applyThrow(body, facing) that applies the impulse and restores body to dynamic + standard collision group.
- src/sim/facing.ts (NEW): facingFromHistory(player) returns the last-non-zero-velocity direction. Default to { x: 0, z: -1 } (north) if no history. Tracked as a per-player mutable reference updated each fixed step from the live KeyState-derived velocity.
- src/sim/applyCarry.ts: extend with a throw transition: on the rising edge of throw input while carrying, run applyThrow(carriedBody, player.facing) and transition CarryState back to idle.
- src/sim/bodyTraversal.ts (NEW): wireBodyTraversal({ detector, world, registry, scene }) listens for portal-trigger 'enter' events not produced by the active player. On a body's overlap with a LIT portal: teleport the body to the destination spawn pose, preserve linvel (Q-008), do NOT spawn a ghost (closed-form decision in section 7).
- src/sim/portalTrigger.ts: extend the trigger detector to step ALSO over thrown-body translations, not just the player's. Each tick, after world.step(), iterate bodies-of-interest (the active player + currently-airborne thrown bodies) and call detector.step for each.
- src/app.ts: wire the throw input listener, instantiate wireBodyTraversal, maintain the airborne-bodies list (a body enters the list on throw, leaves the list when its linvel falls below a small epsilon for N ticks indicating it has come to rest).

Edge cases:
1. Throw with no carry: no-op (state is idle; the throw input still goes into the recording but resolves to nothing).
2. Throw before any movement: facing defaults to north (Q-007).
3. Throw straight into a wall: the body bounces off with the same physics as any dynamic capsule.
4. Throw aimed at a DARK portal: the body bounces off the wall (dark = not enterable per REQ-010); the body does NOT teleport.
5. Throw aimed at a LIT portal that the carrier could not enter (e.g. blocked by arrivals via REQ-011): same gate; the body does NOT teleport.
6. Throw mid-air across a portal during the airborne phase: the body teleports as soon as its translation enters the trigger, mid-arc.
7. Thrown body lands on top of another unconscious body: standard physics; no special case.
8. Two thrown bodies in flight simultaneously: both tracked in the airborne list; both resolved independently.
9. Hard reset while a body is airborne: hardReset must explicitly tear down tracked thrown bodies (scene.remove for the mesh, world.removeRigidBody for the body) and clear the airborne list; this is separate from clearAllGhosts because thrown bodies do NOT spawn ghosts. Implementation: extend hardReset's options with a `thrownBodies` handle (or similar) and walk it the same way clearAllGhosts walks ghost buckets, OR file thrown bodies into a dedicated registry that hardReset already knows about.
10. Thrown body that crosses a portal but lands at exactly the destination spawn pose where the active player is: standard collision; the player gets bumped.

## Verify

- [ ] npm test: new tests in tests/sim/throw.test.ts pin computeThrowImpulse direction and magnitude.
- [ ] tests/sim/facing.test.ts pins the last-non-zero-velocity tracking and the north default.
- [ ] tests/sim/bodyTraversal.test.ts: a body crossing a LIT portal teleports to the destination spawn pose with linvel preserved.
- [ ] tests/sim/bodyTraversal.test.ts: a body crossing a DARK portal does NOT teleport.
- [ ] tests/sim/bodyTraversal.test.ts: a thrown body does NOT spawn a ghost (registry.activeGhosts() count unchanged after the body crosses).
- [ ] tests/sim/inputRecorder.test.ts: a replay of a throw recording produces a body with the same trajectory as the original (within Rapier's deterministic step tolerance).
- [ ] grep -rnP '[\x{2014}\x{2013}]' . returns nothing.
- [ ] git diff --check clean.
- [ ] npm run build succeeds.
