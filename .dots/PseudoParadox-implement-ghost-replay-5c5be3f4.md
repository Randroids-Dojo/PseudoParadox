---
title: "implement: ghost-replay capsule plays a recorded input stream (REQ-001 / REQ-002 deepening)"
status: open
priority: 2
issue-type: task
created-at: "2026-05-08T02:53:20.190353-05:00"
---

Spawn a dummy ghost-replay capsule (separate Player-like instance) that takes an InputRecording and plays it back tick-for-tick using replayAtTick. Use createPlayer with a distinct origin tint so the ghost reads as a past instance per REQ-030. The active player's recorder produces the input stream. Add a debug spawn key (e.g. press 'R') that snapshots the current InputRecording and spawns a ghost from the start. Tests: a unit/integration test that fakes a recording, advances simulation ticks, and asserts the ghost capsule's body translation matches the recorded movement within tolerance. Also assert the ghost's tint comes from its constructor origin, distinct from the active player's. Verify: npm test, npm run build, em-dash grep, git diff --check, npm run dev smoke (press R, see a ghost replay your last seconds).
