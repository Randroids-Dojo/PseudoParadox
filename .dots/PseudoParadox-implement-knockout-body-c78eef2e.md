---
title: "implement: knockout body response (REQ-033 finishing pass)"
status: open
priority: 2
issue-type: task
created-at: "2026-05-08T22:19:36.108967-05:00"
---

Spec: docs/gdd/30-combat-and-interaction.md section 4 (Knockouts), Combat tone section 3.
Consumes: Q-003 (punch range from prior dot, already wired).

Goal: ship the physical, visible half of REQ-033. After this dot, a knockout produces a physically readable, slightly absurd, tonally consistent fall.
Status target: REQ-033 partial -> done.

Affected files:
- src/sim/knockoutState.ts: add the body-response constants. KNOCKOUT_IMPULSE_N = 6 (along incoming direction), KNOCKOUT_UP_IMPULSE_N = 2, UNCONSCIOUS_LINEAR_DAMPING = 0.5.
- src/sim/applyKnockout.ts (NEW): applyKnockout(body, incomingDirection) that on transition: applies the bump impulse at body center, flips linearDamping to UNCONSCIOUS_LINEAR_DAMPING, relaxes enabledRotations(true, true, true) so the capsule can roll to its side.
- src/scene/player.ts: integrate applyKnockout when consciousness flips. Active input gating: while consciousness === unconscious, skip setPlanarVelocity from input.
- src/sim/ghostInstance.ts: same gating on advanceTick. If unconscious, skip writing replay velocity onto the body (gravity and damping continue to integrate the body naturally).
- src/sim/punch.ts: extended to compute the incoming direction (recipient.translation - puncher.translation, normalized in XZ) and pass to applyKnockout.
- src/app.ts: nothing new; the per-step evaluator from the prior dot now drives the body-response too.

Edge cases:
1. Punch direction parallel to a wall: incoming direction is well-defined; the body slides along the wall under reduced damping.
2. Punch at zero distance (overlapping capsules): direction is zero-vector; default to a deterministic fallback (puncher facing or +X, document choice).
3. Body already at rest after a previous knockout (re-punch): no-op per state machine; the body stays unconscious, no second impulse.
4. Knockout while at a portal trigger: the body falls inside the trigger; the next traversal evaluation still fires, but ghosts and actives both gate on consciousness so the body cannot self-traverse.

## Verify
- [ ] npm test: new tests in tests/sim/applyKnockout.test.ts pin impulse direction and magnitude on a stub body.
- [ ] tests/sim/punch.test.ts: end-to-end test that a recipient body's linvel is non-zero and pointing along the incoming direction immediately after the punch resolves.
- [ ] tests/scene/player.test.ts: an unconscious player ignores keyboard input (setPlanarVelocity is not called).
- [ ] tests/sim/ghostInstance.test.ts: an unconscious ghost does not write replay velocity onto its body (the body's linvel is whatever physics produces from the bump impulse, not a recording-derived velocity).
- [ ] grep -rnP '[\x{2014}\x{2013}]' . returns nothing.
- [ ] git diff --check clean.
- [ ] npm run build succeeds.
