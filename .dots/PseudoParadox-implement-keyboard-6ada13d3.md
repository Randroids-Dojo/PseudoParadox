---
title: "implement: keyboard-controllable player capsule at room center (REQ-026)"
status: active
priority: 1
issue-type: task
created-at: "\"2026-05-08T01:09:40.561668-05:00\""
---

Spawn a capsule mesh + Rapier3D dynamic capsule body in the room center. WASD or arrow keys translate the body in world XZ. Camera stays fixed for now. Update GDD_COVERAGE REQ-026 to partial. Tests: pure input-vector logic unit test (key state -> velocity vector).
