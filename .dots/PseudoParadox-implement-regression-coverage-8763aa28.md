---
title: "implement: regression coverage flips REQ-005 / REQ-010 / REQ-026 / REQ-027 / REQ-030 from partial to done"
status: open
priority: 2
issue-type: task
created-at: "2026-05-09T00:26:49.416102-05:00"
---

Tests-mostly slice that flips five partials by adding regression coverage. References docs/gdd/40-act-progress-and-narrative-beats.md section 11. (1) REQ-005 portal fixity: a property test in tests/sim/portal.test.ts that builds a Portal, runs 1000 ticks of a randomized simulation (using the Q-017 LCG), and asserts portal.destinationHours is unchanged. (2) REQ-010 dark-portal entry: a regression test in tests/sim/portalTraversal.test.ts that drives the player into the West-at-5:00 dark portal trigger and asserts player body translation equals the pre-trigger translation. (3) REQ-026 keyboard: tests/input/keyboard.test.ts asserts WASD and arrow keys produce the same inputToVelocity result; tests/scene/player.test.ts asserts spawn pose at game start. (4) REQ-027 four doors: tests/scene/room.test.ts asserts room.group contains exactly four Door meshes (one per cardinal). (5) REQ-030 instance origin tint: tests/sim/ghostInstance.test.ts asserts ghost.mesh.material.color.equals(interpolateWarmToCool(0.5)) within 1e-6 for a ghost built with originNormalized = 0.5. ## Verify - tests pass; npm test count grows. - Em-dash check clean. - GDD coverage: REQ-005, REQ-010, REQ-026, REQ-027, REQ-030 from partial to done. - Build log entry appended to docs/gdd/40-act-progress-and-narrative-beats.md and the relevant section files (02, 03, 23).
