---
title: "implement: hard reset returns simulation to clean Act 1 state (REQ-025)"
status: open
priority: 2
issue-type: task
created-at: "2026-05-08T19:13:38.005908-05:00"
---

Bind a 'r' key to a hard-reset action that tears down all ghosts, snapshots, recorders, portals, and re-seeds the room to the canonical Act 1 5:00 spawn pose. Does NOT need a real pause-menu UI; just a key binding plus the right teardown logic. Plan: in src/app.ts add a key listener that, on 'r' press: removes every ghost mesh from the scene and every ghost body from the world, resets ghosts array to empty; resets the active player's body translation to room center, originNormalized to ACT_ONE_NORMALIZED, mesh tint via applyInstanceTint; resets timeOfDay via setNormalized(ACT_ONE_NORMALIZED); resets the lifetime (fresh InputRecorder, startPosition at room center, originNormalized at ACT_ONE_NORMALIZED); re-stamps door lit/dark via doorLitStateAtHour(ACT_ONE_HOUR). Optionally extract the reset routine to src/sim/hardReset.ts so a future pause-menu UI can call it. Tests: pure unit test for the reset routine that takes a fake world/scene/state and asserts ghosts are cleared, time is at the anchor, player is at center, lifetime is fresh, doors are repainted; a keyboard.ts test that 'r' triggers the reset action via a callback. ## Verify: npm run build, npm test, em-dash grep clean, dev smoke shows pressing 'r' returning the scene to the opening state.
