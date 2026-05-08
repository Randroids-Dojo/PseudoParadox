---
title: "implement: instance-color tinting based on origin timestamp (REQ-030)"
status: open
priority: 2
issue-type: task
created-at: "2026-05-08T01:54:09.857025-05:00"
---

Past instances should tint to the room color at the time they last traveled, providing a visible time-of-origin stamp. Build on REQ-029's interpolateWarmToCool and REQ-026's player capsule. Spec: extend src/scene/player.ts (or add src/scene/instanceTint.ts) so a capsule can be constructed with an originNormalizedTime in [0,1]. The capsule's material color is set once at construction by interpolateWarmToCool(originNormalizedTime). For now the active player instance can be constructed with originNormalizedTime = TimeOfDay.normalized() at spawn; later slices will stamp it from the recorded travel timestamp. Tests: a unit test that constructs two capsules at different normalized times and asserts their material colors equal interpolateWarmToCool at those times. Flip REQ-030 to 'partial' with refs. Verify: npm test, npm run build, em-dash grep, git diff --check, npm run dev smoke.
