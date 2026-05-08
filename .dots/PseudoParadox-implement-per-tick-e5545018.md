---
title: "implement: per-tick input recording buffer for the active player instance (foundation for REQ-001 / REQ-002)"
status: open
priority: 2
issue-type: task
created-at: "2026-05-08T01:54:03.655445-05:00"
---

Capture the player's input each fixed simulation step into an in-memory recording buffer. Spec: add src/sim/inputRecorder.ts exposing a class or pure helpers with record(tick, KeyState) and snapshot() => readonly frames. Wire src/app.ts to push the current keyboard.state plus the current TimeOfDay normalized snapshot into the recorder once per fixed step. NOT in scope: replaying recorded input on a dummy capsule (separate slice), portal-triggered recording boundaries (REQ-003), or persistence across sessions. Tests: pure unit tests for record-then-snapshot round trip, monotonic tick increment, and that snapshot returns a defensive copy. Update REQ-001 row to 'partial' with implementationRefs/testRefs. Verify: npm test, npm run build, em-dash grep, git diff --check, npm run dev smoke.
