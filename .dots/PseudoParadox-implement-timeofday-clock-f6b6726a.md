---
title: "implement: TimeOfDay clock binding to deterministic simulation tick (REQ-029 finishing pass)"
status: open
priority: 2
issue-type: task
created-at: "2026-05-08T01:53:56.143013-05:00"
---

REQ-029 currently advances the TimeOfDay clock off render-frame delta. Replace that with a deterministic step driven by the fixed physics tick in src/app.ts so the clock is reproducible across replays. This is a hard prerequisite for REQ-001 (timeline recording must be frame-exact) and REQ-030 (per-instance tints stamped at travel time must match the room color any other instance would see at that tick). Spec: advance the clock once per fixed step inside the existing while loop in src/app.ts using fixedStepSeconds, not deltaMs/1000 in the render path. Add a test that asserts N fixed steps produce exactly N*fixedStepSeconds of normalized advance with no drift. Update docs/GDD_COVERAGE.json REQ-029 to status='done' if this slice fully satisfies the success criterion. Verify: npm test, npm run build, em-dash grep, git diff --check, npm run dev smoke.
