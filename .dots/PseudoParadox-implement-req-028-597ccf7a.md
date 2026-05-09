---
title: "implement: REQ-028 visual lit/dark verification (test + any visual fix)"
status: open
priority: 2
issue-type: task
created-at: "2026-05-09T00:26:59.722504-05:00"
---

Verify and flip REQ-028 from not_started to done. The visual half of REQ-011 is functionally satisfied (the door paint path in src/sim/timelineRoom.ts and src/scene/room.ts already calls doorLitStateAtHour(hour) at every reachable hour). This slice is the regression test that pins the contract. References docs/gdd/40-act-progress-and-narrative-beats.md section 6. Add tests/scene/room.test.ts cases that walk hours 5, 6, 12 across the four cardinals and assert each Door's applyDoorLitState was called with the value litStateForTimeline(hour, { ghosts: [] }) returns. Add a single render-pass smoke that reads each door's mesh material emissive value and asserts lit > 0 dark === 0. The slice does NOT unify the paint path through litStateForTimeline (F-006 stays open). If the regression surfaces a real gap (e.g., a cardinal whose paint disagrees with the gate at some reachable hour), flip the test red, then add the smallest possible fix to bring paint into agreement. ## Verify - regression test green at hours 5, 6, 12. - Em-dash check clean. - GDD coverage: REQ-028 from not_started to done. - Build log entry appended.
