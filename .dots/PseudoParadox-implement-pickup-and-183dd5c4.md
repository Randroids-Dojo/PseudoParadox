---
title: "implement: pickup-and-carry of unconscious body (REQ-034)"
status: open
priority: 3
issue-type: task
created-at: "2026-05-08T22:19:58.029057-05:00"
---

Spec: docs/gdd/30-combat-and-interaction.md section 5 (Pickup).
Consumes: Q-002 (key bindings, default F for pickup), Q-004 (toggle vs hold, default toggle), Q-005 (carry speed multiplier, default 0.6), Q-006 (collision group during carry, default kinematic + excluded group, restored on drop), Q-011 (carry recording semantics, default carrier-recording-captures-input).

Goal: ship REQ-034 end-to-end. The active player can pick up an unconscious body, walks slower while carrying, and drops it on a second tap.
Status target: REQ-034 not_started -> done.

Affected files:
- src/input/keyboard.ts: extend KeyState with pickup boolean; map KeyF to it. Track rising-edge separately (toggle requires edge detection).
- src/sim/inputRecorder.ts: snapshot path already deep-copies KeyState; verify pickup propagates.
- src/sim/carryState.ts (NEW): export CARRY_SPEED_MULTIPLIER = 0.6, CARRY_OFFSET = { x: 0, y: 1.2, z: 0 }, PICKUP_RANGE_M = 1.0; CarryState type ({ kind: 'idle' } | { kind: 'carrying', body: Carryable }); pure helpers nearestCarryable(active, candidates, range) and applyCarryAttachment(body, carrier).
- src/sim/applyCarry.ts (NEW): wireCarry({ player, ghosts, world }) that listens for pickup rising edges and toggles state. On pickup: set body to kinematic, exclude collision group, parent the mesh under the player mesh at CARRY_OFFSET. On drop: dynamic, restore collision group, reparent to the scene at the player's current position.
- src/scene/player.ts: extend Player with carryState plus applyCarrySpeedScaling on setPlanarVelocity (multiply by CARRY_SPEED_MULTIPLIER when carrying).
- src/app.ts: wire the pickup input listener and the per-step toggle resolver.

Edge cases:
1. Pickup while already carrying: ignored (state stays in 'carrying').
2. No body in range on pickup tap: ignored (state stays in 'idle').
3. Multiple bodies in range: pick the closest by planar distance; ties broken by lower instanceId.
4. Carrier knocked out while carrying: carry releases (state -> idle), body drops at carrier's planar position (not the offset position).
5. Hard reset while carrying: clearAllGhosts removes the carried body if it is a ghost; the carrier returns to idle as part of the reset.
6. Pickup while standing inside a portal trigger volume: allowed; the body comes along on the next traversal.

## Verify

- [ ] npm test: new tests in tests/sim/carryState.test.ts cover nearestCarryable selection (closest, ties, range cutoff).
- [ ] tests/sim/applyCarry.test.ts pins the kinematic-flag and collision-group flips on pickup and drop.
- [ ] tests/scene/player.test.ts: setPlanarVelocity is scaled by 0.6 while carrying.
- [ ] tests/sim/inputRecorder.test.ts: a recording with pickup=true at tick T replays with pickup=true at the same tick.
- [ ] grep -rnP '[\x{2014}\x{2013}]' . returns nothing.
- [ ] git diff --check clean.
- [ ] npm run build succeeds.
