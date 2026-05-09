---
title: "implement: drag regression test (REQ-035)"
status: open
priority: 4
issue-type: task
created-at: "2026-05-08T22:20:15.734160-05:00"
---

Spec: docs/gdd/30-combat-and-interaction.md section 6 (Drag).
Consumes: nothing new (this slice is mostly tests; the feature is a consequence of pickup + movement from REQ-034).

Goal: prove and pin that a carried body's translation tracks the carrier's translation each tick. Drag is not a separate mechanic; it is the visible consequence of pickup-with-movement.
Status target: REQ-035 not_started -> done.

Affected files:
- tests/sim/dragRegression.test.ts (NEW): the entire feature lives in tests for this slice. Cases:
  1. Pick up a body, walk in a straight line for N ticks, assert the body's planar position matches carrier's planar position + CARRY_OFFSET each tick to within floating-point tolerance.
  2. Pick up, walk, drop. Assert the body's translation at drop time equals the carrier's planar position (NOT the pickup position).
  3. Pick up, walk through a doorway with a LIT portal at 5:00, traverse East. Assert that AFTER traversal the body is still attached to the carrier in the destination timeline (carry survives traversal because the body is part of the carrier's recording per Q-011).
  4. Pick up, walk, knock the carrier out (third instance punches them). Assert the body drops in place (within a small radius of the carrier's planar position at the punch tick).
- src/sim/applyCarry.ts: ONLY if a regression case proves a bug, fix it. Otherwise this dot is tests-only.
- src/sim/portalTraversal.ts: ONLY if test 3 reveals a missed case (carry not surviving traversal). The default expectation is that wireTraversal teleports the player and the carry stays attached because the carry is a child of the player's mesh and a kinematic body whose position is set from the carrier each tick.

Edge cases (covered by the four test cases above):
1. Body translation under continuous movement (test 1).
2. Drop-position semantics (test 2).
3. Carry-survives-traversal (test 3).
4. Carrier-knocked-out-mid-drag (test 4).

## Verify
- [ ] npm test: tests/sim/dragRegression.test.ts all four cases pass.
- [ ] No new production code, OR if a regression surfaces, the fix is bounded to src/sim/applyCarry.ts or src/sim/portalTraversal.ts and is documented in the slice's PROGRESS_LOG entry.
- [ ] grep -rnP '[\x{2014}\x{2013}]' . returns nothing.
- [ ] git diff --check clean.
